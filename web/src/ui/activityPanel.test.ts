import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { default: Activity } = await import("./Activity.svelte");
const { default: PanelHost } = await import("./PanelHost.svelte");

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function loadMail(store: ReturnType<typeof createClientStore>, unreadCount: number): void {
  store.apply({
    type: "mail/loaded",
    messages: [],
    statuses: [],
    unreadCount,
    inboxError: null,
  });
}

test("Activity has an honest first-mount loading state", () => {
  const body = render(Activity as never, {
    props: { store: createClientStore(), flow: fakeFlow() },
  } as never).body;
  assert.match(body, /Activity Center/);
  assert.match(body, /Loading your recent activity/);
  assert.doesNotMatch(body, /No recent notifications/);
});

test("Activity renders successful empty reads as empty facts, not failures", () => {
  const store = createClientStore();
  loadMail(store, 0);
  store.apply({
    type: "activity/loaded",
    notifications: { status: "ready", value: [], error: null },
    unprocessedCount: { status: "ready", value: 0, error: null },
    calendarEvents: { status: "ready", value: [], error: null },
    calendarResponses: { status: "ready", value: [], error: null },
    mailError: null,
    refreshedAtMs: 100,
  });

  const body = render(Activity as never, {
    props: { store, flow: fakeFlow() },
  } as never).body;
  assert.match(body, /No unread mail/);
  assert.match(body, /No recent notifications/);
  assert.match(body, /No upcoming events this month/);
  assert.match(body, /Live session activity will appear here/);
  assert.doesNotMatch(body, /could not be read/);
});

test("Activity keeps independent error and unavailable states visible", () => {
  const store = createClientStore();
  store.apply({
    type: "activity/loaded",
    notifications: {
      status: "error",
      value: null,
      error: "Recent notifications could not be read just now.",
    },
    unprocessedCount: { status: "unavailable", value: null, error: null },
    calendarEvents: { status: "unavailable", value: null, error: null },
    calendarResponses: {
      status: "error",
      value: null,
      error: "Calendar responses could not be read just now.",
    },
    mailError: "Mail could not be refreshed just now.",
    refreshedAtMs: 200,
  });

  const body = render(Activity as never, {
    props: { store, flow: fakeFlow() },
  } as never).body;
  assert.match(body, /Recent notifications could not be read just now/);
  assert.match(body, /Upcoming events are unavailable/);
  assert.match(body, /Calendar responses could not be read just now/);
  assert.match(body, /Mail could not be refreshed just now/);
});

test("Activity shows names and friendly labels without leaking joined or live metadata IDs", () => {
  const store = createClientStore();
  loadMail(store, 3);
  store.apply({
    type: "names/resolved",
    entries: {
      "owner:1000113": "Secure Commerce Commission",
      "owner:98000001": "Starlight Logistics",
    },
  });
  store.apply({
    type: "activity/loaded",
    notifications: {
      status: "ready",
      value: [
        {
          notificationID: 2877,
          senderID: 1000113,
          processed: false,
          created: 134282765436910000n,
          title: "Insurance payment",
        },
      ],
      error: null,
    },
    unprocessedCount: { status: "ready", value: 1, error: null },
    calendarEvents: {
      status: "ready",
      value: [
        {
          eventID: 980000000006,
          ownerID: 98000001,
          eventDateTime: 134282765436910000n,
          eventDuration: 30,
          title: "Alliance meetup",
          importance: 1,
        },
      ],
      error: null,
    },
    calendarResponses: {
      status: "ready",
      value: [{ eventID: 980000000006, status: 4 }],
      error: null,
    },
    mailError: null,
    refreshedAtMs: 300,
  });
  store.apply({
    type: "live/notification",
    notification: {
      kind: "service",
      service: "mailMgr",
      method: "OnMailUpdatedByExternal",
      receivedAtMs: 400,
      args: [9988400076029, "secret payload"],
    },
    epoch: "internal-epoch",
    sequence: 77,
  });

  const body = render(Activity as never, {
    props: { store, flow: fakeFlow(), showMail: () => {} },
  } as never).body;
  assert.match(body, /Insurance payment/);
  assert.match(body, /Secure Commerce Commission/);
  assert.match(body, /Alliance meetup/);
  assert.match(body, /Starlight Logistics/);
  assert.match(body, /Going/);
  assert.match(body, /Mail updated/);
  assert.match(body, /3 unread mail/);
  assert.match(body, /Open Mail/);

  for (const internal of [
    "2877",
    "1000113",
    "980000000006",
    "98000001",
    "mailMgr",
    "OnMailUpdatedByExternal",
    "9988400076029",
    "secret payload",
    "internal-epoch",
  ]) {
    assert.doesNotMatch(body, new RegExp(internal), `${internal} leaked into rendered Activity`);
  }
});

test("PanelHost has an explicit Activity branch", () => {
  const body = render(PanelHost as never, {
    props: { store: createClientStore(), flow: fakeFlow(), tab: "activity" },
  } as never).body;
  assert.match(body, /Activity Center/);
  assert.doesNotMatch(body, />Chat</);
});

test("the Activity panel can call only its read flow", () => {
  const source = readFileSync(new URL("./Activity.svelte", import.meta.url), "utf8");
  const calls = [...source.matchAll(/flow\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(calls)], ["loadActivity"]);
  assert.doesNotMatch(source, /Mark|Delete|RespondToEvent|CreateEvent|EditEvent/);
});
