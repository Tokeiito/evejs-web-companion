// A mission's objectives read whole, against answers recorded from the server on both transports
// (missionObjectives.fixtures.ts), and against made-up ones for the kinds those do not have.

import test from "node:test";
import assert from "node:assert/strict";

import { AGENT_MISSION_STATE_FAILED, TYPE_CREDITS, decodeObjectives, objectivesHeading, type MissionObjectives } from "./missionObjectives.ts";
import {
  COURIER_OFFERED_GAME_PORT,
  COURIER_OFFERED_GATEWAY,
  ENCOUNTER_ACCEPTED_GAME_PORT,
  ENCOUNTER_ACCEPTED_GATEWAY,
  ENCOUNTER_OFFERED_GAME_PORT,
  ENCOUNTER_OFFERED_GATEWAY,
} from "./missionObjectives.fixtures.ts";
import type { JsonValue } from "./wire.ts";

const dict = (entries: Array<[string, unknown]>) => ({ type: "dict", entries }) as unknown as JsonValue;
const tuple = (...items: unknown[]) => ({ type: "tuple", items }) as unknown as JsonValue;
const list = (...items: unknown[]) => ({ type: "list", items }) as unknown as JsonValue;

/** An answer with these entries over an empty mission's. */
function answer(entries: Array<[string, unknown]>): JsonValue {
  const base: Array<[string, unknown]> = [
    ["completionStatus", 0], ["collateral", list()], ["dungeons", list()], ["objectives", list()], ["locations", list()], ["importantStandings", 0],
    ["contentID", 2156], ["agentGift", list()], ["normalRewards", list()], ["bonusRewards", list()], ["researchPoints", 0], ["missionState", 1],
    ["loyaltyPoints", 0], ["missionTitleID", 58607],
  ];
  return dict([...base.filter(([name]) => !entries.some(([given]) => given === name)), ...entries]);
}
const decoded = (entries: Array<[string, unknown]>): MissionObjectives => decodeObjectives(answer(entries)) as MissionObjectives;

test("a courier's objectives, as the server sent them", () => {
  const read = decodeObjectives(COURIER_OFFERED_GATEWAY);
  assert.deepEqual(read, {
    importantStandings: false,
    missionTitleID: 57959,
    missionTitle: null,
    completionStatus: 0,
    missionState: 1,
    contentID: 2156,
    objectives: [{
      kind: "transport",
      pickupOwnerID: 1000002,
      pickup: { locationID: 60000004, solarsystemID: 30002780, typeID: 1531, locationType: null, shipTypeID: null },
      dropoffOwnerID: 1000002,
      dropoff: { locationID: 60000019, solarsystemID: 30002778, typeID: 1531, locationType: null, shipTypeID: null },
      cargo: { typeID: 2595, quantity: 1, volume: 0.1, hasCargo: false },
    }],
    dungeons: [],
    locations: [30002780, 30002778],
    agentGift: [],
    normalRewards: [{ typeID: TYPE_CREDITS, quantity: "13800", specificItem: false, blueprint: false }],
    loyaltyPoints: 49,
    researchPoints: 0,
    bonusRewards: [{ typeID: TYPE_CREDITS, quantity: "17000", specificItem: false, blueprint: false, timeRemaining: 36_000_000_000n, timeBonusIntervalMin: 60 }],
    collateral: [],
    missionExtra: null,
  });
});

