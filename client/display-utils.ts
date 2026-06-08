import type { DisplayCard, RotationPayload } from "./types.js";

export function availableCards(payload?: RotationPayload): DisplayCard[] {
  return payload?.rotation?.cards ?? [];
}

export function cardForId(payload: RotationPayload | undefined, id: string | undefined): DisplayCard | undefined {
  return availableCards(payload).find((card) => card.id === id);
}

export function visibleCard(payload: RotationPayload | undefined, id: string | undefined): DisplayCard | undefined {
  if (!payload) return undefined;
  return cardForId(payload, id) ?? payload.rotation?.activeCard ?? {
    title: "NBA Legacy",
    status: payload.game.status,
    readableLines: payload.game.displayLines,
    dotMatrix: payload.dotMatrix
  };
}

export function statusText(status = "loading"): string {
  if (status === "no_game") return "No game found";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatGameDetails(card: DisplayCard): string {
  const game = card.game;
  if (!game) return `${card.type ?? "display"} | ${card.league ?? "stats"}`;
  if (game.status === "live") return `Quarter/clock: Q${game.period ?? "-"} ${game.clock ?? ""}`.trim();
  if (game.status === "scheduled") return `Scheduled: ${game.scheduledTime ?? "time unavailable"}`;
  if (game.status === "final") return "Final";
  return "Quarter/clock: not available";
}
