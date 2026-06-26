import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DisplayCategoryConfig, DisplayItemConfig, DisplayItemsConfig } from "./types.js";

const defaultConfigPath = path.resolve(process.cwd(), "config/display-items.json");
const DEFAULT_CATEGORIES: DisplayCategoryConfig[] = [
  { id: "sports", label: "Sports", icon: "sports" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "local-info", label: "Local Info", icon: "local-info" },
  { id: "time", label: "Time", icon: "time" },
  { id: "moon", label: "Moon", icon: "moon" }
];

const BUILT_IN_DISPLAY_ITEMS: DisplayItemConfig[] = [
  { id: "nba-finals-live", enabled: false, categoryId: "sports", type: "sports-live-score", league: "nba", mode: "finals" },
  { id: "nba-finals-next", enabled: false, categoryId: "sports", type: "sports-next-game", league: "nba", mode: "finals" },
  { id: "nhl-stanley-cup-next", enabled: false, categoryId: "sports", type: "sports-next-game", league: "nhl", mode: "finals" },
  { id: "miami-dolphins-next", enabled: false, categoryId: "sports", type: "sports-next-game", league: "nfl", team: "MIA" },
  { id: "miami-marlins-next", enabled: false, categoryId: "sports", type: "sports-next-game", league: "mlb", team: "MIA" },
  { id: "local-weather", enabled: false, categoryId: "local-info", type: "weather-current", zip: "33066" },
  { id: "current-date-time", enabled: false, categoryId: "time", type: "date-time" },
  { id: "moon-phase", enabled: false, categoryId: "moon", type: "moon-phase" },
  { id: "local-fuel-average", enabled: false, categoryId: "local-info", type: "fuel-average", zip: "33066" },
  { id: "internet-status", enabled: false, categoryId: "local-info", type: "internet-status" }
];

export async function loadDisplayItemsConfig(configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath): Promise<DisplayItemsConfig> {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as DisplayItemsConfig;
  const categories = normalizeCategories(parsed.categories);
  const configuredItems = Array.isArray(parsed.items) ? parsed.items : [];
  return {
    rotationSeconds: normalizeRotationSeconds(parsed.rotationSeconds),
    categories,
    items: mergeBuiltInDisplayItems(configuredItems).map((item) => normalizeDisplayItemCategory(item, categories))
  };
}

export async function saveDisplayItemsConfig(config: DisplayItemsConfig, configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function setDisplayItemEnabled(id: string, enabled: boolean, configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath): Promise<DisplayItemsConfig> {
  const config = await loadDisplayItemsConfig(configPath);
  const item = config.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Display item not found: ${id}`);
  item.enabled = enabled;
  await saveDisplayItemsConfig(config, configPath);
  return config;
}

export async function setDisplayItemCategory(id: string, categoryId: string, configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath): Promise<DisplayItemsConfig> {
  const config = await loadDisplayItemsConfig(configPath);
  if (!config.categories?.some((category) => category.id === categoryId)) throw new Error(`Display category not found: ${categoryId}`);
  const item = config.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Display item not found: ${id}`);
  item.categoryId = categoryId;
  await saveDisplayItemsConfig(config, configPath);
  return config;
}

function normalizeRotationSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 10;
  return Math.max(2, Math.min(300, seconds));
}

function normalizeCategories(value: unknown): DisplayCategoryConfig[] {
  const supplied = Array.isArray(value) ? value.filter(isDisplayCategoryConfig) : [];
  const merged = new Map(DEFAULT_CATEGORIES.map((category) => [category.id, category]));
  for (const category of supplied) merged.set(category.id, category);
  return [...merged.values()];
}

function mergeBuiltInDisplayItems(items: DisplayItemConfig[]): DisplayItemConfig[] {
  const configuredById = new Map(items.map((item) => [item.id, item]));
  const merged = BUILT_IN_DISPLAY_ITEMS.map((builtIn) => ({ ...builtIn, ...configuredById.get(builtIn.id) }));
  const builtInIds = new Set(BUILT_IN_DISPLAY_ITEMS.map((item) => item.id));
  return [
    ...merged,
    ...items.filter((item) => !builtInIds.has(item.id))
  ];
}

function normalizeDisplayItemCategory(item: DisplayItemConfig, categories: DisplayCategoryConfig[]): DisplayItemConfig {
  const categoryIds = new Set(categories.map((category) => category.id));
  const categoryId = item.categoryId && categoryIds.has(item.categoryId) ? item.categoryId : inferCategoryId(item);
  return {
    ...item,
    categoryId: categoryIds.has(categoryId) ? categoryId : "local-info"
  };
}

function inferCategoryId(item: DisplayItemConfig): string {
  if (item.type === "sports-live-score" || item.type === "sports-next-game") return "sports";
  if (item.type === "google-calendar-next-event" || item.type === "icloud-calendar-next-event") return "calendar";
  if (item.type === "date-time") return "time";
  if (item.type === "moon-phase") return "moon";
  return "local-info";
}

function isDisplayCategoryConfig(value: unknown): value is DisplayCategoryConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DisplayCategoryConfig>;
  return typeof candidate.id === "string" && typeof candidate.label === "string" && typeof candidate.icon === "string";
}
