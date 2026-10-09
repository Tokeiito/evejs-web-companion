// The page's read of a pilot's planet launches, and its warp to one.
//
// A server that could not put its answer on the wire answers the call with nothing at all (None). That is not
// "no launches": the list is a rowset even when it is empty. The read says so, so that a haul does not fly past
// a container it was never told about.

import test from "node:test";
import assert from "node:assert/strict";

import { exportToCustomsOffice, exportToCustomsOffices, getPiLaunches, warpToLaunch } from "./api.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function recordingFetch(reply: (path: string, method: string, body: unknown) => Response) {
  const requests: { path: string; method: string; body: unknown }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ path, method, body });
    return reply(path, method, body);
  }) as unknown as typeof fetch;
  return { fetch: fake, requests };
}

// The shape this server's gateway printed for a pilot with one launch (2026-10-09), with numbers made up.
const DESCRIPTOR = { type: "objectex1", header: [{ type: "token", value: "blue.DBRowDescriptor" }, [[["launchID", 3], ["solarSystemID", 3], ["itemID", 20], ["ownerID", 3], ["planetID", 3], ["status", 17], ["launchTime", 64], ["x", 5], ["y", 5], ["z", 5]]]], list: [], dict: [] };
const COLUMNS = [["launchID", 3], ["solarSystemID", 3], ["itemID", 20], ["ownerID", 3], ["planetID", 3], ["status", 17], ["launchTime", 64], ["x", 5], ["y", 5], ["z", 5]];
const rowset = (rows: unknown[][]) => ({
  type: "objectex2",
  header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", DESCRIPTOR]] }],
  list: rows.map((values) => ({ type: "packedrow", header: DESCRIPTOR, columns: COLUMNS, values })),
  dict: [],
});
const answer = (launches: unknown, errors: unknown = { colonies: null, launches: null }) => json({ ok: true, characterID: 90000001, colonies: rowset([]), launches, errors });

test("a pilot's launches are read off the rowset, and an empty rowset is no launches", async () => {
  const one = recordingFetch(() => answer(rowset([[1000001, 30000142, 9000000000123, 90000001, 40000001, 0, "134360000000000000", 1.5, 2.5, 3.5]])));
  const launches = await getPiLaunches({ fetch: one.fetch, token: "t" });
  assert.match(one.requests[0]!.path, /\/api\/bridge\/pi-colonies$/);
  assert.deepEqual(launches.map((launch) => [launch.launchID, launch.solarSystemID, launch.itemID, launch.planetID, launch.x, launch.y, launch.z]), [[1000001, 30000142, 9000000000123, 40000001, 1.5, 2.5, 3.5]]);
  const none = recordingFetch(() => answer(rowset([])));
  assert.deepEqual(await getPiLaunches({ fetch: none.fetch, token: "t" }), []);
});

test("a launches read the server answered with nothing is unread, not no launches", async () => {
  const unanswered = recordingFetch(() => answer(null));
  await assert.rejects(getPiLaunches({ fetch: unanswered.fetch, token: "t" }), /could not be read/);
  // As a read that failed outright always was.
  const failed = recordingFetch(() => answer(null, { colonies: null, launches: "CALL_FAILED" }));
  await assert.rejects(getPiLaunches({ fetch: failed.fetch, token: "t" }), /could not be read \(CALL_FAILED\)/);
});

test("warpToLaunch posts the launch's ID and nothing else", async () => {
  const { fetch, requests } = recordingFetch(() => json({ ok: true, result: null, flight: { solarSystemID: 30000142 }, notifications: [] }));
  await warpToLaunch(1000001, { fetch, token: "t" });
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.path, /\/api\/bridge\/flight\/warp-launch$/);
  assert.equal(requests[0]!.method, "POST");
  assert.deepEqual(requests[0]!.body, { launchID: 1000001 });
});

test("exportToCustomsOffice posts the office, the launchpad, the goods and the confirmation", async () => {
  const { fetch, requests } = recordingFetch(() => json({ ok: true, applied: true, taxRate: 0.05, result: null, notifications: [] }));
  await exportToCustomsOffice(1200040176368, 1054656331535, { 2268: 200, 2073: 50 }, { fetch, token: "t" });
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.path, /\/api\/bridge\/planet\/customs\/export$/);
  assert.equal(requests[0]!.method, "POST");
  assert.deepEqual(requests[0]!.body, { officeID: 1200040176368, pinID: 1054656331535, commodities: { 2268: 200, 2073: 50 }, confirm: true });
});

test("the export before a haul says when the run itself will send the launchpads up, at the offices", async () => {
  const told = recordingFetch(() => json({ ok: true, characterID: 90000001, connected: false, handedBack: null, atTheOffices: true, planets: [
    { planetID: 40000001, planetName: "Alpha II", solarSystemID: 30000001, solarSystemName: "Alpha", officeID: null, exported: false, units: 0, reason: "at-the-office", message: null },
  ] }));
  const result = await exportToCustomsOffices(90000001, [40000001], { fetch: told.fetch, token: "t" });
  assert.deepEqual([result.atTheOffices, result.connected, result.planets[0]!.reason], [true, false, "at-the-office"]);
  // An answer that does not say so is the old way's.
  const old = recordingFetch(() => json({ ok: true, connected: true, handedBack: null, planets: [] }));
  assert.equal((await exportToCustomsOffices(90000001, [40000001], { fetch: old.fetch, token: "t" })).atTheOffices, false);
});
