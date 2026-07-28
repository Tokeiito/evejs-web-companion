// R102 Phase-4 BOUND WRITE acks — WB-INV: the 7 inventory writes (SetLabel /
// StripFitting / FitFitting / AssembleCargoContainer / BreakPlasticWrap /
// DeliverToCorpHangar / DeliverToCorpMember) that hang off the R75 invbroker
// inventory-MANAGER moniker (Moniker("invbroker", (stationID, groupStation)) — the
// TrashItems handle). PLUMBING ONLY — no UI.
//
// Each write dispatches as a BOUND method off inventoryManagerBindSpec() (the same
// two-step the R75 inventory READS use — the BFF holds the OID handle, the browser
// never sees it), NOT the top-level /call seam. Every BFF route is confirm-gated
// (refuses without `confirm:true`) and folds the server return into the uniform ack
// `{ok, applied, result, notifications}` (dispatchBoundInventoryWrite in server.js).
// ⚠ StripFitting unfits a whole ship — its route carries an extra-explicit message.
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS;
// no server restart), so this decoder was written from the invBrokerService handler
// code, not captured bytes. The handlers' returns VARY, and `result` carries each
// through UNTOUCHED for a future fitting/inventory UI to decode:
//   SetLabel                                          → the new label / null
//   StripFitting                                      → a change list / null (empty ship)
//   FitFitting                                        → a fit-result dict (changes + missing)
//   AssembleCargoContainer / BreakPlasticWrap /
//     DeliverToCorpMember                             → null (server-side no-ops today)
//   DeliverToCorpHangar                               → true / null (nothing moved)
// So `applied` is the confirm-gate's did-not-throw signal and a panel re-reads the
// inventory / fitting snapshot to prove the mutation.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R102 bound inventory write returns. */
export interface InventoryWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return, carried through untouched (shape varies per method —
   * null / a label / a change list / a fit-result dict / a boolean). */
  readonly result: JsonValue | null;
}

/**
 * Decode an R102 bound inventory write ack. `applied` is the confirm-gate's
 * did-not-throw signal; `result` passes the (method-specific) raw return through.
 * FAST-MODE: never fired live, so this is an educated guess from the handler code.
 */
export function decodeInventoryWriteAck(response: JsonValue): InventoryWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
