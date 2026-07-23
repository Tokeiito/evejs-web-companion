// R85 — decoding the 5 RB-FLEET bound reads, against BUILDER-MIRRORED bytes.
//
// Farmer (140000005) is docked and NOT in a fleet, so populated fleet bytes cannot
// be captured live (ensureFleetExists(0) throws FleetNotFound → every read is an
// error envelope — the real "not in a fleet" state, asserted in the empty-path test
// below). The populated fixtures here are produced by running the REAL server payload
// builders (eve.js fleetPayloads.js: buildFleetStatePayload / buildWingPayload /
// buildJoinRequestsPayload / buildCompositionPayload) against a realistic fleet record
// — genuine server bytes, verbatim from that generator output, not a hand-guessed shape.
//
// The bigint fixture matters: the member `timestamp` FILETIME is asserted as an EXACT
// decimal string — a decoder that routed it through Number would be caught here (R7d).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeFleetInitState,
  decodeFleetWings,
  decodeFleetMotd,
  decodeFleetJoinRequests,
  decodeFleetComposition,
  decodeBoundFleet,
} from "./boundFleet.ts";

// --- builder-mirrored bytes (verbatim from fleetPayloads.js, fleet 999000001) ------

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries: entries as JsonValue } };
}

const SQUAD_ALPHA = keyVal([["squadID", 100], ["name", "Alpha Squad"]]);
const SQUAD_BRAVO = keyVal([["squadID", 101], ["name", "Bravo Squad"]]);

const WING_ONE = keyVal([
  ["wingID", 10],
  ["name", "Wing One"],
  ["squads", { type: "dict", entries: [[100, SQUAD_ALPHA]] }],
]);
const WING_TWO = keyVal([
  ["wingID", 11],
  ["name", "Wing Two"],
  ["squads", { type: "dict", entries: [[101, SQUAD_BRAVO]] }],
]);

const MEMBER_GRUNT = keyVal([
  ["squadID", 101],
  ["wingID", 11],
  ["skills", { type: "list", items: [3, 4, 3] }],
  ["timestamp", "134287114378050000"],
  ["stationID", null],
  ["clientID", 2000000002],
  ["job", 0],
  ["role", 0],
  ["shipTypeID", 587],
  ["solarSystemID", 30000144],
  ["memberOptOuts", keyVal([
    ["acceptsConduitJumps", false],
    ["acceptsFleetRegroups", true],
    ["acceptsFleetWarp", true],
  ])],
  ["charID", 140000002],
]);
const MEMBER_BOSS = keyVal([
  ["squadID", 100],
  ["wingID", 10],
  ["skills", { type: "list", items: [5, 5, 4] }],
  ["timestamp", "134276968878520000"],
  ["stationID", 60000004],
  ["clientID", 2000000001],
  ["job", 5],
  ["role", 4],
  ["shipTypeID", 670],
  ["solarSystemID", 30000142],
  ["memberOptOuts", keyVal([
    ["acceptsConduitJumps", true],
    ["acceptsFleetRegroups", true],
    ["acceptsFleetWarp", false],
  ])],
  ["charID", 140000005],
]);

// GetInitState — full fleet KeyVal (members dict sorted by charID: grunt then boss).
const INIT_STATE: JsonValue = keyVal([
  ["motd", "Form up on the boss. o7"],
  ["options", keyVal([
    ["isFreeMove", false],
    ["isRegistered", true],
    ["autoJoinSquadID", 100],
  ])],
  ["fleetID", 999000001],
  ["members", { type: "dict", entries: [[140000002, MEMBER_GRUNT], [140000005, MEMBER_BOSS]] }],
  ["isLootLogging", false],
  ["squads", { type: "dict", entries: [[100, SQUAD_ALPHA], [101, SQUAD_BRAVO]] }],
  ["wings", { type: "dict", entries: [[10, WING_ONE], [11, WING_TWO]] }],
]);

// GetWings — a BARE dict {wingID -> wing KeyVal}.
const WINGS: JsonValue = { type: "dict", entries: [[10, WING_ONE], [11, WING_TWO]] };

// GetMotd — a plain string.
const MOTD: JsonValue = "Form up on the boss. o7";

