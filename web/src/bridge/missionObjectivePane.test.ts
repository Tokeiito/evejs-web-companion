// The objectives pane laid out. The templates are made up, in the shape the client's are in; the client's
// own are read from its install. The missions are the recorded ones (missionObjectives.fixtures.ts).

import test from "node:test";
import assert from "node:assert/strict";

import { PANE_LABELS, PANE_WORD_LABELS, objectivePane, paneMessageIDs, paneNameRefs, type PaneBlock, type PaneContext } from "./missionObjectivePane.ts";
import { decodeObjectives, type MissionObjectives } from "./missionObjectives.ts";
import { COURIER_OFFERED_GATEWAY, ENCOUNTER_ACCEPTED_GATEWAY, ENCOUNTER_OFFERED_GATEWAY } from "./missionObjectives.fixtures.ts";
import { INTERVAL_LABELS, INTERVAL_WORD_LABELS } from "./timeInterval.ts";
import type { JsonValue } from "./wire.ts";

const L = PANE_LABELS;
const TEMPLATES: Record<string, string> = {
  [L.importantStandings]: "<b><i>This one counts.</i></b>",
  [L.heading.open]: "{missionName}: to do",
  [L.heading.complete]: "{missionName}: done",
  [L.heading.failed]: "{missionName}: lost",
  [L.overview]: "Do all of these.",
  [L.reportToAgent]: "See {[character]agentID.name}",
  [L.agentLocation]: "Where",
  [L.transportHeader]: "Carry",
  [L.transportBlurb]: "Carry these:",
  [L.transportPickup]: "From",
  [L.transportDropOff]: "To",
  [L.transportCargo]: "Load",
  [L.fetchHeader]: "Bring",
  [L.fetchBlurb]: "Bring this:",
  [L.fetchDropOff]: "Bring to",
  [L.fetchItem]: "Thing",
  [L.cargoWithSize]: "{cargoDescription} ({[numeric]size, decimalPlaces=1} m3)",
  [L.objectiveHeader]: "Target",
  [L.optionalHeader]: "Target, if you like",
  [L.dungeonBody]: "Destroy them.",
  [L.optionalBody]: "Destroy them, if you like.",
  [L.dungeonCompleted]: '<font color="#E000FF00">Won</font>',
  [L.dungeonFailed]: '<font color="#E0FF0000">Lost</font>',
  [L.objectiveLocation]: "Place",
  [L.grantedItems]: "Given",
  [L.grantedDetail]: "You will be given:",
  [L.grantedDetailAccepted]: "You were given:",
  [L.referral]: "A word to {[character]agentID.name}",
  [L.rewardsTitle]: "Pay",
  [L.rewardsHeader]: "Yours when it is done:",
  [L.loyaltyPoints]: "{[numeric]lpAmount, useGrouping} points",
  [L.researchPoints]: "{[numeric]rpAmount, useGrouping} research",
  [L.bonusTitle]: "Extra",
  [L.bonusHeader]: "If done within {[timeinterval]timeRemaining.writtenForm, to=minute}:",
  [L.bonusPassed]: "<font color=#E3170D>Too late for this:</font>",
  [L.collateralTitle]: "Held",
  [L.collateralHeader]: "Taken from you until it is done:",
  [L.isk]: "{[numeric]amount, useGrouping, decimalPlaces=2} ISK",
  [L.itemLocation]: "{[item]typeID.name} in {[location]locationID.name}",
  [L.quantityAndItem]: "{[numeric]quantity, useGrouping} x {[item]item.name}",
  [INTERVAL_LABELS.part("hour")]: '{[numeric]units} {[numeric]units-> "hr", "hrs"}',
  [INTERVAL_LABELS.part("minute")]: '{[numeric]units} {[numeric]units-> "mn", "mns"}',
  [INTERVAL_LABELS.lessThanOne("minute")]: "under a minute",
  [INTERVAL_LABELS.listForm]: "{firstPart} plus {secondPart}",
  [INTERVAL_LABELS.delimiter]: "; ",
};

