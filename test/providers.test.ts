import assert from "node:assert/strict";
import test from "node:test";
import { DateTimeProvider } from "../src/providers/date-time-provider.js";
import { MoonProvider } from "../src/providers/moon-provider.js";

test("date-time provider produces two display-safe lines", () => {
  const result = new DateTimeProvider().resolve(
    { id: "date", enabled: true, type: "date-time" },
    new Date("2026-06-06T13:30:00-04:00")
  );
  assert.equal(result.matrixLines.length, 2);
  assert.match(result.matrixLines[1], /:/);
});

test("moon provider returns bounded illumination and future full moon distance", () => {
  const result = new MoonProvider().resolve(
    { id: "moon", enabled: true, type: "moon-phase" },
    new Date("2026-06-06T12:00:00Z")
  );
  assert.ok(result.moon.illumination >= 0 && result.moon.illumination <= 1);
  assert.ok(result.moon.daysUntilFullMoon >= 0);
  assert.equal(result.matrixLines.length, 2);
});
