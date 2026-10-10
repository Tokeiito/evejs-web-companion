// The Character Sheet's reads, made by whoever shows it (the plan's Phase 6b).
//
// Until 2026-10-10 the page asked one route of the BFF
// (GET /api/bridge/character-sheet) and the route made four calls. A retail
// client has no such route: its windows ask. This is that asking, each call
// made by the generic call (ask.ts), the same on either transport.
//
// THE CALLS, as the client makes them:
//
//   charMgr.GetPublicInfo3(characterID)           characterInfoWindow.py 194: the character named
//   charMgr.GetCharacterDescription(characterID)  charsheet/bioPanel.py 28: session.charid
//   charMgr.GetHomeStationRow()                   neocom/charactersheet.py 59: the character sheet's service,
//                                                 with nothing, kept by it until the session is reset
//   skillHandler.GetImplants()                    skillsvc.py 967: the implants in the pilot's head, which the
//                                                 sheet lists (charsheet/implantsBoostersPanel.py 40)
//
// THE CLONE. The client's sheet lists the implants its skill handler answers,
// each in the slot its type's own attribute says (implantsBoostersPanel.py 43:
// dogma attribute 331, which the client has from its install). It never asks
// charMgr.GetCloneInfo, which the route asked through the web gateway, so the
// jump clones' count and the clone's station, which only that call says, are
// not said here on either transport. A type's slot is asked of the BFF's static
// data, once for a type.
//
// NOT AS THE CLIENT YET. The client's own sheet shows the home station from
// another service of the server's, RemoteSvc('home_station').get_home_station()
// (homestation/client/service.py; characterOverviewElements.py 88), kept until
// the server says it changed. GetHomeStationRow is the call its map and its
// market quote read the home station by. Nothing carries the first yet.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import { failsTheReading, failureCode, type Ask } from "./ask.ts";
import { readRowField, type JsonValue } from "./wire.ts";

/** dogma/const.py attributeImplantness: the slot an implant's type goes in. */
export const ATTRIBUTE_IMPLANTNESS = 331;

/** The four reads as answered, each with why it failed where it did (decoded in bridge/characterSheet.ts). */
export interface RawCharacterSheetReads {
  readonly publicInfo: JsonValue;
  readonly description: JsonValue;
  readonly homeStation: JsonValue;
  /** The implants in the pilot's head, in the form a clone is read in: a KeyVal of `implants`, each with its type and slot. */
  readonly cloneInfo: JsonValue;
  readonly errors: {
    readonly publicInfo: string | null;
    readonly description: string | null;
    readonly homeStation: string | null;
    readonly cloneInfo: string | null;
  };
}

/** Whose sheet it is. With nobody chosen there is no one to name, and the BFF says there is no pilot. */
export interface CharacterSheetOf {
  readonly characterID: number | null;
}

/** A type's attributes by their IDs, from the BFF's static data (POST /api/types/dogma). */
export type TypeAttributes = (typeIDs: readonly number[], attributeIDs: readonly number[]) => Promise<Readonly<Record<number, Readonly<Record<number, number>>>>>;

const keyVal = (entries: readonly (readonly [string, JsonValue])[]): JsonValue =>
  ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: entries as unknown as JsonValue } });
/** (A failure with no code of its own is READ_FAILED: ask.ts.) */
const notRead = (): Error => new Error("The implants were not answered as implants.");

/** The reads, with what is known of an implant's type kept: a type does not change. */
export function createCharacterSheetReads(ask: Ask, typeAttributes: TypeAttributes): { read(whose: CharacterSheetOf): Promise<RawCharacterSheetReads> } {
  /** An implant type's slot, as the static data has it. Nought for a type it has none for. */
  const slots = new Map<number, number>();

  /**
   * What the sheet reads of the pilot's clone, from what the client's own lists: each implant known by its type
   * and put in the slot its type's attribute says, under the key the server gave it. Fails where the answer is
   * not a dict of things with a type: none at all would say the pilot's head is empty.
   */
  async function cloneOfImplants(answered: JsonValue): Promise<JsonValue> {
    const entries = answered !== null && typeof answered === "object" && (answered as { type?: unknown }).type === "dict" ? (answered as { entries?: unknown }).entries : null;
    if (!Array.isArray(entries)) throw notRead();
    const implants: (readonly [JsonValue, number])[] = [];
    for (const entry of entries as readonly (readonly JsonValue[])[]) {
      // (A type's ID is a number; what has none, or has something else there, is no implant.)
      const typeID = readRowField(entry[1], "typeID");
      if (typeof typeID !== "number" || !(typeID > 0)) throw notRead();
      implants.push([entry[0] as JsonValue, typeID]);
    }
    const unknown = [...new Set(implants.map(([, typeID]) => typeID))].filter((typeID) => !slots.has(typeID));
    if (unknown.length > 0) {
      const answeredFor = await typeAttributes(unknown, [ATTRIBUTE_IMPLANTNESS]);
      for (const typeID of unknown) slots.set(typeID, answeredFor[typeID]?.[ATTRIBUTE_IMPLANTNESS] ?? 0);
    }
    return keyVal([["implants", { type: "dict", entries: implants.map(([key, typeID]) => [key, keyVal([["typeID", typeID], ["slot", slots.get(typeID) ?? 0]])]) } as unknown as JsonValue]]);
  }

  return {
    /**
     * The four reads, asked together and each failing by itself. Fails as a whole only for what fails a whole
     * reading (ask.ts): the pilot gone, or the BFF not reached.
     */
    async read(whose) {
      const named: readonly JsonValue[] = whose.characterID === null ? [] : [whose.characterID];
      const reads = await Promise.allSettled([
        ask("charMgr", "GetPublicInfo3", named),
        ask("charMgr", "GetCharacterDescription", named),
        ask("charMgr", "GetHomeStationRow", []),
        ask("skillHandler", "GetImplants", []).then(cloneOfImplants),
      ]);
      for (const each of reads) {
        if (each.status === "rejected" && failsTheReading(each.reason)) throw each.reason;
      }
      const value = (at: number): JsonValue => { const each = reads[at]!; return each.status === "fulfilled" ? each.value ?? null : null; };
      const why = (at: number): string | null => { const each = reads[at]!; return each.status === "rejected" ? failureCode(each.reason) : null; };
      return {
        publicInfo: value(0),
        description: value(1),
        homeStation: value(2),
        cloneInfo: value(3),
        errors: { publicInfo: why(0), description: why(1), homeStation: why(2), cloneInfo: why(3) },
      };
    },
  };
}
