// The fleet finder's two reads, made by whoever shows them: each call as the client makes it, which of them is
// asked for whom, and how each fails.

import test from "node:test";
import assert from "node:assert/strict";

import { readAvailableFleetAds, readFleetFinder } from "./fleetFinderReads.ts";
import type { JsonValue } from "./wire.ts";

const ADS: JsonValue = { type: "dict", entries: [[654500010000, { type: "dict", entries: [["fleetName", "Mining Op"]] }]] };
const OWN: JsonValue = { type: "dict", entries: [["fleetName", "Mining Op"]] };

/** An asker that answers each method with what it is given, or fails it with the reason it is given. */
function asker(answers: Record<string, JsonValue | Error>) {
  const asked: unknown[] = [];
  const ask = async (service: string, method: string, args: readonly JsonValue[], kwargs?: unknown, of?: unknown) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    const answer = answers[method];
    if (answer instanceof Error) throw answer;
    return answer ?? null;
  };
  return { ask, asked };
}
const failing = (code: string, more: Record<string, unknown> = {}) => Object.assign(new Error(code), { code, ...more });

// fleetSvc.py 1891: sm.ProxySvc('fleetProxy').GetAvailableFleetAds(). 2394: sm.ProxySvc('fleetProxy').GetMyFleetFinderAdvert().
const AVAILABLE = ["fleetProxy", "GetAvailableFleetAds", [], null, null];
const MINE = ["fleetProxy", "GetMyFleetFinderAdvert", [], null, null];

test("the adverts are asked for with nothing, and the fleet's own advert too for a pilot in a fleet", async () => {
  for (const inAFleet of [true, null]) {
    const { ask, asked } = asker({ GetAvailableFleetAds: ADS, GetMyFleetFinderAdvert: OWN });
    assert.deepEqual(await readFleetFinder(ask, inAFleet), { available: ADS, own: OWN, errors: { available: null, own: null } }, String(inAFleet));
    assert.deepEqual(asked, [AVAILABLE, MINE], String(inAFleet));
  }
});

test("for a pilot known to be in no fleet the adverts alone are asked for: the client asks for its fleet's advert only in a fleet", async () => {
  // GetCurrentAdvertForMyFleet (1924): `if session.fleetid is None or not self.options.isRegistered: return`.
  const { ask, asked } = asker({ GetAvailableFleetAds: ADS, GetMyFleetFinderAdvert: OWN });
  assert.deepEqual(await readFleetFinder(ask, false), { available: ADS, own: null, errors: { available: null, own: null } });
  assert.deepEqual(asked, [AVAILABLE]);
});

test("each of the two fails by itself, and says why", async () => {
  const noAds = asker({ GetAvailableFleetAds: failing("CALL_REFUSED"), GetMyFleetFinderAdvert: OWN });
  assert.deepEqual(await readFleetFinder(noAds.ask, true), { available: null, own: OWN, errors: { available: "CALL_REFUSED", own: null } });
  assert.deepEqual(noAds.asked, [AVAILABLE, MINE]);
  const noOwn = asker({ GetAvailableFleetAds: ADS, GetMyFleetFinderAdvert: failing("CALL_FAILED") });
  assert.deepEqual(await readFleetFinder(noOwn.ask, true), { available: ADS, own: null, errors: { available: null, own: "CALL_FAILED" } });
  // An answer of nothing is nothing, and no failure: a pilot in a fleet that is not advertised.
  const none = asker({ GetAvailableFleetAds: { type: "dict", entries: [] } });
  assert.deepEqual(await readFleetFinder(none.ask, true), { available: { type: "dict", entries: [] }, own: null, errors: { available: null, own: null } });
});

test("what fails a whole reading fails this one: the pilot gone, the BFF not reached, the web session not known", async () => {
  for (const [method, reason] of [
    ["GetAvailableFleetAds", failing("SESSION_NOT_FOUND")], ["GetMyFleetFinderAdvert", failing("SESSION_NOT_FOUND")],
    ["GetAvailableFleetAds", failing("BRIDGE_NETWORK_ERROR")], ["GetMyFleetFinderAdvert", failing("AUTH_REQUIRED", { status: 401 })],
  ] as const) {
    const { ask } = asker({ GetAvailableFleetAds: ADS, GetMyFleetFinderAdvert: OWN, [method]: reason });
    await assert.rejects(readFleetFinder(ask, true), (error) => error === reason, `${method} ${reason.message}`);
  }
});

test("the adverts by themselves are the one call, and fail as it fails", async () => {
  const { ask, asked } = asker({ GetAvailableFleetAds: ADS });
  assert.equal(await readAvailableFleetAds(ask), ADS);
  assert.deepEqual(asked, [AVAILABLE]);
  const refused = failing("CALL_REFUSED");
  await assert.rejects(readAvailableFleetAds(asker({ GetAvailableFleetAds: refused }).ask), (error) => error === refused);
});
