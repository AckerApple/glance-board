import { fitDisplayLine, sanitizeDisplayText } from "../matrix/text-sanitizer.js";
import { CalendarDisplayData, CalendarSourceType, DisplayItemConfig, NormalizedCalendarEvent } from "../rotation/types.js";

export interface CalendarEventService {
  getUpcomingEvents(calendarId: string | undefined, limit: number): Promise<NormalizedCalendarEvent[]>;
}

export async function resolveCalendarDisplay(
  sourceType: CalendarSourceType,
  service: CalendarEventService,
  config: DisplayItemConfig
) {
  const eventIndex = normalizeEventIndex(config.eventIndex);
  try {
    const events = await service.getUpcomingEvents(config.calendarId, Math.max(3, eventIndex + 1));
    const event = events[eventIndex];
    if (!event) return emptyCalendarCard(sourceType, eventIndex);
    const dateLabel = formatDateLabel(event);
    const timeLabel = formatTimeLabel(event);
    const shortTitle = shortEventTitle(event.title, 13);
    const timeLine = event.isAllDay ? "ALL DAY" : timeLabel;
    const isBirthday = isBirthdayEvent(event.title);
    const readableLines = [`${isBirthday ? "🎂 " : ""}${timeLine}`, shortTitle];
    const matrixLines = [
      sanitizeDisplayText(timeLine),
      sanitizeCalendarTitle(shortTitle)
    ];
    return {
      calendar: {
        sourceType,
        status: "ready" as const,
        title: event.title,
        dateLabel,
        timeLabel,
        shortTitle,
        eventIndex,
        isBirthday,
        event
      },
      readableLines,
      matrixLines: [
        fitDisplayLine(matrixLines[0], 13),
        fitDisplayLine(matrixLines[1], 13, { preserveAmpersand: true })
      ],
      debug: {
        provider: event.provider,
        calendarId: event.calendarId,
        calendarName: event.calendarName,
        eventIndex,
        eventId: event.id
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isNotConfiguredError(error)) return notConfiguredCalendarCard(sourceType, eventIndex, message);
    return errorCalendarCard(sourceType, eventIndex, message);
  }
}

function normalizeEventIndex(value: unknown): number {
  const index = Number(value);
  return Number.isFinite(index) ? Math.max(0, Math.min(2, Math.trunc(index))) : 0;
}

function emptyCalendarCard(sourceType: CalendarSourceType, eventIndex: number) {
  return {
    calendar: {
      sourceType,
      status: "empty" as const,
      title: "No Events",
      dateLabel: "EMPTY",
      timeLabel: "NO",
      shortTitle: "EVENTS",
      eventIndex
    },
    readableLines: ["CAL EMPTY", "NO EVENTS"],
    matrixLines: ["CAL EMPTY", "NO EVENTS"],
    debug: { eventIndex }
  };
}

function notConfiguredCalendarCard(sourceType: CalendarSourceType, eventIndex: number, error: string) {
  return {
    calendar: {
      sourceType,
      status: "not_configured" as const,
      title: "Calendar Setup",
      dateLabel: "SETUP",
      timeLabel: "OPEN",
      shortTitle: "APP",
      eventIndex,
      error
    },
    readableLines: ["CAL SETUP", "OPEN APP"],
    matrixLines: ["CAL SETUP", "OPEN APP"],
    debug: { eventIndex, error }
  };
}

function errorCalendarCard(sourceType: CalendarSourceType, eventIndex: number, error: string) {
  return {
    calendar: {
      sourceType,
      status: "error" as const,
      title: "Calendar Error",
      dateLabel: "ERROR",
      timeLabel: "CAL",
      shortTitle: "ERROR",
      eventIndex,
      error
    },
    readableLines: ["CAL ERROR", "OPEN APP"],
    matrixLines: ["CAL ERROR", "OPEN APP"],
    debug: { eventIndex, error }
  };
}

function formatDateLabel(event: NormalizedCalendarEvent): string {
  const start = eventDate(event);
  const today = startOfDay(new Date());
  const eventDay = startOfDay(start);
  const diffDays = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "TMRW";
  if (diffDays > 1 && diffDays < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(start).toUpperCase();
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(start).toUpperCase();
  return `${month}${start.getDate()}`;
}

function formatTimeLabel(event: NormalizedCalendarEvent): string {
  if (event.isAllDay) return "";
  const start = eventDate(event);
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(start);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value?.[0] ?? "";
  return `${hour}:${minute}${dayPeriod}`.toUpperCase();
}

function shortEventTitle(title: string, length = 6): string {
  const sanitized = sanitizeCalendarTitle(title);
  const words = sanitized.split(" ").filter(Boolean);
  if (length > 6) return fitDisplayLine(sanitized || "EVENT", length, { preserveAmpersand: true });
  const meaningful = words.find((word) => !["THE", "AND", "WITH", "FOR", "TO", "AT"].includes(word)) ?? words[0] ?? "EVENT";
  return fitDisplayLine(meaningful, length);
}

function sanitizeCalendarTitle(title: string): string {
  return sanitizeDisplayText(title, "EVENT", { preserveAmpersand: true })
    .replace(/\bAND\b/g, "&")
    .replace(/\s+-\s+/g, "-");
}

function isBirthdayEvent(title: string): boolean {
  return /\b(bday|birth)/i.test(title);
}

function eventDate(event: NormalizedCalendarEvent): Date {
  const date = event.isAllDay ? new Date(`${event.startTime}T00:00:00`) : new Date(event.startTime);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isNotConfiguredError(error: unknown): boolean {
  return error instanceof Error && "isNotConfigured" in error;
}

export function calendarStatusToGameStatus(status: CalendarDisplayData["status"] | undefined) {
  if (status === "ready") return "live" as const;
  if (status === "not_configured") return "not_configured" as const;
  if (status === "error") return "error" as const;
  return "no_game" as const;
}
