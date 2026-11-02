import assert from "node:assert/strict";
import test from "node:test";
import type { Calendar, Event } from "ts-caldav";
import { GoogleCalendarService, GoogleCalendarStorage } from "../src/providers/google-calendar-service.js";
import { ICloudCalendarService, ICloudCalendarStorage } from "../src/providers/icloud-calendar-service.js";
import { combineCalendarEvents } from "../src/providers/calendar-selection.js";
import { resolveCalendarDisplay } from "../src/providers/calendar-display-provider.js";
import { renderDisplayCardToDisplayMatrix16x96 } from "../src/matrix/matrix.js";
import type { DisplayItemsConfig, NormalizedCalendarEvent, NormalizedDisplayCard } from "../src/rotation/types.js";

function memoryStorage() {
  const files = new Map<string, unknown>();
  const storage: GoogleCalendarStorage & ICloudCalendarStorage = {
    async read<T>(name: string, fallback: T) { return structuredClone(files.get(name) ?? fallback) as T; },
    async write(name, value) { files.set(name, structuredClone(value)); },
    async remove(name) { files.delete(name); },
    async loadDisplayConfig() { return structuredClone(files.get("display-items.json") ?? { rotationSeconds: 10, items: [] }) as DisplayItemsConfig; },
    async saveDisplayConfig(config) { files.set("display-items.json", structuredClone(config)); }
  };
  return { files, storage };
}

