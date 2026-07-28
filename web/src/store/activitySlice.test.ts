import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "./clientStore.ts";

test("Activity starts unloaded with every bridge arm explicitly unavailable", () => {
  const activity = createClientStore().get().activity;
  assert.equal(activity.loaded, false);
  assert.equal(activity.loading, false);
  assert.equal(activity.notifications.status, "unavailable");
  assert.equal(activity.unprocessedCount.status, "unavailable");
  assert.equal(activity.calendarEvents.status, "unavailable");
  assert.equal(activity.calendarResponses.status, "unavailable");
  assert.equal(activity.refreshedAtMs, null);
});

test("activity/loading preserves stale good data during a refresh", () => {
  const store = createClientStore();
  store.apply({
    type: "activity/loaded",
    notifications: {
      status: "ready",
      value: [
        {
          notificationID: 1,
          senderID: 2,
          processed: false,
          created: 134282765436910000n,
          title: "New notification",
        },
      ],
      error: null,
    },
    unprocessedCount: { status: "ready", value: 1, error: null },
    calendarEvents: { status: "ready", value: [], error: null },
    calendarResponses: { status: "ready", value: [], error: null },
    mailError: "old mail error",
    refreshedAtMs: 100,
  });

  store.apply({ type: "activity/loading" });
  const refreshing = store.get().activity;
  assert.equal(refreshing.loaded, true);
  assert.equal(refreshing.loading, true);
  assert.equal(refreshing.notifications.value?.length, 1);
  assert.equal(refreshing.refreshedAtMs, 100);
  assert.equal(refreshing.mailError, null);
});

test("activity/loaded stores partial success without turning failed reads into empty", () => {
  const store = createClientStore();
  store.apply({ type: "activity/loading" });
  store.apply({
    type: "activity/loaded",
    notifications: { status: "ready", value: [], error: null },
    unprocessedCount: { status: "ready", value: 0, error: null },
    calendarEvents: {
      status: "error",
      value: null,
      error: "Upcoming calendar events could not be read just now.",
    },
    calendarResponses: { status: "unavailable", value: null, error: null },
    mailError: "Mail could not be refreshed just now.",
    refreshedAtMs: 200,
  });

  const activity = store.get().activity;
  assert.equal(activity.loaded, true);
  assert.equal(activity.loading, false);
  assert.deepEqual(activity.notifications.value, []);
  assert.equal(activity.calendarEvents.status, "error");
  assert.equal(activity.calendarEvents.value, null);
  assert.equal(activity.calendarResponses.status, "unavailable");
  assert.equal(activity.mailError, "Mail could not be refreshed just now.");
});

test("offline, logout and an explicit clear discard character-specific Activity", () => {
  for (const event of [
    { type: "activity/cleared" } as const,
    { type: "character/offline" } as const,
    { type: "session/logged-out" } as const,
  ]) {
    const store = createClientStore();
    store.apply({
      type: "activity/loaded",
      notifications: { status: "ready", value: [], error: null },
      unprocessedCount: { status: "ready", value: 0, error: null },
      calendarEvents: { status: "ready", value: [], error: null },
      calendarResponses: { status: "ready", value: [], error: null },
      mailError: null,
      refreshedAtMs: 300,
    });
    store.apply(event);
    assert.equal(store.get().activity.loaded, false);
    assert.equal(store.get().activity.notifications.status, "unavailable");
  }
});
