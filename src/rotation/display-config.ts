import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { configDir } from "../server/local-config.js";
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

export async function loadDisplayItemsConfig(configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath, sourceDirectory = configDir): Promise<DisplayItemsConfig> {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as DisplayItemsConfig;
  const categories = normalizeCategories(parsed.categories);
  const configuredItems = await configuredCalendarItems(Array.isArray(parsed.items) ? parsed.items : [], sourceDirectory);
  const excludedBuiltInIds = Array.isArray(parsed.excludedBuiltInIds) ? [...new Set(parsed.excludedBuiltInIds.filter(isBuiltInDisplayItemId))] : [];
  return {
    ...(excludedBuiltInIds.length ? { excludedBuiltInIds } : {}),
    rotationSeconds: normalizeRotationSeconds(parsed.rotationSeconds),
    categories,
    items: mergeBuiltInDisplayItems(configuredItems, new Set(excludedBuiltInIds)).map((item) => normalizeDisplayItemCategory(item, categories))
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

export function isBuiltInDisplayItemId(id: unknown): id is string {
  return typeof id === "string" && BUILT_IN_DISPLAY_ITEMS.some(item => item.id === id);
}

function mergeBuiltInDisplayItems(items: DisplayItemConfig[], excluded: ReadonlySet<string>): DisplayItemConfig[] {
  const configuredById = new Map(items.map((item) => [item.id, item]));
  const merged = BUILT_IN_DISPLAY_ITEMS.filter(item => !excluded.has(item.id) || configuredById.has(item.id)).map((builtIn) => ({ ...builtIn, ...configuredById.get(builtIn.id) }));
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


interface CalendarSourceSettings { calendarId?: string; calendarIds?: string[] }

// Only installer-owned slides are eligible. Legacy installer IDs are recognized
// narrowly; arbitrary/manual calendar cards remain untouched.
export function removeOrphanedCalendarItems(
  items: DisplayItemConfig[],
  sources: Partial<Record<"google" | "icloud", string[]>>
): DisplayItemConfig[] {
  return items.filter(item => {
    const provider = item.type === "google-calendar-next-event" ? "google"
      : item.type === "icloud-calendar-next-event" ? "icloud" : undefined;
    if (!provider || !new RegExp(`^${provider}-calendar-next-[1-9]\\d*$`).test(item.id)) return true;
    const selected = sources[provider];
    // Unknown/unreadable settings are not evidence that a source was deleted.
    if (selected === undefined) return true;
    return selected.length > 0 && (!item.calendarId || selected.includes(item.calendarId));
  });
}

async function configuredCalendarItems(items: DisplayItemConfig[], directory: string): Promise<DisplayItemConfig[]> {
  const sources: Partial<Record<"google" | "icloud", string[]>> = {};
  for (const provider of ["google", "icloud"] as const) {
    try {
      const auth = path.join(directory, provider === "google" ? "google-calendar-token.json" : "icloud-calendar-credentials.json");
      await stat(auth);
      const settings = JSON.parse(await readFile(path.join(directory, `${provider}-calendar.json`), "utf8")) as CalendarSourceSettings;
      if (!settings || typeof settings !== "object") continue;
      if (settings.calendarIds !== undefined && (!Array.isArray(settings.calendarIds) || settings.calendarIds.some(id => typeof id !== "string"))) continue;
      if (settings.calendarId !== undefined && typeof settings.calendarId !== "string") continue;
      sources[provider] = (settings.calendarIds ?? (settings.calendarId ? [settings.calendarId] : [])).filter(id => id.trim());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") sources[provider] = [];
    }
  }
  return removeOrphanedCalendarItems(items, sources);
}

// Reconcile persisted orphaned slots on startup and source edits. Preserve the
// complete previous file in a unique sibling backup before removing any slots.
export async function cleanupOrphanedCalendarItems(configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath, sourceDirectory = configDir): Promise<number> {
  const original = await readFile(configPath, "utf8");
  const config = JSON.parse(original) as DisplayItemsConfig;
  if (!Array.isArray(config.items)) return 0;
  const items = await configuredCalendarItems(config.items, sourceDirectory);
  const removed = config.items.length - items.length;
  if (!removed) return 0;
  await writeFile(`${configPath}.calendar-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}.bak`, original, { flag: "wx" });
  await writeFile(configPath, `${JSON.stringify({ ...config, items }, null, 2)}\n`, "utf8");
  return removed;
}
