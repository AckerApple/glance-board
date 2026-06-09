import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocationService } from "../src/providers/location-service.js";

test("saves a resolved ZIP to weather and fuel display items", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "glanceboard-location-"));
  const configPath = path.join(directory, "display-items.json");
  const initialConfig = {
    rotationSeconds: 10,
    items: [
      { id: "weather", enabled: true, type: "weather-current" as const, zip: "33066" },
      { id: "fuel", enabled: true, type: "fuel-average" as const, zip: "33066" },
      { id: "date", enabled: true, type: "date-time" as const }
    ]
  };
  await writeFile(configPath, JSON.stringify(initialConfig));

  const fetchImpl = async () => new Response(JSON.stringify({
    places: [{
      "place name": "Beverly Hills",
      "state abbreviation": "CA",
      latitude: "34.0901",
      longitude: "-118.4065"
    }]
  }), { status: 200 });
  const service = new LocationService(fetchImpl as typeof fetch, configPath);

  const location = await service.saveZip("90210");
  const saved = JSON.parse(await readFile(configPath, "utf8"));

  assert.equal(location.city, "Beverly Hills");
  assert.deepEqual(saved.items[0], {
    id: "weather",
    enabled: true,
    type: "weather-current",
    categoryId: "local-info",
    zip: "90210",
    latitude: 34.0901,
    longitude: -118.4065
  });
  assert.deepEqual(saved.items[1], {
    id: "fuel",
    enabled: true,
    type: "fuel-average",
    categoryId: "local-info",
    zip: "90210",
    state: "CA",
    metro: "Beverly Hills"
  });
  assert.deepEqual(saved.items[2], {
    ...initialConfig.items[2],
    categoryId: "time"
  });
});

test("rejects an invalid ZIP before making a lookup request", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response();
  };
  const service = new LocationService(fetchImpl as typeof fetch);

  await assert.rejects(service.resolveZip("123"), /valid 5-digit/);
  assert.equal(called, false);
});
