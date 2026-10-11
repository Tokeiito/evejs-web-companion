// The saved fittings, read by the page itself: each call as the client makes it, with the owner whose fittings
// they are, and what is never asked.

import test from "node:test";
import assert from "node:assert/strict";

import { readCharacterFittings, readCorporationFittings } from "./fittingReads.ts";
import type { JsonValue } from "./wire.ts";

function asker(answer: JsonValue | Error) {
  const asked: unknown[] = [];
  const ask = async (service: string, method: string, args: readonly JsonValue[], kwargs?: unknown, of?: unknown) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { ask, asked };
}

const LIBRARY: JsonValue = { type: "dict", entries: [] };

test("a pilot's fittings are asked of the character's manager with the character, and a corporation's of the corporation's with the corporation", async () => {
  // fittingSvc.py 430: self.GetFittingMgr(ownerID).GetFittings(ownerID). 86 to 92: which manager, by whose the owner is.
  const own = asker(LIBRARY);
  assert.equal(await readCharacterFittings(own.ask, 140000005), LIBRARY);
  assert.deepEqual(own.asked, [["charFittingMgr", "GetFittings", [140000005], null, null]]);
  const corporations = asker(LIBRARY);
  assert.equal(await readCorporationFittings(corporations.ask, 98000000), LIBRARY);
  assert.deepEqual(corporations.asked, [["corpFittingMgr", "GetFittings", [98000000], null, null]]);
});

test("nothing is asked for what is no owner", async () => {
  let asked = 0;
  const ask = async () => { asked += 1; return LIBRARY; };
  for (const owner of [0, -5, 1.5, Number.NaN, 2 ** 53]) {
    await assert.rejects(readCharacterFittings(ask, owner), /^Error: There is no pilot to read the fittings of\.$/, String(owner));
    await assert.rejects(readCorporationFittings(ask, owner), /^Error: There is no corporation to read the fittings of\.$/, String(owner));
  }
  assert.equal(asked, 0);
});

test("each read fails as its call fails", async () => {
  // The server's word for an owner that is not the session's own.
  const denied = Object.assign(new Error("OWNER_SCOPE_DENIED"), { code: "CALL_REFUSED" });
  await assert.rejects(readCharacterFittings(asker(denied).ask, 140000005), (error) => error === denied);
  await assert.rejects(readCorporationFittings(asker(denied).ask, 98000000), (error) => error === denied);
});
