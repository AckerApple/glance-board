import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setDisplayItemEnabled } from "../src/rotation/display-config.js";

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
