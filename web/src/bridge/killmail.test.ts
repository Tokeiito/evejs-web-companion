// Killmail decoder (goal R66) against REAL captured bytes.
//
// ⚠ The POPULATED fixture below is the EXACT wire capture of
// GET /api/bridge/killmail?killID=1 (warStatisticMgr.GetKillMail) on 2026-07-22 —
// a real seeded killmail — so the decoder is proven against the bytes the handler
// (buildKillmailPayload, eve.js .../killmail/killmailState.js) actually emits, not
// a guess. killID 100000 and the no-id path returned null live, the real "no such
// killmail" answer, asserted directly.
//
// ⚠ R7d: every id (solarSystemID / victim* / final* / warID) survives as a numeric
// field; killTime is a bigint FILETIME; the ISK/value fields are bigint-safe
// decimal strings.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeKillmail } from "./killmail.ts";
import type { JsonValue } from "./wire.ts";

// The exact bytes captured live for killID=1 (a null-victim-char NPC loss).
const REAL_KILLMAIL: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["killID", 1],
      ["killTime", { type: "long", value: "134274306672280000" }],
      ["solarSystemID", 30000140],
      ["moonID", null],
      ["victimCharacterID", null],
      ["victimCorporationID", 1000135],
      ["victimAllianceID", null],
      ["victimFactionID", 500020],
      ["victimShipTypeID", 11045],
      ["victimDamageTaken", 326.008364],
      ["finalCharacterID", 140000005],
      ["finalCorporationID", 1000044],
      ["finalAllianceID", null],
      ["finalFactionID", 500001],
      ["finalShipTypeID", 2456],
      ["finalWeaponTypeID", 2456],
      ["finalSecurityStatus", 0],
      ["finalDamageDone", 326.008364],
      ["warID", null],
      ["iskLost", 0],
      ["iskDestroyed", 0],
      ["bountyClaimed", 0],
      ["loyaltyPoints", 0],
      ["killRightSupplied", null],
      ["killBlob", "<attackers></attackers><items></items>"],
    ],
  },
};

test("decodeKillmail decodes the REAL captured killID=1 killmail", () => {
  const km = decodeKillmail(REAL_KILLMAIL)!;
  assert.equal(km.killID, 1);
  // killTime survives as an exact bigint FILETIME (> 2^53), never through Number.
  assert.equal(km.killTime, 134274306672280000n);
  assert.equal(km.solarSystemID, 30000140);
  assert.equal(km.moonID, null);
  // A null victim character (an NPC/structure loss) stays null, not 0.
  assert.equal(km.victimCharacterID, null);
  assert.equal(km.victimCorporationID, 1000135);
  assert.equal(km.victimFactionID, 500020);
  assert.equal(km.victimShipTypeID, 11045);
  assert.equal(km.victimDamageTaken, 326.008364);
  assert.equal(km.finalCharacterID, 140000005);
  assert.equal(km.finalCorporationID, 1000044);
  assert.equal(km.finalShipTypeID, 2456);
  assert.equal(km.finalWeaponTypeID, 2456);
  assert.equal(km.finalSecurityStatus, 0);
  assert.equal(km.finalDamageDone, 326.008364);
  assert.equal(km.warID, null);
  // ISK/value fields kept as bigint-safe strings, null preserved distinct from 0.
  assert.equal(km.iskLost, "0");
  assert.equal(km.iskDestroyed, "0");
  assert.equal(km.bountyClaimed, "0");
  assert.equal(km.loyaltyPoints, "0");
  assert.equal(km.killRightSupplied, null);
  assert.equal(km.killBlob, "<attackers></attackers><items></items>");
});

test("decodeKillmail keeps ISK/value fields bigint-safe when large", () => {
  // Perturb the live capture with a real large ISK value + a warID, proving the
  // bigint-safe path the zero-value live world cannot exercise.
  const withValues = JSON.parse(JSON.stringify(REAL_KILLMAIL)) as {
    args: { entries: [string, JsonValue][] };
  };
  const set = (key: string, value: JsonValue) => {
    const e = withValues.args.entries.find((entry) => entry[0] === key)!;
    e[1] = value;
  };
  set("iskDestroyed", 15000000000000);
  set("iskLost", { type: "long", value: "9223372036854775807" });
  set("warID", 42);
  const km = decodeKillmail(withValues as unknown as JsonValue)!;
  assert.equal(km.iskDestroyed, "15000000000000");
  assert.equal(km.iskLost, "9223372036854775807");
  assert.equal(typeof km.iskLost, "string");
  assert.equal(km.warID, 42);
});

test("decodeKillmail returns null for the real 'no such killmail' answer", () => {
  assert.equal(decodeKillmail(null), null);
  assert.equal(decodeKillmail(undefined), null);
  // A KeyVal with no killID is not a killmail.
  assert.equal(decodeKillmail({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["solarSystemID", 1]] } }), null);
});

// --- R7d id-sweep + its non-vacuous companion --------------------------------

function killmailIdFields(km: {
  solarSystemID: number | null;
  victimCorporationID: number | null;
  finalCharacterID: number | null;
  finalShipTypeID: number | null;
}): number[] {
  return [km.solarSystemID, km.victimCorporationID, km.finalCharacterID, km.finalShipTypeID].filter(
    (id): id is number => id !== null,
  );
}

test("R7d: a decoded killmail preserves location/entity/ship ids as numeric fields", () => {
  const ids = killmailIdFields(decodeKillmail(REAL_KILLMAIL)!);
  assert.ok(ids.includes(30000140), "solarSystemID preserved");
  assert.ok(ids.includes(1000135), "victimCorporationID preserved");
  assert.ok(ids.includes(140000005), "finalCharacterID preserved");
  assert.ok(ids.includes(2456), "finalShipTypeID preserved");
});

test("the killmail id-field extractor actually reads the decoded content", () => {
  assert.deepEqual(killmailIdFields({ solarSystemID: 1, victimCorporationID: 2, finalCharacterID: 3, finalShipTypeID: 4 }), [1, 2, 3, 4]);
  assert.deepEqual(killmailIdFields({ solarSystemID: null, victimCorporationID: null, finalCharacterID: 3, finalShipTypeID: null }), [3]);
});
