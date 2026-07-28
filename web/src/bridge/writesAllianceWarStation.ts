// R99 Phase-4 top-level WRITE acks — allianceRegistry + warRegistry + corpStationMgr
// (WB-ALLYREG 10 + WB-WARREG 9 + WB-CORPSTN 1 = 20 writes). PLUMBING ONLY — no UI.
//
// Each write dispatches on the ordinary top-level /call seam against the SAME
// "allianceRegistry" / "warRegistry" / "corpStationMgr" service the R83/R84 (alliance)
// and R79 (war / corp-station) READS opened — the acting ALLIANCE / WAR ENTITY / CORP
// is derived from the SESSION server-side (resolveAllianceIDFromSession /
// resolveWarEntityID / resolveCorporationID), never a bound context, so there is no
// MachoBindObject two-step. Every BFF route is confirm-gated and the BFF folds each
// server return into the uniform ack `{ok, applied, result, notifications}`
// (dispatchBridgeWrite in server.js).
//
// ⚠⚠ FINANCIAL / DESTRUCTIVE / CONSEQUENTIAL — these decoders were written from the
// server handler code (FAST-MODE educated guess), NOT from captured real bytes,
// because NONE of these writes was ever fired live (no bill paid, no relationship
// deleted, no ally negotiation accepted, no surrender accepted/declined, no war
// retracted, no corp HQ moved). Real decode / QA comes later.
//
// EVERY one of the 20 handlers returns null on success:
//   allianceRegistry: SetRelationship / DeleteRelationship / AddAllianceContact /
//     AddBulletin / UpdateApplication / PayBill / SetPrimeHour / SetCapitalSystem /
//     DeclareExecutorSupport / UpdateAlliance  → null
//   warRegistry: CreateWarAllyOffer / RetractWarAllyOffer / CreateSurrenderNegotiation /
//     AcceptAllyNegotiation / DeclineAllyOffer / AcceptSurrender / DeclineSurrender /
//     RetractMutualWar / SetOpenForAllies  → null
//   corpStationMgr: MoveCorpHQHere  → null
// So `applied` is the confirm-gate's did-not-throw signal and a panel re-reads
// (GetRelationships / GetBulletins / GetWars / GetNegotiations / GetCorporation) to
// confirm the mutation; `result` carries whatever the handler returned through
// (null here) for forward-compat.
//
// ⚠ EXEC-ROLE-GATED: allianceRegistry / warRegistry writes are exec-role-gated
// server-side; a session lacking the role gets a role refusal / error return (a
// non-applied ack or a thrown gateway error), which is CORRECT behavior, not a bug.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R99 alliance/war/corp-station write returns. */
export interface AllianceWarStationWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return — null for all 20 of these handlers; kept for forward-
   * compat in case a handler later answers a record. */
  readonly result: JsonValue | null;
}

/**
 * Decode an R99 allianceRegistry / warRegistry / corpStationMgr write ack. All 20
 * handlers answer null on success, so `applied` is the confirm-gate's did-not-throw
 * signal and the panel re-reads to prove the mutation; `result` carries any raw value
 * through (null here). FAST-MODE: never fired live, so this is educated-guess.
 */
export function decodeAllianceWarStationWriteAck(
  response: JsonValue,
): AllianceWarStationWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}
