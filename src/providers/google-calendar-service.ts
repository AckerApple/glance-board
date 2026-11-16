import { calendarSelection, combineCalendarEvents } from "./calendar-selection.js";
import { normalizeCalendarColor } from "../matrix/color.js";
import { CalendarRequestError, googleCalendarRequestError } from "./calendar-error.js";
import { GoogleSignInSession } from "./google-calendar-auth.js";
import { loadDisplayItemsConfig, saveDisplayItemsConfig } from "../rotation/display-config.js";
import { readJsonFile, removeJsonFile, writeJsonFile, loadLocalEnv } from "../server/local-config.js";
import { DisplayItemConfig, DisplayItemsConfig, NormalizedCalendarEvent } from "../rotation/types.js";

const SETTINGS_FILE = "google-calendar.json";
const CREDENTIALS_FILE = "google-calendar-credentials.json";
const TOKEN_FILE = "google-calendar-token.json";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const CACHE_MS = 60_000;

interface GoogleCalendarSettings {
  calendarId?: string;
  calendarIds?: string[];
  calendarName?: string;
}

interface GoogleToken {
  accountEmail?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  scope?: string;
}

interface GoogleCalendarCredentials {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  missing: string[];
  source: "env" | "local-file" | "missing";
}

export interface GoogleCalendarStorage {
  read<T>(fileName: string, fallback: T): Promise<T>;
  write(fileName: string, value: unknown): Promise<void>;
  remove(fileName: string): Promise<void>;
  loadDisplayConfig(): Promise<DisplayItemsConfig>;
  saveDisplayConfig(config: DisplayItemsConfig): Promise<void>;
}

const defaultGoogleStorage: GoogleCalendarStorage = { read: readJsonFile, write: writeJsonFile, remove: removeJsonFile, loadDisplayConfig: loadDisplayItemsConfig, saveDisplayConfig: saveDisplayItemsConfig };
interface GoogleTokenState {
  signIn: GoogleSignInSession;
  changes: Promise<void>;
  caches: Set<Map<string, { expiresAt: number; events: NormalizedCalendarEvent[] }>>;
}
const googleTokenStates = new WeakMap<GoogleCalendarStorage, GoogleTokenState>();

export class GoogleCalendarService {
  private readonly tokenState: GoogleTokenState;
  private get signIn() { return this.tokenState.signIn; }
  private eventCache = new Map<string, { expiresAt: number; events: NormalizedCalendarEvent[] }>();

  constructor(private readonly port: number, private readonly storage: GoogleCalendarStorage = defaultGoogleStorage) {
    let state = googleTokenStates.get(storage);
    if (!state) {
      state = { signIn: new GoogleSignInSession(), changes: Promise.resolve(), caches: new Set() };
      googleTokenStates.set(storage, state);
    }
    this.tokenState = state;
    state.caches.add(this.eventCache);
  }

  async status() {
    const credentials = await this.getCredentials();
    const token = await this.getToken();
    const settings = await this.getSettings();
    const display = await this.storage.loadDisplayConfig();
    return {
      displayEnabled: display.items.some(item => item.type === "google-calendar-next-event" && item.enabled),
      credentialsConfigured: credentials.missing.length === 0,
      missingCredentials: credentials.missing,
      authenticated: Boolean(token.refresh_token || token.access_token),
      accountEmail: token.refresh_token || token.access_token ? token.accountEmail : undefined,
      selectedCalendarId: settings.calendarId,
      selectedCalendarIds: calendarSelection(settings.calendarIds ?? settings.calendarId),
      selectedCalendarName: settings.calendarName,
      readonlyScope: OAUTH_SCOPE,
      redirectUri: credentials.redirectUri,
      credentialsSource: credentials.source
    };
  }

  async buildAuthUrl(): Promise<string> {
    const credentials = await this.requireCredentials();
    const state = this.signIn.begin();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", credentials.clientId!);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", `openid email ${OAUTH_SCOPE}`);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleCallback(code: string, state?: string): Promise<void> {
    const generation = this.signIn.consume(state);
    const credentials = await this.requireCredentials();
    const body = new URLSearchParams({
      code,
      client_id: credentials.clientId!,
      client_secret: credentials.clientSecret!,
      redirect_uri: credentials.redirectUri,
      grant_type: "authorization_code"
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const token = (await response.json().catch(() => { throw new Error("Google returned an unreadable sign-in response. Please connect again."); })) as GoogleToken;
    if (!response.ok) throw new Error("Google could not complete sign-in. Check your OAuth client setup and try connecting again.");
    if (!token.access_token || !token.refresh_token) throw new Error("Google did not grant continuing calendar access. Reconnect and approve Calendar access; if needed, remove this app in Google account connections first.");
    if (token.scope && !token.scope.split(" ").some(scope => scope === OAUTH_SCOPE || scope === "https://www.googleapis.com/auth/calendar")) {
      throw new Error("Calendar permission was not granted. Reconnect and approve read-only Calendar access.");
    }
    // Request identity only to display which account is connected. Calendar access
    // remains read-only. Identity lookup failure must not discard a valid grant.
    if (token.scope?.split(" ").some(scope => scope === "email" || scope === "https://www.googleapis.com/auth/userinfo.email")) {
      token.accountEmail = await this.accountEmail(token.access_token);
    }
    await this.changeToken(async () => {
      this.signIn.assertCurrent(generation);
      await this.saveToken(withExpiry(token));
    });
  }

  async logout(): Promise<void> {
    this.signIn.cancel();
    await this.changeToken(() => this.storage.remove(TOKEN_FILE));
    for (const cache of this.tokenState.caches) cache.clear();
  }

  async listCalendars(): Promise<Array<{ id: string; summary: string; primary?: boolean }>> {
    const payload = await this.googleFetch<{ items?: Array<{ id: string; summary: string; primary?: boolean }> }>("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    return (payload.items ?? []).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summary,
      primary: calendar.primary
    }));
  }

