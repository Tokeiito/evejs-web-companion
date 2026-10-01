// R109 slice 5: jobs against a plan.

import test from "node:test";
import assert from "node:assert/strict";

import { installFrom, jobSupply, startNext } from "./industryJobs.ts";
import { decodeRecipeClosure } from "./industryRecipes.ts";
import { resolveIndustryChain } from "./industryChain.ts";
import type { IndustryJobRow } from "../store/types.ts";
import type { OwnedBlueprint } from "./industryOwned.ts";
import type { JsonValue } from "./wire.ts";

// Widget II <- Widget + Gizmo(reaction, 200/run) ; Widget <- Tritanium.
const BOOK = decodeRecipeClosure({
  recipes: [
    { productTypeID: 900, activity: "manufacturing", blueprintTypeID: 1900, quantityPerRun: 1,
      materials: [{ typeID: 101, quantity: 1 }, { typeID: 102, quantity: 2 }], inventedFrom: [] },
    { productTypeID: 101, activity: "manufacturing", blueprintTypeID: 1101, quantityPerRun: 1,
      materials: [{ typeID: 34, quantity: 10 }], inventedFrom: [] },
    { productTypeID: 102, activity: "reaction", blueprintTypeID: 1102, quantityPerRun: 200,
      materials: [{ typeID: 202, quantity: 100 }], inventedFrom: [] },
  ],
  types: {},
} as unknown as JsonValue);

function job(overrides: Partial<IndustryJobRow>): IndustryJobRow {
  return {
    jobID: 1,
    activity: "manufacturing",
    status: "running",
    blueprintID: 1,
    blueprintTypeID: 1101,
    productTypeID: 101,
    facilityID: 60000004,
    runs: 2,
    successfulRuns: 0,
    cost: 0,
    ...overrides,
  } as IndustryJobRow;
}

test("active jobs count as units of their product, once each, ready ones noted", () => {
  const supply = jobSupply([
    [job({ jobID: 1, runs: 2 }), job({ jobID: 2, productTypeID: 102, activity: "reaction", runs: 1, status: "ready" })],
    [job({ jobID: 1, runs: 2 })],
    [job({ jobID: 3, status: "delivered" }), job({ jobID: 4, activity: "copying" })],
  ], BOOK);
  assert.deepEqual([...supply.inProduction], [[101, 2], [102, 200]]);
  assert.deepEqual([...supply.ready], [[102, 200]]);
});

test("start next: stages in build order, and a step can start only with every input in hand", () => {
  const nothing = resolveIndustryChain({ book: BOOK, productTypeID: 900, runs: 4 });
  assert.ok(nothing);
  const groups = startNext(nothing);
  assert.deepEqual(groups.map((group) => group.label), ["Reactions", "Components", "Final"]);
  // Nothing is held: the reaction and the component wait on bought inputs.
  assert.deepEqual(groups.flatMap((group) => group.steps.map((step) => [step.line.typeID, step.canStart])), [
    [102, false],
    [101, false],
    [900, false],
  ]);

  const stocked = resolveIndustryChain({
    book: BOOK, productTypeID: 900, runs: 4,
    held: new Map([[34, 40], [202, 100]]),
    inProduction: new Map([[102, 200]]),
  });
  assert.ok(stocked);
  const steps = startNext(stocked).flatMap((group) => group.steps.map((step) => [step.line.typeID, step.canStart]));
  // The reaction is already running, so it is not listed; Widgets can start;
  // the final step waits for them.
  assert.deepEqual(steps, [[101, true], [900, false]]);
});

test("installFrom: an idle copy in a facility, held by a pilot online here, where it is docked first", () => {
  const chain = resolveIndustryChain({ book: BOOK, productTypeID: 900, runs: 1 });
  assert.ok(chain);
  const widget = chain.lines.get(101);
  assert.ok(widget);
  const owned = (characterID: number, itemID: number, busy: boolean, facilityID: number | null): OwnedBlueprint => ({
    characterID, characterName: `Pilot ${characterID}`, itemID, blueprintTypeID: 1101, blueprintName: "Widget Blueprint",
    productTypeID: 101, original: true, runs: null, materialEfficiency: 10, timeEfficiency: 20, busy, facilityID,
  });
  const STATION_A = 60000004;
  const STATION_B = 60000007;
  const list = [
    owned(90000001, 1, true, STATION_A),
    owned(90000002, 2, false, null),
    owned(90000002, 3, false, STATION_B),
    owned(90000003, 4, false, STATION_A),
  ];
  const docked = (entries: [number, number | null][]) => new Map(entries);
  // Busy, and in no facility, are never offered; the best usable one is.
  assert.equal(installFrom(widget, list, docked([[90000001, STATION_A], [90000002, null], [90000003, null]]))?.itemID, 3);
  // A copy where its pilot is docked beats a better one elsewhere.
  assert.equal(installFrom(widget, list, docked([[90000002, null], [90000003, STATION_A]]))?.itemID, 4);
  // Only a copy in no facility, or nobody online: nothing to set up.
  assert.equal(installFrom(widget, [owned(90000002, 2, false, null)], docked([[90000002, STATION_A]])), null);
  assert.equal(installFrom(widget, list, docked([])), null);
});
