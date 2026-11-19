import assert from "node:assert/strict";
import test from "node:test";
import { SportsProvider } from "../src/providers/sports-provider.js";
import { renderDisplayCardToMatrix, renderDisplayCardToDisplayMatrix16x96 } from "../src/matrix/matrix.js";
import type { DisplayItemConfig, SportsLeague } from "../src/rotation/types.js";

const teams = [
  ["nfl", "15", "MIA", "Miami Dolphins", "Q2"],
  ["nba", "14", "MIA", "Miami Heat", "Q2"],
  ["nhl", "26", "FLA", "Florida Panthers", "P2"],
  ["mlb", "28", "MIA", "Miami Marlins", "IN2"]
] as const;

function event(id: string, teamId: string, abbreviation: string, state: "in" | "pre" | "post", offsetHours: number) {
  return { id, date: new Date(Date.now() + offsetHours * 3600000).toISOString(), competitions: [{
    competitors: [
      { homeAway: "away", team: { id: Number(teamId), abbreviation }, score: { value: 2 } },
      { homeAway: "home", team: { id: "999", abbreviation: "OPP" }, score: "1" }
    ],
    status: { type: { state }, period: 2, displayClock: "5:12" }
  }] };
}

const config = (league: SportsLeague, teamId?: string, team?: string, teamName?: string): DisplayItemConfig => ({
  id: `${league}-team`, league, teamId, team, teamName, type: "sports-live-score", enabled: true
});

for (const [league, id, abbreviation, name, period] of teams) {
  test(`${name} live score uses its stable ID and works on both matrices`, async () => {
    const calls: string[] = [];
    const provider = new SportsProvider(async input => {
      const url = String(input);
      calls.push(url);
      const events = url.includes("/schedule")
        ? [event("next", id, abbreviation, "pre", 24)]
        : [event("unrelated", "998", abbreviation, "in", -1), event("ours", id, abbreviation, "in", -1)];
      return Response.json({ events });
    });
    const item = config(league, id, abbreviation, name);
    const resolved = await provider.resolve(item);
    assert.equal(resolved.game?.id, "ours");
    assert.equal(resolved.game?.awayTeam?.id, id);
    assert.equal(resolved.game?.awayTeam?.score, 2);
    assert.ok(resolved.matrixLines[0].includes(period));
    assert.ok(calls.some(url => url.includes(`/teams/${id}/schedule`)));
    assert.equal(calls.length, 2);

    const card = { ...item, title: name, status: resolved.game!.status, ...resolved };
    for (const [matrix, width] of [[renderDisplayCardToMatrix(card), 64], [renderDisplayCardToDisplayMatrix16x96(card), 96]] as const) {
      assert.equal(matrix.length, 16);
      assert.ok(matrix.every(row => row.length === width));
      assert.ok(matrix.some(row => row.some(pixel => pixel !== "off")));
    }
  });
}

test("a selected team falls back from recent results to its next game, never another team", async () => {
  let recentFinal = true;
  const provider = new SportsProvider(async input => Response.json({ events: String(input).includes("/schedule")
    ? [event("next", "14", "MIA", "pre", 48)]
    : [event("other", "6", "DAL", "in", -1), event("result", "14", "MIA", "post", recentFinal ? -4 : -48)]
  }));
  const item = config("nba", "14", "MIA");
  assert.equal((await provider.resolve(item)).game?.id, "result");
  assert.equal((await provider.resolve({ ...item, type: "sports-next-game" })).game?.id, "next");
  recentFinal = false;
  assert.equal((await provider.resolve(item)).game?.id, "next");
  assert.equal((await provider.resolve(config("nba", "55", "CHI"))).game, undefined);
});

test("the legacy abbreviation filter never falls back to an unrelated team", async () => {
  const provider = new SportsProvider(async () => Response.json({ events: [event("other", "6", "DAL", "in", -1)] }));
  assert.equal((await provider.resolve(config("nba", undefined, "MIA"))).game, undefined);
});

test("a team schedule failure falls back to one bounded scoreboard range", async () => {
  const calls: string[] = [];
  const provider = new SportsProvider(async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/schedule")) return new Response("", { status: 503 });
    return Response.json({ events: [event("next", "28", "MIA", "pre", 48)] });
  });
  const result = await provider.resolve({ ...config("mlb", "28", "MIA"), type: "sports-next-game" });
  assert.equal(result.game?.id, "next");
  assert.equal(calls.length, 2);
  assert.match(calls[1], /dates=\d{8}-\d{8}/);
});
