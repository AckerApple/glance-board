import assert from "node:assert/strict";
import test from "node:test";
import { visibleCard } from "../client/display-utils.js";
import { actions } from "../client/controller.js";
import { icloudCalendar$, updateICloudCalendar, rotation$, updateRotation } from "../client/state.js";

const json = (data: unknown) => new Response(JSON.stringify(data));

test("iCloud saves and previews multiple calendars, installs the saved group, and clears previews", async () => {
  const original = globalThis.fetch;
  let ids: string[] = [];
  const posts: Array<{ path: string; body: any }> = [];
  const eventPaths: string[] = [];
  const status = () => ({ connected: true, selectedCalendarIds: ids, selectedCalendarId: ids[0], eventShowCount: 5 });
  try {
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)); posts.push({ path, body });
        if (path.endsWith("/selected-calendar")) ids = body.calendarIds;
        return json({ status: status() });
      }
      if (path.endsWith("/status")) return json(status());
      if (path.endsWith("/calendars")) return json({ calendars: [{ id: "a", summary: "Family" }, { id: "b", summary: "Work" }] });
      if (path.includes("/events")) { eventPaths.push(path); return json({ events: ids.map(id => ({ id, calendarId: id })) }); }
      return json({ rotation: { paused: true, cards: [], items: [] } });
    };
    await actions.selectICloudCalendar(["a", "b"], undefined, 5);
    assert.deepEqual(posts[0].body, { calendarIds: ["a", "b"], eventShowCount: 5 });
    assert.deepEqual(icloudCalendar$[0].events.map(event => event.id), ["a", "b"]);
    assert.ok(eventPaths.every(path => !path.includes("calendarId=")));
    await actions.installICloudCalendarItems(undefined, 5);
    assert.deepEqual(posts.at(-1), { path: "/api/calendar/icloud/install-rotation-items", body: { eventShowCount: 5 } });
    await actions.selectICloudCalendar([], undefined, 5);
    assert.deepEqual(icloudCalendar$[0].events, []);
    assert.deepEqual(icloudCalendar$[0].status.selectedCalendarIds, []);
    assert.equal(icloudCalendar$[0].busy, false);
  } finally {
    globalThis.fetch = original;
    updateICloudCalendar({ status: {}, calendars: [], events: [], busy: false, message: "" });
  }
});

test("iCloud disconnect clears previews and wins over a late refresh", async () => {
  const original = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  try {
    globalThis.fetch = async input => {
      const path = String(input);
      if (path.endsWith("/disconnect")) return json({ connected: false });
      if (path.endsWith("/status")) return json({ connected: true, selectedCalendarId: "a" });
      if (path.endsWith("/calendars")) return json({ calendars: [{ id: "a", summary: "Synthetic" }] });
      return new Promise(resolve => { release = resolve; });
    };
    const refresh = actions.refreshICloudCalendar();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(release);
    updateRotation({ currentCardId: "old", payload: { fetchedAt: "test", dotMatrix: [], game: { status: "no_game", displayLines: [] }, state: {}, rotation: { cards: [
      { id: "old", type: "icloud-calendar-next-event" },
      { id: "google", type: "google-calendar-next-event" },
      { id: "clock", type: "date-time" }
    ], activeCard: { id: "old", type: "icloud-calendar-next-event" } } } });
    await actions.disconnectICloudCalendar();
    assert.deepEqual(rotation$[0].payload?.rotation?.cards?.map(card => card.id), ["google", "clock"]);
    assert.equal(rotation$[0].currentCardId, "google");
    release(json({ events: [{ id: "old-event" }] }));
    await refresh;
    assert.equal(icloudCalendar$[0].status.connected, false);
    assert.deepEqual(icloudCalendar$[0].events, []);
    assert.deepEqual(icloudCalendar$[0].calendars, []);
    assert.equal(icloudCalendar$[0].busy, false);
  } finally {
    globalThis.fetch = original;
    updateICloudCalendar({ status: {}, calendars: [], events: [], busy: false, message: "" });
  }
});


test("an empty rotation does not fall back to a disconnected calendar's matrix", () => {
  const card = visibleCard({ fetchedAt: "test", game: { status: "live", displayLines: ["NBA"] },
    state: {}, dotMatrix: [["green"]], rotation: { cards: [] } }, "old-calendar");
  assert.equal(card?.title, "No displays");
  assert.ok(card?.dotMatrix?.flat().every(pixel => pixel === "off"));
});
