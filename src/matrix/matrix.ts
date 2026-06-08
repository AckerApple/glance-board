import { createEmptyMatrix, drawText, PixelColor, PixelMatrix, setPixel } from "./compact64.js";
import {
  createMatrix16x96,
  drawText as drawText16x96,
  PixelColor as PixelColor16x96,
  PixelMatrix as PixelMatrix16x96,
  setPixel as setPixel16x96
} from "./core16x96.js";
import { formatGameForDotMatrix, formatNextGameForDotMatrix } from "../providers/espn.js";
import { fitDisplayLine } from "./text-sanitizer.js";
import { NbaDisplayMode, NormalizedDisplayCard, NormalizedGameScore } from "../rotation/types.js";

export function renderNbaGameToMatrix(game: NormalizedGameScore): PixelMatrix {
  const matrix = createEmptyMatrix();
  const [line1 = "", line2 = ""] = formatGameForDotMatrix(game);

  drawText(matrix, line1, 2, 0, game.status === "live" ? "green" : "white");
  drawText(matrix, line2, 2, 8, game.status === "final" ? "orange" : "white");

  return matrix;
}

export function renderNbaNextGameToMatrix(game: NormalizedGameScore): PixelMatrix {
  const matrix = createEmptyMatrix();
  const [line1 = "", line2 = ""] = formatNextGameForDotMatrix(game);

  drawCalendarIcon(matrix, game.scheduledDate);
  drawText(matrix, line1, 18, 0, "orange");
  drawText(matrix, line2, 18, 8, "white");

  return matrix;
}

export function renderNbaDisplayModeToMatrix(mode: NbaDisplayMode, game: NormalizedGameScore): PixelMatrix {
  return mode === "next_game" ? renderNbaNextGameToMatrix(game) : renderNbaGameToMatrix(game);
}

export function renderDisplayCardToMatrix(card: NormalizedDisplayCard): PixelMatrix {
  if (card.type === "sports-next-game") {
    return renderNextGameCardToMatrix(card);
  }

  const matrix = createEmptyMatrix();
  const [line1 = "", line2 = ""] = card.matrixLines;
  drawText(matrix, fitDisplayLine(line1), 2, 0, card.status === "live" ? "green" : "white");
  drawText(matrix, fitDisplayLine(line2), 2, 8, card.status === "final" ? "orange" : "white");
  return matrix;
}

export function renderDisplayCardToDisplayMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  if (card.type === "sports-next-game") {
    return renderNextGameCardToMatrix16x96(card);
  }
  if (card.type === "date-time" || card.type === "google-calendar-next-event" || card.type === "icloud-calendar-next-event") {
    return renderDateTimeCardToMatrix16x96(card);
  }
  if (card.type === "weather-current") {
    return renderWeatherCardToMatrix16x96(card);
  }
  if (card.type === "moon-phase") {
    return renderMoonCardToMatrix16x96(card);
  }
  if (card.type === "fuel-average") {
    return renderFuelCardToMatrix16x96(card);
  }

  return renderTextCardToMatrix16x96(card);
}

export function renderNbaGameToDisplayMatrix16x96(game: NormalizedGameScore): PixelMatrix16x96 {
  return matrix64To96(renderNbaGameToMatrix(game));
}

export function renderNbaDisplayModeToDisplayMatrix16x96(mode: NbaDisplayMode, game: NormalizedGameScore): PixelMatrix16x96 {
  return matrix64To96(renderNbaDisplayModeToMatrix(mode, game));
}

function matrix64To96(matrix64: PixelMatrix): PixelMatrix16x96 {
  const xOffset = 16;

  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 96 }, (_, x) => {
      const sourceX = x - xOffset;
      return sourceX >= 0 && sourceX < 64 ? matrix64[y]?.[sourceX] ?? "off" : "off";
    })
  );
}

function drawCalendarIcon(matrix: PixelMatrix, scheduledDate: string | undefined): void {
  const date = scheduledDate ? new Date(scheduledDate) : undefined;
  const day = date && !Number.isNaN(date.getTime()) ? weekdayAbbreviation(date) : "TBD";
  const dayOfMonth = date && !Number.isNaN(date.getTime()) ? String(date.getDate()) : "--";

  fillRect(matrix, 0, 0, 16, 6, "red");
  fillRect(matrix, 0, 6, 16, 10, "white");
  drawTinyText(matrix, day, 2, 1, "white");
  drawDateCutout(matrix, dayOfMonth, dayOfMonth.length === 1 ? 5 : 2, 8);
}

