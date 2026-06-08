import type { PixelColor, PixelMatrix } from "./types.js";

const colors: Record<PixelColor, string> = {
  off: "#050505",
  green: "#34d45c",
  blue: "#4ea1ff",
  white: "#f8f8f8",
  orange: "#ff8a24",
  red: "#ef4338",
  yellow: "#ffd24a",
  purple: "#b061ff",
  gray: "#8b929e"
};

export function scheduleMatrixDraw(id: string, matrix: PixelMatrix, intensity: number): void {
  window.requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!(canvas instanceof HTMLCanvasElement)) return;
    drawMatrix(canvas, matrix, intensity);
  });
}

function drawMatrix(canvas: HTMLCanvasElement, matrix: PixelMatrix, intensity: number): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const cell = 10;
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  matrix.forEach((row, y) => {
    row.forEach((pixel, x) => {
      context.fillStyle = scaleColor(colors[pixel] ?? colors.off, pixel === "off" ? 1 : intensity);
      context.beginPath();
      context.arc(x * cell + 5, y * cell + 5, 3.8, 0, Math.PI * 2);
      context.fill();
    });
  });
}

function scaleColor(hex: string, intensity: number): string {
  if (intensity >= 1 || hex === colors.off) return hex;
  const red = Math.round(Number.parseInt(hex.slice(1, 3), 16) * intensity);
  const green = Math.round(Number.parseInt(hex.slice(3, 5), 16) * intensity);
  const blue = Math.round(Number.parseInt(hex.slice(5, 7), 16) * intensity);
  return `rgb(${red}, ${green}, ${blue})`;
}
