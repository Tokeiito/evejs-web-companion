// R64 decoder tests (PLUMBING ONLY). Fixtures are REAL bytes captured live from
// Farmer (char 140000005) against agent 3008416 (Antaken Kamola) through
// GET /api/bridge/agent-info on 2026-07-22, except the epic-arc / mission-journal
// POPULATED shapes (both came back empty live — a real state) which are pinned by
// builder-shaped fixtures matching the eve.js handlers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeAgentInfo,
  decodeSolarSystemOfAgent,
  decodeEpicArcStatus,
  decodeCompletedCareerAgents,
  decodeInfoServiceDetails,
  decodeMissionJournalInfo,
  decodeEntryPoint,
  decodeDungeonShipRestrictions,
} from "./agentInfo.ts";
import type { JsonValue } from "./wire.ts";

// The verbatim GetAgentStaticInfo result for agent 3008416 (bare marshaled dict).
const AGENT_STATIC_INFO: JsonValue = {
  type: "dict",
  entries: [
    ["agentID", 3008416],
    ["ownerTypeID", 1373],
    ["ownerName", "Antaken Kamola"],
    ["gender", 0],
    ["agentTypeID", 2],
    ["divisionID", 22],
    ["level", 1],
    ["isLocator", false],
    ["corporationID", 1000002],
    ["factionID", 500001],
    ["stationID", 60000004],
    ["stationTypeID", 1531],
    ["solarSystemID", 30002780],
    ["isInSpace", false],
    ["raceID", 1],
    ["bloodlineID", 1],
    ["careerID", 14],
    ["schoolID", 18],
    ["specialityID", 15],
    ["missionKind", "courier"],
    ["missionTypeLabel", "UI/Agents/MissionTypes/Courier"],
    ["missionPoolKey", "kind:courier|level:1|agentType:2|division:22|corp:1000002|faction:500001"],
    ["missionTemplateIDs", { type: "list", items: [] }],
    ["importantMission", false],
    ["conversationMetadata", { type: "dict", entries: [["placeholder", true], ["source", "agentAuthority"]] }],
  ],
};

// The verbatim GetInfoServiceDetails result (unwrapped util.KeyVal from boundCall).
const INFO_SERVICE_DETAILS: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["agentID", 3008416],
      ["stationID", 60000004],
      ["level", 1],
      [
        "services",
        [
          {
            type: "object",
            name: "util.KeyVal",
            args: { type: "dict", entries: [["agentServiceType", "mission"], ["available", true]] },
          },
        ],
      ],
      ["incompatible", null],
    ],
  },
};

// --- decodeAgentInfo (GetAgentStaticInfo / GetAgentByID) --------------------

test("decodeAgentInfo reads the public agent record from the real bare-dict bytes", () => {
  const info = decodeAgentInfo(AGENT_STATIC_INFO);
  assert.ok(info);
  assert.equal(info.agentID, 3008416);
  assert.equal(info.ownerName, "Antaken Kamola");
  assert.equal(info.ownerTypeID, 1373);
  assert.equal(info.agentTypeID, 2);
  assert.equal(info.divisionID, 22);
  assert.equal(info.level, 1);
  assert.equal(info.isLocator, false);
  assert.equal(info.corporationID, 1000002);
  assert.equal(info.factionID, 500001);
  assert.equal(info.stationID, 60000004);
  assert.equal(info.stationTypeID, 1531);
  assert.equal(info.solarSystemID, 30002780);
  assert.equal(info.isInSpace, false);
  assert.equal(info.raceID, 1);
  assert.equal(info.bloodlineID, 1);
  assert.equal(info.careerID, 14);
  assert.equal(info.schoolID, 18);
  assert.equal(info.specialityID, 15);
  assert.equal(info.missionKind, "courier");
  assert.equal(info.missionTypeLabel, "UI/Agents/MissionTypes/Courier");
  assert.equal(info.importantMission, false);
});

