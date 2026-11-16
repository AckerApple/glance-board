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
  assert.equal(engine.nextAfter("one")?.id, "two");
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

test("advances from the last displayed card id after refresh", async () => {
  const items: DisplayItemConfig[] = [
    { id: "one", enabled: true, type: "date-time" },
    { id: "two", enabled: true, type: "moon-phase" },
    { id: "three", enabled: true, type: "fuel-average" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      return cardFor(item);
    }
  };
  const engine = new RotationEngine(resolver, async () => ({ rotationSeconds: 10, items }));

  await engine.refresh();
  assert.equal(engine.nextAfter("three")?.id, "one");
});

test("returns stale cached cards while one background refresh runs at a time", async () => {
  let resolveCount = 0;
  let nowMs = 0;
  let releaseBackground: (() => void) | undefined;
  const items: DisplayItemConfig[] = [
    { id: "weather", enabled: true, type: "weather-current" },
    { id: "internet", enabled: true, type: "internet-status" }
  ];
  const resolver = {
    async resolve(item: DisplayItemConfig): Promise<NormalizedDisplayCard> {
      resolveCount += 1;
      if (resolveCount > 2) {
        await new Promise<void>((resolve) => {
          releaseBackground = resolve;
        });
      }
      return {
        ...item,
        title: item.id,
        status: "live",
        readableLines: [`${item.id} ${resolveCount}`],
        matrixLines: [`${item.id} ${resolveCount}`]
      };
    }
  };
  const engine = new RotationEngine(resolver, async () => ({ rotationSeconds: 10, items }), 15, () => nowMs);

  await engine.refresh();
  nowMs = 5 * 60 * 1000;
  const staleRefresh = await engine.refresh();

  assert.deepEqual(staleRefresh.cards.map((card) => card.readableLines[0]), ["weather 1", "internet 2"]);
  await eventually(() => assert.equal(resolveCount, 3));

  await Promise.resolve();
  assert.equal(resolveCount, 3);

  releaseBackground?.();
  await eventually(() => assert.equal(resolveCount, 4));
});

function cardFor(item: DisplayItemConfig): NormalizedDisplayCard {
  return {
    ...item,
    title: item.id,
    status: "live",
    readableLines: [item.id],
    matrixLines: [item.id]
  };
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

test("disconnect invalidation removes only that provider and rejects a late in-flight card", async () => {
  const items: DisplayItemConfig[] = [
    { id: "icloud", enabled: true, type: "icloud-calendar-next-event" },
    { id: "google", enabled: true, type: "google-calendar-next-event" },
    { id: "clock", enabled: true, type: "date-time" }
  ];
  let connected = true;
  let now = 0;
  let release: (() => void) | undefined;
  let delayed = false;
  const engine = new RotationEngine({ async resolve(item) {
    const wasConnected = connected;
    if (item.id === "icloud" && delayed && wasConnected) await new Promise<void>(resolve => { release = resolve; });
    return { ...item, title: item.id, status: item.id === "icloud" && !wasConnected ? "not_configured" : "live", readableLines: [item.id], matrixLines: [item.id] };
  } }, async () => ({ rotationSeconds: 10, items }), 15, () => now);
  await engine.refresh();
  engine.select("icloud");
  now = 301_000;
  delayed = true;
  await engine.refresh(); // starts a background refresh with the old session
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(release);
  connected = false;
  engine.invalidate(item => item.type === "icloud-calendar-next-event");
  assert.equal(engine.select("icloud"), undefined);
  const after = await engine.refresh();
  assert.deepEqual(after.cards.map(card => card.id), ["google", "clock"]);
  assert.equal(after.items.length, 3); // layout retained for reconnection
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await engine.refresh()).cards.map(card => card.id), ["google", "clock"]);
});

test("invalidation during the first resolve cannot publish an old active calendar", async () => {
  const item: DisplayItemConfig = { id: "calendar", enabled: true, type: "icloud-calendar-next-event" };
  let connected = true;
  let release: (() => void) | undefined;
  const engine = new RotationEngine({ async resolve(config) {
    const oldSession = connected;
    if (oldSession) await new Promise<void>(resolve => { release = resolve; });
    return { ...config, title: "Calendar", status: oldSession ? "live" : "not_configured", readableLines: ["event"], matrixLines: ["event"] };
  } }, async () => ({ rotationSeconds: 10, items: [item] }));
  const pending = engine.refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(release);
  connected = false;
  engine.invalidate(config => config.type === "icloud-calendar-next-event");
  release();
  const result = await pending;
  assert.deepEqual(result.cards, []);
  assert.equal(result.activeCard, undefined);
  assert.equal(engine.next(), undefined);
});
