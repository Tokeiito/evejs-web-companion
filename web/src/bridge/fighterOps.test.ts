import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeFighterWriteAck,
  decodeFighterBoolAck,
  decodeFighterCommandAck,
} from "./fighterOps.ts";
import type { JsonValue } from "./wire.ts";

// --- R90 fighter-manager op write acks (Phase-3 WRITES) ---------------------

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("decodeFighterWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeFighterWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeFighterBoolAck maps a true server result to accepted:true", () => {
  const accepted = decodeFighterBoolAck(plainAck({ ok: true, applied: true, result: true }));
  assert.equal(accepted.accepted, true);
  const refused = decodeFighterBoolAck(plainAck({ ok: true, applied: true, result: false }));
  assert.equal(refused.accepted, false);
});

test("decodeFighterCommandAck counts per-tube/fighter error entries (0 = all accepted)", () => {
  const clean: JsonValue = { type: "dict", entries: [] } as unknown as JsonValue;
  assert.equal(decodeFighterCommandAck(plainAck({ ok: true, applied: true, result: clean })).errorCount, 0);

  const withErrors: JsonValue = {
    type: "dict",
    entries: [
      ["1", "TUBE_EMPTY"],
      ["2", "NOT_IN_SPACE"],
    ],
  } as unknown as JsonValue;
  const ack = decodeFighterCommandAck(plainAck({ ok: true, applied: true, result: withErrors }));
  assert.equal(ack.applied, true);
  assert.equal(ack.errorCount, 2);
});

test("decodeFighterCommandAck is safe (errorCount 0) for a non-dict / absent result", () => {
  assert.equal(decodeFighterCommandAck(plainAck({ ok: true, applied: true })).errorCount, 0);
});
