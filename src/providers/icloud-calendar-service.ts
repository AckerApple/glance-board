import { CalDAVClient, Calendar, Event, RecurrenceRule } from "ts-caldav";
import { loadDisplayItemsConfig, saveDisplayItemsConfig } from "../rotation/display-config.js";
import { DisplayItemConfig, DisplayItemsConfig, NormalizedCalendarEvent } from "../rotation/types.js";
import { readJsonFile, removeJsonFile, writeJsonFile } from "../server/local-config.js";

const SETTINGS_FILE = "icloud-calendar.json";
const CREDENTIALS_FILE = "icloud-calendar-credentials.json";
const ICLOUD_CALDAV_URL = "https://caldav.icloud.com/";
const CACHE_MS = 60_000;
const FETCH_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;

interface ICloudCalendarCredentials {
  appleId?: string;
  appSpecificPassword?: string;
}

interface ICloudCalendarSettings {
  provider?: "icloud";
  calendarId?: string;
  calendarName?: string;
  eventShowCount?: number;
}

interface ICloudCalendarOption {
  id: string;
  summary: string;
  color?: string;
}

interface CalDavClientLike {
  getCalendars(): Promise<Calendar[]>;
  getEvents(calendarUrl: string, options?: { start?: Date; end?: Date; all?: boolean }): Promise<Event[]>;
}

export interface ICloudCalendarStorage {
  read<T>(fileName: string, fallback: T): Promise<T>;
  write(fileName: string, value: unknown): Promise<void>;
  remove(fileName: string): Promise<void>;
  loadDisplayConfig(): Promise<DisplayItemsConfig>;
  saveDisplayConfig(config: DisplayItemsConfig): Promise<void>;
}

export interface ICloudCalendarServiceOptions {
  createClient?: (credentials: Required<ICloudCalendarCredentials>) => Promise<CalDavClientLike>;
  storage?: ICloudCalendarStorage;
  now?: () => Date;
}

const defaultStorage: ICloudCalendarStorage = {
  read: readJsonFile,
  write: writeJsonFile,
  remove: removeJsonFile,
  loadDisplayConfig: loadDisplayItemsConfig,
  saveDisplayConfig: saveDisplayItemsConfig
};

export class ICloudCalendarService {
  private client?: CalDavClientLike;
  private eventCache = new Map<string, { expiresAt: number; events: NormalizedCalendarEvent[] }>();
  private readonly createClient: NonNullable<ICloudCalendarServiceOptions["createClient"]>;
  private readonly storage: ICloudCalendarStorage;
  private readonly now: () => Date;

  constructor(options: ICloudCalendarServiceOptions = {}) {
    this.createClient = options.createClient ?? createICloudClient;
    this.storage = options.storage ?? defaultStorage;
    this.now = options.now ?? (() => new Date());
  }

  async status() {
    const credentials = await this.getCredentials();
    const settings = await this.getSettings();
    return {
      credentialsConfigured: Boolean(credentials.appleId && credentials.appSpecificPassword),
      connected: Boolean(credentials.appleId && credentials.appSpecificPassword),
      selectedCalendarId: settings.calendarId,
      selectedCalendarName: settings.calendarName,
      eventShowCount: normalizeEventShowCount(settings.eventShowCount),
      provider: "icloud" as const
    };
  }

