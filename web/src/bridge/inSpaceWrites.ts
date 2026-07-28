// In-space service WRITE acks (goal R92, Phase-3 WRITES — PLUMBING ONLY).
//
// FAST-MODE educated-guess decoders for the 16 confirm-gated in-space service
// WRITES across four services:
//   • sovMgr    — SetSovHubFuelAccessGroup / DestroySkyhooks / AcquireSkyhooks
//   • essMgr    — AttemptLinkToMainBank / AttemptLinkToReserveBank /
//                 RequestMainBankUnlink / RequestReserveBankUnlink /
//                 RequestUnlockReserveBank
//   • abyssalMgr — AbyssalEntranceDeployment / AbyssalEntranceGateActivation /
//                 AbyssalGateActivation / AbyssalEndGateActivation / ClientIsReady
//   • pvpFilamentMgr — JoinPVPQueue / LeavePVPQueue / AbyssalPVPEndGateActivation
//
// Each BFF route answers the uniform dispatchBridgeWrite envelope
// `{ ok, applied, result, notifications }`; these decoders read that ack.
//
// Server return shapes (educated guesses — Farmer is DOCKED, none fired live):
//   • SetSovHubFuelAccessGroup  → the new fuelAccessGroupID (int) | null
//   • DestroySkyhooks / AcquireSkyhooks → buildList(processed skyhookID list)
//   • all essMgr writes         → null (a panel re-reads GetDataForClientSolarSystem)
//   • abyssalMgr / pvpFilamentMgr actions → THROW an abyss/UserError (no runtime
//     abyssal content in this world) except ClientIsReady / LeavePVPQueue → null
//
// LOCAL coercions only — this module deliberately does NOT import from market*.ts
// (a separate session owns those files).

import { isListValue, readPlainJsonField, type JsonValue } from "./wire.ts";

/** The uniform ack every confirm-gated in-space write returns. */
export interface InSpaceWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function ackTruthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Read the `result` field off a BFF write-ack envelope (null when absent). */
function ackResult(response: JsonValue): JsonValue | null {
  const result = readPlainJsonField(response, "result");
  return result === undefined ? null : result;
}

/** Coerce a wire list (or plain array) of ids to a clean positive-int number[]. */
function idList(value: JsonValue | null): number[] {
  const items = isListValue(value)
    ? value.items
    : Array.isArray(value)
      ? value
      : [];
  return (items as JsonValue[])
    .map((v) => Number(v) || 0)
    .filter((v) => v > 0);
}

/**
 * Decode a plain in-space write ack (applied-only: the ESS bank link/unlink/unlock
 * writes, ClientIsReady, LeavePVPQueue, and the reachability path of the rejecting
 * abyssal / pvp actions — all null-returning or thrown-then-surfaced).
 */
export function decodeInSpaceWriteAck(response: JsonValue): InSpaceWriteAck {
  return {
    ok: ackTruthy(readPlainJsonField(response, "ok")),
    applied: ackTruthy(readPlainJsonField(response, "applied")),
  };
}

/**
 * Skyhook write ack (DestroySkyhooks / AcquireSkyhooks): the handler returns a
 * list of the processed skyhookIDs. ⚠ NEVER fired live — this shape is a guess.
 */
export interface SkyhookWriteAck extends InSpaceWriteAck {
  readonly skyhookIDs: number[];
}

export function decodeSkyhookWriteAck(response: JsonValue): SkyhookWriteAck {
  return { ...decodeInSpaceWriteAck(response), skyhookIDs: idList(ackResult(response)) };
}

/**
 * SetSovHubFuelAccessGroup ack: the handler returns the new fuelAccessGroupID
 * (or null when the write was a no-op). Surface it as a positive int (0 = none).
 * ⚠ ARG-INJECTION on the write side (caller-supplied solarSystemID, no scope) —
 * flagged in docs/arg-injection-leak-handoff.md; the decoder only reads the ack.
 */
export interface FuelAccessGroupWriteAck extends InSpaceWriteAck {
  readonly fuelAccessGroupID: number;
}

export function decodeFuelAccessGroupWriteAck(response: JsonValue): FuelAccessGroupWriteAck {
  const raw = Number(ackResult(response)) || 0;
  return { ...decodeInSpaceWriteAck(response), fuelAccessGroupID: raw > 0 ? raw : 0 };
}
