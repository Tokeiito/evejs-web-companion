// R103 Phase-4 BOUND WRITE acks — WB-PI: the 4 planet colony-op writes
// (UserUpdateNetwork / UserLaunchCommodities / UserTransferCommodities /
// UserAbandonPlanet) that hang off the R77 planetMgr.MachoBindObject(planetID)
// bind. PLUMBING ONLY — no UI.
//
// Each write dispatches as a BOUND method off planetBindSpec(planetID) (the BFF
// binds the caller-sent planetID and holds the OID handle; the browser never sees
// it), NOT the top-level /call seam. Every BFF route is confirm-gated (refuses
// without `confirm:true`) and folds the server return into the uniform ack
// `{ok, applied, result, notifications}` (dispatchBoundPlanetWrite in server.js).
// ⚠ UserAbandonPlanet DESTROYS the colony — its route carries an extra-explicit
// confirm message.
//
// ⚠ OWNERSHIP: the planetID is caller-supplied, but every handler forces the owner
// to the SESSION char, so a caller can only touch its OWN colony on the bound
// planet — NOT the R77 read leak #18-#20 (which took a caller-supplied ownerID).
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS;
// no server restart), so this decoder was written from the planetMgr handler code,
// not captured bytes. UserUpdateNetwork returns a serialized colony (KeyVal),
// UserLaunchCommodities a launch descriptor, UserTransferCommodities a
// [simTime, runTime] bigint pair, UserAbandonPlanet null — `result` carries each
// through UNTOUCHED for a future PI UI to decode. `applied` is the confirm-gate's
// did-not-throw signal; a panel re-reads the colony to prove the mutation.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R103 bound planet colony-op write returns. */
export interface PlanetWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return — a serialized colony / launch descriptor / time pair / null. */
  readonly result: JsonValue | null;
}

/**
 * Decode an R103 bound planet colony-op write ack. `applied` is the confirm-gate's
 * did-not-throw signal; `result` passes the handler return through. FAST-MODE:
 * never fired live, so this is an educated guess from the planetMgr handler code.
 */
export function decodePlanetWriteAck(response: JsonValue): PlanetWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
