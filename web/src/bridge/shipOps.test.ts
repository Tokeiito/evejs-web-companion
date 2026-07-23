import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeShipWriteAck,
  decodeJettisonAck,
  decodeStoreVesselAck,
} from "./shipOps.ts";
import type { JsonValue } from "./wire.ts";

// --- R90 ship in-space op write acks (Phase-3 WRITES) -----------------------

/** A util.KeyVal wrapper around plain fields (the BFF write-ack shape the decoder reads). */
function shipAckKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

test("decodeShipWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeShipWriteAck(shipAckKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeShipWriteAck is false for a non-keyval / empty response (never throws)", () => {
  assert.deepEqual(decodeShipWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeShipWriteAck(shipAckKeyVal({ ok: false, applied: false })), {
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
  const ack = decodeJettisonAck(shipAckKeyVal({ ok: true, applied: true, result }));
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
  const ack = decodeJettisonAck(shipAckKeyVal({ ok: true, applied: true, result }));
  assert.deepEqual(ack.jettisonedToCanIDs, []);
});

test("decodeStoreVesselAck reads the new capsule itemID (null when absent)", () => {
  const withCapsule = decodeStoreVesselAck(shipAckKeyVal({ ok: true, applied: true, result: 12345 }));
  assert.equal(withCapsule.capsuleID, 12345);
  const docked = decodeStoreVesselAck(shipAckKeyVal({ ok: true, applied: true, result: null }));
  assert.equal(docked.capsuleID, null);
});
