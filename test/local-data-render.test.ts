import assert from "node:assert/strict";
import test from "node:test";
import { LocationPanel } from "../client/components/LocationControls.tag.js";
import { ConfiguredItemRow } from "../client/components/ConfiguredItems.tag.js";
import type { LocationState, RotationState } from "../client/state.js";
import type { DisplayItem, DisplayCategory } from "../client/types.js";

function retained<T extends unknown[]>(value: unknown, args: T, check: (render: () => string, update: (next: T) => void) => void) {
  const component = value as { inputs(handler: (args: T) => void): void; original(...args: T): { render(): string } };
  const original = component.inputs;
  let update: (args: T) => void = () => {};
  component.inputs = handler => { update = handler; };
  try { const frame = component.original(...args); check(() => frame.render(), update); }
  finally { component.inputs = original; }
}

test("local ZIP form updates saved value, status and busy state", () => {
  const state = {location:{zip:"33066"},busy:false,message:"Ready"} as LocationState;
  retained(LocationPanel, [state], (render, update) => {
    assert.match(render(), /33066/);
    update([{...state,location:{...state.location,zip:"90210"},busy:true,message:"Saving ZIP"}]);
    assert.match(render(), /90210/); assert.match(render(), /Saving ZIP/); assert.match(render(), /disabled/);
  });
});

test("retained display row reflects enabled, freshness and error changes", () => {
  const item: DisplayItem = {id:"local-weather",type:"weather-current",enabled:true,resolved:true};
  const state = {} as RotationState;
  retained<[DisplayItem,RotationState,DisplayCategory[]]>(ConfiguredItemRow,[item,state,[]],(render,update) => {
    assert.match(render(), /Enabled/);
    update([{...item,enabled:false},state,[]]);
    assert.match(render(), /Disabled/); assert.match(render(), /Not updating while disabled/);
    update([{...item,error:"Provider offline"},state,[]]);
    assert.match(render(), /item-status-error/); assert.match(render(), /ERROR/);
  });
});
