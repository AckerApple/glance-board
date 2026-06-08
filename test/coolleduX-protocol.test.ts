import assert from "node:assert/strict";
import test from "node:test";
import { createMatrix16x96, setPixel } from "../src/matrix/core16x96.js";
import { buildMatrixProgramUpload, parseStreamFramesFromBuffer, splitBleWrites } from "../src/hardware/coolleduX/coolleduXProtocol.js";

test("builds framed matrix upload packets and BLE-sized chunks", () => {
  const matrix = createMatrix16x96();
  setPixel(matrix, 0, 0, "white");
  setPixel(matrix, 95, 15, "blue");

  const upload = buildMatrixProgramUpload(matrix, 0.5);
  assert.ok(upload.rawProgramLength > 0);
  assert.ok(upload.compressedLength > 0);
  assert.ok(upload.packets.length >= 2);

  for (const packet of upload.packets) {
    assert.equal(packet[0], 0x01);
    assert.equal(packet[packet.length - 1], 0x03);
    assert.ok(splitBleWrites(packet, 20).every((chunk) => chunk.length <= 20));
  }

  const parsed = parseStreamFramesFromBuffer(Buffer.concat(upload.packets));
  assert.equal(parsed.frames.length, upload.packets.length);
  assert.equal(parsed.remaining.length, 0);
});
