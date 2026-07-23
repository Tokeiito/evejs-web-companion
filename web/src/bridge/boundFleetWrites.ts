// R105 Phase-4 BOUND WRITE acks — WB-FLEET: the 16 fleet composition / membership /
// broadcast writes (CreateWing / CreateSquad / MoveMember / KickMember / MakeLeader /
// LeaveFleet / DisbandFleet / SetOptions / SetMotdEx / UpdateMemberInfo / SendBroadcast /
// Invite / MassInvite / AcceptInvite / RejectInvite / Reconnect) that hang off the R72
// fleetObjectHandler.MachoBindObject bind. CLOSES WB-FLEET (21/21 with the R94/R95
// top-level fleet writes) → writes 298/301. PLUMBING ONLY — no UI.
//
// Each write dispatches as a BOUND method off fleetBindSpec() (dispatchBoundFleetWrite in
// server.js), NOT the top-level /call seam. The BFF holds the OID handle; the browser never
// sees it. Unlike the scanMgr bind, MachoBindObject accepts a caller fleetID — but the BFF
// passes args:[] so the server binds the SESSION's OWN fleet (never a caller fleetID; the
// caller-fleetID leak lives only on the generic /api/bridge/call seam). AND every roster
// mutator is role-gated server-side (boss / commander / membership) before it mutates.
// Every BFF route is confirm-gated (refuses without `confirm:true`); ⚠ DisbandFleet
// (destroys the fleet) and KickMember (removes another char) carry extra-explicit confirm
// messages, and fold the server return into the uniform ack `{ok, applied, result,
// notifications}`.
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS; no server
// restart), so this decoder was written from the fleetObjectHandlerService handler shapes,
// not captured bytes. Most verbs return true / null; `result` carries each through
// UNTOUCHED for a future fleet UI to decode. `applied` is the confirm-gate's did-not-throw
// signal; a panel re-reads the fleet bound state (/api/bridge/bound-fleet) to prove the
// mutation.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated BFF
// route is the only path, and it refuses without `confirm: true`.

import { readKeyVal, type JsonValue } from "./wire.ts";

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
 * FAST-MODE: never fired live, so this is an educated guess from the fleet handler code.
 */
export function decodeFleetBoundWriteAck(response: JsonValue): FleetBoundWriteAck {
  const result = readKeyVal(response, "result");
  return {
    ok: truthy(readKeyVal(response, "ok")),
    applied: truthy(readKeyVal(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
