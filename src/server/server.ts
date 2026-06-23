import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DotMatrixController } from "./display.js";
import { fetchNbaDisplayState, formatNextGameForDisplay } from "../providers/espn.js";
import { GoogleCalendarService, NotConfiguredError } from "../providers/google-calendar-service.js";
import { LocationService } from "../providers/location-service.js";
import { ICloudCalendarService } from "../providers/icloud-calendar-service.js";
import { BrowserSettingsService } from "../providers/browser-settings-service.js";
import { renderDisplayCardPreviewMatrix, renderNbaDisplayModeToMatrix, renderNbaGameToMatrix, renderNbaNextGameToMatrix } from "../matrix/matrix.js";
import { RotationEngine } from "../rotation/rotation-engine.js";
import { NbaDisplayMode, NbaDisplayState, NbaScoreResponse, NormalizedDisplayCard, NormalizedGameScore, RotationDisplayState } from "../rotation/types.js";
import { setDisplayItemCategory, setDisplayItemEnabled } from "../rotation/display-config.js";
import { logWithClock } from "../hardware/logging.js";

const publicDir = path.resolve(process.cwd(), process.env.GLANCEBOARD_PUBLIC_DIR ?? "public");
const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_SETTLE_DELAY_MS = 500;
const FAST_ROTATION_SECONDS = 3;
const DISPLAY_VERBOSE = process.env.GLANCEBOARD_DISPLAY_VERBOSE === "true";

type RotationPace = "normal" | "fast";
type RotationPayload = NbaScoreResponse & { rotation: RotationDisplayState };

export interface RotatingDisplayServer {
  url: string;
  close: () => Promise<void>;
}

