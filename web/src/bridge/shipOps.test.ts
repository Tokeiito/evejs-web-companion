import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeShipWriteAck,
  decodeJettisonAck,
  decodeStoreVesselAck,
} from "./shipOps.ts";
import type { JsonValue } from "./wire.ts";

// --- R90 ship in-space op write acks (Phase-3 WRITES) -----------------------

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("decodeShipWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeShipWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeShipWriteAck is false for a non-object / unsuccessful response (never throws)", () => {
  assert.deepEqual(decodeShipWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeShipWriteAck(plainAck({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeJettisonAck surfaces the jettisoned-to-can id list", () => {
  const result: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [9001, 9002] },
      { type: "list", items: [] },
    ],
  } as unknown as JsonValue;
  const ack = decodeJettisonAck(plainAck({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.jettisonedToCanIDs, [9001, 9002]);
});

test("decodeJettisonAck yields an empty id list for a failed/no-op jettison", () => {
  const result: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [] },
      { type: "list", items: [] },
    ],
  } as unknown as JsonValue;
  const ack = decodeJettisonAck(plainAck({ ok: true, applied: true, result }));
  assert.deepEqual(ack.jettisonedToCanIDs, []);
});

test("decodeStoreVesselAck reads the new capsule itemID (null when absent)", () => {
  const withCapsule = decodeStoreVesselAck(plainAck({ ok: true, applied: true, result: 12345 }));
  assert.equal(withCapsule.capsuleID, 12345);
  const docked = decodeStoreVesselAck(plainAck({ ok: true, applied: true, result: null }));
  assert.equal(docked.capsuleID, null);
});
