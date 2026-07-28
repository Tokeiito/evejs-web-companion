// R100 Phase-4 BOUND WRITE acks — WB-DOGMA batch A: the 11 dogma module-op writes
// (target-drop / overload / stop-overload / nanite module-repair / weapon-bank
// link/merge) that hang off the R74 dogmaIM.MachoBindObject bind. PLUMBING ONLY —
// no UI.
//
// Each write dispatches as a BOUND method off dogmaBindSpec() (dogmaCall the same
// two-step the R74 dogma READS use — the BFF holds the OID handle, the browser
// never sees it), NOT the top-level /call seam. Every BFF route is confirm-gated
// (refuses without `confirm:true`) and folds the server return into the uniform
// ack `{ok, applied, result, notifications}` (dispatchBoundDogmaWrite in server.js).
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS;
// no server restart), so these decoders were written from the dogmaService handler
// code, not captured bytes. The handlers' returns VARY, and `result` carries each
// through UNTOUCHED for a future ship/fitting UI to decode:
//   RemoveTargets / ClearTargets                      → null
//   Overload / StopOverload                           → the moduleID (a number)
//   OverloadRack / StopOverloadRack                   → [moduleID, …]
//   InitiateModuleRepair / StopModuleRepair           → a boolean
//   InitiateModuleRepairMany                          → [success[], missing[], failed[]]
//   LinkWeapons / MergeModuleGroups                   → a weapon-bank state dict
// So `applied` is the confirm-gate's did-not-throw signal and a panel re-reads
// (GetAllInfo / the ship snapshot) to prove the mutation.
//
// R101 WB-DOGMA batch B (CLOSES WB-DOGMA, 22/22) reuses this SAME decoder for its
// 11 writes — weapon-bank peel/unlink/link-all/unlink-all/destroy, probe launch,
// drone settings, and the char-brain inject-skill / inject-implant / destroy-
// implant / use-booster ops — every one folds its (varied) return into the same
// {ok, applied, result} ack. See boundDogmaWrites.test.ts for the R101 shape cases.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R100 bound dogma module-op write returns. */
export interface DogmaModuleWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return, carried through untouched (shape varies per method —
   * null / a moduleID / a moduleID list / a boolean / a triple / a bank dict). */
  readonly result: JsonValue | null;
}

/**
 * Decode an R100 bound dogma module-op write ack. `applied` is the confirm-gate's
 * did-not-throw signal; `result` passes the (method-specific) raw return through.
 * FAST-MODE: never fired live, so this is an educated guess from the handler code.
 */
export function decodeDogmaModuleWriteAck(response: JsonValue): DogmaModuleWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
