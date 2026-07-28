// R103 Phase-4 bound planet colony-op write-ack decoder tests — WB-PI
// (UserUpdateNetwork / UserLaunchCommodities / UserTransferCommodities /
// UserAbandonPlanet). PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodePlanetWriteAck } from "./boundPlanetWrites.ts";
import type { JsonValue } from "./wire.ts";

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("R103 WB-PI — a serialized colony (UserUpdateNetwork) is carried through untouched", () => {
  const colony: JsonValue = {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["planetID", 40009077]] },
  };
  const ack = decodePlanetWriteAck(plainAck({ ok: true, applied: true, result: colony }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, colony);
});

test("R103 WB-PI — a [simTime, runTime] transfer pair is carried through untouched", () => {
  const pair: JsonValue = { type: "list", items: ["133000000000000000", "133000000000000010"] };
  const ack = decodePlanetWriteAck(plainAck({ ok: true, applied: true, result: pair }));
  assert.deepEqual(ack.result, pair);
});

test("R103 WB-PI — a null-returning abandon decodes to {ok, applied, result:null}", () => {
  const ack = decodePlanetWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R103 WB-PI — a refused (unconfirmed) colony write is not-applied, not a throw", () => {
  const ack = decodePlanetWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});
