import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeFleetWriteAck, decodeFleetAdvertWriteAck } from "./fleetWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R94 fleet top-level write acks (Phase-3 WRITES) -----------------------

test("decodeFleetWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeFleetWriteAck({ ok: true, applied: true, result: null });
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeFleetWriteAck is false for a non-object / empty response (never throws)", () => {
  assert.deepEqual(decodeFleetWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeFleetWriteAck({ ok: false, applied: false }), {
    ok: false,
    applied: false,
  });
});

test("decodeFleetAdvertWriteAck reports advertPresent=true when the handler returned an advert dict", () => {
  const advert: JsonValue = { type: "dict", entries: [["fleetID", 1]] } as unknown as JsonValue;
  const ack = decodeFleetAdvertWriteAck({ ok: true, applied: true, result: advert });
  assert.equal(ack.applied, true);
  assert.equal(ack.advertPresent, true);
});

test("decodeFleetAdvertWriteAck reports advertPresent=false when the handler returned null (no advert)", () => {
  const ack = decodeFleetAdvertWriteAck({ ok: true, applied: true, result: null });
  assert.equal(ack.applied, true);
  assert.equal(ack.advertPresent, false);
});
