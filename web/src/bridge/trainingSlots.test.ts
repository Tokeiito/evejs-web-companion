// Whether every training slot of the account is used, reckoned by the page itself (bridge/trainingSlots.ts; the
// plan's Phase 6b).
//
// What has to hold: the reckoning is the client's queue service's (the account's one slot and its extra ones,
// against its OTHER characters with a skill in training, by equality); the two reads are the client's, in its
// order; what is reckoned is kept until it is let go; and a transport that does not carry the reads is said to
// carry none, once. That a change of the queue is saved by it is web/src/app/skillsFlow.test.ts.

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { allSlotsUsed, createTrainingSlots } from "./trainingSlots.ts";
import type { JsonValue } from "./wire.ts";

const ME = 140000002;
const row = (characterID: number, skillTypeID: number | null): JsonValue => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["characterID", characterID], ["characterName", "A pilot"], ["skillTypeID", skillTypeID], ["toLevel", skillTypeID === null ? null : 4]] } });
/** GetCharacterSelectionData's answer: (userDetails, trainingDetails, characterDetails, wars). */
const selection = (...rows: JsonValue[]): JsonValue => [{ type: "list", items: [] }, [null, null], { type: "list", items: rows }, { type: "list", items: [] }];
const slots = (...extra: number[]): JsonValue => ({ type: "dict", entries: extra.map((slot) => [slot, { type: "long", value: "134400000000000000" }]) });

test("every slot is used when the account's other characters in training are as many as its slots: one, and one for each extra", () => {
  const cases: [string, JsonValue, JsonValue, boolean][] = [
    ["nobody else on the account", slots(), selection(row(ME, null)), false],
    ["nobody else training", slots(), selection(row(ME, null), row(3, null), row(4, null)), false],
    ["another training, one slot", slots(), selection(row(ME, null), row(3, 3300), row(4, null)), true],
    // session.charid's own training uses no slot of the count: it is the character whose queue is being changed.
    ["only this one training", slots(), selection(row(ME, 3300), row(3, null)), false],
    ["this one and another training", slots(), selection(row(ME, 3300), row(3, 3300)), true],
    ["another training, an extra slot", slots(2), selection(row(ME, null), row(3, 3300), row(4, null)), false],
    ["two others training, an extra slot", slots(2), selection(row(ME, null), row(3, 3300), row(4, 3327)), true],
    ["two others training, two extra slots", slots(2, 3), selection(row(ME, null), row(3, 3300), row(4, 3327)), false],
    // The client's reckoning is an equality: more in training than there are slots is not "all used" to it.
    ["two others training, one slot", slots(), selection(row(ME, null), row(3, 3300), row(4, 3327)), false],
    // A row that is no KeyVal names no character and no skill.
    ["a row that cannot be read", slots(), selection(row(ME, null), { type: "packedrow", fields: { characterID: 3, skillTypeID: 3300 } } as unknown as JsonValue), false],
    ["a row with no word of a skill", slots(), selection(row(ME, null), { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["characterID", 3]] } }), false],
  ];
  for (const [why, extra, data, expected] of cases) assert.equal(allSlotsUsed(extra, data, ME), expected, why);
});

test("what is not the two answers the client reads cannot be reckoned from", () => {
  const good = selection(row(ME, null), row(3, 3300));
  for (const extra of [null, 0, [], { type: "list", items: [] }, { type: "dict" }, { entries: [] }] as JsonValue[]) {
    assert.equal(allSlotsUsed(extra, good, ME), null, JSON.stringify(extra));
  }
  for (const data of [null, 7, { type: "list", items: [] }, [], [null, null], [null, null, null, null], [null, null, [row(3, 3300)], null], [null, null, { type: "dict", entries: [] }, null]] as JsonValue[]) {
    assert.equal(allSlotsUsed(slots(), data, ME), null, JSON.stringify(data));
  }
});

