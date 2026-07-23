// R99 Phase-4 write-ack decoders — allianceRegistry + warRegistry + corpStationMgr
// (alliance governance / bill / relationships, war negotiations, corp-HQ move).
// PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeAllianceWarStationWriteAck } from "./writesAllianceWarStation.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R99 — a null-returning alliance/war/station write decodes to {ok, applied, result:null}", () => {
  const ack = decodeAllianceWarStationWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R99 — a refused (unconfirmed) / role-refused write is not-applied, not a throw", () => {
  const ack = decodeAllianceWarStationWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R99 — any raw result value is passed through untouched", () => {
  const record: JsonValue = { type: "dict", entries: [["warNegotiationID", 7]] };
  const ack = decodeAllianceWarStationWriteAck(ackKeyVal({ ok: true, applied: true, result: record }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, record);
});