test("decodeAgentInfo returns null for an unknown agent (null result)", () => {
  assert.equal(decodeAgentInfo(null), null);
  assert.equal(decodeAgentInfo({ type: "dict", entries: [] }), null);
});

test("decodeAgentInfo keeps every id as a number (R7d), never a label", () => {
  const info = decodeAgentInfo(AGENT_STATIC_INFO);
  assert.ok(info);
  for (const id of [
    info.agentID,
    info.corporationID,
    info.factionID,
    info.stationID,
    info.solarSystemID,
  ]) {
    assert.equal(typeof id, "number");
  }
});

// --- decodeSolarSystemOfAgent ----------------------------------------------

test("decodeSolarSystemOfAgent reads the bare solarSystemID int, null when absent", () => {
  assert.equal(decodeSolarSystemOfAgent(30002780), 30002780);
  assert.equal(decodeSolarSystemOfAgent(null), null);
  assert.equal(decodeSolarSystemOfAgent(0), null);
});

// --- decodeEpicArcStatus ----------------------------------------------------

test("decodeEpicArcStatus decodes the real EMPTY dict to [] (a legitimate state)", () => {
  assert.deepEqual(decodeEpicArcStatus({ type: "dict", entries: [] }), []);
  assert.deepEqual(decodeEpicArcStatus(null), []);
});

test("decodeEpicArcStatus decodes the populated nested dict, FILETIMEs bigint-safe", () => {
  // Builder-shaped from buildEpicArcStatusPayloadFromCharacterState: epicArcID ->
  // contentID -> util.KeyVal{acceptedDate, completedDate, quitDate, nameID}.
  const populated: JsonValue = {
    type: "dict",
    entries: [
      [
        4000001,
        {
          type: "dict",
          entries: [
            [
              5000123,
              {
                type: "object",
                name: "util.KeyVal",
                args: {
                  type: "dict",
                  entries: [
                    ["acceptedDate", { type: "long", value: "134292005929490000" }],
                    ["completedDate", null],
                    ["quitDate", null],
                    ["nameID", 987654],
                  ],
                },
              },
            ],
          ],
        },
      ],
    ],
  };
  const arcs = decodeEpicArcStatus(populated);
  assert.equal(arcs.length, 1);
  const arc = arcs[0];
  assert.ok(arc);
  assert.equal(arc.epicArcID, 4000001);
  assert.equal(arc.missions.length, 1);
  const mission = arc.missions[0];
  assert.ok(mission);
  assert.equal(mission.contentID, 5000123);
  assert.equal(mission.nameID, 987654);
  // The FILETIME kept as an exact decimal string, never coerced through Number.
  assert.equal(mission.acceptedDate, "134292005929490000");
  assert.equal(mission.completedDate, null);
});

// --- decodeCompletedCareerAgents -------------------------------------------

test("decodeCompletedCareerAgents reads the real numeric-keyed completion dict", () => {
  const rows = decodeCompletedCareerAgents({
    type: "dict",
    entries: [
      [3008416, true],
      [3010879, false],
    ],
  });
  assert.deepEqual(rows, [
    { agentID: 3008416, completed: true },
    { agentID: 3010879, completed: false },
  ]);
});

test("decodeCompletedCareerAgents decodes the empty-query {} to [] (asked about none)", () => {
  assert.deepEqual(decodeCompletedCareerAgents({ type: "dict", entries: [] }), []);
});

// --- decodeInfoServiceDetails ----------------------------------------------

test("decodeInfoServiceDetails reads the real unwrapped util.KeyVal (services list)", () => {
  const details = decodeInfoServiceDetails(INFO_SERVICE_DETAILS);
  assert.ok(details);
  assert.equal(details.agentID, 3008416);
  assert.equal(details.stationID, 60000004);
  assert.equal(details.level, 1);
  assert.equal(details.incompatible, null);
  assert.equal(details.services.length, 1);
  assert.deepEqual(details.services[0], { agentServiceType: "mission", available: true });
});

