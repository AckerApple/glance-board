import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCalendarColor } from "../src/matrix/color.js";
import { GoogleCalendarService, GoogleCalendarStorage } from "../src/providers/google-calendar-service.js";
import { resolveCalendarDisplay } from "../src/providers/calendar-display-provider.js";
import { renderDisplayCardToDisplayMatrix16x96 } from "../src/matrix/matrix.js";
import { buildMatrixProgramPayload } from "../src/hardware/coolleduX/coolleduXProtocol.js";
import { NormalizedDisplayCard } from "../src/rotation/types.js";

test("calendar hex colors normalize RGB, shorthand and CalDAV RGBA, rejecting invalid/invisible colors", () => {
  assert.equal(normalizeCalendarColor(" #AbC "), "#aabbcc");
  assert.equal(normalizeCalendarColor("#AABBCCFF"), "#aabbcc");
  for (const invalid of [undefined, {}, "red", "#xyzxyz", "#12345", "#000000"]) assert.equal(normalizeCalendarColor(invalid), undefined);
});

test("Google source calendar color reaches preview pixels and brightness-scaled LED bytes, ignoring event override", async () => {
  const files = new Map<string, unknown>([
    ["google-calendar.json", { calendarId: "work" }],
    ["google-calendar-token.json", { access_token: "test", expires_at: Date.now() + 3600000 }]
  ]);
  const storage: GoogleCalendarStorage = {
    async read<T>(name: string, fallback: T) { return (files.get(name) ?? fallback) as T; },
    async write() {}, async remove() {},
    async loadDisplayConfig() { return { items: [] } as any; }, async saveDisplayConfig() {}
  };
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    return new Response(JSON.stringify(url.includes("/calendarList/")
      ? { backgroundColor: "#3366CC", summary: "Work" }
      : { items: [{ id: "meeting", summary: "Meeting", colorId: "11", start: { dateTime: "2026-11-02T12:00:00Z" } }] }));
  }) as typeof fetch;
  try {
    const service = new GoogleCalendarService(3000, storage);
    const config = { id: "calendar", enabled: true, type: "google-calendar-next-event" as const };
    const resolved = await resolveCalendarDisplay("google-calendar", service, config);
    assert.equal(resolved.calendar.status, "ready");
    if (resolved.calendar.status !== "ready") throw new Error("Expected event");
    assert.equal(resolved.calendar.event.calendarColor, "#3366cc");
    const card = { ...config, ...resolved, title: "Calendar", status: "live" } as NormalizedDisplayCard;
    const matrix = renderDisplayCardToDisplayMatrix16x96(card);
    assert.equal(matrix[0][0], "#3366cc");
    assert.ok(matrix.flatMap(row => row.slice(18)).includes("#3366cc"));
    // Single-frame program header (10) + graffiti header (28), then RGB444 pixels.
    const full = buildMatrixProgramPayload([matrix], 1);
    const dim = buildMatrixProgramPayload([matrix], 0.5);
    assert.deepEqual([...full.subarray(38, 40)], [0x03, 0x6c]);
    assert.deepEqual([...dim.subarray(38, 40)], [0x02, 0x36]);
    await service.getUpcomingEvents(undefined, 1);
    assert.equal(requests.length, 2, "event cache includes the source calendar metadata");
    for (const color of [undefined, "invalid", "#000000"]) {
      card.calendar!.event!.calendarColor = color;
      const fallback = renderDisplayCardToDisplayMatrix16x96(card);
      assert.equal(fallback[0][0], "red");
      assert.ok(fallback.flatMap(row => row.slice(18)).includes("orange"));
      assert.ok(fallback.flatMap(row => row.slice(18)).includes("white"));
    }
  } finally { globalThis.fetch = originalFetch; }
});
