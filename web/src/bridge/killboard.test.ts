// Killboard decoder (goal R70) against REAL captured bytes + the server's own
// populated row shape.
//
// ⚠ Farmer has no recent kills/losses, so the LIVE capture through
// GET /api/bridge/killboard on 2026-07-22 was the empty list {type:"list", items:[]}.
// That empty path is asserted directly. The POPULATED fixture is the exact output of
// the server's buildKillmailPayload (eve.js
// server/src/services/killmail/killmailState.js:497) — a util.KeyVal carrying killID /
// killTime(long) / the victim*/final* ids / iskLost / iskDestroyed / killBlob — so the
// decoder is proven against the shape the handler emits, not a guess.
//
// ⚠ R7d: the victim*/final*/warID/solarSystemID ids are entity ids the decoder keeps
// as numeric fields for a future UI to resolve; the sweep below proves they survive as
// data (its companion proves the sweep is not vacuous).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeKillmails, type Killmail } from "./killboard.ts";
import type { JsonValue } from "./wire.ts";

// buildKillmailPayload's exact shape: one loss (Farmer's ship destroyed) with a
// war and a final blow by another character.
const KILLMAILS: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["killID", 900001],
          ["killTime", { type: "long", value: "134285151537020000" }],
          ["solarSystemID", 30000142],
          ["moonID", null],
          ["victimCharacterID", 140000005],
          ["victimCorporationID", 98000001],
          ["victimAllianceID", null],
          ["victimFactionID", null],
          ["victimShipTypeID", 606],
          ["victimDamageTaken", 1420],
          ["finalCharacterID", 140000178],
          ["finalCorporationID", 1000009],
          ["finalAllianceID", null],
          ["finalFactionID", null],
          ["finalShipTypeID", 621],
          ["finalWeaponTypeID", 2977],
          ["finalSecurityStatus", -0.3],
          ["finalDamageDone", 1420],
          ["warID", 42],
          ["iskLost", 1250000.5],
          ["iskDestroyed", 1250000.5],
          ["bountyClaimed", null],
          ["loyaltyPoints", null],
          ["killRightSupplied", null],
          ["killBlob", "victim:140000005;final:140000178"],
        ],
      },
    },
  ],
};

test("decodeKillmails on the real empty list is [] (a real 'no recent kills/losses')", () => {
  assert.deepEqual(decodeKillmails({ type: "list", items: [] }), []);
  assert.deepEqual(decodeKillmails(null), []);
});

test("decodeKillmails decodes the server's populated killmail row", () => {
  const rows = decodeKillmails(KILLMAILS);
  assert.equal(rows.length, 1);
  const kill = rows[0] as Killmail;
  assert.equal(kill.killID, 900001);
  // FILETIME is a bigint (exceeds 2^53).
  assert.equal(kill.killTime, 134285151537020000n);
  assert.equal(kill.solarSystemID, 30000142);
  assert.equal(kill.moonID, null);
  assert.equal(kill.victimCharacterID, 140000005);
  assert.equal(kill.victimCorporationID, 98000001);
  assert.equal(kill.victimAllianceID, null);
  assert.equal(kill.victimShipTypeID, 606);
  assert.equal(kill.finalCharacterID, 140000178);
  assert.equal(kill.finalWeaponTypeID, 2977);
  assert.equal(kill.finalSecurityStatus, -0.3);
  assert.equal(kill.warID, 42);
  // ISK amounts are bigint-safe strings.
  assert.equal(kill.iskLost, "1250000.5");
  assert.equal(kill.iskDestroyed, "1250000.5");
  assert.equal(kill.bountyClaimed, null);
  assert.equal(kill.killBlob, "victim:140000005;final:140000178");
});

test("decodeKillmails drops a malformed row (no killID)", () => {
  const rows = decodeKillmails({
    type: "list",
    items: [{ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["victimCharacterID", 1]] } }],
  });
  assert.deepEqual(rows, []);
});

// R7d id-sweep: the killmail preserves its entity ids as numeric fields.
function killmailIdFields(kill: Killmail): number[] {
  return [
    ...(kill.solarSystemID === null ? [] : [kill.solarSystemID]),
    ...(kill.victimCharacterID === null ? [] : [kill.victimCharacterID]),
    ...(kill.victimCorporationID === null ? [] : [kill.victimCorporationID]),
    ...(kill.victimShipTypeID === null ? [] : [kill.victimShipTypeID]),
    ...(kill.finalCharacterID === null ? [] : [kill.finalCharacterID]),
    ...(kill.warID === null ? [] : [kill.warID]),
  ];
}

test("R7d: a decoded killmail preserves its entity ids as numeric fields", () => {
  const [kill] = decodeKillmails(KILLMAILS);
  const ids = killmailIdFields(kill!);
  assert.ok(ids.includes(30000142), "solarSystemID preserved");
  assert.ok(ids.includes(140000005), "victimCharacterID preserved");
  assert.ok(ids.includes(140000178), "finalCharacterID preserved");
  assert.ok(ids.includes(42), "warID preserved");
});

test("the killmail id-field extractor actually reads the decoded content", () => {
  // Companion: distinct fields yield distinct ids, so the sweep is not vacuous.
  const ids = killmailIdFields({
    solarSystemID: 1,
    victimCharacterID: 2,
    victimCorporationID: 3,
    victimShipTypeID: 4,
    finalCharacterID: 5,
    warID: 6,
  } as Killmail);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6]);
});
