// R106 marketProxy FINANCIAL write-ack decoder (WB-MARKET) — educated-guess
// decoder against the uniform BFF write ack. NONE of the three writes is ever
// fired live; these assert only that a well-formed ack decodes to {ok, applied}
// and that a declined write reads as not-applied rather than throwing.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeMarketWriteAck } from "./marketWrites.ts";
import type { JsonValue } from "./wire.ts";

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("R106 — a marketProxy write ack decodes to {ok, applied}", () => {
  const ack = decodeMarketWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R106 — a declined market write is read as not-applied, not a throw", () => {
  const ack = decodeMarketWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
});
