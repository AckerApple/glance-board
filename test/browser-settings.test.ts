import assert from "node:assert/strict";
import test from "node:test";
import { BrowserSettingsService } from "../src/providers/browser-settings-service.js";

test("browser settings default and normalize persisted form values", async () => {
  const files = new Map<string, unknown>();
  const service = new BrowserSettingsService({
    async read<T>(fileName: string, fallback: T): Promise<T> {
      return (files.get(fileName) ?? fallback) as T;
    },
    async write(fileName: string, value: unknown): Promise<void> {
      files.set(fileName, value);
    }
  });

  assert.deepEqual(await service.get(), {
    autoSendRotation: true,
    displayIntensity: 1
  });

  const saved = await service.save({
    autoSendRotation: true,
    displayIntensity: 2
  });

  assert.deepEqual(saved, {
    autoSendRotation: true,
    displayIntensity: 1
  });
  assert.deepEqual(await service.get(), saved);

  assert.equal((await service.save({ autoSendRotation: false })).autoSendRotation, false);
});