const context = (overrides: Partial<PaneContext> = {}): PaneContext => ({
  templates: TEMPLATES,
  nameOf: (kind, id) => `${kind}#${id}`,
  locationID: null,
  messageText: (messageID) => `Mission ${messageID}`,
  say: (message) => (message.messageID === null ? message.text : `Message ${message.messageID} of ${message.contentID}`),
  securityOf: () => null,
  ...overrides,
});
const mission = (fixture: JsonValue): MissionObjectives => decodeObjectives(fixture) as MissionObjectives;
/** A block without the objective it carries, for comparing. */
const bare = (blocks: PaneBlock[]) => blocks.map(({ objective: _objective, ...block }) => block);

const dict = (entries: Array<[string, unknown]>) => ({ type: "dict", entries }) as unknown as JsonValue;
const tuple = (...items: unknown[]) => ({ type: "tuple", items }) as unknown as JsonValue;
const list = (...items: unknown[]) => ({ type: "list", items }) as unknown as JsonValue;
function madeUp(entries: Array<[string, unknown]>): MissionObjectives {
  const base: Array<[string, unknown]> = [
    ["completionStatus", 0], ["collateral", list()], ["dungeons", list()], ["objectives", list()], ["locations", list()], ["importantStandings", 0],
    ["contentID", 2156], ["agentGift", list()], ["normalRewards", list()], ["bonusRewards", list()], ["researchPoints", 0], ["missionState", 1],
    ["loyaltyPoints", 0], ["missionTitleID", 58607],
  ];
  return mission(dict([...base.filter(([name]) => !entries.some(([given]) => given === name)), ...entries]));
}

test("a courier on offer, in the client's order: heading, overview, the transport, pay, and extra for being quick", () => {
  const blocks = objectivePane(mission(COURIER_OFFERED_GATEWAY), context());
  assert.deepEqual(bare(blocks), [
    { kind: "heading", state: "open", cheated: false, title: "Mission 57959: to do", text: null, rows: [] },
    { kind: "overview", title: null, text: "Do all of these.", rows: [] },
    {
      kind: "objective", title: "Carry", text: "Carry these:",
      rows: [
        { mark: "open", label: "From", text: "station#60000004" },
        { mark: "open", label: "To", text: "station#60000019" },
        { mark: "open", label: "Load", text: "1 x type#2595 (0.1 m3)" },
      ],
    },
    { kind: "items", title: "Pay", text: "Yours when it is done:", rows: [{ mark: null, label: null, text: "13,800.00 ISK" }, { mark: null, label: null, text: "49 points" }] },
    { kind: "items", title: "Extra", text: null, rows: [{ mark: null, label: "If done within 1 hr:", text: "17,000.00 ISK" }] },
  ]);
  // The block says which objective it is for, so the page can put the package's buttons beside it.
  assert.equal(blocks[2]?.objective?.kind, "transport");
});

test("a transport's marks go by where the pilot is and whether the cargo is aboard", () => {
  const marks = (locationID: number | null, hasCargo: boolean) => {
    const courier = mission(COURIER_OFFERED_GATEWAY);
    const transport = courier.objectives[0] as Extract<MissionObjectives["objectives"][number], { kind: "transport" }>;
    const changed = { ...courier, objectives: [{ ...transport, cargo: { ...transport.cargo!, hasCargo } }] };
    return objectivePane(changed, context({ locationID }))[2]!.rows.map((row) => row.mark);
  };
  // Elsewhere, nothing aboard.
  assert.deepEqual(marks(null, false), ["open", "open", "open"]);
  assert.deepEqual(marks(30002780, false), ["open", "open", "open"]);
  // At the pickup: there, and nothing else yet.
  assert.deepEqual(marks(60000004, false), ["done", "open", "open"]);
  // Aboard, on the way: picked up, and the cargo.
  assert.deepEqual(marks(30002778, true), ["done", "open", "done"]);
  // At the dropoff with it: all three.
  assert.deepEqual(marks(60000019, true), ["done", "done", "done"]);
  // At the dropoff without it: not delivered, and not picked up.
  assert.deepEqual(marks(60000019, false), ["open", "open", "open"]);
});

