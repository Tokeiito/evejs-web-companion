// A distance's unit in the client's own words. The templates here are made up,
// in the shape of the client's: some words and one {distance}.

import test from "node:test";
import assert from "node:assert/strict";

import { DISTANCE_WORD_LABELS, distanceSay } from "./distanceWords.ts";
import { DISTANCE_LABELS, fmtDist } from "./overview.ts";

test("the three labels are the ones asked for", () => {
  assert.deepEqual([...DISTANCE_WORD_LABELS].sort(), Object.values(DISTANCE_LABELS).sort());
  assert.equal(DISTANCE_WORD_LABELS.length, 3);
});

test("a unit the page holds the client's words for is worded by them, and one it does not by the page's own", () => {
  const say = distanceSay({
    [DISTANCE_LABELS.m]: "{distance} metres",
    [DISTANCE_LABELS.km]: "about {distance} km off",
    [DISTANCE_LABELS.au]: null,
  });
  assert.equal(say("m", "186"), "186 metres");
  assert.equal(say("km", "1,094"), "about 1,094 km off");
  assert.equal(say("au", "2.8"), "2.8 AU", "asked for and not found: the page's own");
  assert.equal(distanceSay({})("m", "186"), "186 m", "not asked for yet");
  // Through the formatter, each unit takes its own label.
  assert.deepEqual([fmtDist(186, 2, say), fmtDist(1_094_000, 2, say), fmtDist(4.2e11, 1, say)], ["186 metres", "about 1,094 km off", "2.8 AU"]);
});

test("markup in the client's words is not shown as markup", () => {
  const say = distanceSay({ [DISTANCE_LABELS.m]: "<b>{distance}</b> m" });
  assert.equal(say("m", "12"), "12 m");
});
