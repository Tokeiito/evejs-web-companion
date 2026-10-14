import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function calendarEmpty() {
  return {
    ok: true,
    responsesForCharacter: { type: "list", items: [] },
    eventList: [{ type: "list", items: [] }, null, null],
    responsesToEvent: null,
    eventDetails: null,
    errors: {
      responsesForCharacter: null,
      eventList: null,
      responsesToEvent: "NOT_REQUESTED",
      eventDetails: "NOT_REQUESTED",
    },
  };
}

function mailEmpty(unreadCount = 0) {
  return {
    ok: true,
    characterID: 140000005,
    sync: null,
    backfill: null,
    unreadCount,
  };
}

test("loadActivity uses the calendar and mail reads, and by the generic call the notification service's two and the skill history's notifications' two", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    // By the generic call (notificationSvc.py 93 and 107; skillHistoryProvider.py 32 to 34): no notifications,
    // and nothing of the skill handler's.
    if (url === "/api/bridge/call") {
      const sent = JSON.parse(String(init?.body ?? "{}")) as { service?: string };
      return json({ ok: true, result: sent.service === "notificationMgr" ? [] : null });
    }
    if (url.includes("/api/bridge/calendar")) return json(calendarEmpty());
    if (url.includes("/api/bridge/mail")) return json(mailEmpty(2));
    throw new Error(`unexpected fetch: ${url}`);
  };

  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });
  await flow.loadActivity();

  const current = new Date();
  assert.deepEqual(calls.sort(), [
    "/api/bridge/calendar?month=" + (current.getUTCMonth() + 1) + "&year=" + current.getUTCFullYear(),
    "/api/bridge/call",
    "/api/bridge/call",
    "/api/bridge/call",
    "/api/bridge/call",
    "/api/bridge/mail",
  ].sort());
  assert.equal(store.get().activity.notifications.status, "ready");
  assert.deepEqual(store.get().activity.notifications.value, []);
  assert.equal(store.get().activity.calendarEvents.status, "ready");
  assert.equal(store.get().mail.unreadCount, 2);
  assert.equal(store.get().activity.mailError, null);
});

test("loadActivity lands partial success when the notification service's reads fail", async () => {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/bridge/call") {
      const sent = JSON.parse(String(init?.body ?? "{}")) as { service?: string };
      return sent.service === "notificationMgr"
        ? json({ ok: false, error: "CALL_FAILED", message: "notificationMgr unavailable" }, 503)
        : json({ ok: true, result: null });
    }
    if (url.includes("/api/bridge/calendar")) return json(calendarEmpty());
    if (url.includes("/api/bridge/mail")) return json(mailEmpty(0));
    throw new Error(`unexpected fetch: ${url}`);
  };

  const store = createClientStore();
  await createAppFlow(store, { fetch }).loadActivity();

  const activity = store.get().activity;
  assert.equal(activity.loaded, true);
  assert.equal(activity.loading, false);
  assert.equal(activity.notifications.status, "error");
  assert.equal(activity.unprocessedCount.status, "error");
  assert.equal(activity.calendarEvents.status, "ready");
  assert.deepEqual(activity.calendarEvents.value, []);
  assert.equal(activity.calendarResponses.status, "ready");
  assert.equal(activity.mailError, null);
});
