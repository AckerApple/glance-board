import assert from "node:assert/strict";
import test from "node:test";
import { assertMatrix16x96, createMatrix16x96 } from "../src/matrix/core16x96.js";
import { renderDisplayCardToDisplayMatrix16x96 } from "../src/matrix/matrix.js";
import { NormalizedDisplayCard } from "../src/rotation/types.js";

test("renders display cards as a stable 16x96 matrix", () => {
  const card: NormalizedDisplayCard = {
    id: "test",
    enabled: true,
    type: "date-time",
    title: "Date Time",
    status: "live",
    readableLines: ["JUN6 2026", "SAT 1:30P"],
    matrixLines: ["JUN6 2026", "SAT 1:30P"],
    dateTime: {
      iso: "2026-06-06T13:30:00-04:00",
      scheduledDate: "2026-06-06T13:30:00-04:00"
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  assertMatrix16x96(matrix);
  assert.equal(matrix.length, 16);
  assert.equal(matrix[0].length, 96);
  assert.ok(matrix.flat().some((pixel) => pixel !== "off"));
});

test("rejects invalid matrix dimensions", () => {
  const matrix = createMatrix16x96();
  matrix[0].pop();
  assert.throws(() => assertMatrix16x96(matrix), /Expected row 0/);
});

test("renders regular fuel red and diesel fuel green", () => {
  const card: NormalizedDisplayCard = {
    id: "local-fuel-average",
    enabled: true,
    type: "fuel-average",
    title: "Gas Average",
    status: "live",
    readableLines: ["GAS AVG FTL", "REG3.14 DSL3.65"],
    matrixLines: ["GAS AVG FTL", "REG3.14 DSL3.65"]
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const regularPixels = matrix.slice(8, 15).flatMap((row) => row.slice(3, 44));
  const dieselPixels = matrix.slice(8, 15).flatMap((row) => row.slice(51, 96));

  assert.ok(regularPixels.includes("red"));
  assert.ok(!regularPixels.includes("green"));
  assert.ok(dieselPixels.includes("green"));
  assert.ok(!dieselPixels.includes("red"));
});

test("renders a cake icon for birthday calendar events", () => {
  const card: NormalizedDisplayCard = {
    id: "icloud-calendar-next-1",
    enabled: true,
    type: "icloud-calendar-next-event",
    title: "iCloud 1",
    status: "live",
    readableLines: ["🎂 CAL TODAY", "MOM BDAY"],
    matrixLines: ["CAL TODAY", "MOM BDAY"],
    calendar: {
      sourceType: "icloud-calendar",
      status: "ready",
      title: "Mom birthday",
      dateLabel: "TODAY",
      timeLabel: "",
      shortTitle: "MOM BDAY",
      eventIndex: 0,
      isBirthday: true,
      event: {
        id: "event",
        provider: "icloud",
        calendarId: "family",
        title: "Mom birthday",
        startTime: "2026-06-09",
        isAllDay: true
      }
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const cakePixels = matrix.slice(0, 8).flatMap((row) => row.slice(87, 96));

  assert.ok(cakePixels.includes("purple"));
  assert.ok(cakePixels.includes("orange"));
});
