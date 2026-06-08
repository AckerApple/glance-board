import { DisplayItemResolver } from "./display-item-resolver.js";
import { loadDisplayItemsConfig } from "./display-config.js";
import { NormalizedDisplayCard, RotationDisplayState } from "./types.js";

const DEFAULT_REFRESH_INTERVAL_SECONDS = 15;

export class RotationEngine {
  private activeIndex = 0;
  private latestCards: NormalizedDisplayCard[] = [];

  constructor(
    private readonly resolver: Pick<DisplayItemResolver, "resolve"> = new DisplayItemResolver(),
    private readonly loadConfig: typeof loadDisplayItemsConfig = loadDisplayItemsConfig,
    private readonly refreshIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS
  ) {}

  async refresh(): Promise<RotationDisplayState> {
    const config = await this.loadConfig();
    const enabledItems = config.items.filter((item) => item.enabled);
    const cards = await Promise.all(enabledItems.map((item) => this.resolver.resolve(item)));
    this.latestCards = cards;
    this.activeIndex = normalizeIndex(this.activeIndex, cards.length);
    const lastUpdated = new Date().toISOString();

    return {
      rotationSeconds: config.rotationSeconds,
      refreshIntervalSeconds: this.refreshIntervalSeconds,
      items: config.items.map((item) => ({
        ...item,
        resolved: cards.some((card) => card.id === item.id),
        error: cards.find((card) => card.id === item.id)?.error,
        lastUpdated: item.enabled ? lastUpdated : undefined,
        lastUpdatedAgeMinutes: item.enabled ? 0 : undefined,
        refreshIntervalSeconds: item.enabled ? this.refreshIntervalSeconds : undefined
      })),
      cards,
      activeCard: cards[this.activeIndex],
      lastUpdated,
      debug: {
        enabledItems: enabledItems.length,
        activeIndex: this.activeIndex
      }
    };
  }

  next(): NormalizedDisplayCard | undefined {
    if (this.latestCards.length === 0) return undefined;
    this.activeIndex = (this.activeIndex + 1) % this.latestCards.length;
    return this.latestCards[this.activeIndex];
  }

  select(id: string): NormalizedDisplayCard | undefined {
    const index = this.latestCards.findIndex((card) => card.id === id);
    if (index < 0) return undefined;
    this.activeIndex = index;
    return this.latestCards[index];
  }
}

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}
