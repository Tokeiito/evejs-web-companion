// R98 Phase-4 write-ack decoders — corpRegistry batch C (shares / dividend / kicks
// / CEO-resign / applications / alliance / war). PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpRegistryShareWarWriteAck,
  decodeCorpRegistryIdWriteAck,
  decodeCorpRegistryKickManyWriteAck,
} from "./writesCorpRegistryShareWar.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

// --- null / opaque write acks (share moves / kick / resign / alliance) --------

test("R98 — a null-returning share/war write decodes to {ok, applied, result:null}", () => {
  const ack = decodeCorpRegistryShareWarWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R98 — a refused (unconfirmed) / role-refused write is not-applied, not a throw", () => {
  const ack = decodeCorpRegistryShareWarWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R98 — DeclareWarAgainst passes its war-record return through result untouched", () => {
  const record: JsonValue = { type: "dict", entries: [["warID", 42]] };
  const ack = decodeCorpRegistryShareWarWriteAck(ackKeyVal({ ok: true, applied: true, result: record }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, record);
});

// --- ID-returning write acks (application / invitation / corp / alliance) ------

test("R98 — an ID-returning write surfaces its numeric id", () => {
  const ack = decodeCorpRegistryIdWriteAck(ackKeyVal({ ok: true, applied: true, result: 900001 }));
  assert.deepEqual(ack, { ok: true, applied: true, id: 900001 });
});

test("R98 — the id ack reads null for a non-number / absent result", () => {
  assert.equal(decodeCorpRegistryIdWriteAck(ackKeyVal({ ok: true, applied: true, result: null })).id, null);
  assert.equal(decodeCorpRegistryIdWriteAck(ackKeyVal({ ok: true, applied: false })).id, null);
});

// --- KickOutMembers { kicked, notKicked } ack ---------------------------------

test("R98 — KickOutMembers splits kicked / notKicked id lists", () => {
  const result = ackKeyVal({ kicked: [140000002, 140000003], notKicked: [140000009] });
  const ack = decodeCorpRegistryKickManyWriteAck(ackKeyVal({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.kicked, [140000002, 140000003]);
  assert.deepEqual(ack.notKicked, [140000009]);
});

test("R98 — KickOutMembers reads empty lists for an absent/malformed result", () => {
  const ack = decodeCorpRegistryKickManyWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.deepEqual(ack.kicked, []);
  assert.deepEqual(ack.notKicked, []);
});
