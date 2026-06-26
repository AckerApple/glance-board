import { DisplayItemConfig } from "../rotation/types.js";
import { sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

export class DateTimeProvider {
  resolve(_config: DisplayItemConfig, now = new Date()) {
    const timeLine = formatFullTime(now);
    const dateLine = formatMonthDay(now);
    return {
      dateTime: {
        iso: now.toISOString(),
        scheduledDate: now.toISOString()
      },
      readableLines: sanitizeDisplayLines([timeLine, dateLine]),
      matrixLines: sanitizeDisplayLines([timeLine, dateLine]),
      debug: {
        iso: now.toISOString()
      }
    };
  }
}

function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric"
  })
    .format(date)
    .replace(",", "")
    .toUpperCase();
}

function formatFullTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .format(date)
    .replace(/\s+/g, "")
    .toUpperCase();
}