/** A stand-in for the asking: what each read answers now, and what was asked. */
function asking(answers: { slots: () => JsonValue; selection: () => JsonValue }): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  const ask: Ask = async (service, method, args, kwargs) => {
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})${kwargs ? JSON.stringify(kwargs) : ""}`);
    if (service === "userSvc" && method === "GetMultiCharactersTrainingSlots") return answers.slots();
    if (service === "charUnboundMgr" && method === "GetCharacterSelectionData") return answers.selection();
    throw new Error(`not asked for: ${service}.${method}`);
  };
  return { ask, asked };
}
const READS = ["userSvc.GetMultiCharactersTrainingSlots()", "charUnboundMgr.GetCharacterSelectionData()"];

test("the slots are reckoned from the client's two reads, in its order and with nothing, and kept until they are let go", async () => {
  let others: JsonValue = row(3, 3300);
  const { ask, asked } = asking({ slots: () => slots(), selection: () => selection(row(ME, null), others) });
  const keeper = createTrainingSlots(ask);
  assert.deepEqual(asked, [], "nothing is asked until it is wanted");
  assert.equal(await keeper.allUsed(ME), true);
  assert.deepEqual(asked, READS);
  // Kept: what is so on the server now is not asked.
  others = row(3, null);
  assert.equal(await keeper.allUsed(ME), true);
  assert.deepEqual(asked, READS);
  // Let go: reckoned again, from what is so now.
  keeper.forget();
  assert.equal(await keeper.allUsed(ME), false);
  assert.deepEqual(asked, [...READS, ...READS]);
  assert.equal(await keeper.allUsed(ME), false);
  assert.equal(asked.length, 4);
  // What could not be read is kept as that too.
  const odd = asking({ slots: () => null, selection: () => selection(row(ME, null)) });
  const oddKeeper = createTrainingSlots(odd.ask);
  assert.deepEqual([await oddKeeper.allUsed(ME), await oddKeeper.allUsed(ME), odd.asked.length], [null, null, 2]);
});

test("a transport that does not carry the reads carries none: said once and kept; any other failure is the read's own and nothing is kept", async () => {
  const asked: string[] = [];
  const notCarried: Ask = async (service, method) => {
    asked.push(`${service}.${method}`);
    throw Object.assign(new Error(`${service}.${method} is not on the web-call allowlist.`), { code: "CALL_NOT_ALLOWED", status: 403 });
  };
  const keeper = createTrainingSlots(notCarried);
  assert.deepEqual([await keeper.allUsed(ME), await keeper.allUsed(ME)], [null, null]);
  // The first read's refusal is enough: the selection data is not asked for, and nothing is asked again.
  assert.deepEqual(asked, ["userSvc.GetMultiCharactersTrainingSlots"]);
  // The second read not carried says the same.
  const half = createTrainingSlots(async (service, method) => {
    if (service === "userSvc") return slots();
    throw Object.assign(new Error(`${service}.${method} is not on the web-call allowlist.`), { code: "CALL_NOT_ALLOWED" });
  });
  assert.equal(await half.allUsed(ME), null);

  for (const code of ["CALL_REFUSED", "CALL_FAILED", "NO_LIVE_SESSION", "SESSION_NOT_FOUND", "BRIDGE_NETWORK_ERROR"]) {
    let fail = true;
    const failure = Object.assign(new Error("Not now."), { code });
    const flaky = asking({ slots: () => { if (fail) throw failure; return slots(); }, selection: () => selection(row(ME, null), row(3, 3300)) });
    const flakyKeeper = createTrainingSlots(flaky.ask);
    await assert.rejects(flakyKeeper.allUsed(ME), (error) => error === failure, code);
    // Nothing was kept of the failure: asked again, it is reckoned.
    fail = false;
    assert.deepEqual([await flakyKeeper.allUsed(ME), flaky.asked.length], [true, 3], code);
  }
  // What carries no code is no word that the call is not carried.
  const bare = new Error("CALL_NOT_ALLOWED");
  await assert.rejects(createTrainingSlots(async () => { throw bare; }).allUsed(ME), (error) => error === bare);
});

// (This stand-in holds an answer back until it is let go. Were the reads ever asked in another order it would
// never be: so the test says how long it will wait, and fails then, where without that it hangs the run.)
test("what is let go while it is being reckoned is answered to whoever asked, and is not kept", { timeout: 5000 }, async () => {
  let release: (value: JsonValue) => void = () => {};
  let others: JsonValue = row(3, 3300);
  const asked: string[] = [];
  // The first asking of the user service waits to be answered; any after it is answered at once.
  let waits = true;
  const ask: Ask = async (service, method) => {
    asked.push(`${service}.${method}`);
    if (service !== "userSvc") return selection(row(ME, null), others);
    if (!waits) return slots();
    waits = false;
    return new Promise<JsonValue>((resolve) => { release = resolve; });
  };
  const keeper = createTrainingSlots(ask);
  const first = keeper.allUsed(ME);
  // The account's training changed, or another character was chosen, while the first read was out.
  keeper.forget();
  release(slots());
  assert.equal(await first, true);
  // Not kept: asked again, it is reckoned again, from both reads and by what is so now. That one is kept.
  others = row(3, null);
  assert.deepEqual([await keeper.allUsed(ME), asked.length], [false, 4]);
  others = row(3, 3300);
  assert.deepEqual([await keeper.allUsed(ME), asked.length], [false, 4]);
});
