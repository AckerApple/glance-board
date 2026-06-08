import { DisplayItemConfig } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

interface WeatherPoint {
  latitude: number;
  longitude: number;
  label: string;
}

interface WeatherResolved {
  readableLines: string[];
  matrixLines: string[];
  weather: {
    temperature?: number;
    humidity?: number;
    rainNow: boolean;
    rainWithinTwoHours: boolean;
    nextRain: string;
  };
  debug: Record<string, unknown>;
  raw?: unknown;
}

const ZIP_POINTS: Record<string, WeatherPoint> = {
  "33066": {
    latitude: 26.2556,
    longitude: -80.2073,
    label: "33066"
  }
};

export class WeatherProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(config: DisplayItemConfig): Promise<WeatherResolved> {
    const point = getWeatherPoint(config);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(point.latitude));
    url.searchParams.set("longitude", String(point.longitude));
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,rain");
    url.searchParams.set("hourly", "precipitation_probability,precipitation,rain");

    const response = await this.fetchImpl(url.toString(), {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Weather API returned HTTP ${response.status}`);
    }

    const raw = await response.json();
    const current = isRecord(raw.current) ? raw.current : {};
    const hourly = isRecord(raw.hourly) ? raw.hourly : {};
    const temp = roundNumber(current.temperature_2m);
    const humidity = roundNumber(current.relative_humidity_2m);
    const rainNow = Number(current.precipitation ?? 0) > 0 || Number(current.rain ?? 0) > 0;
    const rainForecast = findNextRain(hourly, rainNow);

    const lines = sanitizeDisplayLines([`${temp ?? "--"}F H${humidity ?? "--"}`, rainForecast.label]);

    return {
      weather: {
        temperature: temp,
        humidity,
        rainNow,
        rainWithinTwoHours: rainForecast.withinTwoHours,
        nextRain: rainForecast.label
      },
      readableLines: lines,
      matrixLines: lines.map((line) => fitDisplayLine(line, 12)),
      debug: {
        zip: config.zip,
        label: point.label,
        latitude: point.latitude,
        longitude: point.longitude,
        temp,
        humidity,
        nextRain: rainForecast.label,
        rainWithinTwoHours: rainForecast.withinTwoHours
      },
      raw
    };
  }
}

function getWeatherPoint(config: DisplayItemConfig): WeatherPoint {
  if (typeof config.latitude === "number" && typeof config.longitude === "number") {
    return {
      latitude: config.latitude,
      longitude: config.longitude,
      label: config.zip ?? "custom"
    };
  }

  const zip = config.zip ?? "33066";
  const point = ZIP_POINTS[zip];
  if (!point) throw new Error(`No local weather coordinates configured for ZIP ${zip}`);
  return point;
}

function findNextRain(hourly: Record<string, unknown>, rainNow: boolean): { label: string; withinTwoHours: boolean } {
  if (rainNow) return { label: "RAIN NOW", withinTwoHours: true };

  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const probabilities = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const precipitation = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
  const rain = Array.isArray(hourly.rain) ? hourly.rain : [];
  const now = Date.now();

  for (let index = 0; index < times.length; index += 1) {
    const time = typeof times[index] === "string" ? Date.parse(times[index]) : Number.NaN;
    if (!Number.isFinite(time) || time <= now) continue;

    const probability = Number(probabilities[index] ?? 0);
    const precipAmount = Number(precipitation[index] ?? 0);
    const rainAmount = Number(rain[index] ?? 0);
    if (probability >= 30 || precipAmount > 0 || rainAmount > 0) {
      return {
        label: `RAIN ${formatWeatherTime(new Date(time))}`,
        withinTwoHours: time - now <= 2 * 60 * 60 * 1000
      };
    }
  }

  return { label: "NO RAIN 72H", withinTwoHours: false };
}

function formatWeatherTime(date: Date): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: true
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value?.[0] ?? "";
  return `${hour}${dayPeriod}`.toUpperCase();
}

function roundNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
