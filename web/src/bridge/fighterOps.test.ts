import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeFighterWriteAck,
  decodeFighterBoolAck,
  decodeFighterCommandAck,
} from "./fighterOps.ts";
import type { JsonValue } from "./wire.ts";

// --- R90 fighter-manager op write acks (Phase-3 WRITES) ---------------------

/** A util.KeyVal wrapper around plain fields (the BFF write-ack shape the decoder reads). */
function fighterAckKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

test("decodeFighterWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeFighterWriteAck(fighterAckKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeFighterBoolAck maps a true server result to accepted:true", () => {
  const accepted = decodeFighterBoolAck(fighterAckKeyVal({ ok: true, applied: true, result: true }));
  assert.equal(accepted.accepted, true);
  const refused = decodeFighterBoolAck(fighterAckKeyVal({ ok: true, applied: true, result: false }));
  assert.equal(refused.accepted, false);
});

test("decodeFighterCommandAck counts per-tube/fighter error entries (0 = all accepted)", () => {
  const clean: JsonValue = { type: "dict", entries: [] } as unknown as JsonValue;
  assert.equal(decodeFighterCommandAck(fighterAckKeyVal({ ok: true, applied: true, result: clean })).errorCount, 0);

  const withErrors: JsonValue = {
    type: "dict",
    entries: [
      ["1", "TUBE_EMPTY"],
      ["2", "NOT_IN_SPACE"],
    ],
  } as unknown as JsonValue;
  const ack = decodeFighterCommandAck(fighterAckKeyVal({ ok: true, applied: true, result: withErrors }));
  assert.equal(ack.applied, true);
  assert.equal(ack.errorCount, 2);
});

test("decodeFighterCommandAck is safe (errorCount 0) for a non-dict / absent result", () => {
  assert.equal(decodeFighterCommandAck(fighterAckKeyVal({ ok: true, applied: true })).errorCount, 0);
});
