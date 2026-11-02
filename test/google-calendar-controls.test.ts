import assert from "node:assert/strict";
import test from "node:test";
import { actions } from "../client/controller.js";
import { calendar$, updateCalendar } from "../client/state.js";
import { getJson } from "../client/api.js";

function reset() {
  actions.cancelCalendarRequest();
  updateCalendar({ status: {}, calendars: [], events: [], busy: false, disconnecting: false, message: "checking", discoveryState: "idle", discoveryError: undefined, setupUrl: undefined });
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("Google auth state publishes before event loading; disconnect wins over late responses", async () => {
  reset();
  const original = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  try {
    globalThis.fetch = async (input) => {
      const path = String(input);
      if (path.endsWith('/status')) return json({ credentialsConfigured: true, authenticated: true, selectedCalendarId: 'primary' });
      if (path.endsWith('/auth/logout')) return json({ credentialsConfigured: true, authenticated: false });
      if (path.endsWith('/calendars')) return json({ calendars: [{ id: 'primary', summary: 'Synthetic' }] });
      return new Promise(resolve => { release = resolve; }); // Deliberately ignores abort.
    };
    const refresh = actions.refreshCalendar();
    await flush();
    assert.equal(calendar$[0].status.authenticated, true);
    assert.equal(calendar$[0].busy, true);
    assert.doesNotMatch(calendar$[0].message, /checking/);
    await actions.disconnectCalendar();
    assert.equal(calendar$[0].status.authenticated, false);
    assert.equal(calendar$[0].busy, false);
    release?.(json({ events: [{ id: 'late', title: 'Old response' }] }));
    await refresh;
    assert.deepEqual(calendar$[0].events, []);
    assert.match(calendar$[0].message, /disconnected/);
    assert.equal(calendar$[0].status.authenticated, false);
  } finally { globalThis.fetch = original; reset(); }
});

test("Cancel Request aborts loading and releases controls", async () => {
  reset();
  const original = globalThis.fetch;
  let aborted = false;
  try {
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
    });
    const refresh = actions.refreshCalendar();
    actions.cancelCalendarRequest();
    await refresh;
    assert.equal(aborted, true);
    assert.equal(calendar$[0].busy, false);
    assert.match(calendar$[0].message, /cancelled/);
  } finally { globalThis.fetch = original; reset(); }
});

test("failed refresh and failed disconnect release busy state; credentials can subsequently be saved", async () => {
  reset();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('Network unavailable'); };
    await actions.refreshCalendar();
    assert.equal(calendar$[0].busy, false);
    assert.match(calendar$[0].message, /Network unavailable/);
    await actions.disconnectCalendar();
    assert.equal(calendar$[0].busy, false);
    assert.equal(calendar$[0].disconnecting, false);
    globalThis.fetch = async () => json({ credentialsConfigured: true, authenticated: false });
    await actions.saveCalendarCredentials({ clientId: 'synthetic', clientSecret: 'synthetic', redirectUri: 'http://localhost' });
    assert.equal(calendar$[0].status.credentialsConfigured, true);
    assert.equal(calendar$[0].busy, false);
    assert.match(calendar$[0].message, /connection setup saved/);
  } finally { globalThis.fetch = original; reset(); }
});

test("Google requests time out instead of keeping controls disabled forever", async context => {
  reset();
  const original = globalThis.fetch;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const refresh = actions.refreshCalendar();
    context.mock.timers.tick(20_000);
    await refresh;
    assert.equal(calendar$[0].busy, false);
    assert.match(calendar$[0].message, /timed out/);
  } finally { globalThis.fetch = original; context.mock.timers.reset(); reset(); }
});


test("first Google connection discovers calendars without requesting unselected events", async () => {
  reset();
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async input => {
      const path = String(input);
      paths.push(path);
      if (path.endsWith('/status')) return json({ credentialsConfigured: true, authenticated: true });
      if (path.endsWith('/calendars')) return json({ calendars: [{ id: 'primary', summary: 'My calendar', primary: true }] });
      throw new Error('Unexpected request: ' + path);
    };
    await actions.refreshCalendar();
    assert.equal(calendar$[0].busy, false);
    assert.equal(calendar$[0].calendars[0]?.id, 'primary');
    assert.match(calendar$[0].message, /Choose a calendar/);
    assert.equal(paths.some(path => path.includes('/events')), false);
  } finally { globalThis.fetch = original; reset(); }
});

test("calendar choices remain usable when the selected calendar preview fails", async () => {
  reset();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      const path = String(input);
      if (path.endsWith('/status')) return json({ credentialsConfigured: true, authenticated: true, selectedCalendarId: 'old' });
      if (path.endsWith('/calendars')) return json({ calendars: [{ id: 'new', summary: 'Available' }] });
      throw new Error('Calendar access denied');
    };
    await actions.refreshCalendar();
    assert.equal(calendar$[0].busy, false);
    assert.equal(calendar$[0].calendars[0]?.id, 'new');
    assert.match(calendar$[0].message, /access denied/);
  } finally { globalThis.fetch = original; reset(); }
});

