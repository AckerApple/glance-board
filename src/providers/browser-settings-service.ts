import { readJsonFile, writeJsonFile } from "../server/local-config.js";

const SETTINGS_FILE = "browser-form-settings.json";

export interface BrowserFormSettings {
  autoSendRotation: boolean;
  displayIntensity: number;
}

const DEFAULT_SETTINGS: BrowserFormSettings = {
  autoSendRotation: false,
  displayIntensity: 1
};

interface BrowserSettingsStorage {
  read<T>(fileName: string, fallback: T): Promise<T>;
  write(fileName: string, value: unknown): Promise<void>;
}

const defaultStorage: BrowserSettingsStorage = {
  read: readJsonFile,
  write: writeJsonFile
};

export class BrowserSettingsService {
  constructor(private readonly storage: BrowserSettingsStorage = defaultStorage) {}

  async get(): Promise<BrowserFormSettings> {
    return normalizeSettings(await this.storage.read<Partial<BrowserFormSettings>>(SETTINGS_FILE, {}));
  }

  async save(patch: Partial<BrowserFormSettings>): Promise<BrowserFormSettings> {
    const current = await this.get();
    const settings = normalizeSettings({ ...current, ...patch });
    await this.storage.write(SETTINGS_FILE, settings);
    return settings;
  }
}

function normalizeSettings(value: Partial<BrowserFormSettings>): BrowserFormSettings {
  const intensity = Number(value.displayIntensity);
  return {
    autoSendRotation: Boolean(value.autoSendRotation),
    displayIntensity: Number.isFinite(intensity) ? Math.max(0.1, Math.min(1, intensity)) : DEFAULT_SETTINGS.displayIntensity
  };
}
