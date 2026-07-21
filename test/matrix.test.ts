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

test("renders calendar icon weekday as cutout pixels", () => {
  const card: NormalizedDisplayCard = {
    id: "icloud-calendar-next-1",
    enabled: true,
    type: "icloud-calendar-next-event",
    title: "iCloud 1",
    status: "live",
    readableLines: ["9:00A", "SCHOOL"],
    matrixLines: ["9:00A", "SCHOOL"],
    calendar: {
      sourceType: "icloud-calendar",
      status: "ready",
      title: "School",
      dateLabel: "TUE",
      timeLabel: "9:00A",
      shortTitle: "SCHOOL",
      eventIndex: 0,
      isBirthday: false,
      event: {
        id: "event",
        provider: "icloud",
        calendarId: "family",
        title: "School",
        startTime: "2026-06-09T09:00:00.000Z",
        isAllDay: false
      }
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);

  assert.equal(matrix[1][2], "off");
  assert.equal(matrix[1][6], "off");
  assert.equal(matrix[1][10], "off");
  assert.equal(matrix[0][2], "red");
});

test("renders date-only calendar icon dates as local dates", () => {
  const originalTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const dateOnlyMatrix = renderDisplayCardToDisplayMatrix16x96(calendarCardWithStartTime("2026-11-03"));
    const localMidnightMatrix = renderDisplayCardToDisplayMatrix16x96(calendarCardWithStartTime("2026-11-03T00:00:00"));

    assert.deepEqual(
      dateOnlyMatrix.map((row) => row.slice(0, 16)),
      localMidnightMatrix.map((row) => row.slice(0, 16))
    );
  } finally {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  }
});

function calendarCardWithStartTime(startTime: string): NormalizedDisplayCard {
  return {
    id: "icloud-calendar-next-1",
    enabled: true,
    type: "icloud-calendar-next-event",
    title: "iCloud 1",
    status: "live",
    readableLines: ["ALL DAY", "MARK HUNT'S B"],
    matrixLines: ["NOV", "MARK HUNT'S B"],
    calendar: {
      sourceType: "icloud-calendar",
      status: "ready",
      title: "Mark Hunt's Birthday",
      dateLabel: "NOV3",
      timeLabel: "",
      shortTitle: "MARK HUNT'S B",
      eventIndex: 0,
      isBirthday: true,
      event: {
        id: "event",
        provider: "icloud",
        calendarId: "family",
        title: "Mark Hunt's Birthday",
        startTime,
        isAllDay: true
      }
    }
  };
}

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

