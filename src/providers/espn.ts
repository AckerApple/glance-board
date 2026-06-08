import { LeagueLabel, NbaDisplayState, NormalizedGameScore, SportsLeague } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayText } from "../matrix/text-sanitizer.js";

const ESPN_SCOREBOARD_URLS: Record<SportsLeague, string> = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nhl: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
};

const LEAGUE_LABELS: Record<SportsLeague, LeagueLabel> = {
  nba: "NBA",
  nhl: "NHL",
  nfl: "NFL"
};

type UnknownRecord = Record<string, unknown>;

export async function fetchNbaScoreboard(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return fetchScoreboard("nba", fetchImpl);
}

export async function fetchNbaScoreboardForDate(date: Date, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return fetchScoreboardForDate("nba", date, fetchImpl);
}

export async function fetchNbaScoreboardWindow(daysAhead = 14, fetchImpl: typeof fetch = fetch): Promise<Array<{ date: string; data: unknown }>> {
  return fetchScoreboardWindow("nba", daysAhead, fetchImpl);
}

export async function fetchScoreboard(league: SportsLeague, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return fetchScoreboardUrl(ESPN_SCOREBOARD_URLS[league], fetchImpl);
}

export async function fetchScoreboardForDate(league: SportsLeague, date: Date, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = new URL(ESPN_SCOREBOARD_URLS[league]);
  url.searchParams.set("dates", formatEspnDate(date));
  url.searchParams.set("limit", "100");
  return fetchScoreboardUrl(url.toString(), fetchImpl);
}

export async function fetchScoreboardForDateRange(league: SportsLeague, start: Date, end: Date, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = new URL(ESPN_SCOREBOARD_URLS[league]);
  url.searchParams.set("dates", `${formatEspnDate(start)}-${formatEspnDate(end)}`);
  url.searchParams.set("limit", "1000");
  return fetchScoreboardUrl(url.toString(), fetchImpl);
}

export async function fetchScoreboardWindow(league: SportsLeague, daysAhead = 14, fetchImpl: typeof fetch = fetch): Promise<Array<{ date: string; data: unknown }>> {
  const dates = Array.from({ length: daysAhead + 1 }, (_, dayOffset) => {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    return date;
  });

  const settled = await Promise.allSettled(dates.map(async (date) => ({ date: formatEspnDate(date), data: await fetchScoreboardForDate(league, date, fetchImpl) })));
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

async function fetchScoreboardUrl(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`ESPN scoreboard returned HTTP ${response.status}`);
  }

  return response.json();
}

export async function fetchNbaDisplayState(fetchImpl: typeof fetch = fetch, daysAhead = 14): Promise<NbaDisplayState> {
  const todayRaw = await fetchScoreboard("nba", fetchImpl);
  const scheduleRaw = await fetchScoreboardWindow("nba", daysAhead, fetchImpl);
  const todayEvents = normalizeEspnEvents("nba", todayRaw);
  const scheduleEvents = scheduleRaw.flatMap((entry) => normalizeEspnEvents("nba", entry.data));
  const allEvents = dedupeGames([...todayEvents, ...scheduleEvents]);
  const finalsEvents = allEvents.filter((game) => isFinalsGame("nba", game));
  const currentGame = selectCurrentFinalsGame(finalsEvents) ?? selectCurrentFinalsGame(allEvents);
  const nextGame = selectNextFinalsGame(finalsEvents, new Date()) ?? selectNextFinalsGame(allEvents, new Date());

  return {
    currentGame,
    nextGame,
    mode: currentGame && nextGame ? "live_score" : nextGame ? "next_game" : "live_score",
    lastUpdated: new Date().toISOString(),
    debug: {
      todayEvents: todayEvents.length,
      scheduleEvents: scheduleEvents.length,
      finalsEvents: finalsEvents.length,
      fetchedDates: scheduleRaw.map((entry) => entry.date),
      selectedCurrent: currentGame?.shortName ?? currentGame?.eventName,
      selectedNext: nextGame?.shortName ?? nextGame?.eventName
    },
    raw: {
      today: todayRaw,
      schedule: scheduleRaw
    }
  };
}

