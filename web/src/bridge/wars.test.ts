// War-reads decoder (goal R66) against REAL captured bytes + the server's own
// populated builders.
//
// ⚠ Farmer's corp (98000001) is in NO war and none is seeded, so the LIVE captures
// through GET /api/bridge/wars on 2026-07-22 were the empty paths: GetWarsByOwnerID
// / GetTop50 returned a CachedMethodCallResult wrapping a CRowset with an EMPTY row
// list; GetWarsByOwners returned {98000001 -> {}}; GetWarsRequiringAssistance /
// GetWarsForStructure returned empty lists; GetPublicWarInfo returned null. Those
// real bytes are asserted below. The POPULATED CRowset + war KeyVal fixtures were
// generated with eve.js's OWN builders (buildDbRowset / buildWarRowset /
// buildWarPayload, .../corporation/warsInfoMgrService.js) and the gateway's
// BigInt->string serialization applied, so the populated paths are proven against
// the exact emitted wire shape, not a hand-guess.
//
// ⚠ R7d: every id (warID / declaredByID / againstID / retractedBy / billID /
// warHQ(ID) / allyID) survives as a numeric field; FILETIMEs are bigint-safe.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeWar,
  decodeWarList,
  decodeWarsByOwners,
  decodePublicWarInfo,
  decodeWarRows,
} from "./wars.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}

// The exact 17-column WAR descriptor captured live (blue.DBRowDescriptor).
const WAR_COLUMNS: JsonValue = [
  ["warID", 3], ["declaredByID", 3], ["againstID", 3], ["timeDeclared", 64],
  ["timeFinished", 64], ["retracted", 64], ["retractedBy", 3], ["timeStarted", 64],
  ["billID", 3], ["mutual", 11], ["createdFromWarID", 3], ["openForAllies", 11],
  ["canBeRetracted", 11], ["reasonEnded", 17], ["warHQ", 20], ["noOfAllies", 3],
  ["reasonStarted", 17],
];
const WAR_DESCRIPTOR: JsonValue = {
  type: "objectex1",
  header: [{ type: "token", value: "blue.DBRowDescriptor" }, [WAR_COLUMNS]],
  list: [],
  dict: [],
};

function cachedWarRowset(rows: JsonValue[]): JsonValue {
  return {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "15 minutes" }]] },
      {
        type: "substream",
        value: {
          type: "objectex2",
          header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", WAR_DESCRIPTOR]] }],
          list: rows,
          dict: [],
        },
      },
      { type: "list", items: [long("134292041127720000"), 552298015] },
    ],
  };
}

// REAL live bytes: GetWarsByOwnerID(98000001) — an empty CRowset.
const REAL_WAR_ROWSET_EMPTY: JsonValue = cachedWarRowset([]);

// POPULATED CRowset row (buildDbRowset positional packedrow), values from the
// eve.js-builder generator: war 42, corp 98000001 vs 98000006, mutual+open, 1 ally.
const POPULATED_WAR_ROW: JsonValue = {
  type: "packedrow",
  header: WAR_DESCRIPTOR,
  columns: WAR_COLUMNS,
  values: [42, 98000001, 98000006, long("134200000000000000"), null, null, null, long("134200864000000000"), 7001, 1, null, 1, 1, 0, 1030000000005, 1, 0],
};
const POPULATED_WAR_ROWSET: JsonValue = cachedWarRowset([POPULATED_WAR_ROW]);

// buildWarPayload KeyVal (GetWarsByOwners inner / GetPublicWarInfo shape).
const POPULATED_WAR_PAYLOAD: JsonValue = keyVal([
  ["warID", 42], ["declaredByID", 98000001], ["againstID", 98000006],
  ["warHQID", 1030000000005], ["warHQ", 1030000000005],
  ["timeDeclared", long("134200000000000000")], ["timeStarted", long("134200864000000000")],
  ["timeFinished", null], ["retracted", null], ["retractedBy", null], ["billID", 7001],
  ["mutual", 1], ["openForAllies", 1], ["createdFromWarID", null], ["reward", 50000000],
  ["allies", { type: "dict", entries: [[99000000, keyVal([["allyID", 99000000], ["timeStarted", long("134201000000000000")], ["timeFinished", null]])]] }],
]);

// REAL live bytes: GetWarsByOwners([98000001]) -> {98000001 -> {}} (empty inner).
const REAL_WARS_BY_OWNERS_EMPTY: JsonValue = {
  type: "dict",
  entries: [[98000001, { type: "dict", entries: [] }]],
};

// --- CRowset reads (decodeWarRows) -------------------------------------------

test("decodeWarRows on the REAL empty CRowset is [] (a real 'no wars')", () => {
  assert.deepEqual(decodeWarRows(REAL_WAR_ROWSET_EMPTY), []);
  assert.deepEqual(decodeWarRows(null), []);
});

