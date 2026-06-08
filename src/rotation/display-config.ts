import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DisplayItemsConfig } from "./types.js";

const defaultConfigPath = path.resolve(process.cwd(), "config/display-items.json");

export async function loadDisplayItemsConfig(configPath = process.env.DISPLAY_ITEMS_CONFIG ?? defaultConfigPath): Promise<DisplayItemsConfig> {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as DisplayItemsConfig;
  return {
    rotationSeconds: normalizeRotationSeconds(parsed.rotationSeconds),
    items: Array.isArray(parsed.items) ? parsed.items : []
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

function normalizeRotationSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 10;
  return Math.max(2, Math.min(300, seconds));
}
