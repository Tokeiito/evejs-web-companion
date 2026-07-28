import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeContractWriteAck,
  decodeCreateContractAck,
  decodeAcceptContractAck,
  decodeDeleteMultipleContractsAck,
} from "./contractWrites.ts";
import type { JsonValue } from "./wire.ts";

// --- R91 contract write acks (Phase-3 WRITES) -------------------------------

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

function contractRow(contractID: number): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["contractID", contractID]] },
  } as unknown as JsonValue;
}

test("decodeContractWriteAck reads ok/applied off the BFF envelope", () => {
  const ack = decodeContractWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("decodeContractWriteAck is false for a non-object / unsuccessful response (never throws)", () => {
  assert.deepEqual(decodeContractWriteAck(null as unknown as JsonValue), { ok: false, applied: false });
  assert.deepEqual(decodeContractWriteAck(plainAck({ ok: false, applied: false })), {
    ok: false,
    applied: false,
  });
});

test("decodeCreateContractAck surfaces the new contract id list", () => {
  const result: JsonValue = { type: "list", items: [8100, 8101] } as unknown as JsonValue;
  const ack = decodeCreateContractAck(plainAck({ ok: true, applied: true, result }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.contractIDs, [8100, 8101]);
});

test("decodeCreateContractAck yields an empty list when nothing was created", () => {
  const ack = decodeCreateContractAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack.contractIDs, []);
});

test("decodeAcceptContractAck reads the contract id off the returned row", () => {
  const ack = decodeAcceptContractAck(
    plainAck({ ok: true, applied: true, result: contractRow(8100) }),
  );
  assert.equal(ack.contractID, 8100);
});

test("decodeAcceptContractAck is 0 when the accept was declined (null row)", () => {
  const ack = decodeAcceptContractAck(plainAck({ ok: true, applied: true, result: null }));
  assert.equal(ack.contractID, 0);
});

test("decodeDeleteMultipleContractsAck splits deleted vs failed", () => {
  const result: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [8100, 8101] },
      { type: "list", items: [8102] },
    ],
  } as unknown as JsonValue;
  const ack = decodeDeleteMultipleContractsAck(plainAck({ ok: true, applied: true, result }));
  assert.deepEqual(ack.deleted, [8100, 8101]);
  assert.deepEqual(ack.failed, [8102]);
});
