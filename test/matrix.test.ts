import assert from "node:assert/strict";
import test from "node:test";
import { buildScrollDownFrames } from "../src/matrix/animation.js";
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

test("builds scroll-down transition frames between 16x96 matrices", () => {
  const current = createMatrix16x96();
  const next = createMatrix16x96();
  current[0][0] = "red";
  current[15][95] = "orange";
  next[0][0] = "green";
  next[15][95] = "blue";

  const frames = buildScrollDownFrames(current, next, { durationMs: 2_000, fps: 8 });
  for (const frame of frames) assertMatrix16x96(frame);

  assert.equal(frames.length, 17);
  assert.equal(frames[0][0][0], "red");
  assert.equal(frames.at(-1)?.[0][0], "green");
  assert.equal(frames.at(-1)?.[15][95], "blue");
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

test("renders sunny weather with humidity at the bottom right", () => {
  const card: NormalizedDisplayCard = {
    id: "local-weather",
    enabled: true,
    type: "weather-current",
    title: "Weather",
    status: "live",
    readableLines: ["80F L78 H84", "NO RAIN 72H 46%"],
    matrixLines: ["80F L78 H84", "NO RAIN 72H"],
    weather: {
      temperature: 80,
      lowTemperature: 78,
      highTemperature: 84,
      humidity: 46,
      rainNow: false,
      rainWithinTwoHours: false,
      nextRain: "NO RAIN 72H",
      cloudCover: 5,
      weatherCode: 0,
      isSunny: true
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const iconPixels = matrix.slice(2, 13).flatMap((row) => row.slice(2, 15));
  const humidityPixels = matrix.slice(8, 15).flatMap((row) => row.slice(72, 96));

  assert.ok(iconPixels.includes("yellow"));
  assert.ok(iconPixels.includes("orange"));
  assert.ok(humidityPixels.includes("blue"));
});

test("renders cloudy weather with a cloud icon", () => {
  const card: NormalizedDisplayCard = {
    id: "local-weather",
    enabled: true,
    type: "weather-current",
    title: "Weather",
    status: "live",
    readableLines: ["80F L78 H84", "NO RAIN 72H 46%"],
    matrixLines: ["80F L78 H84", "NO RAIN 72H"],
    weather: {
      temperature: 80,
      lowTemperature: 78,
      highTemperature: 84,
      humidity: 46,
      rainNow: false,
      rainWithinTwoHours: false,
      nextRain: "NO RAIN 72H",
      cloudCover: 80,
      weatherCode: 3,
      isSunny: false
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const iconPixels = matrix.slice(3, 8).flatMap((row) => row.slice(1, 15));

  assert.ok(iconPixels.includes("white"));
  assert.ok(!iconPixels.includes("yellow"));
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
  assert.equal(matrix[2][91], "white");
});
