// R105 Phase-4 bound fleet composition/membership/broadcast write-ack decoder tests —
// WB-FLEET (CreateWing / CreateSquad / MoveMember / KickMember / MakeLeader / LeaveFleet /
// DisbandFleet / SetOptions / SetMotdEx / UpdateMemberInfo / SendBroadcast / Invite /
// MassInvite / AcceptInvite / RejectInvite / Reconnect). PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeFleetBoundWriteAck } from "./boundFleetWrites.ts";
import type { JsonValue } from "./wire.ts";

function ackKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R105 WB-FLEET — a true-returning roster verb decodes to {ok, applied, result:true}", () => {
  const ack = decodeFleetBoundWriteAck(ackKeyVal({ ok: true, applied: true, result: true }));
  assert.deepEqual(ack, { ok: true, applied: true, result: true });
});

test("R105 WB-FLEET — a null-returning verb (SetOptions/Reconnect) decodes result:null", () => {
  const ack = decodeFleetBoundWriteAck(ackKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R105 WB-FLEET — an absent result field is normalized to null (never undefined)", () => {
  const ack = decodeFleetBoundWriteAck(ackKeyVal({ ok: true, applied: true }));
  assert.equal(ack.result, null);
});

test("R105 WB-FLEET — a refused (unconfirmed) DisbandFleet is not-applied, not a throw", () => {
  // The confirm-gate answers {ok:false, error:CONFIRMATION_REQUIRED} without applied;
  // the decoder must read that as not-applied and never throw.
  const ack = decodeFleetBoundWriteAck(ackKeyVal({ ok: false, applied: false }));
  assert.equal(ack.ok, false);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("R105 WB-FLEET — a non-keyval / null response decodes to all-false (never throws)", () => {
  assert.deepEqual(decodeFleetBoundWriteAck(null as unknown as JsonValue), {
    ok: false,
    applied: false,
    result: null,
  });
});

test("R105 WB-FLEET — a KickMember ack result is carried through untouched", () => {
  const ack = decodeFleetBoundWriteAck(ackKeyVal({ ok: true, applied: true, result: true }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, true);
});