export async function startRotatingDisplayServer(port: number): Promise<RotatingDisplayServer> {
  const vite = await createViteDevServer();
  let latestState: NbaDisplayState | undefined;
  let latestRotation: RotationDisplayState | undefined;
  let activeCardId: string | undefined;
  let rotationPaused = false;
  let rotationTimer: NodeJS.Timeout | undefined;
  let rotationTickInFlight = false;
  let rotationPace: RotationPace = "fast";
  let displaySecondsOverride: number | undefined;
  let seenCardIdsThisPass = new Set<string>();
  let reconnectTimer: NodeJS.Timeout | undefined;
  let reconnectAttempts = 0;
  let reconnectInFlight = false;
  let autoReconnectEnabled = true;
  const rotationEventClients = new Set<http.ServerResponse>();
  const rotationEngine = new RotationEngine();
  const googleCalendar = new GoogleCalendarService(port);
  const icloudCalendar = new ICloudCalendarService();
  const locationService = new LocationService();
  const display = new DotMatrixController({
    deviceName: process.env.LED_DEVICE_NAME ?? "CoolLEDUX-01DF",
    deviceId: process.env.LED_DEVICE_ID
  });
  const browserSettings = new BrowserSettingsService();

  const stopReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };

  const scheduleReconnect = (delayMs = reconnectDelayMs(reconnectAttempts)) => {
    if (!autoReconnectEnabled || display.isConnected() || reconnectInFlight) return;
    if (reconnectTimer) return;
    log("🔌", `reconnect in ${formatDelay(delayMs)}`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void reconnectDisplay();
    }, delayMs);
  };

  const reconnectDisplay = async () => {
    if (!autoReconnectEnabled || reconnectInFlight || display.isConnected()) return;
    reconnectInFlight = true;
    try {
      log("🔌", "connecting");
      const status = await display.connect();
      if (status.status === "connected") {
        log("✅ ⚡️", "screen connected");
        reconnectAttempts = 0;
        scheduleBackendRotation(RECONNECT_SETTLE_DELAY_MS);
        return;
      }

      reconnectAttempts += 1;
      log("⚠️", status.lastMessage ?? "connect failed");
      scheduleReconnect();
    } catch (error) {
      reconnectAttempts += 1;
      log("⚠️", error instanceof Error ? error.message : String(error));
      scheduleReconnect();
    } finally {
      reconnectInFlight = false;
    }
  };

  const enableAutoReconnect = () => {
    autoReconnectEnabled = true;
    if (!display.isConnected()) scheduleReconnect(0);
  };

  const stopBackendRotation = () => {
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = undefined;
  };

  const broadcastRotation = (state = latestState, rotation = latestRotation) => {
    if (!state || !rotation) return;
    const fallbackGame = state.currentGame ?? state.nextGame ?? noGameState();
    const payload = buildScoreResponse(state, fallbackGame, rotation);
    for (const client of rotationEventClients) {
      client.write(`event: rotation\n`);
      client.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  display.onUnexpectedDisconnect(() => {
    log("⚠️", "screen disconnected");
    stopBackendRotation();
    if (autoReconnectEnabled) scheduleReconnect(0);
  });

  const scheduleBackendRotation = (delayMs = 0) => {
    stopBackendRotation();
    if (rotationTickInFlight) {
      logVerbose("⏭️", "rotation busy");
      return;
    }
    if (!display.isAutoSendEnabled()) {
      logVerbose("⏸️", "rotation off");
      return;
    }
    if (rotationPaused) {
      logVerbose("⏸️", "rotation paused");
      return;
    }
    if (!display.isReadyToSend()) {
      logVerbose("🔌", "waiting for screen");
      scheduleReconnect(0);
      return;
    }
    log("⏱️", `next rotation in ${formatDelay(delayMs)}`);
    rotationTimer = setTimeout(() => {
      void tickBackendRotation();
    }, delayMs);
  };

  const tickBackendRotation = async () => {
    if (rotationTickInFlight || !display.isAutoSendEnabled() || rotationPaused || !display.isReadyToSend()) {
      logVerbose("⏭️", rotationSkipReason(rotationTickInFlight, display.isAutoSendEnabled(), rotationPaused, display.isReadyToSend()));
      if (!display.isReadyToSend()) scheduleReconnect(0);
      scheduleBackendRotation(1000);
      return;
    }

    rotationTickInFlight = true;
    const paceForTick = rotationPace;
    let completedSuccessfully = false;
    try {
      const [state, rotation] = await Promise.all([fetchNbaDisplayStateSafe(latestState), rotationEngine.refresh()]);
      latestState = state;
      latestRotation = rotation;
      const currentCard = activeCardId ? rotation.cards.find((candidate) => candidate.id === activeCardId) : undefined;
      const card = rotationEngine.next() ?? rotation.activeCard;
      if (card) {
        log("✏️", currentCard && currentCard.id !== card.id ? `${currentCard.title} → ${card.title}` : card.title);
        const sendStartedAt = Date.now();
        const secondsForTick = displaySeconds(rotation.rotationSeconds);
        const status = await display.sendCardTransition(currentCard?.id === card.id ? undefined : currentCard, card, paceForTick, secondsForTick);
        log("⏱️", `sent in ${formatDelay(Date.now() - sendStartedAt)}`);
        log(status.status === "error" ? "⚠️" : "✅", status.status === "error" ? status.lastMessage ?? card.title : card.title);
        if (status.status === "error" || !display.isConnected()) {
          scheduleReconnect(0);
        } else {
          rotation.activeCard = card;
          activeCardId = card.id;
          updateRotationPass(card, rotation.cards);
          completedSuccessfully = true;
        }
      } else {
        log("⚠️", "no cards");
      }
      latestRotation = { ...rotation, paused: rotationPaused };
      if (completedSuccessfully) broadcastRotation(state, latestRotation);
    } catch (error) {
      log("⚠️", error instanceof Error ? error.message : String(error));
    } finally {
      rotationTickInFlight = false;
      if (completedSuccessfully && display.isConnected()) {
        const seconds = displaySeconds(latestRotation?.rotationSeconds ?? 10);
        const delayMs = Math.max(3, seconds) * 1000;
        log("⏳", `hold ${formatDelay(delayMs)}\n`);
        scheduleBackendRotation(delayMs);
      } else {
        log("⏸️", "rotation hold skipped");
        if (display.isConnected()) scheduleBackendRotation(RECONNECT_SETTLE_DELAY_MS);
        else if (autoReconnectEnabled) scheduleReconnect(0);
      }
    }
  };

  const updateRotationPass = (card: NormalizedDisplayCard, cards: NormalizedDisplayCard[]) => {
    if (cards.length <= 1) return;
    const currentIds = new Set(cards.map((candidate) => candidate.id));
    seenCardIdsThisPass = new Set([...seenCardIdsThisPass].filter((id) => currentIds.has(id)));
    seenCardIdsThisPass.add(card.id);

    if (seenCardIdsThisPass.size < cards.length) return;
    seenCardIdsThisPass = new Set();
    if (displaySecondsOverride !== undefined) return;
    rotationPace = rotationPace === "normal" ? "fast" : "normal";
    log(rotationPace === "fast" ? "⚡️" : "⏱️", `${rotationPace} pass`);
    logDisplaySeconds(latestRotation?.rotationSeconds ?? 10);
  };

  const displaySeconds = (normalSeconds: number) => {
    return displaySecondsOverride ?? (rotationPace === "fast" ? FAST_ROTATION_SECONDS : Math.max(3, normalSeconds));
  };

  const logDisplaySeconds = (normalSeconds: number) => {
    log("⏲️", `display ${displaySeconds(normalSeconds)}s per slide`);
  };

  const settings = await browserSettings.get();
  display.setIntensity(settings.displayIntensity);
  display.setAutoSend(settings.autoSendRotation);
  log(settings.autoSendRotation ? "▶️" : "⏸️", `auto-send ${settings.autoSendRotation ? "on" : "off"}`);
  log("⚡️", `${rotationPace} pass`);
  logDisplaySeconds(10);
  if (settings.autoSendRotation) {
    enableAutoReconnect();
    scheduleBackendRotation();
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (url.pathname === "/api/rotation/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive"
        });
        response.write(": connected\n\n");
        rotationEventClients.add(response);
        request.on("close", () => {
          rotationEventClients.delete(response);
        });
        broadcastRotation();
        return;
      }

      if (url.pathname === "/api/rotation" || url.pathname === "/api/nba-score") {
        if (url.searchParams.get("refresh") === "calendar") invalidateCalendarRotation(rotationEngine);
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId, rotationPaused, displaySeconds);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        return;
      }

      if (url.pathname === "/api/rotation/items/enabled" && request.method === "POST") {
        const body = await readJsonBody(request);
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "id is required" }));
          return;
        }
        const enabled = typeof body.enabled === "boolean" ? body.enabled : false;

        await setDisplayItemEnabled(id, enabled);
        if (activeCardId === id && !enabled) activeCardId = undefined;
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId === id && !enabled ? undefined : activeCardId, rotationPaused, displaySeconds);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        scheduleBackendRotation();
        broadcastRotation();
        return;
      }

      if (url.pathname === "/api/rotation/items/category" && request.method === "POST") {
        const body = await readJsonBody(request);
        const id = typeof body.id === "string" ? body.id : "";
        const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
        if (!id || !categoryId) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "id and categoryId are required" }));
          return;
        }

        await setDisplayItemCategory(id, categoryId);
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId, rotationPaused, displaySeconds);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        scheduleBackendRotation();
        broadcastRotation();
        return;
      }

      if (url.pathname === "/api/rotation/display-seconds" && request.method === "POST") {
        const body = await readJsonBody(request);
        displaySecondsOverride = normalizeDisplaySeconds(body.seconds);
        logDisplaySeconds(latestRotation?.rotationSeconds ?? 10);
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId, rotationPaused, displaySeconds);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        scheduleBackendRotation(displaySecondsOverride * 1000);
        broadcastRotation();
        return;
      }

      if (url.pathname === "/api/rotation/select" && request.method === "POST") {
        const body = await readJsonBody(request);
        const cardId = typeof body.cardId === "string" ? body.cardId : "";
        if (!cardId) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "cardId is required" }));
          return;
        }

        const currentRotation = await rotationEngine.refresh();
        if (!currentRotation.cards.some((card) => card.id === cardId)) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: `Display card not found: ${cardId}` }));
          return;
        }

        const handled = await handleScoreApi(response, display, rotationEngine, cardId, rotationPaused, displaySeconds);
        activeCardId = cardId;
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        scheduleBackendRotation();
        broadcastRotation();
        return;
      }

      if (url.pathname === "/api/rotation/pause" && request.method === "POST") {
        const body = await readJsonBody(request);
        rotationPaused = Boolean(body.paused);
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId, rotationPaused, displaySeconds);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        if (rotationPaused) stopBackendRotation();
        else scheduleBackendRotation();
        broadcastRotation();
        return;
      }

      if (url.pathname.startsWith("/api/google-calendar/")) {
        const handled = await handleGoogleCalendarApi(request, response, url, googleCalendar);
        if (handled) return;
      }

      if (url.pathname.startsWith("/api/calendar/icloud/")) {
        const handled = await handleICloudCalendarApi(request, response, url, icloudCalendar);
        if (handled) return;
      }

      if (url.pathname === "/api/browser-settings" && request.method === "GET") {
        sendJson(response, await browserSettings.get());
        return;
      }

      if (url.pathname === "/api/browser-settings" && request.method === "POST") {
        sendJson(response, await browserSettings.save(await readJsonBody(request)));
        return;
      }

      if (url.pathname === "/api/location" && request.method === "GET") {
        sendJson(response, await locationService.current());
        return;
      }

      if (url.pathname === "/api/location/detect" && request.method === "POST") {
        sendJson(response, await locationService.detectByIp());
        return;
      }

      if (url.pathname === "/api/location" && request.method === "POST") {
        const body = await readJsonBody(request);
        const zip = typeof body.zip === "string" ? body.zip : "";
        sendJson(response, await locationService.saveZip(zip));
        return;
      }

      if (url.pathname === "/api/display/status") {
        const status = display.refreshConnectionStatus();
        if (status.status === "error" && autoReconnectEnabled) scheduleReconnect(0);
        sendJson(response, status);
        return;
      }

      if (url.pathname === "/api/display/connect" && request.method === "POST") {
        enableAutoReconnect();
        const status = await display.connect();
        if (status.status !== "connected") scheduleReconnect();
        scheduleBackendRotation();
        sendJson(response, status);
        return;
      }

      if (url.pathname === "/api/display/disconnect" && request.method === "POST") {
        autoReconnectEnabled = false;
        stopReconnect();
        stopBackendRotation();
        sendJson(response, await display.disconnect());
        return;
      }

      if (url.pathname === "/api/display/send-current" && request.method === "POST") {
        const body = await readJsonBody(request);
        const cardId = typeof body.cardId === "string" ? body.cardId : undefined;
        const card = selectCard(latestRotation, cardId ?? activeCardId);
        if (card) {
          enableAutoReconnect();
          const status = await display.sendCard(card);
          if (status.status === "error") scheduleReconnect(0);
          sendJson(response, status);
          return;
        }

        const mode = body.mode === "next_game" ? "next_game" : "live_score";
        const game = selectGameForMode(latestState, mode);
        if (!game) {
          response.writeHead(409, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "No display item has been fetched yet." }));
          return;
        }
        enableAutoReconnect();
        const status = await display.sendGame(game, mode);
        if (status.status === "error") scheduleReconnect(0);
        sendJson(response, status);
        return;
      }

      if (url.pathname === "/api/display/auto-send" && request.method === "POST") {
        const body = await readJsonBody(request);
        const status = display.setAutoSend(Boolean(body.enabled));
        if (status.autoSend) {
          enableAutoReconnect();
          scheduleBackendRotation();
        } else {
          stopBackendRotation();
        }
        sendJson(response, status);
        return;
      }

      if (url.pathname === "/api/display/intensity" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, display.setIntensity(Number(body.intensity)));
        return;
      }

      if (vite) {
        await runViteMiddleware(vite.middlewares, request, response);
        if (response.writableEnded) return;
      }

      await serveStatic(url.pathname, response);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  enableAutoReconnect();

  return {
    url: `http://localhost:${port}`,
    close: async () => {
      stopBackendRotation();
      stopReconnect();
      for (const client of rotationEventClients) client.end();
      rotationEventClients.clear();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await vite?.close();
    }
  };
}

