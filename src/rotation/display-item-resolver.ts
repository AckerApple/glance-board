import { SportsProvider } from "../providers/sports-provider.js";
import { WeatherProvider } from "../providers/weather-provider.js";
import { MoonProvider } from "../providers/moon-provider.js";
import { FuelProvider } from "../providers/fuel-provider.js";
import { DateTimeProvider } from "../providers/date-time-provider.js";
import { GoogleCalendarProvider } from "../providers/google-calendar-provider.js";
import { GoogleCalendarService } from "../providers/google-calendar-service.js";
import { ICloudCalendarProvider } from "../providers/icloud-calendar-provider.js";
import { ICloudCalendarService } from "../providers/icloud-calendar-service.js";
import { DisplayItemConfig, NormalizedDisplayCard, NormalizedGameScore } from "./types.js";
import { calendarStatusToGameStatus } from "../providers/calendar-display-provider.js";
import { sanitizeDisplayText } from "../matrix/text-sanitizer.js";

export class DisplayItemResolver {
  constructor(
    private readonly sportsProvider = new SportsProvider(),
    private readonly weatherProvider = new WeatherProvider(),
    private readonly moonProvider = new MoonProvider(),
    private readonly fuelProvider = new FuelProvider(),
    private readonly dateTimeProvider = new DateTimeProvider(),
    private readonly googleCalendarProvider = new GoogleCalendarProvider(new GoogleCalendarService(Number(process.env.PORT) || 3010)),
    private readonly icloudCalendarProvider = new ICloudCalendarProvider(new ICloudCalendarService())
  ) {}

  async resolve(config: DisplayItemConfig): Promise<NormalizedDisplayCard> {
    try {
      const resolved =
        config.type === "weather-current"
          ? await this.weatherProvider.resolve(config)
          : config.type === "moon-phase"
            ? this.moonProvider.resolve(config)
            : config.type === "fuel-average"
              ? await this.fuelProvider.resolve(config)
            : config.type === "date-time"
              ? this.dateTimeProvider.resolve(config)
              : config.type === "google-calendar-next-event"
                ? await this.googleCalendarProvider.resolve(config)
                : config.type === "icloud-calendar-next-event"
                  ? await this.icloudCalendarProvider.resolve(config)
                : await this.sportsProvider.resolve(config);
      const game = hasGame(resolved) ? resolved.game : undefined;
      const calendar = hasCalendar(resolved) ? resolved.calendar : undefined;
      return {
        id: config.id,
        enabled: config.enabled,
        type: config.type,
        categoryId: config.categoryId,
        league: config.league,
        title: titleForConfig(config),
        status:
          game?.status ??
          (config.type === "weather-current" || config.type === "moon-phase" || config.type === "fuel-average" || config.type === "date-time"
            ? "live"
            : config.type === "google-calendar-next-event" || config.type === "icloud-calendar-next-event"
              ? calendarStatusToGameStatus(calendar?.status)
              : "no_game"),
        readableLines: resolved.readableLines,
        matrixLines: resolved.matrixLines,
        game,
        moon: hasMoon(resolved) ? resolved.moon : undefined,
        weather: hasWeather(resolved) ? resolved.weather : undefined,
        dateTime: hasDateTime(resolved) ? resolved.dateTime : undefined,
        calendar,
        debug: resolved.debug,
        raw: hasRaw(resolved) ? resolved.raw : undefined
      };
    } catch (error) {
      return {
        id: config.id,
        enabled: config.enabled,
        type: config.type,
        categoryId: config.categoryId,
        league: config.league,
        title: titleForConfig(config),
        status: "error",
        readableLines: ["DISPLAY", "ERROR"],
        matrixLines: ["DISPLAY", "ERROR"],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

function hasGame(value: unknown): value is { game?: NormalizedGameScore } {
  return typeof value === "object" && value !== null && "game" in value;
}

function hasMoon(value: unknown): value is { moon: NormalizedDisplayCard["moon"] } {
  return typeof value === "object" && value !== null && "moon" in value;
}

function hasWeather(value: unknown): value is { weather: NormalizedDisplayCard["weather"] } {
  return typeof value === "object" && value !== null && "weather" in value;
}

function hasDateTime(value: unknown): value is { dateTime: NormalizedDisplayCard["dateTime"] } {
  return typeof value === "object" && value !== null && "dateTime" in value;
}

function hasCalendar(value: unknown): value is { calendar: NormalizedDisplayCard["calendar"] } {
  return typeof value === "object" && value !== null && "calendar" in value;
}

function hasRaw(value: unknown): value is { raw?: unknown } {
  return typeof value === "object" && value !== null && "raw" in value;
}

function titleForConfig(config: DisplayItemConfig): string {
  if (config.type === "weather-current") return sanitizeDisplayText(`Weather ${config.zip ?? ""}`.trim());
  if (config.type === "moon-phase") return "MOON PHASE";
  if (config.type === "fuel-average") return sanitizeDisplayText(`Gas Avg ${config.zip ?? ""}`.trim());
  if (config.type === "date-time") return "DATE TIME";
  if (config.type === "google-calendar-next-event") return sanitizeDisplayText(`Calendar ${Number(config.eventIndex ?? 0) + 1}`);
  if (config.type === "icloud-calendar-next-event") return sanitizeDisplayText(`iCloud ${Number(config.eventIndex ?? 0) + 1}`);
  const parts = [config.league?.toUpperCase(), config.mode === "finals" ? "Finals" : config.team, config.type === "sports-live-score" ? "Live" : "Next"];
  return sanitizeDisplayText(parts.filter(Boolean).join(" "));
}
