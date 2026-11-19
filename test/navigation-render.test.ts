import assert from "node:assert/strict";
import test from "node:test";
import { NavigationLayout } from "../client/components/App.tag.js";
import type { PageId } from "../client/navigation.js";

// Exercise the real TaggedJS element definitions and their retained callbacks,
// including the input-update path, without pretending this is browser QA.
interface ElementDefinition {
  attributes: Array<[string, unknown]>;
  innerHTML: ElementDefinition[];
  render(): string;
}

test("retained navigation callbacks keep exactly one page visible and one menu item current", () => {
  const component = NavigationLayout as unknown as {
    inputs(handler: (args: [PageId]) => void): void;
    original(page: PageId): ElementDefinition;
  };
  const originalInputs = component.inputs;
  let updateInputs: ((args: [PageId]) => void) | undefined;
  component.inputs = handler => { updateInputs = handler; };
  try {
    const frame = component.original("home");
    const [menu, home, calendars, sports, localData] = frame.innerHTML;
    // Retain the callbacks from the initial render, as TaggedJS does.
    const homeHidden = home.attributes.find(([name]) => name === "hidden")?.[1] as () => boolean;
    const calendarsHidden = calendars.attributes.find(([name]) => name === "hidden")?.[1] as () => boolean;
    const sportsHidden = sports.attributes.find(([name]) => name === "hidden")?.[1] as () => boolean;
    const localHidden = localData.attributes.find(([name]) => name === "hidden")?.[1] as () => boolean;
    assert.ok(updateInputs);
    for (const page of ["home", "local-data", "sports", "calendars", "local-data", "sports", "home", "calendars", "home"] as PageId[]) {
      updateInputs([page]);
      assert.equal(homeHidden(), page !== "home");
      assert.equal(calendarsHidden(), page !== "calendars");
      assert.equal(sportsHidden(), page !== "sports");
      assert.equal(localHidden(), page !== "local-data");
      const markup = menu.render();
      assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
      assert.match(markup, page === "home" ? /aria-current="page">🏠 Home/ : page === "sports" ? /aria-current="page">🏈 Sports/ : page === "local-data" ? /aria-current="page">📍 Local Data/ : /aria-current="page">🗓️ Calendars/);
      assert.doesNotMatch(markup, /target=/);
    }
  } finally { component.inputs = originalInputs; }
});
