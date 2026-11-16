import { ApiError, getJson, postJson } from "./api.js";
import { availableCards } from "./display-utils.js";
import {
  calendar$,
  hardware$,
  icloudCalendar$,
  rotation$,
  updateCalendar,
  updateHardware,
  updateICloudCalendar,
  updateLocation,
  updateRotation
} from "./state.js";
import type {
  CalendarEvent,
  CalendarOption,
  CalendarStatus,
  BrowserFormSettings,
  DisplayStatus,
  ICloudCalendarOption,
  ICloudCalendarStatus,
  LocationData,
  RotationPayload
} from "./types.js";

const POLL_INTERVAL_MS = 15_000;
const HARDWARE_STATUS_INTERVAL_MS = 5_000;
let stopped = false;
let pollTimer: number | undefined;
let hardwareStatusTimer: number | undefined;
let rotateTimer: number | undefined;
let progressTimer: number | undefined;
let rotationEvents: EventSource | undefined;
let rotateSeconds: number | undefined;
let rotateStartedAt = 0;

export const actions = {
  start,
  stop,
  showNextItem,
  toggleRotationPause,
  selectCard,
  setDisplaySeconds,
  setDisplayItemEnabled,
  setDisplayItemCategory,
  connectDisplay: () => runDisplayAction("/api/display/connect"),
  disconnectDisplay: () => runDisplayAction("/api/display/disconnect"),
  sendCurrent: () => runDisplayAction("/api/display/send-current", { cardId: rotation$[0]?.currentCardId }),
  setAutoSend,
  setIntensity,
  saveLocation,
  detectLocation,
  refreshCalendar,
  saveCalendarCredentials,
  signInCalendar: () => { window.location.href = "/api/google-calendar/auth/start"; },
  disconnectCalendar,
  cancelCalendarRequest,
  selectCalendar,
  installCalendarItems,
  hideGoogleCalendarItems,
  refreshICloudCalendar,
  connectICloudCalendar,
  disconnectICloudCalendar,
  selectICloudCalendar,
  installICloudCalendarItems
};

async function start(): Promise<void> {
  stopped = false;
  await Promise.all([refreshDisplayStatus(), refreshLocation(), refreshCalendar(), refreshICloudCalendar()]);
  startHardwareStatusPolling();
  await loadBrowserSettings();
  startRotationEvents();
  await pollRotation();
}

function stop(): void {
  stopped = true;
  if (pollTimer) window.clearTimeout(pollTimer);
  if (hardwareStatusTimer) window.clearInterval(hardwareStatusTimer);
  if (rotateTimer) window.clearInterval(rotateTimer);
  if (progressTimer) window.clearInterval(progressTimer);
  rotationEvents?.close();
  rotationEvents = undefined;
}

async function pollRotation(): Promise<void> {
  try {
    const payload = await getJson<RotationPayload>("/api/rotation");
    applyRotation(payload);
  } catch (error) {
    updateRotation({ error: errorMessage(error) });
  } finally {
    if (!stopped) pollTimer = window.setTimeout(pollRotation, POLL_INTERVAL_MS);
  }
}

async function refreshRotation(refreshCalendar = false, signal?: AbortSignal): Promise<void> {
  const payload = await getJson<RotationPayload>(refreshCalendar ? "/api/rotation?refresh=calendar" : "/api/rotation", signal);
  applyRotation(payload);
}

function withoutDisconnectedCalendars(payload: RotationPayload): RotationPayload {
  if (!payload.rotation) return payload;
  const rotation = payload.rotation;
  const cards = (rotation.cards ?? []).filter(card =>
    !(card.type === "google-calendar-next-event" && calendar$[0].status.authenticated === false) &&
    !(card.type === "icloud-calendar-next-event" && icloudCalendar$[0].status.connected === false));
  const activeCard = cards.find(card => card.id === rotation.activeCard?.id) ?? cards[0];
  return { ...payload, rotation: { ...payload.rotation, cards, activeCard } };
}

