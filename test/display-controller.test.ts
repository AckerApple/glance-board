import assert from "node:assert/strict";
import test from "node:test";
import { DotMatrixController, DotMatrixDisplayHardware } from "../src/server/display.js";
import { PixelMatrix } from "../src/matrix/core16x96.js";
import { NormalizedGameScore } from "../src/rotation/types.js";

class FakeDisplay implements DotMatrixDisplayHardware {
  intensity = 1;
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  onDisconnect: (() => void) | undefined;
  sendMatrixImpl: () => Promise<void> = async () => undefined;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMatrix(_matrix: PixelMatrix, _label?: string): Promise<void> {
    await this.sendMatrixImpl();
  }

  async sendMatrixQuick(_matrix: PixelMatrix, _label?: string): Promise<void> {}

  async sendMatrices(_matrices: PixelMatrix[], _label?: string, _frameDelayMs?: number | number[]): Promise<void> {}

  async sendMatrixSequence(_matrices: PixelMatrix[], _label?: string, _frameDelayMs?: number): Promise<void> {}

  async confirmMatrix(_matrix: PixelMatrix, _label?: string, _delayMs?: number): Promise<void> {}

  triggerUnexpectedDisconnect(): void {
    this.connected = false;
    this.onDisconnect?.();
  }
}

test("sending state is treated as connected for reconnect suppression", async () => {
  const fake = new FakeDisplay();
  let releaseSend: (() => void) | undefined;
  fake.sendMatrixImpl = () => new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  const controller = createController(fake);

  await controller.connect();
  const sendPromise = controller.sendGame(testGame());
  await Promise.resolve();

  assert.equal(controller.snapshot().status, "sending");
  assert.equal(controller.isConnectedOrSending(), true);

  releaseSend?.();
  const status = await sendPromise;
  assert.equal(status.status, "connected");
});

test("unexpected disconnect clears connected-or-sending state and allows reconnect", async () => {
  const fake = new FakeDisplay();
  const controller = createController(fake);

  await controller.connect();
  fake.triggerUnexpectedDisconnect();

  assert.equal(controller.snapshot().status, "error");
  assert.equal(controller.isConnectedOrSending(), false);

  const status = await controller.connect();
  assert.equal(status.status, "connected");
  assert.equal(fake.connectCalls, 2);
});

test("physical disconnect during send clears connected-or-sending state", async () => {
  const fake = new FakeDisplay();
  let releaseSend: (() => void) | undefined;
  fake.sendMatrixImpl = () => new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  const controller = createController(fake);

  await controller.connect();
  const sendPromise = controller.sendGame(testGame());
  await Promise.resolve();

  assert.equal(controller.snapshot().status, "sending");
  fake.connected = false;
  assert.equal(controller.isConnectedOrSending(), false);
  assert.equal(controller.snapshot().status, "error");

  releaseSend?.();
  const status = await sendPromise;
  assert.equal(status.status, "error");
});

test("failed send disconnects display and leaves reconnect eligible", async () => {
  const fake = new FakeDisplay();
  fake.sendMatrixImpl = async () => {
    throw new Error("write failed");
  };
  const controller = createController(fake);

  await controller.connect();
  const status = await controller.sendGame(testGame());

  assert.equal(status.status, "error");
  assert.equal(fake.disconnectCalls, 1);
  assert.equal(controller.isConnectedOrSending(), false);
});

function createController(fake: FakeDisplay): DotMatrixController {
  return new DotMatrixController(
    { deviceName: "FakeDisplay" },
    (options) => {
      fake.onDisconnect = options.onDisconnect;
      return fake;
    }
  );
}

function testGame(): NormalizedGameScore {
  return {
    status: "live",
    league: "NBA",
    awayTeam: { name: "Away", abbreviation: "AWY", score: 1 },
    homeTeam: { name: "Home", abbreviation: "HME", score: 2 },
    displayLines: ["AWY 1", "HME 2"]
  };
}
