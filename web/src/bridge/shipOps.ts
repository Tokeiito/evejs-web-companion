// Ship in-space op WRITE acks (goal R90, Phase-3 WRITES — PLUMBING ONLY).
//
// FAST-MODE educated-guess decoders for the 14 confirm-gated ship WRITES
// (Eject / LeaveShip / BoardStoredShip / StoreVessel / AssembleShip / FitShips /
// ConfigureShip / Scoop / ScoopToMobileDepotHold / Jettison / LaunchFromShip /
// LaunchFromContainer / Drop / SafeLogoff). Each BFF route answers the uniform
// dispatchBridgeWrite envelope `{ ok, applied, result, notifications }`; these
// decoders read that ack. Most ship handlers return null (ConfigureShip /
// LaunchFromContainer) — `applied` alone carries the outcome. A few return
// structured data: Jettison → `[jettisonedToCanIDs, []]`, StoreVessel → the new
// capsule itemID, SafeLogoff → a list of failed-condition labels ([] = all
// passed). ⚠ Farmer is DOCKED and the extra-care writes (Eject / Jettison /
// Drop / SafeLogoff) are NEVER fired live — these acks are EDUCATED GUESSES
// from the client + server code, not captured bytes (QA later).
//
// LOCAL coercions only — this module deliberately does NOT import from market*.ts
// (a separate session owns those files).

import { isListValue, readPlainJsonField, type JsonValue } from "./wire.ts";

/** The uniform ack every confirm-gated ship write returns. */
export interface ShipWriteAck {
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

/** Decode a plain ship write ack (applied-only writes: ConfigureShip / LaunchFromContainer / …). */
export function decodeShipWriteAck(response: JsonValue): ShipWriteAck {
  return {
    ok: ackTruthy(readPlainJsonField(response, "ok")),
    applied: ackTruthy(readPlainJsonField(response, "applied")),
  };
}

/**
 * Jettison ack: the handler returns `[jettisonedToCanIDs, []]`. Surface the
 * jettisoned-to-can id list (empty when the jettison failed / was a no-op). ⚠
 * NEVER fired live — this shape is an educated guess.
 */
export interface JettisonAck extends ShipWriteAck {
  readonly jettisonedToCanIDs: number[];
}

export function decodeJettisonAck(response: JsonValue): JettisonAck {
  const result = ackResult(response);
  const first = isListValue(result)
    ? result.items[0]
    : Array.isArray(result)
      ? result[0]
      : null;
  const rawList = isListValue(first)
    ? first.items
    : Array.isArray(first)
      ? first
      : [];
  const jettisonedToCanIDs = rawList
    .map((v) => Number(v) || 0)
    .filter((v) => v > 0);
  return { ...decodeShipWriteAck(response), jettisonedToCanIDs };
}

/**
 * StoreVessel ack: the handler returns the new capsule's itemID (or null when
 * docked / on failure). Surfaced as a number or null.
 */
export interface StoreVesselAck extends ShipWriteAck {
  readonly capsuleID: number | null;
}

export function decodeStoreVesselAck(response: JsonValue): StoreVesselAck {
  const result = ackResult(response);
  const n = Number(result);
  return {
    ...decodeShipWriteAck(response),
    capsuleID: Number.isFinite(n) && n > 0 ? n : null,
  };
}
