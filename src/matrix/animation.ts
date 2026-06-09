import { assertMatrix16x96, createMatrix16x96, MATRIX_HEIGHT_16X96, PixelMatrix } from "./core16x96.js";

export interface ScrollAnimationOptions {
  durationMs?: number;
  fps?: number;
}

export function buildScrollDownFrames(
  current: PixelMatrix,
  next: PixelMatrix,
  options: ScrollAnimationOptions = {}
): PixelMatrix[] {
  assertMatrix16x96(current);
  assertMatrix16x96(next);

  const durationMs = Math.max(100, options.durationMs ?? 2_000);
  const fps = Math.max(1, Math.min(60, options.fps ?? 10));
  const frameCount = Math.max(2, Math.round((durationMs / 1000) * fps) + 1);

  return Array.from({ length: frameCount }, (_, index) => {
    const offset = Math.round((MATRIX_HEIGHT_16X96 * index) / (frameCount - 1));
    return composeVerticalOffsetFrame(current, next, offset);
  });
}

function composeVerticalOffsetFrame(current: PixelMatrix, next: PixelMatrix, offset: number): PixelMatrix {
  const frame = createMatrix16x96();
  for (let y = 0; y < MATRIX_HEIGHT_16X96; y += 1) {
    const currentY = y - offset;
    const nextY = MATRIX_HEIGHT_16X96 + y - offset;
    frame[y] = currentY >= 0
      ? [...current[currentY]]
      : nextY >= 0 && nextY < MATRIX_HEIGHT_16X96
        ? [...next[nextY]]
        : frame[y];
  }
  return frame;
}