test("a fighting mission: its dungeon in the agent's own words, with its place, then pay and extra", () => {
  assert.deepEqual(bare(objectivePane(mission(ENCOUNTER_OFFERED_GATEWAY), context())), [
    { kind: "heading", state: "open", cheated: false, title: "Mission 57212: to do", text: null, rows: [] },
    { kind: "overview", title: null, text: "Do all of these.", rows: [] },
    { kind: "objective", title: "Target", text: "Message 115502 of 13735", outcome: null, rows: [{ mark: "open", label: "Place", text: "system#30002779" }] },
    { kind: "items", title: "Pay", text: "Yours when it is done:", rows: [{ mark: null, label: null, text: "65,000.00 ISK" }, { mark: null, label: null, text: "87 points" }] },
    { kind: "items", title: "Extra", text: null, rows: [{ mark: null, label: "If done within 2 hrs:", text: "80,000.00 ISK" }] },
  ]);
  // Accepted a moment ago: 1 hour 59 minutes and some seconds of the bonus are left, and seconds are not written.
  const accepted = objectivePane(mission(ENCOUNTER_ACCEPTED_GATEWAY), context());
  assert.equal(accepted[4]?.rows[0]?.label, "If done within 1 hr plus 59 mns:");
});

test("a dungeon's words, marks and outcome", () => {
  const dungeonBlock = (entries: Array<[string, unknown]>, mission: Array<[string, unknown]> = []) => {
    const base: Array<[string, unknown]> = [["dungeonID", 3030], ["optional", false], ["objectiveCompleted", null], ["location", dict([["locationID", 30002779], ["solarsystemID", 30002779], ["typeID", 5]])]];
    return bare(objectivePane(madeUp([["dungeons", list(dict([...base.filter(([name]) => !entries.some(([given]) => given === name)), ...entries]))], ...mission]), context()))[2]!;
  };
  // No words of the agent's own: the stock ones, and the optional ones for an optional dungeon.
  assert.deepEqual(dungeonBlock([]), { kind: "objective", title: "Target", text: "Destroy them.", outcome: null, rows: [{ mark: "open", label: "Place", text: "system#30002779" }] });
  assert.deepEqual(dungeonBlock([["optional", true]]), { kind: "objective", title: "Target, if you like", text: "Destroy them, if you like.", outcome: null, rows: [{ mark: "open", label: "Place", text: "system#30002779" }] });
  // The agent's own words, as text and as a message; and the stock ones when the message cannot be had.
  assert.equal(dungeonBlock([["briefingMessage", tuple("Go and look.", 2156)]]).text, "Go and look.");
  assert.equal(dungeonBlock([["briefingMessage", tuple(115502, 2156)]]).text, "Message 115502 of 2156");
  // Done, failed, and over.
  assert.equal(dungeonBlock([["objectiveCompleted", 1]]).rows[0]?.mark, "done");
  assert.equal(dungeonBlock([["objectiveCompleted", 0]]).rows[0]?.mark, "failed");
  assert.equal(dungeonBlock([["completionStatus", 1]]).outcome, "Won");
  assert.equal(dungeonBlock([["completionStatus", 0]]).outcome, "Lost");
  // A failed mission's dungeons are failed, whatever they say of themselves.
  const lost = dungeonBlock([["objectiveCompleted", 1], ["completionStatus", 1]], [["missionState", 3]]);
  assert.equal(lost.outcome, "Lost");
  assert.equal(lost.rows[0]?.mark, "failed");
  // A ship in space to go to is worded by its type and where it is.
  assert.equal(dungeonBlock([["location", dict([["locationID", 30002779], ["solarsystemID", 30002779], ["typeID", 5], ["shipTypeID", 606]])]]).rows[0]?.text, "type#606 in system#30002779");
});

test("a dungeon whose message cannot be had falls back on the stock words", () => {
  const blocks = objectivePane(mission(ENCOUNTER_OFFERED_GATEWAY), context({ say: () => null }));
  assert.equal(blocks[2]?.text, "Destroy them.");
});

