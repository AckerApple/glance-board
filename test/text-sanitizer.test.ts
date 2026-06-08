import assert from "node:assert/strict";
import test from "node:test";
import { fitDisplayLine, sanitizeDisplayText } from "../src/matrix/text-sanitizer.js";

test("replaces unsupported matchup characters", () => {
  assert.equal(sanitizeDisplayText("NYK @ SAS"), "NYK AT SAS");
  assert.equal(sanitizeDisplayText("A&B + C"), "A AND B PLUS C");
});

test("fits sanitized text to the requested matrix length", () => {
  assert.equal(fitDisplayLine("NYK @ SAS", 8), "NYK AT S");
});
