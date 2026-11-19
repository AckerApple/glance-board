import assert from "node:assert/strict";
import test from "node:test";
import { SportsPanel } from "../client/components/SportsControls.tag.js";
import type { SportsState } from "../client/types.js";

test("retained Sports panel updates selected teams, search results and status", () => {
  const component = SportsPanel as unknown as { inputs(handler: (args: [SportsState]) => void): void; original(state: SportsState): { render(): string } };
  const originalInputs = component.inputs;
  let update: ((args: [SportsState]) => void) | undefined;
  component.inputs = handler => { update = handler; };
  const team = { league: "nba" as const, id: "14", name: "Miami Heat", abbreviation: "MIA" };
  const state: SportsState = {selected:[team],favorites:[team],teams:[],league:"nba",query:"",busy:false,loading:false,message:"Ready"};
  try {
    const frame = component.original(state);
    assert.match(frame.render(), /Remove/);
    update!([{...state,selected:[],message:"Removed"}]);
    assert.doesNotMatch(frame.render(), />Remove</);
    assert.match(frame.render(), /Add team/);
    assert.match(frame.render(), /Removed/);
    update!([{...state,teams:[team],query:"unmatched",message:"Search"}]);
    assert.match(frame.render(), /No matching teams/);
    update!([{...state,teams:[team],query:"Heat",message:"Found"}]);
    assert.match(frame.render(), />Added</);
    assert.match(frame.render(), /Found/);
  } finally { component.inputs = originalInputs; }
});
