import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeInSpaceWriteAck,
  decodeSkyhookWriteAck,
  decodeFuelAccessGroupWriteAck,
} from "./inSpaceWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R92 in-space service write acks (Phase-3 WRITES) -----------------------

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("decodeInSpaceWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeInSpaceWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeInSpaceWriteAck is false for a non-object / unsuccessful response (never throws)", () => {
  assert.deepEqual(decodeInSpaceWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeInSpaceWriteAck(plainAck({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeSkyhookWriteAck surfaces the processed skyhook id list", () => {
  const result: JsonValue = { type: "list", items: [9001, 9002] } as unknown as JsonValue;
  const ack = decodeSkyhookWriteAck(plainAck({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.skyhookIDs, [9001, 9002]);
});

test("decodeSkyhookWriteAck yields an empty list when nothing was processed", () => {
  const ack = decodeSkyhookWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack.skyhookIDs, []);
});

test("decodeFuelAccessGroupWriteAck reads the new fuel-access group id off result", () => {
  const ack = decodeFuelAccessGroupWriteAck(plainAck({ ok: true, applied: true, result: 3 }));
  assert.equal(ack.fuelAccessGroupID, 3);
});

test("decodeFuelAccessGroupWriteAck is 0 when the write was a no-op (null result)", () => {
  const ack = decodeFuelAccessGroupWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.equal(ack.fuelAccessGroupID, 0);
});