function clearDisconnectedRotation(): void {
  const payload = rotation$[0]?.payload;
  if (!payload) return;
  const next = withoutDisconnectedCalendars(payload);
  updateRotation({ payload: next, currentCardId: next.rotation?.cards?.find(card => card.id === rotation$[0].currentCardId)?.id ?? next.rotation?.activeCard?.id });
}

function applyRotation(payload: RotationPayload, options: { preferBackendActive?: boolean } = {}): void {
  payload = withoutDisconnectedCalendars(payload);
  const backendActiveId = payload.rotation?.activeCard?.id;
  const preferred = hardware$[0]?.autoSend || options.preferBackendActive ? backendActiveId : rotation$[0]?.currentCardId;
  const cards = availableCards(payload);
  const currentCardId = cards.some((card) => card.id === preferred)
    ? preferred
    : backendActiveId ?? cards[0]?.id;
  updateRotation({ payload, currentCardId, paused: Boolean(payload.rotation?.paused), error: undefined });
  restartRotation();
}

function startRotationEvents(): void {
  rotationEvents?.close();
  rotationEvents = new EventSource("/api/rotation/events");
  rotationEvents.addEventListener("rotation", (event) => {
    try {
      applyRotation(JSON.parse(event.data) as RotationPayload, { preferBackendActive: true });
    } catch (error) {
      updateRotation({ error: `Rotation stream failed: ${errorMessage(error)}` });
    }
  });
  rotationEvents.onerror = () => {
    updateRotation({ error: "Rotation stream disconnected; polling is still active" });
  };
}

function startHardwareStatusPolling(): void {
  if (hardwareStatusTimer) window.clearInterval(hardwareStatusTimer);
  hardwareStatusTimer = window.setInterval(() => {
    void refreshDisplayStatus();
  }, HARDWARE_STATUS_INTERVAL_MS);
}

function restartRotation(): void {
  const seconds = rotation$[0]?.payload?.rotation?.rotationSeconds ?? 5;
  if (rotation$[0]?.paused || hardware$[0]?.autoSend) {
    if (rotateTimer) window.clearInterval(rotateTimer);
    rotateTimer = undefined;
    rotateSeconds = undefined;
    stopProgressTimer();
    return;
  }
  if (rotateTimer && rotateSeconds === seconds) return;
  if (rotateTimer) window.clearInterval(rotateTimer);
  stopProgressTimer();
  rotateTimer = undefined;
  rotateSeconds = undefined;
  if (availableCards(rotation$[0]?.payload).length <= 1) {
    updateRotation({ progress: 1 });
    return;
  }
  rotateSeconds = seconds;
  resetRotationProgress();
  rotateTimer = window.setInterval(showNextItem, seconds * 1000);
  progressTimer = window.setInterval(updateRotationProgress, 200);
}

function showNextItem(): void {
  if (rotation$[0]?.paused) return;
  const cards = availableCards(rotation$[0]?.payload);
  if (cards.length <= 1) return;
  const index = cards.findIndex((card) => card.id === rotation$[0]?.currentCardId);
  updateRotation({ currentCardId: cards[(index + 1) % cards.length]?.id ?? cards[0]?.id, progress: 1 });
  resetRotationProgress();
}

async function toggleRotationPause(): Promise<void> {
  const paused = !rotation$[0]?.paused;
  updateRotation({ paused });
  restartRotation();
  try {
    const payload = await postJson<RotationPayload>("/api/rotation/pause", { paused });
    applyRotation(payload);
  } catch (error) {
    updateRotation({ error: `Pause failed: ${errorMessage(error)}` });
  }
}

async function setDisplaySeconds(seconds: number): Promise<void> {
  updateRotation({ error: undefined });
  try {
    const payload = await postJson<RotationPayload>("/api/rotation/display-seconds", { seconds });
    applyRotation(payload);
  } catch (error) {
    updateRotation({ error: `Display seconds save failed: ${errorMessage(error)}` });
  }
}