for (const provider of ["google", "icloud"] as const) {
  test(`${provider}: multiple selections persist, merge/deduplicate in date order, retain source colors, and support deselection/clearing/legacy settings`, async () => {
    const { files, storage } = memoryStorage();
    const type = `${provider}-calendar-next-event` as const;
    const untouched = { id: "other", type: "date-time" as const, enabled: true };
    await storage.saveDisplayConfig({ rotationSeconds: 10, items: [untouched, { id: `${provider}-calendar-next-1`, type, enabled: false, calendarId: "old" }] });
    files.set("google-calendar-token.json", { access_token: "fixture", expires_at: Date.now() + 3600000 });
    files.set("icloud-calendar-credentials.json", { appleId: "fixture@example.test", appSpecificPassword: "fixture" });
    const requested: string[] = [];
    let discoveries = 0;
    const calendars: Calendar[] = [
      { url: "a", displayName: "Family", color: "#CC3300FF", supportedComponents: ["VEVENT"] },
      { url: "b", displayName: "Work", color: "#3366CC", supportedComponents: ["VEVENT"] }
    ];
    const event = (id: string, start: string, allDay = false): Event => ({ uid: id, summary: id, start: new Date(start), end: new Date(Date.parse(start) + 3600000), wholeDay: allDay, etag: id, href: id });
    const duplicate = event("shared", "2030-01-03T11:00:00Z");
    const raw: Record<string, Event[]> = {
      a: [duplicate, duplicate, event("late", "2030-01-03T13:00:00Z")],
      b: [event("day", "2030-01-03T00:00:00Z", true), event("shared", "2030-01-03T10:00:00Z")]
    };
    const make = () => provider === "google" ? new GoogleCalendarService(3010, storage) : new ICloudCalendarService({
      storage, now: () => new Date("2030-01-02T00:00:00Z"),
      createClient: async () => ({
        async getCalendars() { discoveries++; return calendars; },
        async getEvents(id) { requested.push(id); return raw[id]; }
      })
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async input => {
      const url = new URL(String(input));
      if (url.pathname.includes("/calendarList/")) {
        const calendar = calendars.find(calendar => calendar.url === decodeURIComponent(url.pathname.split("/").at(-1)!))!;
        return new Response(JSON.stringify({ summary: calendar.displayName, backgroundColor: calendar.color?.slice(0, 7) }));
      }
      const id = decodeURIComponent(url.pathname.split("/").at(-2)!);
      requested.push(id);
      return new Response(JSON.stringify({ items: raw[id].map(event => ({
        id: event.uid, summary: event.summary, colorId: "11",
        start: event.wholeDay ? { date: "2030-01-03" } : { dateTime: event.start.toISOString() },
        end: { dateTime: event.end.toISOString() }
      })) }));
    }) as typeof fetch;
    try {
      let service = make();
      await service.saveSelectedCalendar([" a ", "b", "a", ""]);
      assert.deepEqual((await service.status()).selectedCalendarIds, ["a", "b"]);
      let config = await storage.loadDisplayConfig();
      assert.equal(config.items[1].calendarId, undefined, "existing cards follow the saved group");
      assert.equal(config.items[1].enabled, false, "saving selection does not enable hidden cards");
      assert.deepEqual(config.items[0], untouched);
      service = make(); // Simulate service reload, using persisted settings.
      await service.installRotationItems();
      config = await storage.loadDisplayConfig();
      assert.ok(config.items.filter(item => item.type === type).every(item => item.calendarId === undefined));
      const events = await service.getUpcomingEvents(undefined, 3);
      assert.deepEqual(events.map(event => [event.calendarId, event.id]), [["b", "day"], ["b", "shared"], ["a", "shared"]]);
      assert.deepEqual(events.map(event => event.calendarColor), ["#3366cc", "#3366cc", "#cc3300"]);
      assert.deepEqual(events.map(event => event.calendarName), ["Work", "Work", "Family"]);
      assert.deepEqual([...new Set(requested)].sort(), ["a", "b"]);
      if (provider === "icloud") assert.equal(discoveries, 1, "CalDAV discovery is shared across calendar requests");
      for (let index = 0; index < 3; index++) {
        const cardConfig = config.items.find(item => item.id === `${provider}-calendar-next-${index + 1}`)!;
        const resolved = await resolveCalendarDisplay(`${provider}-calendar`, service, cardConfig);
        const card = { ...cardConfig, ...resolved, title: "Calendar", status: "live" } as NormalizedDisplayCard;
        assert.equal(renderDisplayCardToDisplayMatrix16x96(card)[0][0], events[index].calendarColor);
      }
      await service.saveSelectedCalendar(["a"]);
      requested.length = 0;
      assert.deepEqual((await service.getUpcomingEvents(undefined, 3)).map(event => event.id), ["shared", "late"]);
      assert.deepEqual([...new Set(requested)], ["a"], "deselected calendar is not fetched");
      await service.saveSelectedCalendar([]);
      assert.deepEqual((await service.status()).selectedCalendarIds, []);
      await assert.rejects(service.getUpcomingEvents(undefined), /No .* Calendar selected/);
      await assert.rejects(service.installRotationItems(), /No .* Calendar selected/);
      const cleared = await resolveCalendarDisplay(`${provider}-calendar`, service, { id: "clear", type, enabled: true });
      assert.equal(cleared.calendar.status, "not_configured");
      await service.saveSelectedCalendar("b", "Legacy Work");
      assert.deepEqual((await service.status()).selectedCalendarIds, ["b"]);
      assert.equal((files.get(`${provider}-calendar.json`) as { calendarIds?: string[] }).calendarIds, undefined);
      assert.ok((await service.getUpcomingEvents(undefined)).every(event => event.calendarId === "b"));
      assert.ok((await storage.loadDisplayConfig()).items.filter(item => item.type === type).every(item => item.calendarId === "b"));
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("combined occurrences retain distinct source calendars and use deterministic ties", () => {
  const event: NormalizedCalendarEvent = { id: "same", calendarId: "b", title: "Meeting", startTime: "2030-01-03T10:00:00Z", isAllDay: false };
  const events = combineCalendarEvents([[event, event], [{ ...event, calendarId: "a" }]], 3);
  assert.deepEqual(events.map(event => event.calendarId), ["a", "b"]);
});
