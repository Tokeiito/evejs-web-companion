// The Character Sheet's reads, made by the page itself (bridge/characterSheetReads.ts; the plan's Phase 6b).
//
// What has to hold: the calls are the client's own, the character named where the client names it; each read
// fails by itself, and what is nobody's own failure fails the whole; the clone is the implants the skill handler
// answers, each in the slot the static data has for its type, asked once for a type.

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { ATTRIBUTE_IMPLANTNESS, createCharacterSheetReads, type TypeAttributes } from "./characterSheetReads.ts";
import { decodeCloneSummary } from "./characterSheet.ts";
import type { JsonValue } from "./wire.ts";

const failing = (code: string | undefined, more: Record<string, unknown> = {}): Error => Object.assign(new Error("it failed"), code === undefined ? more : { code, ...more });
const keyVal = (entries: readonly (readonly [string, JsonValue])[]): JsonValue => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: entries as unknown as JsonValue } });
const dict = (entries: readonly (readonly [JsonValue, JsonValue])[]): JsonValue => ({ type: "dict", entries: entries as unknown as JsonValue });

const PUBLIC: JsonValue = { type: "list", items: [keyVal([["characterID", 140000005], ["characterName", "Farmer"]])] };
const HOME: JsonValue = keyVal([["stationID", 60015249]]);
const IMPLANTS: JsonValue = dict([[1, keyVal([["typeID", 9941], ["itemID", 990000001]])], [2, keyVal([["typeID", 9899]])], [3, keyVal([["typeID", 9941]])]]);
const ANSWERS: Record<string, JsonValue> = { GetPublicInfo3: PUBLIC, GetCharacterDescription: "a bio", GetHomeStationRow: HOME, GetImplants: dict([]) };