test("colors moon edge rows with the current phase", () => {
  const card: NormalizedDisplayCard = {
    id: "moon-phase",
    enabled: true,
    type: "moon-phase",
    title: "Moon",
    status: "live",
    readableLines: ["MOON", "HALF"],
    matrixLines: ["MOON", "HALF"],
    moon: {
      phaseName: "First Quarter",
      illumination: 0.5,
      waxing: true,
      daysUntilFullMoon: 7
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const edgePixels = [...matrix[2].slice(5, 12), ...matrix[14].slice(5, 12)];

  assert.ok(edgePixels.includes("yellow"));
  assert.ok(edgePixels.includes("gray"));
  assert.ok(!edgePixels.includes("white"));
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

test("renders internet status with a wifi icon", () => {
  const card: NormalizedDisplayCard = {
    id: "internet-status",
    enabled: true,
    type: "internet-status",
    title: "Internet",
    status: "live",
    readableLines: ["12MS ONLINE", "↓100Mb ↑25Mb"],
    matrixLines: ["12MS ONLINE", "↓100MB ↑25MB"],
    internet: {
      online: true,
      connectionType: "wifi",
      interfaceName: "en0",
      latencyMs: 12,
      downloadMbps: 100,
      uploadMbps: 25,
      checkedAt: "2026-06-15T12:00:00.000Z"
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const iconPixels = matrix.slice(2, 15).flatMap((row) => row.slice(1, 15));
  const firstLinePixels = matrix.slice(0, 7).flatMap((row) => row.slice(21, 96));
  const downloadValuePixels = matrix.slice(8, 15).flatMap((row) => row.slice(21, 41));
  const downloadUnitPixels = matrix.slice(8, 15).flatMap((row) => row.slice(41, 51));
  const uploadValuePixels = matrix.slice(8, 15).flatMap((row) => row.slice(58, 73));
  const uploadUnitPixels = matrix.slice(8, 15).flatMap((row) => row.slice(73, 83));

  assert.ok(iconPixels.includes("green"));
  assert.ok(firstLinePixels.includes("blue"));
  assert.ok(!firstLinePixels.includes("green"));
  assert.ok(downloadValuePixels.includes("yellow"));
  assert.ok(downloadUnitPixels.includes("blue"));
  assert.ok(!downloadUnitPixels.includes("yellow"));
  assert.ok(uploadValuePixels.includes("yellow"));
  assert.ok(uploadUnitPixels.includes("blue"));
  assert.ok(!uploadUnitPixels.includes("yellow"));
});

test("renders internet speed thresholds independently", () => {
  const card: NormalizedDisplayCard = {
    id: "internet-status",
    enabled: true,
    type: "internet-status",
    title: "Internet",
    status: "live",
    readableLines: ["12MS ONLINE", "↓101Mb ↑9Mb"],
    matrixLines: ["12MS ONLINE", "↓101MB ↑9MB"],
    internet: {
      online: true,
      connectionType: "wifi",
      interfaceName: "en0",
      latencyMs: 12,
      downloadMbps: 101,
      uploadMbps: 9,
      checkedAt: "2026-06-15T12:00:00.000Z"
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const downloadValuePixels = matrix.slice(8, 15).flatMap((row) => row.slice(21, 41));
  const downloadUnitPixels = matrix.slice(8, 15).flatMap((row) => row.slice(41, 51));
  const uploadValuePixels = matrix.slice(8, 15).flatMap((row) => row.slice(58, 68));
  const uploadUnitPixels = matrix.slice(8, 15).flatMap((row) => row.slice(68, 78));

  assert.ok(downloadValuePixels.includes("green"));
  assert.ok(!downloadValuePixels.includes("yellow"));
  assert.ok(downloadUnitPixels.includes("blue"));
  assert.ok(!downloadUnitPixels.includes("green"));
  assert.ok(uploadValuePixels.includes("red"));
  assert.ok(!uploadValuePixels.includes("yellow"));
  assert.ok(uploadUnitPixels.includes("blue"));
  assert.ok(!uploadUnitPixels.includes("red"));
});

test("renders offline internet status with an ethernet icon and red speed stats", () => {
  const card: NormalizedDisplayCard = {
    id: "internet-status",
    enabled: true,
    type: "internet-status",
    title: "Internet",
    status: "live",
    readableLines: ["OFFLINE", "↓--Mb ↑--Mb"],
    matrixLines: ["OFFLINE", "↓--MB ↑--MB"],
    internet: {
      online: false,
      connectionType: "ethernet",
      interfaceName: "en5",
      checkedAt: "2026-06-15T12:00:00.000Z"
    }
  };

  const matrix = renderDisplayCardToDisplayMatrix16x96(card);
  const iconPixels = matrix.slice(2, 15).flatMap((row) => row.slice(1, 15));
  const textPixels = matrix.slice(0, 8).flatMap((row) => row.slice(21, 96));
  const speedValuePixels = matrix.slice(8, 15).flatMap((row) => [...row.slice(21, 36), ...row.slice(58, 73)]);
  const speedUnitPixels = matrix.slice(8, 15).flatMap((row) => [...row.slice(36, 46), ...row.slice(73, 83)]);

  assert.ok(iconPixels.includes("red"));
  assert.ok(textPixels.includes("blue"));
  assert.ok(!textPixels.includes("red"));
  assert.ok(speedValuePixels.includes("red"));
  assert.ok(speedUnitPixels.includes("blue"));
  assert.ok(!speedUnitPixels.includes("red"));
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
