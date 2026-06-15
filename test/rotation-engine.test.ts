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

test("internet status items refresh every five minutes", async () => {
  const items: DisplayItemConfig[] = [
    { id: "internet-status", enabled: true, type: "internet-status" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      return {
        ...item,
        title: item.id,
        status: "live",
        readableLines: ["ONLINE"],
        matrixLines: ["ONLINE"]
      };
    }
  };
  const engine = new RotationEngine(resolver, async () => ({ rotationSeconds: 10, items }));

  const state = await engine.refresh();

  assert.equal(state.items[0].refreshIntervalSeconds, 300);
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

test("skips transient fetch error cards with no cached value", async () => {
  const items: DisplayItemConfig[] = [
    { id: "weather", enabled: true, type: "weather-current" },
    { id: "date", enabled: true, type: "date-time" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      if (item.id === "weather") {
        return {
          ...item,
          title: item.id,
          status: "error",
          readableLines: ["DISPLAY", "ERROR"],
          matrixLines: ["DISPLAY", "ERROR"],
          error: "Weather API fetch failed: fetch failed"
        };
      }

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

  assert.deepEqual(state.cards.map((card) => card.id), ["date"]);
  assert.equal(state.items.find((item) => item.id === "weather")?.resolved, false);
});

test("uses stale cached card when transient fetch refresh fails", async () => {
  let shouldFail = false;
  const items: DisplayItemConfig[] = [
    { id: "weather", enabled: true, type: "weather-current" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      if (shouldFail) {
        return {
          ...item,
          title: item.id,
          status: "error",
          readableLines: ["DISPLAY", "ERROR"],
          matrixLines: ["DISPLAY", "ERROR"],
          error: "Weather API fetch failed: fetch failed"
        };
      }

      return {
        ...item,
        title: item.id,
        status: "live",
        readableLines: ["weather ok"],
        matrixLines: ["weather ok"]
      };
    }
  };
  const engine = new RotationEngine(resolver, async () => ({ rotationSeconds: 10, items }), 0);

  const first = await engine.refresh();
  shouldFail = true;
  items[0] = { ...items[0], zip: "33066" };
  const second = await engine.refresh();

  assert.deepEqual(first.cards[0].readableLines, ["weather ok"]);
  assert.deepEqual(second.cards[0].readableLines, ["weather ok"]);
  assert.equal(second.items[0].resolved, true);
});
