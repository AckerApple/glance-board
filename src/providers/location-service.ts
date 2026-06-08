import { loadDisplayItemsConfig, saveDisplayItemsConfig } from "../rotation/display-config.js";
import { DisplayItemConfig } from "../rotation/types.js";

export interface ResolvedLocation {
  zip: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
}

export class LocationService {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly configPath?: string
  ) {}

  async current(): Promise<{ zip?: string }> {
    const config = await loadDisplayItemsConfig(this.configPath);
    const item = config.items.find((candidate) => candidate.type === "weather-current" || candidate.type === "fuel-average");
    return { zip: item?.zip };
  }

  async detectByIp(): Promise<ResolvedLocation> {
    const response = await this.fetchImpl("https://ipapi.co/json/", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`IP location lookup returned HTTP ${response.status}`);

    const data = await response.json() as Record<string, unknown>;
    if (data.country_code !== "US" || typeof data.postal !== "string") {
      throw new Error("IP location lookup did not return a U.S. ZIP code");
    }

    return this.resolveZip(data.postal);
  }

  async saveZip(zip: string): Promise<ResolvedLocation> {
    const location = await this.resolveZip(zip);
    const config = await loadDisplayItemsConfig(this.configPath);
    const items = config.items.map((item) => applyLocation(item, location));
    await saveDisplayItemsConfig({ ...config, items }, this.configPath);
    return location;
  }

  async resolveZip(value: string): Promise<ResolvedLocation> {
    const zip = normalizeZip(value);
    const response = await this.fetchImpl(`https://api.zippopotam.us/us/${zip}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error(`ZIP code ${zip} was not found`);
      throw new Error(`ZIP code lookup returned HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const places = Array.isArray(data.places) ? data.places : [];
    const place = isRecord(places[0]) ? places[0] : {};
    const city = typeof place["place name"] === "string" ? place["place name"] : "";
    const state = typeof place["state abbreviation"] === "string" ? place["state abbreviation"] : "";
    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);

    if (!city || !state || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`ZIP code lookup returned incomplete data for ${zip}`);
    }

    return { zip, city, state, latitude, longitude };
  }
}

function applyLocation(item: DisplayItemConfig, location: ResolvedLocation): DisplayItemConfig {
  if (item.type === "weather-current") {
    return {
      ...item,
      zip: location.zip,
      latitude: location.latitude,
      longitude: location.longitude
    };
  }

  if (item.type === "fuel-average") {
    return {
      ...item,
      zip: location.zip,
      state: location.state,
      metro: location.city
    };
  }

  return item;
}

function normalizeZip(value: string): string {
  const zip = value.trim();
  if (!/^\d{5}$/.test(zip)) throw new Error("Enter a valid 5-digit U.S. ZIP code");
  return zip;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
