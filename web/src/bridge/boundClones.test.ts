// R76 — decoding the 6 RB-CLONE bound reads, against REAL CAPTURED BYTES.
//
// The EMPTY fixtures are VERBATIM from a live capture on 2026-07-22 (Farmer
// 140000005 and Test Two 140000002 — neither holds a jump clone, a legitimate
// state). The POPULATED clone/ship/implant Rowset fixtures mirror the SERVER's own
// encoder (jumpCloneRuntime.buildCloneRows/buildShipCloneRows → serviceHelpers
// buildRowset, whose `lines` are BARE-ARRAY rows) — neither live character had a
// clone to capture, so the row shape is taken from the real server code path, not
// guessed. The POPULATED ValidateInstallJumpClone fixture is VERBATIM from Test
// Two's live capture (unskilled → clone limit 0).
//
// The bigint fixtures matter: a jump-clone FILETIME and a > 2^53 structure
// locationID are asserted as EXACT decimal strings — a decoder that routed them
// through Number would be caught here (R7d).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeCloneState,
  decodeStationCloneState,
  decodeShipCloneState,
  decodeNumClonesInStructure,
  decodePriceForClone,
  decodeValidateInstall,
  decodeBoundClones,
} from "./boundClones.ts";

// --- real captured bytes: EMPTY GetCloneState (Farmer, verbatim) ------------

function rowset(columns: readonly string[], lines: readonly JsonValue[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: [...columns] }],
        ["columns", { type: "list", items: [...columns] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...lines] }],
      ],
    },
  };
}

const EMPTY_CLONE_STATE: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["clones", rowset(["jumpCloneID", "locationID", "cloneName"], [])],
      ["implants", rowset(["jumpCloneID", "typeID"], [])],
      ["timeLastJump", { type: "long", value: "0" }],
    ],
  },
};

// --- GetCloneState ----------------------------------------------------------

test("decodeCloneState reads the empty live sheet (no clones, no implants, t=0)", () => {
  const state = decodeCloneState(EMPTY_CLONE_STATE);
  assert.deepEqual(state.clones, []);
  assert.deepEqual(state.implants, []);
  assert.equal(state.timeLastJump, "0");
});

test("decodeCloneState decodes populated clones + implants, ids as data (R7d)", () => {
  // Server buildCloneRows/buildImplantRows produce BARE-ARRAY lines. A > 2^53
  // structure locationID (as a {type:long}) must survive as an EXACT string.
  const bigStructureID = "90000000000000001"; // > Number.MAX_SAFE_INTEGER
  const state = decodeCloneState({
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        [
          "clones",
          rowset(
            ["jumpCloneID", "locationID", "cloneName"],
            [
              [14000000590000, 60003760, "Home"],
              [14000000590001, { type: "long", value: bigStructureID }, ""],
            ],
          ),
        ],
        [
          "implants",
          rowset(
            ["jumpCloneID", "typeID"],
            [
              [14000000590000, 10228],
              [14000000590000, 13256],
            ],
          ),
        ],
        ["timeLastJump", { type: "long", value: "134296439593290000" }],
      ],
    },
  });
  assert.equal(state.clones.length, 2);
  assert.deepEqual(state.clones[0], { jumpCloneID: 14000000590000, locationID: 60003760, cloneName: "Home" });
  // R7d: the > 2^53 id is kept as an exact decimal string, never truncated.
  assert.equal(state.clones[1]!.locationID, bigStructureID);
  assert.equal(state.clones[1]!.cloneName, "");
  assert.deepEqual(
    state.implants.map((i) => i.typeID),
    [10228, 13256],
  );
  assert.equal(state.implants[0]!.jumpCloneID, 14000000590000);
  // bigint FILETIME kept EXACT (would be corrupted if routed through Number).
  assert.equal(state.timeLastJump, "134296439593290000");
});

// --- GetStationCloneState ---------------------------------------------------

test("decodeStationCloneState reads the empty live rowset", () => {
  assert.deepEqual(decodeStationCloneState(rowset(["jumpCloneID", "locationID", "cloneName"], [])), []);
});

test("decodeStationCloneState decodes rows at the docked location", () => {
  const rows = decodeStationCloneState(
    rowset(["jumpCloneID", "locationID", "cloneName"], [[14000000590002, 60003760, "Jita"]]),
  );
  assert.deepEqual(rows, [{ jumpCloneID: 14000000590002, locationID: 60003760, cloneName: "Jita" }]);
});

// --- GetShipCloneState ------------------------------------------------------

test("decodeShipCloneState reads the empty live rowset", () => {
  assert.deepEqual(decodeShipCloneState(rowset(["jumpCloneID", "ownerID", "locationID"], [])), []);
});

