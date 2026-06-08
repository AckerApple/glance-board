import { getGlyph } from "./font5x7.js";
import { sanitizeDisplayText } from "./text-sanitizer.js";

export const MATRIX_WIDTH_16X96 = 96;
export const MATRIX_HEIGHT_16X96 = 16;

export type PixelColor = "off" | "green" | "blue" | "white" | "orange" | "yellow" | "purple" | "red" | "gray";
export type PixelMatrix = PixelColor[][];

export function createMatrix16x96(): PixelMatrix {
  return Array.from({ length: MATRIX_HEIGHT_16X96 }, () => Array.from({ length: MATRIX_WIDTH_16X96 }, () => "off"));
}

export function setPixel(matrix: PixelMatrix, x: number, y: number, value: PixelColor = "white"): void {
  if (y < 0 || y >= MATRIX_HEIGHT_16X96 || x < 0 || x >= MATRIX_WIDTH_16X96) return;
  matrix[y][x] = value;
}

export function drawText(matrix: PixelMatrix, text: string, x: number, y: number, color: PixelColor = "white"): void {
  drawTextWithAdvance(matrix, text, x, y, color, 6);
}

export function drawTightText(matrix: PixelMatrix, text: string, x: number, y: number, color: PixelColor = "white"): void {
  drawTextWithAdvance(matrix, text, x, y, color, 5);
}

function drawTextWithAdvance(matrix: PixelMatrix, text: string, x: number, y: number, color: PixelColor, advance: number): void {
  let cursor = x;
  for (const character of sanitizeDisplayText(text).toUpperCase()) {
    const glyph = getGlyph(character);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === "1") setPixel(matrix, cursor + col, y + row, color);
      }
    }
    cursor += advance;
  }
}

export function renderTextToMatrix16x96(text: string): PixelMatrix {
  const matrix = createMatrix16x96();
  const normalized = sanitizeDisplayText(text).slice(0, 15);
  const textWidth = Math.max(0, normalized.length * 6 - 1);
  drawText(matrix, normalized, Math.max(0, Math.floor((MATRIX_WIDTH_16X96 - textWidth) / 2)), 4, "white");
  return matrix;
}

export function assertMatrix16x96(matrix: PixelMatrix): void {
  if (matrix.length !== MATRIX_HEIGHT_16X96) throw new Error(`Expected ${MATRIX_HEIGHT_16X96} matrix rows, got ${matrix.length}`);
  for (const [rowIndex, row] of matrix.entries()) {
    if (row.length !== MATRIX_WIDTH_16X96) throw new Error(`Expected row ${rowIndex} to have ${MATRIX_WIDTH_16X96} columns, got ${row.length}`);
  }
}

export function matrixToAscii(matrix: PixelMatrix): string {
  return matrix
    .map((row) =>
      row
        .map((pixel) => {
          if (pixel === "green") return "G";
          if (pixel === "blue") return "B";
          if (pixel === "orange") return "O";
          if (pixel === "red") return "R";
          if (pixel === "yellow") return "Y";
          if (pixel === "purple") return "P";
          if (pixel === "gray") return "A";
          if (pixel === "white") return "#";
          return ".";
        })
        .join("")
    )
    .join("\n");
}