// GetJoinRequests — a BARE dict {charID -> join-request KeyVal}.
const JOIN_REQUESTS: JsonValue = {
  type: "dict",
  entries: [
    [140000003, keyVal([
      ["charID", 140000003],
      ["corpID", 98000000],
      ["allianceID", 99000000],
      ["warFactionID", null],
      ["securityStatus", -1.25],
    ])],
  ],
};

// GetFleetComposition — a list of per-member composition KeyVals.
const COMPOSITION: JsonValue = {
  type: "list",
  items: [
    keyVal([
      ["characterID", 140000005],
      ["solarSystemID", 30000142],
      ["stationID", 60000004],
      ["shipTypeID", 670],
      ["skills", { type: "list", items: [5, 5, 4] }],
      ["skillIDs", { type: "list", items: [3300, 3301, 3302] }],
    ]),
    keyVal([
      ["characterID", 140000002],
      ["solarSystemID", 30000144],
      ["stationID", null],
      ["shipTypeID", 587],
      ["skills", { type: "list", items: [3, 4, 3] }],
      ["skillIDs", { type: "list", items: [3300, 3301] }],
    ]),
  ],
};

// --- GetInitState -----------------------------------------------------------

test("decodeFleetInitState reads motd/options/fleetID and the whole roster", () => {
  const s = decodeFleetInitState(INIT_STATE);
  assert.equal(s.motd, "Form up on the boss. o7");
  assert.equal(s.fleetID, 999000001);
  assert.equal(s.isLootLogging, false);
  assert.deepEqual(s.options, { isFreeMove: false, isRegistered: true, autoJoinSquadID: 100 });
  assert.equal(s.members.length, 2);
  assert.equal(s.squads.length, 2);
  assert.equal(s.wings.length, 2);
});

test("decodeFleetInitState keeps ids as data and the member FILETIME exact (R7d)", () => {
  const s = decodeFleetInitState(INIT_STATE);
  // dict order is grunt (140000002) then boss (140000005)
  const grunt = s.members[0]!;
  const boss = s.members[1]!;
  assert.equal(grunt.charID, 140000002);
  assert.equal(grunt.stationID, null);
  assert.equal(grunt.shipTypeID, 587);
  assert.deepEqual(grunt.skills, [3, 4, 3]);
  assert.deepEqual(grunt.memberOptOuts, {
    acceptsConduitJumps: false,
    acceptsFleetRegroups: true,
    acceptsFleetWarp: true,
  });
  assert.equal(boss.charID, 140000005);
  assert.equal(boss.job, 5);
  assert.equal(boss.role, 4);
  assert.equal(boss.stationID, 60000004);
  // EXACT FILETIME — never truncated through Number
  assert.equal(boss.timestamp, "134276968878520000");
  assert.equal(typeof boss.timestamp, "string");
});

test("decodeFleetInitState nests each wing's squads", () => {
  const s = decodeFleetInitState(INIT_STATE);
  assert.deepEqual(s.wings[0], {
    wingID: 10,
    name: "Wing One",
    squads: [{ squadID: 100, name: "Alpha Squad" }],
  });
  assert.deepEqual(s.wings[1], {
    wingID: 11,
    name: "Wing Two",
    squads: [{ squadID: 101, name: "Bravo Squad" }],
  });
});

// --- GetWings ---------------------------------------------------------------

test("decodeFleetWings reads the bare wing dict into a wing list", () => {
  const wings = decodeFleetWings(WINGS);
  assert.equal(wings.length, 2);
  assert.deepEqual(wings[0], {
    wingID: 10,
    name: "Wing One",
    squads: [{ squadID: 100, name: "Alpha Squad" }],
  });
  assert.equal(wings[1]!.squads[0]!.name, "Bravo Squad");
});

// --- GetMotd ----------------------------------------------------------------

test("decodeFleetMotd reads the MOTD string", () => {
  assert.equal(decodeFleetMotd(MOTD), "Form up on the boss. o7");
});

test("decodeFleetMotd returns '' for an absent/non-string value", () => {
  assert.equal(decodeFleetMotd(undefined), "");
  assert.equal(decodeFleetMotd(null as unknown as JsonValue), "");
});