test("decodeInfoServiceDetails returns null when the agent is unknown", () => {
  assert.equal(decodeInfoServiceDetails(null), null);
});

// --- decodeMissionJournalInfo ----------------------------------------------

test("decodeMissionJournalInfo decodes the real null to null (no active mission)", () => {
  assert.equal(decodeMissionJournalInfo(null), null);
});

test("decodeMissionJournalInfo decodes the populated bare dict, expiration bigint-safe", () => {
  // Builder-shaped from buildMissionJournalInfo.
  const populated: JsonValue = {
    type: "dict",
    entries: [
      ["missionNameID", 111222],
      ["contentID", 333444],
      ["briefingTextID", 555666],
      ["missionImage", { type: "dict", entries: [] }],
      ["expirationTime", { type: "long", value: "134292999999990000" }],
      ["missionState", 2],
      ["objectives", { type: "list", items: [{ a: 1 }, { b: 2 }] }],
      ["bookmarks", { type: "list", items: [{ c: 3 }] }],
      ["iconID", 16],
    ],
  };
  const journal = decodeMissionJournalInfo(populated);
  assert.ok(journal);
  assert.equal(journal.missionNameID, 111222);
  assert.equal(journal.contentID, 333444);
  assert.equal(journal.briefingTextID, 555666);
  assert.equal(journal.missionState, 2);
  assert.equal(journal.expirationTime, "134292999999990000");
  assert.equal(journal.iconID, 16);
  assert.equal(journal.objectiveCount, 2);
  assert.equal(journal.bookmarkCount, 1);
});

// --- decodeEntryPoint ------------------------------------------------------

test("decodeEntryPoint decodes the real null to null (no active dungeon)", () => {
  assert.equal(decodeEntryPoint(null), null);
});

test("decodeEntryPoint decodes a bare [x, y, z] coordinate array", () => {
  const point = decodeEntryPoint([150000000000.5, -230000000000.25, 44000000000]);
  assert.deepEqual(point, { x: 150000000000.5, y: -230000000000.25, z: 44000000000 });
  // A short array is not a point.
  assert.equal(decodeEntryPoint([1, 2]), null);
});

// --- decodeDungeonShipRestrictions -----------------------------------------

test("decodeDungeonShipRestrictions reads the real PLAIN-object typeID arrays", () => {
  // Trimmed from the live dungeon-43 capture (222 allowed / many restricted).
  const restrictions = decodeDungeonShipRestrictions({
    allowedShipTypes: [582, 583, 584, 585, 586],
    restrictedShipTypes: [620, 621, 622, 623, 624],
    nonDefaultShipRestrictions: true,
  } as unknown as JsonValue);
  assert.ok(restrictions);
  assert.deepEqual(restrictions.allowedShipTypes, [582, 583, 584, 585, 586]);
  assert.deepEqual(restrictions.restrictedShipTypes, [620, 621, 622, 623, 624]);
  assert.equal(restrictions.nonDefaultShipRestrictions, true);
});

test("decodeDungeonShipRestrictions decodes the real null to null (no restriction)", () => {
  assert.equal(decodeDungeonShipRestrictions(null), null);
  // A {type:"list"} wrapper is NOT this shape (the handler returns a plain object).
  assert.equal(decodeDungeonShipRestrictions({ type: "list", items: [] }), null);
});

test("decodeDungeonShipRestrictions keeps typeIDs as numbers (R7d)", () => {
  const restrictions = decodeDungeonShipRestrictions({
    allowedShipTypes: [582],
    restrictedShipTypes: [620],
    nonDefaultShipRestrictions: false,
  } as unknown as JsonValue);
  assert.ok(restrictions);
  assert.equal(typeof restrictions.allowedShipTypes[0], "number");
  assert.equal(typeof restrictions.restrictedShipTypes[0], "number");
});
