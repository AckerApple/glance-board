import {
  fetchScoreboard,
  fetchScoreboardForDateRange,
  fetchScoreboardWindow,
  formatCompactDate,
  formatCompactTime,
  isFinalsGame,
  normalizeEspnEvents,
  selectCurrentFinalsGame,
  selectNextFinalsGame
} from "./espn.js";
import { DisplayItemConfig, NormalizedGameScore, SportsLeague } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayLines, sanitizeDisplayText } from "../matrix/text-sanitizer.js";

export class SportsProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(config: DisplayItemConfig): Promise<{ game?: NormalizedGameScore; readableLines: string[]; matrixLines: string[]; debug: Record<string, unknown>; raw?: unknown }> {
    if (config.type === "sports-live-score") {
      return this.resolveLiveScore(config);
    }

    return this.resolveNextGame(config);
  }

  private async resolveLiveScore(config: DisplayItemConfig) {
    const league = requireSportsLeague(config);
    const todayRaw = await fetchScoreboard(league, this.fetchImpl);
    const scheduleRaw = await fetchScoreboardWindow(league, 14, this.fetchImpl);
    const todayEvents = normalizeEspnEvents(league, todayRaw);
    const scheduleEvents = scheduleRaw.flatMap((entry) => normalizeEspnEvents(league, entry.data));
    const allEvents = dedupeGames([...todayEvents, ...scheduleEvents]);
    const scopedEvents = filterByConfig(config, allEvents);
    const game = selectCurrentFinalsGame(scopedEvents) ?? selectCurrentFinalsGame(allEvents);

    if (!game) {
      if (league === "nba") {
        const nextGame = await this.resolveNextGame(config);
        return {
          ...nextGame,
          debug: {
            ...nextGame.debug,
            fallback: "nba-live-score-to-next-game",
            todayEvents: todayEvents.length,
            scheduleEvents: scheduleEvents.length
          },
          raw: { today: todayRaw, schedule: scheduleRaw, fallback: nextGame.raw }
        };
      }

      return noGameResult(config, { todayEvents: todayEvents.length, scheduleEvents: scheduleEvents.length });
    }

    return {
      game,
      readableLines: sanitizeDisplayLines(game.displayLines),
      matrixLines: formatLiveGameMatrix(game),
      debug: {
        todayEvents: todayEvents.length,
        scheduleEvents: scheduleEvents.length,
        scopedEvents: scopedEvents.length,
        selected: game.shortName ?? game.eventName
      },
      raw: { today: todayRaw, schedule: scheduleRaw }
    };
  }

  private async resolveNextGame(config: DisplayItemConfig) {
    const league = requireSportsLeague(config);
    const now = new Date();
    const raw = await this.fetchScheduleRaw(league, config.team);
    const allEvents = Array.isArray(raw) ? raw.flatMap((entry) => normalizeEspnEvents(league, entry.data)) : normalizeEspnEvents(league, raw);
    const scopedEvents = filterByConfig(config, dedupeGames(allEvents));
    const game = selectNextFinalsGame(scopedEvents, now);

    if (!game) return noGameResult(config, { scopedEvents: scopedEvents.length });

    return {
      game,
      readableLines: formatNextGameReadable(config, game),
      matrixLines: formatNextGameMatrix(config, game),
      debug: {
        scopedEvents: scopedEvents.length,
        selected: game.shortName ?? game.eventName,
        scheduledDate: game.scheduledDate
      },
      raw
    };
  }

  private async fetchScheduleRaw(league: SportsLeague, team: string | undefined): Promise<unknown> {
    if (team) {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + (league === "nfl" ? 240 : 120));
      return fetchScoreboardForDateRange(league, start, end, this.fetchImpl);
    }

    return fetchScoreboardWindow(league, league === "nfl" ? 30 : 45, this.fetchImpl);
  }
}

function filterByConfig(config: DisplayItemConfig, games: NormalizedGameScore[]): NormalizedGameScore[] {
  let filtered = games;

  if (config.mode === "finals") {
    filtered = filtered.filter((game) => config.league && isFinalsGame(config.league, game));
  }

  if (config.team) {
    const team = config.team.toUpperCase();
    filtered = filtered.filter((game) => game.awayTeam?.abbreviation === team || game.homeTeam?.abbreviation === team);
  }

  return filtered;
}

function formatNextGameReadable(config: DisplayItemConfig, game: NormalizedGameScore): string[] {
  const month = formatCompactMonth(game.scheduledDate);
  const time = formatCompactTime(game.scheduledDate);
  const matchup = matchupForConfig(config, game);
  return sanitizeDisplayLines([`${requireSportsLeague(config).toUpperCase()} ${month} ${time}`, matchup]);
}

function formatNextGameMatrix(config: DisplayItemConfig, game: NormalizedGameScore): string[] {
  const month = formatCompactMonth(game.scheduledDate);
  const time = formatMatrixTime(game.scheduledDate);
  const matchup = matchupForConfig(config, game);
  return [fitDisplayLine(`${requireSportsLeague(config).toUpperCase()} ${month} ${time}`, 13), fitDisplayLine(matchup, 13)];
}

function formatLiveGameMatrix(game: NormalizedGameScore): string[] {
  const away = game.awayTeam;
  const home = game.homeTeam;

  if (game.status === "live") {
    return sanitizeDisplayLines([
      fitDisplayLine(`${away?.abbreviation ?? "AWY"} ${away?.score ?? "-"} Q${game.period ?? "-"} ${game.league}`, 15),
      fitDisplayLine(`${home?.abbreviation ?? "HME"} ${home?.score ?? "-"} ${game.clock ?? ""}`.trim(), 15)
    ]);
  }

  return sanitizeDisplayLines(game.displayLines.slice(0, 2).map((line) => fitDisplayLine(`${line} ${game.league}`, 15)));
}

function formatCompactMonth(value: string | undefined): string {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase();
}

function formatMatrixTime(value: string | undefined): string {
  return formatCompactTime(value);
}

function matchupForConfig(config: DisplayItemConfig, game: NormalizedGameScore): string {
  const away = game.awayTeam?.abbreviation ?? "AWAY";
  const home = game.homeTeam?.abbreviation ?? "HOME";

  if (config.team) {
    const team = config.team.toUpperCase();
    const opponent = game.awayTeam?.abbreviation === team ? home : away;
    return game.homeTeam?.abbreviation === team ? `${opponent} AT ${team}` : `${team} AT ${opponent}`;
  }

  return `${away} AT ${home}`;
}

function noGameResult(config: DisplayItemConfig, debug: Record<string, unknown>) {
  const league = config.league?.toUpperCase() ?? "SPORTS";
  const lines = sanitizeDisplayLines([`NO ${league}`, "GAME"]);
  return {
    readableLines: lines,
    matrixLines: lines.map((line) => fitDisplayLine(line)),
    debug,
    raw: undefined
  };
}

function requireSportsLeague(config: DisplayItemConfig): SportsLeague {
  if (!config.league) throw new Error(`Display item ${config.id} requires a sports league`);
  return config.league;
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
