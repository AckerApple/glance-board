import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSignInSession } from "../src/providers/google-calendar-auth.js";
import { GoogleCalendarService, type GoogleCalendarStorage } from "../src/providers/google-calendar-service.js";

function fixture() {
  const files = new Map<string, unknown>();
  const storage: GoogleCalendarStorage = {
    async read<T>(name: string, fallback: T) { return (files.get(name) ?? fallback) as T; },
    async write(name, value) { files.set(name, value); },
    async remove(name) { files.delete(name); },
    async loadDisplayConfig() { return (files.get('display-items.json') ?? { rotationSeconds: 10, items: [] }) as import('../src/rotation/types.js').DisplayItemsConfig; },
    async saveDisplayConfig(config) { files.set('display-items.json', config); }
  };
  const service = new GoogleCalendarService(3010, storage);
  service.getCredentials = async () => ({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', redirectUri: 'http://localhost:3010/api/google-calendar/auth/callback', missing: [], source: 'local-file' });
  return { files, service, storage };
}
const token = () => new Response(JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.readonly' }));

test("sign-in state is expiring, one-time, and invalidated by cancellation", () => {
  let now = 0;
  const session = new GoogleSignInSession(() => now);
  const state = session.begin();
  assert.throws(() => session.consume('unrelated'), /expired or was cancelled/);
  assert.equal(session.consume(state), session.version);
  assert.throws(() => session.consume(state), /expired or was cancelled/);
  const expired = session.begin();
  now = 10 * 60_000;
  assert.throws(() => session.consume(expired), /expired or was cancelled/);
  const cancelled = session.begin();
  session.cancel();
  assert.throws(() => session.consume(cancelled), /expired or was cancelled/);
});

test("Google login requests read-only offline access and stores tokens without returning them in status", async () => {
  const { files, service } = fixture();
  const original = globalThis.fetch;
  try {
    const url = new URL(await service.buildAuthUrl());
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.deepEqual(new Set(url.searchParams.get('scope')!.split(' ')), new Set(['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly']));
    assert.equal(url.searchParams.get('prompt'), 'consent select_account');
    globalThis.fetch = async () => token();
    await service.handleCallback('synthetic-code', url.searchParams.get('state')!);
    assert.equal(files.has('google-calendar-token.json'), true);
    const status = await service.status();
    assert.equal(status.authenticated, true);
    assert.doesNotMatch(JSON.stringify(status), /synthetic-access|synthetic-refresh|synthetic-secret/);
    await assert.rejects(service.handleCallback('replay', url.searchParams.get('state')!), /expired or was cancelled/);
    await service.logout();
    assert.equal(files.has('google-calendar-token.json'), false);
  } finally { globalThis.fetch = original; }
});

test("disconnect during token exchange prevents a late login from reconnecting", async () => {
  const { files, service } = fixture();
  const original = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  try {
    const url = new URL(await service.buildAuthUrl());
    globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
    const callback = service.handleCallback('synthetic-code', url.searchParams.get('state')!);
    await new Promise(resolve => setImmediate(resolve));
    await service.logout();
    release?.(token());
    await assert.rejects(callback, /cancelled/);
    assert.equal(files.has('google-calendar-token.json'), false);
  } finally { globalThis.fetch = original; }
});

test("token exchange failures do not expose raw Google responses", async () => {
  const { files, service } = fixture();
  const original = globalThis.fetch;
  try {
    const url = new URL(await service.buildAuthUrl());
    globalThis.fetch = async () => new Response(JSON.stringify({ error_description: 'PRIVATE EVENT SECRET' }), { status: 400 });
    await assert.rejects(service.handleCallback('code', url.searchParams.get('state')!), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /OAuth client setup/);
      assert.doesNotMatch(error.message, /PRIVATE|SECRET/);
      return true;
    });
    assert.equal(files.has('google-calendar-token.json'), false);
  } finally { globalThis.fetch = original; }
});


test("disconnect also invalidates another provider instance sharing the token store", async () => {
  const { files, service, storage } = fixture();
  const other = new GoogleCalendarService(3010, storage);
  other.getCredentials = service.getCredentials;
  const original = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  try {
    const url = new URL(await other.buildAuthUrl());
    globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
    const callback = other.handleCallback('synthetic-code', url.searchParams.get('state')!);
    await new Promise(resolve => setImmediate(resolve));
    await service.logout();
    release?.(token());
    await assert.rejects(callback, /cancelled/);
    assert.equal(files.has('google-calendar-token.json'), false);
  } finally { globalThis.fetch = original; }
});


test("hide disables only Google display items and keeps the account connected; show re-enables them", async () => {
  const { files, service } = fixture();
  files.set('google-calendar-token.json', { refresh_token: 'synthetic-token' });
  files.set('google-calendar.json', { calendarId: 'chosen' });
  const other = { id: 'icloud', type: 'icloud-calendar-next-event', enabled: true, calendarId: 'family' };
  files.set('display-items.json', { rotationSeconds: 10, items: [
    { id: 'google-calendar-next-1', type: 'google-calendar-next-event', enabled: true, calendarId: 'chosen' },
    other
  ] });
  await service.hideFromDisplay();
  const hidden = files.get('display-items.json') as { items: Array<{ id: string; enabled: boolean }> };
  assert.equal(hidden.items.find(item => item.id === 'google-calendar-next-1')?.enabled, false);
  assert.deepEqual(hidden.items.find(item => item.id === 'icloud'), other);
  const status = await service.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.displayEnabled, false);
  await service.installRotationItems('chosen');
  assert.equal((await service.status()).displayEnabled, true);
  assert.deepEqual(files.get('google-calendar-token.json'), { refresh_token: 'synthetic-token' });
});

