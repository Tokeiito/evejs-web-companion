// The skill queue's writes, made by the page itself (bridge/skillWrites.ts; the plan's Phase 6b).
//
// What has to hold: the pause is the handler's own call, with nothing, and it answers and fails as that call
// does. That the flow makes it as a write the page means, and never by its route, is
// web/src/app/skillsFlow.test.ts; that the BFF makes such a write only so is test/bridgeSession.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { pauseTraining } from "./skillWrites.ts";

test("the pause of training is the skill handler's own call, with nothing; it answers nothing, and fails as the call fails", async () => {
  const asked: string[] = [];
  const act: Ask = async (service, method, args) => {
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`);
    return null;
  };
  assert.equal(await pauseTraining(act), undefined);
  assert.deepEqual(asked, ["skillHandler.AbortTraining()"]);
  // Whatever the server answered is not the pause's to hand on: the sheet read afterwards says what is so.
  assert.equal(await pauseTraining(async () => 5), undefined);
  const refused = Object.assign(new Error("NotNow"), { code: "CALL_REFUSED" });
  await assert.rejects(pauseTraining(async () => { throw refused; }), (error) => error === refused);
});
