import assert from "node:assert/strict";
import test from "node:test";
import type { Calendar, Event } from "ts-caldav";
import { ICloudCalendarProvider } from "../src/providers/icloud-calendar-provider.js";
import {
  ICloudCalendarService,
  ICloudCalendarStorage,
  normalizeCalendars,
  normalizeICloudOccurrences
} from "../src/providers/icloud-calendar-service.js";
import { DisplayItemsConfig } from "../src/rotation/types.js";

test("connect stores credentials, exposes only email in status, and disconnect removes local state", async () => {
  const storage = createMemoryStorage();
  const calendars = [calendarFixture("Family")];
  const service = new ICloudCalendarService({
    storage,
    createClient: async () => ({
      async getCalendars() {
        return calendars;
      },
      async getEvents() {
        return [];
      }
    })
  });

  await service.connect({
    appleId: "user@example.com",
    appSpecificPassword: "xxxx-xxxx-xxxx-xxxx"
  });
  const status = await service.status();

  assert.equal(status.connected, true);
  assert.equal(status.appleId, "user@example.com");
  assert.equal("appSpecificPassword" in status, false);
  assert.deepEqual(storage.files.get("icloud-calendar-credentials.json"), {
    appleId: "user@example.com",
    appSpecificPassword: "xxxx-xxxx-xxxx-xxxx"
  });

  await service.disconnect();
  assert.equal(storage.files.has("icloud-calendar-credentials.json"), false);
  assert.equal(storage.files.has("icloud-calendar.json"), false);
});

test("normalizes VEVENT calendars and ignores non-event collections", () => {
  const calendars = normalizeCalendars([
    calendarFixture("Family"),
    {
      displayName: "Tasks",
      url: "https://example.test/tasks/",
      supportedComponents: ["VTODO"]
    }
  ]);

  assert.deepEqual(calendars, [{
    id: "https://example.test/family/",
    summary: "Family",
    color: "#ff0000"
  }]);
});

test("returns sorted upcoming events, ignores cancellations, and preserves all-day dates", async () => {
  const storage = createMemoryStorage();
  storage.files.set("icloud-calendar-credentials.json", {
    appleId: "user@example.com",
    appSpecificPassword: "app-password"
  });
  storage.files.set("icloud-calendar.json", {
    provider: "icloud",
    calendarId: "https://example.test/family/",
    calendarName: "Family"
  });
  const rawEvents: Event[] = [
    eventFixture("later", "Later", "2026-06-10T15:00:00Z", "2026-06-10T16:00:00Z"),
    eventFixture("cancelled", "Cancelled", "2026-06-09T15:00:00Z", "2026-06-09T16:00:00Z", { status: "CANCELLED" }),
    eventFixture("all-day", "School", "2026-06-09T04:00:00Z", "2026-06-10T04:00:00Z", { wholeDay: true })
  ];
  const service = new ICloudCalendarService({
    storage,
    now: () => new Date("2026-06-08T12:00:00Z"),
    createClient: async () => ({
      async getCalendars() {
        return [calendarFixture("Family")];
      },
      async getEvents() {
        return rawEvents;
      }
    })
  });

  const events = await service.getUpcomingEvents(undefined, 3);

  assert.deepEqual(events.map((event) => event.id), ["all-day", "later"]);
  assert.equal(events[0].isAllDay, true);
  assert.equal(events[0].startTime, "2026-06-09");
  assert.equal(events[0].provider, "icloud");
});

test("expands common weekly recurring events into the fetch window", () => {
  const event = eventFixture("weekly", "Standup", "2026-06-01T14:00:00Z", "2026-06-01T14:30:00Z", {
    recurrenceRule: {
      freq: "WEEKLY",
      byday: ["MO", "WE"]
    }
  });

  const events = normalizeICloudOccurrences(
    event,
    "https://example.test/work/",
    "Work",
    new Date("2026-06-08T00:00:00Z"),
    new Date("2026-06-15T23:59:59Z")
  );

  assert.deepEqual(events.map((item) => item.startTime), [
    "2026-06-08T14:00:00.000Z",
    "2026-06-10T14:00:00.000Z",
    "2026-06-15T14:00:00.000Z"
  ]);
});

test("expands common monthly recurring events", () => {
  const event = eventFixture("monthly", "Billing", "2026-01-15T14:00:00Z", "2026-01-15T14:30:00Z", {
    recurrenceRule: {
      freq: "MONTHLY",
      interval: 1
    }
  });

  const events = normalizeICloudOccurrences(
    event,
    "https://example.test/work/",
    "Work",
    new Date("2026-03-01T00:00:00Z"),
    new Date("2026-05-31T23:59:59Z")
  );

  assert.deepEqual(events.map((item) => item.startTime), [
    "2026-03-15T13:00:00.000Z",
    "2026-04-15T13:00:00.000Z",
    "2026-05-15T13:00:00.000Z"
  ]);
});