async function selectCard(id: string): Promise<void> {
  updateRotation({ currentCardId: id, progress: 1, error: undefined });
  resetRotationProgress();
  restartRotation();
  try {
    const payload = await postJson<RotationPayload>("/api/rotation/select", { cardId: id });
    applyRotation(payload);
    resetRotationProgress();
  } catch (error) {
    updateRotation({ error: `Show failed: ${errorMessage(error)}` });
  }
}

function resetRotationProgress(): void {
  rotateStartedAt = Date.now();
  updateRotation({ progress: 1 });
}

function updateRotationProgress(): void {
  if (!rotateSeconds || rotation$[0]?.paused) return;
  const elapsed = Date.now() - rotateStartedAt;
  const duration = rotateSeconds * 1000;
  updateRotation({ progress: Math.max(0, Math.min(1, 1 - elapsed / duration)) });
}

function stopProgressTimer(): void {
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = undefined;
}

async function setDisplayItemEnabled(id: string, enabled: boolean): Promise<void> {
  updateRotation({ error: undefined });
  try {
    const payload = await postJson<RotationPayload>("/api/rotation/items/enabled", { id, enabled });
    applyRotation(payload);
  } catch (error) {
    updateRotation({ error: `Item save failed: ${errorMessage(error)}` });
  }
}

async function setDisplayItemCategory(id: string, categoryId: string): Promise<void> {
  updateRotation({ error: undefined });
  try {
    const payload = await postJson<RotationPayload>("/api/rotation/items/category", { id, categoryId });
    applyRotation(payload);
  } catch (error) {
    updateRotation({ error: `Category save failed: ${errorMessage(error)}` });
  }
}

async function runDisplayAction(path: string, body?: unknown): Promise<void> {
  updateHardware({ busy: true });
  try {
    updateHardware({ status: await postJson<DisplayStatus>(path, body) });
  } catch (error) {
    updateHardware({ status: hardwareErrorStatus(error) });
  } finally {
    updateHardware({ busy: false });
  }
}

async function refreshDisplayStatus(): Promise<void> {
  try {
    const status = await getJson<DisplayStatus>("/api/display/status");
    updateHardware({ status, intensity: status.intensity ?? 1 });
  } catch (error) {
    updateHardware({ status: hardwareErrorStatus(error) });
  }
}

function setAutoSend(enabled: boolean): void {
  updateHardware({ autoSend: enabled });
  restartRotation();
  void saveBrowserSettings({ autoSendRotation: enabled });
  void runDisplayAction("/api/display/auto-send", { enabled });
}

function setIntensity(intensity: number, persist = false): void {
  updateHardware({ intensity });
  if (persist) {
    void saveBrowserSettings({ displayIntensity: intensity });
    void runDisplayAction("/api/display/intensity", { intensity });
  }
}

async function loadBrowserSettings(): Promise<void> {
  try {
    const settings = await getJson<BrowserFormSettings>("/api/browser-settings");
    updateHardware({
      autoSend: settings.autoSendRotation,
      intensity: settings.displayIntensity
    });
    void runDisplayAction("/api/display/auto-send", { enabled: settings.autoSendRotation });
  } catch {
    // Browser settings are optional; defaults remain in state.
  }
}

async function saveBrowserSettings(patch: Partial<BrowserFormSettings>): Promise<void> {
  try {
    const settings = await postJson<BrowserFormSettings>("/api/browser-settings", patch);
    updateHardware({
      autoSend: settings.autoSendRotation,
      intensity: settings.displayIntensity
    });
  } catch {
    // Manual control should keep working even if persistence fails.
  }
}

async function refreshLocation(): Promise<void> {
  try {
    const location = await getJson<LocationData>("/api/location");
    updateLocation({
      location,
      message: location.zip ? `Location: ZIP ${location.zip}` : "Location: not configured"
    });
  } catch (error) {
    updateLocation({ message: `Location unavailable: ${errorMessage(error)}` });
  }
}

