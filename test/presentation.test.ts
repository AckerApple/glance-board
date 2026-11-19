import assert from "node:assert/strict";
import test from "node:test";
import { displayItemLabel, presentLabel, resolveEmoji, teamLabel, uiLabel } from "../client/presentation.js";

test("sports keeps league identity and adds only clear stable-ID mascots", () => {
  const cases = [["nfl","15","🏈 🐬"],["nba","14","🏀 🔥"],["nhl","26","🏒"],["mlb","28","⚾"],["nfl","99","🏈"]];
  for(const [league,teamId,emoji] of cases) assert.equal(resolveEmoji({league,teamId}), emoji);
  assert.equal(resolveEmoji({league:"NBA",teamId:"15"}),"🏀");
  assert.equal(resolveEmoji({league:"mlb",teamId:"15"}),"⚾");
});
test("provider icons, including full moon, are stable and override-friendly", () => {
  assert.equal(displayItemLabel({id:"moon-phase",type:"moon-phase",enabled:true}),"🌕 Moon Phase");
  assert.equal(resolveEmoji({provider:"moon-phase"}),"🌕");
  assert.equal(resolveEmoji({provider:"moon-phase"},{"provider:moon-phase":"✨"}),"✨");
  assert.equal(resolveEmoji({league:"nfl",teamId:"15"},{"team:nfl:15":"⭐"}),"🏈 ⭐");
  assert.equal(uiLabel("save","Save",{"ui:save":""}),"Save");
  assert.equal(resolveEmoji({provider:"unknown"}),"");
});
test("decorating labels never mutates team names, search text or stored item IDs", () => {
  const team = {league:"nfl" as const,id:"15",name:"Miami Dolphins",abbreviation:"MIA"};
  const original = structuredClone(team);
  assert.equal(teamLabel(team),"🏈 🐬 Miami Dolphins");
  assert.deepEqual(team, original);
  assert.equal(presentLabel("Custom name",{provider:"weather-current"}),"☁️ Custom name");
  assert.equal(displayItemLabel({id:"my-custom-weather",type:"weather-current",enabled:false}),"☁️ my-custom-weather");
});
