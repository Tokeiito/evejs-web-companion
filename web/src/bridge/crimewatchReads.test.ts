// Crimewatch's states and the clone's grade, each read by the page with the client's own call
// (bridge/crimewatchReads.ts, bridge/cloneGradeReads.ts; the plan's Phase 6b).
//
// What has to hold: each is its service's own call, with nothing; each answers and fails as its call does; and
// where the clone grade's call is not carried there is none, which is not a failure. That the flow asks them, and
// never their routes, is web/src/app/crimewatchFlow.test.ts.

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { cloneGradeOf } from "./cloneGrade.ts";
import { readCloneGrade } from "./cloneGradeReads.ts";
import { readClientStates } from "./crimewatchReads.ts";
import type { JsonValue } from "./wire.ts";

const failing = (code: string | undefined): Error => Object.assign(new Error("it failed"), code === undefined ? {} : { code });
function asking(answer: JsonValue | (() => JsonValue)): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  return { asked, ask: async (service, method, args) => { asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`); return typeof answer === "function" ? answer() : answer; } };
}

test("crimewatch's states are read with crimewatch's own call, with nothing, and answer and fail as it does", async () => {
  const states: JsonValue = [[[100, null]], { type: "dict", entries: [] }, [], 2];
  const { ask, asked } = asking(states);
  assert.deepEqual([await readClientStates(ask), asked], [states, ["crimewatch.GetClientStates()"]]);
  const lost = failing("SESSION_NOT_FOUND");
  await assert.rejects(readClientStates(asking(() => { throw lost; }).ask), (error) => error === lost);
});

test("the clone's grade is read with the subscription manager's own call, with nothing; where it is not carried there is none", async () => {
  for (const grade of [0, 1]) {
    const { ask, asked } = asking(grade);
    assert.deepEqual([await readCloneGrade(ask), asked], [grade, ["subscriptionMgr.GetCloneGrade()"]]);
  }
  // What the server answered is handed on as it came: whether it is a grade is the reader's to say.
  assert.deepEqual([await readCloneGrade(asking(2).ask), cloneGradeOf(await readCloneGrade(asking(2).ask)), cloneGradeOf(await readCloneGrade(asking(1).ask))], [2, null, 1]);
  // The web gateway's list has not got the call: none, and no failure.
  const refused = asking(() => { throw failing("CALL_NOT_ALLOWED"); });
  assert.deepEqual([await readCloneGrade(refused.ask), refused.asked.length], [null, 1]);
  // Any other failure is the read's.
  for (const code of ["CALL_REFUSED", "EVE_GATEWAY_UNREACHABLE", "SESSION_NOT_FOUND", undefined]) {
    const lost = failing(code);
    await assert.rejects(readCloneGrade(asking(() => { throw lost; }).ask), (error) => error === lost, String(code));
  }
});