  async connect(values: { appleId?: string; appSpecificPassword?: string }): Promise<ICloudCalendarOption[]> {
    const credentials = normalizeCredentials(values);
    const client = await this.createClient(credentials);
    const calendars = normalizeCalendars(await client.getCalendars());
    await this.storage.write(CREDENTIALS_FILE, credentials);
    this.client = client;
    this.eventCache.clear();
    return calendars;
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.storage.remove(CREDENTIALS_FILE),
      this.storage.remove(SETTINGS_FILE)
    ]);
    this.client = undefined;
    this.eventCache.clear();
  }

  async listCalendars(): Promise<ICloudCalendarOption[]> {
    const client = await this.getClient();
    return normalizeCalendars(await client.getCalendars());
  }

  async saveSelectedCalendar(calendarId: string, calendarName?: string, eventShowCount?: number): Promise<ICloudCalendarSettings> {
    if (!calendarId.trim()) throw new Error("calendarId is required");
    const current = await this.getSettings();
    const settings: ICloudCalendarSettings = {
      provider: "icloud",
      calendarId: calendarId.trim(),
      calendarName: calendarName?.trim() || undefined,
      eventShowCount: normalizeEventShowCount(eventShowCount ?? current.eventShowCount)
    };
    await this.storage.write(SETTINGS_FILE, settings);
    this.eventCache.clear();
    return settings;
  }

  async getUpcomingEvents(calendarId: string | undefined, limit = 3): Promise<NormalizedCalendarEvent[]> {
    const settings = await this.getSettings();
    const selectedCalendarId = calendarId ?? settings.calendarId;
    if (!selectedCalendarId) throw new ICloudNotConfiguredError("No iCloud Calendar selected");

    const cached = this.eventCache.get(selectedCalendarId);
    if (cached && cached.expiresAt > Date.now() && cached.events.length >= limit) {
      return cached.events.slice(0, limit);
    }

    const start = this.now();
    const end = new Date(start.getTime() + FETCH_WINDOW_MS);
    const client = await this.getClient();
    const rawEvents = await client.getEvents(selectedCalendarId, { start, end, all: false });
    const events = rawEvents
      .filter((event) => event.status !== "CANCELLED")
      .flatMap((event) => normalizeICloudOccurrences(event, selectedCalendarId, settings.calendarName, start, end))
      .filter((event) => eventStart(event) >= start.getTime())
      .sort((left, right) => eventStart(left) - eventStart(right));
    this.eventCache.set(selectedCalendarId, { expiresAt: Date.now() + CACHE_MS, events });
    return events.slice(0, limit);
  }

  async installRotationItems(calendarId?: string, eventShowCount?: number): Promise<void> {
    const settings = await this.getSettings();
    const selectedCalendarId = calendarId ?? settings.calendarId;
    if (!selectedCalendarId) throw new ICloudNotConfiguredError("No iCloud Calendar selected");
    const count = normalizeEventShowCount(eventShowCount ?? settings.eventShowCount);
    const config = await this.storage.loadDisplayConfig();
    const nextItems: DisplayItemConfig[] = Array.from({ length: count }, (_, eventIndex) => ({
      id: `icloud-calendar-next-${eventIndex + 1}`,
      enabled: true,
      type: "icloud-calendar-next-event",
      calendarId: selectedCalendarId,
      eventIndex
    }));
    const merged = [...config.items.filter((item) => !/^icloud-calendar-next-\d+$/.test(item.id)), ...nextItems];
    await this.storage.saveDisplayConfig({ ...config, items: merged });
  }

  private async getClient(): Promise<CalDavClientLike> {
    if (this.client) return this.client;
    const credentials = normalizeCredentials(await this.getCredentials());
    this.client = await this.createClient(credentials);
    return this.client;
  }

  private async getCredentials(): Promise<ICloudCalendarCredentials> {
    return this.storage.read<ICloudCalendarCredentials>(CREDENTIALS_FILE, {});
  }

  private async getSettings(): Promise<ICloudCalendarSettings> {
    return this.storage.read<ICloudCalendarSettings>(SETTINGS_FILE, {});
  }
}

export class ICloudNotConfiguredError extends Error {
  readonly isNotConfigured = true;
}

async function createICloudClient(credentials: Required<ICloudCalendarCredentials>): Promise<CalDavClientLike> {
  return CalDAVClient.create({
    baseUrl: ICLOUD_CALDAV_URL,
    auth: {
      type: "basic",
      username: credentials.appleId,
      password: credentials.appSpecificPassword
    }
  });
}

function normalizeCredentials(values: ICloudCalendarCredentials): Required<ICloudCalendarCredentials> {
  const appleId = values.appleId?.trim();
  const appSpecificPassword = values.appSpecificPassword?.trim();
  if (!appleId || !appSpecificPassword) {
    throw new ICloudNotConfiguredError("Apple ID and app-specific password are required");
  }
  return { appleId, appSpecificPassword };
}

function normalizeEventShowCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return 3;
  return Math.max(1, Math.min(10, Math.trunc(count)));
}

export function normalizeCalendars(calendars: Calendar[]): ICloudCalendarOption[] {
  return calendars
    .filter((calendar) => calendar.supportedComponents.includes("VEVENT"))
    .map((calendar) => ({
      id: calendar.url,
      summary: calendar.displayName || "Untitled Calendar",
      color: calendar.color
    }));
}

