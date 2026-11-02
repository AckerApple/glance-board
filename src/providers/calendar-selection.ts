import type { NormalizedCalendarEvent } from "../rotation/types.js";

export function calendarSelection(value: string | string[] | undefined): string[] {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(id => id.trim()).filter(Boolean))];
}

/** Deduplicate occurrences within a source; distinct calendars retain their own identity/color. */
export function combineCalendarEvents(groups: NormalizedCalendarEvent[][], limit: number): NormalizedCalendarEvent[] {
  const events = new Map<string, NormalizedCalendarEvent>();
  for (const event of groups.flat()) {
    const key = JSON.stringify([event.provider, event.calendarId, event.id, event.startTime]);
    if (!events.has(key)) events.set(key, event);
  }
  const start = (event: NormalizedCalendarEvent) => Date.parse(event.isAllDay ? `${event.startTime}T00:00:00` : event.startTime);
  return [...events.values()].sort((a, b) => start(a) - start(b) || a.calendarId.localeCompare(b.calendarId) || a.id.localeCompare(b.id)).slice(0, limit);
}
