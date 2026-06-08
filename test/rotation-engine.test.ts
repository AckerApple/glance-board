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
  assert.deepEqual(state.cards.map((card) => card.id), ["one", "two"]);
  assert.equal(state.activeCard?.id, "one");
  assert.equal(engine.next()?.id, "two");
  assert.equal(engine.next()?.id, "one");
});
