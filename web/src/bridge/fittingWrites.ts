// Fitting-library WRITE acks (goal R91, Phase-3 WRITES — PLUMBING ONLY).
//
// FAST-MODE educated-guess decoders for the 5 confirm-gated fitting WRITES:
// charFittingMgr.SaveManyFittings / DeleteFitting / DeleteManyFittings /
// UpdateNameAndDescription and corpFittingMgr.SaveManyFittings. Each BFF route
// answers the uniform dispatchBridgeWrite envelope
// `{ ok, applied, result, notifications }`; these decoders read that ack.
//
// Server return shapes (fittingMgrServiceHelpers.js), the educated guesses here:
//   • SaveManyFittings         → buildList(KeyVal{tempFittingID, realFittingID})
//   • DeleteManyFittings       → buildList(int) (the deleted fitting ids)
//   • DeleteFitting            → null
//   • UpdateNameAndDescription → null
// Every write is guarded server-side by assertSessionCanMutateOwner (a foreign
// ownerID is a permission throw, never a foreign mutation). ⚠ The two destructive
// deletes are confirm-gated + reachability-only — NEVER fired live in the
// plumbing pass — so these shapes are EDUCATED GUESSES, not captured bytes.
//
// LOCAL coercions only — this module deliberately does NOT import from market*.ts
// (a separate session owns those files).

import { isListValue, readPlainJsonField, readRowField, type JsonValue } from "./wire.ts";

/** The uniform ack every confirm-gated fitting write returns. */
export interface FittingWriteAck {
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

/** Decode a plain fitting write ack (applied-only: DeleteFitting / UpdateNameAndDescription). */
export function decodeFittingWriteAck(response: JsonValue): FittingWriteAck {
  return {
    ok: ackTruthy(readPlainJsonField(response, "ok")),
    applied: ackTruthy(readPlainJsonField(response, "applied")),
  };
}

/**
 * SaveManyFittings ack: the handler returns a list of {tempFittingID,
 * realFittingID} mappings (the client-assigned temp id paired with the server
 * id it was saved as). Surface the newly-saved real fitting ids.
 */
export interface SaveManyFittingsAck extends FittingWriteAck {
  readonly savedFittingIDs: number[];
}

export function decodeSaveManyFittingsAck(response: JsonValue): SaveManyFittingsAck {
  const result = ackResult(response);
  const items = isListValue(result) ? result.items : Array.isArray(result) ? result : [];
  const savedFittingIDs = (items as JsonValue[])
    .map((row) => Number(readRowField(row, "realFittingID")) || 0)
    .filter((v) => v > 0);
  return { ...decodeFittingWriteAck(response), savedFittingIDs };
}

/**
 * DeleteManyFittings ack: the handler returns a list of the deleted fitting ids.
 * ⚠ NEVER fired live — this shape is an educated guess.
 */
export interface DeleteManyFittingsAck extends FittingWriteAck {
  readonly deletedFittingIDs: number[];
}

export function decodeDeleteManyFittingsAck(response: JsonValue): DeleteManyFittingsAck {
  const result = ackResult(response);
  const items = isListValue(result) ? result.items : Array.isArray(result) ? result : [];
  const deletedFittingIDs = (items as JsonValue[])
    .map((v) => Number(v) || 0)
    .filter((v) => v > 0);
  return { ...decodeFittingWriteAck(response), deletedFittingIDs };
}
