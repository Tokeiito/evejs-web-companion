import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeFittingWriteAck,
  decodeSaveManyFittingsAck,
  decodeDeleteManyFittingsAck,
} from "./fittingWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R91 fitting-library write acks (Phase-3 WRITES) ------------------------

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
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
  const ack = decodeFittingWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeFittingWriteAck is false for a non-object / unsuccessful response (never throws)", () => {
  assert.deepEqual(decodeFittingWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeFittingWriteAck(plainAck({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeSaveManyFittingsAck surfaces the newly-saved real fitting ids", () => {
  const result: JsonValue = {
    type: "list",
    items: [mappingRow(-1, 5001), mappingRow(-2, 5002)],
  } as unknown as JsonValue;
  const ack = decodeSaveManyFittingsAck(plainAck({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.savedFittingIDs, [5001, 5002]);
});

test("decodeSaveManyFittingsAck yields an empty list when nothing was saved", () => {
  const ack = decodeSaveManyFittingsAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack.savedFittingIDs, []);
});

test("decodeDeleteManyFittingsAck surfaces the deleted fitting ids", () => {
  const result: JsonValue = { type: "list", items: [5001, 5002] } as unknown as JsonValue;
  const ack = decodeDeleteManyFittingsAck(plainAck({ ok: true, applied: true, result }));
  assert.deepEqual(ack.deletedFittingIDs, [5001, 5002]);
});
