// R97 Phase-4 write-ack decoders — corpRegistry batch B (member / corp config /
// settings / title-delete / execute-actions). PLUMBING ONLY.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpRegistryConfigWriteAck,
  decodeCorpRegistryBoolWriteAck,
} from "./writesCorpRegistryConfig.ts";
import type { JsonValue } from "./wire.ts";

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

// --- generic config write acks ----------------------------------------------

test("R97 — a null-returning corp-config write decodes to {ok, applied, result:null}", () => {
  const ack = decodeCorpRegistryConfigWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R97 — a refused (unconfirmed) / role-refused config write is not-applied, not a throw", () => {
  const ack = decodeCorpRegistryConfigWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R97 — RegisterNewAggressionSettings passes its payload through result untouched", () => {
  const payload: JsonValue = { type: "dict", entries: [["friendlyFireLegal", true]] };
  const ack = decodeCorpRegistryConfigWriteAck(plainAck({ ok: true, applied: true, result: payload }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, payload);
});

// --- SetAccountKey boolean ack ----------------------------------------------

test("R97 — SetAccountKey decodes its boolean success return", () => {
  const ack = decodeCorpRegistryBoolWriteAck(plainAck({ ok: true, applied: true, result: true }));
  assert.deepEqual(ack, { ok: true, applied: true, value: true });
});

test("R97 — the bool ack reads false for a non-true / absent result", () => {
  assert.equal(decodeCorpRegistryBoolWriteAck(plainAck({ ok: true, applied: true, result: null })).value, false);
  assert.equal(decodeCorpRegistryBoolWriteAck(plainAck({ ok: true, applied: false })).value, false);
});
