import { CoolLedUxDisplay } from "../hardware/coolleduX/CoolLedUxDisplay.js";
import { buildScrollDownFrames } from "../matrix/animation.js";
import { renderDisplayCardToDisplayMatrix16x96, renderNbaDisplayModeToDisplayMatrix16x96 } from "../matrix/matrix.js";
import { NbaDisplayMode, NormalizedDisplayCard, NormalizedGameScore } from "../rotation/types.js";

export type DotMatrixConnectionStatus = "idle" | "connecting" | "connected" | "sending" | "error";

const TRANSITION_FRAME_DELAY_MS = 70;
const FINAL_FRAME_CONFIRM_DELAY_MS = 500;
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
      console.log(this.lastMessage);
    }
    return this.snapshot();
  }

  setIntensity(intensity: number): DotMatrixStatus {
    this.intensity = normalizeIntensity(intensity);
    this.display.intensity = this.intensity;
    this.lastMessage = `💡 Intensity ${Math.round(this.intensity * 100)}%`;
    return this.snapshot();
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
      console.warn("⚠️ display connect failed", error instanceof Error ? error.message : error);
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
      this.status = "idle";
      this.lastMessage = "⏹️ Disconnected";
      return this.snapshot();
    } finally {
      this.manualDisconnectInFlight = false;
    }
  }

  async sendGame(game: NormalizedGameScore, mode: NbaDisplayMode = "live_score"): Promise<DotMatrixStatus> {
    try {
      this.status = "sending";
      this.lastMessage = "✏️ NBA score";
      await this.display.sendMatrix(renderNbaDisplayModeToDisplayMatrix16x96(mode, game), game.displayLines.join(" "));
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = "✅ NBA score sent";
    } catch (error) {
      console.warn("⚠️ NBA send failed; disconnecting display", error instanceof Error ? error.message : error);
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async sendCard(card: NormalizedDisplayCard): Promise<DotMatrixStatus> {
    try {
      this.status = "sending";
      this.lastMessage = `✏️ ${card.title}`;
      await this.display.sendMatrix(renderDisplayCardToDisplayMatrix16x96(card), card.readableLines.join(" "));
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = `✅ ${card.title}`;
    } catch (error) {
      console.warn(`⚠️ ${card.title} send failed; disconnecting display`, error instanceof Error ? error.message : error);
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async sendCardTransition(current: NormalizedDisplayCard | undefined, next: NormalizedDisplayCard): Promise<DotMatrixStatus> {
    if (!current) return this.sendCard(next);

    try {
      this.status = "sending";
      this.lastMessage = `✏️ ${current.title} → ${next.title}`;
      const currentMatrix = renderDisplayCardToDisplayMatrix16x96(current);
      const nextMatrix = renderDisplayCardToDisplayMatrix16x96(next);
      const frames = buildScrollDownFrames(
        currentMatrix,
        nextMatrix,
        { durationMs: 560, fps: 14 }
      );
      const transitionFrames = frames.slice(1);
      if (TRANSITION_UPLOAD_MODE === "sequence") {
        await this.display.sendMatrixSequence(transitionFrames, `${current.title} → ${next.title}`, TRANSITION_FRAME_DELAY_MS);
        await this.display.confirmMatrix(nextMatrix, `${next.title} confirm`, FINAL_FRAME_CONFIRM_DELAY_MS);
      } else {
        await this.display.sendMatrices(transitionFrames, `${current.title} → ${next.title}`);
      }
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = `✅ ${next.title}`;
    } catch (error) {
      console.warn(`⚠️ ${current.title} → ${next.title} send failed; disconnecting display`, error instanceof Error ? error.message : error);
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  private handleUnexpectedDisconnect(): void {
    if (this.manualDisconnectInFlight || this.status === "idle") return;
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
