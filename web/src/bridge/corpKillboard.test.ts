// R82 corpRegistry killboard decoder against REAL captured shapes.
//
// Fixtures mirror the EXACT retail shape the server emits (buildKillmailRows -> buildDbRowset
// CRowset, wrapped by buildCachedResult -> CachedMethodCallResult(substream)), reconciled with
// bytes captured live through /api/bridge/call on 2026-07-22 as Farmer (character 140000005,
// corp 98000001). GetRecentKills returned 127 rows; row0 is reproduced verbatim below.
// GetRecentLosses returned 0 rows (a real empty board) — the empty path is asserted.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeCorpKillboard } from "./corpKillboard.ts";
import type { JsonValue } from "./wire.ts";

const KILLMAIL_COLUMNS = [
  ["killID", 3], ["solarSystemID", 3], ["victimCharacterID", 3], ["victimCorporationID", 3],
  ["victimAllianceID", 3], ["victimFactionID", 3], ["victimShipTypeID", 3], ["finalCharacterID", 3],
  ["finalCorporationID", 3], ["finalAllianceID", 3], ["finalFactionID", 3], ["finalShipTypeID", 3],
  ["finalWeaponTypeID", 3], ["killBlob", 130], ["killTime", 64], ["victimDamageTaken", 3],
  ["finalSecurityStatus", 5], ["finalDamageDone", 3], ["moonID", 3], ["warID", 3],
  ["iskLost", 6], ["bountyClaimed", 6], ["loyaltyPoints", 3], ["iskDestroyed", 6],
  ["killRightSupplied", 3],
];

// A CachedMethodCallResult wrapping (substream) an objectex2 CRowset of positional packedrows.
function killboardCached(rows: readonly (readonly JsonValue[])[]): JsonValue {
  const crowset = {
    type: "objectex2",
    header: [
      [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
      { type: "dict", entries: [] },
    ],
    list: rows.map((values) => ({
      type: "packedrow",
      columns: KILLMAIL_COLUMNS,
      values: [...values],
    })),
    dict: [],
  };
  return {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [["versionCheck", "15 minutes"]] },
      { type: "substream", value: crowset },
      null,
    ],
  } as unknown as JsonValue;
}

// Row 0 of Farmer's GetRecentKills, captured verbatim (positional, in column order).
const ROW0: readonly JsonValue[] = [
  181, 30000144, null, 1000127, null, 500010, 21980, 140000005, 98000001, null, 500001, 2488, 2488,
  "<attackers></attackers><items></items>",
  { type: "long", value: "134291482594690000" },
  551, 0.1392, 551, null, null, 0, 10000, 0, 0, null,
];

test("GetRecentKills decodes a killmail row with ids as data + FILETIME as a string", () => {
  const rows = decodeCorpKillboard(killboardCached([ROW0]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    killID: 181,
    solarSystemID: 30000144,
    victimCharacterID: null,
    victimCorporationID: 1000127,
    victimAllianceID: null,
    victimFactionID: 500010,
    victimShipTypeID: 21980,
    finalCharacterID: 140000005,
    finalCorporationID: 98000001,
    finalAllianceID: null,
    finalFactionID: 500001,
    finalShipTypeID: 2488,
    finalWeaponTypeID: 2488,
    killBlob: "<attackers></attackers><items></items>",
    killTime: "134291482594690000",
    victimDamageTaken: 551,
    finalSecurityStatus: 0.1392,
    finalDamageDone: 551,
    moonID: null,
    warID: null,
    iskLost: 0,
    bountyClaimed: 10000,
    loyaltyPoints: 0,
    iskDestroyed: 0,
    killRightSupplied: null,
  });
});

test("GetRecentKills keeps a FILETIME that exceeds 2^53 exact (string, no precision loss)", () => {
  const big = "134291482594690001"; // > Number.MAX_SAFE_INTEGER
  const row: JsonValue[] = [...ROW0];
  row[14] = { type: "long", value: big };
  const rows = decodeCorpKillboard(killboardCached([row]));
  assert.equal(rows[0]!.killTime, big);
});

test("GetRecentKills preserves multiple rows in wire order", () => {
  const second: JsonValue[] = [...ROW0];
  second[0] = 182;
  const rows = decodeCorpKillboard(killboardCached([ROW0, second]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.killID, 181);
  assert.equal(rows[1]!.killID, 182);
});

test("GetRecentLosses returns [] for a real empty board", () => {
  // Captured live: Farmer's corp has 0 recorded losses.
  assert.deepEqual(decodeCorpKillboard(killboardCached([])), []);
  assert.deepEqual(decodeCorpKillboard(null), []);
});
