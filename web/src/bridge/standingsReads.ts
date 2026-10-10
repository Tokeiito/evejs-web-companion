// The standings' reads, made by whoever shows them (the plan's Phase 6b).
//
// Until 2026-10-10 the page asked one route of the BFF (GET /api/bridge/standings)
// and the route made the calls: the character's standings and its corporation's,
// and, for an entity opened, both its history and its composition. A retail
// client has no such route. Its standings service asks
// (eve/client/script/ui/services/standingsvc.py), and its standings panel asks
// that service for the one thing the row it has open wants
// (ui/shared/neocom/charsheet/standingsPanel/standingsPanel.py). This is that
// asking, written once for the page and the hosted bots, each call made by the
// generic call (bridge/ask.ts).
//
// THE CALLS, as the client makes them:
//
//   standingMgr.GetCharStandings()                    standingsvc.py 119, 124
//   standingMgr.GetCorpStandings()                    126: not for a pilot in an NPC corporation, whose
//                                                     corporation's standings are none (118)
//   standingMgr.GetStandingTransactions(fromID, toID) 178: an entity's history with the character
//   standingMgr.GetStandingCompositions(fromID, toID) 283: an entity's standing with the corporation, by member
//
// The panel asks for the history where the row is the character's and for the
// composition where it is the corporation's (standingsPanel.py 86): one of the
// two, never both. On Tranquility the first two are asked with nothing at every
// login, and one composition was recorded: GetStandingCompositions(500001, the
// corporation).
//
// WHAT IS KEPT. The client asks for the two lists when the character is chosen
// and keeps them right from the server's notices. So does the transport on the
// game port, which answers these two from what it keeps and sends nothing
// (src/gamePort/pilots.js); and the page works OnStandingSet and
// OnStandingsModified into the lists it holds (app/flow.ts). An entity's history
// is kept by the client until its standing changes; here it is asked for each
// time its row is opened.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import { failsTheReading, failureCode, type Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** The pilot and its corporation, as the session has them. */
export interface Whose {
  readonly characterID: number | null;
  readonly corporationID: number | null;
}

/** The two lists as the server answered them, each with why it failed where it did (decoded in bridge/standings.ts). */
export interface RawStandingsReads {
  readonly char: JsonValue;
  /** Null where it was not asked for: an NPC corporation's standings are none. */
  readonly corp: JsonValue;
  readonly errors: {
    readonly char: string | null;
    readonly corp: string | null;
  };
}

/**
 * idCheckers.IsNPC of a corporation: above the system's own items and below the players'. A corporation that is
 * not known is not taken for one.
 */
export function isNpcCorporation(corporationID: number | null): boolean {
  return corporationID !== null && corporationID > 10_000 && corporationID < 90_000_000;
}

/**
 * The character's standings and its corporation's, asked together and each failing by itself. Fails as a whole
 * only for what fails a whole reading (bridge/ask.ts): the pilot gone, or the BFF not reached.
 */
export async function readStandings(ask: Ask, whose: Whose): Promise<RawStandingsReads> {
  const [char, corp] = await Promise.allSettled([
    ask("standingMgr", "GetCharStandings", []),
    // standingsvc.py 118: `self.npccorpstandings = {}`, with nothing asked.
    isNpcCorporation(whose.corporationID) ? Promise.resolve<JsonValue>(null) : ask("standingMgr", "GetCorpStandings", []),
  ]);
  for (const each of [char, corp]) {
    if (each.status === "rejected" && failsTheReading(each.reason)) throw each.reason;
  }
  return {
    char: char.status === "fulfilled" ? char.value ?? null : null,
    corp: corp.status === "fulfilled" ? corp.value ?? null : null,
    errors: {
      char: char.status === "rejected" ? failureCode(char.reason) : null,
      corp: corp.status === "rejected" ? failureCode(corp.reason) : null,
    },
  };
}

/** An entity's history with the character: what changed the standing, and when. Fails as the call fails. */
export function standingHistory(ask: Ask, fromID: number, characterID: number): Promise<JsonValue> {
  return ask("standingMgr", "GetStandingTransactions", [fromID, characterID]);
}

/** An entity's standing with the corporation, member by member. Fails as the call fails. */
export function standingComposition(ask: Ask, fromID: number, corporationID: number): Promise<JsonValue> {
  return ask("standingMgr", "GetStandingCompositions", [fromID, corporationID]);
}
