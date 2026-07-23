// R96 Phase-4 write-ack decoders — corpRegistry batch A (bulletins / labels /
// contacts / titles). PLUMBING ONLY.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeCorpRegistryWriteAck, decodeCorpRegistryIdWriteAck } from "./writesCorpRegistry.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

// --- generic corpRegistry write acks ----------------------------------------

test("R96 — a null-returning corpRegistry write decodes to {ok, applied, result:null}", () => {
  const ack = decodeCorpRegistryWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R96 — a refused (unconfirmed) / role-refused write is not-applied, not a throw", () => {
  const ack = decodeCorpRegistryWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R96 — a corpRegistry write that returns a raw value passes result through untouched", () => {
  const raw: JsonValue = { type: "dict", entries: [["titleID", 7]] };
  const ack = decodeCorpRegistryWriteAck(ackKeyVal({ ok: true, applied: true, result: raw }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, raw);
});

// --- id-returning acks (AddBulletin / UpdateBulletin / CreateLabel) ----------

test("R96 — an id-returning write ack decodes the allocated bulletinID/labelID", () => {
  const ack = decodeCorpRegistryIdWriteAck(ackKeyVal({ ok: true, applied: true, result: 12 }));
  assert.deepEqual(ack, { ok: true, applied: true, id: 12 });
});

test("R96 — the id ack reads a numeric-string id, and null when absent", () => {
  assert.equal(decodeCorpRegistryIdWriteAck(ackKeyVal({ ok: true, applied: true, result: "44" })).id, 44);
  assert.equal(decodeCorpRegistryIdWriteAck(ackKeyVal({ ok: true, applied: true, result: null })).id, null);
});
