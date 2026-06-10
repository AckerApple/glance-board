import assert from "node:assert/strict";
import test from "node:test";
import { createMatrix16x96, setPixel } from "../src/matrix/core16x96.js";
import {
  buildMatrixFramesProgramUpload,
  buildMatrixProgramPayload,
  buildMatrixProgramUpload,
  buildMatrixTransitionProgramPayload,
  buildMatrixTransitionProgramUpload,
  parseStreamFramesFromBuffer,
  splitBleWrites
} from "../src/hardware/coolleduX/coolleduXProtocol.js";

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

test("builds one upload for multiple matrix animation frames", () => {
  const first = createMatrix16x96();
  const second = createMatrix16x96();
  setPixel(first, 0, 0, "white");
  setPixel(second, 95, 15, "blue");

  const upload = buildMatrixFramesProgramUpload([first, second], 0.5);
  assert.ok(upload.rawProgramLength > buildMatrixProgramUpload(first, 0.5).rawProgramLength);
  assert.ok(upload.compressedLength > 0);
  assert.ok(upload.packets.length >= 2);

  const parsed = parseStreamFramesFromBuffer(Buffer.concat(upload.packets));
  assert.equal(parsed.frames.length, upload.packets.length);
  assert.equal(parsed.remaining.length, 0);

  const program = buildMatrixProgramPayload([first, second], 0.5, 70);
  assert.equal(program[8], 1);
  assert.equal(program[10 + 4], 0x03);
  assert.equal(program.readUInt16BE(10 + 22), 2);
  assert.equal(program.readUInt16BE(10 + 24), 70);
  assert.equal(program.readUInt16BE(10 + 26), 70);

  const mixedDelayProgram = buildMatrixProgramPayload([first, second], 0.5, [70, 500]);
  assert.equal(mixedDelayProgram.readUInt16BE(10 + 24), 70);
  assert.equal(mixedDelayProgram.readUInt16BE(10 + 26), 500);
});

test("builds a transition upload with animation followed by static final content", () => {
  const first = createMatrix16x96();
  const second = createMatrix16x96();
  setPixel(first, 0, 0, "white");
  setPixel(second, 95, 15, "blue");

  const upload = buildMatrixTransitionProgramUpload([first], second, 0.5, 70);
  assert.ok(upload.rawProgramLength > 0);
  assert.ok(upload.packets.length >= 2);

  const program = buildMatrixTransitionProgramPayload([first], second, 0.5, 70);
  assert.equal(program[8], 2);
  assert.equal(program[10 + 4], 0x03);
  const firstContentLength = program.readUInt32BE(10);
  assert.equal(program[10 + firstContentLength + 4], 0x02);
});
