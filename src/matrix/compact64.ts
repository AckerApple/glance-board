import { getGlyph } from "./font5x7.js";
import { sanitizeDisplayText } from "./text-sanitizer.js";

export const MATRIX_WIDTH = 64;
export const MATRIX_HEIGHT = 16;

export type PixelColor = "off" | "green" | "blue" | "white" | "orange" | "red" | "gray";
export type PixelMatrix = PixelColor[][];

export function createEmptyMatrix(): PixelMatrix {
  return Array.from({ length: MATRIX_HEIGHT }, () => Array.from({ length: MATRIX_WIDTH }, () => "off"));
}

export function setPixel(matrix: PixelMatrix, x: number, y: number, value: PixelColor = "white"): void {
  if (y < 0 || y >= MATRIX_HEIGHT || x < 0 || x >= MATRIX_WIDTH) return;
  matrix[y][x] = value;
}

export function drawText(matrix: PixelMatrix, text: string, x: number, y: number, color: PixelColor = "white"): void {
  let cursor = x;
  for (const character of sanitizeDisplayText(text).toUpperCase()) {
    const glyph = getGlyph(character);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === "1") setPixel(matrix, cursor + col, y + row, color);
      }
    }
    cursor += 6;
  }
}
