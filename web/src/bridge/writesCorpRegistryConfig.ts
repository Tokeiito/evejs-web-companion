// R97 Phase-4 top-level WRITE acks — corpRegistry batch B (WB-CORPREG split 2 of
// ~3): member config + corp config + settings + title-delete + a generic corp-
// action executor. PLUMBING ONLY — no UI.
//
// Each write dispatches on the ordinary top-level /call seam against the SAME
// "corpRegistry" service the R80/R81/R82 reads and the R96 batch-A writes opened —
// every handler resolves the corp from the SESSION (resolveCorporationID(session)),
// never a bound context, so there is no MachoBindObject two-step. Every BFF route
// is confirm-gated and the BFF folds each server return into the uniform ack
// `{ok, applied, result, notifications}` (dispatchBridgeWrite in server.js).
//
// FAST-MODE educated-guess decoders (read from the server handler code, not from
// captured real bytes — real decode / QA later). Twelve of the fourteen answer null
// (the panel re-reads the members / corp record / settings to prove the mutation),
// so `applied` is the whole story. Two carry a meaningful return, decoded here:
//   - SetAccountKey returns a BOOLEAN (the handler answers `true` on success).
//   - RegisterNewAggressionSettings returns an aggression-settings PAYLOAD object
//     (buildAggressionSettingsPayload); passed through as raw `result`.
// The remaining twelve return null; a foreign memberID/titleID simply misses the
// session-corp table (no-op), never mutating another corp.
//
// ⚠ ROLE-GATED: corpRegistry writes are CEO/director-role-gated server-side; a
// session lacking the role gets a role refusal / error return (surfaced as a
// non-applied ack / a thrown gateway error), which is CORRECT behavior, not a
// decode bug.
//
// ⚠ EXTRA-CARE — DeleteTitle (destructive) and ExecuteActions (a generic corp-
// action executor) are reachable + refuse-without-confirm ONLY, never fired live.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readKeyVal, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R97 corpRegistry-config write returns. */
export interface CorpRegistryConfigWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return (null for most; a bool for SetAccountKey; an
   * aggression-settings payload object for RegisterNewAggressionSettings). */
  readonly result: JsonValue | null;
}

/**
 * Decode a corpRegistry batch-B write ack (update-member / update-members /
 * update-corp / abilities / logo / division-names / welcome-mail / reinforce-
 * default / accept-structures / mail-restriction / delete-title / execute-actions).
 * Most answer null; `applied` is the confirm-gate's did-not-throw signal and the
 * panel re-reads to confirm. `result` carries any raw value through untouched.
 */
export function decodeCorpRegistryConfigWriteAck(response: JsonValue): CorpRegistryConfigWriteAck {
  const result = readKeyVal(response, "result");
  return {
    ok: truthy(readKeyVal(response, "ok")),
    applied: truthy(readKeyVal(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}

/** The ack for SetAccountKey, whose handler returns a boolean success flag. */
export interface CorpRegistryBoolWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The server's boolean return (true on success); false when absent/falsey. */
  readonly value: boolean;
}

/**
 * Decode SetAccountKey's ack — the handler answers a bare boolean as the dispatch
 * result. Anything that is not literally `true` reads as false.
 */
export function decodeCorpRegistryBoolWriteAck(response: JsonValue): CorpRegistryBoolWriteAck {
  return {
    ok: truthy(readKeyVal(response, "ok")),
    applied: truthy(readKeyVal(response, "applied")),
    value: readKeyVal(response, "result") === true,
  };
}
