// R95 Phase-4 top-level WRITE acks — skills (WB-SKILL) + clones (WB-CLONE) +
// safety (WB-CRIME). PLUMBING ONLY — no UI.
//
// The FIRST Phase-4 write batch. Each write dispatches on the ordinary top-level
// /call seam against the SAME three session-scoped services their R73/R76/R78
// reads opened — skillHandler, jumpCloneSvc, crimewatch — and every BFF route is
// confirm-gated. The BFF folds each server return into the uniform confirm-gate
// ack `{ok, applied, result, notifications}` (dispatchBridgeWrite in server.js).
//
// FAST-MODE educated-guess decoders (server code, not captured real bytes —
// QA/real-impl later). Most skill/clone writes answer null (the panel re-reads
// the skill sheet / clone state to prove the mutation), so `applied` is the whole
// story. Two carry a meaningful scalar return, decoded here:
//   - crimewatch.SetSafetyLevel returns the NEW safety level (an int: 0=disabled,
//     1=partial, 2=full), surfaced as `safetyLevel`.
//   - jumpCloneSvc.* / skillHandler.* that return an object pass it through raw as
//     `result` for a later real decoder; this module does not guess its shape.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readKeyVal, type JsonValue } from "./wire.ts";

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

/** The uniform ack every confirm-gated R95 write returns. */
export interface SkillCloneWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return (null for most; a scalar/object for a few). */
  readonly result: JsonValue | null;
}

/**
 * Decode a skill / clone write ack (start-training / abort / extract / inject /
 * split / combine / install-clone / clone-jump / destroy / rename / ship-offer).
 * Most answer null; `applied` is the confirm-gate's did-not-throw signal and the
 * panel re-reads to confirm. `result` carries any raw scalar/object through.
 */
export function decodeSkillCloneWriteAck(response: JsonValue): SkillCloneWriteAck {
  const result = readKeyVal(response, "result");
  return {
    ok: truthy(readKeyVal(response, "ok")),
    applied: truthy(readKeyVal(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}

/** The SetSafetyLevel ack — the NEW safety level the server settled on. */
export interface SafetyLevelWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** 0=disabled, 1=partial, 2=full; null when the server did not echo a level. */
  readonly safetyLevel: number | null;
}

/** Decode the crimewatch.SetSafetyLevel ack — the server echoes the new level. */
export function decodeSafetyLevelWriteAck(response: JsonValue): SafetyLevelWriteAck {
  return {
    ok: truthy(readKeyVal(response, "ok")),
    applied: truthy(readKeyVal(response, "applied")),
    safetyLevel: intOrNull(readKeyVal(response, "result")),
  };
}