test("bringing a thing, and reporting to an agent", () => {
  const station = dict([["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004]]);
  const blocks = (locationID: number | null) => bare(objectivePane(madeUp([["objectives", list(
    tuple("fetch", tuple(1000002, station, dict([["typeID", 1230], ["quantity", 4000], ["volume", 0], ["hasCargo", true]]))),
    tuple("fetch", tuple(1000002, null, dict([["typeID", 1230], ["quantity", 1], ["volume", 2.5], ["hasCargo", false]]))),
    tuple("agent", tuple(3008417, station)),
  )]]), context({ locationID }))).slice(2);
  assert.deepEqual(blocks(60000004), [
    // There, with it. No volume is written for a cargo of none.
    { kind: "objective", title: "Bring", text: "Bring this:", rows: [{ mark: "done", label: "Bring to", text: "station#60000004" }, { mark: "done", label: "Thing", text: "4,000 x type#1230" }] },
    // Nowhere named: whom to bring it to.
    { kind: "objective", title: "Bring", text: "Bring this:", rows: [{ mark: "open", label: "Bring to", text: "owner#1000002" }, { mark: "open", label: "Thing", text: "1 x type#1230 (2.5 m3)" }] },
    { kind: "objective", title: "See owner#3008417", text: null, rows: [{ mark: null, label: "Where", text: "station#60000004" }] },
  ]);
  assert.equal(blocks(null)[0]?.rows[0]?.mark, "open");
});

test("the heading says finished or failed, and a mission a game master finished says so", () => {
  const heading = (completionStatus: number, missionState: number) => objectivePane(madeUp([["completionStatus", completionStatus], ["missionState", missionState]]), context())[0];
  assert.deepEqual(heading(0, 2), { kind: "heading", state: "open", cheated: false, title: "Mission 58607: to do", text: null, rows: [] });
  assert.deepEqual(heading(1, 2), { kind: "heading", state: "complete", cheated: false, title: "Mission 58607: done", text: null, rows: [] });
  assert.deepEqual(heading(2, 2), { kind: "heading", state: "complete", cheated: true, title: "Mission 58607: done", text: null, rows: [] });
  assert.deepEqual(heading(0, 3), { kind: "heading", state: "failed", cheated: false, title: "Mission 58607: lost", text: null, rows: [] });
  // A name sent as text is the name.
  assert.equal(objectivePane(madeUp([["missionTitleID", "A Plain Name"]]), context())[0]?.title, "A Plain Name: to do");
});

test("the warning comes first; what is given, held and paid each has its section, in the client's order", () => {
  const blocks = bare(objectivePane(madeUp([
    ["importantStandings", 1],
    ["missionState", 2],
    ["agentGift", list(tuple(2595, 1, null), tuple(3008417, 1, null))],
    ["normalRewards", list(tuple(29, 65000, null), tuple(34, 5000, null))],
    ["loyaltyPoints", 1213],
    ["researchPoints", { type: "real", value: 12.5 }],
    ["bonusRewards", list(tuple(-1, 29, 80000, null, 120), tuple(72000000000, 34, 10, null, 120))],
    ["collateral", list(tuple(29, 250000, null))],
    ["missionExtra", tuple(58700, 58701)],
  ]), context()));
  assert.deepEqual(blocks.map((block) => [block.kind, block.title]), [
    ["warning", null], ["heading", "Mission 58607: to do"], ["overview", null], ["items", "Given"], ["items", "Pay"], ["items", "Extra"], ["items", "Held"], ["items", "Message 58700 of 2156"],
  ]);
  assert.equal(blocks[0]?.text, "This one counts.");
  // Accepted: what was given, not what will be. An agent among the gifts is a referral.
  assert.deepEqual(blocks[3], { kind: "items", title: "Given", text: "You were given:", rows: [{ mark: null, label: null, text: "1 x type#2595" }, { mark: null, label: null, text: "A word to owner#3008417" }] });
  assert.deepEqual(blocks[4]?.rows.map((row) => row.text), ["65,000.00 ISK", "5,000 x type#34", "1,213 points", "13 research"]);
  // A bonus whose time has passed says so, in place of how long is left.
  assert.deepEqual(blocks[5]?.rows, [{ mark: null, label: "Too late for this:", text: "80,000.00 ISK" }, { mark: null, label: "If done within 2 hrs:", text: "10 x type#34" }]);
  assert.deepEqual(blocks[6], { kind: "items", title: "Held", text: "Taken from you until it is done:", rows: [{ mark: null, label: null, text: "250,000.00 ISK" }] });
  assert.deepEqual(blocks[7], { kind: "items", title: "Message 58700 of 2156", text: "Message 58701 of 2156", rows: [] });
  // On offer: what will be given.
  const offered = bare(objectivePane(madeUp([["agentGift", list(tuple(2595, 1, null))]]), context()));
  assert.equal(offered[2]?.text, "You will be given:");
  // Failed counts as accepted for that.
  assert.equal(bare(objectivePane(madeUp([["agentGift", list(tuple(2595, 1, null))], ["missionState", 3]]), context()))[2]?.text, "You were given:");
});

test("nothing to pay, nothing given: no such sections", () => {
  const blocks = objectivePane(madeUp([]), context());
  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "overview"]);
  // Loyalty points alone make a rewards section.
  assert.deepEqual(bare(objectivePane(madeUp([["loyaltyPoints", 5]]), context()))[2], { kind: "items", title: "Pay", text: "Yours when it is done:", rows: [{ mark: null, label: null, text: "5 points" }] });
});

test("without the client's words for the heading there is no pane; without a block's words, that block is left out", () => {
  const without = (...labels: string[]) => Object.fromEntries(Object.entries(TEMPLATES).filter(([name]) => !labels.includes(name)));
  const courier = mission(COURIER_OFFERED_GATEWAY);
  assert.deepEqual(objectivePane(courier, context({ templates: {} })), []);
  assert.deepEqual(objectivePane(courier, context({ templates: without(L.heading.open) })), []);
  // The mission's name cannot be had.
  assert.deepEqual(objectivePane(courier, context({ messageText: () => null })), []);
  // The overview's words are missing: the rest stands.
  assert.deepEqual(objectivePane(courier, context({ templates: without(L.overview) })).map((block) => block.kind), ["heading", "objective", "items", "items"]);
  // A section's title is missing: no section.
  assert.deepEqual(objectivePane(courier, context({ templates: without(L.rewardsTitle) })).map((block) => block.title), ["Mission 57959: to do", null, "Carry", "Extra"]);
  // The words for ISK are missing: that row is left out, the loyalty points stay.
  assert.deepEqual(objectivePane(courier, context({ templates: without(L.isk) }))[3]?.rows.map((row) => row.text), ["49 points"]);
  // A cargo's size cannot be worded: the cargo is written without it.
  assert.equal(objectivePane(courier, context({ templates: without(L.cargoWithSize) }))[2]?.rows[2]?.text, "1 x type#2595");
});

test("the names and messages the pane needs, to be fetched before it is drawn", () => {
  assert.deepEqual(paneNameRefs(mission(COURIER_OFFERED_GATEWAY)), [{ kind: "station", id: 60000004 }, { kind: "station", id: 60000019 }, { kind: "type", id: 2595 }]);
  assert.deepEqual(paneNameRefs(mission(ENCOUNTER_OFFERED_GATEWAY)), [{ kind: "system", id: 30002779 }]);
  assert.deepEqual(paneMessageIDs(mission(ENCOUNTER_OFFERED_GATEWAY)), [57212]);
  assert.deepEqual(paneMessageIDs(madeUp([["missionTitleID", "A Plain Name"]])), []);
  const station = dict([["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004], ["shipTypeID", 606]]);
  assert.deepEqual(paneNameRefs(madeUp([
    ["objectives", list(tuple("agent", tuple(3008417, station)), tuple("fetch", tuple(1000002, null, dict([["typeID", 1230], ["quantity", 1], ["volume", 0], ["hasCargo", false]]))))],
    ["agentGift", list(tuple(3008418, 1, null))],
    ["normalRewards", list(tuple(29, 5, null), tuple(34, 5, null))],
    ["bonusRewards", list(tuple(1, 35, 5, null, 1))],
    ["collateral", list(tuple(36, 5, null))],
  ])), [
    { kind: "owner", id: 3008417 }, { kind: "station", id: 60000004 }, { kind: "type", id: 606 },
    { kind: "owner", id: 1000002 }, { kind: "type", id: 1230 },
    { kind: "owner", id: 3008418 }, { kind: "type", id: 34 }, { kind: "type", id: 35 }, { kind: "type", id: 36 },
  ]);
});

test("the labels are the client's, and all of them are asked for", () => {
  assert.equal(L.heading.open, "UI/Agents/StandardMission/MissionObjectives");
  assert.equal(L.heading.complete, "UI/Agents/StandardMission/MissionObjectivesComplete");
  assert.equal(L.heading.failed, "UI/Agents/StandardMission/MissionObjectivesFailed");
  assert.equal(L.transportHeader, "UI/Agents/StandardMission/TransportObjectiveHeader");
  assert.equal(L.dungeonBody, "UI/Agents/StandardMission/DungeonObjectiveBody");
  assert.equal(L.isk, "UI/Util/FmtIsk");
  assert.equal(L.quantityAndItem, "UI/Common/QuantityAndItem");
  assert.equal(L.itemLocation, "UI/Agents/Items/ItemLocation");
  for (const label of Object.keys(TEMPLATES)) assert.ok(PANE_WORD_LABELS.includes(label), label);
  for (const label of INTERVAL_WORD_LABELS) assert.ok(PANE_WORD_LABELS.includes(label), label);
  assert.equal(new Set(PANE_WORD_LABELS).size, PANE_WORD_LABELS.length);
});

test("a transport that starts and ends in one place, and a thing to bring that is not aboard", () => {
  const here = dict([["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004]]);
  const cargo = (hasCargo: boolean) => dict([["typeID", 1230], ["quantity", 1], ["volume", 0], ["hasCargo", hasCargo]]);
  const marks = (objective: JsonValue, locationID: number | null) => objectivePane(madeUp([["objectives", list(objective)]]), context({ locationID }))[2]!.rows.map((row) => row.mark);
  // Docked where it is both picked up and dropped off, with nothing aboard yet: there for both, and no cargo.
  assert.deepEqual(marks(tuple("transport", tuple(1000002, here, 1000002, here, cargo(false))), 60000004), ["done", "done", "open"]);
  // At the place to bring it, without it; and with it, somewhere else.
  assert.deepEqual(marks(tuple("fetch", tuple(1000002, here, cargo(false))), 60000004), ["done", "open"]);
  assert.deepEqual(marks(tuple("fetch", tuple(1000002, here, cargo(true))), 30002780), ["open", "done"]);
  // A place the server does not name by ID is nowhere the pilot can be, even when where the pilot is is not known.
  assert.deepEqual(marks(tuple("fetch", tuple(1000002, dict([["typeID", 1531]]), cargo(false))), null), ["open", "open"]);
});

test("a place on the pane has its system's security rating before it, and a warning where that is low", () => {
  const WRAPPED = { ...TEMPLATES, "UI/Agents/LocationWrapper": "{startFontTag}{[numeric]securityRating, decimalPlaces=1}{endFontTag}{image}&nbsp;{locationName, linkinfo=linkdata} {securityWarning}", "UI/Agents/LowSecWarning": "(low!)" };
  const rows = (security: Record<number, number>) => objectivePane(mission(COURIER_OFFERED_GATEWAY), context({ templates: WRAPPED, securityOf: (id) => security[id] ?? null }))
    .flatMap((block) => block.rows).filter((row) => row.label === "From" || row.label === "To").map((row) => row.text);
  assert.deepEqual(rows({ 30002780: 0.708087, 30002778: 0.3 }), ["0.7 station#60000004", "0.3 station#60000019 (low!)"]);
  // A system whose security is not known yet: the name alone, as before.
  assert.deepEqual(rows({ 30002780: 0.708087 }), ["0.7 station#60000004", "station#60000019"]);
  assert.deepEqual(rows({}), ["station#60000004", "station#60000019"]);
  // The labels it is written with are asked for with the pane's own.
  assert.ok(PANE_WORD_LABELS.includes("UI/Agents/LocationWrapper"));
  assert.ok(PANE_WORD_LABELS.includes("UI/Agents/LowSecWarning"));
});