async function saveLocation(zip: string): Promise<void> {
  updateLocation({ busy: true });
  try {
    const location = await postJson<LocationData>("/api/location", { zip });
    updateLocation({
      location,
      message: `Location: ${location.city}, ${location.state} ${location.zip}. Weather and gas updated.`
    });
    await refreshRotation();
  } catch (error) {
    updateLocation({ message: `Location update failed: ${errorMessage(error)}` });
  } finally {
    updateLocation({ busy: false });
  }
}

async function detectLocation(): Promise<void> {
  updateLocation({ busy: true, message: "Location: detecting from public IP..." });
  try {
    const location = await postJson<LocationData>("/api/location/detect");
    await saveLocation(location.zip ?? "");
  } catch (error) {
    updateLocation({ message: `Location detection failed: ${errorMessage(error)}`, busy: false });
  }
}

let calendarRequest: AbortController | undefined;

function cancelCalendarRequest(): void {
  calendarRequest?.abort();
  calendarRequest = undefined;
  updateCalendar({ busy: false, disconnecting: false, discoveryState: "idle", message: "Calendar request cancelled. Refresh to try again, or Disconnect to clear sign-in." });
}

async function runCalendarRequest(work: (request: AbortController) => Promise<void>, disconnecting = false): Promise<void> {
  calendarRequest?.abort();
  const request = new AbortController();
  calendarRequest = request;
  updateCalendar({ busy: true, disconnecting });
  try {
    await work(request);
  } catch (error) {
    if (calendarRequest === request) updateCalendar({ message: `Calendar request failed: ${errorMessage(error)}` });
  } finally {
    request.abort();
    if (calendarRequest === request) {
      calendarRequest = undefined;
      updateCalendar({ busy: false, disconnecting: false });
    }
  }
}

async function loadCalendar(request: AbortController): Promise<void> {
  const status = await getJson<CalendarStatus>("/api/google-calendar/status", request.signal);
  if (calendarRequest !== request) return;
  const message = calendarStatusMessage(status);
  // Publish auth before slower provider calls, so users can always disconnect.
  updateCalendar({ status, calendars: [], events: [], message, discoveryState: status.authenticated ? "loading" : "idle", discoveryError: undefined, setupUrl: undefined });
  if (!status.authenticated) return;
  let calendars: CalendarOption[];
  try {
    ({ calendars } = await getJson<{ calendars: CalendarOption[] }>("/api/google-calendar/calendars", request.signal));
  } catch (error) {
    if (calendarRequest === request) {
      let setupUrl: string | undefined;
      if (error instanceof ApiError && error.code === "api_disabled" && error.setupUrl) {
        try {
          const link = new URL(error.setupUrl);
          if (link.origin === "https://console.cloud.google.com" && link.pathname === "/apis/library/calendar-json.googleapis.com") setupUrl = link.href;
        } catch { /* Ignore untrusted links. */ }
      }
      updateCalendar({ discoveryState: "error", discoveryError: errorMessage(error), setupUrl });
    }
    throw error;
  }
  if (calendarRequest !== request) return;
  updateCalendar({ calendars, discoveryState: "ready", message: calendars.length ? status.selectedCalendarId ? message : "Connected to Google. Choose a calendar below, then preview it or add it to your display." : "Google returned no available calendars. Check the connected account or reconnect with another account." });
  if (!status.selectedCalendarId) return;
  const { events } = await getJson<{ events: CalendarEvent[] }>(calendarEventsUrl(), request.signal);
  if (calendarRequest === request) updateCalendar({ events, message });
}

async function refreshCalendar(): Promise<void> {
  await runCalendarRequest(loadCalendar);
}

async function saveCalendarCredentials(values: { clientId: string; clientSecret: string; redirectUri: string }): Promise<void> {
  await runCalendarRequest(async request => {
    const status = await postJson<CalendarStatus>("/api/google-calendar/credentials", values, request.signal);
    if (calendarRequest === request) updateCalendar({ status, message: "Google connection setup saved. You can now choose Connect Google Calendar." });
  });
}