function fillRect(matrix: PixelMatrix, x: number, y: number, width: number, height: number, color: PixelColor): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPixel(matrix, col, row, color);
    }
  }
}

function drawTinyTextCutout(matrix: PixelMatrix, text: string, x: number, y: number): void {
  let cursor = x;
  for (const character of text.toUpperCase().slice(0, 3)) {
    const glyph = TINY_FONT[character] ?? TINY_FONT["?"];
    drawTinyGlyphCutout(matrix, glyph, cursor, y);
    cursor += 4;
  }
}

function drawTinyText(matrix: PixelMatrix, text: string, x: number, y: number, color: PixelColor): void {
  let cursor = x;
  for (const character of text.toUpperCase().slice(0, 3)) {
    const glyph = TINY_FONT[character] ?? TINY_FONT["?"];
    drawTinyGlyph(matrix, glyph, cursor, y, color);
    cursor += 4;
  }
}

function drawTinyGlyph(matrix: PixelMatrix, glyph: readonly string[], x: number, y: number, color: PixelColor): void {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") setPixel(matrix, x + col, y + row, color);
    }
  }
}

function drawTinyGlyphCutout(matrix: PixelMatrix, glyph: readonly string[], x: number, y: number): void {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") setPixel(matrix, x + col, y + row, "off");
    }
  }
}

function drawDateCutout(matrix: PixelMatrix, text: string, x: number, y: number): void {
  let cursor = x;
  for (const character of text.slice(0, 2)) {
    const glyph = DATE_FONT[character] ?? DATE_FONT["-"];
    drawTinyGlyphCutout(matrix, glyph, cursor, y);
    cursor += 6;
  }
}

function weekdayAbbreviation(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).slice(0, 3).toUpperCase();
}

const TINY_FONT: Record<string, readonly string[]> = {
  "?": ["111", "001", "011", "000", "010"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"],
  R: ["110", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  W: ["101", "101", "111", "111", "101"]
};

const DATE_FONT: Record<string, readonly string[]> = {
  "-": ["00000", "00000", "11111", "00000", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"]
};

function renderNextGameCardToMatrix(card: NormalizedDisplayCard): PixelMatrix {
  const matrix = createEmptyMatrix();
  const [line1 = "", line2 = ""] = card.matrixLines;

  drawCalendarIcon(matrix, card.game?.scheduledDate);
  drawText(matrix, fitDisplayLine(line1, 7), 19, 0, "orange");
  drawText(matrix, fitDisplayLine(line2, 7), 19, 8, "white");

  return matrix;
}

export function renderDisplayCardPreviewMatrix(card: NormalizedDisplayCard): PixelMatrix | PixelMatrix16x96 {
  return renderDisplayCardToDisplayMatrix16x96(card);
}

function renderNextGameCardToMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  const matrix = createMatrix16x96();
  const [line1 = "", line2 = ""] = card.matrixLines;

  drawCalendarIcon16x96(matrix, card.game?.scheduledDate);
  drawText16x96(matrix, fitDisplayLine(line1, 13), 18, 0, "orange");
  drawText16x96(matrix, fitDisplayLine(line2, 13), 18, 8, "white");

  return matrix;
}

function renderTextCardToMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  const matrix = createMatrix16x96();
  const [line1 = "", line2 = ""] = card.matrixLines;
  const topColor: PixelColor16x96 = card.type === "weather-current" ? "blue" : card.status === "live" ? "green" : "white";
  const bottomColor: PixelColor16x96 = card.type === "weather-current" ? "white" : card.status === "final" ? "orange" : "white";

  drawText16x96(matrix, fitDisplayLine(line1, 15), 3, 0, topColor);
  drawText16x96(matrix, fitDisplayLine(line2, 15), 3, 8, bottomColor);

  return matrix;
}

function renderFuelCardToMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  const matrix = createMatrix16x96();
  const [line1 = "", line2 = ""] = card.matrixLines;
  const fuelLine = fitDisplayLine(line2, 15);
  const dieselStart = fuelLine.indexOf("DSL");

  drawText16x96(matrix, fitDisplayLine(line1, 15), 3, 0, "yellow");

  if (dieselStart < 0) {
    drawText16x96(matrix, fuelLine, 3, 8, "red");
    return matrix;
  }

  const regularText = fuelLine.slice(0, dieselStart).trimEnd();
  const dieselText = fuelLine.slice(dieselStart);
  drawText16x96(matrix, regularText, 3, 8, "red");
  drawText16x96(matrix, dieselText, 3 + dieselStart * 6, 8, "green");

  return matrix;
}

function renderWeatherCardToMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  const matrix = createMatrix16x96();
  const temperature = card.weather?.temperature;
  const humidity = card.weather?.humidity;
  const rainNow = Boolean(card.weather?.rainNow);
  const blueCloud = rainNow || Boolean(card.weather?.rainWithinTwoHours);
  const [line1 = "", line2 = ""] = card.matrixLines;
  const tempText = temperature === undefined ? line1.split(" ")[0] ?? "--F" : `${temperature}F`;
  const humidityText = humidity === undefined ? line1.split(" ").slice(1).join(" ") || "H--" : `H${humidity}`;

  drawWeatherCloudIcon(matrix, 1, 3, blueCloud, rainNow);
  drawText16x96(matrix, fitDisplayLine(tempText, 5), 23, 0, "red");
  drawText16x96(matrix, fitDisplayLine(humidityText, 5), 60, 0, "blue");
  drawText16x96(matrix, fitDisplayLine(line2, 11), 23, 8, rainNow ? "blue" : "white");

  return matrix;
}

function renderDateTimeCardToMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  const matrix = createMatrix16x96();
  const [line1 = "", line2 = ""] = card.matrixLines;

  drawCalendarIcon16x96(matrix, card.dateTime?.scheduledDate ?? card.calendar?.event?.startTime);
  drawText16x96(matrix, fitDisplayLine(line1, 13), 18, 0, "orange");
  drawText16x96(matrix, fitDisplayLine(line2, 13), 18, 8, "white");
  if (card.calendar?.isBirthday) drawCakeIcon16x96(matrix, 87, 0);

  return matrix;
}

function renderMoonCardToMatrix16x96(card: NormalizedDisplayCard): PixelMatrix16x96 {
  const matrix = createMatrix16x96();
  const [line1 = "", line2 = ""] = card.matrixLines;

  drawMoonIcon(matrix, 8, 8, 7, card.moon?.illumination ?? 0, card.moon?.waxing ?? true);
  drawText16x96(matrix, fitDisplayLine(line1, 12), 20, 0, "yellow");
  drawText16x96(matrix, fitDisplayLine(line2, 12), 20, 8, "white");

  return matrix;
}

function drawMoonIcon(matrix: PixelMatrix16x96, centerX: number, centerY: number, radius: number, illumination: number, waxing: boolean): void {
  const clampedIllumination = Math.max(0, Math.min(1, illumination));
  const diameter = radius * 2 + 1;
  const litColumns = clampedIllumination >= 0.97 ? diameter : clampedIllumination <= 0.03 ? 0 : Math.floor(diameter * clampedIllumination);
  const litStart = waxing ? centerX - radius + (diameter - litColumns) : centerX - radius;
  const litEnd = litStart + litColumns - 1;

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radius * radius) continue;

      const isLit = x >= litStart && x <= litEnd;
      const isTopOrBottomEdge = Math.abs(dy) >= radius - 1;
      setPixel16x96(matrix, x, y, isTopOrBottomEdge ? "white" : isLit ? "yellow" : "gray");
    }
  }
}

