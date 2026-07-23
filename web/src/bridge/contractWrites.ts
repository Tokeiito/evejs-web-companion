// Contract WRITE acks (goal R91, Phase-3 WRITES — PLUMBING ONLY).
//
// FAST-MODE educated-guess decoders for the 11 confirm-gated contractProxy
// WRITES (CreateContract / AcceptContract / CompleteContract / DeleteContract /
// DeleteMultipleContracts / PlaceBid / FinishAuction / SplitStack /
// DeleteNotification / DeleteContractNotification / GM_ExpireContract). Each BFF
// route answers the uniform dispatchBridgeWrite envelope
// `{ ok, applied, result, notifications }`; these decoders read that ack.
//
// Server return shapes (contractProxyService.js), the educated guesses here:
//   • CreateContract          → buildList(contractIDs) (the new contract ids)
//   • AcceptContract          → buildContractRow(accepted) (a row, or null)
//   • DeleteMultipleContracts → [buildList(deleted), buildList(failed)]
//   • CompleteContract / DeleteContract → boolean
//   • PlaceBid / SplitStack / DeleteNotification / DeleteContractNotification → null (stubs)
//   • FinishAuction / GM_ExpireContract → false (stub / GM-only)
// ⚠ The financial (AcceptContract / PlaceBid), destructive (Delete*) and admin
// (GM_ExpireContract) writes are confirm-gated + reachability-only — NEVER fired
// live in the plumbing pass — so these shapes are EDUCATED GUESSES, not captured
// bytes (QA later).
//
// LOCAL coercions only — this module deliberately does NOT import from market*.ts
// (a separate session owns those files).

import { isListValue, readKeyVal, readRowField, type JsonValue } from "./wire.ts";

/** The uniform ack every confirm-gated contract write returns. */
export interface ContractWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function ackTruthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Read the `result` field off a BFF write-ack envelope (null when absent). */
function ackResult(response: JsonValue): JsonValue | null {
  const result = readKeyVal(response, "result");
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

/** Decode a plain contract write ack (applied-only: PlaceBid / SplitStack / Delete*Notification / …). */
export function decodeContractWriteAck(response: JsonValue): ContractWriteAck {
  return {
    ok: ackTruthy(readKeyVal(response, "ok")),
    applied: ackTruthy(readKeyVal(response, "applied")),
  };
}

/** CreateContract ack: the handler returns a list of the new contract ids. */
export interface CreateContractAck extends ContractWriteAck {
  readonly contractIDs: number[];
}

export function decodeCreateContractAck(response: JsonValue): CreateContractAck {
  return { ...decodeContractWriteAck(response), contractIDs: idList(ackResult(response)) };
}

/**
 * AcceptContract ack: the handler returns the accepted contract row (or null).
 * Surface the contract id off the row (0 when absent / declined).
 */
export interface AcceptContractAck extends ContractWriteAck {
  readonly contractID: number;
}

export function decodeAcceptContractAck(response: JsonValue): AcceptContractAck {
  const row = ackResult(response);
  const raw = readRowField(row, "contractID");
  const contractID = Number(raw) || 0;
  return { ...decodeContractWriteAck(response), contractID: contractID > 0 ? contractID : 0 };
}

/**
 * DeleteMultipleContracts ack: the handler returns [deleted, failed] id lists.
 * ⚠ NEVER fired live — this shape is an educated guess.
 */
export interface DeleteMultipleContractsAck extends ContractWriteAck {
  readonly deleted: number[];
  readonly failed: number[];
}

export function decodeDeleteMultipleContractsAck(response: JsonValue): DeleteMultipleContractsAck {
  const result = ackResult(response);
  const first = isListValue(result) ? result.items[0] : Array.isArray(result) ? result[0] : null;
  const second = isListValue(result) ? result.items[1] : Array.isArray(result) ? result[1] : null;
  return {
    ...decodeContractWriteAck(response),
    deleted: idList((first ?? null) as JsonValue | null),
    failed: idList((second ?? null) as JsonValue | null),
  };
}
