// The members of a pilot's corporation, read by the page itself: the call as the client makes it, their numbers
// read off the owners' rows, and an answer that is no list told from a corporation of nobody.

import test from "node:test";
import assert from "node:assert/strict";

import { readCorporationMemberIDs } from "./corpMemberReads.ts";
import type { JsonValue } from "./wire.ts";

// The form this server's registry printed on both transports (2026-10-11): a list of util.Row, each a header and
// a line. Names and numbers made up.
const HEADER = { type: "list", items: ["ownerID", "ownerName", "typeID", "gender", "ownerNameID"] };
const owner = (ownerID: unknown, ownerName: string): JsonValue =>
  ({ type: "object", name: "util.Row", args: { type: "dict", entries: [["header", HEADER], ["line", { type: "list", items: [ownerID, ownerName, 1380, 1, null] }]] } }) as unknown as JsonValue;
const owners = (...rows: readonly JsonValue[]): JsonValue => ({ type: "list", items: rows }) as unknown as JsonValue;

function asker(answer: JsonValue | Error | undefined) {
  const asked: unknown[] = [];
  const ask = async (service: string, method: string, args: readonly JsonValue[], kwargs?: unknown, of?: unknown) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    if (answer instanceof Error) throw answer;
    return answer as JsonValue;
  };
  return { ask, asked };
}

test("a corporation's members are asked for with nothing, and their numbers read off the owners' rows", async () => {
  const one = asker(owners(owner(90000001, "Aba Cade"), owner(90000002, "Dov Elm"), owner(0, "Nobody"), owner(null, "Nobody")));
  // bco_members.py 136: eveowners = self.GetCorpRegistry().GetEveOwners(), and 141: each owner's ownerID kept.
  assert.deepEqual(await readCorporationMemberIDs(one.ask), [90000001, 90000002]);
  assert.deepEqual(one.asked, [["corpRegistry", "GetEveOwners", [], null, null]]);
  // A list of no rows is a corporation of nobody: an answer, and not a failure.
  assert.deepEqual(await readCorporationMemberIDs(asker(owners()).ask), []);
});

test("an answer that is no list is the members unread, not a corporation of nobody", async () => {
  for (const [what, answer] of [["nothing", null], ["nothing at all", undefined], ["a yes", true], ["a number", 2], ["an array", [owner(90000001, "Aba Cade")]], ["a dict", { type: "dict", entries: [] }], ["one row", owner(90000001, "Aba Cade")]] as const) {
    await assert.rejects(readCorporationMemberIDs(asker(answer as JsonValue | undefined).ask), /^Error: Your corporation's members could not be read \(the server did not answer with a list\)\.$/, what);
  }
});

test("a read that failed fails as the call failed: the caller has the call's own reason", async () => {
  const refused = Object.assign(new Error("CALL_FAILED"), { code: "CALL_FAILED" });
  await assert.rejects(readCorporationMemberIDs(asker(refused).ask), (error) => error === refused);
});
