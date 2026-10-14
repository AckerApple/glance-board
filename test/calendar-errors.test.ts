import assert from "node:assert/strict";
import test from "node:test";
import { resolveCalendarDisplay } from "../src/providers/calendar-display-provider.js";
import { CalendarRequestError, calendarFailure } from "../src/providers/calendar-error.js";
import { formatErrorLabel } from "../src/hardware/logging.js";
import { RotationEngine } from "../src/rotation/rotation-engine.js";
import { DisplayItemConfig, NormalizedDisplayCard } from "../src/rotation/types.js";

for (const source of ["google-calendar", "icloud-calendar"] as const) {
  for (const [error, lines] of [
    [new CalendarRequestError(401), ["SIGN IN AGAIN", "OPEN APP"]],
    [new CalendarRequestError(400, "invalid_grant"), ["SIGN IN AGAIN", "OPEN APP"]],
    [new CalendarRequestError(403), ["ACCESS DENIED", "CHECK ACCESS"]],
    [new Error("fetch failed"), ["NETWORK ERROR", "WILL RETRY"]],
    [new Error("private event SECRET Authorization: Bearer TOKEN"), []]
  ] as const) {
    test(`${source}: safe ${error.message.slice(0, 25)}`, async () => {
      const card = await resolveCalendarDisplay(source, { async getUpcomingEvents() { throw error; } }, { id: "test", enabled: true, type: `${source}-next-event` });
      assert.deepEqual(card.readableLines, lines);
      assert.deepEqual(card.matrixLines, lines);
      assert.doesNotMatch(JSON.stringify(card), /SECRET|TOKEN|Authorization|private event/);
    });
  }
}

test("unknown errors never stringify arbitrary objects", () => {
  assert.equal(calendarFailure({ status: 500, token: "SECRET" }).lines.length, 0);
});

test("CLI colors only the label and supports plain output", () => {
  assert.equal(formatErrorLabel("Calendar error", true), "\u001b[31mCalendar error\u001b[0m");
  assert.equal(formatErrorLabel("Calendar error", false), "Calendar error");
});

test("hidden failures keep healthy cards, throttle logs, and recover after retry", async () => {
  let now = 0;
  let failed = true;
  let calls = 0;
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => { logs.push(args); };
  try {
    const items: DisplayItemConfig[] = [
      { id: "private-id", enabled: true, type: "google-calendar-next-event" },
      { id: "healthy", enabled: true, type: "date-time" }
    ];
    const engine = new RotationEngine({ async resolve(item): Promise<NormalizedDisplayCard> {
      if (item.type === "google-calendar-next-event") {
        calls++;
        if (failed) return { ...item, title: "Calendar", status: "error", error: "Calendar request failed; retrying automatically", readableLines: [], matrixLines: [] };
      }
      return { ...item, title: "Ready", status: "live", readableLines: ["READY"], matrixLines: ["READY"] };
    } }, async () => ({ rotationSeconds: 10, items }), 15, () => now);
    assert.deepEqual((await engine.refresh()).cards.map(c => c.id), ["healthy"]);
    await engine.refresh();
    assert.equal(calls, 1);
    assert.equal(logs.length, 1);
    assert.match(String(logs[0][0]), /❌.*Calendar error/);
    assert.doesNotMatch(String(logs[0][0]), /private-id/);
    now = 300_000;
    await engine.refresh();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 2);
    assert.equal(logs.length, 1);
    failed = false;
    now = 600_000;
    await engine.refresh();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual((await engine.refresh()).cards.map(c => c.id), ["private-id", "healthy"]);
  } finally { console.error = original; }
});

test("NO_COLOR uses plain text even with a TTY", () => {
  const previous = process.env.NO_COLOR;
  const tty = process.stderr.isTTY;
  try {
    process.env.NO_COLOR = "1";
    process.stderr.isTTY = true;
    assert.equal(formatErrorLabel("Calendar error"), "Calendar error");
  } finally {
    process.stderr.isTTY = tty;
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});


test("Google API keeps HTTP auth status without exposing non-JSON response bodies", async () => {
  const { GoogleCalendarService } = await import("../src/providers/google-calendar-service.js");
  const service = new GoogleCalendarService(3010) as unknown as {
    getAccessToken(): Promise<string>;
    googleFetch(url: string): Promise<unknown>;
  };
  service.getAccessToken = async () => "synthetic-token";
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 500]) {
      globalThis.fetch = async () => new Response("PRIVATE EVENT TOKEN", { status });
      await assert.rejects(service.googleFetch("https://example.test"), error => {
        assert.ok(error instanceof CalendarRequestError);
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /PRIVATE|TOKEN/);
        assert.equal(calendarFailure(error).lines.length, status === 500 ? 0 : 2);
        return true;
      });
    }
    globalThis.fetch = async () => new Response("malformed PRIVATE EVENT TOKEN", { status: 200 });
    await assert.rejects(service.googleFetch("https://example.test"), error => {
      assert.deepEqual(calendarFailure(error).lines, []);
      assert.doesNotMatch(calendarFailure(error).detail, /PRIVATE|TOKEN/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
