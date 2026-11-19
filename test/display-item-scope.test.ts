import assert from "node:assert/strict";
import test from "node:test";
import { displayItemScope } from "../client/display-item-scope.js";

test("all local-data settings move by provider without changing playback configuration", () => {
  const items = [
    { id: "weather", type: "weather-current", categoryId: "custom", enabled: true },
    { id: "gas", type: "fuel-average", categoryId: "sports", enabled: false },
    { id: "moon", type: "moon-phase", enabled: true },
    { id: "clock", type: "date-time", categoryId: "local-info", enabled: true },
    { id: "network", type: "internet-status", categoryId: "local-info", enabled: true },
    { id: "game", type: "sports-live-score", categoryId: "custom", enabled: true },
    { id: "next", type: "sports-next-game", enabled: true },
    { id: "calendar", type: "icloud-calendar-next-event", enabled: true }
  ];
  const original = structuredClone(items);
  assert.deepEqual(items.filter(item => displayItemScope(item) === "local-data").map(item => item.id), ["weather", "gas", "moon", "clock", "network"]);
  assert.deepEqual(items.filter(item => displayItemScope(item) === "other").map(item => item.id), ["calendar"]);
  assert.deepEqual(items.filter(item => displayItemScope(item) === "sports").map(item => item.id), ["game", "next"]);
  assert.deepEqual(items, original);
  assert.equal(displayItemScope({}), "other");
});
