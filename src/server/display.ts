import { CoolLedUxDisplay } from "../hardware/coolleduX/CoolLedUxDisplay.js";
import { buildScrollDownFrames } from "../matrix/animation.js";
import { createMatrix16x96, drawText, PixelMatrix, setPixel } from "../matrix/core16x96.js";
import { renderDisplayCardToDisplayMatrix16x96, renderNbaDisplayModeToDisplayMatrix16x96 } from "../matrix/matrix.js";
import { NbaDisplayMode, NormalizedDisplayCard, NormalizedGameScore } from "../rotation/types.js";
import { logWithClock, warnWithClock } from "../hardware/logging.js";

export type DotMatrixConnectionStatus = "idle" | "connecting" | "connected" | "sending" | "error";
export type TransitionPace = "normal" | "fast";

const TRANSITION_FRAME_DELAY_MS = 70;
const FAST_TRANSITION_FRAME_DELAY_MS = 45;
const FINAL_FRAME_CONFIRM_DELAY_MS = 500;
const FINAL_FRAME_SETTLE_MS = 500;
const FAST_FINAL_FRAME_SETTLE_MS = 350;
const FINAL_FRAME_WINDOW_SAFETY_MS = 1_500;
const TRANSITION_UPLOAD_BUDGET_MS = 5_000;
const FINAL_FRAME_TAIL_COUNT = 2;
const TRANSITION_STATIC_CONFIRM_AFTER_MS = 1_500;
const TRANSITION_STATIC_CONFIRM_COUNT = 2;
const TRANSITION_STATIC_CONFIRM_REPEAT_DELAY_MS = 120;
const DEFAULT_TRANSITION_FRAME_COUNT = 8;
const STARTUP_LOADING_HOLD_MS = 3_000;
const STARTUP_PROBE_ENABLED = process.env.GLANCEBOARD_STARTUP_ANIMATION_PROBE === "true";
const STARTUP_DOTS_ANIMATION_MS = 3_000;
const STARTUP_DOTS_FRAME_DELAY_MS = 250;
const STARTUP_PROBE_ANIMATION_MS = 3_000;
const STARTUP_PROBE_FRAME_DELAY_MS = 150;
const STARTUP_STATIC_SEND_COUNT = 3;
const STARTUP_STATIC_REPEAT_DELAY_MS = 100;
const TRANSITION_UPLOAD_MODE = process.env.GLANCEBOARD_TRANSITION_UPLOAD === "sequence" ? "sequence" : "program";

export interface DotMatrixStatus {
  status: DotMatrixConnectionStatus;
  deviceName: string;
  deviceId?: string;
  autoSend: boolean;
  intensity: number;
  lastMessage?: string;
  lastSentAt?: string;
}

export class DotMatrixController {
  private readonly display: CoolLedUxDisplay;
  private status: DotMatrixConnectionStatus = "idle";
  private lastMessage: string | undefined;
  private lastSentAt: string | undefined;
  private autoSend = false;
  private intensity = 1;
  private connectPromise: Promise<DotMatrixStatus> | undefined;
  private displayOperationQueue: Promise<void> = Promise.resolve();
  private operationSequence = 0;
  private connectionGeneration = 0;
  private manualDisconnectInFlight = false;
  private readonly unexpectedDisconnectListeners: Array<(status: DotMatrixStatus) => void> = [];

  constructor(
    private readonly options: {
      deviceName: string;
      deviceId?: string;
    }
  ) {
    this.display = new CoolLedUxDisplay({
      deviceName: options.deviceName,
      deviceId: options.deviceId,
      width: 96,
      height: 16,
      onDisconnect: () => this.handleUnexpectedDisconnect()
    });
  }

  snapshot(): DotMatrixStatus {
    return {
      status: this.status,
      deviceName: this.options.deviceName,
      deviceId: this.options.deviceId,
      autoSend: this.autoSend,
      intensity: this.intensity,
      lastMessage: this.lastMessage,
      lastSentAt: this.lastSentAt
    };
  }

