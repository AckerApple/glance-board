import type { DisplayItem, SportsTeam } from "./types.js";

// Web-only presentation. Never persist decorated labels or send them to a matrix.
export const UI_EMOJIS = {
  home: "🏠", calendars: "🗓️", sports: "🏈", "local-data": "📍",
  rotation: "🔄", preview: "💡", data: "🔎", hardware: "💡", items: "⚙️",
  teams: "🏅", add: "➕", search: "🔎", remove: "➖", show: "👀",
  save: "💾", refresh: "🔄", connect: "🔗", location: "📍", upcoming: "📅",
  weatherGas: "☁️ ⛽", debug: "🛠️"
} as const;
export const PROVIDER_EMOJIS = {
  "sports-live-score": "🏟️", "sports-next-game": "🏟️", "weather-current": "☁️",
  "fuel-average": "⛽", "internet-status": "🌐", "moon-phase": "🌕", "date-time": "🕒",
  "google-calendar-next-event": "📅", "icloud-calendar-next-event": "🍎 🗓️"
} as const;
export const LEAGUE_EMOJIS = { nfl: "🏈", nba: "🏀", nhl: "🏒", mlb: "⚾" } as const;
const TEAM_EMOJIS: Partial<Record<`${SportsTeam["league"]}:${string}`, string>> = {
  "nfl:15": "🐬", "nba:14": "🔥"
};
export type UiIdentity = keyof typeof UI_EMOJIS;
export type ProviderIdentity = keyof typeof PROVIDER_EMOJIS;
export type PresentationKey = `ui:${UiIdentity}` | `provider:${ProviderIdentity}` | `league:${SportsTeam["league"]}` | `team:${SportsTeam["league"]}:${string}`;
export type EmojiOverrides = Readonly<Partial<Record<PresentationKey, string>>>;
export interface PresentationIdentity { ui?: UiIdentity; provider?: string; league?: string; teamId?: string }

export function resolveEmoji(identity: PresentationIdentity, overrides: EmojiOverrides = {}): string {
  const league = identity.league?.toLowerCase() as SportsTeam["league"] | undefined;
  if (league && Object.hasOwn(LEAGUE_EMOJIS, league)) {
    const leagueEmoji = overrides[`league:${league}`] ?? LEAGUE_EMOJIS[league];
    const teamKey = `${league}:${identity.teamId ?? ""}` as const;
    const mascot = identity.teamId ? overrides[`team:${teamKey}`] ?? TEAM_EMOJIS[teamKey] : undefined;
    return [leagueEmoji, mascot].filter(Boolean).join(" ");
  }
  if (identity.provider && Object.hasOwn(PROVIDER_EMOJIS, identity.provider)) {
    const provider = identity.provider as ProviderIdentity;
    return overrides[`provider:${provider}`] ?? PROVIDER_EMOJIS[provider];
  }
  return identity.ui ? overrides[`ui:${identity.ui}`] ?? UI_EMOJIS[identity.ui] : "";
}
export function presentLabel(label: string, identity: PresentationIdentity, overrides?: EmojiOverrides): string {
  return [resolveEmoji(identity, overrides), label].filter(Boolean).join(" ");
}
export function uiLabel(identity: UiIdentity, label: string, overrides?: EmojiOverrides): string {
  return presentLabel(label, { ui: identity }, overrides);
}
export function teamLabel(team: SportsTeam, overrides?: EmojiOverrides): string {
  return presentLabel(team.name, {league:team.league,teamId:team.id}, overrides);
}
const BUILT_IN_LABELS: Record<string, string> = {
  "local-weather":"Weather", "local-fuel-average":"Gas Prices", "internet-status":"Internet Status",
  "moon-phase":"Moon Phase", "current-date-time":"Current Date & Time"
};
export function displayItemLabel(item: DisplayItem, overrides?: EmojiOverrides): string {
  return presentLabel(item.teamName ?? BUILT_IN_LABELS[item.id] ?? item.id,
    {provider:item.type,league:item.league,teamId:item.teamId}, overrides);
}
