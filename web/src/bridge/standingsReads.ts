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
import { readDictPairs, readKeyVal, readRowsetRows, unwrapLong, type JsonValue } from "./wire.ts";

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

/** One NPC's standing with another (standingMgr.GetNPCNPCStandings' row). */
export interface NpcNpcStanding {
  readonly fromID: number;
  readonly toID: number;
  readonly standing: number;
}

/**
 * The NPCs' standings with each other, as the client's standing service keeps them (standingsvc.py 115:
 * GetNPCNPCStandings, no arguments; npcnpcstandingsfrom). Fails as the call fails.
 */
export async function readNpcNpcStandings(ask: Ask): Promise<readonly NpcNpcStanding[]> {
  const rows: NpcNpcStanding[] = [];
  for (const row of readRowsetRows(await ask("standingMgr", "GetNPCNPCStandings", []))) {
    const fromID = Number(unwrapLong(row.fromID ?? null) ?? 0);
    const toID = Number(unwrapLong(row.toID ?? null) ?? 0);
    const standing = typeof row.standing === "number" ? row.standing : Number((row.standing as { value?: unknown } | null)?.value);
    if (fromID > 0 && toID > 0 && Number.isFinite(standing)) rows.push({ fromID, toID, standing });
  }
  return rows;
}

/** The address book's standings (addressbook.GetContacts): the pilot's contacts', its corporation's and its alliance's, by the contact. */
export interface ContactStandings {
  readonly personal: ReadonlyMap<number, number>;
  readonly corporate: ReadonlyMap<number, number>;
  readonly alliance: ReadonlyMap<number, number>;
}

/** A dict of contacts, each a KeyVal (contactID, relationshipID, labelMask) by its number: each one's standing. */
export function relationshipsOf(answer: JsonValue): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, row] of readDictPairs(answer)) {
    const contactID = Number(key);
    const relationship = Number(readKeyVal(row, "relationshipID") ?? Number.NaN);
    if (contactID > 0 && Number.isFinite(relationship)) out.set(contactID, relationship);
  }
  return out;
}

/** A util.Row's field by its column (its header and its line). */
function rowField(row: JsonValue, name: string): JsonValue | undefined {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return undefined;
  const args = (row as { args?: { entries?: unknown } }).args;
  const entries = Array.isArray(args?.entries) ? (args.entries as readonly unknown[]) : [];
  const listed = (key: string): readonly JsonValue[] => {
    const entry = entries.find((each) => Array.isArray(each) && each[0] === key) as readonly [string, { items?: JsonValue[] }] | undefined;
    return Array.isArray(entry?.[1]?.items) ? entry[1].items : [];
  };
  const at = listed("header").indexOf(name);
  return at < 0 ? undefined : listed("line")[at];
}

/** A character's corporation, by its public row (charMgr.GetPublicInfo, panelStandings 120). Fails as the call fails. */
export async function characterCorporationOf(ask: Ask, characterID: number): Promise<number | null> {
  const corporationID = Number(unwrapLong(readKeyVal(await ask("charMgr", "GetPublicInfo", [characterID]), "corporationID") ?? null) ?? 0);
  return corporationID > 0 ? corporationID : null;
}

/** A corporation's alliance, by its row (corp.GetCorporation: corpmgr.GetCorporations(corpid)). Fails as the call fails. */
export async function corporationAllianceOf(ask: Ask, corporationID: number): Promise<number | null> {
  const allianceID = Number(unwrapLong(rowField(await ask("corpmgr", "GetCorporations", [corporationID]), "allianceID") ?? null) ?? 0);
  return allianceID > 0 ? allianceID : null;
}

/** An entity's history with the character: what changed the standing, and when. Fails as the call fails. */
export function standingHistory(ask: Ask, fromID: number, characterID: number): Promise<JsonValue> {
  return ask("standingMgr", "GetStandingTransactions", [fromID, characterID]);
}

/** An entity's standing with the corporation, member by member. Fails as the call fails. */
export function standingComposition(ask: Ask, fromID: number, corporationID: number): Promise<JsonValue> {
  return ask("standingMgr", "GetStandingCompositions", [fromID, corporationID]);
}