  async saveSelectedCalendar(selection: string | string[], calendarName?: string): Promise<GoogleCalendarSettings> {
    const ids = calendarSelection(selection);
    const calendarId = ids[0];
    const settings: GoogleCalendarSettings = Array.isArray(selection)
      ? { calendarIds: ids, calendarId, calendarName }
      : { calendarId, calendarName };
    await this.storage.write(SETTINGS_FILE, settings);
    const config = await this.storage.loadDisplayConfig();
    if (config.items.some(item => item.type === "google-calendar-next-event")) {
      await this.storage.saveDisplayConfig({ ...config, items: config.items.map(item => item.type === "google-calendar-next-event" ? { ...item, calendarId: Array.isArray(selection) ? undefined : calendarId } : item) });
    }
    for (const cache of this.tokenState.caches) cache.clear();
    return settings;
  }

  async getUpcomingEvents(calendarId: string | undefined, limit = 3): Promise<NormalizedCalendarEvent[]> {
    const settings = await this.getSettings();
    const ids = calendarSelection(calendarId ?? settings.calendarIds ?? settings.calendarId);
    if (!ids.length) throw new NotConfiguredError("No Google Calendar selected");
    return combineCalendarEvents(await Promise.all(ids.map(id => this.getCalendarEvents(id, limit, id === settings.calendarId ? settings.calendarName : undefined))), limit);
  }

