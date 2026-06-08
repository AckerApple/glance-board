import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleCalendarRotationItems } from "../src/providers/google-calendar-service.js";

test("Google Calendar installs provider-specific rotation IDs", async () => {
  const items = buildGoogleCalendarRotationItems("primary");

  assert.deepEqual(items.map((item) => item.id), [
    "google-calendar-next-1",
    "google-calendar-next-2",
    "google-calendar-next-3"
  ]);
  assert.ok(items.every((item) => item.type === "google-calendar-next-event"));
  assert.ok(items.every((item) => item.calendarId === "primary"));
});
