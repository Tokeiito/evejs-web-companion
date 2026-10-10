// The account's clone grade: one of two (clonegrade/const.py), and nothing else is a grade.

import test from "node:test";
import assert from "node:assert/strict";

import { CLONE_GRADE_ALPHA, CLONE_GRADE_NOTICE, CLONE_GRADE_OMEGA, cloneGradeOf } from "./cloneGrade.ts";

test("a clone's grade is the alpha's nought or the omega's one, and anything else is none", () => {
  assert.deepEqual([CLONE_GRADE_ALPHA, CLONE_GRADE_OMEGA, CLONE_GRADE_NOTICE], [0, 1, "OnSubscriptionChangedServer"]);
  assert.deepEqual([cloneGradeOf(0), cloneGradeOf(1)], [0, 1]);
  for (const none of [null, undefined, 2, -1, 0.5, "0", "1", true, false, [], [1], { type: "long", value: "1" }]) {
    assert.equal(cloneGradeOf(none), null, JSON.stringify(none ?? null));
  }
});
