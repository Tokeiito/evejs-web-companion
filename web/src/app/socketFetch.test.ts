// The page's requests carried on the tab's socket (app/socketFetch.ts; the plan's Phase 6a).
//
// What has to hold: whoever asks cannot tell which way a request went, and no request is lost or run twice by
// the socket being there. So each test says what was put on the socket, what was fetched over HTTP, and what
// the asker got back.

import test from "node:test";
import assert from "node:assert/strict";

import { createSocketFetch, operationOf, responseOf, type PushHandlers, type SocketLike } from "./socketFetch.ts";

/** A socket the test drives: what was sent on it, and the BFF's side said by hand. */
class FakeSocket implements SocketLike {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closedByPage = false;
  refuseSends = false;
  send(data: string): void {
    if (this.refuseSends) throw new Error("the socket is not open");
    this.sent.push(data);
  }
  close(): void {
    this.closedByPage = true;
  }
  open(): void {
    this.onopen?.({});
  }
  say(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
  end(code?: number): void {
    this.onclose?.({ code });
  }
  frames(): unknown[] {
    return this.sent.map((each) => JSON.parse(each) as unknown);
  }
  /** Opened and greeted, as a healthy one is. */
  greet(): void {
    this.open();
    this.say({ hello: { ok: true } });
  }
}

interface Rig {
  readonly fetch: typeof fetch;
  readonly sockets: FakeSocket[];
  readonly fetched: { input: unknown; init: RequestInit | undefined }[];
  readonly stats: () => { carried: number; fetched: number; open: number };
  readonly wouldCarry: (input: unknown, init: RequestInit | undefined) => boolean;
  readonly listen: (token: string, handlers: PushHandlers) => { close(): void };
  readonly close: () => void;
  clock: number;
  failOpening: boolean;
}

/** The page's socket fetch with a stand-in for the socket and for HTTP. A token is given its socket at its first request unless `life` says otherwise. */
function rig(life: { warmUp?: number; idleMs?: number } = { warmUp: 0 }): Rig {
  const sockets: FakeSocket[] = [];
  const fetched: { input: unknown; init: RequestInit | undefined }[] = [];
  const made: Rig = {
    fetch: null as unknown as typeof fetch,
    sockets,
    fetched,
    stats: () => ({ carried: 0, fetched: 0, open: 0 }),
    wouldCarry: () => false,
    listen: () => ({ close() {} }),
    close: () => {},
    clock: 1_000_000,
    failOpening: false,
  };
  const carried = createSocketFetch({
    fetch: (async (input: unknown, init?: RequestInit) => {
      fetched.push({ input, init });
      return new Response(JSON.stringify({ ok: true, via: "http", path: input }), { status: 200 });
    }) as typeof fetch,
    openSocket: () => {
      if (made.failOpening) throw new Error("no socket to be had");
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => made.clock,
    retryMs: 5_000,
    ...life,
  });
  return Object.assign(made, { fetch: carried.fetch, stats: carried.stats, wouldCarry: carried.wouldCarry, listen: carried.listen, close: carried.close });
}

const asToken = (token: string, more: RequestInit = {}): RequestInit => ({ method: "GET", ...more, headers: { authorization: `Bearer ${token}`, ...((more.headers as Record<string, string> | undefined) ?? {}) } });
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("a request is carried as an operation once the socket has said hello, and answered as a fetch answers", async () => {
  const page = rig();
  const first = page.fetch("/api/bridge/flight/status?x=1", asToken("T1"));
  assert.equal(page.sockets.length, 1);
  const socket = page.sockets[0]!;
  // Nothing is said before the socket is open, and the hello is first, with the request's own token.
  assert.deepEqual(socket.frames(), []);
  socket.open();
  assert.deepEqual(socket.frames(), [{ hello: { token: "T1" } }]);
  // Asked before the BFF has answered the hello: it waits, and is sent when it has.
  const second = page.fetch("/api/bridge/select", asToken("T1", { method: "post", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterID: 140000002, confirm: true }) }));
  assert.equal(socket.frames().length, 1);
  socket.say({ hello: { ok: true } });
  assert.deepEqual(socket.frames().slice(1), [
    { id: 1, method: "GET", path: "/api/bridge/flight/status?x=1" },
    { id: 2, method: "POST", path: "/api/bridge/select", body: { characterID: 140000002, confirm: true } },
  ]);
  assert.deepEqual(page.stats(), { carried: 0, fetched: 0, open: 1 });

  // Answered out of order, each by its id.
  socket.say({ id: 2, status: 409, body: { ok: false, error: "PILOT_BUSY", message: "Somebody is flying it." } });
  socket.say({ id: 1, status: 200, body: { ok: true, flight: { docked: true } } });
  const [status, select] = [await first, await second];
  assert.deepEqual([status.status, status.ok, await status.json()], [200, true, { ok: true, flight: { docked: true } }]);
  assert.deepEqual([select.status, select.ok, await select.json()], [409, false, { ok: false, error: "PILOT_BUSY", message: "Somebody is flying it." }]);
  assert.deepEqual(page.stats(), { carried: 2, fetched: 0, open: 1 });
  assert.deepEqual(page.fetched, []);

  // On an open socket a request is sent as it is asked.
  const third = page.fetch("/api/bridge/skills", asToken("T1"));
  assert.deepEqual(socket.frames().at(-1), { id: 3, method: "GET", path: "/api/bridge/skills" });
  socket.say({ id: 3, status: 200, body: { ok: true } });
  assert.equal((await third).status, 200);
  assert.equal(page.sockets.length, 1, "one socket for the token, however many requests");
});

