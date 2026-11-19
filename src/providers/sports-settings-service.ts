import { isBuiltInDisplayItemId, loadDisplayItemsConfig, saveDisplayItemsConfig } from "../rotation/display-config.js";
import { readJsonFile, writeJsonFile } from "../server/local-config.js";
import type { DisplayItemConfig, DisplayItemsConfig, SportsLeague } from "../rotation/types.js";

export interface SportsTeam { league: SportsLeague; id: string; name: string; abbreviation: string }
const legacyIds: Partial<Record<SportsLeague, string>> = { nfl: "miami-dolphins-next", mlb: "miami-marlins-next" };
const legacyNextId = (team: SportsTeam) => FAVORITE_TEAMS.some(favorite => favorite.league === team.league && favorite.id === team.id) ? legacyIds[team.league] : undefined;
export const FAVORITE_TEAMS: SportsTeam[] = [
  { league: "nfl", id: "15", name: "Miami Dolphins", abbreviation: "MIA" },
  { league: "nba", id: "14", name: "Miami Heat", abbreviation: "MIA" },
  { league: "nhl", id: "26", name: "Florida Panthers", abbreviation: "FLA" },
  { league: "mlb", id: "28", name: "Miami Marlins", abbreviation: "MIA" }
];
const sports: Record<SportsLeague, string> = { nfl: "football", nba: "basketball", nhl: "hockey", mlb: "baseball" };
export function isSportsLeague(value: unknown): value is SportsLeague { return typeof value === "string" && Object.hasOwn(sports, value); }
export function isSportsItem(item: DisplayItemConfig): boolean { return item.type === "sports-live-score" || item.type === "sports-next-game"; }
export function isTeamItem(item: DisplayItemConfig, team: SportsTeam): boolean {
  return isSportsItem(item) && item.league === team.league && (item.teamId ? item.teamId === team.id : item.team?.toUpperCase() === team.abbreviation.toUpperCase());
}
interface SportsStorage {
  load(): Promise<DisplayItemsConfig>;
  save(config: DisplayItemsConfig): Promise<void>;
  initialized(): Promise<boolean>;
  markInitialized(): Promise<void>;
}
const storage: SportsStorage = {
  load: loadDisplayItemsConfig, save: saveDisplayItemsConfig,
  initialized: async () => Boolean((await readJsonFile("sports-settings.json", { initialized: false })).initialized),
  markInitialized: () => writeJsonFile("sports-settings.json", { initialized: true })
};

export class SportsSettingsService {
  private cache = new Map<SportsLeague, { teams: SportsTeam[]; expires: number }>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: SportsStorage = storage, private readonly fetchImpl: typeof fetch = fetch) {}

  async initialize(): Promise<void> {
    if (await this.store.initialized()) return;
    await this.mutate(async config => {
      for (const team of FAVORITE_TEAMS) this.addToConfig(config, team);
      return config;
    });
    await this.store.markInitialized();
  }

  async selected(): Promise<SportsTeam[]> {
    return this.selectedFromConfig(await this.store.load());
  }

  private selectedFromConfig(config: DisplayItemsConfig): SportsTeam[] {
    const selected = new Map<string, SportsTeam>();
    for (const item of config.items.filter(isSportsItem)) {
      if (!item.league || (!item.teamId && !item.team)) continue;
      const known = FAVORITE_TEAMS.find(team => isTeamItem(item, team));
      const id = item.teamId ?? known?.id;
      // Legacy unknown abbreviation-only cards remain editable below. The
      // catalog can upgrade them when that team is added, without duplicating.
      if (!id) continue;
      const team = { league: item.league, id, name: item.teamName ?? known?.name ?? item.team ?? id, abbreviation: item.team ?? known?.abbreviation ?? id };
      selected.set(`${team.league}:${team.id}`, team);
    }
    return [...selected.values()];
  }

  async teams(league: SportsLeague): Promise<SportsTeam[]> {
    const cached = this.cache.get(league);
    if (cached && cached.expires > Date.now()) return cached.teams;
    const response = await this.fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${sports[league]}/${league}/teams?limit=1000`, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Team directory unavailable (HTTP ${response.status}). Try again.`);
    const payload = await response.json() as { sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: { id?: string; displayName?: string; abbreviation?: string } }> }> }> };
    const teams = (payload.sports ?? []).flatMap(sport => sport.leagues ?? []).flatMap(entry => entry.teams ?? []).flatMap(({ team }) =>
      team && /^\d+$/.test(String(team.id)) && team.displayName && team.abbreviation
        ? [{ league, id: String(team.id), name: team.displayName, abbreviation: team.abbreviation }] : []);
    if (!teams.length) throw new Error("Team directory returned no teams. Try again.");
    this.cache.set(league, { teams, expires: Date.now() + 24 * 60 * 60_000 });
    return teams;
  }

  async add(league: SportsLeague, id: string): Promise<void> {
    const team = FAVORITE_TEAMS.find(team => team.league === league && team.id === id) ?? (await this.teams(league)).find(team => team.id === id);
    if (!team) throw new Error("Team not found in this league.");
    await this.mutate(async config => { this.addToConfig(config, team); return config; });
  }

  async remove(league: SportsLeague, id: string): Promise<void> {
    await this.mutate(async config => {
      const team = this.selectedFromConfig(config).find(team => team.league === league && team.id === id);
      if (!team) return config;
      const removed = config.items.filter(item => isTeamItem(item, team));
      const excludedBuiltInIds = [...new Set([...(config.excludedBuiltInIds ?? []), ...removed.map(item => item.id).filter(isBuiltInDisplayItemId)])];
      return { ...config, excludedBuiltInIds, items: config.items.filter(item => !isTeamItem(item, team)) };
    });
  }

  private addToConfig(config: DisplayItemsConfig, team: SportsTeam): void {
    const legacyId = legacyNextId(team);
    const wasExcluded = Boolean(legacyId && config.excludedBuiltInIds?.includes(legacyId));
    if (wasExcluded) config.excludedBuiltInIds = config.excludedBuiltInIds?.filter(id => id !== legacyId);
    // Upgrade legacy abbreviation-based entries in place, retaining IDs,
    // category, enabled state and every unrelated display configuration.
    config.items = config.items.map(item => isTeamItem(item, team) ? { ...item, teamId: team.id, teamName: team.name } : item);
    for (const type of ["sports-live-score", "sports-next-game"] as const) {
      if (config.items.some(item => isTeamItem(item, team) && item.type === type && !item.mode)) continue;
      config.items.push({ id: type === "sports-next-game" && wasExcluded && legacyId && !config.items.some(item => item.id === legacyId) ? legacyId : `sports-${team.league}-${team.id}-${type === "sports-live-score" ? "live" : "next"}`, enabled: true, categoryId: "sports", type, league: team.league, team: team.abbreviation, teamId: team.id, teamName: team.name });
    }
  }

  private mutate(change: (config: DisplayItemsConfig) => Promise<DisplayItemsConfig>): Promise<void> {
    const next = this.writes.then(async () => this.store.save(await change(await this.store.load())));
    this.writes = next.catch(() => undefined);
    return next;
  }
}