test("changing the saved calendar updates existing Google items while preserving enabled choices", async () => {
  const { files, service } = fixture();
  files.set('display-items.json', { rotationSeconds: 10, items: [
    { id: 'google-calendar-next-1', type: 'google-calendar-next-event', enabled: false, calendarId: 'old' },
    { id: 'icloud', type: 'icloud-calendar-next-event', enabled: true, calendarId: 'family' }
  ] });
  await service.saveSelectedCalendar('new', 'My new calendar');
  const config = files.get('display-items.json') as { items: Array<{ calendarId: string; enabled: boolean }> };
  assert.equal(config.items[0].calendarId, 'new');
  assert.equal(config.items[0].enabled, false);
  assert.equal(config.items[1].calendarId, 'family');
  assert.equal(config.items[1].enabled, true);
});


test("verified account email persists through refresh and disappears on disconnect", async () => {
  const { files, service } = fixture();
  const original = globalThis.fetch;
  try {
    const url = new URL(await service.buildAuthUrl());
    globalThis.fetch = async input => String(input).includes('/userinfo')
      ? new Response(JSON.stringify({ email: 'test@example.com', email_verified: true }))
      : new Response(JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: 'openid email https://www.googleapis.com/auth/calendar.readonly' }));
    await service.handleCallback('code', url.searchParams.get('state')!);
    assert.equal((await service.status()).accountEmail, 'test@example.com');
    const newService = new GoogleCalendarService(3010, fixtureStorage(files));
    newService.getCredentials = service.getCredentials;
    assert.equal((await newService.status()).accountEmail, 'test@example.com');
    await service.logout();
    assert.equal((await service.status()).accountEmail, undefined);
  } finally { globalThis.fetch = original; }
});

function fixtureStorage(files: Map<string, unknown>): GoogleCalendarStorage {
  return {
    async read<T>(name: string, fallback: T) { return (files.get(name) ?? fallback) as T; },
    async write(name, value) { files.set(name, value); },
    async remove(name) { files.delete(name); },
    async loadDisplayConfig() { return { rotationSeconds: 10, items: [] }; },
    async saveDisplayConfig() {}
  };
}

test("unverified identity is not presented as the connected account", async () => {
  const { service } = fixture();
  const original = globalThis.fetch;
  try {
    const url = new URL(await service.buildAuthUrl());
    globalThis.fetch = async input => String(input).includes('/userinfo')
      ? new Response(JSON.stringify({ email: 'unverified@example.com', email_verified: false }))
      : new Response(JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: 'openid email https://www.googleapis.com/auth/calendar.readonly' }));
    await service.handleCallback('code', url.searchParams.get('state')!);
    assert.equal((await service.status()).accountEmail, undefined);
    assert.equal((await service.status()).authenticated, true);
  } finally { globalThis.fetch = original; }
});

test("logout rejects late events so another service cannot repopulate its cache", async () => {
  const { files, service, storage } = fixture();
  files.set('google-calendar-token.json', { access_token: 'synthetic', expires_at: Date.now() + 3600000 });
  const resolver = new GoogleCalendarService(3010, storage);
  let release: ((response: Response) => void) | undefined;
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
    const pending = resolver.getUpcomingEvents('primary');
    const rejection = assert.rejects(pending, /cancelled/);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(release);
    await service.logout();
    release(new Response(JSON.stringify({ items: [{ id: 'late', summary: 'Stale', start: { dateTime: '2099-01-01T10:00:00Z' } }] })));
    await rejection;
    await assert.rejects(resolver.getUpcomingEvents('primary'), /not authenticated/);
  } finally { globalThis.fetch = original; }
});
