// The pilot's standings, kept as the server changes them. The sums are worked by hand from the client's rule.

import test from "node:test";
import assert from "node:assert/strict";

import { newStanding, standingByRawChange, standingsAfter } from "./standingChanges.ts";

const PILOT = 140000002;
const HELD = Object.freeze([{ fromID: 500001, standing: -3.978 }, { fromID: 1000002, standing: 1.069 }]);
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("a rise closes its share of what is left to ten; a fall, its share of what is left to minus ten", () => {
  near(standingByRawChange(0, 0.1), 1);
  near(standingByRawChange(5, 0.1), 5.5);
  near(standingByRawChange(-5, 0.1), -3.5);
  near(standingByRawChange(0, -0.1), -1);
  near(standingByRawChange(5, -0.1), 3.5);
  near(standingByRawChange(-5, -0.1), -5.5);
  // A change of nothing moves nothing.
  near(standingByRawChange(3.3, 0), 3.3);
  // The ends of the scale hold, and are not passed.
  assert.equal(standingByRawChange(10, 0.5), 10);
  assert.equal(standingByRawChange(-10, -0.5), -10);
  assert.equal(standingByRawChange(9, 2), 10);
  assert.equal(standingByRawChange(-9, -2), -10);
  // From the top a fall still falls, and from the bottom a rise still rises.
  near(standingByRawChange(10, -0.1), 8);
  near(standingByRawChange(-10, 0.1), -8);
});

test("a first standing is ten times the change, within the scale", () => {
  near(newStanding(0.05), 0.5);
  near(newStanding(-0.2), -2);
  assert.equal(newStanding(3), 10);
  assert.equal(newStanding(-3), -10);
});

test("a standing set for the pilot replaces the one held, or is added", () => {
  assert.deepEqual(standingsAfter(HELD, "OnStandingSet", [1000002, PILOT, 4.5], PILOT), [{ fromID: 500001, standing: -3.978 }, { fromID: 1000002, standing: 4.5 }]);
  assert.deepEqual(standingsAfter(HELD, "OnStandingSet", [3008416, PILOT, 10], PILOT), [...HELD, { fromID: 3008416, standing: 10 }]);
  // As the bridge carries a number that is not whole, and an ID too large for one.
  assert.deepEqual(standingsAfter(HELD, "OnStandingSet", [{ type: "long", value: "1000002" }, PILOT, { type: "real", value: 2.25 }], PILOT)[1], { fromID: 1000002, standing: 2.25 });
  // What was held is not changed in place.
  assert.deepEqual(HELD, [{ fromID: 500001, standing: -3.978 }, { fromID: 1000002, standing: 1.069 }]);
});

test("a standing set to nothing, or to nought, drops the owner from the list", () => {
  assert.deepEqual(standingsAfter(HELD, "OnStandingSet", [1000002, PILOT, 0], PILOT), [{ fromID: 500001, standing: -3.978 }]);
  assert.deepEqual(standingsAfter(HELD, "OnStandingSet", [1000002, PILOT, null], PILOT), [{ fromID: 500001, standing: -3.978 }]);
  assert.deepEqual(standingsAfter(HELD, "OnStandingSet", [3008416, PILOT, 0], PILOT), HELD);
});

test("a standing set that is not the pilot's own with an NPC leaves the list as it is", () => {
  // Another pilot's, the pilot's corporation's, a player's towards the pilot, and nonsense.
  for (const args of [[1000002, 140000001, 4.5], [1000002, 98000001, 4.5], [140000001, PILOT, 4.5], [9999, PILOT, 4.5], [90000000, PILOT, 4.5], ["x", PILOT, 4.5], []]) {
    assert.equal(standingsAfter(HELD, "OnStandingSet", args, PILOT), HELD, JSON.stringify(args));
  }
  // And with no pilot known, even for a notification that names none either; or any other notification, whatever it carries.
  assert.equal(standingsAfter(HELD, "OnStandingSet", [1000002, PILOT, 4.5], null), HELD);
  assert.equal(standingsAfter(HELD, "OnStandingSet", [1000002, null, 4.5], null), HELD);
  assert.equal(standingsAfter(HELD, "OnStandingsModified", [[[1000002, null, 0.1, 0, 10]]], null), HELD);
  assert.equal(standingsAfter(HELD, "OnItemsChanged", [1000002, PILOT, 4.5], PILOT), HELD);
  assert.equal(standingsAfter(HELD, "OnItemsChanged", [[[1000002, PILOT, 0.1, 0, 10]]], PILOT), HELD);
  assert.equal(standingsAfter(HELD, null, [1000002, PILOT, 4.5], PILOT), HELD);
  assert.equal(standingsAfter(HELD, null, [], PILOT), HELD);
});

test("modifications move each standing the pilot holds, and start one for an owner not yet listed", () => {
  const tuple = (...values: unknown[]) => ({ type: "tuple", items: values });
  const after = standingsAfter(HELD, "OnStandingsModified", [{ type: "list", items: [
    tuple(1000002, PILOT, 0.1, 0, 10),
    tuple(3008416, PILOT, 0.05, 0, 10),
    tuple(500001, PILOT, -0.1, -10, 0),
    // Not this pilot's: left out.
    tuple(1000125, 98000001, 0.5, 0, 10),
    // Twice for one owner: each on top of the last.
    tuple(3008416, PILOT, 0.05, 0, 10),
  ] }], PILOT);
  assert.deepEqual(after.map((row) => row.fromID), [500001, 1000002, 3008416]);
  near(after[0]!.standing, 10 * (-0.3978 + (1 - 0.3978) * -0.1));
  near(after[1]!.standing, 10 * (1 - (1 - 0.1069) * 0.9));
  near(after[2]!.standing, 10 * (1 - (1 - 0.05) * 0.95));
  // Bare arrays, as the game port sends them, read the same.
  const bare = standingsAfter(HELD, "OnStandingsModified", [[[1000002, PILOT, 0.1, 0, 10]]], PILOT);
  near(bare[1]!.standing, 10 * (1 - (1 - 0.1069) * 0.9));
  // Nothing in it for this pilot, or nothing in it at all: the list as it was.
  assert.equal(standingsAfter(HELD, "OnStandingsModified", [[[1000002, 98000001, 0.1, 0, 10]]], PILOT), HELD);
  assert.equal(standingsAfter(HELD, "OnStandingsModified", [[]], PILOT), HELD);
  assert.equal(standingsAfter(HELD, "OnStandingsModified", [], PILOT), HELD);
  assert.equal(standingsAfter(HELD, "OnStandingsModified", [[["x", PILOT, 0.1], [1000002, PILOT, "y"]]], PILOT), HELD);
});
