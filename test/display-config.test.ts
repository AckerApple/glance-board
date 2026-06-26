import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadDisplayItemsConfig, setDisplayItemCategory, setDisplayItemEnabled } from "../src/rotation/display-config.js";

test("setDisplayItemEnabled saves enabled state to display items JSON", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glanceboard-display-config-"));
  const configPath = path.join(dir, "display-items.json");
  await writeFile(configPath, JSON.stringify({
    rotationSeconds: 10,
    items: [
      { id: "weather", enabled: true, type: "weather-current", zip: "33066" },
      { id: "date", enabled: false, type: "date-time" }
    ]
  }), "utf8");

  const config = await setDisplayItemEnabled("date", true, configPath);
  const saved = JSON.parse(await readFile(configPath, "utf8")) as typeof config;

  assert.equal(config.items.find((item) => item.id === "date")?.enabled, true);
  assert.equal(saved.items.find((item) => item.id === "date")?.enabled, true);
  assert.equal(saved.items.find((item) => item.id === "weather")?.enabled, true);
});

test("display item config infers categories and saves category assignments", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glanceboard-display-config-"));
  const configPath = path.join(dir, "display-items.json");
  await writeFile(configPath, JSON.stringify({
    rotationSeconds: 10,
    items: [
      { id: "next-game", enabled: true, type: "sports-next-game", league: "nba" },
      { id: "weather", enabled: true, type: "weather-current", zip: "33066" }
    ]
  }), "utf8");

  const loaded = await loadDisplayItemsConfig(configPath);
  assert.equal(loaded.categories?.find((category) => category.id === "sports")?.label, "Sports");
  assert.equal(loaded.items.find((item) => item.id === "next-game")?.categoryId, "sports");
  assert.equal(loaded.items.find((item) => item.id === "weather")?.categoryId, "local-info");

  await setDisplayItemCategory("weather", "sports", configPath);
  const saved = JSON.parse(await readFile(configPath, "utf8")) as typeof loaded;
  assert.equal(saved.items.find((item) => item.id === "weather")?.categoryId, "sports");
});

test("loadDisplayItemsConfig includes missing built-in display items as disabled options", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glanceboard-display-config-"));
  const configPath = path.join(dir, "display-items.json");
  await writeFile(configPath, JSON.stringify({
    rotationSeconds: 10,
    items: [
      { id: "local-weather", enabled: true, type: "weather-current", zip: "33066" }
    ]
  }), "utf8");

  const loaded = await loadDisplayItemsConfig(configPath);

  assert.equal(loaded.items.find((item) => item.id === "local-weather")?.enabled, true);
  assert.equal(loaded.items.find((item) => item.id === "miami-marlins-next")?.enabled, false);
  assert.equal(loaded.items.find((item) => item.id === "miami-marlins-next")?.type, "sports-next-game");
  assert.equal(loaded.items.find((item) => item.id === "internet-status")?.enabled, false);
});

test("setDisplayItemEnabled can save a missing built-in display item", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glanceboard-display-config-"));
  const configPath = path.join(dir, "display-items.json");
  await writeFile(configPath, JSON.stringify({
    rotationSeconds: 10,
    items: [
      { id: "local-weather", enabled: true, type: "weather-current", zip: "33066" }
    ]
  }), "utf8");

  const config = await setDisplayItemEnabled("miami-marlins-next", true, configPath);
  const saved = JSON.parse(await readFile(configPath, "utf8")) as typeof config;

  assert.equal(config.items.find((item) => item.id === "miami-marlins-next")?.enabled, true);
  assert.equal(saved.items.find((item) => item.id === "miami-marlins-next")?.enabled, true);
  assert.equal(saved.items.find((item) => item.id === "internet-status")?.enabled, false);
});
