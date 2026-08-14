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
import { readFileSync } from "node:fs";
import { foregroundCallPriority } from "./flow.ts";
import type { RequestPriority } from "./transport.ts";

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

// --- R92: a background pilot yields its lane to the one on screen ------------
//
// ⚠ THE MULTIBOX SHAPE THIS PROTECTS. A background pilot's flow OUTLIVES its
// panel — switch away from a mining pilot and its bot loop keeps ticking every
// two seconds, which is the whole point of multibox. But the browser's ~6
// connections per origin do not multiply with the roster, so a four-pilot tab
// has four loops drawing on one budget. Without a priority the requests that
// lose are whichever arrive last, which is usually the click just made.
//
// The three-week-old fix above stopped every pilot holding an EventSource. This
// is the same problem one layer down: not who holds a connection for ever, but
// who gets one first.

test("a BACKGROUND pilot's calls are marked as background work", () => {
  assert.equal(foregroundCallPriority(false), "poll");
});

test("the FOREGROUND pilot names no priority, so its own calls decide", () => {
  // ⚠ Undefined, not "read". The space poll passes "poll" explicitly and must
  // keep it even for the pilot on screen — a poll is background work whoever
  // owns it. Forcing "read" here would quietly promote every active pilot's
  // polling above every other pilot's actual work.
  assert.equal(foregroundCallPriority(true), undefined);
});

test("switching pilots re-marks BOTH of them", () => {
  // The failure worth naming: a switch that promotes the new pilot but never
  // demotes the old one leaves two foreground pilots and no yielding at all.
  const roster = ["a", "b"];
  const marks = new Map<string, RequestPriority | undefined>();
  for (const id of roster) {
    marks.set(id, foregroundCallPriority(id === "b"));
  }
  assert.equal(marks.get("a"), "poll", "the pilot switched AWAY from still competes");
  assert.equal(marks.get("b"), undefined);
});

test("the roster marks exactly ONE pilot as foreground", () => {
  // ⚠ Read from the source, because the bug this prevents is a switch that
  // updates push but forgets priority — leaving a pilot nobody is looking at
  // competing as though they were on screen. The two calls live in one loop for
  // that reason.
  const source = readFileSync(
    new URL("../ui/App.svelte", import.meta.url),
    "utf8",
  );
  const effect = source.slice(source.indexOf("for (const s of sessions)"));
  assert.match(effect, /setLivePush\(isActive\)/, "push is no longer driven by the active id");
  assert.match(effect, /setForeground\(isActive\)/, "the roster never marks a foreground pilot");
});