function reconnectDelayMs(attempts: number): number {
  return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempts, 4));
}

function normalizeDisplaySeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 3;
  return Math.max(3, Math.round(seconds));
}

function log(icon: string, message: string): void {
  logWithClock(`${icon} ${message}`);
}

function logVerbose(icon: string, message: string): void {
  if (DISPLAY_VERBOSE) log(icon, message);
}

function formatDelay(delayMs: number): string {
  if (delayMs <= 0) return "now";
  if (delayMs < 1000) return `${Math.round(delayMs)}ms`;
  return `${Math.round(delayMs / 1000)}s`;
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `; cause=${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

function rotationSkipReason(inFlight: boolean, autoSend: boolean, paused: boolean, ready: boolean): string {
  if (inFlight) return "tick busy";
  if (!autoSend) return "rotation off";
  if (paused) return "rotation paused";
  if (!ready) return "screen not ready";
  return "tick skipped";
}

function invalidateCalendarRotation(rotationEngine: RotationEngine): void {
  rotationEngine.invalidate((item) => item.type === "google-calendar-next-event" || item.type === "icloud-calendar-next-event");
}

async function createViteDevServer() {
  if (process.env.GLANCEBOARD_VITE_DEV !== "true") return undefined;

  const { createLogger, createServer } = await import("vite");
  const logger = createLogger();
  const warn = logger.warn.bind(logger);
  const warnOnce = logger.warnOnce.bind(logger);
  const shouldIgnore = (message: string) =>
    message.startsWith("Sourcemap for ") && message.includes("/taggedjs/main/dist/js/");
  logger.warn = (message, options) => {
    if (!shouldIgnore(message)) warn(message, options);
  };
  logger.warnOnce = (message, options) => {
    if (!shouldIgnore(message)) warnOnce(message, options);
  };

  return createServer({
    root: path.resolve(process.cwd(), "client"),
    appType: "spa",
    customLogger: logger,
    server: { middlewareMode: true }
  });
}

async function runViteMiddleware(
  middleware: { (request: http.IncomingMessage, response: http.ServerResponse, next: (error?: unknown) => void): void },
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    middleware(request, response, (error?: unknown) => error ? reject(error) : resolve());
    response.once("finish", resolve);
  });
}

async function handleICloudCalendarApi(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  icloudCalendar: ICloudCalendarService
): Promise<boolean> {
  if (url.pathname === "/api/calendar/icloud/status" && request.method === "GET") {
    sendJson(response, await icloudCalendar.status());
    return true;
  }

  if (url.pathname === "/api/calendar/icloud/connect" && request.method === "POST") {
    const body = await readJsonBody(request);
    const calendars = await icloudCalendar.connect({
      appleId: typeof body.appleId === "string" ? body.appleId : undefined,
      appSpecificPassword: typeof body.appSpecificPassword === "string" ? body.appSpecificPassword : undefined
    });
    sendJson(response, { status: await icloudCalendar.status(), calendars });
    return true;
  }

  if (url.pathname === "/api/calendar/icloud/disconnect" && request.method === "POST") {
    await icloudCalendar.disconnect();
    sendJson(response, await icloudCalendar.status());
    return true;
  }

  if (url.pathname === "/api/calendar/icloud/calendars" && request.method === "GET") {
    sendJson(response, { calendars: await icloudCalendar.listCalendars() });
    return true;
  }

  if (url.pathname === "/api/calendar/icloud/selected-calendar" && request.method === "POST") {
    const body = await readJsonBody(request);
    const calendarId = typeof body.calendarId === "string" ? body.calendarId : "";
    const calendarName = typeof body.calendarName === "string" ? body.calendarName : undefined;
    const eventShowCount = typeof body.eventShowCount === "number" ? body.eventShowCount : undefined;
    const settings = await icloudCalendar.saveSelectedCalendar(calendarId, calendarName, eventShowCount);
    sendJson(response, { settings, status: await icloudCalendar.status() });
    return true;
  }

  if (url.pathname === "/api/calendar/icloud/events" && request.method === "GET") {
    const calendarId = url.searchParams.get("calendarId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 3);
    if (url.searchParams.get("refresh") === "1") icloudCalendar.clearCache(calendarId);
    sendJson(response, {
      events: await icloudCalendar.getUpcomingEvents(calendarId, Number.isFinite(limit) ? limit : 3)
    });
    return true;
  }

  if (url.pathname === "/api/calendar/icloud/install-rotation-items" && request.method === "POST") {
    const body = await readJsonBody(request);
    const calendarId = typeof body.calendarId === "string" ? body.calendarId : undefined;
    const eventShowCount = typeof body.eventShowCount === "number" ? body.eventShowCount : undefined;
    await icloudCalendar.installRotationItems(calendarId, eventShowCount);
    sendJson(response, { ok: true, status: await icloudCalendar.status() });
    return true;
  }

  return false;
}

async function handleGoogleCalendarApi(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  googleCalendar: GoogleCalendarService
): Promise<boolean> {
  if (url.pathname === "/api/google-calendar/status" && request.method === "GET") {
    sendJson(response, await googleCalendar.status());
    return true;
  }

  if (url.pathname === "/api/google-calendar/credentials" && request.method === "POST") {
    const body = await readJsonBody(request);
    await googleCalendar.saveCredentials({
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : undefined,
      redirectUri: typeof body.redirectUri === "string" ? body.redirectUri : undefined
    });
    sendJson(response, await googleCalendar.status());
    return true;
  }

  if (url.pathname === "/api/google-calendar/auth/start" && request.method === "GET") {
    try {
      response.writeHead(302, { location: await googleCalendar.buildAuthUrl() });
      response.end();
    } catch (error) {
      sendGoogleCalendarError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/google-calendar/auth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) {
      sendHtml(response, "Google Calendar setup failed", "Google did not return an authorization code.");
      return true;
    }

    try {
      await googleCalendar.handleCallback(code);
      sendHtml(response, "Google Calendar connected", "You can close this tab or return to the display app.");
    } catch (error) {
      sendHtml(response, "Google Calendar setup failed", error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (url.pathname === "/api/google-calendar/auth/logout" && request.method === "POST") {
    await googleCalendar.logout();
    sendJson(response, await googleCalendar.status());
    return true;
  }

  if (url.pathname === "/api/google-calendar/calendars" && request.method === "GET") {
    sendJson(response, { calendars: await googleCalendar.listCalendars() });
    return true;
  }

  if (url.pathname === "/api/google-calendar/selected-calendar" && request.method === "POST") {
    const body = await readJsonBody(request);
    const calendarId = typeof body.calendarId === "string" ? body.calendarId : "";
    const calendarName = typeof body.calendarName === "string" ? body.calendarName : undefined;
    if (!calendarId) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "calendarId is required" }));
      return true;
    }
    const settings = await googleCalendar.saveSelectedCalendar(calendarId, calendarName);
    sendJson(response, { settings, status: await googleCalendar.status() });
    return true;
  }

  if (url.pathname === "/api/google-calendar/events" && request.method === "GET") {
    const calendarId = url.searchParams.get("calendarId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 3);
    sendJson(response, { events: await googleCalendar.getUpcomingEvents(calendarId, Number.isFinite(limit) ? limit : 3) });
    return true;
  }

  if (url.pathname === "/api/google-calendar/install-rotation-items" && request.method === "POST") {
    const body = await readJsonBody(request);
    const calendarId = typeof body.calendarId === "string" ? body.calendarId : undefined;
    await googleCalendar.installRotationItems(calendarId);
    sendJson(response, { ok: true });
    return true;
  }

  return false;
}

async function handleScoreApi(
  response: http.ServerResponse,
  display: DotMatrixController,
  rotationEngine: RotationEngine,
  preferredCardId: string | undefined,
  paused: boolean,
  effectiveRotationSeconds?: (normalSeconds: number) => number
): Promise<{ legacyState: NbaDisplayState; rotation: RotationDisplayState; payload: RotationPayload }> {
  const [state, rotation] = await Promise.all([fetchNbaDisplayStateSafe(), rotationEngine.refresh()]);
  if (effectiveRotationSeconds) rotation.rotationSeconds = effectiveRotationSeconds(rotation.rotationSeconds);
  if (preferredCardId) {
    const activeCard = rotationEngine.select(preferredCardId);
    if (activeCard) rotation.activeCard = activeCard;
  }
  rotation.paused = paused;
  const fallbackGame = state.currentGame ?? state.nextGame ?? noGameState();
  const payload = buildScoreResponse(state, fallbackGame, rotation);

  sendJson(response, payload);

  return { legacyState: state, rotation, payload };
}

async function fetchNbaDisplayStateSafe(fallback?: NbaDisplayState): Promise<NbaDisplayState> {
  try {
    return await fetchNbaDisplayState();
  } catch (error) {
    const detail = errorDetail(error);
    log("⚠️", `NBA display fetch failed: ${detail}`);
    if (fallback) return { ...fallback, error: detail };
    return offlineNbaDisplayState(detail);
  }
}

function offlineNbaDisplayState(error: string): NbaDisplayState {
  return {
    mode: "live_score",
    lastUpdated: new Date().toISOString(),
    error,
    debug: {
      todayEvents: 0,
      scheduleEvents: 0,
      finalsEvents: 0,
      fetchedDates: []
    }
  };
}

function buildScoreResponse(state: NbaDisplayState, fallbackGame: NormalizedGameScore, rotation: RotationDisplayState): RotationPayload {
  const activeCard = rotation.activeCard;
  return {
    state,
    displays: {
      live_score: state.currentGame
        ? {
            readableLines: state.currentGame.displayLines,
            dotMatrix: renderNbaGameToMatrix(state.currentGame)
          }
        : undefined,
      next_game: state.nextGame
        ? {
            readableLines: formatNextGameForDisplay(state.nextGame),
            dotMatrix: renderNbaNextGameToMatrix(state.nextGame)
          }
        : undefined
    },
    game: fallbackGame,
    dotMatrix: activeCard ? renderDisplayCardPreviewMatrix(activeCard) : renderNbaDisplayModeToMatrix(state.mode, selectGameForMode(state, state.mode) ?? fallbackGame),
    rotation: {
      ...rotation,
      cards: rotation.cards.map(serializeCard),
      activeCard: rotation.activeCard ? serializeCard(rotation.activeCard) : undefined
    },
    fetchedAt: new Date().toISOString(),
    source: "espn"
  };
}

function serializeCard(card: NormalizedDisplayCard): NormalizedDisplayCard & { dotMatrix: string[][] } {
  const { raw: _raw, ...rest } = card;
  return {
    ...rest,
    dotMatrix: renderDisplayCardPreviewMatrix(card)
  };
}

function selectCard(state: RotationDisplayState | undefined, id: string | undefined): NormalizedDisplayCard | undefined {
  if (!state) return undefined;
  if (id) return state.cards.find((card) => card.id === id);
  return state.activeCard;
}

function selectGameForMode(state: NbaDisplayState | undefined, mode: NbaDisplayMode): NormalizedGameScore | undefined {
  if (!state) return undefined;
  return mode === "next_game" ? state.nextGame : state.currentGame;
}

function noGameState(): NormalizedGameScore {
  return {
    status: "no_game",
    league: "NBA",
    displayLines: ["NO NBA", "GAMES"]
  };
}

async function serveStatic(pathname: string, response: http.ServerResponse): Promise<void> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(response: http.ServerResponse, payload: unknown): void {
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response: http.ServerResponse, title: string, message: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to display app</a></p></body></html>`);
}

function sendGoogleCalendarError(response: http.ServerResponse, error: unknown): void {
  const status = error instanceof NotConfiguredError ? 400 : 500;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === "\"") return "&quot;";
    return "&#39;";
  });
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
