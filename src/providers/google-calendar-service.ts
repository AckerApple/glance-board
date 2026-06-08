import { randomBytes } from "node:crypto";
import { loadDisplayItemsConfig, saveDisplayItemsConfig } from "../rotation/display-config.js";
import { readJsonFile, removeJsonFile, writeJsonFile, loadLocalEnv } from "../server/local-config.js";
import { DisplayItemConfig, NormalizedCalendarEvent } from "../rotation/types.js";

const SETTINGS_FILE = "google-calendar.json";
const CREDENTIALS_FILE = "google-calendar-credentials.json";
const TOKEN_FILE = "google-calendar-token.json";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const CACHE_MS = 60_000;

interface GoogleCalendarSettings {
  calendarId?: string;
  calendarName?: string;
}

interface GoogleToken {
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

export class GoogleCalendarService {
  private eventCache = new Map<string, { expiresAt: number; events: NormalizedCalendarEvent[] }>();

  constructor(private readonly port: number) {}

  async status() {
    const credentials = await this.getCredentials();
    const token = await this.getToken();
    const settings = await this.getSettings();
    return {
      credentialsConfigured: credentials.missing.length === 0,
      missingCredentials: credentials.missing,
      authenticated: Boolean(token.refresh_token || token.access_token),
      selectedCalendarId: settings.calendarId,
      selectedCalendarName: settings.calendarName,
      readonlyScope: OAUTH_SCOPE,
      redirectUri: credentials.redirectUri,
      credentialsSource: credentials.source
    };
  }

  async buildAuthUrl(): Promise<string> {
    const credentials = await this.requireCredentials();
    const state = randomBytes(12).toString("hex");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", credentials.clientId!);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleCallback(code: string): Promise<void> {
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
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const token = (await response.json()) as GoogleToken & { error?: string; error_description?: string };
    if (!response.ok) throw new Error(token.error_description ?? token.error ?? `Google token exchange failed: HTTP ${response.status}`);
    await this.saveToken(withExpiry(token));
  }

  async logout(): Promise<void> {
    await removeJsonFile(TOKEN_FILE);
    this.eventCache.clear();
  }

  async listCalendars(): Promise<Array<{ id: string; summary: string; primary?: boolean }>> {
    const payload = await this.googleFetch<{ items?: Array<{ id: string; summary: string; primary?: boolean }> }>("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    return (payload.items ?? []).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summary,
      primary: calendar.primary
    }));
  }

  async saveSelectedCalendar(calendarId: string, calendarName?: string): Promise<GoogleCalendarSettings> {
    const settings = { calendarId, calendarName };
    await writeJsonFile(SETTINGS_FILE, settings);
    this.eventCache.clear();
    return settings;
  }

  async getUpcomingEvents(calendarId: string | undefined, limit = 3): Promise<NormalizedCalendarEvent[]> {
    const settings = await this.getSettings();
    const selectedCalendarId = calendarId ?? settings.calendarId;
    if (!selectedCalendarId) throw new NotConfiguredError("No Google Calendar selected");
    const cached = this.eventCache.get(selectedCalendarId);
    if (cached && cached.expiresAt > Date.now() && cached.events.length >= limit) return cached.events.slice(0, limit);

    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(selectedCalendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", new Date().toISOString());
    url.searchParams.set("maxResults", String(Math.max(10, limit)));
    const payload = await this.googleFetch<{ items?: unknown[] }>(url.toString());
    const events = (payload.items ?? []).map((event) => normalizeGoogleEvent(event, selectedCalendarId, settings.calendarName)).filter(Boolean) as NormalizedCalendarEvent[];
    this.eventCache.set(selectedCalendarId, { expiresAt: Date.now() + CACHE_MS, events });
    return events.slice(0, limit);
  }

  async installRotationItems(calendarId?: string): Promise<void> {
    const settings = await this.getSettings();
    const selectedCalendarId = calendarId ?? settings.calendarId ?? "primary";
    const config = await loadDisplayItemsConfig();
    const nextItems = buildGoogleCalendarRotationItems(selectedCalendarId);
    const nextIds = new Set(nextItems.map((item) => item.id));
    const merged = [...config.items.filter((item) => !nextIds.has(item.id)), ...nextItems];
    await saveDisplayItemsConfig({ ...config, items: merged });
  }

  async getSettings(): Promise<GoogleCalendarSettings> {
    return readJsonFile<GoogleCalendarSettings>(SETTINGS_FILE, {});
  }

  async saveCredentials(values: { clientId?: string; clientSecret?: string; redirectUri?: string }): Promise<void> {
    const clientId = values.clientId?.trim();
    const clientSecret = values.clientSecret?.trim();
    const redirectUri = values.redirectUri?.trim();
    if (!clientId || !clientSecret) throw new Error("Google Calendar client ID and client secret are required.");
    await writeJsonFile(CREDENTIALS_FILE, {
      clientId,
      clientSecret,
      redirectUri: redirectUri || `http://localhost:${this.port}/api/google-calendar/auth/callback`
    });
  }

  async getCredentials(): Promise<GoogleCalendarCredentials> {
    const env = await loadLocalEnv();
    const local = await readJsonFile<{ clientId?: string; clientSecret?: string; redirectUri?: string }>(CREDENTIALS_FILE, {});
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
    return readJsonFile<GoogleToken>(TOKEN_FILE, {});
  }

  private async saveToken(token: GoogleToken): Promise<void> {
    await writeJsonFile(TOKEN_FILE, token);
  }

  private async getAccessToken(): Promise<string> {
    const token = await this.getToken();
    if (token.access_token && token.expires_at && token.expires_at > Date.now() + 60_000) return token.access_token;
    if (!token.refresh_token) throw new NotConfiguredError("Google Calendar is not authenticated");
    const credentials = await this.requireCredentials();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId!,
        client_secret: credentials.clientSecret!,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token"
      })
    });
    const refreshed = (await response.json()) as GoogleToken & { error?: string; error_description?: string };
    if (!response.ok) throw new Error(refreshed.error_description ?? refreshed.error ?? `Google token refresh failed: HTTP ${response.status}`);
    const nextToken = { ...token, ...withExpiry(refreshed), refresh_token: token.refresh_token };
    await this.saveToken(nextToken);
    return nextToken.access_token!;
  }

  private async googleFetch<T>(url: string): Promise<T> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = typeof payload?.error?.message === "string" ? payload.error.message : `Google Calendar API returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  }
}

export function buildGoogleCalendarRotationItems(calendarId: string): DisplayItemConfig[] {
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
