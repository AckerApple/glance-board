import assert from "node:assert/strict";
import test from "node:test";
import { shouldWriteWithoutResponse } from "../src/hardware/coolleduX/CoolLedUxDisplay.js";

test("prefers acknowledged BLE writes when characteristic supports write", () => {
  assert.equal(shouldWriteWithoutResponse(["write", "writeWithoutResponse"]), false);
});

test("uses without-response BLE writes only when acknowledged write is unavailable", () => {
  assert.equal(shouldWriteWithoutResponse(["writeWithoutResponse"]), true);
});
