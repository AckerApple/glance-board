import { DisplayItemConfig } from "../rotation/types.js";
import { sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

export class DateTimeProvider {
  resolve(_config: DisplayItemConfig, now = new Date()) {
    const dateLine = formatFullDate(now);
    const timeLine = formatFullTime(now);
    return {
      dateTime: {
        iso: now.toISOString(),
        scheduledDate: now.toISOString()
      },
      readableLines: sanitizeDisplayLines([dateLine, timeLine]),
      matrixLines: sanitizeDisplayLines([dateLine, timeLine]),
      debug: {
        iso: now.toISOString()
      }
    };
  }
}

function formatFullDate(date: Date): string {
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase();
  return `${month}${date.getDate()} ${date.getFullYear()}`;
}

function formatFullTime(date: Date): string {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).toUpperCase();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .format(date)
    .replace(/\s+/g, "")
    .toUpperCase();
  return `${weekday} ${time}`;
}
