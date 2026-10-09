// A place's name with its system's security rating before it. The templates are made up, in the shape the
// client's are in.

import test from "node:test";
import assert from "node:assert/strict";

import { LOCATION_LABELS, LOCATION_WORD_LABELS, objectiveSystemIDs, wrapLocation } from "./locationWrapper.ts";
import { decodeObjectives, type MissionObjectives } from "./missionObjectives.ts";
import { COURIER_OFFERED_GATEWAY, ENCOUNTER_OFFERED_GATEWAY } from "./missionObjectives.fixtures.ts";
import type { JsonValue } from "./wire.ts";

const TEMPLATES: Record<string, string> = {
  [LOCATION_LABELS.wrapper]: "{startFontTag}{[numeric]securityRating, decimalPlaces=1}{endFontTag}{image}&nbsp;{locationName, linkinfo=linkdata} {securityWarning}",
  [LOCATION_LABELS.lowSecWarning]: "<b>(mind how you go)</b>",
};
const SECURITY: Record<number, number> = { 30002780: 0.708087, 30002778: 0.830855, 30000001: 0.3, 30000002: -0.36, 30000003: 0.0001, 30000004: 1 };
const securityOf = (id: number): number | null => SECURITY[id] ?? null;
const wrap = (name: string, systemID: number | null, templates: Record<string, string> = TEMPLATES) => wrapLocation(name, systemID, templates, securityOf);

test("the labels are the client's", () => {
  assert.deepEqual(LOCATION_LABELS, { wrapper: "UI/Agents/LocationWrapper", lowSecWarning: "UI/Agents/LowSecWarning" });
  assert.deepEqual([...LOCATION_WORD_LABELS].sort(), ["UI/Agents/LocationWrapper", "UI/Agents/LowSecWarning"]);
});

test("a place is written with its system's security rating before it, to one decimal place, as plain text", () => {
  assert.equal(wrap("Some Station", 30002780), "0.7 Some Station");
  assert.equal(wrap("Another Station", 30002778), "0.8 Another Station");
  assert.equal(wrap("The Safest", 30000004), "1.0 The Safest");
});

test("where the system is low security or lower there is a warning after the name", () => {
  assert.equal(wrap("A Risky Station", 30000001), "0.3 A Risky Station (mind how you go)");
  assert.equal(wrap("Nowhere Good", 30000002), "-0.4 Nowhere Good (mind how you go)");
  // The least security above nought shows as 0.1, and is low.
  assert.equal(wrap("Barely Anywhere", 30000003), "0.1 Barely Anywhere (mind how you go)");
  // Without the client's words for the warning the rating still stands, and nothing is put in their place.
  assert.equal(wrap("A Risky Station", 30000001, { [LOCATION_LABELS.wrapper]: TEMPLATES[LOCATION_LABELS.wrapper]! }), "0.3 A Risky Station");
});

test("a place whose system's security is not known, or with no wrapper to hand, is its name alone", () => {
  assert.equal(wrap("Some Station", 30009999), "Some Station");
  assert.equal(wrap("Some Station", null), "Some Station");
  assert.equal(wrap("Some Station", 30002780, {}), "Some Station");
  assert.equal(wrap("Some Station", 30002780, { [LOCATION_LABELS.lowSecWarning]: "warn" }), "Some Station");
  // Nothing is asked about a place that names no system.
  let asked = 0;
  wrapLocation("Some Station", null, TEMPLATES, () => { asked += 1; return 0.5; });
  assert.equal(asked, 0);
});

test("the systems a mission's places are in: each once, in the order they are met", () => {
  const dict = (entries: Array<[string, unknown]>) => ({ type: "dict", entries }) as unknown as JsonValue;
  const tuple = (...items: unknown[]) => ({ type: "tuple", items }) as unknown as JsonValue;
  const list = (...items: unknown[]) => ({ type: "list", items }) as unknown as JsonValue;
  const place = (locationID: number, solarsystemID: number | null) => dict([["locationID", locationID], ["solarsystemID", solarsystemID], ["typeID", 1531]]);
  const cargo = dict([["typeID", 2595], ["quantity", 1], ["volume", 0.1], ["hasCargo", false]]);
  const objectives = decodeObjectives(dict([
    ["contentID", 1], ["missionState", 2],
    ["objectives", list(tuple("agent", tuple(3009999, place(60000019, 30002778))), tuple("transport", tuple(1, place(60000004, 30002780), 1, place(60000019, 30002778), cargo)), tuple("fetch", tuple(1, place(60000099, 30000001), cargo)))],
    ["dungeons", list(dict([["dungeonID", 1], ["location", place(30002779, 30002779)]]), dict([["dungeonID", 2], ["location", place(1, null)]]), dict([["dungeonID", 3]]))],
  ])) as MissionObjectives;
  assert.deepEqual(objectiveSystemIDs(objectives), [30002778, 30002780, 30000001, 30002779]);
  assert.deepEqual(objectiveSystemIDs(decodeObjectives(COURIER_OFFERED_GATEWAY) as MissionObjectives), [30002780, 30002778]);
  assert.deepEqual(objectiveSystemIDs(decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) as MissionObjectives), [30002779]);
});
