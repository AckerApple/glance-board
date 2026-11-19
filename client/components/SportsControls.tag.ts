import { button, div, h2, input, label, option, p, section, select, span, strong, subscribe, tag } from "taggedjs";
import { actions } from "../controller.js";
import { sports$, updateSports } from "../state.js";
import type { SportsState, SportsTeam } from "../types.js";

export const SportsControls = tag(() => subscribe(sports$, ([state]) => SportsPanel(state)));
export const SportsPanel = tag((state: SportsState) => {
  SportsPanel.inputs(([next]) => { state = next; });
  const selected = (team: SportsTeam) => state.selected.some(item => item.league === team.league && item.id === team.id);
  const addButton = (team: SportsTeam) => button.type("button")
    .disabled(() => state.busy || selected(team)).onClick(() => void actions.addSportsTeam(team))
    (() => selected(team) ? "Added" : "Add team");
  const matches = () => state.teams.filter(team => `${team.name} ${team.abbreviation}`.toLowerCase().includes(state.query.trim().toLowerCase()));
  return div.class`sports-settings`(
    section.class`calendar-provider-card`.attr("aria-label", "Selected sports teams")(
      h2("Your teams"),
      p.class`muted`("Live scores, recent finals, and the next game. Your existing display settings are preserved."),
      div.class`sports-team-list`(() => state.selected.map(team => div.class`sports-team-row`(
        div(strong(team.name), span.class`muted`(team.league.toUpperCase())),
        button.type("button").disabled(() => state.busy).onClick(() => void actions.removeSportsTeam(team))("Remove")
      ).key(`${team.league}:${team.id}`))),
      p.attr("hidden", () => state.selected.length > 0)("No teams selected. Add a team below."),
      p.attr("role", "status")(() => state.message)
    ),
    section.class`calendar-provider-card`.attr("aria-label", "Find sports teams")(
      h2("Add a team"),
      div.class`sports-team-list`(() => state.favorites.filter(team => !selected(team)).map(team => div.class`sports-team-row`(
        div(strong(team.name), span.class`muted`(team.league.toUpperCase())), addButton(team)
      ).key(`favorite:${team.league}:${team.id}`))),
      div.class`sports-search`(
        label("League", select.value(() => state.league).onChange((event: Event) => {
          void actions.loadSportsTeams((event.target as HTMLSelectElement).value as SportsTeam["league"]);
        })(["nfl", "nba", "nhl", "mlb"].map(league => option.value(league)(league.toUpperCase())))),
        label("Find team", input.type("search").attr("placeholder", "City, team name, or abbreviation")
          .value(() => state.query).onInput((event: Event) => updateSports({ query: (event.target as HTMLInputElement).value }))()),
        button.type("button").disabled(() => state.loading).onClick(() => void actions.loadSportsTeams(state.league))(() => state.loading ? "Loading…" : "Browse teams")
      ),
      div.class`sports-team-list sports-results`(() => matches().map(team => div.class`sports-team-row`(
        div(strong(team.name), span.class`muted`(team.abbreviation)), addButton(team)
      ).key(`result:${team.league}:${team.id}`))),
      p.attr("hidden", () => !state.teams.length || matches().length > 0)("No matching teams. Try another name.")
    )
  );
});
