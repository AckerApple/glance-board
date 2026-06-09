import assert from "node:assert/strict";
import test from "node:test";
import { RotationEngine } from "../src/rotation/rotation-engine.js";
import { DisplayItemConfig, NormalizedDisplayCard } from "../src/rotation/types.js";

test("resolves enabled items only and preserves equal rotation order", async () => {
  const items: DisplayItemConfig[] = [
    { id: "one", enabled: true, type: "date-time" },
    { id: "disabled", enabled: false, type: "moon-phase" },
    { id: "two", enabled: true, type: "moon-phase" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      return {
        ...item,
        title: item.id,
        status: "live",
        readableLines: [item.id],
        matrixLines: [item.id]
      };
    }
  };
  const engine = new RotationEngine(resolver, async () => ({ rotationSeconds: 10, items }));

  const state = await engine.refresh();
  assert.equal(state.rotationSeconds, 10);
  assert.equal(state.refreshIntervalSeconds, 15);
  assert.deepEqual(state.cards.map((card) => card.id), ["one", "two"]);
  assert.equal(state.items.find((item) => item.id === "one")?.refreshIntervalSeconds, 45);
  assert.equal(state.items.find((item) => item.id === "two")?.refreshIntervalSeconds, 3600);
  assert.equal(typeof state.items.find((item) => item.id === "one")?.lastUpdated, "string");
  assert.equal(state.items.find((item) => item.id === "one")?.lastUpdatedAgeMinutes, 0);
  assert.equal(state.items.find((item) => item.id === "disabled")?.lastUpdated, undefined);
  assert.equal(state.activeCard?.id, "one");
  assert.equal(engine.next()?.id, "two");
  assert.equal(engine.next()?.id, "one");
});

test("reuses resolved display items until their refresh interval expires", async () => {
  let resolveCount = 0;
  const items: DisplayItemConfig[] = [
    { id: "weather", enabled: true, type: "weather-current" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      resolveCount += 1;
      return {
        ...item,
        title: item.id,
        status: "live",
        readableLines: [`weather ${resolveCount}`],
        matrixLines: [`weather ${resolveCount}`]
      };
    }
  };
  const engine = new RotationEngine(resolver, async () => ({ rotationSeconds: 10, items }));

  const first = await engine.refresh();
  const second = await engine.refresh();

  assert.equal(resolveCount, 1);
  assert.deepEqual(first.cards[0].readableLines, ["weather 1"]);
  assert.deepEqual(second.cards[0].readableLines, ["weather 1"]);
  assert.equal(second.items[0].refreshIntervalSeconds, 300);
});
