import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeFittingWriteAck,
  decodeSaveManyFittingsAck,
  decodeDeleteManyFittingsAck,
} from "./fittingWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R91 fitting-library write acks (Phase-3 WRITES) ------------------------

/** A util.KeyVal wrapper around plain fields (the BFF write-ack shape the decoder reads). */
function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

function mappingRow(tempFittingID: number, realFittingID: number): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["tempFittingID", tempFittingID],
        ["realFittingID", realFittingID],
      ],
    },
  } as unknown as JsonValue;
}

test("decodeFittingWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeFittingWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeFittingWriteAck is false for a non-keyval / empty response (never throws)", () => {
  assert.deepEqual(decodeFittingWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeFittingWriteAck(ackKeyVal({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeSaveManyFittingsAck surfaces the newly-saved real fitting ids", () => {
  const result: JsonValue = {
    type: "list",
    items: [mappingRow(-1, 5001), mappingRow(-2, 5002)],
  } as unknown as JsonValue;
  const ack = decodeSaveManyFittingsAck(ackKeyVal({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.savedFittingIDs, [5001, 5002]);
});

test("decodeSaveManyFittingsAck yields an empty list when nothing was saved", () => {
  const ack = decodeSaveManyFittingsAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack.savedFittingIDs, []);
});

test("decodeDeleteManyFittingsAck surfaces the deleted fitting ids", () => {
  const result: JsonValue = { type: "list", items: [5001, 5002] } as unknown as JsonValue;
  const ack = decodeDeleteManyFittingsAck(ackKeyVal({ ok: true, applied: true, result }));
  assert.deepEqual(ack.deletedFittingIDs, [5001, 5002]);
});
