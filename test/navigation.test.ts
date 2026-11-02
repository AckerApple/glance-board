import assert from "node:assert/strict";
import test from "node:test";
import { destinations, navigation$, pageForHash, startNavigation } from "../client/navigation.js";

test("navigation resolves bookmarkable destinations and defaults safely to Home", () => {
  for (const destination of destinations) assert.equal(pageForHash(destination.href), destination.id);
  for (const hash of ["", "#", "#/unknown", "#calendar", "#/calendars/unknown"]) assert.equal(pageForHash(hash), "home");
  assert.equal(new Set(destinations.map(destination => destination.href)).size, destinations.length);
});

test("navigation follows hash history, restores the URL on startup, and removes its listener", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  const location = { hash: "#/calendars" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events)
  } });
  let stop = () => {};
  try {
    stop = startNavigation();
    assert.equal(navigation$[0], "calendars");
    for (let pass = 0; pass < 5; pass++) {
      for (const [hash, page] of [["#/", "home"], ["#/calendars", "calendars"]]) {
        location.hash = hash;
        events.dispatchEvent(new Event("hashchange"));
        assert.equal(navigation$[0], page);
      }
    }
    stop();
    location.hash = "#/";
    events.dispatchEvent(new Event("hashchange"));
    assert.equal(navigation$[0], "calendars");
    stop = startNavigation();
    assert.equal(navigation$[0], "home");
  } finally {
    stop();
    navigation$[0] = "home";
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
