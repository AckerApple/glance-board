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
import { setDisplayItemEnabled } from "../rotation/display-config.js";

const publicDir = path.resolve(process.cwd(), process.env.GLANCEBOARD_PUBLIC_DIR ?? "public");

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
  const rotationEngine = new RotationEngine();
  const googleCalendar = new GoogleCalendarService(port);
  const icloudCalendar = new ICloudCalendarService();
  const locationService = new LocationService();
  const display = new DotMatrixController({
    deviceName: process.env.LED_DEVICE_NAME ?? "CoolLEDUX-01DF",
    deviceId: process.env.LED_DEVICE_ID
  });
  const browserSettings = new BrowserSettingsService();

  const stopBackendRotation = () => {
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = undefined;
  };

  const scheduleBackendRotation = (delayMs = 0) => {
    stopBackendRotation();
    if (!display.isAutoSendEnabled() || rotationPaused || !display.isReadyToSend()) return;
    rotationTimer = setTimeout(() => {
      void tickBackendRotation();
    }, delayMs);
  };

  const tickBackendRotation = async () => {
    if (rotationTickInFlight || !display.isAutoSendEnabled() || rotationPaused || !display.isReadyToSend()) {
      scheduleBackendRotation(1000);
      return;
    }

    rotationTickInFlight = true;
    try {
      const [state, rotation] = await Promise.all([fetchNbaDisplayState(), rotationEngine.refresh()]);
      latestState = state;
      latestRotation = rotation;
      const card = rotationEngine.next() ?? rotation.activeCard;
      if (card) {
        rotation.activeCard = card;
        activeCardId = card.id;
        await display.sendCard(card);
      }
      latestRotation = { ...rotation, paused: rotationPaused };
    } catch (error) {
      console.warn("[Rotation] Backend auto-send tick failed", error instanceof Error ? error.message : error);
    } finally {
      rotationTickInFlight = false;
      const seconds = latestRotation?.rotationSeconds ?? 10;
      scheduleBackendRotation(Math.max(1, seconds) * 1000);
    }
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (url.pathname === "/api/rotation" || url.pathname === "/api/nba-score") {
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId, rotationPaused);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        activeCardId = handled.rotation.activeCard?.id;
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
        const handled = await handleScoreApi(response, display, rotationEngine, activeCardId === id && !enabled ? undefined : activeCardId, rotationPaused);
        latestState = handled.legacyState;
        latestRotation = handled.rotation;
        activeCardId = handled.rotation.activeCard?.id;
        scheduleBackendRotation();
        return;
      }

      if (url.pathname === "/api/rotation/pause" && request.method === "POST") {
        const body = await readJsonBody(request);
        rotationPaused = Boolean(body.paused);
        if (latestRotation) latestRotation = { ...latestRotation, paused: rotationPaused };
        if (rotationPaused) stopBackendRotation();
        else scheduleBackendRotation();
        sendJson(response, { paused: rotationPaused });
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
        sendJson(response, display.snapshot());
        return;
      }

      if (url.pathname === "/api/display/connect" && request.method === "POST") {
        const status = await display.connect();
        scheduleBackendRotation();
        sendJson(response, status);
        return;
      }

      if (url.pathname === "/api/display/disconnect" && request.method === "POST") {
        stopBackendRotation();
        sendJson(response, await display.disconnect());
        return;
      }

      if (url.pathname === "/api/display/send-current" && request.method === "POST") {
        const body = await readJsonBody(request);
        const cardId = typeof body.cardId === "string" ? body.cardId : undefined;
        const card = selectCard(latestRotation, cardId ?? activeCardId);
        if (card) {
          sendJson(response, await display.sendCard(card));
          return;
        }

        const mode = body.mode === "next_game" ? "next_game" : "live_score";
        const game = selectGameForMode(latestState, mode);
        if (!game) {
          response.writeHead(409, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "No display item has been fetched yet." }));
          return;
        }
        sendJson(response, await display.sendGame(game, mode));
        return;
      }

      if (url.pathname === "/api/display/auto-send" && request.method === "POST") {
        const body = await readJsonBody(request);
        const status = display.setAutoSend(Boolean(body.enabled));
        if (status.autoSend) scheduleBackendRotation();
        else stopBackendRotation();
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

  return {
    url: `http://localhost:${port}`,
    close: async () => {
      stopBackendRotation();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await vite?.close();
    }
  };
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
    sendJson(response, { ok: true });
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
  paused: boolean
): Promise<{ legacyState: NbaDisplayState; rotation: RotationDisplayState }> {
  const [state, rotation] = await Promise.all([fetchNbaDisplayState(), rotationEngine.refresh()]);
  if (preferredCardId) {
    const activeCard = rotationEngine.select(preferredCardId);
    if (activeCard) rotation.activeCard = activeCard;
  }
  rotation.paused = paused;
  const fallbackGame = state.currentGame ?? state.nextGame ?? noGameState();
  const payload = buildScoreResponse(state, fallbackGame, rotation);

  sendJson(response, payload);

  return { legacyState: state, rotation };
}

function buildScoreResponse(state: NbaDisplayState, fallbackGame: NormalizedGameScore, rotation: RotationDisplayState): NbaScoreResponse & { rotation: RotationDisplayState } {
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
