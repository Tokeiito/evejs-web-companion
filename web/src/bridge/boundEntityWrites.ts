// R102 Phase-4 BOUND WRITE acks — WB-ENTITY: the 4 drone-command writes
// (CmdReturnHome / CmdSalvage / CmdAbandonDrone / CmdReconnectToDrones) that hang
// off the R72 entity.MachoBindObject bind. PLUMBING ONLY — no UI.
//
// Each write dispatches as a BOUND Cmd* method off entityBindSpec() (the same
// bound two-step the dogma writes use — the BFF holds the OID handle, the browser
// never sees it), NOT the top-level /call seam. Every BFF route is confirm-gated
// (refuses without `confirm:true`) and folds the server return into the uniform
// ack `{ok, applied, result, notifications}` (dispatchBoundEntityWrite in
// server.js). ⚠ CmdAbandonDrone PERMANENTLY DISOWNS the drones — its route carries
// an extra-explicit confirm message.
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS;
// no server restart), so this decoder was written from the droneRuntime handler
// code, not captured bytes. Every command returns a per-drone MULTI-RESULT dict
// (buildMultiDroneResult — a map of droneID → outcome/error), and `result` carries
// it through UNTOUCHED for a future drone UI to decode. `applied` is the confirm-
// gate's did-not-throw signal; a panel re-reads the space snapshot to prove it.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R102 bound entity drone-command write returns. */
export interface EntityDroneWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return — a per-drone multi-result dict — carried through untouched. */
  readonly result: JsonValue | null;
}

/**
 * Decode an R102 bound entity drone-command write ack. `applied` is the confirm-
 * gate's did-not-throw signal; `result` passes the per-drone multi-result dict
 * through. FAST-MODE: never fired live, so this is an educated guess from the
 * droneRuntime handler code.
 */
export function decodeEntityDroneWriteAck(response: JsonValue): EntityDroneWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