export function normalizeEspnNbaScoreboard(data: unknown): NormalizedGameScore {
  const events = normalizeEspnEvents("nba", data);
  const selected = selectBestGame(events);

  if (!selected) {
    return {
      status: "no_game",
      league: "NBA",
      displayLines: ["NO NBA", "GAMES"],
      raw: data
    };
  }

  try {
    const game = normalizeEvent("nba", selected);
    return {
      ...game,
      raw: selected.raw
    };
  } catch (error) {
    return {
      status: "error",
      league: "NBA",
      displayLines: ["PARSER", "ERROR"],
      raw: selected,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function normalizeEspnNbaEvents(data: unknown): NormalizedGameScore[] {
  return normalizeEspnEvents("nba", data);
}

export function normalizeEspnEvents(league: SportsLeague, data: unknown): NormalizedGameScore[] {
  return getEvents(data).flatMap((event) => {
    try {
      return [normalizeEvent(league, event)];
    } catch {
      return [];
    }
  });
}

export function selectBestGame(events: NormalizedGameScore[]): NormalizedGameScore | null {
  if (events.length === 0) return null;

  const ranked = events
    .map((event, index) => ({ event, index, rank: rankEvent(event, index) }))
    .sort((a, b) => a.rank - b.rank);

  return ranked[0]?.event ?? null;
}

export function isNbaFinalsGame(game: NormalizedGameScore): boolean {
  return isFinalsGame("nba", game);
}

export function isFinalsGame(league: SportsLeague, game: NormalizedGameScore): boolean {
  if (league === "nba" && game.isNbaFinals) return true;
  const haystack = [game.eventName, game.shortName, game.seriesSummary].filter(Boolean).join(" ").toLowerCase();
  if (league === "nhl") return haystack.includes("stanley cup") || haystack.includes("final");
  if (league === "nba") return haystack.includes("nba finals") || haystack.includes("finals");
  return haystack.includes("super bowl") || haystack.includes("championship");
}

export function selectCurrentFinalsGame(games: NormalizedGameScore[]): NormalizedGameScore | undefined {
  return games
    .filter((game) => game.status === "live" || game.status === "final")
    .sort((a, b) => currentGameRank(a) - currentGameRank(b))[0];
}

export function selectNextFinalsGame(games: NormalizedGameScore[], now: Date): NormalizedGameScore | undefined {
  return games
    .filter((game) => game.status === "scheduled" && game.scheduledDate && Date.parse(game.scheduledDate) > now.getTime())
    .sort((a, b) => Date.parse(a.scheduledDate!) - Date.parse(b.scheduledDate!))[0];
}

export function formatGameForDisplay(game: NormalizedGameScore): string[] {
  return game.displayLines;
}

export function formatGameForDotMatrix(game: NormalizedGameScore): string[] {
  if (game.status === "live") {
    const away = game.awayTeam;
    const home = game.homeTeam;
    return [
      fitLine(`${away?.abbreviation ?? "AWY"}${away?.score ?? "-"} Q${game.period ?? "-"}`),
      fitLine(`${home?.abbreviation ?? "HME"}${home?.score ?? "-"} ${game.clock ?? ""}`.trim())
    ];
  }

  if (game.status === "final") {
    return compactTeamScoreLines(game);
  }

  if (game.status === "scheduled") {
    const away = game.awayTeam?.abbreviation ?? "AWAY";
    const home = game.homeTeam?.abbreviation ?? "HOME";
    return [fitLine(`${away} AT ${home}`), fitLine(game.scheduledTime ?? "SCHED")];
  }

  if (game.status === "postponed") return ["NBA", "POSTP"];
  if (game.status === "error") return ["NBA", "ERROR"];
  if (game.status === "no_game") return ["NO NBA", "GAMES"];
  return ["NBA", "LOAD"];
}

export function formatNextGameForDisplay(game: NormalizedGameScore): string[] {
  const away = game.awayTeam?.abbreviation ?? "AWAY";
  const home = game.homeTeam?.abbreviation ?? "HOME";
  return [`${game.league} FINALS - ${away} AT ${home}`, `${formatReadableDate(game.scheduledDate)} ${game.scheduledTime ?? ""}`.trim(), `Home: ${home}`].map((line) => sanitizeDisplayText(line));
}

export function formatNextGameForDotMatrix(game: NormalizedGameScore): string[] {
  const away = game.awayTeam?.abbreviation ?? "AWY";
  const home = game.homeTeam?.abbreviation ?? "HOME";
  return [fitLine(`${game.league} FIN`), fitLine(`${away} AT ${home}`)];
}

function getEvents(data: unknown): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.events)) return [];
  return data.events;
}