  private async getCalendarEvents(selectedCalendarId: string, limit: number, calendarName?: string): Promise<NormalizedCalendarEvent[]> {
    const generation = this.signIn.version;
    const cached = this.eventCache.get(selectedCalendarId);
    if (cached && cached.expiresAt > Date.now() && cached.events.length >= limit) return combineCalendarEvents([cached.events], limit);

    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(selectedCalendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", new Date().toISOString());
    url.searchParams.set("maxResults", String(Math.max(10, limit)));
    const payload = await this.googleFetch<{ items?: unknown[] }>(url.toString());
    // CalendarList contains the user's assigned color (event color overrides are ignored).
    const calendar = await this.googleFetch<{ backgroundColor?: string; summary?: string }>(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(selectedCalendarId)}`
    ).catch(() => undefined);
    const events = (payload.items ?? []).map((event) => normalizeGoogleEvent(event, selectedCalendarId, calendar?.summary ?? calendarName)).filter(Boolean) as NormalizedCalendarEvent[];
    for (const event of events) event.calendarColor = normalizeCalendarColor(calendar?.backgroundColor);
    this.signIn.assertCurrent(generation);
    this.eventCache.set(selectedCalendarId, { expiresAt: Date.now() + CACHE_MS, events });
    return combineCalendarEvents([events], limit);
  }

  async installRotationItems(calendarId?: string): Promise<void> {
    const settings = await this.getSettings();
    const ids = calendarSelection(calendarId ?? settings.calendarIds ?? settings.calendarId ?? "primary");
    if (!ids.length) throw new NotConfiguredError("No Google Calendar selected");
    const selectedCalendarId = calendarId === undefined && settings.calendarIds !== undefined ? undefined : ids[0];
    const config = await this.storage.loadDisplayConfig();
    const nextItems = buildGoogleCalendarRotationItems(selectedCalendarId);
    const nextIds = new Set(nextItems.map((item) => item.id));
    const merged = [...config.items.filter((item) => !nextIds.has(item.id)), ...nextItems];
    await this.storage.saveDisplayConfig({ ...config, items: merged });
  }

  async hideFromDisplay(): Promise<void> {
    const config = await this.storage.loadDisplayConfig();
    await this.storage.saveDisplayConfig({ ...config, items: config.items.map(item => item.type === "google-calendar-next-event" ? { ...item, enabled: false } : item) });
  }

  async getSettings(): Promise<GoogleCalendarSettings> {
    return this.storage.read<GoogleCalendarSettings>(SETTINGS_FILE, {});
  }

  async saveCredentials(values: { clientId?: string; clientSecret?: string; redirectUri?: string }): Promise<void> {
    const clientId = values.clientId?.trim();
    const clientSecret = values.clientSecret?.trim();
    const redirectUri = values.redirectUri?.trim();
    if (!clientId || !clientSecret) throw new Error("Google Calendar client ID and client secret are required.");
    await this.storage.write(CREDENTIALS_FILE, {
      clientId,
      clientSecret,
      redirectUri: redirectUri || `http://localhost:${this.port}/api/google-calendar/auth/callback`
    });
  }

  async getCredentials(): Promise<GoogleCalendarCredentials> {
    const env = await loadLocalEnv();
    const local = await this.storage.read<{ clientId?: string; clientSecret?: string; redirectUri?: string }>(CREDENTIALS_FILE, {});
    const envClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? env.GOOGLE_CALENDAR_CLIENT_ID;
    const envClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const envRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? env.GOOGLE_CALENDAR_REDIRECT_URI;
    const clientId = envClientId ?? local.clientId;
    const clientSecret = envClientSecret ?? local.clientSecret;
    const redirectUri = envRedirectUri ?? local.redirectUri ?? `http://localhost:${this.port}/api/google-calendar/auth/callback`;
    const missing = [
      !clientId ? "GOOGLE_CALENDAR_CLIENT_ID" : undefined,
      !clientSecret ? "GOOGLE_CALENDAR_CLIENT_SECRET" : undefined
    ].filter(Boolean) as string[];
    const source = envClientId || envClientSecret ? "env" : local.clientId || local.clientSecret ? "local-file" : "missing";
    return { clientId, clientSecret, redirectUri, missing, source };
  }

  private async requireCredentials(): Promise<GoogleCalendarCredentials> {
    const credentials = await this.getCredentials();
    if (credentials.missing.length > 0) throw new NotConfiguredError(`Missing Google Calendar credentials: ${credentials.missing.join(", ")}`);
    return credentials;
  }

  private async getToken(): Promise<GoogleToken> {
    return this.storage.read<GoogleToken>(TOKEN_FILE, {});
  }

  private async saveToken(token: GoogleToken): Promise<void> {
    await this.storage.write(TOKEN_FILE, token);
  }

  private changeToken(work: () => Promise<void>): Promise<void> {
    const next = this.tokenState.changes.then(work, work);
    this.tokenState.changes = next.catch(() => undefined);
    return next;
  }

  private async getAccessToken(): Promise<string> {
    const generation = this.signIn.version;
    const token = await this.getToken();
    if (token.access_token && token.expires_at && token.expires_at > Date.now() + 60_000) return token.access_token;
    if (!token.refresh_token) throw new NotConfiguredError("Google Calendar is not authenticated");
    const credentials = await this.requireCredentials();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId!,
        client_secret: credentials.clientSecret!,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token"
      })
    });
    const refreshed = (await response.json().catch(() => {
      throw new CalendarRequestError(response.status);
    })) as GoogleToken & { error?: string };
    if (!response.ok) throw new CalendarRequestError(response.status, refreshed.error);
    const nextToken = { ...token, ...withExpiry(refreshed), refresh_token: token.refresh_token };
    await this.changeToken(async () => {
      this.signIn.assertCurrent(generation);
      await this.saveToken(nextToken);
    });
    return nextToken.access_token!;
  }

  private async accountEmail(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) return undefined;
      const identity = await response.json() as { email?: unknown; email_verified?: unknown };
      return identity.email_verified === true && typeof identity.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email) ? identity.email : undefined;
    } catch { return undefined; }
  }

  private async googleFetch<T>(url: string): Promise<T> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    });
    if (!response.ok) throw googleCalendarRequestError(response.status, await response.json().catch(() => undefined));
    const payload = await response.json();
    return payload as T;
  }
}

export function buildGoogleCalendarRotationItems(calendarId?: string): DisplayItemConfig[] {
  return [0, 1, 2].map((eventIndex) => ({
    id: `google-calendar-next-${eventIndex + 1}`,
    enabled: true,
    type: "google-calendar-next-event",
    calendarId,
    eventIndex
  }));
}

export class NotConfiguredError extends Error {
  readonly isNotConfigured = true;
}

function withExpiry(token: GoogleToken): GoogleToken {
  return {
    ...token,
    expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : token.expires_at
  };
}

function normalizeGoogleEvent(event: unknown, calendarId: string, calendarName?: string): NormalizedCalendarEvent | undefined {
  if (!isRecord(event)) return undefined;
  const start = isRecord(event.start) ? event.start : {};
  const end = isRecord(event.end) ? event.end : {};
  const startTime = asString(start.dateTime) ?? asString(start.date);
  if (!startTime) return undefined;
  return {
    id: asString(event.id) ?? `${calendarId}-${startTime}`,
    provider: "google",
    calendarId,
    calendarName,
    title: asString(event.summary) ?? "Untitled",
    startTime,
    endTime: asString(end.dateTime) ?? asString(end.date),
    isAllDay: Boolean(asString(start.date) && !asString(start.dateTime)),
    location: asString(event.location),
    description: asString(event.description),
    htmlLink: asString(event.htmlLink)
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
