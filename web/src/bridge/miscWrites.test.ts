import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeMiscWriteAck,
  decodeCreatePetitionAck,
  decodeCompleteManyJobsAck,
} from "./miscWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R93 misc-utility service write acks (Phase-3 WRITES) -------------------

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("decodeMiscWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeMiscWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeMiscWriteAck is false for a non-object / unsuccessful response (never throws)", () => {
  assert.deepEqual(decodeMiscWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeMiscWriteAck(plainAck({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeCreatePetitionAck surfaces accepted=false for the stub rejection (result:false)", () => {
  const ack = decodeCreatePetitionAck(plainAck({ ok: true, applied: true, result: false }));
  assert.equal(ack.applied, true);
  assert.equal(ack.accepted, false);
});

test("decodeCreatePetitionAck reports accepted=true only when the handler returned true", () => {
  const ack = decodeCreatePetitionAck(plainAck({ ok: true, applied: true, result: true }));
  assert.equal(ack.accepted, true);
});

test("decodeCompleteManyJobsAck counts the delivered job payloads off a list result", () => {
  const result: JsonValue = { type: "list", items: [{}, {}, {}] } as unknown as JsonValue;
  const ack = decodeCompleteManyJobsAck(plainAck({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.equal(ack.deliveredCount, 3);
});

test("decodeCompleteManyJobsAck is 0 delivered when nothing came back (null result)", () => {
  const ack = decodeCompleteManyJobsAck(plainAck({ ok: true, applied: true, result: null }));
  assert.equal(ack.deliveredCount, 0);
});
