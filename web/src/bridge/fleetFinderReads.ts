// The fleet finder's reads, made by whoever shows them (the plan's Phase 6b).
//
// Until 2026-10-11 the page asked one route of the BFF (GET /api/bridge/fleet-ads) and the route made the two
// calls together. A retail client has no such route: its fleet service asks
// (eve/client/script/parklife/fleetSvc.py). This is that asking, written once for the page and its bots, each
// call made by the generic call (bridge/ask.ts).
//
// THE CALLS, as the client makes them:
//
//   sm.ProxySvc('fleetProxy').GetAvailableFleetAds()     1891, GetFleetAdsForChar: the adverts open to this
//                                                        session, a dict of adverts by fleet. From the fleet
//                                                        finder's window and the Agency's (which keep the
//                                                        answer a while: Memoize(0.5)), and from a fleet's link.
//   sm.ProxySvc('fleetProxy').GetMyFleetFinderAdvert()   2394: the advert of the session's own fleet, or None.
//
// Nothing is sent with either. On Tranquility the first was recorded so, once, and the second not at all.
//
// THE FLEET'S OWN ADVERT IS ASKED FOR ONLY IN A FLEET. GetCurrentAdvertForMyFleet (1924) asks nothing where the
// session is in no fleet, nor where its fleet is not registered with the finder; the one other asker (949) is a
// fleet's boss changing. So here it is not asked for a pilot known to be in no fleet. Whether the fleet is
// registered is not looked at here: the server answers None for a fleet that is not.
//
// WHAT THE SERVER TAKES FROM THE CALLER: nothing. Each acts for the session, and refuses nothing.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import { failsTheReading, failureCode, type Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** The two answers as the server gave them, each with why it failed where it did (decoded in bridge/fleetAds.ts). */
export interface RawFleetFinderReads {
  /** The adverts open to the session. Null where the read failed: see `errors`. */
  readonly available: JsonValue;
  /** The advert of the pilot's own fleet. Null where there is none, where it was not asked for, and where the read failed. */
  readonly own: JsonValue;
  readonly errors: {
    readonly available: string | null;
    readonly own: string | null;
  };
}

/** The adverts open to this session, by themselves. Fails as the call fails. */
export function readAvailableFleetAds(ask: Ask): Promise<JsonValue> {
  return ask("fleetProxy", "GetAvailableFleetAds", []);
}

/**
 * The adverts open to this session and the advert of the pilot's own fleet, asked together and each failing by
 * itself. `inAFleet` is what the caller knows of the pilot: false where it is known to be in no fleet, and then
 * its own advert is not asked for. Fails as a whole only for what fails a whole reading (bridge/ask.ts).
 */
export async function readFleetFinder(ask: Ask, inAFleet: boolean | null): Promise<RawFleetFinderReads> {
  const [available, own] = await Promise.allSettled([
    readAvailableFleetAds(ask),
    inAFleet === false ? Promise.resolve<JsonValue>(null) : ask("fleetProxy", "GetMyFleetFinderAdvert", []),
  ]);
  for (const each of [available, own]) {
    if (each.status === "rejected" && failsTheReading(each.reason)) throw each.reason;
  }
  return {
    available: available.status === "fulfilled" ? available.value ?? null : null,
    own: own.status === "fulfilled" ? own.value ?? null : null,
    errors: {
      available: available.status === "rejected" ? failureCode(available.reason) : null,
      own: own.status === "rejected" ? failureCode(own.reason) : null,
    },
  };
}
