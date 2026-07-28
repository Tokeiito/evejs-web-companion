// R103 Phase-4 bound beyonce nav/bookmark write-ack decoder tests — WB-BEYONCE
// (CmdGotoPoint / CmdGotoBookmark / CmdAbandonLoot / CmdFleetTagTarget /
// CmdJumpThroughFleet / BookmarkLocation / BookmarkScanResult). PLUMBING ONLY.
// None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeBeyonceWriteAck } from "./boundBeyonceWrites.ts";
import type { JsonValue } from "./wire.ts";

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("R103 WB-BEYONCE — a null-returning nav verb carries the post-write flight snapshot", () => {
  const flight: JsonValue = {
    inSpace: true,
    solarSystemID: 30000142,
  };
  const ack = decodeBeyonceWriteAck(plainAck({ ok: true, applied: true, result: null, flight }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, null);
  assert.deepEqual(ack.flight, flight);
});

test("R103 WB-BEYONCE — a bookmark id (BookmarkLocation) is carried through untouched", () => {
  const ack = decodeBeyonceWriteAck(plainAck({ ok: true, applied: true, result: 1000000012345 }));
  assert.equal(ack.result, 1000000012345);
  assert.equal(ack.flight, null);
});

test("R103 WB-BEYONCE — a refused (unconfirmed) nav write is not-applied, not a throw", () => {
  const ack = decodeBeyonceWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
  assert.equal(ack.flight, null);
});