  setAutoSend(enabled: boolean): DotMatrixStatus {
    this.autoSend = enabled;
    this.lastMessage = enabled ? "▶️ Auto-send on" : "⏸️ Auto-send off";
    return this.snapshot();
  }

  isAutoSendEnabled(): boolean {
    return this.autoSend;
  }

  isReadyToSend(): boolean {
    this.refreshConnectionStatus();
    return this.status === "connected" || this.status === "sending";
  }

  isConnected(): boolean {
    this.refreshConnectionStatus();
    return this.status === "connected";
  }

  onUnexpectedDisconnect(listener: (status: DotMatrixStatus) => void): void {
    this.unexpectedDisconnectListeners.push(listener);
  }

  refreshConnectionStatus(): DotMatrixStatus {
    if (this.status === "connected" && !this.display.isConnected()) {
      this.status = "error";
      this.lastMessage = "⚠️ Screen disconnected";
      logWithClock(this.lastMessage);
    }
    return this.snapshot();
  }

  setIntensity(intensity: number): DotMatrixStatus {
    this.intensity = normalizeIntensity(intensity);
    this.display.intensity = this.intensity;
    this.lastMessage = `💡 Intensity ${Math.round(this.intensity * 100)}%`;
    return this.snapshot();
  }

  minimumTransitionSeconds(): number {
    if (TRANSITION_UPLOAD_MODE === "sequence") {
      return Math.ceil((DEFAULT_TRANSITION_FRAME_COUNT * TRANSITION_FRAME_DELAY_MS + FINAL_FRAME_CONFIRM_DELAY_MS) / 1000);
    }

    return Math.ceil((
      DEFAULT_TRANSITION_FRAME_COUNT * TRANSITION_FRAME_DELAY_MS +
      FINAL_FRAME_SETTLE_MS
    ) / 1000);
  }