async function disconnectCalendar(): Promise<void> {
  await runCalendarRequest(async request => {
    const status = await postJson<CalendarStatus>("/api/google-calendar/auth/logout", undefined, request.signal);
    if (calendarRequest === request) {
      updateCalendar({ status: { ...status, authenticated: false }, calendars: [], events: [], discoveryState: "idle", discoveryError: undefined, setupUrl: undefined, message: "Google Calendar disconnected. Its events have been removed from rotation." });
      clearDisconnectedRotation();
    }
  }, true);
}

async function selectCalendar(calendarId: string | string[], calendarName?: string): Promise<void> {
  await runCalendarRequest(async request => {
    await postJson("/api/google-calendar/selected-calendar", { ...(Array.isArray(calendarId) ? { calendarIds: calendarId } : { calendarId }), calendarName }, request.signal);
    if (calendarRequest === request) await loadCalendar(request);
    if (calendarRequest === request) await refreshRotation(true, request.signal);
  });
}

async function installCalendarItems(calendarId?: string): Promise<void> {
  await runCalendarRequest(async request => {
    const selected = calendar$[0]?.calendars.find(calendar => calendar.id === calendarId);
    if (calendarId !== undefined) await postJson("/api/google-calendar/selected-calendar", { calendarId, calendarName: selected?.summary }, request.signal);
    if (calendarRequest !== request) return;
    await postJson("/api/google-calendar/install-rotation-items", { calendarId }, request.signal);
    if (calendarRequest !== request) return;
    await loadCalendar(request);
    if (calendarRequest !== request) return;
    await refreshRotation(false, request.signal);
    if (calendarRequest === request) updateCalendar({ message: "Google Calendar is now showing on your Glance Board." });
  });
}

async function hideGoogleCalendarItems(): Promise<void> {
  await runCalendarRequest(async request => {
    const status = await postJson<CalendarStatus>("/api/google-calendar/hide-from-display", undefined, request.signal);
    if (calendarRequest !== request) return;
    updateCalendar({ status, message: "Google Calendar is hidden from your board. Your Google account remains connected." });
    await refreshRotation(false, request.signal);
  });
}

let icloudRequestVersion = 0;

async function refreshICloudCalendar(): Promise<void> {
  const version = ++icloudRequestVersion;
  updateICloudCalendar({ busy: true });
  try {
    const status = await getJson<ICloudCalendarStatus>("/api/calendar/icloud/status");
    if (version !== icloudRequestVersion) return;
    updateICloudCalendar({ status });
    if (!status.connected) {
      updateICloudCalendar({
        status,
        calendars: [],
        events: [],
        message: "iCloud Calendar: not connected."
      });
      return;
    }

    const [{ calendars }, { events }] = await Promise.all([
      getJson<{ calendars: ICloudCalendarOption[] }>("/api/calendar/icloud/calendars"),
      status.selectedCalendarId
        ? getJson<{ events: CalendarEvent[] }>(icloudEventsUrl(undefined, status.eventShowCount ?? 3, true))
        : Promise.resolve({ events: [] })
    ]);
    if (version !== icloudRequestVersion) return;
    await refreshRotation(true);
    if (version !== icloudRequestVersion) return;
    updateICloudCalendar({
      status,
      calendars,
      events,
      message: status.selectedCalendarIds?.length
        ? `iCloud Calendar: connected. ${status.selectedCalendarIds.length} calendars selected.`
        : status.selectedCalendarName ? `iCloud Calendar: connected. Selected: ${status.selectedCalendarName}.` : "iCloud Calendar: connected. Select calendars."
    });
  } catch (error) {
    if (version !== icloudRequestVersion) return;
    updateICloudCalendar({ message: `iCloud Calendar unavailable: ${errorMessage(error)}` });
  } finally {
    if (version === icloudRequestVersion) updateICloudCalendar({ busy: false });
  }
}

