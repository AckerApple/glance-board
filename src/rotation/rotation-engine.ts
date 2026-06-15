import { DisplayItemResolver } from "./display-item-resolver.js";
import { loadDisplayItemsConfig } from "./display-config.js";
import { DisplayItemConfig, NormalizedDisplayCard, RotationDisplayState } from "./types.js";

const DEFAULT_REFRESH_INTERVAL_SECONDS = 15;

interface CachedCard {
  card: NormalizedDisplayCard;
  item: DisplayItemConfig;
  configSignature: string;
  updatedAtMs: number;
}

export class RotationEngine {
  private activeIndex = 0;
  private latestCards: NormalizedDisplayCard[] = [];
  private readonly cache = new Map<string, CachedCard>();

  constructor(
    private readonly resolver: Pick<DisplayItemResolver, "resolve"> = new DisplayItemResolver(),
    private readonly loadConfig: typeof loadDisplayItemsConfig = loadDisplayItemsConfig,
    private readonly refreshIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS
  ) {}

  async refresh(): Promise<RotationDisplayState> {
    const config = await this.loadConfig();
    const enabledItems = config.items.filter((item) => item.enabled);
    const nowMs = Date.now();
    const cards = await Promise.all(enabledItems.map((item) => this.resolveWithCache(item, nowMs)));
    this.latestCards = cards;
    this.activeIndex = normalizeIndex(this.activeIndex, cards.length);
    const lastUpdated = new Date(nowMs).toISOString();

    return {
      rotationSeconds: config.rotationSeconds,
      refreshIntervalSeconds: this.refreshIntervalSeconds,
      categories: config.categories ?? [],
      items: config.items.map((item) => ({
        ...item,
        resolved: cards.some((card) => card.id === item.id),
        error: cards.find((card) => card.id === item.id)?.error,
        lastUpdated: item.enabled && this.cache.get(item.id)?.updatedAtMs ? new Date(this.cache.get(item.id)!.updatedAtMs).toISOString() : undefined,
        lastUpdatedAgeMinutes: item.enabled ? this.cacheAgeMinutes(item.id, nowMs) : undefined,
        refreshIntervalSeconds: item.enabled ? refreshIntervalSecondsForItem(item) : undefined
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

  invalidate(predicate?: (item: DisplayItemConfig) => boolean): void {
    if (!predicate) {
      this.cache.clear();
      return;
    }

    for (const [id, cached] of this.cache) {
      if (predicate(cached.item)) this.cache.delete(id);
    }
  }

  private async resolveWithCache(item: DisplayItemConfig, nowMs: number): Promise<NormalizedDisplayCard> {
    const cached = this.cache.get(item.id);
    const configSignature = JSON.stringify(item);
    const refreshMs = refreshIntervalSecondsForItem(item) * 1000;
    if (cached && cached.configSignature === configSignature && nowMs - cached.updatedAtMs < refreshMs) {
      return cached.card;
    }

    const card = await this.resolver.resolve(item);
    this.cache.set(item.id, { card, item, configSignature, updatedAtMs: nowMs });
    return card;
  }

  private cacheAgeMinutes(id: string, nowMs: number): number | undefined {
    const cached = this.cache.get(id);
    if (!cached) return undefined;
    return Math.max(0, Math.floor((nowMs - cached.updatedAtMs) / 60_000));
  }
}

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function refreshIntervalSecondsForItem(item: DisplayItemConfig): number {
  if (item.type === "google-calendar-next-event" || item.type === "icloud-calendar-next-event") return 5 * 60;
  if (item.type === "sports-next-game") return 30 * 60;
  if (item.type === "moon-phase") return 60 * 60;
  if (item.type === "weather-current") return 5 * 60;
  if (item.type === "internet-status") return 5 * 60;
  if (item.type === "date-time") return 45;
  if (item.type === "fuel-average") return 15 * 60;
  return DEFAULT_REFRESH_INTERVAL_SECONDS;
}
