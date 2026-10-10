// The standings' reads, made by the page itself (bridge/standingsReads.ts; the plan's Phase 6b), and the asking
// they are made with (bridge/ask.ts).
//
// What has to hold: the calls are the client's own (standingsvc.py, standingsPanel.py), each asked as the client
// asks it; a pilot in an NPC corporation is not asked for its corporation's; each read fails by itself; and what
// is nobody's own failure (the pilot gone, the BFF not reached) fails the whole reading, as a route's request did.

import test from "node:test";
import assert from "node:assert/strict";

import { failsTheReading, failureCode, type Ask } from "./ask.ts";
import { isNpcCorporation, readStandings, standingComposition, standingHistory } from "./standingsReads.ts";
import type { JsonValue } from "./wire.ts";

const failing = (code: string | undefined, more: Record<string, unknown> = {}): Error => Object.assign(new Error("it failed"), code === undefined ? more : { code, ...more });

/** An asking the test answers, with what was asked kept in order. */
function asking(answers: Record<string, JsonValue | (() => JsonValue | Promise<JsonValue>)>): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  const ask: Ask = async (service, method, args) => {
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`);
    const answer = answers[method];
    // (What the test has no answer for is answered with nothing at all, as a call with no result is.)
    return typeof answer === "function" ? answer() : (answer as JsonValue);
  };
  return { ask, asked };
}

const CHAR = { type: "object", name: "eve.common.script.sys.rowset.Rowset", args: { type: "dict", entries: [["header", { type: "list", items: ["fromID", "standing"] }]] } } as JsonValue;
const CORP = { type: "list", items: [["the corporation's"]] } as JsonValue;
const PLAYER = { characterID: 140000005, corporationID: 98000001 };

test("the standings are read with the client's own calls: the character's and its corporation's, each with nothing", async () => {
  const { ask, asked } = asking({ GetCharStandings: CHAR, GetCorpStandings: CORP });
  assert.deepEqual(await readStandings(ask, PLAYER), { char: CHAR, corp: CORP, errors: { char: null, corp: null } });
  assert.deepEqual(asked, ["standingMgr.GetCharStandings()", "standingMgr.GetCorpStandings()"]);
  // A read answered with nothing at all is an answer of nothing, and no failure.
  assert.deepEqual(await readStandings(asking({}).ask, PLAYER), { char: null, corp: null, errors: { char: null, corp: null } });
});

test("a pilot in an NPC corporation is not asked for its corporation's standings, which are none; one whose corporation is not known is", async () => {
  // standingsvc.py 118: `if idCheckers.IsNPC(session.corpid): ... self.npccorpstandings = {}`.
  const npc = asking({ GetCharStandings: CHAR, GetCorpStandings: CORP });
  assert.deepEqual(await readStandings(npc.ask, { characterID: 140000002, corporationID: 1000044 }), { char: CHAR, corp: null, errors: { char: null, corp: null } });
  assert.deepEqual(npc.asked, ["standingMgr.GetCharStandings()"]);
  // idCheckers.IsNPC: above the system's own items and below the players'. Only there.
  assert.deepEqual([10000, 10001, 1000044, 89999999, 90000000, 98000001].map(isNpcCorporation), [false, true, true, true, false, false]);
  assert.equal(isNpcCorporation(null), false);
  for (const [corporationID, calls] of [[10000, 2], [10001, 1], [89999999, 1], [90000000, 2], [null, 2]] as const) {
    const each = asking({ GetCharStandings: CHAR, GetCorpStandings: CORP });
    await readStandings(each.ask, { characterID: 140000002, corporationID });
    assert.equal(each.asked.length, calls, String(corporationID));
  }
});

test("each of the two fails by itself, with why; and what is nobody's own failure fails the whole reading", async () => {
  const one = (method: string, failure: unknown) => readStandings(asking({ GetCharStandings: CHAR, GetCorpStandings: CORP, [method]: () => { throw failure; } }).ask, PLAYER);
  assert.deepEqual(await one("GetCharStandings", failing("CALL_REFUSED")), { char: null, corp: CORP, errors: { char: "CALL_REFUSED", corp: null } });
  assert.deepEqual(await one("GetCorpStandings", failing("EVE_GATEWAY_TIMEOUT")), { char: CHAR, corp: null, errors: { char: null, corp: "EVE_GATEWAY_TIMEOUT" } });
  assert.deepEqual((await one("GetCharStandings", failing(undefined))).errors, { char: "READ_FAILED", corp: null });
  assert.deepEqual((await one("GetCorpStandings", "just a string")).errors, { char: null, corp: "READ_FAILED" });
  // The pilot's session gone, the BFF holding no pilot, the BFF not reached, the flow moved on, the web session not known.
  for (const lost of [failing("SESSION_NOT_FOUND"), failing("NO_LIVE_SESSION"), failing("BRIDGE_NETWORK_ERROR"), failing("SESSION_REQUEST_RETIRED"), failing("AUTH_REQUIRED", { status: 401 })]) {
    for (const method of ["GetCharStandings", "GetCorpStandings"]) {
      await assert.rejects(one(method, lost), (error) => error === lost, `${(lost as { code?: string }).code} at ${method}`);
    }
  }
});

test("an entity opened is asked for the one thing its row wants: its history with the character, or its composition for the corporation", async () => {
  const { ask, asked } = asking({ GetStandingTransactions: { type: "list", items: [["a change"]] }, GetStandingCompositions: { type: "list", items: [["a member"]] } });
  // standingsvc.py 178: GetStandingTransactions(fromID, toID).
  assert.deepEqual(await standingHistory(ask, 1000030, 140000005), { type: "list", items: [["a change"]] });
  // standingsvc.py 283, and on Tranquility: GetStandingCompositions(500001, the corporation).
  assert.deepEqual(await standingComposition(ask, 500001, 98000001), { type: "list", items: [["a member"]] });
  assert.deepEqual(asked, ["standingMgr.GetStandingTransactions(1000030,140000005)", "standingMgr.GetStandingCompositions(500001,98000001)"]);
  // Each fails as its call fails, for who asked.
  const refused = failing("CALL_REFUSED");
  await assert.rejects(standingHistory(asking({ GetStandingTransactions: () => { throw refused; } }).ask, 1, 2), (error) => error === refused);
  await assert.rejects(standingComposition(asking({ GetStandingCompositions: () => { throw refused; } }).ask, 1, 2), (error) => error === refused);
});

test("why a call failed is the code its failure carries; and what fails a whole reading is told from what fails one read", () => {
  assert.deepEqual([failing("CALL_REFUSED"), failing(undefined), failing(""), { code: 7 }, null, undefined, "CALL_REFUSED", 7].map(failureCode),
    ["CALL_REFUSED", "READ_FAILED", "READ_FAILED", "READ_FAILED", "READ_FAILED", "READ_FAILED", "READ_FAILED", "READ_FAILED"]);
  for (const code of ["SESSION_NOT_FOUND", "NO_LIVE_SESSION", "BRIDGE_NETWORK_ERROR", "SESSION_REQUEST_RETIRED"]) assert.equal(failsTheReading(failing(code)), true, code);
  // What the server answered one call with is that read's own: refused, failed, not allowed, not answered in time, unreadable.
  for (const code of ["CALL_REFUSED", "CALL_FAILED", "CALL_NOT_ALLOWED", "CALL_TIMEOUT", "EVE_GATEWAY_TIMEOUT", "BRIDGE_BAD_RESPONSE", "CHARACTER_IN_USE", "READ_FAILED"]) {
    assert.equal(failsTheReading(failing(code, { status: 409 })), false, code);
  }
  // Not signed in to the BFF at all, whatever it calls it; any other status is no such thing.
  assert.deepEqual([failsTheReading(failing("AUTH_REQUIRED", { status: 401 })), failsTheReading(failing("ANYTHING", { status: 401 })), failsTheReading(failing("ANYTHING", { status: 403 }))], [true, true, false]);
  assert.deepEqual([null, undefined, "SESSION_NOT_FOUND", 401].map(failsTheReading), [false, false, false, false]);
});
