import test from "node:test";
import assert from "node:assert/strict";
import { requireModuleOutcome } from "./moduleOutcome.ts";
import { issueSalvageBatch } from "./salvageBatchIssue.ts";
import type { SalvageBatchStep } from "./scriptDecide.ts";

const lock: SalvageBatchStep = { kind: "lock", targetID: 1 };
const first: SalvageBatchStep = { kind: "activate", moduleID: 10, targetID: 20 };
const second: SalvageBatchStep = { kind: "activate", moduleID: 11, targetID: 21 };

for (const leadingSuccess of [false, true]) {
  test(`an uncertain module outcome stops the batch, with earlier success ${leadingSuccess}`, async () => {
    const calls: SalvageBatchStep[] = [];
    const steps = [...(leadingSuccess ? [lock] : []), first, second];
    await assert.rejects(issueSalvageBatch(steps, async (step) => {
      calls.push(step);
      if (step.kind === "activate") requireModuleOutcome({ itemID: step.moduleID, active: null, stopped: null }, step.moduleID, "activate");
    }, () => false), (error: unknown) => {
      assert.ok(error !== null && typeof error === "object" && "code" in error);
      assert.equal(error.code, "MODULE_ACTION_UNCERTAIN");
      assert.deepEqual((error as { salvageBatchOutcomes?: unknown }).salvageBatchOutcomes,
        leadingSuccess ? [{ step: lock, ok: true }] : []);
      return true;
    });
    assert.deepEqual(calls, [...(leadingSuccess ? [lock] : []), first]);
  });
}

test("ordinary refusals retain their per-step identity and do not prevent other work", async () => {
  const refusal = Object.assign(new Error("TargetingAttemptCancelled"), { code: "CALL_REFUSED" });
  const result = await issueSalvageBatch([lock, first], async (step) => {
    if (step === lock) throw refusal;
  }, () => false);
  assert.deepEqual(result, { kind: "salvageBatch", outcomes: [{ step: lock, ok: false, error: refusal }, { step: first, ok: true }] });
  assert.deepEqual(await issueSalvageBatch([lock], async () => { throw refusal; }, () => false), {
    kind: "salvageBatch", outcomes: [{ step: lock, ok: false, error: refusal }],
  });
});

test("transport, transition, settling and lost-session errors keep their original classification", async () => {
  for (const code of ["EVE_GATEWAY_TIMEOUT", "EVE_GATEWAY_UNREACHABLE", "BRIDGE_NETWORK_ERROR",
    "EDGE_OWNER_REQUEST_TIMEOUT", "EDGE_OWNER_OVERLOADED", "BRIDGE_BAD_RESPONSE", "TRANSITION_TIMEOUT",
    "SESSION_CHANGE_IN_PROGRESS", "SESSION_LOST"]) {
    const failure = Object.assign(new Error(code), { code });
    const calls: SalvageBatchStep[] = [];
    await assert.rejects(issueSalvageBatch([lock, first, second], async (step) => {
      calls.push(step);
      if (step === first) throw failure;
    }, (error) => error === failure && code === "SESSION_LOST"), (error) => error === failure);
    assert.deepEqual(calls, [lock, first], code);
    assert.deepEqual((failure as { salvageBatchOutcomes?: unknown }).salvageBatchOutcomes, [{ step: lock, ok: true }], code);
  }
});