// --- GetJoinRequests --------------------------------------------------------

test("decodeFleetJoinRequests reads each applicant, ids as data, sec as a real", () => {
  const reqs = decodeFleetJoinRequests(JOIN_REQUESTS);
  assert.equal(reqs.length, 1);
  assert.deepEqual(reqs[0], {
    charID: 140000003,
    corpID: 98000000,
    allianceID: 99000000,
    warFactionID: null,
    securityStatus: -1.25,
  });
});

// --- GetFleetComposition ----------------------------------------------------

test("decodeFleetComposition reads each member's ship/location + skills", () => {
  const comp = decodeFleetComposition(COMPOSITION);
  assert.equal(comp.length, 2);
  assert.deepEqual(comp[0], {
    characterID: 140000005,
    solarSystemID: 30000142,
    stationID: 60000004,
    shipTypeID: 670,
    skills: [5, 5, 4],
    skillIDs: [3300, 3301, 3302],
  });
  assert.equal(comp[1]!.characterID, 140000002);
  assert.equal(comp[1]!.stationID, null);
  assert.deepEqual(comp[1]!.skillIDs, [3300, 3301]);
});

// --- the whole envelope + the empty (no-fleet) live path --------------------

test("decodeBoundFleet folds the populated envelope into typed reads", () => {
  const raw: JsonValue = {
    ok: true,
    characterID: 140000005,
    fleetID: 999000001,
    reads: {
      GetInitState: { result: INIT_STATE },
      GetWings: { result: WINGS },
      GetMotd: { result: MOTD },
      GetJoinRequests: { result: JOIN_REQUESTS },
      GetFleetComposition: { result: COMPOSITION },
    },
  };
  const fleet = decodeBoundFleet(raw);
  assert.equal(fleet.characterID, 140000005);
  assert.equal(fleet.fleetID, 999000001);
  assert.equal(fleet.initState.error, null);
  assert.equal(fleet.initState.value.fleetID, 999000001);
  assert.equal(fleet.wings.value.length, 2);
  assert.equal(fleet.motd.value, "Form up on the boss. o7");
  assert.equal(fleet.joinRequests.value.length, 1);
  assert.equal(fleet.composition.value.length, 2);
});

test("decodeBoundFleet surfaces the no-fleet error path as empty with error codes", () => {
  // The REAL Farmer-docked live shape: no fleet → ensureFleetExists(0) throws, so
  // every read comes back as an error envelope. Empty is legitimate, not a failure.
  const raw: JsonValue = {
    ok: true,
    characterID: 140000005,
    fleetID: null,
    // VERBATIM from the live capture (rrfarmer → Farmer 140000005, docked, no fleet,
    // GET /api/bridge/bound-fleet 2026-07-22): ensureFleetExists(0) throws → each read
    // is CALL_REFUSED / "FleetNotFound".
    reads: {
      GetInitState: { error: "CALL_REFUSED", message: "FleetNotFound" },
      GetWings: { error: "CALL_REFUSED", message: "FleetNotFound" },
      GetMotd: { error: "CALL_REFUSED", message: "FleetNotFound" },
      GetJoinRequests: { error: "CALL_REFUSED", message: "FleetNotFound" },
      GetFleetComposition: { error: "CALL_REFUSED", message: "FleetNotFound" },
    },
  };
  const fleet = decodeBoundFleet(raw);
  assert.equal(fleet.fleetID, null);
  assert.equal(fleet.initState.error, "CALL_REFUSED");
  assert.equal(fleet.wings.error, "CALL_REFUSED");
  assert.equal(fleet.motd.error, "CALL_REFUSED");
  assert.equal(fleet.joinRequests.error, "CALL_REFUSED");
  assert.equal(fleet.composition.error, "CALL_REFUSED");
  // decoded to safe empties despite the error
  assert.deepEqual(fleet.initState.value.members, []);
  assert.deepEqual(fleet.wings.value, []);
  assert.equal(fleet.motd.value, "");
  assert.deepEqual(fleet.joinRequests.value, []);
  assert.deepEqual(fleet.composition.value, []);
});