test("what cannot be carried is fetched as before, and no socket is opened for it", async () => {
  const page = rig();
  const cases: [string, unknown, RequestInit | undefined][] = [
    ["no token: a request that rides the cookie", "/api/bridge/skills", { method: "GET", headers: {} }],
    ["no headers at all", "/api/bridge/skills", undefined],
    ["a token that is not a bearer's", "/api/bridge/skills", { headers: { authorization: "Basic abc" } }],
    ["an empty bearer", "/api/bridge/skills", { headers: { authorization: "Bearer " } }],
    ["headers that are not a plain record", "/api/bridge/skills", { headers: new Headers({ authorization: "Bearer T1" }) }],
    ["a path that is not the BFF's API", "/assets/app.js", asToken("T1")],
    ["an address somewhere else", "https://elsewhere.example/api/bridge/skills", asToken("T1")],
    ["a request object", new URL("http://localhost/api/bridge/skills"), asToken("T1")],
    ["the event stream", "/api/bridge/events?access_token=T1", asToken("T1")],
    ["the socket's own path", "/api/socket", asToken("T1")],
    ["a method the socket does not carry", "/api/bridge/skills", asToken("T1", { method: "HEAD" })],
    ["a body that is not JSON text", "/api/bridge/select", asToken("T1", { method: "POST", body: "characterID=1" })],
    ["a body that is not text", "/api/bridge/select", asToken("T1", { method: "POST", body: new Uint8Array([1, 2]) })],
    ["a read with a body", "/api/bridge/skills", asToken("T1", { method: "GET", body: "{}" })],
  ];
  for (const [why, input, init] of cases) {
    const answer = await page.fetch(input as string, init);
    assert.equal((await answer.json()).via, "http", why);
    assert.deepEqual(page.fetched.at(-1), { input, init }, why);
    assert.equal(operationOf(input, init), null, why);
  }
  assert.deepEqual([page.sockets.length, page.fetched.length, page.stats()], [0, cases.length, { carried: 0, fetched: cases.length, open: 0 }]);
  // And what can be: the token however its header is spelt, a body or none.
  assert.deepEqual(operationOf("/api/x", { headers: { Authorization: "Bearer T9" } }), { token: "T9", method: "GET", path: "/api/x", body: undefined });
  assert.deepEqual(operationOf("/api/x", { method: "delete", headers: { authorization: "Bearer T9" }, body: "[1,2]" }), { token: "T9", method: "DELETE", path: "/api/x", body: [1, 2] });
  assert.deepEqual(operationOf("/api/x", { method: "POST", headers: { authorization: "Bearer T9" }, body: null }), { token: "T9", method: "POST", path: "/api/x", body: undefined });
});

test("each token has a socket of its own, greeted with that token", async () => {
  const page = rig();
  const one = page.fetch("/api/bridge/skills", asToken("T1"));
  const two = page.fetch("/api/bridge/skills", asToken("T2"));
  assert.equal(page.sockets.length, 2);
  page.sockets[0]!.greet();
  page.sockets[1]!.greet();
  assert.deepEqual([page.sockets[0]!.frames()[0], page.sockets[1]!.frames()[0]], [{ hello: { token: "T1" } }, { hello: { token: "T2" } }]);
  page.sockets[1]!.say({ id: 1, status: 200, body: { ok: true, whose: "T2" } });
  page.sockets[0]!.say({ id: 1, status: 200, body: { ok: true, whose: "T1" } });
  assert.deepEqual([(await (await one).json()).whose, (await (await two).json()).whose], ["T1", "T2"]);
  assert.equal(page.stats().open, 2);
});

test("a socket that never opens costs nothing: what waited on it is fetched, and it is left alone for a while", async () => {
  const page = rig();
  const waited = [page.fetch("/api/bridge/skills", asToken("T1")), page.fetch("/api/bridge/wallet", asToken("T1"))];
  page.sockets[0]!.end(1006);
  assert.deepEqual((await Promise.all(waited.map(async (each) => (await (await each).json()).path))), ["/api/bridge/skills", "/api/bridge/wallet"]);
  assert.deepEqual(page.sockets[0]!.frames(), [], "nothing of them was ever sent");
  // Within the wait, a request goes over HTTP and no socket is tried.
  page.clock += 4_999;
  assert.equal((await (await page.fetch("/api/bridge/skills", asToken("T1"))).json()).via, "http");
  assert.equal(page.sockets.length, 1);
  // When the wait is up, the next request tries again, and is carried if the socket is there now.
  page.clock += 1;
  const again = page.fetch("/api/bridge/skills", asToken("T1"));
  assert.equal(page.sockets.length, 2);
  page.sockets[1]!.greet();
  page.sockets[1]!.say({ id: 1, status: 200, body: { ok: true, via: "socket" } });
  assert.equal((await (await again).json()).via, "socket");
  assert.deepEqual(page.stats(), { carried: 1, fetched: 3, open: 1 });
  // No socket to be had at all (the browser will not make one): the same.
  const other = rig();
  other.failOpening = true;
  assert.equal((await (await other.fetch("/api/bridge/skills", asToken("T1"))).json()).via, "http");
  assert.deepEqual(other.stats(), { carried: 0, fetched: 1, open: 0 });
});