/** An asking the test answers, with what was asked kept in order. */
function asking(answers: Record<string, JsonValue | (() => JsonValue)>): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  const ask: Ask = async (service, method, args) => {
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`);
    const answer = answers[method];
    return typeof answer === "function" ? answer() : (answer as JsonValue);
  };
  return { ask, asked };
}
/** The static data's attributes, with what was asked of it kept. */
function staticData(slots: Record<number, number>): { typeAttributes: TypeAttributes; asked: (readonly [readonly number[], readonly number[]])[] } {
  const asked: (readonly [readonly number[], readonly number[]])[] = [];
  return { asked, typeAttributes: async (typeIDs, attributeIDs) => { asked.push([typeIDs, attributeIDs]); return Object.fromEntries(typeIDs.map((typeID): [number, Record<number, number>] => [typeID, typeID in slots ? { [ATTRIBUTE_IMPLANTNESS]: slots[typeID] as number } : {}])); } };
}
const implantsOf = (reads: { cloneInfo: JsonValue }) => decodeCloneSummary(reads.cloneInfo)?.implants;

test("the sheet is read with the client's own calls: the character named where the client names it, the rest with nothing", async () => {
  const { ask, asked } = asking(ANSWERS);
  const statics = staticData({});
  const reads = await createCharacterSheetReads(ask, statics.typeAttributes).read({ characterID: 140000005 });
  assert.deepEqual(asked, ["charMgr.GetPublicInfo3(140000005)", "charMgr.GetCharacterDescription(140000005)", "charMgr.GetHomeStationRow()", "skillHandler.GetImplants()"]);
  assert.deepEqual([reads.publicInfo, reads.description, reads.homeStation, reads.errors], [PUBLIC, "a bio", HOME, { publicInfo: null, description: null, homeStation: null, cloneInfo: null }]);
  // No implants is a clean clone, a real answer, with nothing asked of the static data.
  assert.deepEqual([implantsOf(reads), statics.asked], [[], []]);
  // A read answered with nothing at all is an answer of nothing, and no failure.
  const nothing = await createCharacterSheetReads(asking({ GetImplants: dict([]) }).ask, statics.typeAttributes).read({ characterID: 140000005 });
  assert.deepEqual([nothing.publicInfo, nothing.description, nothing.homeStation, nothing.errors.publicInfo], [null, null, null, null]);
  // With nobody chosen there is no one to name.
  const nobody = asking(ANSWERS);
  await createCharacterSheetReads(nobody.ask, statics.typeAttributes).read({ characterID: null });
  assert.deepEqual(nobody.asked.slice(0, 2), ["charMgr.GetPublicInfo3()", "charMgr.GetCharacterDescription()"]);
});

test("the clone is the implants the skill handler answers, each in the slot the static data has for its type, under the server's own key", async () => {
  const { ask } = asking({ ...ANSWERS, GetImplants: IMPLANTS });
  const statics = staticData({ 9941: 1, 9899: 6 });
  const sheet = createCharacterSheetReads(ask, statics.typeAttributes);
  const reads = await sheet.read({ characterID: 140000005 });
  // In the form a clone is read in: a KeyVal of the implants, each a KeyVal of its type and its slot.
  assert.deepEqual(reads.cloneInfo, keyVal([["implants", dict([[1, keyVal([["typeID", 9941], ["slot", 1]])], [2, keyVal([["typeID", 9899], ["slot", 6]])], [3, keyVal([["typeID", 9941], ["slot", 1]])]])]]));
  assert.deepEqual(implantsOf(reads), [{ typeID: 9941, slot: 1 }, { typeID: 9941, slot: 1 }, { typeID: 9899, slot: 6 }]);
  // Each type asked for once, by the attribute the client sorts its implants by.
  assert.deepEqual([statics.asked, ATTRIBUTE_IMPLANTNESS], [[[[9941, 9899], [331]]], 331]);
  // Read again: nothing more is asked of the static data. With an implant of another type: that type alone.
  await sheet.read({ characterID: 140000005 });
  assert.equal(statics.asked.length, 1);
  const more = createCharacterSheetReads(asking({ ...ANSWERS, GetImplants: () => dict([[1, keyVal([["typeID", 9941]])], [4, keyVal([["typeID", 10212]])]]) }).ask, statics.typeAttributes);
  assert.deepEqual(implantsOf(await more.read({ characterID: 140000005 })), [{ typeID: 10212, slot: 0 }, { typeID: 9941, slot: 1 }]);
  // (Another reader's: it keeps its own. A type the static data has no slot for is in slot nought, as on the BFF.)
  assert.deepEqual(statics.asked[1], [[9941, 10212], [331]]);
});

test("an answer that is not implants is the clone's own failure, and never an empty clone", async () => {
  const statics = staticData({ 9941: 1 });
  // (Among them, what has entries and is no dict: it cannot come off the wire so, and is no implants if it does.)
  for (const answer of [null, "none", 0, [], { type: "list", items: [] }, { type: "dict" }, { type: "list", entries: [[1, keyVal([["typeID", 9941]])]] }, { entries: [] }, dict([[1, keyVal([["itemID", 5]])]]), dict([[1, keyVal([["typeID", 9941]])], [2, null]]), dict([[1, keyVal([["typeID", 0]])]]), dict([[1, keyVal([["typeID", "9941"]])]])] as unknown as JsonValue[]) {
    const reads = await createCharacterSheetReads(asking({ ...ANSWERS, GetImplants: answer }).ask, statics.typeAttributes).read({ characterID: 140000005 });
    assert.deepEqual([reads.cloneInfo, reads.errors.cloneInfo, reads.errors.publicInfo, reads.publicInfo], [null, "READ_FAILED", null, PUBLIC], JSON.stringify(answer));
  }
  // The static data not answering is the clone's failure too, with why; the implants' call was made.
  const down = failing("TOO_MANY_IDS");
  const reads = await createCharacterSheetReads(asking({ ...ANSWERS, GetImplants: IMPLANTS }).ask, async () => { throw down; }).read({ characterID: 140000005 });
  assert.deepEqual([reads.cloneInfo, reads.errors.cloneInfo, reads.description], [null, "TOO_MANY_IDS", "a bio"]);
});

test("each of the four fails by itself, with why; and what is nobody's own failure fails the whole sheet", async () => {
  const statics = staticData({});
  const one = (method: string, failure: unknown) => createCharacterSheetReads(asking({ ...ANSWERS, [method]: () => { throw failure; } }).ask, statics.typeAttributes).read({ characterID: 140000005 });
  const fields: Record<string, "publicInfo" | "description" | "homeStation" | "cloneInfo"> = { GetPublicInfo3: "publicInfo", GetCharacterDescription: "description", GetHomeStationRow: "homeStation", GetImplants: "cloneInfo" };
  for (const [method, field] of Object.entries(fields)) {
    const reads = await one(method, failing("CALL_REFUSED"));
    assert.deepEqual([reads[field], reads.errors], [null, { publicInfo: null, description: null, homeStation: null, cloneInfo: null, [field]: "CALL_REFUSED" }], method);
    // The other three are as answered.
    assert.equal(Object.values(fields).filter((other) => other !== field && reads[other] !== null).length, 3, method);
    assert.equal((await one(method, failing(undefined))).errors[field], "READ_FAILED", method);
    for (const lost of [failing("SESSION_NOT_FOUND"), failing("NO_LIVE_SESSION"), failing("BRIDGE_NETWORK_ERROR"), failing("SESSION_REQUEST_RETIRED"), failing("AUTH_REQUIRED", { status: 401 })]) {
      await assert.rejects(one(method, lost), (error) => error === lost, `${(lost as { code?: string }).code} at ${method}`);
    }
  }
  // The BFF not reached for the static data is nobody's own failure either.
  const unreached = failing("BRIDGE_NETWORK_ERROR");
  await assert.rejects(createCharacterSheetReads(asking({ ...ANSWERS, GetImplants: IMPLANTS }).ask, async () => { throw unreached; }).read({ characterID: 140000005 }), (error) => error === unreached);
});
