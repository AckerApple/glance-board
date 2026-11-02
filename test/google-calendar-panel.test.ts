import assert from "node:assert/strict";
import test from "node:test";
import { GoogleCalendarPanel } from "../client/components/CalendarControls.tag.js";
import type { CalendarState } from "../client/state.js";

// Render the real retained TaggedJS definition through input changes.
// This checks markup/state, not browser clicks or live Google authentication.
test("Google setup explains login and reacts to connection changes without exposing tokens", () => {
  const component = GoogleCalendarPanel as unknown as {
    inputs(handler: (args: [CalendarState]) => void): void;
    original(state: CalendarState): { render(): string };
  };
  const previous = component.inputs;
  let update: ((args: [CalendarState]) => void) | undefined;
  component.inputs = handler => { update = handler; };
  const initial: CalendarState = { status: { redirectUri: 'http://localhost:3010/api/google-calendar/auth/callback' }, message: 'Setup needed', calendars: [], events: [], busy: false };
  try {
    const panel = component.original(initial);
    const setup = panel.render();
    assert.match(setup, /Board owner settings/);
    assert.match(setup, /Open OAuth clients/);
    assert.match(setup, /Enable Calendar API/);
    assert.match(setup, /test user/);
    assert.match(setup, /do not need to paste access tokens/);
    assert.match(setup, /http:\/\/localhost:3010\/api\/google-calendar\/auth\/callback/);
    assert.match(setup, /disabled>Connect Google Calendar/);
    assert.doesNotMatch(setup, /<details[^>]*class="google-calendar-config"[^>]* open/);
    assert.ok(setup.indexOf('Connect Google Calendar') < setup.indexOf('Board owner settings'));
    assert.match(setup, /cannot edit or delete/);
    assert.ok(update);
    update([{ ...initial, status: { credentialsConfigured: true, authenticated: true, accountEmail: 'test@example.com' }, message: 'Connected', calendars: [{ id: 'synthetic', summary: 'My calendar' }] }]);
    const connected = panel.render();
    assert.match(connected, /Change account \/ reconnect/);
    assert.doesNotMatch(connected, /disabled>Change account/);
    assert.match(connected, /My calendar/);
    assert.match(connected, /Google setup saved on this board/);
    assert.match(connected, /Signed in as test@example.com/);
    assert.doesNotMatch(connected, /Save selection &amp; preview/);
    assert.match(connected, /Show on Glance Board/);
    assert.match(connected, /<select[^>]*multiple[^>]*size="5"/);
    assert.match(connected, /Clear selection/);
    update([{ ...initial, status: { credentialsConfigured: true, authenticated: true, selectedCalendarIds: ['a', 'b'], selectedCalendarId: 'a' }, calendars: [{ id: 'a', summary: 'Family' }, { id: 'b', summary: 'Work' }, { id: 'c', summary: 'Other' }] }]);
    const multiple = panel.render();
    assert.match(multiple, /<option[^>]*value="a"[^>]*selected[^>]*>Family/);
    assert.match(multiple, /<option[^>]*value="b"[^>]*selected[^>]*>Work/);
    assert.doesNotMatch(multiple, /<option[^>]*value="c"[^>]*selected/);

    assert.match(connected, /myaccount.google.com\/connections/);
    update([{ ...initial, status: { credentialsConfigured: true }, busy: true, message: 'Loading' }]);
    const busy = panel.render();
    assert.doesNotMatch(busy, /disabled>Disconnect from Glanceboard/);
    assert.doesNotMatch(busy, /disabled>Cancel Request/);
    assert.match(busy, />Loading<\/p>/);
    update([{ ...initial, status: { credentialsConfigured: true, authenticated: true }, discoveryState: 'error', discoveryError: 'Google Calendar API is disabled', setupUrl: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', message: 'Discovery failed' }]);
    assert.match(panel.render(), /Calendar list unavailable/);
    assert.match(panel.render(), /Google Calendar API is disabled/);
    assert.match(panel.render(), /Enable Google Calendar API for this project/);
    update([{ ...initial, status: { credentialsConfigured: true }, message: 'Disconnected' }]);
    assert.doesNotMatch(panel.render(), /disabled>Connect Google Calendar/);
  } finally { component.inputs = previous; }
});
