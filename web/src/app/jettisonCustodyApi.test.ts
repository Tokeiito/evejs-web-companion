import test from "node:test";
import assert from "node:assert/strict";
import { jettisonItems, reconcileHostedJettison, JettisonCustodyError } from "./api.ts";
const invocation = { runID: "original-run", invocationID: 7, stepPath: "loop/jettison" };
test("jettison sends exact invocation and preserves proof plus successful notification drain", async () => {
  const drains: unknown[] = [];
  const result = await jettisonItems([10], { captureNotificationSink: () => rows => drains.push(...rows),
    fetch: async (_path, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { itemIDs: [10], confirm: true, invocation });
      return new Response(JSON.stringify({ ok: true, accepted: true, jettisonCustody: { state: "confirmed-created", containerID: 99 }, notifications: ["invite"] }));
    } }, invocation);
  assert.equal(result?.["containerID"], 99); assert.deepEqual(drains, ["invite"]);
});
test("HTTP success with ambiguous custody blocks mutation but still drains notifications", async () => {
  const drains: unknown[] = [];
  await assert.rejects(jettisonItems([10], { captureNotificationSink: () => rows => drains.push(...rows),
    fetch: async () => new Response(JSON.stringify({ ok: true, accepted: false, error: "JETTISON_MULTIPLE_CANDIDATES",
      jettisonCustody: { state: "ambiguous" }, notifications: ["invite"] })) }, invocation), error => {
      assert.ok(error instanceof JettisonCustodyError); assert.equal(error.notIssued, false); return true;
    });
  assert.deepEqual(drains, ["invite"]);
});
test("a refusal carries the route's own words for it, and the one sentence only when the route gives none", async () => {
  const refusal = async (reply: Record<string, unknown>): Promise<JettisonCustodyError> => {
    try { await jettisonItems([10], { fetch: async () => new Response(JSON.stringify({ ok: true, accepted: false, notIssued: true, jettisonCustody: null, ...reply })) }, invocation); }
    catch (error) { assert.ok(error instanceof JettisonCustodyError); return error; }
    throw new Error("the jettison was not refused");
  };
  const said = await refusal({ error: "JETTISON_NOT_ISSUED", message: "Jettison pre-dispatch authority is unreadable: the scene's ship is not said to be flown by this pilot." });
  assert.deepEqual([said.code, said.message, said.notIssued, said.status], ["JETTISON_NOT_ISSUED", "Jettison pre-dispatch authority is unreadable: the scene's ship is not said to be flown by this pilot.", true, 409]);
  for (const message of [undefined, null, "", "   ", 7])
    assert.equal((await refusal({ error: "JETTISON_NOT_ISSUED", message })).message, "Jettison custody requires reconciliation before another mutation.");
  assert.equal((await refusal({ message: "said with no code" })).code, "JETTISON_CUSTODY_UNKNOWN");
});
test("definite pre-dispatch refusal stays distinct from an unknown issued result", async () => {
  await assert.rejects(jettisonItems([10], { fetch: async () => new Response(JSON.stringify({ ok: true, accepted: false,
    notIssued: true, jettisonCustody: null })) }, invocation), error => error instanceof JettisonCustodyError && error.notIssued);
  await assert.rejects(reconcileHostedJettison({ fetch: async () => new Response(JSON.stringify({ ok: true, accepted: true,
    jettisonCustody: { state: "invented-safe-state" } })) }), JettisonCustodyError);
});