function normalizeEvent(league: SportsLeague, event: unknown): NormalizedGameScore {
  if (!isRecord(event)) throw new Error("event is not an object");

  const competitions = Array.isArray(event.competitions) ? event.competitions : [];
  const competition = competitions.find(isRecord) ?? {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors.filter(isRecord) : [];
  const away = competitors.find((competitor) => competitor.homeAway === "away");
  const home = competitors.find((competitor) => competitor.homeAway === "home");
  const status = normalizeStatus(competition.status ?? event.status);
  const scheduledDate = asString(event.date);
  const game: NormalizedGameScore = {
    id: asString(event.id),
    status,
    league: LEAGUE_LABELS[league],
    eventName: asString(event.name),
    shortName: asString(event.shortName),
    seriesSummary: getSeriesSummary(competition),
    isNbaFinals: league === "nba" ? isFinalsEvent(event) : undefined,
    awayTeam: away ? normalizeTeam(away) : undefined,
    homeTeam: home ? normalizeTeam(home) : undefined,
    period: getPeriod(competition.status ?? event.status),
    clock: getClock(competition.status ?? event.status),
    scheduledTime: formatScheduledTime(scheduledDate),
    scheduledDate,
    displayLines: [],
    raw: event
  };

  game.displayLines = buildDisplayLines(game);
  return game;
}

function normalizeTeam(competitor: UnknownRecord) {
  const team = isRecord(competitor.team) ? competitor.team : {};
  const score = Number(competitor.score);

  return {
    name: asString(team.displayName) ?? asString(team.name) ?? "Unknown",
    abbreviation: (asString(team.abbreviation) ?? asString(team.shortDisplayName) ?? "???").slice(0, 4).toUpperCase(),
    score: Number.isFinite(score) ? score : undefined
  };
}

function normalizeStatus(statusLike: unknown): NormalizedGameScore["status"] {
  const status = isRecord(statusLike) ? statusLike : {};
  const type = isRecord(status.type) ? status.type : {};
  const state = asString(type.state)?.toLowerCase();
  const name = asString(type.name)?.toLowerCase() ?? "";
  const description = asString(type.description)?.toLowerCase() ?? "";

  if (state === "in" || name.includes("in_progress")) return "live";
  if (state === "post" || name.includes("final")) return "final";
  if (description.includes("postponed") || name.includes("postponed")) return "postponed";
  if (state === "pre") return "scheduled";
  return "scheduled";
}

function getPeriod(statusLike: unknown): number | undefined {
  const status = isRecord(statusLike) ? statusLike : {};
  const period = Number(status.period);
  return Number.isFinite(period) && period > 0 ? period : undefined;
}

function getClock(statusLike: unknown): string | undefined {
  const status = isRecord(statusLike) ? statusLike : {};
  const clock = asString(status.displayClock);
  return clock && clock !== "0.0" ? clock : undefined;
}

function buildDisplayLines(game: NormalizedGameScore): string[] {
  if (game.status === "live") {
    return [...compactTeamScoreLines(game), fitLine(`Q${game.period ?? "-"} ${game.clock ?? ""}`.trim())];
  }

  if (game.status === "final") return [...compactTeamScoreLines(game), "Final"];

  if (game.status === "scheduled") {
    const away = game.awayTeam?.abbreviation ?? "AWAY";
    const home = game.homeTeam?.abbreviation ?? "HOME";
    return [`${away} AT ${home}`, game.scheduledTime ?? "Scheduled", "Scheduled"].map((line) => sanitizeDisplayText(line));
  }

  if (game.status === "postponed") return [`${game.league} GAME POSTPONED`];
  return [`NO ${game.league} GAMES FOUND`];
}

function compactTeamScoreLines(game: NormalizedGameScore): string[] {
  const away = game.awayTeam;
  const home = game.homeTeam;
  return [
    fitLine(`${away?.abbreviation ?? "AWY"} ${away?.score ?? "-"}`),
    fitLine(`${home?.abbreviation ?? "HME"} ${home?.score ?? "-"}`)
  ];
}

function rankEvent(event: NormalizedGameScore, index: number): number {
  const status = event.status;
  const finalsBonus = isFinalsGame(event.league.toLowerCase() as SportsLeague, event) ? -100 : 0;
  const statusRank = status === "live" ? 0 : status === "scheduled" ? 20 : status === "final" ? 40 : 60;
  const dateRank = getDateRank(event.scheduledDate);
  return finalsBonus + statusRank + dateRank + index / 1000;
}

function isFinalsEvent(event: unknown): boolean {
  const haystack = JSON.stringify(event).toLowerCase();
  return haystack.includes("nba finals") || haystack.includes("finals");
}

function getDateRank(value: string | undefined): number {
  const date = Date.parse(value ?? "");
  if (!Number.isFinite(date)) return 999999;
  return Math.abs(Date.now() - date) / 86_400_000;
}

function formatScheduledTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatReadableDate(value: string | undefined): string {
  if (!value) return "Date TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBD";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatCompactDate(value: string | undefined): string {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase();
  return `${month}${date.getDate()}`;
}

export function formatCompactTime(value: string | undefined): string {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value?.[0] ?? "";
  return `${hour}:${minute}${dayPeriod}`.toUpperCase();
}

function getSeriesSummary(competition: UnknownRecord): string | undefined {
  const notes = Array.isArray(competition.notes) ? competition.notes.filter(isRecord) : [];
  const note = notes.find((entry) => asString(entry.headline) || asString(entry.type));
  return asString(note?.headline) ?? asString(note?.type);
}

function currentGameRank(game: NormalizedGameScore): number {
  const statusRank = game.status === "live" ? 0 : game.status === "final" ? 10 : 100;
  return statusRank + getDateRank(game.scheduledDate);
}

function dedupeGames(games: NormalizedGameScore[]): NormalizedGameScore[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    const key = game.id ?? `${game.shortName}-${game.scheduledDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatEspnDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function fitLine(value: string): string {
  return fitDisplayLine(value, 10);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