test("a token the BFF does not know is not offered again: its requests are fetched, and say so for themselves", async () => {
  const page = rig();
  const first = page.fetch("/api/bridge/skills", asToken("stale"));
  page.sockets[0]!.open();
  page.sockets[0]!.end(4401);
  assert.equal((await (await first).json()).via, "http");
  page.clock += 60_000;
  assert.equal((await (await page.fetch("/api/bridge/skills", asToken("stale"))).json()).via, "http");
  assert.equal(page.sockets.length, 1, "never tried again for that token");
  // Another token is another matter.
  void page.fetch("/api/bridge/skills", asToken("fresh"));
  assert.equal(page.sockets.length, 2);
  // And a socket that had opened and is then closed with that code was not refused: it is tried again in time.
  const opened = rig();
  void opened.fetch("/api/bridge/skills", asToken("T1")).catch(() => {});
  opened.sockets[0]!.greet();
  opened.sockets[0]!.end(4401);
  opened.clock += 5_000;
  void opened.fetch("/api/bridge/skills", asToken("T1"));
  assert.equal(opened.sockets.length, 2);
});

test("a request sent and not answered when the socket closes fails, and is not asked again by any other way", async () => {
  const page = rig();
  const write = page.fetch("/api/bridge/fleet/create", asToken("T1", { method: "POST", body: JSON.stringify({ confirm: true }) }));
  page.sockets[0]!.greet();
  assert.equal(page.sockets[0]!.frames().length, 2);
  page.sockets[0]!.end(1006);
  await assert.rejects(write, (error: unknown) => error instanceof TypeError && /closed before \/api\/bridge\/fleet\/create was answered/.test(error.message));
  assert.deepEqual(page.fetched, [], "it may have been run: nobody runs it again");
  // What is asked next goes over HTTP until the socket is tried again.
  assert.equal((await (await page.fetch("/api/bridge/skills", asToken("T1"))).json()).via, "http");
  assert.deepEqual(page.stats(), { carried: 0, fetched: 1, open: 0 });
});

test("what the BFF says it did not run as an operation is fetched instead", async () => {
  const page = rig();
  const asked = page.fetch("/api/bridge/skills", asToken("T1"));
  page.sockets[0]!.greet();
  page.sockets[0]!.say({ id: 1, error: { code: "NOT_AN_OPERATION", message: "…" } });
  const answer = await asked;
  assert.deepEqual([(await answer.json()).via, page.fetched.length, page.stats()], ["http", 1, { carried: 0, fetched: 1, open: 1 }]);
  // A request that could not be put on the socket at all: the same.
  page.sockets[0]!.refuseSends = true;
  assert.equal((await (await page.fetch("/api/bridge/wallet", asToken("T1"))).json()).via, "http");
  assert.equal(page.fetched.length, 2);
});

