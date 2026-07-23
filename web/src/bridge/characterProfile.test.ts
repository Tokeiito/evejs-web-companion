// Character-profile decoders (goal R58) against REAL captured bytes.
//
// Every fixture below is the EXACT live capture from Farmer (character
// 140000005) through GET /api/bridge/character-profile on 2026-07-22 — the seven
// charMgr profile reads, each pinned to the bytes the handler actually emitted.
// The crux is corpChange: its KeyVal is NESTED in a CachedMethodCallResult
// substream (args[1].value) and its wrapper `name` is a {type:"rawstr"}, so a
// decoder that reads the top level as a KeyVal gets nothing — the test proves the
// unwrap.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodePublicInfo,
  decodeHomeStationRow,
  decodeCreationDate,
  decodeSettingsInfo,
  decodePaperdollState,
  decodeCohorts,
  decodeCorpChange,
  decodeCharWriteAck,
  decodeOwnerNoteCreatedAck,
} from "./characterProfile.ts";
import type { JsonValue } from "./wire.ts";

/** A util.KeyVal wrapper around plain fields (the BFF write-ack shape the decoder reads). */
function profileAckKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

// GetPublicInfo — the live bare util.KeyVal.
const PUBLIC_INFO_LIVE: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["characterID", 140000005],
      ["characterName", "Farmer"],
      ["typeID", 1386],
      ["raceID", 2],
      ["bloodlineID", 14],
      ["ancestryID", 64],
      ["corporationID", 98000001],
      ["allianceID", null],
      ["factionID", 500001],
      ["empireID", 500001],
      ["schoolID", 33],
      ["gender", 1],
      ["createDateTime", { type: "long", value: "134274243893290000" }],
      ["startDateTime", { type: "long", value: "134276026827720000" }],
      ["description", "Character created via EveJS Elysian"],
      ["securityRating", 0.1404],
      ["securityStatus", 0.1404],
      ["bounty", 0],
      ["title", ""],
      ["shortName", "none"],
      ["stationID", 60000358],
      ["solarSystemID", 30000144],
      ["militiaFactionID", null],
      ["medal1GraphicID", null],
    ],
  },
};

// GetHomeStationRow — the live util.KeyVal (redundant name/type/system columns).
const HOME_STATION_ROW_LIVE: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["id", 60015249],
      ["stationID", 60015249],
      ["typeID", 92885],
      ["stationTypeID", 92885],
      ["name", "Manifest V - AIR Laboratories Trade Center"],
      ["solarSystemID", 30100032],
      ["regionID", 10001004],
      ["ownerID", 1000413],
    ],
  },
};

// GetSettingsInfo — the live [<Buffer>, 0] tuple (opaque py2 codeobject).
const SETTINGS_INFO_BYTES = [
  99, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 67, 0, 0, 0, 115, 4, 0, 0, 0, 105, 0, 0, 83, 40, 1, 0, 0,
  0, 78, 40, 0, 0, 0, 0, 40, 0, 0, 0, 0, 40, 0, 0, 0, 0, 40, 0, 0, 0, 0, 115, 8, 0, 0, 0, 60, 115,
  116, 114, 105, 110, 103, 62, 116, 1, 0, 0, 0, 102, 1, 0, 0, 0, 115, 0, 0, 0, 0,
];
const SETTINGS_INFO_LIVE: JsonValue = [
  { type: "Buffer", data: SETTINGS_INFO_BYTES },
  0,
];

// GetPrivateInfoOnCorpChange — the live CachedMethodCallResult wrapper.
const CORP_CHANGE_LIVE: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    {
      type: "dict",
      entries: [
        [{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "run" }],
        [{ type: "rawstr", value: "sessionInfo" }, { type: "rawstr", value: "charid" }],
      ],
    },
    {
      type: "substream",
      value: {
        type: "object",
        name: "util.KeyVal",
        args: {
          type: "dict",
          entries: [
            ["corporationID", 98000001],
            ["corporationDateTime", { type: "long", value: "134276026827720000" }],
          ],
        },
      },
    },
    { type: "list", items: [{ type: "long", value: "134291885197890000" }, -1015411972] },
  ],
};

test("decodePublicInfo decodes the live bare KeyVal, preserving every id", () => {
  const info = decodePublicInfo(PUBLIC_INFO_LIVE);
  assert.ok(info);
  assert.equal(info.characterID, 140000005);
  assert.equal(info.characterName, "Farmer");
  assert.equal(info.corporationID, 98000001);
  // allianceID 0/null -> null; factionID present -> kept.
  assert.equal(info.allianceID, null);
  assert.equal(info.factionID, 500001);
  assert.equal(info.raceID, 2);
  assert.equal(info.bloodlineID, 14);
  assert.equal(info.ancestryID, 64);
  // FILETIMEs are bigints; security is a float; bounty is a bigint-safe string.
  assert.equal(info.createDateTime, 134274243893290000n);
  assert.equal(info.startDateTime, 134276026827720000n);
  assert.equal(info.securityStatus, 0.1404);
  assert.equal(info.bounty, "0");
  assert.equal(info.stationID, 60000358);
  assert.equal(info.solarSystemID, 30000144);
});

