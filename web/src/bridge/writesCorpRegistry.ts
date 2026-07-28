// R96 Phase-4 top-level WRITE acks — corpRegistry batch A (WB-CORPREG split 1 of
// ~3): bulletins + labels + contacts + titles. PLUMBING ONLY — no UI.
//
// Each write dispatches on the ordinary top-level /call seam against the SAME
// "corpRegistry" service its R80/R81/R82 sibling reads opened — every handler
// resolves the corp from the SESSION (resolveCorporationID(session)), never a
// bound context, so there is no MachoBindObject two-step. Every BFF route is
// confirm-gated and the BFF folds each server return into the uniform ack
// `{ok, applied, result, notifications}` (dispatchBridgeWrite in server.js).
//
// FAST-MODE educated-guess decoders (read from the server handler code, not from
// captured real bytes — real decode / QA later). Most corpRegistry batch-A writes
// answer null (the panel re-reads the bulletins / labels / contacts / titles to
// prove the mutation), so `applied` is the whole story. Three carry a meaningful
// integer id return, decoded here:
//   - AddBulletin / UpdateBulletin return the bulletinID (the AddBulletin handler
//     allocates or reuses one and returns it).
//   - CreateLabel returns the newly allocated labelID.
// The remaining twelve return null; a foreign id simply misses the session-corp
// table (no-op), never mutating another corp.
//
// ⚠ ROLE-GATED: corpRegistry writes are CEO/director-role-gated server-side; a
// session lacking the role gets a role refusal / error return (surfaced as a
// non-applied ack / a thrown gateway error), which is CORRECT behavior, not a
// decode bug.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** A finite integer from a bare number / numeric-string, else null. */
function intOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

/** The uniform ack every confirm-gated R96 corpRegistry write returns. */
export interface CorpRegistryWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return (null for most; an id scalar for a few). */
  readonly result: JsonValue | null;
}

/**
 * Decode a corpRegistry batch-A write ack (update-bulletin-order / delete-bulletin
 * / edit-label / delete-label / assign-labels / remove-labels / add-contact /
 * edit-contact / remove-contacts / edit-relationship / update-title / update-
 * titles). Most answer null; `applied` is the confirm-gate's did-not-throw signal
 * and the panel re-reads to confirm. `result` carries any raw value through.
 */
export function decodeCorpRegistryWriteAck(response: JsonValue): CorpRegistryWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}

/** The ack for a write that returns a freshly allocated id (bulletinID / labelID). */
export interface CorpRegistryIdWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The allocated/echoed id (bulletinID for AddBulletin/UpdateBulletin, labelID
   * for CreateLabel); null when the server did not echo one. */
  readonly id: number | null;
}

/**
 * Decode an id-returning corpRegistry write ack — AddBulletin / UpdateBulletin
 * (bulletinID) and CreateLabel (labelID). The server returns the integer id as the
 * dispatch result; a panel keys the new row off it.
 */
export function decodeCorpRegistryIdWriteAck(response: JsonValue): CorpRegistryIdWriteAck {
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    id: intOrNull(readPlainJsonField(response, "result")),
  };
}