test("adding Google Calendar saves selection before installing display items", async () => {
  reset();
  const original = globalThis.fetch;
  const operations: string[] = [];
  try {
    updateCalendar({ calendars: [{ id: 'chosen', summary: 'Chosen calendar' }] });
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (init?.method === 'POST') {
        operations.push(path);
        assert.equal(JSON.parse(String(init.body)).calendarId, 'chosen');
        return json({ ok: true });
      }
      if (path.endsWith('/status')) return json({ credentialsConfigured: true, authenticated: true, selectedCalendarId: 'chosen' });
      if (path.endsWith('/calendars')) return json({ calendars: [{ id: 'chosen', summary: 'Chosen calendar' }] });
      if (path.includes('/events')) return json({ events: [] });
      return json({ rotation: { paused: true, cards: [], items: [] } });
    };
    await actions.installCalendarItems('chosen');
    assert.deepEqual(operations, ['/api/google-calendar/selected-calendar', '/api/google-calendar/install-rotation-items']);
    assert.equal(calendar$[0].status.selectedCalendarId, 'chosen');
    assert.match(calendar$[0].message, /showing on your Glance Board/);
    assert.equal(calendar$[0].busy, false);
  } finally { globalThis.fetch = original; reset(); }
});


test("hide from board preserves the connected account and updates display status", async () => {
  reset();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      if (String(input).endsWith('/hide-from-display')) return json({ credentialsConfigured: true, authenticated: true, displayEnabled: false });
      return json({ rotation: { paused: true, cards: [], items: [] } });
    };
    await actions.hideGoogleCalendarItems();
    assert.equal(calendar$[0].status.authenticated, true);
    assert.equal(calendar$[0].status.displayEnabled, false);
    assert.match(calendar$[0].message, /remains connected/);
    assert.equal(calendar$[0].busy, false);
  } finally { globalThis.fetch = original; reset(); }
});


test("disabled API surfaces actionable calendar discovery error and safe project setup link", async () => {
  reset();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async input => String(input).endsWith('/status')
      ? json({ credentialsConfigured: true, authenticated: true })
      : new Response(JSON.stringify({ error: 'Google Calendar API is disabled for this app’s Cloud project.', code: 'api_disabled', setupUrl: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=123' }), { status: 403 });
    await actions.refreshCalendar();
    assert.equal(calendar$[0].discoveryState, 'error');
    assert.match(calendar$[0].discoveryError!, /API is disabled/);
    assert.match(calendar$[0].setupUrl!, /project=123/);
    assert.equal(calendar$[0].status.authenticated, true);
    assert.equal(calendar$[0].status.credentialsConfigured, true);
    assert.equal(calendar$[0].busy, false);
  } finally { globalThis.fetch = original; reset(); }
});

test("Google multiple selection sends arrays, previews the saved group, and clearing removes old previews", async () => {
  reset();
  const original = globalThis.fetch;
  let selected: string[] = [];
  const eventPaths: string[] = [];
  const posts: Array<{ path: string; body: any }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push({ path, body });
        if (path.endsWith("/selected-calendar")) selected = body.calendarIds;
        return json({ ok: true });
      }
      if (path.endsWith("/status")) return json({ credentialsConfigured: true, authenticated: true, selectedCalendarId: selected[0], selectedCalendarIds: selected });
      if (path.endsWith("/calendars")) return json({ calendars: [{ id: "a", summary: "Family" }, { id: "b", summary: "Work" }] });
      if (path.includes("/events")) { eventPaths.push(path); return json({ events: selected.map(id => ({ id, calendarId: id, title: id })) }); }
      return json({ rotation: { paused: true, cards: [], items: [] } });
    };
    await actions.selectCalendar(["a", "b"]);
    assert.deepEqual(posts[0].body, { calendarIds: ["a", "b"] });
    assert.deepEqual(calendar$[0].events.map(event => event.id), ["a", "b"]);
    assert.ok(eventPaths.every(path => !path.includes("calendarId=")), "preview uses the saved group, not its first member");
    await actions.installCalendarItems();
    assert.deepEqual(posts.at(-1), { path: "/api/google-calendar/install-rotation-items", body: {} });
    assert.equal(posts.filter(post => post.path.endsWith("/selected-calendar")).length, 1, "install retains the saved multiple selection");
    await actions.selectCalendar([]);
    assert.deepEqual(calendar$[0].status.selectedCalendarIds, []);
    assert.deepEqual(calendar$[0].events, []);
  } finally { globalThis.fetch = original; reset(); }
});