test("decodePublicInfo also tolerates the GetPublicInfo3 list-wrapped KeyVal", () => {
  const info = decodePublicInfo({ type: "list", items: [PUBLIC_INFO_LIVE] });
  assert.equal(info?.characterID, 140000005);
});

test("decodePublicInfo is null for a shape carrying no identity", () => {
  assert.equal(decodePublicInfo(null), null);
  assert.equal(decodePublicInfo("Farmer"), null);
});

test("decodeHomeStationRow decodes the live home station's resolvable ids only", () => {
  assert.deepEqual(decodeHomeStationRow(HOME_STATION_ROW_LIVE), {
    stationID: 60015249,
    stationTypeID: 92885,
    solarSystemID: 30100032,
  });
});

test("decodeHomeStationRow is null when the KeyVal carries no station", () => {
  assert.equal(decodeHomeStationRow(null), null);
  assert.equal(
    decodeHomeStationRow({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } }),
    null,
  );
});

test("decodeCreationDate decodes the live FILETIME long (bigint, never Number)", () => {
  assert.equal(decodeCreationDate({ type: "long", value: "134274243893290000" }), 134274243893290000n);
  assert.equal(decodeCreationDate(null), null);
});

test("decodeSettingsInfo carries the opaque codeobject bytes + trailing flag", () => {
  const settings = decodeSettingsInfo(SETTINGS_INFO_LIVE);
  assert.ok(settings);
  assert.equal(settings.codeObjectBytes?.length, 80);
  assert.equal(settings.codeObjectBytes?.[0], 99);
  assert.equal(settings.trailingValue, 0);
});

test("decodeSettingsInfo is null when the [buffer, flag] tuple is absent", () => {
  assert.equal(decodeSettingsInfo(null), null);
  assert.equal(decodeSettingsInfo("nope"), null);
});

test("decodePaperdollState decodes the live int; null for a non-number", () => {
  assert.equal(decodePaperdollState(0), 0);
  assert.equal(decodePaperdollState(3), 3);
  assert.equal(decodePaperdollState(null), null);
});

test("decodeCohorts returns the live empty list (empty-by-design, not a bug)", () => {
  assert.deepEqual(decodeCohorts({ type: "list", items: [] }), []);
  // Raw items pass through when data eventually lands.
  assert.deepEqual(decodeCohorts({ type: "list", items: [{ x: 1 }] }), [{ x: 1 }]);
});

test("decodeCorpChange unwraps the CachedMethodCallResult substream to the KeyVal", () => {
  assert.deepEqual(decodeCorpChange(CORP_CHANGE_LIVE), {
    corporationID: 98000001,
    corporationDateTime: 134276026827720000n,
  });
});

test("decodeCorpChange also accepts a bare KeyVal (a handler variant); null otherwise", () => {
  const bare: JsonValue = {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["corporationID", 1000009], ["corporationDateTime", { type: "long", value: "1" }]] },
  };
  assert.equal(decodeCorpChange(bare)?.corporationID, 1000009);
  assert.equal(decodeCorpChange(null), null);
  // A wrapper whose substream carries no corp is null, not a 0-id row.
  assert.equal(
    decodeCorpChange({ type: "object", name: { type: "rawstr", value: "x" }, args: [{ type: "substream", value: null }] }),
    null,
  );
});

// R7d id-sweep: corporationID / stationID survive as numeric fields.
test("R7d: corporationID (corpChange) and stationID (publicInfo) survive as numbers", () => {
  assert.equal(decodeCorpChange(CORP_CHANGE_LIVE)?.corporationID, 98000001);
  assert.equal(decodePublicInfo(PUBLIC_INFO_LIVE)?.stationID, 60000358);
  assert.equal(decodeHomeStationRow(HOME_STATION_ROW_LIVE)?.stationID, 60015249);
});

// --- R88 write acks (Phase-3 charMgr WRITES) ---------------------------------

test("R88 — a charMgr write ack decodes to {ok, applied}", () => {
  const ack = decodeCharWriteAck(profileAckKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R88 — a declined charMgr write is read as not-applied, not a throw", () => {
  const ack = decodeCharWriteAck(profileAckKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
});

test("R88 — an AddOwnerNote ack surfaces the new noteID from result", () => {
  const ack = decodeOwnerNoteCreatedAck(profileAckKeyVal({ ok: true, applied: true, result: 4200001 }));
  assert.equal(ack.applied, true);
  assert.equal(ack.noteID, 4200001);
});

test("R88 — an AddOwnerNote ack with no id reads noteID null", () => {
  const ack = decodeOwnerNoteCreatedAck(profileAckKeyVal({ ok: true, applied: true, result: null }));
  assert.equal(ack.noteID, null);
});