test("calendar provider renders ready, empty, setup, and error states", async () => {
  const config = {
    id: "icloud-calendar-next-1",
    enabled: true,
    type: "icloud-calendar-next-event" as const,
    eventIndex: 0
  };
  const readyProvider = new ICloudCalendarProvider({
    async getUpcomingEvents() {
      return [{
        id: "event",
        provider: "icloud",
        calendarId: "family",
        title: "Dentist",
        startTime: new Date(Date.now() + 60_000).toISOString(),
        isAllDay: false
      }];
    }
  });
  const emptyProvider = new ICloudCalendarProvider({
    async getUpcomingEvents() {
      return [];
    }
  });
  const setupProvider = new ICloudCalendarProvider({
    async getUpcomingEvents() {
      const error = new Error("setup") as Error & { isNotConfigured: boolean };
      error.isNotConfigured = true;
      throw error;
    }
  });
  const errorProvider = new ICloudCalendarProvider({
    async getUpcomingEvents() {
      throw new Error("network");
    }
  });

  const readyCard = await readyProvider.resolve(config);
  assert.match(readyCard.readableLines[0], /:/);
  assert.equal(readyCard.readableLines[0].includes("CAL"), false);
  assert.deepEqual((await emptyProvider.resolve(config)).readableLines, ["CAL EMPTY", "NO EVENTS"]);
  assert.deepEqual((await setupProvider.resolve(config)).readableLines, ["CAL SETUP", "OPEN APP"]);
  assert.deepEqual((await errorProvider.resolve(config)).readableLines, ["CAL ERROR", "OPEN APP"]);
});

test("all-day calendar cards use the title line instead of ALLDAY", async () => {
  const provider = new ICloudCalendarProvider({
    async getUpcomingEvents() {
      return [{
        id: "event",
        provider: "icloud",
        calendarId: "family",
        title: "School Conference Day",
        startTime: "2026-06-09",
        isAllDay: true
      }];
    }
  });

  const card = await provider.resolve({
    id: "icloud-calendar-next-1",
    enabled: true,
    type: "icloud-calendar-next-event",
    eventIndex: 0
  });

  assert.equal(card.calendar?.timeLabel, "");
  assert.equal(card.readableLines[1].includes("ALLDAY"), false);
  assert.match(card.readableLines[1], /SCHOOL/);
});

test("calendar cards compact standalone AND in titles to ampersands", async () => {
  const provider = new ICloudCalendarProvider({
    async getUpcomingEvents() {
      return [{
        id: "event",
        provider: "icloud",
        calendarId: "family",
        title: "Mom and Dad Dinner",
        startTime: "2026-06-09T18:00:00.000Z",
        isAllDay: false
      }];
    }
  });

  const card = await provider.resolve({
    id: "icloud-calendar-next-1",
    enabled: true,
    type: "icloud-calendar-next-event",
    eventIndex: 0
  });

  assert.equal(card.readableLines[1], "MOM & DAD DIN");
  assert.equal(card.matrixLines[1], "MOM & DAD DIN");
});

test("installing iCloud cards preserves Google and other rotation items", async () => {
  const storage = createMemoryStorage({
    rotationSeconds: 10,
    items: [
      { id: "google-calendar-next-1", enabled: true, type: "google-calendar-next-event", calendarId: "google", eventIndex: 0 },
      { id: "weather", enabled: true, type: "weather-current", zip: "33066" }
    ]
  });
  storage.files.set("icloud-calendar.json", {
    provider: "icloud",
    calendarId: "icloud-family",
    calendarName: "Family",
    eventShowCount: 5
  });
  const service = new ICloudCalendarService({ storage });

  await service.installRotationItems();

  assert.deepEqual(storage.displayConfig.items.map((item) => item.id), [
    "google-calendar-next-1",
    "weather",
    "icloud-calendar-next-1",
    "icloud-calendar-next-2",
    "icloud-calendar-next-3",
    "icloud-calendar-next-4",
    "icloud-calendar-next-5"
  ]);
  assert.equal((await service.status()).eventShowCount, 5);
});

test("installing iCloud cards persists the chosen event show count", async () => {
  const storage = createMemoryStorage();
  storage.files.set("icloud-calendar.json", {
    provider: "icloud",
    calendarId: "icloud-family",
    calendarName: "Family"
  });
  const service = new ICloudCalendarService({ storage });

  await service.installRotationItems("icloud-family", 5);

  assert.equal((await service.status()).eventShowCount, 5);
  assert.deepEqual(storage.files.get("icloud-calendar.json"), {
    provider: "icloud",
    calendarId: "icloud-family",
    calendarName: "Family",
    eventShowCount: 5
  });
});

function createMemoryStorage(initialConfig: DisplayItemsConfig = { rotationSeconds: 10, items: [] }) {
  const files = new Map<string, unknown>();
  const storage: ICloudCalendarStorage & { files: Map<string, unknown>; displayConfig: DisplayItemsConfig } = {
    files,
    displayConfig: structuredClone(initialConfig),
    async read<T>(fileName: string, fallback: T): Promise<T> {
      return (files.has(fileName) ? structuredClone(files.get(fileName)) : fallback) as T;
    },
    async write(fileName: string, value: unknown): Promise<void> {
      files.set(fileName, structuredClone(value));
    },
    async remove(fileName: string): Promise<void> {
      files.delete(fileName);
    },
    async loadDisplayConfig(): Promise<DisplayItemsConfig> {
      return structuredClone(storage.displayConfig);
    },
    async saveDisplayConfig(config: DisplayItemsConfig): Promise<void> {
      storage.displayConfig = structuredClone(config);
    }
  };
  return storage;
}

function calendarFixture(displayName: string): Calendar {
  return {
    displayName,
    url: `https://example.test/${displayName.toLowerCase()}/`,
    supportedComponents: ["VEVENT"],
    color: "#ff0000"
  };
}

function eventFixture(
  uid: string,
  summary: string,
  start: string,
  end: string,
  patch: Partial<Event> = {}
): Event {
  return {
    uid,
    summary,
    start: new Date(start),
    end: new Date(end),
    etag: `"${uid}"`,
    href: `https://example.test/${uid}.ics`,
    ...patch
  };
}
