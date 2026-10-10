// The page's own requests with the page set to the socket (app/pageFetch.ts): what goes on the socket's open
// line waits for no lane (app/transport.ts), and everything else still does.
//
// This file stands a page up in Node: a `location`, a local storage that holds the setting, a `WebSocket` and a
// `fetch` the test answers by hand. The requests are made with the page's own two fetch sites, `requestJson`
// (app/api.ts, by way of `loadCloneGrade`) and `callMethod` (bridge/callMethod.ts), on the page's one lane. It
// has a file to itself because the page it stands up is the process's.

import test from "node:test";
import assert from "node:assert/strict";

import { loadCloneGrade } from "./api.ts";
import { TRANSPORT_SETTING_KEY, socketTransport } from "./pageFetch.ts";
import { MAX_IN_FLIGHT, bridgeLane } from "./transport.ts";
import { callMethod } from "../bridge/callMethod.ts";

/** The browser's socket, as much of it as the page uses: what was sent, and the BFF's side said by hand. */
class PageSocket {
  static readonly made: PageSocket[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: string[] = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    PageSocket.made.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
  say(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  frames(): unknown[] {
    return this.sent.map((each) => JSON.parse(each) as unknown);
  }
}

let setting: string | null = "socket";
/** What went over HTTP and has not been answered yet. */
const waiting: { path: unknown; answer: () => void }[] = [];
let fetched = 0;

Object.defineProperty(globalThis, "location", { value: { protocol: "http:", host: "127.0.0.1:26500" }, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key: string) => (key === TRANSPORT_SETTING_KEY ? setting : null) }, configurable: true });
Object.defineProperty(globalThis, "WebSocket", { value: PageSocket, configurable: true, writable: true });
globalThis.fetch = ((input: unknown) => {
  fetched += 1;
  return new Promise<Response>((resolve) => {
    waiting.push({ path: input, answer: () => resolve(new Response(JSON.stringify({ ok: true, service: "skillMgr", method: "GetSkillQueue", result: [] }), { status: 200 })) });
  });
}) as typeof fetch;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const lanes = (): number[] => [bridgeLane.inFlight(), bridgeLane.queued(), bridgeLane.carried()];
const answerHttp = (): void => {
  for (const each of waiting.splice(0)) each.answer();
};

test("with the page set to the socket, what goes on its open line waits for no lane; everything else still does", async () => {
  const mine = { token: "T1" } as const;
  const nobody = { token: null } as const;

  // A session's first two requests go over HTTP, each on a lane; its third opens its socket, and waits on a
  // lane while the socket is made: a socket that never opens leaves it to HTTP, which needs one.
  for (let i = 0; i < 2; i += 1) {
    const early = loadCloneGrade(mine);
    await tick();
    assert.deepEqual([lanes(), PageSocket.made.length], [[1, 0, 0], 0]);
    answerHttp();
    await early;
  }
  const third = loadCloneGrade(mine);
  await tick();
  assert.deepEqual([lanes(), PageSocket.made.length, fetched], [[1, 0, 0], 1, 2]);
  const socket = PageSocket.made[0]!;
  assert.equal(socket.url, "ws://127.0.0.1:26500/api/socket");
  socket.onopen?.({});
  socket.say({ hello: { ok: true } });
  assert.deepEqual(socket.frames(), [{ hello: { token: "T1" } }, { id: 1, method: "GET", path: "/api/bridge/clone-grade" }]);
  socket.say({ id: 1, status: 200, body: { ok: true } });
  await third;
  assert.deepEqual(lanes(), [0, 0, 0]);

  // Every lane taken by requests that cannot be carried (nobody's session: no token), and one more waiting.
  const overHttp = Array.from({ length: MAX_IN_FLIGHT + 1 }, () => loadCloneGrade(nobody));
  await tick();
  assert.deepEqual([lanes(), fetched], [[MAX_IN_FLIGHT, 1, 0], 2 + MAX_IN_FLIGHT]);

  // A read and a call of the session's, asked now: each is on the socket before the asking returns.
  const read = loadCloneGrade(mine);
  const call = callMethod("skillMgr", "GetSkillQueue", [], null, mine);
  assert.deepEqual(socket.frames().slice(2), [
    { id: 2, method: "GET", path: "/api/bridge/clone-grade" },
    { id: 3, method: "POST", path: "/api/bridge/call", body: { service: "skillMgr", method: "GetSkillQueue", args: [], kwargs: null } },
  ]);
  assert.deepEqual([lanes(), fetched], [[MAX_IN_FLIGHT, 1, 2], 2 + MAX_IN_FLIGHT], "no lane taken, nothing over HTTP, and the one waiting still waits");
  socket.say({ id: 3, status: 200, body: { ok: true, service: "skillMgr", method: "GetSkillQueue", result: [] } });
  socket.say({ id: 2, status: 200, body: { ok: true } });
  assert.equal(await read, null);
  assert.deepEqual((await call).result, []);
  assert.deepEqual(lanes(), [MAX_IN_FLIGHT, 1, 0]);

  // A fetch handed in is not the page's, whatever the page is set to: it takes its turn for a lane.
  const handed: unknown[] = [];
  const own = loadCloneGrade({
    ...mine,
    fetch: (async (input: unknown) => {
      handed.push(input);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });
  const ownCall = callMethod("skillMgr", "GetSkillQueue", [], null, {
    ...mine,
    fetch: (async (input: unknown) => {
      handed.push(input);
      return new Response(JSON.stringify({ ok: true, service: "skillMgr", method: "GetSkillQueue", result: [] }), { status: 200 });
    }) as typeof fetch,
  });
  await tick();
  assert.deepEqual([lanes(), handed], [[MAX_IN_FLIGHT, 3, 0], []]);

  // And a page told to go back goes back at its next request: over HTTP, in turn, though the socket is still open.
  setting = null;
  const back = loadCloneGrade(mine);
  const backCall = callMethod("skillMgr", "GetSkillQueue", [], null, mine);
  await tick();
  assert.deepEqual([lanes(), socket.sent.length, fetched], [[MAX_IN_FLIGHT, 5, 0], 4, 2 + MAX_IN_FLIGHT]);
  setting = "socket";

  // Everything asked is answered in the end, and nothing is left holding anything.
  for (let turn = 0; turn < 20 && (bridgeLane.inFlight() > 0 || bridgeLane.queued() > 0); turn += 1) {
    answerHttp();
    await tick();
  }
  await Promise.all([...overHttp, own, ownCall, back, backCall]);
  assert.deepEqual([lanes(), handed, socket.sent.length], [[0, 0, 0], ["/api/bridge/clone-grade", "/api/bridge/call"], 4]);
  socketTransport()?.close();
});
