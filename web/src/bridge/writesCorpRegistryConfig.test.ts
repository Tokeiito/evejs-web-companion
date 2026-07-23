// R97 Phase-4 write-ack decoders — corpRegistry batch B (member / corp config /
// settings / title-delete / execute-actions). PLUMBING ONLY.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpRegistryConfigWriteAck,
  decodeCorpRegistryBoolWriteAck,
} from "./writesCorpRegistryConfig.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

// --- generic config write acks ----------------------------------------------

test("R97 — a null-returning corp-config write decodes to {ok, applied, result:null}", () => {
  const ack = decodeCorpRegistryConfigWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R97 — a refused (unconfirmed) / role-refused config write is not-applied, not a throw", () => {
  const ack = decodeCorpRegistryConfigWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R97 — RegisterNewAggressionSettings passes its payload through result untouched", () => {
  const payload: JsonValue = { type: "dict", entries: [["friendlyFireLegal", true]] };
  const ack = decodeCorpRegistryConfigWriteAck(ackKeyVal({ ok: true, applied: true, result: payload }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, payload);
});

// --- SetAccountKey boolean ack ----------------------------------------------

test("R97 — SetAccountKey decodes its boolean success return", () => {
  const ack = decodeCorpRegistryBoolWriteAck(ackKeyVal({ ok: true, applied: true, result: true }));
  assert.deepEqual(ack, { ok: true, applied: true, value: true });
});

test("R97 — the bool ack reads false for a non-true / absent result", () => {
  assert.equal(decodeCorpRegistryBoolWriteAck(ackKeyVal({ ok: true, applied: true, result: null })).value, false);
  assert.equal(decodeCorpRegistryBoolWriteAck(ackKeyVal({ ok: true, applied: false })).value, false);
});
