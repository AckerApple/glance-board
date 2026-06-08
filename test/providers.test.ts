import assert from "node:assert/strict";
import test from "node:test";
import { DateTimeProvider } from "../src/providers/date-time-provider.js";
import { FuelProvider } from "../src/providers/fuel-provider.js";
import { MoonProvider } from "../src/providers/moon-provider.js";

test("date-time provider produces two display-safe lines", () => {
  const result = new DateTimeProvider().resolve(
    { id: "date", enabled: true, type: "date-time" },
    new Date("2026-06-06T13:30:00-04:00")
  );
  assert.equal(result.matrixLines.length, 2);
  assert.match(result.matrixLines[0], /:/);
  assert.equal(result.matrixLines[1].trim(), "");
});

test("moon provider returns bounded illumination and future full moon distance", () => {
  const result = new MoonProvider().resolve(
    { id: "moon", enabled: true, type: "moon-phase" },
    new Date("2026-06-06T12:00:00Z")
  );
  assert.ok(result.moon.illumination >= 0 && result.moon.illumination <= 1);
  assert.ok(result.moon.daysUntilFullMoon >= 0);
  assert.equal(result.matrixLines.length, 2);
});

test("fuel provider maps Pompano Beach to the AAA Fort Lauderdale metro", async () => {
  const provider = new FuelProvider(async () => new Response(`
    ### Fort Lauderdale
    Regular Mid Premium Diesel
    Current Avg. $3.9210 $4.3940 $4.6920 $4.9770
  `, { status: 200, headers: { "content-type": "text/html" } }) as unknown as Response);

  const result = await provider.resolve({
    id: "local-fuel-average",
    enabled: true,
    type: "fuel-average",
    zip: "33066",
    state: "FL",
    metro: "Pompano Beach"
  });

  assert.equal(result.debug.sourceArea, "Fort Lauderdale");
  assert.deepEqual(result.readableLines, ["GAS AVG POMPA", "REG3.92 DSL4.98"]);
});

test("fuel provider caches successful AAA lookups", async () => {
  let fetchCount = 0;
  const provider = new FuelProvider(async () => {
    fetchCount += 1;
    return new Response(`
      ### Fort Lauderdale
      Regular Mid Premium Diesel
      Current Avg. $3.9210 $4.3940 $4.6920 $4.9770
    `, { status: 200, headers: { "content-type": "text/html" } }) as unknown as Response;
  });
  const config = { id: "fuel", enabled: true, type: "fuel-average" as const, zip: "33066" };

  await provider.resolve(config);
  await provider.resolve(config);

  assert.equal(fetchCount, 1);
});