test("decodeShipCloneState decodes owner + ship-location rows", () => {
  const rows = decodeShipCloneState(
    rowset(["jumpCloneID", "ownerID", "locationID"], [[14000000590003, 140000005, 1002000000001]]),
  );
  assert.deepEqual(rows, [{ jumpCloneID: 14000000590003, ownerID: 140000005, locationID: 1002000000001 }]);
});

// --- GetNumClonesInPilotsStructure ------------------------------------------

test("decodeNumClonesInStructure reads the bare live 0", () => {
  assert.equal(decodeNumClonesInStructure(0), 0);
});

test("decodeNumClonesInStructure reads a nonzero count", () => {
  assert.equal(decodeNumClonesInStructure(3), 3);
});

// --- GetPriceForClone -------------------------------------------------------

test("decodePriceForClone reads the live 900000 as an EXACT string", () => {
  assert.equal(decodePriceForClone(900000), "900000");
});

test("decodePriceForClone keeps a > 2^53 ISK fee exact (bigint-safe)", () => {
  assert.equal(decodePriceForClone({ type: "long", value: "9007199254740993" }), "9007199254740993");
});

test("decodePriceForClone preserves a fractional structure fee", () => {
  assert.equal(decodePriceForClone(150000.5), "150000.5");
});

// --- ValidateInstallJumpClone -----------------------------------------------

test("decodeValidateInstall reads Farmer's live [] as allowed", () => {
  const v = decodeValidateInstall([]);
  assert.equal(v.allowed, true);
  assert.deepEqual(v.errors, []);
});

test("decodeValidateInstall decodes Test Two's live error list (verbatim)", () => {
  // VERBATIM from Test Two's live capture (unskilled, clone limit 0).
  const v = decodeValidateInstall([
    "UI/Medical/JumpCloneSkillReqNotMet",
    ["UI/Medical/JumpCloneUsageAndCapacity", { count: 0, limit: 0 }],
  ]);
  assert.equal(v.allowed, false);
  assert.equal(v.errors.length, 2);
  assert.deepEqual(v.errors[0], { label: "UI/Medical/JumpCloneSkillReqNotMet", params: null });
  assert.equal(v.errors[1]!.label, "UI/Medical/JumpCloneUsageAndCapacity");
  assert.deepEqual(v.errors[1]!.params, { count: 0, limit: 0 });
});

test("decodeValidateInstall tolerates a {type:dict} params wrapper", () => {
  const v = decodeValidateInstall([
    ["UI/Medical/JumpCloneUsageAndCapacity", { type: "dict", entries: [["count", 2], ["limit", 5]] }],
  ]);
  assert.deepEqual(v.errors[0]!.params, { count: 2, limit: 5 });
});

// --- the whole /api/bridge/bound-clones envelope ----------------------------

const LIVE_ENVELOPE: JsonValue = {
  ok: true,
  characterID: 140000005,
  reads: {
    GetCloneState: { result: EMPTY_CLONE_STATE },
    GetStationCloneState: { result: rowset(["jumpCloneID", "locationID", "cloneName"], []) },
    GetShipCloneState: { result: rowset(["jumpCloneID", "ownerID", "locationID"], []) },
    GetNumClonesInPilotsStructure: { result: 0 },
    GetPriceForClone: { result: 900000 },
    ValidateInstallJumpClone: { result: [] },
  },
};

test("decodeBoundClones folds the whole live envelope with no errors", () => {
  const b = decodeBoundClones(LIVE_ENVELOPE);
  assert.equal(b.cloneState.error, null);
  assert.deepEqual(b.cloneState.value.clones, []);
  assert.equal(b.cloneState.value.timeLastJump, "0");
  assert.deepEqual(b.stationClones.value, []);
  assert.deepEqual(b.shipClones.value, []);
  assert.equal(b.numClonesInStructure.value, 0);
  assert.equal(b.priceForClone.value, "900000");
  assert.equal(b.installValidation.value.allowed, true);
});

test("decodeBoundClones carries a per-read error through without blanking siblings", () => {
  const b = decodeBoundClones({
    ok: true,
    characterID: 140000005,
    reads: {
      ...(LIVE_ENVELOPE as { reads: Record<string, JsonValue> }).reads,
      GetPriceForClone: { error: "CALL_REFUSED", message: "nope" },
    },
  });
  assert.equal(b.priceForClone.error, "CALL_REFUSED");
  assert.equal(b.priceForClone.value, null);
  // siblings still decode.
  assert.equal(b.numClonesInStructure.value, 0);
  assert.equal(b.installValidation.value.allowed, true);
});

test("decodeBoundClones on a null/garbage envelope yields empty, not a throw", () => {
  const b = decodeBoundClones(null);
  assert.deepEqual(b.cloneState.value.clones, []);
  assert.equal(b.priceForClone.value, null);
  assert.equal(b.installValidation.value.allowed, true);
});
