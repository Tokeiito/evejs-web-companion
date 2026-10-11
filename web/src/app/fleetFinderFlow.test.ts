// The fleet finder read by the page itself (the plan's Phase 6b), through the real flow over a faked BFF.
//
// Until 2026-10-11 the Companions window's read of the finder was one route's (GET /api/bridge/fleet-ads). It is
// the client's fleet service's two calls now (bridge/fleetFinderReads.ts), each a pilot's read by the generic
// call, and never that route.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const FLEET = 654500010000;
const dict = (entries: readonly (readonly [unknown, unknown])[]): unknown => ({ type: "dict", entries });
const advert = (fields: Record<string, unknown>): unknown => dict(Object.entries(fields));
/** The listing: the one fleet, and an advert with no fleet's number, which is nobody's to join. */
const LISTING = dict([[FLEET, advert({ fleetID: FLEET, fleetName: "Mining Op", numMembers: 3 })], [0, advert({ fleetName: "Nobody's", numMembers: 1 })]]);
const OWN = advert({ fleetID: FLEET, fleetName: "Mining Op", numMembers: 3 });

type Answer = { readonly status: number; readonly body: unknown };
const answered = (method: string, result: unknown): Answer => ({ status: 200, body: { ok: true, service: "fleetProxy", method, result, notifications: [] } });
const refused = (error: string, status = 409): Answer => ({ status, body: { ok: false, error, message: error } });

/** A flow for a pilot online, over a BFF that answers the finder's two calls as it is told to. */
function harness(answers: { ads?: Answer; own?: Answer } = {}) {
  const store = createClientStore();
  store.apply({ type: "character/online", character: {
    characterID: 140000005, characterName: "Test", stationID: 60003760,
    structureID: null, solarSystemID: 30000142, corporationID: 98000000,
  }, station: null });
  const calls: Record<string, unknown>[] = [];
  let route = 0;
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let answer: Answer = { status: 200, body: { ok: true } };
    if (path === "/api/bridge/fleet-ads") {
      // The route, which nothing is to ask: it would name another fleet.
      route += 1;
      answer = { status: 200, body: { ok: true, availableFleetAds: dict([[7, advert({ fleetID: 7, fleetName: "The route's", numMembers: 9 })]]), myFleetFinderAdvert: advert({ fleetName: "The route's" }), errors: {} } };
    }
    if (path === "/api/bridge/call" && body.service === "fleetProxy") {
      calls.push(body);
      if (body.method === "GetAvailableFleetAds") answer = answers.ads ?? answered("GetAvailableFleetAds", LISTING);
      if (body.method === "GetMyFleetFinderAdvert") answer = answers.own ?? answered("GetMyFleetFinderAdvert", OWN);
    }
    return Response.json(answer.body, { status: answer.status });
  } });
  return { store, flow, calls, routeAsked: () => route };
}

// fleetSvc.py 1891 and 2394: sm.ProxySvc('fleetProxy').GetAvailableFleetAds() and .GetMyFleetFinderAdvert(), as a pilot's reads.
const AVAILABLE = { service: "fleetProxy", method: "GetAvailableFleetAds", args: [], kwargs: null, pilot: true };
const MINE = { service: "fleetProxy", method: "GetMyFleetFinderAdvert", args: [], kwargs: null, pilot: true };
const ROW = { fleetID: FLEET, fleetName: "Mining Op", numMembers: 3 };

test("the finder is read by the page's own two calls, and never by its route", async () => {
  for (const inAFleet of [true, null, undefined]) {
    const { flow, calls, routeAsked } = harness();
    assert.deepEqual(await flow.readFleetFinder(inAFleet), { ads: [ROW], ownFleetName: "Mining Op" }, String(inAFleet));
    assert.deepEqual(calls, [AVAILABLE, MINE], String(inAFleet));
    assert.equal(routeAsked(), 0);
  }
});

test("for a pilot its window knows to be in no fleet, the adverts alone are asked for", async () => {
  const { flow, calls, routeAsked } = harness();
  assert.deepEqual(await flow.readFleetFinder(false), { ads: [ROW], ownFleetName: null });
  assert.deepEqual(calls, [AVAILABLE]);
  assert.equal(routeAsked(), 0);
});

test("a listing that could not be read is not a listing of nobody; each of the two is read by itself", async () => {
  // The route answered a failed listing as an empty one, which a watcher takes for "nobody is advertising".
  const noAds = harness({ ads: refused("CALL_REFUSED") });
  assert.deepEqual(await noAds.flow.readFleetFinder(true), { ads: null, ownFleetName: "Mining Op" });
  const noOwn = harness({ own: refused("CALL_FAILED", 502) });
  assert.deepEqual(await noOwn.flow.readFleetFinder(true), { ads: [ROW], ownFleetName: null });
  // Nobody advertising, read as it is; and a fleet of the pilot's with no advert, or one with no name.
  const nobody = harness({ ads: answered("GetAvailableFleetAds", dict([])), own: answered("GetMyFleetFinderAdvert", null) });
  assert.deepEqual(await nobody.flow.readFleetFinder(true), { ads: [], ownFleetName: null });
  const unnamed = harness({ own: answered("GetMyFleetFinderAdvert", advert({ fleetID: FLEET, fleetName: "  " })) });
  assert.deepEqual(await unnamed.flow.readFleetFinder(true), { ads: [ROW], ownFleetName: null });
});

test("a pilot whose session is gone is put offline, and the read says nothing of any fleet", async () => {
  for (const which of ["ads", "own"] as const) {
    const { store, flow } = harness({ [which]: refused("SESSION_NOT_FOUND", 404) });
    assert.notEqual(store.get().station.online, null);
    assert.deepEqual(await flow.readFleetFinder(true), { ads: null, ownFleetName: null }, which);
    assert.equal(store.get().station.online, null, which);
  }
  // The BFF not reached: nothing is said, and the pilot is not put offline for it.
  const store = createClientStore();
  store.apply({ type: "character/online", character: { characterID: 140000005, characterName: "Test", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 98000000 }, station: null });
  const flow = createAppFlow(store, { livePush: false, fetch: async () => { throw new TypeError("fetch failed"); } });
  assert.deepEqual(await flow.readFleetFinder(true), { ads: null, ownFleetName: null });
  assert.notEqual(store.get().station.online, null);
});