test("a fighting mission's objectives: a dungeon, with its own words, owner and place", () => {
  const read = decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) as MissionObjectives;
  assert.deepEqual(read.objectives, []);
  assert.deepEqual(read.dungeons, [{
    dungeonID: 3030,
    optional: false,
    completionStatus: null,
    objectiveCompleted: null,
    briefingMessage: { messageID: 115502, label: null, parameters: null, text: null, contentID: 13735 },
    ownerID: 500021,
    location: { locationID: 30002779, solarsystemID: 30002779, typeID: 5, locationType: "dungeon", shipTypeID: null },
    shipRestrictions: null,
  }]);
  assert.deepEqual(read.locations, [30002779]);
  assert.equal(read.missionTitleID, 57212);
  assert.equal(read.contentID, 13735);
  assert.equal(read.missionState, 1);
  assert.equal(read.loyaltyPoints, 87);
  assert.deepEqual(read.normalRewards, [{ typeID: TYPE_CREDITS, quantity: "65000", specificItem: false, blueprint: false }]);
  assert.deepEqual(read.bonusRewards, [{ typeID: TYPE_CREDITS, quantity: "80000", specificItem: false, blueprint: false, timeRemaining: 72_000_000_000n, timeBonusIntervalMin: 120 }]);
});

test("accepted, the same mission says so, and its bonus time is running", () => {
  const read = decodeObjectives(ENCOUNTER_ACCEPTED_GATEWAY) as MissionObjectives;
  assert.equal(read.missionState, 2);
  assert.equal(read.bonusRewards[0]?.timeRemaining, 71_999_910_000n);
  assert.deepEqual(read.dungeons, (decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) as MissionObjectives).dungeons);
});

test("the game port's spelling of the same answers reads the same", () => {
  assert.deepEqual(decodeObjectives(COURIER_OFFERED_GAME_PORT), decodeObjectives(COURIER_OFFERED_GATEWAY));
  assert.deepEqual(decodeObjectives(ENCOUNTER_OFFERED_GAME_PORT), decodeObjectives(ENCOUNTER_OFFERED_GATEWAY));
  // Read some seconds apart: only the bonus time left differs.
  const port = decodeObjectives(ENCOUNTER_ACCEPTED_GAME_PORT) as MissionObjectives;
  const gateway = decodeObjectives(ENCOUNTER_ACCEPTED_GATEWAY) as MissionObjectives;
  assert.deepEqual({ ...port, bonusRewards: [] }, { ...gateway, bonusRewards: [] });
  assert.ok((port.bonusRewards[0]?.timeRemaining ?? 0n) > 71_000_000_000n);
});

test("no answer is no mission", () => {
  assert.equal(decodeObjectives(null), null);
  assert.equal(decodeObjectives(undefined), null);
  assert.equal(decodeObjectives(list()), null);
  assert.equal(decodeObjectives("objectives" as JsonValue), null);
});

