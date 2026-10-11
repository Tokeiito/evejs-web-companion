// The page's warp to a launch, and its exports to a customs office.
//
// (The read of a pilot's launches is the page's own call now, and is tested where it is: bridge/launchReads.test.ts.)

import test from "node:test";
import assert from "node:assert/strict";

import { exportToCustomsOffice, exportToCustomsOffices, warpToLaunch } from "./api.ts";

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
