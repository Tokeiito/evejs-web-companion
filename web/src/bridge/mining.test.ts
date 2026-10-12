// The R23 slice B decoders. The theme of this file is one distinction:
// ZERO IS NOT UNKNOWN.
//
// A quantity of 0 is a real, useful answer — "this rock is mined out", "this
// hold is empty". An absent field is not an answer at all. Collapsing the two
// would put confident numbers in front of a player that nobody computed: a full
// belt shown as mined out, or a station's ISK tax shown as free.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeMiningHolds,
  decodeReprocessingQuotes,
  decodeSurveyResults,
  decodeTaxRate,
  picksInHolds,
  quoteRefinesNothing,
  refinableHangarStacks,
} from "./mining.ts";
import type { JsonValue } from "./wire.ts";

// --- The holds --------------------------------------------------------------

test("holds decode by NAME, with capacity and contents", () => {
  const holds = decodeMiningHolds([
    {
      key: "ore",
      label: "Ore hold",
      present: true,
      capacity: { capacity: 5000, used: 120 },
      items: [{ itemID: 8800001, typeID: 1230, groupID: 462, categoryID: 25, quantity: 500 }],
      error: null,
    },
  ] as unknown as JsonValue);

  assert.equal(holds.length, 1);
  assert.equal(holds[0]?.label, "Ore hold");
  assert.equal(holds[0]?.capacity?.capacity, 5000);
  assert.deepEqual(holds[0]?.items, [
    { itemID: 8800001, typeID: 1230, groupID: 462, categoryID: 25, quantity: 500 },
  ]);
});

test("a hold row from a bridge that does not publish a category decodes to null, not zero", () => {
  // "Could not classify" and "classified as category 0" are different, and a
  // delivery filtering on the category has to be able to tell them apart.
  const holds = decodeMiningHolds([
    {
      key: "cargo",
      label: "Cargo hold",
      present: true,
      items: [{ itemID: 8800002, typeID: 1230, quantity: 5 }],
      error: null,
    },
  ] as unknown as JsonValue);

  assert.equal(holds[0]?.items?.[0]?.groupID, null);
  assert.equal(holds[0]?.items?.[0]?.categoryID, null);
});

test("a hold whose read FAILED decodes items to null — not to an empty hold", () => {
  const holds = decodeMiningHolds([
    { key: "ore", label: "Ore hold", present: true, items: null, error: "READ_FAILED" },
    { key: "ice", label: "Ice hold", present: true, items: [], error: null },
  ] as unknown as JsonValue);

  assert.equal(holds[0]?.items, null, "null is 'we could not look'");
  assert.deepEqual(holds[1]?.items, [], "[] is 'we looked, and it is empty'");
  assert.equal(holds[0]?.error, "READ_FAILED");
});

test("hold IDs decode long-aware, and a row missing an ID is dropped", () => {
  const holds = decodeMiningHolds([
    {
      key: "ore",
      label: "Ore hold",
      present: true,
      items: [
        { itemID: { type: "long", value: "8800001" }, typeID: 1230, quantity: 500 },
        { typeID: 1230, quantity: 9 },
      ],
    },
  ] as unknown as JsonValue);

  assert.equal(holds[0]?.items?.length, 1, "the unidentifiable row is dropped, not zeroed");
  assert.equal(holds[0]?.items?.[0]?.itemID, 8800001);
});

test("a malformed holds payload decodes to an empty list rather than throwing", () => {
  assert.deepEqual(decodeMiningHolds(undefined), []);
  assert.deepEqual(decodeMiningHolds(null as unknown as JsonValue), []);
  assert.deepEqual(decodeMiningHolds({ nope: true } as unknown as JsonValue), []);
});

// --- The survey scanner -----------------------------------------------------

test("survey triples decode, and a scanned EMPTY rock keeps its real zero", () => {
  const survey = decodeSurveyResults([
    [50001248, 1230, 4200],
    [50001249, 1228, 0],
  ] as unknown as JsonValue);

  assert.equal(survey.length, 2);
  assert.equal(survey[0]?.remainingQuantity, 4200);
  assert.equal(
    survey[1]?.remainingQuantity,
    0,
    "a mined-out rock is a real answer and must survive as 0",
  );
});

test("survey IDs decode long-aware, and an unreadable row is dropped", () => {
  const survey = decodeSurveyResults([
    [{ type: "long", value: "50001248" }, { type: "long", value: "1230" }, 4200],
    ["nonsense", 1230, 10],
    "not-a-triple",
  ] as unknown as JsonValue);

  assert.equal(survey.length, 1, "a row that cannot be tied to a rock is dropped, not zeroed");
  assert.equal(survey[0]?.itemID, 50001248);
  assert.equal(survey[0]?.yieldTypeID, 1230);
});

test("a survey row with an unreadable amount is UNKNOWN, not zero", () => {
  const survey = decodeSurveyResults([[50001248, 1230, "?"]] as unknown as JsonValue);
  assert.equal(
    survey[0]?.remainingQuantity,
    null,
    "we could not read it, so we must not say the rock is empty",
  );
});

test("a malformed survey payload decodes to an empty list", () => {
  assert.deepEqual(decodeSurveyResults(undefined), []);
  assert.deepEqual(decodeSurveyResults({ nope: true } as unknown as JsonValue), []);
});

// --- The refinery -----------------------------------------------------------

