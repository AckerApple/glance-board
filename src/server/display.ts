import { CoolLedUxDisplay } from "../hardware/coolleduX/CoolLedUxDisplay.js";
import { renderDisplayCardToDisplayMatrix16x96, renderNbaDisplayModeToDisplayMatrix16x96 } from "../matrix/matrix.js";
import { NbaDisplayMode, NormalizedDisplayCard, NormalizedGameScore } from "../rotation/types.js";

export type DotMatrixConnectionStatus = "idle" | "connecting" | "connected" | "sending" | "error";

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
      height: 16
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
    this.lastMessage = enabled ? "Auto-send enabled" : "Auto-send disabled";
    return this.snapshot();
  }

  isAutoSendEnabled(): boolean {
    return this.autoSend;
  }

  isReadyToSend(): boolean {
    return this.status === "connected" || this.status === "sending";
  }

  isConnected(): boolean {
    return this.status === "connected";
  }

  setIntensity(intensity: number): DotMatrixStatus {
    this.intensity = normalizeIntensity(intensity);
    this.display.intensity = this.intensity;
    this.lastMessage = `Intensity set to ${Math.round(this.intensity * 100)}%`;
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
      if (this.status === "connected") return this.snapshot();
      this.status = "connecting";
      this.lastMessage = "Connecting to dot matrix display...";
      await this.display.connect();
      this.status = "connected";
      this.lastMessage = "Connected to dot matrix display";
    } catch (error) {
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async disconnect(): Promise<DotMatrixStatus> {
    await this.display.disconnect();
    this.status = "idle";
    this.lastMessage = "Disconnected";
    return this.snapshot();
  }

  async sendGame(game: NormalizedGameScore, mode: NbaDisplayMode = "live_score"): Promise<DotMatrixStatus> {
    try {
      this.status = "sending";
      this.lastMessage = "Sending NBA score to dot matrix...";
      await this.display.sendMatrix(renderNbaDisplayModeToDisplayMatrix16x96(mode, game), game.displayLines.join(" "));
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = "Sent NBA score to dot matrix";
    } catch (error) {
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }

  async sendCard(card: NormalizedDisplayCard): Promise<DotMatrixStatus> {
    try {
      this.status = "sending";
      this.lastMessage = `Sending ${card.title} to dot matrix...`;
      await this.display.sendMatrix(renderDisplayCardToDisplayMatrix16x96(card), card.readableLines.join(" "));
      this.status = "connected";
      this.lastSentAt = new Date().toISOString();
      this.lastMessage = `Sent ${card.title} to dot matrix`;
    } catch (error) {
      await this.display.disconnect().catch(() => undefined);
      this.status = "error";
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }

    return this.snapshot();
  }
}

function normalizeIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) return 1;
  return Math.max(0.1, Math.min(1, intensity));
}