test("decodeWarRows unwraps the cache + CRowset and decodes a populated positional row", () => {
  const rows = decodeWarRows(POPULATED_WAR_ROWSET);
  assert.equal(rows.length, 1);
  const w = rows[0]!;
  assert.equal(w.warID, 42);
  assert.equal(w.declaredByID, 98000001);
  assert.equal(w.againstID, 98000006);
  assert.equal(w.timeDeclared, 134200000000000000n);
  assert.equal(w.timeFinished, null);
  assert.equal(w.retracted, null);
  assert.equal(w.timeStarted, 134200864000000000n);
  assert.equal(w.billID, 7001);
  assert.equal(w.mutual, true);
  assert.equal(w.openForAllies, true);
  assert.equal(w.canBeRetracted, true);
  assert.equal(w.warHQ, 1030000000005);
  assert.equal(w.noOfAllies, 1);
  assert.equal(w.reasonEnded, 0);
  assert.equal(w.reasonStarted, 0);
});

test("decodeWarRows keeps warHQ exact (> 2^32) — R7d id survives", () => {
  const w = decodeWarRows(POPULATED_WAR_ROWSET)[0]!;
  assert.ok(w.warHQ! > 4294967296, "warHQ > 2^32");
  assert.equal(w.warHQ, 1030000000005);
});

// --- KeyVal reads (decodeWar / decodeWarList / decodePublicWarInfo) ----------

test("decodeWar decodes the buildWarPayload KeyVal, allies included", () => {
  const w = decodeWar(POPULATED_WAR_PAYLOAD)!;
  assert.equal(w.warID, 42);
  assert.equal(w.warHQID, 1030000000005);
  assert.equal(w.mutual, true);
  assert.equal(w.openForAllies, true);
  assert.equal(w.reward, "50000000");
  assert.equal(w.timeDeclared, 134200000000000000n);
  assert.equal(w.timeFinished, null);
  assert.equal(w.allies.length, 1);
  assert.deepEqual(w.allies[0], { allyID: 99000000, timeStarted: 134201000000000000n, timeFinished: null });
});

test("decodeWar returns null for a non-war / missing warID", () => {
  assert.equal(decodeWar(null), null);
  assert.equal(decodeWar(keyVal([["declaredByID", 1]])), null);
});

test("decodeWarList on a real empty list is [] (GetWarsRequiringAssistance/ForStructure)", () => {
  assert.deepEqual(decodeWarList({ type: "list", items: [] }), []);
});

test("decodeWarList decodes a list of war KeyVals", () => {
  const wars = decodeWarList({ type: "list", items: [POPULATED_WAR_PAYLOAD] });
  assert.equal(wars.length, 1);
  assert.equal(wars[0]!.warID, 42);
});

test("decodePublicWarInfo is null for an unknown warID (real state), a war otherwise", () => {
  assert.equal(decodePublicWarInfo(null), null);
  assert.equal(decodePublicWarInfo(POPULATED_WAR_PAYLOAD)!.warID, 42);
});

// --- GetWarsByOwners (decodeWarsByOwners) ------------------------------------

test("decodeWarsByOwners on the REAL empty-inner dict keeps the owner with no wars", () => {
  const byOwners = decodeWarsByOwners(REAL_WARS_BY_OWNERS_EMPTY);
  assert.equal(byOwners.length, 1);
  assert.deepEqual(byOwners[0], { ownerID: 98000001, wars: [] });
});

test("decodeWarsByOwners decodes owner -> war list from a populated dict", () => {
  const byOwners = decodeWarsByOwners({
    type: "dict",
    entries: [[98000001, { type: "dict", entries: [[42, POPULATED_WAR_PAYLOAD]] }]],
  });
  assert.equal(byOwners.length, 1);
  assert.equal(byOwners[0]!.ownerID, 98000001);
  assert.equal(byOwners[0]!.wars.length, 1);
  assert.equal(byOwners[0]!.wars[0]!.warID, 42);
});

// --- R7d id-sweep + its non-vacuous companion --------------------------------

function warIdFields(w: { warID: number; declaredByID: number; againstID: number; warHQ: number | null }): number[] {
  return [w.warID, w.declaredByID, w.againstID, ...(w.warHQ === null ? [] : [w.warHQ])];
}

test("R7d: a decoded war row preserves warID/declaredByID/againstID/warHQ as numbers", () => {
  const ids = warIdFields(decodeWarRows(POPULATED_WAR_ROWSET)[0]!);
  assert.ok(ids.includes(42), "warID preserved");
  assert.ok(ids.includes(98000001), "declaredByID preserved");
  assert.ok(ids.includes(98000006), "againstID preserved");
  assert.ok(ids.includes(1030000000005), "warHQ preserved");
});

test("the war id-field extractor actually reads the decoded content", () => {
  assert.deepEqual(warIdFields({ warID: 1, declaredByID: 2, againstID: 3, warHQ: 4 }), [1, 2, 3, 4]);
  assert.deepEqual(warIdFields({ warID: 1, declaredByID: 2, againstID: 3, warHQ: null }), [1, 2, 3]);
});
