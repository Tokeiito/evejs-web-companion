// R98 Phase-4 top-level WRITE acks — corpRegistry batch C (WB-CORPREG split 3 of 3,
// CLOSES corpRegistry writes at 43/43): shares / dividend / kicks / CEO-resign /
// applications / alliance / war. PLUMBING ONLY — no UI.
//
// Each write dispatches on the ordinary top-level /call seam against the SAME
// "corpRegistry" service the R80/R81/R82 reads and the R96/R97 batch-A/B writes
// opened — the DECLARER/ACTOR/SPENDER is derived from the SESSION server-side
// (resolveCorporationID / resolveCharacterID), never a bound context, so there is
// no MachoBindObject two-step. Every BFF route is confirm-gated and the BFF folds
// each server return into the uniform ack `{ok, applied, result, notifications}`
// (dispatchBridgeWrite in server.js).
//
// ⚠⚠ EVERY ONE IS FINANCIAL OR DESTRUCTIVE — these decoders were written from the
// server handler code (FAST-MODE educated guess), NOT from captured real bytes,
// because NONE of these writes was ever fired live (no shares moved, no dividend
// paid, no member kicked, no CEO resigned, no corp/alliance created, no war
// declared). Real decode / QA comes later.
//
// Server returns, by handler:
//   - MoveCompanyShares / MovePrivateShares  → null
//   - PayoutDividend                          → null (re-read the wallet)
//   - KickOutMember                           → null
//   - KickOutMembers                          → { kicked:[…], notKicked:[…] }
//   - ResignFromCEO                           → null
//   - InsertApplication                       → applicationID (number)
//   - InsertInvitation                        → invitationID (number)
//   - UpdateApplicationOffer                  → an application row / null
//   - AddCorporation                          → corporationID (number)
//   - CreateAlliance                          → allianceID (number)
//   - ApplyToJoinAlliance                     → null
//   - DeleteAllianceApplication               → null
//   - DeclareWarAgainst                       → a war record (object)
// The uniform ack carries whatever the handler returned through `result`; the
// ID-returning writes surface it as a number via decodeCorpRegistryIdWriteAck.
//
// ⚠ ROLE-GATED: corpRegistry writes are CEO/director-role-gated server-side; a
// session lacking the role gets a role refusal / error return (a non-applied ack
// or a thrown gateway error), which is CORRECT behavior, not a decode bug.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R98 corpRegistry share/war write returns. */
export interface CorpRegistryShareWarWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return (null for the share-move / kick / resign / alliance-
   * delete writes; a rowset / record for the offer / war writes). */
  readonly result: JsonValue | null;
}

/**
 * Decode a corpRegistry batch-C write ack whose handler answers null or an opaque
 * value (share moves, dividend, single kick, CEO resign, application-offer update,
 * alliance apply/delete, declare-war). `applied` is the confirm-gate's did-not-throw
 * signal and the panel re-reads to confirm; `result` carries any raw value through.
 */
export function decodeCorpRegistryShareWarWriteAck(
  response: JsonValue,
): CorpRegistryShareWarWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}

/** The ack for the ID-returning writes (InsertApplication → applicationID,
 * InsertInvitation → invitationID, AddCorporation → corporationID,
 * CreateAlliance → allianceID). */
export interface CorpRegistryIdWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The server's numeric return (the new application/invitation/corp/alliance id);
   * null when the handler answered nothing (e.g. a role refusal). */
  readonly id: number | null;
}

/**
 * Decode an ID-returning corpRegistry batch-C write ack. Reads the raw `result`
 * and coerces a finite number; anything else (null / a payload / absent) reads as
 * a null id — the confirm-gated route never fired live, so this is educated-guess.
 */
export function decodeCorpRegistryIdWriteAck(response: JsonValue): CorpRegistryIdWriteAck {
  const raw = readPlainJsonField(response, "result");
  const id = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    id,
  };
}

/** The ack for KickOutMembers, whose handler returns { kicked, notKicked }. */
export interface CorpRegistryKickManyWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** Character ids removed from the corp. */
  readonly kicked: readonly number[];
  /** Character ids that could NOT be removed (CEO / not a member / missed). */
  readonly notKicked: readonly number[];
}

function readIdList(container: JsonValue | undefined, key: string): number[] {
  const raw = container === undefined ? undefined : readPlainJsonField(container, key);
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: number[] = [];
  for (const entry of raw) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Decode KickOutMembers' ack — its handler answers a { kicked, notKicked } split.
 * FAST-MODE: read both id lists off the raw `result` (never fired live, so shape
 * is educated-guess from the handler).
 */
export function decodeCorpRegistryKickManyWriteAck(
  response: JsonValue,
): CorpRegistryKickManyWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    kicked: readIdList(result, "kicked"),
    notKicked: readIdList(result, "notKicked"),
  };
}
