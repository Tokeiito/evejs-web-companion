// R105 Phase-4 BOUND WRITE acks — WB-FLEET: the 16 fleet composition / membership /
// broadcast writes (CreateWing / CreateSquad / MoveMember / KickMember / MakeLeader /
// LeaveFleet / DisbandFleet / SetOptions / SetMotdEx / UpdateMemberInfo / SendBroadcast /
// Invite / MassInvite / AcceptInvite / RejectInvite / Reconnect) that hang off the R72
// fleetObjectHandler.MachoBindObject bind. These acknowledgements now back Fleet Center
// and bot fleet actions; the Latest parity review tracks the deferred fleet methods.
//
// Each write dispatches as a BOUND method off fleetBindSpec() (dispatchBoundFleetWrite in
// server.js), NOT the top-level /call seam. The BFF holds the OID handle; the browser never
// sees it. Most routes bind the SESSION's OWN fleet. AcceptInvite / RejectInvite bind the
// fleet ID from the live invitation; Reconnect binds the saved fleet ID. The runtime still
// verifies the pending invite/member row, and every roster mutator is role-gated server-side
// (boss / commander / membership) before it mutates.
// Every BFF route is confirm-gated (refuses without `confirm:true`); ⚠ DisbandFleet
// (destroys the fleet) and KickMember (removes another char) carry extra-explicit confirm
// messages, and fold the server return into the uniform ack `{ok, applied, result,
// notifications}`.
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS; no server
// restart), so this decoder was written from the fleetObjectHandlerService handler shapes,
// not captured bytes. Most verbs return true / null; `result` carries each through
// UNTOUCHED for a future fleet UI to decode. `applied` is the confirm-gate's did-not-throw
// signal; Fleet Center re-reads the bound state (/api/bridge/bound-fleet) to prove the
// mutation. The outer acknowledgement is plain Express JSON; only its nested result can
// contain marshaled wire data.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated BFF
// route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R105 bound fleet write returns. */
export interface FleetBoundWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return — true / null / an ack, carried through untouched. */
  readonly result: JsonValue | null;
}

/**
 * Decode an R105 bound fleet composition/membership/broadcast write ack. `applied` is the
 * confirm-gate's did-not-throw signal; `result` passes the handler return through.
 * The outer envelope is plain Express JSON; the nested result remains intentionally raw.
 */
export function decodeFleetBoundWriteAck(response: JsonValue): FleetBoundWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
