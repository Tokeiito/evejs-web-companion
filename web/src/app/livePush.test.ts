// Multibox live-push gating: browsers allow only ~6 concurrent HTTP/1.1
// connections per origin and an open EventSource pins one for its whole life,
// so a roster where EVERY pilot held a stream starved the pool — the 7th
// pilot's login/select sat in the browser's request queue forever ("bringing a
// 7th character online hangs"). The rule under test: a flow with livePush off
// NEVER opens a stream; the roster owner enables exactly one pilot (the
// active one) via setLivePush, which attaches/detaches immediately.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { EventSourceLike } from "./api.ts";

const CHARACTER_ROW = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["characterID", 140000003],
      ["characterName", "Test Three"],
      ["stationID", 60003760],
    ],
  },
};

const SELECTION_TUPLE = [
  { type: "list", items: [] },
  [null, null],
  { type: "list", items: [CHARACTER_ROW] },
  { type: "list", items: [] },
];

const SELECT_RESPONSE = {
  ok: true,
  character: {
    characterID: 140000003,
    characterName: "Test Three",
    stationID: 60003760,
    structureID: null,
    solarSystemID: 30000142,
    corporationID: 98000000,
  },
  station: null,
  notifications: [],
};

function fakeFetch(): typeof fetch {
  return (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    const respond = (payload: unknown) => ({
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    });
    if (path === "/api/login") {
      return respond({ ok: true, sessionToken: "signed.tok", account: { accountID: 2, username: "test2" } });
    }
    if (path === "/api/bridge/select") {
      return respond(SELECT_RESPONSE);
    }
    if (path === "/api/bridge/call" && body.method === "GetCharacterSelectionData") {
      return respond({
        ok: true,
        service: "charUnboundMgr",
        method: body.method,
        result: SELECTION_TUPLE,
        notifications: [],
      });
    }
    // The docked follow-up reads: answer anything else as an empty success so
    // select settles; this test cares only about the stream, not the panels.
    return respond({ ok: true, service: "x", method: String(body.method || ""), result: null, notifications: [] });
  }) as unknown as typeof fetch;
}

function streamCounter(): { opened: string[]; closed: number; factory: (url: string) => EventSourceLike } {
  const counter = {
    opened: [] as string[],
    closed: 0,
    factory(url: string): EventSourceLike {
      counter.opened.push(url);
      return {
        onmessage: null,
        onopen: null,
        onerror: null,
        close() {
          counter.closed += 1;
        },
      };
    },
  };
  return counter;
}

async function loginAndSelect(livePush: boolean | undefined) {
  const streams = streamCounter();
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: fakeFetch(),
    eventSource: streams.factory,
    perSessionToken: true,
    ...(livePush === undefined ? {} : { livePush }),
  });
  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  return { flow, store, streams };
}

test("livePush off: select brings the character online with NO stream", async () => {
  const { store, streams } = await loginAndSelect(false);
  assert.equal(store.station.get().online?.characterName, "Test Three");
  assert.equal(streams.opened.length, 0);
  assert.equal(store.live.get().status, "idle");
});

test("livePush omitted (single-session default) still opens the stream on select", async () => {
  const { streams } = await loginAndSelect(undefined);
  assert.equal(streams.opened.length, 1);
});

test("setLivePush(true) on an online pilot attaches exactly one stream; false detaches it", async () => {
  const { flow, store, streams } = await loginAndSelect(false);

  flow.setLivePush(true);
  assert.equal(streams.opened.length, 1);
  // Enabling twice must not stack a second connection.
  flow.setLivePush(true);
  assert.equal(streams.opened.length, 1);

  flow.setLivePush(false);
  assert.equal(streams.closed, 1);
  assert.equal(store.live.get().status, "idle");

  // Re-activating the pilot re-attaches (a switch back must resume push).
  flow.setLivePush(true);
  assert.equal(streams.opened.length, 2);
});

test("setLivePush(true) with nobody online opens nothing until the next select", async () => {
  const streams = streamCounter();
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: fakeFetch(),
    eventSource: streams.factory,
    perSessionToken: true,
    livePush: false,
  });
  flow.setLivePush(true);
  assert.equal(streams.opened.length, 0);
  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  // Push was enabled, so select's own startLiveStream attaches.
  assert.equal(streams.opened.length, 1);
});
