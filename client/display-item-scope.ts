import type { DisplayItem } from "./types.js";

export type DisplayItemScope = "sports" | "local-data" | "other";
// Settings ownership follows the provider, not a user-editable rotation category.
// Filtering settings must never filter the playback queue.
export function displayItemScope(item: Pick<DisplayItem, "type">): DisplayItemScope {
  if (item.type === "sports-live-score" || item.type === "sports-next-game") return "sports";
  if (["weather-current", "fuel-average", "internet-status", "moon-phase", "date-time"].includes(item.type ?? "")) return "local-data";
  return "other";
}