test("a request given up on is rejected with the reason it was given up for, and its late answer has nobody waiting", async () => {
  const page = rig();
  // Given up on before it was asked.
  const before = new AbortController();
  before.abort(new DOMException("too late", "TimeoutError"));
  await assert.rejects(page.fetch("/api/bridge/skills", asToken("T1", { signal: before.signal })), (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  // Given up on while it waited for the hello: it is never sent.
  const waiting = new AbortController();
  const queued = page.fetch("/api/bridge/skills", asToken("T1", { signal: waiting.signal }));
  waiting.abort(new DOMException("gave up", "AbortError"));
  await assert.rejects(queued, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  const socket = page.sockets[0]!;
  socket.greet();
  assert.deepEqual(socket.frames(), [{ hello: { token: "T1" } }]);
  // Given up on after it was sent: rejected, and the answer that comes after is nobody's.
  const sent = new AbortController();
  const flying = page.fetch("/api/bridge/skills", asToken("T1", { signal: sent.signal }));
  assert.deepEqual(socket.frames().at(-1), { id: 1, method: "GET", path: "/api/bridge/skills" });
  sent.abort(new DOMException("gave up", "AbortError"));
  await assert.rejects(flying, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  socket.say({ id: 1, status: 200, body: { ok: true } });
  await tick();
  assert.deepEqual(page.stats(), { carried: 0, fetched: 0, open: 1 });
  // An answered request's signal, given up on later, changes nothing.
  const done = new AbortController();
  const answered = page.fetch("/api/bridge/skills", asToken("T1", { signal: done.signal }));
  socket.say({ id: 2, status: 200, body: { ok: true } });
  assert.equal((await answered).status, 200);
  done.abort();
  await tick();
  assert.equal(page.stats().carried, 1);
});

test("what the socket says that is no answer to anything is let pass", async () => {
  const page = rig();
  const asked = page.fetch("/api/bridge/skills", asToken("T1"));
  const socket = page.sockets[0]!;
  socket.greet();
  for (const noise of ["not json", "[1,2]", "null", { id: 99, status: 200, body: {} }, { id: "1", status: 200, body: {} }, { hello: { ok: true } }, { event: { kind: "something pushed" } }]) socket.say(noise);
  assert.equal(socket.frames().length, 2, "a second hello sends nothing again");
  socket.say({ id: 1, status: 200, body: { ok: true } });
  assert.equal((await asked).status, 200);
  // A socket the page has let go of is not listened to any more.
  page.close();
  assert.equal(socket.closedByPage, true);
  socket.say({ id: 2, status: 200, body: {} });
  // Least of all its hello: taken, it would mark a socket open that is no longer there, and what was asked
  // next would be sent to nobody.
  socket.say({ hello: { ok: true } });
  socket.end(1000);
  assert.equal(page.stats().open, 0);
  // And the next request opens another at once, with no wait.
  void page.fetch("/api/bridge/skills", asToken("T1"));
  assert.equal(page.sockets.length, 2);
});

test("a reply is the response a fetch would have given: its status, its JSON or its text, or nothing where there is none", async () => {
  const json = responseOf(201, { ok: true, list: [1, 2] });
  assert.deepEqual([json.status, json.ok, json.headers.get("content-type"), await json.json()], [201, true, "application/json; charset=utf-8", { ok: true, list: [1, 2] }]);
  const text = responseOf(200, "<!doctype html>");
  assert.deepEqual([text.status, text.headers.get("content-type"), await text.text()], [200, "text/plain; charset=utf-8", "<!doctype html>"]);
  // A page that asks for JSON of what is not JSON is told as a fetch tells it: by the reading failing.
  await assert.rejects(responseOf(200, "<!doctype html>").json());
  for (const [status, body] of [[204, null], [204, { ignored: true }], [200, null], [304, "x"], [200, undefined]] as const) {
    const empty = responseOf(status, body);
    assert.deepEqual([empty.status, await empty.text()], [status, ""], `${status} ${JSON.stringify(body)}`);
  }
  assert.deepEqual([responseOf(404, { ok: false }).ok, responseOf(500, { ok: false }).status], [false, 500]);
  // A status that is no status of a response is a bad gateway's, not a thrown error.
  for (const odd of [0, 99, 600, 200.5, "200", null, undefined]) assert.equal(responseOf(odd, { ok: true }).status, 502, String(odd));
  // Falsy JSON is still JSON.
  assert.deepEqual([await responseOf(200, 0).json(), await responseOf(200, false).json(), await responseOf(200, []).json()], [0, false, []]);
});

// ── a socket's life ──────────────────────────────────────────────────────────
//
// Found in the browser: the hangar signs in for one question and out again, account after account, and each of those
// sessions had been given a socket that nothing ever closed.

test("a token is given its socket at its third request: a session that asks one thing and logs out never has one", async () => {
  const page = rig({});
  // The hangar's read of an account's roster: a question and a logout, on a session made for it.
  assert.equal((await (await page.fetch("/api/bridge/call", asToken("passing", { method: "POST", body: "{}" }))).json()).via, "http");
  assert.equal((await (await page.fetch("/api/logout", asToken("passing", { method: "POST", body: "{}" }))).json()).via, "http");
  assert.deepEqual([page.sockets.length, page.stats()], [0, { carried: 0, fetched: 2, open: 0 }]);
  // A session that stays: its third request opens its socket and is carried on it, and so is all it asks after.
  void page.fetch("/api/bridge/flight/status", asToken("staying"));
  void page.fetch("/api/bridge/skills", asToken("staying"));
  assert.equal(page.sockets.length, 0);
  const third = page.fetch("/api/bridge/wallet", asToken("staying"));
  assert.equal(page.sockets.length, 1);
  page.sockets[0]!.greet();
  assert.deepEqual(page.sockets[0]!.frames(), [{ hello: { token: "staying" } }, { id: 1, method: "GET", path: "/api/bridge/wallet" }]);
  page.sockets[0]!.say({ id: 1, status: 200, body: { ok: true } });
  assert.equal((await third).status, 200);
  void page.fetch("/api/bridge/fitting", asToken("staying"));
  assert.deepEqual(page.sockets[0]!.frames().at(-1), { id: 2, method: "GET", path: "/api/bridge/fitting" });
  // What cannot be carried is not counted towards one.
  const other = rig({});
  for (let i = 0; i < 5; i += 1) void other.fetch("/api/bridge/events", asToken("T1"));
  void other.fetch("/api/bridge/skills", asToken("T1"));
  assert.equal(other.sockets.length, 0);
});

test("the tokens being counted towards a socket are the newest of them: the count cannot grow for ever", async () => {
  const page = rig({});
  void page.fetch("/api/bridge/skills", asToken("first"));
  for (let i = 0; i < 64; i += 1) void page.fetch("/api/bridge/skills", asToken(`passing-${i}`));
  // The first has been let fall out of the count, so it starts again: two more over HTTP, then its socket.
  void page.fetch("/api/bridge/skills", asToken("first"));
  void page.fetch("/api/bridge/skills", asToken("first"));
  assert.equal(page.sockets.length, 0);
  void page.fetch("/api/bridge/skills", asToken("first"));
  assert.equal(page.sockets.length, 1);
  // One still within the newest is counted on: this is its second, and the next its third.
  void page.fetch("/api/bridge/skills", asToken("passing-63"));
  assert.equal(page.sockets.length, 1);
  void page.fetch("/api/bridge/skills", asToken("passing-63"));
  assert.equal(page.sockets.length, 2);
});

test("a session logged out on its socket has the socket closed, and nothing is kept of it", async () => {
  const page = rig();
  const asked = page.fetch("/api/bridge/skills", asToken("T1"));
  const socket = page.sockets[0]!;
  socket.greet();
  socket.say({ id: 1, status: 200, body: { ok: true } });
  await asked;
  // A logout that the BFF refuses leaves the socket as it was.
  const refused = page.fetch("/api/logout", asToken("T1", { method: "POST", body: "{}" }));
  socket.say({ id: 2, status: 409, body: { ok: false, error: "DRONE_RECOVERY_PENDING" } });
  assert.equal((await refused).status, 409);
  assert.deepEqual([socket.closedByPage, page.stats().open], [false, 1]);
  // One that it takes closes it.
  const out = page.fetch("/api/logout?reason=done", asToken("T1", { method: "POST", body: "{}" }));
  socket.say({ id: 3, status: 200, body: { ok: true } });
  assert.deepEqual([(await out).status, await (await out).clone().json()], [200, { ok: true }]);
  assert.deepEqual([socket.closedByPage, page.stats().open], [true, 0]);
  // The token asked with again (it should not be) is a session not yet staying, like any other.
  const again = rig({});
  for (let i = 0; i < 3; i += 1) void again.fetch("/api/bridge/skills", asToken("T1"));
  again.sockets[0]!.greet();
  again.sockets[0]!.say({ id: 1, status: 200, body: { ok: true } });
  const gone = again.fetch("/api/logout", asToken("T1", { method: "POST", body: "{}" }));
  again.sockets[0]!.say({ id: 2, status: 200, body: { ok: true } });
  await gone;
  assert.equal((await (await again.fetch("/api/bridge/skills", asToken("T1"))).json()).via, "http");
  assert.equal(again.sockets.length, 1);
  // Nothing of its socket was kept to be tried again when a wait is up: it is counted from the start.
  again.clock += 5_000;
  assert.equal((await (await again.fetch("/api/bridge/skills", asToken("T1"))).json()).via, "http");
  assert.equal(again.sockets.length, 1);
  void again.fetch("/api/bridge/skills", asToken("T1"));
  assert.equal(again.sockets.length, 2);
});

test("a socket nothing has been asked on for a while is closed when something else is asked; one with a request waiting is kept", async () => {
  const page = rig({ warmUp: 0, idleMs: 60_000 });
  const first = page.fetch("/api/bridge/skills", asToken("idle"));
  page.sockets[0]!.greet();
  page.sockets[0]!.say({ id: 1, status: 200, body: { ok: true } });
  await first;
  const waiting = page.fetch("/api/bridge/skills", asToken("busy"));
  page.sockets[1]!.greet();
  // Within the while, both stand.
  page.clock += 59_999;
  void page.fetch("/api/bridge/wallet", asToken("another"));
  assert.deepEqual([page.sockets[0]!.closedByPage, page.sockets[1]!.closedByPage], [false, false]);
  // Past it: the one with nothing waiting is closed; the one still owed an answer is not, however long it has been.
  page.clock += 1;
  void page.fetch("/api/bridge/wallet", asToken("another"));
  assert.deepEqual([page.sockets[0]!.closedByPage, page.sockets[1]!.closedByPage], [true, false]);
  page.sockets[1]!.say({ id: 1, status: 200, body: { ok: true, late: true } });
  assert.equal((await (await waiting).json()).late, true);
  // The token asking is not the one swept, however long since it last asked.
  page.clock += 600_000;
  const back = page.fetch("/api/bridge/skills", asToken("busy"));
  assert.equal(page.sockets[1]!.closedByPage, false);
  page.sockets[1]!.say({ id: 2, status: 200, body: { ok: true } });
  assert.equal((await back).status, 200);
  // And having asked, it is not idle: the while is counted from then.
  page.clock += 59_999;
  void page.fetch("/api/bridge/wallet", asToken("another"));
  assert.equal(page.sockets[1]!.closedByPage, false);
  // The one closed for idleness is opened again when it asks.
  const before = page.sockets.length;
  void page.fetch("/api/bridge/skills", asToken("idle"));
  assert.equal(page.sockets.length, before + 1);
});

test("a socket that has been replaced is not listened to: what it says late is nothing to the one that took its place", async () => {
  const page = rig();
  const first = page.fetch("/api/bridge/skills", asToken("T1"));
  const old = page.sockets[0]!;
  old.open();
  old.end(1006);
  assert.equal((await (await first).json()).via, "http");
  // The wait is up: the next request opens another socket for the same token, and waits on its hello.
  page.clock += 5_000;
  const second = page.fetch("/api/bridge/wallet", asToken("T1"));
  const fresh = page.sockets[1]!;
  // The old one speaks late, in every way it can.
  old.say({ hello: { ok: true } });
  old.open();
  old.say({ id: 1, status: 200, body: { ok: true, from: "the old socket" } });
  assert.deepEqual(old.frames(), [{ hello: { token: "T1" } }], "nothing more is said to it");
  assert.deepEqual(fresh.frames(), [], "and nothing is sent on the new one before it is open and greeted");
  old.end(1000);
  // The new one is still the token's socket, and carries what waited on it.
  fresh.greet();
  assert.deepEqual(fresh.frames(), [{ hello: { token: "T1" } }, { id: 1, method: "GET", path: "/api/bridge/wallet" }]);
  fresh.say({ id: 1, status: 200, body: { ok: true, from: "the new socket" } });
  assert.equal((await (await second).json()).from, "the new socket");
  assert.deepEqual(page.stats(), { carried: 1, fetched: 1, open: 1 });
});

test("whether a request would go on an open socket is said without asking anything or changing anything", async () => {
  const page = rig({});
  const request = asToken("T1");
  // No socket yet, however often it is asked: asking is not a request, and is not counted towards one.
  for (let i = 0; i < 5; i += 1) assert.equal(page.wouldCarry("/api/bridge/skills", request), false);
  assert.equal(page.sockets.length, 0);
  // The token's third request opens its socket; until the hello is answered, nothing would be carried.
  await page.fetch("/api/bridge/skills", request);
  await page.fetch("/api/bridge/skills", request);
  assert.equal(page.sockets.length, 0, "five askings and two requests are two requests");
  const third = page.fetch("/api/bridge/skills", request);
  assert.equal(page.sockets.length, 1);
  const socket = page.sockets[0]!;
  assert.equal(page.wouldCarry("/api/bridge/skills", request), false, "a socket being made is not an open one");
  socket.open();
  assert.equal(page.wouldCarry("/api/bridge/skills", request), false, "nor is one that has not been said hello to");
  socket.say({ hello: { ok: true } });
  assert.equal(page.wouldCarry("/api/bridge/skills", request), true);
  // Only what can be carried, and only on this token's socket.
  assert.equal(page.wouldCarry("/api/bridge/skills", asToken("T2")), false);
  assert.equal(page.wouldCarry("/api/bridge/events", request), false);
  assert.equal(page.wouldCarry("/api/bridge/skills", { headers: {} }), false);
  assert.equal(page.wouldCarry("/assets/app.js", request), false);
  assert.equal(page.wouldCarry("/api/bridge/select", asToken("T1", { method: "POST", body: "{}" })), true);
  // The asking sent nothing, opened nothing, and counted as nothing asked.
  assert.deepEqual(socket.frames(), [{ hello: { token: "T1" } }, { id: 1, method: "GET", path: "/api/bridge/skills" }]);
  socket.say({ id: 1, status: 200, body: { ok: true } });
  assert.equal((await third).status, 200);
  assert.deepEqual([page.sockets.length, page.stats()], [1, { carried: 1, fetched: 2, open: 1 }]);
  // And not once the socket has gone.
  socket.end(1006);
  assert.equal(page.wouldCarry("/api/bridge/skills", request), false);
  assert.equal(page.sockets.length, 1);
});

// --- the pushed notices ------------------------------------------------------
//
// A session's event stream, listened to on its socket. What has to hold: the listener is told what an event
// stream would tell it, of its own stream and no other's; and where the socket is not to be had it is told that,
// so that the page's EventSource can be the way back.

/** A listener that keeps what it is told, under a name. */
function hearing(heard: unknown[], name: string): PushHandlers {
  return {
    onOpen: () => heard.push([name, "open"]),
    onFrame: (frame) => heard.push([name, "frame", frame]),
    onEnded: () => heard.push([name, "ended"]),
    onUnavailable: () => heard.push([name, "unavailable"]),
  };
}

test("a session's pushed notices are listened to on its socket: asked for once it is open, and each frame handed on", async () => {
  const page = rig({});
  const heard: unknown[] = [];
  // A session that is listened to is one that stays: its socket is made now, though it has asked nothing yet.
  page.listen("T1", hearing(heard, "first"));
  assert.equal(page.sockets.length, 1);
  const socket = page.sockets[0]!;
  assert.deepEqual(socket.frames(), []);
  socket.open();
  assert.deepEqual(socket.frames(), [{ hello: { token: "T1" } }]);
  socket.say({ hello: { ok: true } });
  assert.deepEqual(socket.frames().slice(1), [{ events: "open", n: 1 }]);
  // (A hello said again changes nothing: the stream is not asked for twice.)
  socket.say({ hello: { ok: true } });
  assert.equal(socket.frames().length, 2);
  assert.deepEqual(heard, []);
  socket.say({ events: { open: true, n: 1 } });
  socket.say({ event: { source: "evejs-web-bff", type: "stream-status", state: "live", detail: null } });
  socket.say({ event: { source: "evejs-web-gateway", type: "event", cursor: { epoch: "e1", sequence: 1 }, event: { kind: "chat" } } });
  assert.deepEqual(heard, [
    ["first", "open"],
    ["first", "frame", { source: "evejs-web-bff", type: "stream-status", state: "live", detail: null }],
    ["first", "frame", { source: "evejs-web-gateway", type: "event", cursor: { epoch: "e1", sequence: 1 }, event: { kind: "chat" } }],
  ]);
  // Its requests go on the same socket from the first of them, with the frames between.
  const asked = page.fetch("/api/bridge/skills", asToken("T1"));
  assert.deepEqual(socket.frames().at(-1), { id: 1, method: "GET", path: "/api/bridge/skills" });
  socket.say({ event: { between: true } });
  socket.say({ id: 1, status: 200, body: { ok: true } });
  assert.equal((await asked).status, 200);
  assert.deepEqual(heard.at(-1), ["first", "frame", { between: true }]);
  assert.deepEqual([page.sockets.length, page.fetched.length, page.stats()], [1, 0, { carried: 1, fetched: 0, open: 1 }]);
  // On a socket already open it is asked for as it is listened to. Nothing said that is no frame of the stream's is handed on.
  const other = rig();
  void other.fetch("/api/bridge/skills", asToken("T2"));
  other.sockets[0]!.greet();
  other.listen("T2", hearing(heard, "other"));
  assert.deepEqual(other.sockets[0]!.frames().at(-1), { events: "open", n: 1 });
  other.sockets[0]!.say({ events: "something else" });
  other.sockets[0]!.say({ events: null });
  other.sockets[0]!.say({ events: { open: true } });
  other.sockets[0]!.say({ events: { n: 1 } });
  assert.equal(heard.filter((each) => (each as unknown[])[0] === "other").length, 0);
});

test("listening again takes the place of the one before, and what is said of the old stream is nothing to the new", () => {
  const page = rig();
  const heard: unknown[] = [];
  const first = page.listen("T1", hearing(heard, "first"));
  const socket = page.sockets[0]!;
  socket.greet();
  socket.say({ events: { open: true, n: 1 } });
  socket.say({ event: { for: "first" } });
  const second = page.listen("T1", hearing(heard, "second"));
  assert.deepEqual(socket.frames().slice(1), [{ events: "open", n: 1 }, { events: "open", n: 2 }]);
  // The one before is told nothing, and its closing now says nothing to the BFF: the stream there is the new one's.
  first.close();
  assert.equal(socket.frames().length, 3);
  // The last of the old stream: a frame before the new one is said to be attached, and the old one's ending.
  socket.say({ event: { for: "nobody" } });
  socket.say({ events: { ended: true, n: 1, status: 200, body: null } });
  socket.say({ events: { open: true, n: 1 } });
  assert.deepEqual(heard, [["first", "open"], ["first", "frame", { for: "first" }]]);
  socket.say({ events: { open: true, n: 2 } });
  socket.say({ event: { for: "second" } });
  assert.deepEqual(heard.slice(2), [["second", "open"], ["second", "frame", { for: "second" }]]);
  second.close();
  assert.deepEqual(socket.frames().at(-1), { events: "close" });
});

test("a listener that stops is told nothing more, and the BFF is told once; one the BFF ends is told so, once", async () => {
  const page = rig();
  const heard: unknown[] = [];
  const listening = page.listen("T1", hearing(heard, "first"));
  const socket = page.sockets[0]!;
  socket.greet();
  socket.say({ events: { open: true, n: 1 } });
  listening.close();
  listening.close();
  assert.deepEqual(socket.frames().slice(2), [{ events: "close" }]);
  socket.say({ event: { late: true } });
  socket.say({ events: { ended: true, n: 1, status: 200, body: null } });
  assert.deepEqual(heard, [["first", "open"]]);

  // Stopped before the socket was open: nothing is asked for when it opens.
  const early = rig();
  early.listen("T1", hearing(heard, "early")).close();
  early.sockets[0]!.greet();
  assert.deepEqual(early.sockets[0]!.frames(), [{ hello: { token: "T1" } }]);

  // Refused by the BFF (nobody flown), or ended by it: said once, and nothing after. The socket goes on.
  const again = page.listen("T1", hearing(heard, "again"));
  assert.deepEqual(socket.frames().at(-1), { events: "open", n: 2 });
  socket.say({ events: { ended: true, n: 2, status: 409, body: { ok: false, error: "NO_LIVE_SESSION" } } });
  socket.say({ events: { ended: true, n: 2, status: 409, body: null } });
  socket.say({ event: { late: true } });
  assert.deepEqual(heard.slice(1), [["again", "ended"]]);
  const sentBefore = socket.frames().length;
  again.close();
  assert.equal(socket.frames().length, sentBefore, "a stream that has ended is not closed again");
  const asked = page.fetch("/api/bridge/skills", asToken("T1"));
  socket.say({ id: 1, status: 200, body: { ok: true } });
  assert.equal((await asked).status, 200);
});

test("where the socket is not to be had, whoever listens is told so: the page's event stream is the way back", () => {
  const heard: unknown[] = [];
  // No socket can be made.
  const none = rig();
  none.failOpening = true;
  none.listen("T1", hearing(heard, "none")).close();
  assert.deepEqual([heard.splice(0), none.sockets.length], [[["none", "unavailable"]], 0]);

  // It never opens; and for a while it is not tried again, so a listener then is told at once.
  const never = rig();
  never.listen("T1", hearing(heard, "never"));
  never.sockets[0]!.end(1006);
  never.listen("T1", hearing(heard, "soon after"));
  assert.deepEqual([heard.splice(0), never.sockets.length], [[["never", "unavailable"], ["soon after", "unavailable"]], 1]);
  never.clock += 5_000;
  never.listen("T1", hearing(heard, "later"));
  assert.deepEqual([heard.splice(0), never.sockets.length], [[], 2]);

  // The BFF does not know the token: for good.
  const refused = rig();
  refused.listen("T1", hearing(heard, "refused"));
  refused.sockets[0]!.open();
  refused.sockets[0]!.end(4401);
  refused.clock += 60_000;
  refused.listen("T1", hearing(heard, "refused again"));
  assert.deepEqual([heard.splice(0), refused.sockets.length], [[["refused", "unavailable"], ["refused again", "unavailable"]], 1]);

  // It goes down while listened on: told once, and nothing of the line's after.
  const lost = rig();
  const listening = lost.listen("T1", hearing(heard, "lost"));
  lost.sockets[0]!.greet();
  lost.sockets[0]!.say({ events: { open: true, n: 1 } });
  lost.sockets[0]!.end(1006);
  lost.sockets[0]!.end(1006);
  assert.deepEqual(heard.splice(0), [["lost", "open"], ["lost", "unavailable"]]);
  // The session's next socket (a request makes it, when the wait is up) is not listened on for it: it was sent
  // another way, and would otherwise be told everything twice.
  lost.clock += 5_000;
  void lost.fetch("/api/bridge/skills", asToken("T1"));
  lost.sockets[1]!.greet();
  assert.deepEqual(lost.sockets[1]!.frames(), [{ hello: { token: "T1" } }, { id: 1, method: "GET", path: "/api/bridge/skills" }]);
  listening.close();
  assert.equal(lost.sockets[1]!.frames().length, 2);
  assert.deepEqual(heard, []);

  // The asking itself cannot be put on the socket.
  const mute = rig();
  void mute.fetch("/api/bridge/skills", asToken("T1"));
  mute.sockets[0]!.greet();
  mute.sockets[0]!.refuseSends = true;
  mute.listen("T1", hearing(heard, "mute")).close();
  assert.deepEqual(heard.splice(0), [["mute", "unavailable"]]);
  assert.equal(mute.sockets[0]!.frames().some((frame) => (frame as { events?: unknown }).events !== undefined), false);
});

test("a socket being listened on is not closed for having nothing asked on it; one let go on purpose tells its listener nothing", async () => {
  const page = rig({ warmUp: 0, idleMs: 1_000 });
  const heard: unknown[] = [];
  const listening = page.listen("T1", hearing(heard, "first"));
  const socket = page.sockets[0]!;
  socket.greet();
  socket.say({ events: { open: true, n: 1 } });
  // A long while with nothing asked on it, and then another session asks something: it is kept.
  page.clock += 60_000;
  void page.fetch("/api/bridge/skills", asToken("T2"));
  assert.equal(socket.closedByPage, false);
  // No longer listened on, and left as long again: closed like any other.
  listening.close();
  page.clock += 60_000;
  void page.fetch("/api/bridge/skills", asToken("T2"));
  assert.equal(socket.closedByPage, true);
  assert.deepEqual(heard, [["first", "open"]]);

  // Logged out on its socket: the socket is closed by the page, and the listener is not sent another way.
  const out = rig();
  out.listen("T1", hearing(heard, "out"));
  out.sockets[0]!.greet();
  out.sockets[0]!.say({ events: { open: true, n: 1 } });
  const gone = out.fetch("/api/logout", asToken("T1", { method: "POST", body: "{}" }));
  out.sockets[0]!.say({ id: 1, status: 200, body: { ok: true } });
  await gone;
  assert.equal(out.sockets[0]!.closedByPage, true);
  // The page closing every socket: the same.
  const all = rig();
  all.listen("T1", hearing(heard, "all"));
  all.sockets[0]!.greet();
  all.close();
  assert.deepEqual(heard.slice(1), [["out", "open"]]);
});
