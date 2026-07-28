// Fighter-manager op WRITE acks (goal R90, Phase-3 WRITES — PLUMBING ONLY).
//
// FAST-MODE educated-guess decoders for the 9 confirm-gated fighterMgr WRITES
// (LoadFightersToTube / UnloadTubeToFighterBay / LaunchFightersFromTubes /
// RecallFightersToTubes / ExecuteMovementCommandOnFighters /
// CmdActivateAbilitySlots / CmdDeactivateAbilitySlots / CmdAbandonFighter /
// CmdScoopAbandonedFighterFromSpace). Each BFF route answers the uniform
// dispatchBridgeWrite envelope `{ ok, applied, result, notifications }`; these
// decoders read that ack. Load/Unload return a plain bool (`result`); the
// Launch/Recall/Activate/Deactivate handlers return a dict of per-tube/fighter
// error entries ([] = every command accepted); ExecuteMovementCommand returns
// null. ⚠ Farmer is DOCKED with no carrier in space, so NONE of these is live-
// exercisable and CmdAbandonFighter is extra-care (never fired live) — the acks
// are EDUCATED GUESSES from the client + server code, not captured bytes.
//
// LOCAL coercions only — this module deliberately does NOT import from market*.ts
// (a separate session owns those files).

import { readDictPairs, readPlainJsonField, type JsonValue } from "./wire.ts";

/** The uniform ack every confirm-gated fighter write returns. */
export interface FighterWriteAck {
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

/** Decode a plain fighter write ack (ExecuteMovementCommand / …). */
export function decodeFighterWriteAck(response: JsonValue): FighterWriteAck {
  return {
    ok: ackTruthy(readPlainJsonField(response, "ok")),
    applied: ackTruthy(readPlainJsonField(response, "applied")),
  };
}

/**
 * Boolean-result ack (LoadFightersToTube / UnloadTubeToFighterBay): the handler
 * returns true on success, false when the load/unload was refused. `accepted`
 * is false unless the server explicitly answered true.
 */
export interface FighterBoolAck extends FighterWriteAck {
  readonly accepted: boolean;
}

export function decodeFighterBoolAck(response: JsonValue): FighterBoolAck {
  return {
    ...decodeFighterWriteAck(response),
    accepted: ackResult(response) === true,
  };
}

/**
 * Command-dict ack (Launch/Recall/Activate/Deactivate ability slots): the
 * handler returns a dict whose entries are per-tube/fighter error rows. An
 * empty dict means every command was accepted; a non-empty one carries the
 * refusals. `errorCount` is the number of error entries (0 = all accepted).
 */
export interface FighterCommandAck extends FighterWriteAck {
  readonly errorCount: number;
}

export function decodeFighterCommandAck(response: JsonValue): FighterCommandAck {
  const result = ackResult(response);
  const errorCount = readDictPairs(result).length;
  return { ...decodeFighterWriteAck(response), errorCount };
}