  async connect(): Promise<DotMatrixStatus> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private async connectOnce(): Promise<DotMatrixStatus> {
    try {
      this.refreshConnectionStatus();
      if (this.status === "connected") return this.snapshot();
      this.manualDisconnectInFlight = false;
      this.status = "connecting";
      this.lastMessage = "🔌 Connecting";
      await this.display.connect();
      this.status = "connected";
      this.lastMessage = "✅ ⚡️ Screen connected";
    } catch (error) {
      warnWithClock("⚠️ display connect failed", error instanceof Error ? error.message : error);
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async disconnect(): Promise<DotMatrixStatus> {
    this.manualDisconnectInFlight = true;
    try {
      await this.display.disconnect();
      this.connectionGeneration += 1;
      this.status = "idle";
      this.lastMessage = "⏹️ Disconnected";
      return this.snapshot();
    } finally {
      this.manualDisconnectInFlight = false;
    }
  }

  async sendGame(game: NormalizedGameScore, mode: NbaDisplayMode = "live_score"): Promise<DotMatrixStatus> {
    return this.runDisplayOperation("NBA score", (operation) => this.sendGameNow(operation, game, mode));
  }

  private async sendGameNow(operation: DisplayOperation, game: NormalizedGameScore, mode: NbaDisplayMode = "live_score"): Promise<DotMatrixStatus> {
    try {
      this.status = "sending";
      this.lastMessage = "✏️ NBA score";
      await this.display.sendMatrix(renderNbaDisplayModeToDisplayMatrix16x96(mode, game), game.displayLines.join(" "));
      this.assertOperationCurrent(operation);
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = "✅ NBA score sent";
    } catch (error) {
      await this.failSend("NBA send", error);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async sendCard(card: NormalizedDisplayCard): Promise<DotMatrixStatus> {
    return this.runDisplayOperation(card.title, (operation) => this.sendCardNow(operation, card));
  }

  private async sendCardNow(operation: DisplayOperation, card: NormalizedDisplayCard): Promise<DotMatrixStatus> {
    try {
      this.status = "sending";
      this.lastMessage = `✏️ ${card.title}`;
      await this.display.sendMatrix(renderDisplayCardToDisplayMatrix16x96(card), card.readableLines.join(" "));
      this.assertOperationCurrent(operation);
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = `✅ ${card.title}`;
    } catch (error) {
      await this.failSend(`${card.title} send`, error);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async sendCardTransition(current: NormalizedDisplayCard | undefined, next: NormalizedDisplayCard, pace: TransitionPace = "normal", displaySeconds = 3): Promise<DotMatrixStatus> {
    const label = current && current.id !== next.id ? `${current.title} → ${next.title}` : next.title;
    return this.runDisplayOperation(label, (operation) => this.sendCardTransitionNow(operation, current, next, pace, displaySeconds));
  }

  private async sendCardTransitionNow(operation: DisplayOperation, current: NormalizedDisplayCard | undefined, next: NormalizedDisplayCard, pace: TransitionPace = "normal", displaySeconds = 3): Promise<DotMatrixStatus> {
    if (!current) {
      try {
        this.status = "sending";
        this.lastMessage = `✏️ ${next.title}`;
        const nextMatrix = renderDisplayCardToDisplayMatrix16x96(next);
        await this.sendStartupSequence(operation, nextMatrix, next.title);
        this.assertOperationCurrent(operation);
        this.status = "connected";
        this.lastSentAt = new Date().toISOString();
        this.lastMessage = `✅ ${next.title}`;
      } catch (error) {
        await this.failSend(`${next.title} startup`, error);
        this.status = "error";
        this.lastMessage = error instanceof Error ? error.message : String(error);
      }

      return this.snapshot();
    }

    try {
      this.status = "sending";
      this.lastMessage = `✏️ ${current.title} → ${next.title}`;
      const currentMatrix = renderDisplayCardToDisplayMatrix16x96(current);
      const nextMatrix = renderDisplayCardToDisplayMatrix16x96(next);
      await this.sendMatrixTransition(operation, currentMatrix, nextMatrix, `${current.title} → ${next.title}`, pace, displaySeconds);
      this.assertOperationCurrent(operation);
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = `✅ ${next.title}`;
    } catch (error) {
      await this.failSend(`${current.title} → ${next.title} send`, error);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  private async runDisplayOperation<T>(label: string, operation: (operation: DisplayOperation) => Promise<T>): Promise<T> {
    const run = async () => {
      const currentOperation: DisplayOperation = {
        id: ++this.operationSequence,
        label,
        connectionGeneration: this.connectionGeneration
      };
      logWithClock(`🎬 op#${currentOperation.id} start ${currentOperation.label}`);
      try {
        const result = await operation(currentOperation);
        if (this.isOperationCurrent(currentOperation)) logWithClock(`🎬 op#${currentOperation.id} done ${currentOperation.label}`);
        return result;
      } catch (error) {
        if (error instanceof DisplayOperationCancelled) {
          logWithClock(`🎬 op#${currentOperation.id} cancelled disconnect`);
        } else {
          warnWithClock(`🎬 op#${currentOperation.id} failed ${currentOperation.label}`, error instanceof Error ? error.message : error);
        }
        throw error;
      }
    };
    const resultPromise = this.displayOperationQueue.then(run, run);
    this.displayOperationQueue = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
  }

  private async sendMatrixTransition(
    operation: DisplayOperation,
    currentMatrix: PixelMatrix,
    nextMatrix: PixelMatrix,
    label: string,
    pace: TransitionPace,
    displaySeconds: number
  ): Promise<void> {
    const frames = buildScrollDownFrames(
      currentMatrix,
      nextMatrix,
      { durationMs: 560, fps: 14 }
    );
    const transitionFrames = frames.slice(1);
    if (TRANSITION_UPLOAD_MODE === "sequence") {
      await this.display.sendMatrixSequence(transitionFrames, label, TRANSITION_FRAME_DELAY_MS);
      await this.display.confirmMatrix(nextMatrix, `${label} confirm`, FINAL_FRAME_CONFIRM_DELAY_MS);
      return;
    }

    const frameDelayMs = pace === "fast" ? FAST_TRANSITION_FRAME_DELAY_MS : TRANSITION_FRAME_DELAY_MS;
    const finalFrameSettleMs = pace === "fast" ? FAST_FINAL_FRAME_SETTLE_MS : FINAL_FRAME_SETTLE_MS;
    const finalFrameWindowMs = Math.max(3, displaySeconds) * 1000 + TRANSITION_UPLOAD_BUDGET_MS + FINAL_FRAME_WINDOW_SAFETY_MS;
    const animationFrames = [
      ...transitionFrames,
      ...Array.from({ length: FINAL_FRAME_TAIL_COUNT }, () => nextMatrix)
    ];
    const frameDelays = [
      ...Array.from({ length: transitionFrames.length }, () => frameDelayMs),
      finalFrameSettleMs,
      finalFrameWindowMs
    ];
    await this.display.sendMatrices(animationFrames, label, frameDelays);
    this.assertOperationCurrent(operation);
    logWithClock(`🛬 final frame window ${formatMs(finalFrameWindowMs)} static in ${formatMs(TRANSITION_STATIC_CONFIRM_AFTER_MS)}`);
    await sleepMs(TRANSITION_STATIC_CONFIRM_AFTER_MS);
    await this.sendTransitionStaticConfirm(operation, nextMatrix, label);
  }

  private async sendStartupSequence(operation: DisplayOperation, nextMatrix: PixelMatrix, nextTitle: string): Promise<void> {
    logWithClock(`🧪 startup static LOADING for ${formatMs(STARTUP_LOADING_HOLD_MS)}`);
    await this.sendStartupStatic(operation, renderLoadingMatrix(), "startup LOADING");
    await sleepMs(STARTUP_LOADING_HOLD_MS);
    this.assertOperationCurrent(operation);

    logWithClock(`🧪 startup dot animation for ${formatMs(STARTUP_DOTS_ANIMATION_MS)}`);
    await this.display.sendMatrices(
      buildStartupDotFrames(STARTUP_DOTS_ANIMATION_MS, STARTUP_DOTS_FRAME_DELAY_MS),
      "startup loading dots",
      STARTUP_DOTS_FRAME_DELAY_MS
    );
    this.assertOperationCurrent(operation);
    await sleepMs(STARTUP_DOTS_ANIMATION_MS);
    this.assertOperationCurrent(operation);

    if (STARTUP_PROBE_ENABLED) {
      logWithClock(`🧪 startup wipe animation for ${formatMs(STARTUP_PROBE_ANIMATION_MS)}`);
      await this.display.sendMatrices(
        buildStartupProbeFrames(STARTUP_PROBE_ANIMATION_MS, STARTUP_PROBE_FRAME_DELAY_MS),
        "startup wipe probe",
        STARTUP_PROBE_FRAME_DELAY_MS
      );
      await sleepMs(STARTUP_PROBE_ANIMATION_MS);
      this.assertOperationCurrent(operation);
    }

    logWithClock(`🧪 startup static ${nextTitle}`);
    await this.sendStartupStatic(operation, nextMatrix, `${nextTitle} startup static`);
  }

  private async sendStartupStatic(operation: DisplayOperation, matrix: PixelMatrix, label: string): Promise<void> {
    for (let index = 0; index < STARTUP_STATIC_SEND_COUNT; index += 1) {
      if (index > 0) await sleepMs(STARTUP_STATIC_REPEAT_DELAY_MS);
      this.assertOperationCurrent(operation);
      logWithClock(`🧪 static send ${label} ${index + 1}/${STARTUP_STATIC_SEND_COUNT}`);
      await this.display.sendMatrixQuick(matrix, `${label} ${index + 1}/${STARTUP_STATIC_SEND_COUNT}`);
    }
  }

  private async sendTransitionStaticConfirm(operation: DisplayOperation, matrix: PixelMatrix, label: string): Promise<void> {
    for (let index = 0; index < TRANSITION_STATIC_CONFIRM_COUNT; index += 1) {
      if (index > 0) await sleepMs(TRANSITION_STATIC_CONFIRM_REPEAT_DELAY_MS);
      this.assertOperationCurrent(operation);
      logWithClock(`🧷 static ${label} ${index + 1}/${TRANSITION_STATIC_CONFIRM_COUNT}`);
      await this.display.sendMatrixQuick(matrix, `${label} static ${index + 1}/${TRANSITION_STATIC_CONFIRM_COUNT}`);
    }
  }

  private async failSend(label: string, error: unknown): Promise<void> {
    if (error instanceof DisplayOperationCancelled) {
      warnWithClock(`⚠️ ${label} cancelled`, error.message);
      return;
    }
    warnWithClock(`⚠️ ${label} failed; disconnecting display`, error instanceof Error ? error.message : error);
    await this.display.disconnect().catch(() => undefined);
    this.connectionGeneration += 1;
  }

  private isOperationCurrent(operation: DisplayOperation): boolean {
    return operation.connectionGeneration === this.connectionGeneration && this.display.isConnected();
  }

  private assertOperationCurrent(operation: DisplayOperation): void {
    if (this.isOperationCurrent(operation)) return;
    throw new DisplayOperationCancelled(operation.id, operation.connectionGeneration, this.connectionGeneration);
  }

  private handleUnexpectedDisconnect(): void {
    if (this.manualDisconnectInFlight || this.status === "idle") return;
    this.connectionGeneration += 1;
    this.status = "error";
    this.lastMessage = "⚠️ Screen disconnected; reconnect pending";
    const status = this.snapshot();
    for (const listener of this.unexpectedDisconnectListeners) listener(status);
  }
}

function normalizeIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) return 1;
  return Math.max(0.1, Math.min(1, intensity));
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Number((ms / 1000).toFixed(2))}s`;
}

function renderLoadingMatrix(dotCount = 3): PixelMatrix {
  const matrix = createMatrix16x96();
  drawText(matrix, "LOADING", 8, 4, "white");
  for (let index = 0; index < dotCount; index += 1) {
    drawText(matrix, ".", 55 + index * 4, 4, "white");
  }
  return matrix;
}

function buildStartupDotFrames(durationMs: number, frameDelayMs: number): PixelMatrix[] {
  const frameCount = Math.max(2, Math.round(durationMs / frameDelayMs));
  return Array.from({ length: frameCount }, (_, index) => renderLoadingDotFrame(index % 4));
}

function renderLoadingDotFrame(dotCount: number): PixelMatrix {
  const matrix = createMatrix16x96();
  drawText(matrix, "LOADING", 7, 4, "white");
  for (let index = 0; index < 3; index += 1) {
    fillRect(matrix, 60 + index * 8, 5, 4, 6, index < dotCount ? "yellow" : "gray");
  }
  return matrix;
}

function fillRect(matrix: PixelMatrix, x: number, y: number, width: number, height: number, color: "yellow" | "gray"): void {
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      setPixel(matrix, x + col, y + row, color);
    }
  }
}

function buildStartupProbeFrames(durationMs: number, frameDelayMs: number): PixelMatrix[] {
  const frameCount = Math.max(2, Math.round(durationMs / frameDelayMs));
  return Array.from({ length: frameCount }, (_, index) => renderStartupWipeFrame(index, frameCount));
}

function renderStartupWipeFrame(index: number, frameCount: number): PixelMatrix {
  const matrix = createMatrix16x96();
  const width = Math.max(1, Math.round(((index + 1) / frameCount) * 96));
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < width; x += 1) {
      matrix[y][x] = y < 8 ? "yellow" : "white";
    }
  }
  drawText(matrix, "TEST", 35, 4, "blue");
  return matrix;
}

type DisplayOperation = {
  id: number;
  label: string;
  connectionGeneration: number;
};

class DisplayOperationCancelled extends Error {
  constructor(operationId: number, startedGeneration: number, currentGeneration: number) {
    super(`op#${operationId} cancelled by disconnect generation ${startedGeneration}→${currentGeneration}`);
  }
}
