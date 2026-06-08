export type GameStatus = "loading" | "scheduled" | "live" | "final" | "postponed" | "no_game" | "error" | "not_configured";
export type NbaDisplayMode = "live_score" | "next_game";
export type SportsLeague = "nba" | "nhl" | "nfl";
export type LeagueLabel = "NBA" | "NHL" | "NFL";
export type DisplayItemType =
  | "sports-live-score"
  | "sports-next-game"
  | "weather-current"
  | "moon-phase"
  | "fuel-average"
  | "date-time"
  | "google-calendar-next-event"
  | "icloud-calendar-next-event";
export type CalendarSourceType = "google-calendar" | "icloud-calendar";
export type DisplayItemMode = "finals";

export interface DisplayItemsConfig {
  rotationSeconds: number;
  items: DisplayItemConfig[];
}

export interface DisplayItemConfig {
  id: string;
  enabled: boolean;
  type: DisplayItemType;
  league?: SportsLeague;
  mode?: DisplayItemMode;
  team?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  state?: string;
  metro?: string;
  calendarId?: string;
  eventIndex?: number;
}

export interface MoonPhaseData {
  phaseName: string;
  illumination: number;
  waxing: boolean;
  daysUntilFullMoon: number;
}

export interface WeatherData {
  temperature?: number;
  humidity?: number;
  rainNow: boolean;
  rainWithinTwoHours: boolean;
  nextRain: string;
}

export interface DateTimeData {
  iso: string;
  scheduledDate: string;
}

export interface NormalizedCalendarEvent {
  id: string;
  provider?: "google" | "icloud";
  calendarId: string;
  calendarName?: string;
  title: string;
  startTime: string;
  endTime?: string;
  isAllDay: boolean;
  location?: string;
  description?: string;
  htmlLink?: string;
}

export interface CalendarDisplayData {
  sourceType: CalendarSourceType;
  status: "ready" | "empty" | "error" | "not_configured";
  title: string;
  dateLabel: string;
  timeLabel: string;
  shortTitle: string;
  eventIndex: number;
  isBirthday?: boolean;
  event?: NormalizedCalendarEvent;
  error?: string;
}

export interface NormalizedDisplayCard {
  id: string;
  enabled: boolean;
  type: DisplayItemType;
  league?: SportsLeague;
  title: string;
  status: GameStatus;
  readableLines: string[];
  matrixLines: string[];
  game?: NormalizedGameScore;
  moon?: MoonPhaseData;
  weather?: WeatherData;
  dateTime?: DateTimeData;
  calendar?: CalendarDisplayData;
  error?: string;
  debug?: Record<string, unknown>;
  raw?: unknown;
}

export interface RotationDisplayState {
  rotationSeconds: number;
  items: Array<DisplayItemConfig & { resolved?: boolean; error?: string }>;
  cards: NormalizedDisplayCard[];
  activeCard?: NormalizedDisplayCard;
  lastUpdated: string;
  debug?: Record<string, unknown>;
  raw?: unknown;
}

export interface NormalizedTeamScore {
  name: string;
  abbreviation: string;
  score?: number;
}

export interface NormalizedGameScore {
  id?: string;
  status: GameStatus;
  league: LeagueLabel;
  eventName?: string;
  shortName?: string;
  seriesSummary?: string;
  isNbaFinals?: boolean;
  awayTeam?: NormalizedTeamScore;
  homeTeam?: NormalizedTeamScore;
  period?: number;
  clock?: string;
  scheduledTime?: string;
  scheduledDate?: string;
  displayLines: string[];
  raw?: unknown;
  error?: string;
}

export interface NbaDisplayState {
  currentGame?: NormalizedGameScore;
  nextGame?: NormalizedGameScore;
  mode: NbaDisplayMode;
  lastUpdated?: string;
  error?: string;
  debug: {
    todayEvents: number;
    scheduleEvents: number;
    finalsEvents: number;
    fetchedDates: string[];
    selectedCurrent?: string;
    selectedNext?: string;
  };
  raw?: unknown;
}

export interface NbaScoreResponse {
  state: NbaDisplayState;
  displays: Record<NbaDisplayMode, { readableLines: string[]; dotMatrix: string[][] } | undefined>;
  game: NormalizedGameScore;
  dotMatrix: string[][];
  fetchedAt: string;
  source: "espn";
}

export interface DotMatrixStatus {
  status: "idle" | "connecting" | "connected" | "sending" | "error";
  deviceName: string;
  deviceId?: string;
  autoSend: boolean;
  intensity: number;
  lastMessage?: string;
  lastSentAt?: string;
}
