// The agents' journal's read, made by the page itself (bridge/journalReads.ts; the plan's Phase 6b).
//
// What has to hold: it is the client's journal service's own call, by the service's name and with nothing, and
// it answers and fails as that call does. That the flow asks it, and never the route, is web/src/app/agentsFlow.test.ts.

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { decodeJournal } from "./agents.ts";
import { readJournal } from "./journalReads.ts";
import type { JsonValue } from "./wire.ts";

test("the journal is read with the journal service's own call: agentMgr.GetMyJournalDetails, with nothing", async () => {
  const asked: string[] = [];
  // As the game port answers it: (the missions, the research), each a list.
  const answer: JsonValue = [{ type: "list", items: [[2, 0, "UI/Agents/MissionTypes/Courier", 5001, 3008416, null, { type: "list", items: [] }, 0, 0, 1]] }, { type: "list", items: [] }];
  const ask: Ask = async (service, method, args) => {
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`);
    return answer;
  };
  const read = await readJournal(ask);
  assert.deepEqual([asked, read], [["agentMgr.GetMyJournalDetails()"], answer]);
  // It is what the page's decoder reads a journal from.
  assert.equal(decodeJournal(read).active.length + decodeJournal(read).offered.length, 1);
  // It fails as the call fails, for who asked.
  const lost = Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(readJournal(async () => { throw lost; }), (error) => error === lost);
});