async function connectICloudCalendar(values: { appleId: string; appSpecificPassword: string }): Promise<void> {
  updateICloudCalendar({ busy: true, message: "iCloud Calendar: connecting..." });
  try {
    const payload = await postJson<{
      status: ICloudCalendarStatus;
      calendars: ICloudCalendarOption[];
    }>("/api/calendar/icloud/connect", values);
    updateICloudCalendar({
      status: payload.status,
      calendars: payload.calendars,
      events: [],
      message: "iCloud Calendar: connected. Select a calendar."
    });
  } catch (error) {
    updateICloudCalendar({ message: `iCloud Calendar connection failed: ${errorMessage(error)}` });
  } finally {
    updateICloudCalendar({ busy: false });
  }
}

async function disconnectICloudCalendar(): Promise<void> {
  ++icloudRequestVersion;
  updateICloudCalendar({ busy: true });
  try {
    const status = await postJson<ICloudCalendarStatus>("/api/calendar/icloud/disconnect");
    updateICloudCalendar({
      status: { ...status, connected: false },
      calendars: [],
      events: [],
      message: "iCloud Calendar: disconnected. Its events have been removed from rotation."
    });
    clearDisconnectedRotation();
  } catch (error) {
    updateICloudCalendar({ message: `iCloud Calendar disconnect failed: ${errorMessage(error)}` });
  } finally {
    updateICloudCalendar({ busy: false });
  }
}

async function selectICloudCalendar(calendarId: string | string[], calendarName?: string, eventShowCount = 3): Promise<void> {
  updateICloudCalendar({ busy: true });
  try {
    await postJson("/api/calendar/icloud/selected-calendar", { ...(Array.isArray(calendarId) ? { calendarIds: calendarId } : { calendarId }), calendarName, eventShowCount });
    await refreshICloudCalendar();
  } catch (error) {
    updateICloudCalendar({ message: `iCloud Calendar selection failed: ${errorMessage(error)}`, busy: false });
  }
}

async function installICloudCalendarItems(calendarId?: string, eventShowCount = 3): Promise<void> {
  updateICloudCalendar({ busy: true });
  try {
    const payload = await postJson<{ status?: ICloudCalendarStatus }>("/api/calendar/icloud/install-rotation-items", { calendarId, eventShowCount });
    await refreshRotation();
    updateICloudCalendar({
      status: payload.status ?? icloudCalendar$[0]?.status ?? {},
      message: "iCloud Calendar rotation items installed."
    });
  } catch (error) {
    updateICloudCalendar({ message: `iCloud rotation install failed: ${errorMessage(error)}` });
  } finally {
    updateICloudCalendar({ busy: false });
  }
}

function calendarEventsUrl(calendarId?: string): string {
  return calendarId
    ? `/api/google-calendar/events?calendarId=${encodeURIComponent(calendarId)}&limit=3`
    : "/api/google-calendar/events?limit=3";
}

function icloudEventsUrl(calendarId: string | undefined, limit: number, refresh = false): string {
  const refreshParam = refresh ? "&refresh=1" : "";
  return `/api/calendar/icloud/events?${calendarId ? `calendarId=${encodeURIComponent(calendarId)}&` : ""}limit=${encodeURIComponent(String(limit))}${refreshParam}`;
}

function calendarStatusMessage(status: CalendarStatus): string {
  if (!status.credentialsConfigured) return "Google sign-in isn’t enabled on this board yet. Contact the board owner.";
  if (!status.authenticated) return "Ready to connect. Choose Connect Google Calendar and approve read-only calendar access on Google.";
  const selected = status.selectedCalendarIds?.length ? `${status.selectedCalendarIds.length} calendars` : status.selectedCalendarName ?? status.selectedCalendarId ?? "none selected";
  const source = status.credentialsSource === "local-file" ? "local credentials file" : "environment";
  return `Calendar: connected using ${source}. Selected: ${selected}.`;
}

function hardwareErrorStatus(error: unknown): DisplayStatus {
  return {
    status: "error",
    deviceName: hardware$[0]?.status?.deviceName ?? "unknown",
    autoSend: hardware$[0]?.autoSend ?? false,
    intensity: hardware$[0]?.intensity ?? 1,
    lastMessage: errorMessage(error)
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