test("quotes decode, including the per-stack ISK cost and the mineral yield", () => {
  const quotes = decodeReprocessingQuotes([
    {
      itemID: 8800001,
      typeID: 1230,
      quantityToProcess: 500,
      leftOvers: 0,
      iskCost: 1234.5,
      outputs: [
        { typeID: 34, quantity: 1000 },
        { typeID: 35, quantity: 200 },
      ],
    },
  ] as unknown as JsonValue);

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0]?.quantityToProcess, 500);
  assert.equal(quotes[0]?.leftOvers, 0, "zero left over is a real answer");
  assert.equal(quotes[0]?.iskCost, 1234.5);
  assert.deepEqual(quotes[0]?.outputs, [
    { typeID: 34, quantity: 1000 },
    { typeID: 35, quantity: 200 },
  ]);
});

test("a quote with no ISK cost given reads as UNKNOWN", () => {
  const quotes = decodeReprocessingQuotes([
    { itemID: 8800001, typeID: 1230, outputs: [] },
  ] as unknown as JsonValue);
  assert.equal(quotes[0]?.iskCost, null, "not 0 — we were not told what it costs");
  assert.deepEqual(quotes[0]?.outputs, []);
});

test("⚠ the TAX RATE is null when unknown, and 0 only when the server really said 0", () => {
  // This one matters more than it looks. Reprocessing DEBITS the station's tax
  // from the wallet, so a null shown as 0 would tell the player the refinery is
  // free — a confidently wrong number about their money.
  assert.equal(decodeTaxRate(undefined), null);
  assert.equal(decodeTaxRate(null as unknown as JsonValue), null);
  assert.equal(decodeTaxRate("nonsense" as unknown as JsonValue), null);
  assert.equal(decodeTaxRate(-1 as unknown as JsonValue), null, "a negative rate is not a rate");
  assert.equal(decodeTaxRate(0 as unknown as JsonValue), 0, "a real zero survives");
  assert.equal(decodeTaxRate(0.05 as unknown as JsonValue), 0.05);
});

test("a malformed quotes payload decodes to an empty list", () => {
  assert.deepEqual(decodeReprocessingQuotes(undefined), []);
  assert.deepEqual(decodeReprocessingQuotes({ nope: true } as unknown as JsonValue), []);
  // A quote row with no itemID cannot be tied to a stack, so it is dropped.
  assert.deepEqual(decodeReprocessingQuotes([{ typeID: 1230 }] as unknown as JsonValue), []);
});

// --- The hangar's stacks the Mining window offers, and what a quote says of them ---

const row = (itemID: number, more: Record<string, unknown> = {}) => ({ itemID, typeID: 1230, groupID: 462, categoryID: 25, flagID: 4, quantity: 500, singleton: false, ...more });

test("the hangar's stacks offered for refining are what the client's rule calls refinable of what is mined: ore and ice by their category, gas by its group, and stacks only", () => {
  // typematerials/data.py 104 to 117: categoryAsteroid (25), or groupHarvestableCloud (711).
  const rows = [
    row(1),
    row(2, { typeID: 16262, groupID: 465 }),
    row(3, { typeID: 30375, groupID: 711, categoryID: 2 }),
    // A mineral, a module and a ship: none is of what is mined.
    row(4, { typeID: 34, groupID: 18, categoryID: 4 }),
    row(5, { typeID: 439, groupID: 46, categoryID: 7 }),
    row(6, { typeID: 588, groupID: 237, categoryID: 6, singleton: true, quantity: 1 }),
    // One of a kind is no stack; a stack of nothing is none; and a row whose kind is not known is left out:
    // refining uses a stack up, and "cannot tell" does not pass.
    row(7, { singleton: true }),
    row(8, { quantity: 0 }),
    row(9, { groupID: null, categoryID: null }),
    // A category that is not the asteroids' with a group that is not the clouds'.
    row(10, { groupID: 712, categoryID: 2 }),
  ];
  assert.deepEqual(refinableHangarStacks(rows as never).map((each) => each.itemID), [1, 2, 3]);
  assert.deepEqual(refinableHangarStacks([]), []);
});

test("a quote that has nothing to process for any stack refines nothing; one stack that can be refined, or a quote that does not say, does not make it so", () => {
  const quote = (quantityToProcess: number | null) => ({ itemID: 1, typeID: 1230, quantityToProcess, leftOvers: 50, iskCost: 0, outputs: [] });
  assert.equal(quoteRefinesNothing([quote(0)]), true);
  assert.equal(quoteRefinesNothing([quote(0), quote(0)]), true);
  assert.equal(quoteRefinesNothing([quote(0), quote(300)]), false);
  // Not said is not nought: the plant is asked.
  assert.equal(quoteRefinesNothing([quote(null)]), false);
  // No row at all is the plant refusing every stack, which the window says in its own words.
  assert.equal(quoteRefinesNothing([]), false);
});

test("the unloading is of the picks that are in the ship's holds: a hangar's stack picked for refining is not unloaded", () => {
  const holds = [
    { key: "ore", label: "Ore hold", present: true, capacity: null, error: null, items: [{ itemID: 11, typeID: 1230, groupID: 462, categoryID: 25, quantity: 5 }] },
    { key: "cargo", label: "Cargo hold", present: true, capacity: null, error: null, items: [{ itemID: 12, typeID: 1230, groupID: 462, categoryID: 25, quantity: 5 }] },
    // A hold that could not be read has no stacks to pick.
    { key: "ice", label: "Ice hold", present: true, capacity: null, error: "READ_FAILED", items: null },
  ];
  assert.deepEqual(picksInHolds([12, 99, 11], holds as never), [12, 11]);
  assert.deepEqual(picksInHolds([99], holds as never), []);
  assert.deepEqual(picksInHolds([], holds as never), []);
});
