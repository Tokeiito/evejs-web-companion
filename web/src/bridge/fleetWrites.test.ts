import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeFleetWriteAck, decodeFleetAdvertWriteAck } from "./fleetWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R94 fleet top-level write acks (Phase-3 WRITES) -----------------------

/** A util.KeyVal wrapper around plain fields (the BFF write-ack shape the decoder reads). */
function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

test("decodeFleetWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeFleetWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeFleetWriteAck is false for a non-keyval / empty response (never throws)", () => {
  assert.deepEqual(decodeFleetWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeFleetWriteAck(ackKeyVal({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeFleetAdvertWriteAck reports advertPresent=true when the handler returned an advert dict", () => {
  const advert: JsonValue = { type: "dict", entries: [["fleetID", 1]] } as unknown as JsonValue;
  const ack = decodeFleetAdvertWriteAck(ackKeyVal({ ok: true, applied: true, result: advert }));
  assert.equal(ack.applied, true);
  assert.equal(ack.advertPresent, true);
});

test("decodeFleetAdvertWriteAck reports advertPresent=false when the handler returned null (no advert)", () => {
  const ack = decodeFleetAdvertWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.equal(ack.applied, true);
  assert.equal(ack.advertPresent, false);
});
