// R102 Phase-4 bound inventory write-ack decoder tests — WB-INV (SetLabel /
// StripFitting / FitFitting / AssembleCargoContainer / BreakPlasticWrap /
// DeliverToCorpHangar / DeliverToCorpMember). PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeInventoryWriteAck } from "./boundInventoryWrites.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R102 — a SetLabel new-label return is carried through untouched", () => {
  const ack = decodeInventoryWriteAck(ackKeyVal({ ok: true, applied: true, result: "My Rifter" }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, "My Rifter");
});

test("R102 — a StripFitting/FitFitting change-list return passes through untouched", () => {
  const changes: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [7400000020, 12, 5] },
      { type: "list", items: [7400000021, 12, 5] },
    ],
  };
  const ack = decodeInventoryWriteAck(ackKeyVal({ ok: true, applied: true, result: changes }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, changes);
});

test("R102 — a no-op write (Assemble/BreakWrap/DeliverToCorpMember) decodes to result:null", () => {
  const ack = decodeInventoryWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R102 — a DeliverToCorpHangar boolean return passes through", () => {
  const ack = decodeInventoryWriteAck(ackKeyVal({ ok: true, applied: true, result: true }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, true);
});

test("R102 — a refused (unconfirmed) inventory write is not-applied, not a throw", () => {
  const ack = decodeInventoryWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});