test("an objective to fetch something, and one to speak with an agent", () => {
  const read = decoded([["objectives", list(
    tuple("fetch", tuple(1000002, dict([["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004]]), dict([["typeID", 1230], ["quantity", 4000], ["volume", 0.1], ["hasCargo", 1]]))),
    // A fetch with nowhere named: the client shows the owner in its place.
    tuple("fetch", tuple(1000002, null, dict([["typeID", 1230], ["quantity", 1], ["volume", 0], ["hasCargo", false]]))),
    tuple("agent", tuple(3008417, dict([["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004], ["locationType", "agenthomebase"]]))),
    // A kind the client's window does not draw.
    tuple("riddle", tuple(1, 2)),
  )]]);
  // Whether the cargo is aboard, sent as a truth or as a number.
  const aboard = (hasCargo: unknown) => (decoded([["objectives", list(tuple("fetch", tuple(1, null, dict([["typeID", 1], ["quantity", 1], ["volume", 0], ["hasCargo", hasCargo]]))))]]).objectives[0] as { cargo: { hasCargo: boolean } }).cargo.hasCargo;
  assert.deepEqual([true, 1, false, 0, null].map(aboard), [true, true, false, false, false]);
  assert.deepEqual(read.objectives, [
    { kind: "fetch", dropoffOwnerID: 1000002, dropoff: { locationID: 60000004, solarsystemID: 30002780, typeID: 1531, locationType: null, shipTypeID: null }, cargo: { typeID: 1230, quantity: 4000, volume: 0.1, hasCargo: true } },
    { kind: "fetch", dropoffOwnerID: 1000002, dropoff: null, cargo: { typeID: 1230, quantity: 1, volume: 0, hasCargo: false } },
    { kind: "agent", agentID: 3008417, location: { locationID: 60000004, solarsystemID: 30002780, typeID: 1531, locationType: "agenthomebase", shipTypeID: null } },
  ]);
});

test("a dungeon's state: over or not, done or failed, optional, restricted, and a ship to go to", () => {
  const base: Array<[string, unknown]> = [["dungeonID", 3030], ["optional", false], ["objectiveCompleted", null], ["location", dict([["locationID", 1], ["solarsystemID", 2], ["typeID", 5]])]];
  const dungeonWith = (entries: Array<[string, unknown]>) =>
    decoded([["dungeons", list(dict([...base.filter(([name]) => !entries.some(([given]) => given === name)), ...entries]))]]).dungeons[0]!;
  // While the dungeon is not over the server names no completion status.
  assert.equal(dungeonWith([]).completionStatus, null);
  assert.equal(dungeonWith([["completionStatus", 1]]).completionStatus, 1);
  assert.equal(dungeonWith([["completionStatus", 0]]).completionStatus, 0);
  assert.equal(dungeonWith([["objectiveCompleted", 1]]).objectiveCompleted, 1);
  assert.equal(dungeonWith([["objectiveCompleted", 0]]).objectiveCompleted, 0);
  assert.equal(dungeonWith([["objectiveCompleted", true]]).objectiveCompleted, 1);
  assert.equal(dungeonWith([["optional", true]]).optional, true);
  assert.equal(dungeonWith([["optional", 1]]).optional, true);
  assert.equal(dungeonWith([]).shipRestrictions, null);
  assert.equal(dungeonWith([["shipRestrictions", 1]]).shipRestrictions, 1);
  assert.equal(dungeonWith([["shipRestrictions", 0]]).shipRestrictions, 0);
  assert.equal(dungeonWith([]).ownerID, null);
  assert.equal(dungeonWith([]).briefingMessage, null);
  assert.equal(dungeonWith([["location", dict([["locationID", 9], ["solarsystemID", 2], ["typeID", 5], ["shipTypeID", 606]])]]).location?.shipTypeID, 606);
  // Not a dungeon at all.
  assert.deepEqual(decoded([["dungeons", list(7, null, "x")]]).dungeons, []);
});

test("what a dungeon's agent says of it: text, a message's number, or a label with its arguments", () => {
  const said = (message: unknown) => decoded([["dungeons", list(dict([["dungeonID", 1], ["optional", false], ["objectiveCompleted", null], ["briefingMessage", message]]))]]).dungeons[0]!.briefingMessage;
  const none = { messageID: null, label: null, parameters: null, text: null, contentID: null };
  assert.deepEqual(said(tuple(115502, 13735)), { ...none, messageID: 115502, contentID: 13735 });
  assert.deepEqual(said([115502, 13735]), { ...none, messageID: 115502, contentID: 13735 });
  assert.deepEqual(said(tuple(115502, null)), { ...none, messageID: 115502 });
  assert.deepEqual(said(tuple("Go there.", 13735)), { ...none, text: "Go there.", contentID: 13735 });
  assert.deepEqual(said("Go there."), { ...none, text: "Go there." });
  const args = dict([["dungeonLocationID", 30002779]]);
  assert.deepEqual(said(tuple(tuple("UI/Agents/Some/Label", args), 13735)), { ...none, label: "UI/Agents/Some/Label", parameters: args, contentID: 13735 });
  // What the client's ProcessMessage would not make a message of.
  assert.equal(said(tuple(0, 13735)), null);
  assert.equal(said(tuple(115502)), null);
  assert.equal(said(115502), null);
  assert.equal(said(null), null);
});

test("what is handed over, paid and held: only what there is some of, and more ISK than a number holds", () => {
  const read = decoded([
    ["agentGift", list(tuple(2595, 1, null), tuple(34, 0, null), tuple(3008417, 1, null))],
    ["normalRewards", list(tuple(29, { type: "long", value: "90071992547409930" }, null), tuple(34, 500, dict([["specificItemID", 9001]])), tuple(1230, -5, null))],
    ["collateral", list(tuple(29, 250000, null))],
    ["bonusRewards", list(tuple(-600000000, 29, 80000, null, 120), tuple(72000000000, 34, 0, null, 120), tuple(1, 687, 1, dict([["blueprintInfo", dict([["copy", 1]])]]), null))],
    ["loyaltyPoints", 213],
    ["researchPoints", { type: "real", value: 12.5 }],
  ]);
  assert.deepEqual(read.agentGift, [{ typeID: 2595, quantity: "1", specificItem: false, blueprint: false }, { typeID: 3008417, quantity: "1", specificItem: false, blueprint: false }]);
  assert.deepEqual(read.normalRewards, [
    { typeID: 29, quantity: "90071992547409930", specificItem: false, blueprint: false },
    { typeID: 34, quantity: "500", specificItem: true, blueprint: false },
  ]);
  assert.deepEqual(read.collateral, [{ typeID: 29, quantity: "250000", specificItem: false, blueprint: false }]);
  assert.deepEqual(read.bonusRewards, [
    { typeID: 29, quantity: "80000", specificItem: false, blueprint: false, timeRemaining: -600_000_000n, timeBonusIntervalMin: 120 },
    { typeID: 687, quantity: "1", specificItem: false, blueprint: true, timeRemaining: 1n, timeBonusIntervalMin: null },
  ]);
  assert.equal(read.loyaltyPoints, 213);
  assert.equal(read.researchPoints, 12.5);
});

test("the mission's name as text, its warning, its extra, and where it leads", () => {
  const read = decoded([["missionTitleID", "A Mission With A Plain Name"], ["importantStandings", 1], ["missionExtra", tuple(58700, 58701)], ["locations", list(30002780, 0, null, 30002778)]]);
  assert.equal(read.missionTitle, "A Mission With A Plain Name");
  assert.equal(read.missionTitleID, null);
  // Text is a name even when it is all digits: the client asks whether it is a string, not what is in it.
  const digits = decoded([["missionTitleID", "2001"]]);
  assert.equal(digits.missionTitle, "2001");
  assert.equal(digits.missionTitleID, null);
  assert.equal(read.importantStandings, true);
  assert.deepEqual(read.missionExtra, { headerID: 58700, bodyID: 58701 });
  assert.deepEqual(read.locations, [30002780, 30002778]);
  const plain = decoded([]);
  assert.equal(plain.importantStandings, false);
  assert.equal(plain.missionExtra, null);
  assert.equal(decoded([["importantStandings", true]]).importantStandings, true);
  assert.equal(decoded([["missionExtra", null]]).missionExtra, null);
  // An answer that leaves things out reads as none of them.
  assert.deepEqual(decodeObjectives(dict([["missionState", 2]])), {
    importantStandings: false, missionTitleID: null, missionTitle: null, completionStatus: 0, missionState: 2, contentID: null, objectives: [], dungeons: [], locations: [],
    agentGift: [], normalRewards: [], loyaltyPoints: 0, researchPoints: 0, bonusRewards: [], collateral: [], missionExtra: null,
  });
});

test("the pane's heading goes by the mission's state: failed first, then finished, then open", () => {
  const heading = (completionStatus: number, missionState: number | null) => objectivesHeading(decoded([["completionStatus", completionStatus], ["missionState", missionState]]));
  assert.equal(AGENT_MISSION_STATE_FAILED, 3);
  assert.equal(heading(0, 1), "open");
  assert.equal(heading(0, 2), "open");
  assert.equal(heading(1, 2), "complete");
  assert.equal(heading(2, 2), "complete");
  assert.equal(heading(0, 3), "failed");
  assert.equal(heading(1, 3), "failed");
  assert.equal(heading(0, null), "open");
});
