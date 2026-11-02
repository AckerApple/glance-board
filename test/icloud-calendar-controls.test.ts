import assert from "node:assert/strict";
import test from "node:test";
import { actions } from "../client/controller.js";
import { icloudCalendar$, updateICloudCalendar } from "../client/state.js";

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
