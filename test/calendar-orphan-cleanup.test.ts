import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupOrphanedCalendarItems, loadDisplayItemsConfig, removeOrphanedCalendarItems } from "../src/rotation/display-config.js";
import { RotationEngine } from "../src/rotation/rotation-engine.js";
import type { DisplayItemConfig } from "../src/rotation/types.js";

const items: DisplayItemConfig[] = [
  { id: "icloud-calendar-next-1", type: "icloud-calendar-next-event", enabled: true, calendarId: "deleted" },
  { id: "icloud-calendar-next-2", type: "icloud-calendar-next-event", enabled: true, calendarId: "kept" },
  { id: "icloud-calendar-next-3", type: "icloud-calendar-next-event", enabled: true },
  { id: "google-calendar-next-1", type: "google-calendar-next-event", enabled: true, calendarId: "primary" },
  { id: "manual-calendar", type: "icloud-calendar-next-event", enabled: true, calendarId: "manual" },
  { id: "clock", type: "date-time", enabled: true }
];

test("cleanup removes only orphaned installer-owned slots and preserves unknown sources", () => {
  assert.deepEqual(removeOrphanedCalendarItems(items, { icloud: ["kept"] }).map(x => x.id), items.slice(1).map(x => x.id));
  assert.deepEqual(removeOrphanedCalendarItems(items, { icloud: [], google: ["primary"] }).map(x => x.id), items.slice(3).map(x => x.id));
  assert.deepEqual(removeOrphanedCalendarItems(items, {}), items);
  const manual = { id: "icloud-calendar-next-1", enabled: true, type: "date-time" as const };
  assert.deepEqual(removeOrphanedCalendarItems([manual], { icloud: [] }), [manual]);
});

test("startup cleanup persists removal, backs up original, and is idempotent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glance-orphans-"));
  const file = path.join(dir, "display-items.json");
  const config = { rotationSeconds: 17, categories: [{ id: "custom", label: "Custom", icon: "generic" }], items };
  const original = JSON.stringify(config);
  await writeFile(file, original);
  await writeFile(path.join(dir, "google-calendar-token.json"), "{}");
  await writeFile(path.join(dir, "google-calendar.json"), JSON.stringify({ calendarId: "primary" }));
  assert.equal(await cleanupOrphanedCalendarItems(file, dir), 3);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved, { ...config, items: items.slice(3) });
  const backups = (await readdir(dir)).filter(name => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(dir, backups[0]), "utf8"), original);
  assert.equal(await cleanupOrphanedCalendarItems(file, dir), 0);
});

test("malformed source configuration does not authorize cleanup", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glance-orphans-"));
  const file = path.join(dir, "display-items.json");
  await writeFile(file, JSON.stringify({ rotationSeconds: 10, items: items.slice(0, 3) }));
  await writeFile(path.join(dir, "icloud-calendar-credentials.json"), "{}");
  await writeFile(path.join(dir, "icloud-calendar.json"), "{broken");
  assert.equal(await cleanupOrphanedCalendarItems(file, dir), 0);
});

test("source deletion filters persisted slots from an already cached rotation without restart", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "glance-orphans-"));
  const file = path.join(dir, "display-items.json");
  await writeFile(file, JSON.stringify({ rotationSeconds: 10, items: [items[1], items[5]] }));
  await writeFile(path.join(dir, "icloud-calendar-credentials.json"), "{}");
  const settings = path.join(dir, "icloud-calendar.json");
  await writeFile(settings, JSON.stringify({ calendarIds: ["kept"] }));
  const engine = new RotationEngine({ async resolve(item) {
    return { ...item, title: item.id, status: "live", readableLines: [item.id], matrixLines: [item.id] };
  } }, () => loadDisplayItemsConfig(file, dir));
  assert.ok((await engine.refresh()).cards.some(card => card.id === items[1].id));
  await writeFile(settings, JSON.stringify({ calendarIds: [] }));
  const after = await engine.refresh();
  assert.deepEqual(after.cards.map(card => card.id), ["clock"]);
  assert.equal(engine.select(items[1].id), undefined);
  assert.equal(after.activeCard?.id, "clock");
  // Loading alone never mutates the file; startup/source-edit reconciliation does.
  assert.equal(JSON.parse(await readFile(file, "utf8")).items.length, 2);
});