function drawWeatherCloudIcon(matrix: PixelMatrix16x96, x: number, y: number, blueCloud: boolean, rainNow: boolean): void {
  const color: PixelColor16x96 = blueCloud ? "blue" : "white";
  const cloudPixels = [
    [5, 0],
    [6, 0],
    [7, 0],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 1],
    [7, 1],
    [8, 1],
    [9, 1],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 2],
    [6, 2],
    [7, 2],
    [8, 2],
    [9, 2],
    [10, 2],
    [11, 2],
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 3],
    [6, 3],
    [7, 3],
    [8, 3],
    [9, 3],
    [10, 3],
    [11, 3],
    [12, 3],
    [13, 3],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
    [6, 4],
    [7, 4],
    [8, 4],
    [9, 4],
    [10, 4],
    [11, 4],
    [12, 4]
  ];

  for (const [px, py] of cloudPixels) {
    setPixel16x96(matrix, x + px, y + py, color);
  }

  if (!rainNow) return;
  for (const [px, py] of [
    [4, 7],
    [8, 7],
    [12, 7],
    [5, 10],
    [9, 10],
    [13, 10]
  ]) {
    setPixel16x96(matrix, x + px, y + py, "blue");
  }
}

function drawCakeIcon16x96(matrix: PixelMatrix16x96, x: number, y: number): void {
  const pixels: Array<[number, number, PixelColor16x96]> = [
    [4, 0, "orange"],
    [4, 1, "yellow"],
    [2, 3, "white"],
    [3, 3, "white"],
    [4, 3, "white"],
    [5, 3, "white"],
    [6, 3, "white"],
    [1, 4, "purple"],
    [2, 4, "purple"],
    [3, 4, "purple"],
    [4, 4, "purple"],
    [5, 4, "purple"],
    [6, 4, "purple"],
    [7, 4, "purple"],
    [1, 5, "white"],
    [3, 5, "white"],
    [5, 5, "white"],
    [7, 5, "white"],
    [1, 6, "purple"],
    [2, 6, "purple"],
    [3, 6, "purple"],
    [4, 6, "purple"],
    [5, 6, "purple"],
    [6, 6, "purple"],
    [7, 6, "purple"],
    [0, 7, "orange"],
    [1, 7, "orange"],
    [2, 7, "orange"],
    [3, 7, "orange"],
    [4, 7, "orange"],
    [5, 7, "orange"],
    [6, 7, "orange"],
    [7, 7, "orange"],
    [8, 7, "orange"]
  ];

  for (const [px, py, color] of pixels) {
    setPixel16x96(matrix, x + px, y + py, color);
  }
}

function drawCalendarIcon16x96(matrix: PixelMatrix16x96, scheduledDate: string | undefined): void {
  const date = scheduledDate ? new Date(scheduledDate) : undefined;
  const day = date && !Number.isNaN(date.getTime()) ? weekdayAbbreviation(date) : "TBD";
  const dayOfMonth = date && !Number.isNaN(date.getTime()) ? String(date.getDate()) : "--";

  fillRect16x96(matrix, 0, 0, 16, 6, "red");
  fillRect16x96(matrix, 0, 6, 16, 10, "white");
  drawTinyText16x96(matrix, day, 2, 1, "white");
  drawDateCutout16x96(matrix, dayOfMonth, dayOfMonth.length === 1 ? 5 : 2, 8);
}

function fillRect16x96(matrix: PixelMatrix16x96, x: number, y: number, width: number, height: number, color: PixelColor16x96): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPixel16x96(matrix, col, row, color);
    }
  }
}

function drawTinyText16x96(matrix: PixelMatrix16x96, text: string, x: number, y: number, color: PixelColor16x96): void {
  let cursor = x;
  for (const character of text.toUpperCase().slice(0, 3)) {
    const glyph = TINY_FONT[character] ?? TINY_FONT["?"];
    drawTinyGlyph16x96(matrix, glyph, cursor, y, color);
    cursor += 4;
  }
}

function drawTinyGlyph16x96(matrix: PixelMatrix16x96, glyph: readonly string[], x: number, y: number, color: PixelColor16x96): void {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") setPixel16x96(matrix, x + col, y + row, color);
    }
  }
}

function drawDateCutout16x96(matrix: PixelMatrix16x96, text: string, x: number, y: number): void {
  let cursor = x;
  for (const character of text.slice(0, 2)) {
    const glyph = DATE_FONT[character] ?? DATE_FONT["-"];
    drawTinyGlyphCutout16x96(matrix, glyph, cursor, y);
    cursor += 6;
  }
}

function drawTinyGlyphCutout16x96(matrix: PixelMatrix16x96, glyph: readonly string[], x: number, y: number): void {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") setPixel16x96(matrix, x + col, y + row, "off");
    }
  }
}
