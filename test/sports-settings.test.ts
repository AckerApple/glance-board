import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SportsSettingsService, FAVORITE_TEAMS } from "../src/providers/sports-settings-service.js";
import { loadDisplayItemsConfig, saveDisplayItemsConfig } from "../src/rotation/display-config.js";
import type { DisplayItemConfig } from "../src/rotation/types.js";

test("Sports initializes favorite teams once and survives built-in removal and re-add", async context => {
  const dir = await mkdtemp(path.join(tmpdir(), "glance-sports-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "display-items.json");
  const existing: DisplayItemConfig = { id: "miami-dolphins-next", team: "MIA", enabled: false, type: "sports-next-game", league: "nfl", categoryId: "custom" };
  const manual: DisplayItemConfig = { id: "manual-hockey", enabled: true, type: "sports-next-game", league: "nhl", team: "DAL", categoryId: "custom" };
  await writeFile(configPath, JSON.stringify({ rotationSeconds: 21, items: [existing, manual], categories: [{ id: "custom", label: "Custom", icon: "generic" }] }));
  let done = false;
  const load = () => loadDisplayItemsConfig(configPath, dir);
  const store = { load, save: (config: Awaited<ReturnType<typeof load>>) => saveDisplayItemsConfig(config, configPath),
    initialized: async () => done, markInitialized: async () => { done = true; } };
  const service = new SportsSettingsService(store, async () => { throw new Error("Known favorites should not make a network request"); });
  await service.initialize();
  const first = await load();
  assert.equal(first.rotationSeconds, 21);
  assert.deepEqual(first.items.find(item => item.id === existing.id), { ...existing, teamId: "15", teamName: "Miami Dolphins" });
  assert.deepEqual(first.items.find(item => item.id === manual.id), manual);
  assert.equal((await service.selected()).length, FAVORITE_TEAMS.length);
  for (const team of FAVORITE_TEAMS) assert.equal(first.items.filter(item => item.teamId === team.id && item.league === team.league).length, 2);
  await service.initialize();
  assert.deepEqual(await load(), first);

  await service.remove("nfl", "15");
  const fresh = new SportsSettingsService(store);
  await fresh.initialize();
  assert.ok(!(await fresh.selected()).some(team => team.league === "nfl" && team.id === "15"));
  assert.ok((await fresh.selected()).some(team => team.league === "mlb" && team.id === "28"));
  assert.ok((await fresh.selected()).some(team => team.league === "nba" && team.id === "14"));
  assert.ok(!(await load()).items.some(item => item.id === existing.id));
  assert.deepEqual((await load()).items.find(item => item.id === manual.id), manual);
  await fresh.add("nfl", "15");
  await fresh.add("nfl", "15");
  const restored = await load();
  assert.equal(restored.items.find(item => item.id === existing.id)?.enabled, true);
  assert.equal(restored.items.filter(item => item.league === "nfl" && item.teamId === "15").length, 2);
  assert.ok(!restored.excludedBuiltInIds?.includes(existing.id));
});