export function normalizeICloudEvent(
  event: Event,
  calendarId: string,
  calendarName?: string
): NormalizedCalendarEvent {
  return {
    id: event.uid || `${calendarId}-${event.start.toISOString()}`,
    provider: "icloud",
    calendarId,
    calendarName,
    title: event.summary || "Untitled",
    startTime: event.wholeDay ? formatLocalDate(event.start) : event.start.toISOString(),
    endTime: event.wholeDay ? formatLocalDate(event.end) : event.end.toISOString(),
    isAllDay: Boolean(event.wholeDay),
    location: event.location,
    description: event.description,
    htmlLink: event.href
  };
}

export function normalizeICloudOccurrences(
  event: Event,
  calendarId: string,
  calendarName: string | undefined,
  windowStart: Date,
  windowEnd: Date
): NormalizedCalendarEvent[] {
  if (!event.recurrenceRule?.freq) {
    return [normalizeICloudEvent(event, calendarId, calendarName)];
  }

  const starts = expandRecurrenceStarts(event.start, event.recurrenceRule, windowStart, windowEnd);
  const duration = Math.max(0, event.end.getTime() - event.start.getTime());
  return starts.map((start) => {
    const occurrence = {
      ...event,
      uid: `${event.uid}-${start.toISOString()}`,
      start,
      end: new Date(start.getTime() + duration),
      recurrenceRule: undefined
    };
    return normalizeICloudEvent(occurrence, calendarId, calendarName);
  });
}

function eventStart(event: NormalizedCalendarEvent): number {
  const value = event.isAllDay ? `${event.startTime}T00:00:00` : event.startTime;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expandRecurrenceStarts(
  anchor: Date,
  rule: RecurrenceRule,
  windowStart: Date,
  windowEnd: Date
): Date[] {
  const interval = Math.max(1, rule.interval ?? 1);
  const frequency = rule.freq;
  if (!frequency) return [];
  const until = rule.until?.getTime() ?? windowEnd.getTime();
  const maximum = Math.min(windowEnd.getTime(), until);
  const countLimit = rule.count ?? Number.POSITIVE_INFINITY;
  const starts: Date[] = [];
  let generated = 0;

  if (frequency === "WEEKLY" && rule.byday?.length) {
    const weekdays = new Set(rule.byday.map(weekdayNumber).filter((day): day is number => day !== undefined));
    for (let cursor = startOfLocalDay(anchor); cursor.getTime() <= maximum && generated < countLimit; cursor = addDays(cursor, 1)) {
      const daysSinceAnchor = Math.floor((startOfLocalDay(cursor).getTime() - startOfLocalDay(anchor).getTime()) / 86_400_000);
      const weekIndex = Math.floor(daysSinceAnchor / 7);
      if (daysSinceAnchor < 0 || weekIndex % interval !== 0 || !weekdays.has(cursor.getDay())) continue;
      const occurrence = withAnchorTime(cursor, anchor);
      generated += 1;
      if (occurrence >= windowStart && occurrence <= windowEnd) starts.push(occurrence);
    }
    return starts;
  }

  let cursor = new Date(anchor);
  while (cursor.getTime() <= maximum && generated < countLimit && generated < 5_000) {
    generated += 1;
    if (cursor >= windowStart && cursor <= windowEnd && matchesRuleParts(cursor, rule)) {
      starts.push(new Date(cursor));
    }
    cursor = nextRecurrence(cursor, frequency, interval);
  }
  return starts;
}

function matchesRuleParts(date: Date, rule: RecurrenceRule): boolean {
  if (rule.byday?.length) {
    const weekdays = rule.byday.map(weekdayNumber).filter((day): day is number => day !== undefined);
    if (weekdays.length && !weekdays.includes(date.getDay())) return false;
  }
  if (rule.bymonthday?.length && !rule.bymonthday.includes(date.getDate())) return false;
  if (rule.bymonth?.length && !rule.bymonth.includes(date.getMonth() + 1)) return false;
  return true;
}

function nextRecurrence(date: Date, frequency: NonNullable<RecurrenceRule["freq"]>, interval: number): Date {
  const next = new Date(date);
  if (frequency === "DAILY") next.setDate(next.getDate() + interval);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + interval * 7);
  if (frequency === "MONTHLY") next.setMonth(next.getMonth() + interval);
  if (frequency === "YEARLY") next.setFullYear(next.getFullYear() + interval);
  return next;
}

function weekdayNumber(value: string): number | undefined {
  const label = value.slice(-2).toUpperCase();
  return ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 } as Record<string, number>)[label];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function withAnchorTime(date: Date, anchor: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds()
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
