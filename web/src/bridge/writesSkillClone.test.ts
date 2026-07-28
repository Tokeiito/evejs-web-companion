// R95 Phase-4 write-ack decoders — skills + clones + safety. PLUMBING ONLY.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeSkillCloneWriteAck, decodeSafetyLevelWriteAck } from "./writesSkillClone.ts";
import type { JsonValue } from "./wire.ts";

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

// --- skill/clone write acks -------------------------------------------------

test("R95 — a null-returning skill/clone write decodes to {ok, applied, result:null}", () => {
  const ack = decodeSkillCloneWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R95 — a declined (unconfirmed / refused) write is not-applied, not a throw", () => {
  const ack = decodeSkillCloneWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R95 — a write that returns a raw object passes result through untouched", () => {
  const raw: JsonValue = { type: "dict", entries: [["jumpCloneID", 42]] };
  const ack = decodeSkillCloneWriteAck(plainAck({ ok: true, applied: true, result: raw }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, raw);
});

// --- SetSafetyLevel ack -----------------------------------------------------

test("R95 — SetSafetyLevel ack decodes the echoed new safety level", () => {
  const ack = decodeSafetyLevelWriteAck(plainAck({ ok: true, applied: true, result: 2 }));
  assert.deepEqual(ack, { ok: true, applied: true, safetyLevel: 2 });
});

test("R95 — SetSafetyLevel reads a numeric-string level, and null when absent", () => {
  assert.equal(decodeSafetyLevelWriteAck(plainAck({ ok: true, applied: true, result: "1" })).safetyLevel, 1);
  assert.equal(decodeSafetyLevelWriteAck(plainAck({ ok: true, applied: true, result: null })).safetyLevel, null);
});

test("R95 — safety level 0 (disabled) is kept, not coerced to null", () => {
  assert.equal(decodeSafetyLevelWriteAck(plainAck({ ok: true, applied: true, result: 0 })).safetyLevel, 0);
});
