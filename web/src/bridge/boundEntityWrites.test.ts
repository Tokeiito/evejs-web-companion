// R102 Phase-4 bound entity drone-command write-ack decoder tests — WB-ENTITY
// (CmdReturnHome / CmdSalvage / CmdAbandonDrone / CmdReconnectToDrones). PLUMBING
// ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeEntityDroneWriteAck } from "./boundEntityWrites.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R102 — a per-drone multi-result dict is carried through untouched", () => {
  const multi: JsonValue = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [["9000000001", { type: "list", items: ["returned"] }]],
    },
  };
  const ack = decodeEntityDroneWriteAck(ackKeyVal({ ok: true, applied: true, result: multi }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, multi);
});

test("R102 — a null-returning drone command decodes to {ok, applied, result:null}", () => {
  const ack = decodeEntityDroneWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R102 — a refused (unconfirmed) drone command is not-applied, not a throw", () => {
  const ack = decodeEntityDroneWriteAck(ackKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});
