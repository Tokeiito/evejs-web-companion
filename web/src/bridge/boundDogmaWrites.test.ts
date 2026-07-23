// R100 Phase-4 bound dogma module-op write-ack decoder tests — WB-DOGMA batch A
// (target-drop / overload / stop-overload / nanite module-repair / weapon-bank
// link/merge). PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeDogmaModuleWriteAck } from "./boundDogmaWrites.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R100 — a null-returning module-op write (RemoveTargets/ClearTargets) decodes to {ok, applied, result:null}", () => {
  const ack = decodeDogmaModuleWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R100 — an Overload/StopOverload ack carries the moduleID return through untouched", () => {
  const ack = decodeDogmaModuleWriteAck(ackKeyVal({ ok: true, applied: true, result: 7400000020 }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, 7400000020);
});

test("R100 — an InitiateModuleRepairMany triple return is passed through untouched", () => {
  const triple: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [7400000020] },
      { type: "list", items: [] },
      { type: "list", items: [] },
    ],
  };
  const ack = decodeDogmaModuleWriteAck(ackKeyVal({ ok: true, applied: true, result: triple }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, triple);
});

test("R100 — a refused (unconfirmed) write is not-applied, not a throw", () => {
  const ack = decodeDogmaModuleWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});
