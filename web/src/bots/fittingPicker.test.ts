import test from "node:test";
import assert from "node:assert/strict";

import { fittingPickerGroups, type PickerFitting } from "./fittingPicker.ts";

const FITS: readonly PickerFitting[] = [
  { fittingID: 1, name: "T1 Ice", shipTypeID: 17478, shipName: "Retriever", source: "corporation" },
  { fittingID: 2, name: "T1 Ore", shipTypeID: 17478, shipName: "Retriever", source: "corporation" },
  { fittingID: 3, name: "T1", shipTypeID: 593, shipName: "Tristan", source: "corporation" },
  { fittingID: 4, name: "T1 Drone", shipTypeID: 593, shipName: "Tristan", source: "corporation" },
];

const shape = (groups: ReturnType<typeof fittingPickerGroups>) =>
  groups.map((g) => [g.label, g.fittings.map((f) => f.label)]);

test("fits are grouped under their hull, hulls and fits sorted by name", () => {
  assert.deepEqual(shape(fittingPickerGroups(FITS, "", null)), [
    ["Retriever", ["T1 Ice", "T1 Ore"]],
    ["Tristan", ["T1", "T1 Drone"]],
  ]);
});

test("the filter matches the hull or the fit name, every word, any case", () => {
  assert.deepEqual(shape(fittingPickerGroups(FITS, "tristan", null)), [["Tristan", ["T1", "T1 Drone"]]]);
  assert.deepEqual(shape(fittingPickerGroups(FITS, "ice", null)), [["Retriever", ["T1 Ice"]]]);
  assert.deepEqual(shape(fittingPickerGroups(FITS, "retr  ORE", null)), [["Retriever", ["T1 Ore"]]]);
  assert.deepEqual(shape(fittingPickerGroups(FITS, "nothing", null)), []);
});

test("the picked fit survives a filter that would hide it", () => {
  assert.deepEqual(shape(fittingPickerGroups(FITS, "tristan", 1)), [
    ["Retriever", ["T1 Ice"]],
    ["Tristan", ["T1", "T1 Drone"]],
  ]);
});

test("corp fits are marked only when personal fits are offered too", () => {
  const mixed = [...FITS, { fittingID: 9, name: "Mine", shipTypeID: 17478, shipName: "Retriever", source: "personal" as const }];
  assert.deepEqual(shape(fittingPickerGroups(mixed, "retriever", null)), [
    ["Retriever", ["Mine", "T1 Ice (corp)", "T1 Ore (corp)"]],
  ]);
});

test("a hull with no resolved name is headed by its type id", () => {
  assert.deepEqual(shape(fittingPickerGroups([{ fittingID: 5, name: "X", shipTypeID: 626 }], "626", null)), [
    ["Ship type 626", ["X"]],
  ]);
});
