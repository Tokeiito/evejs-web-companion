// R106 marketProxy FINANCIAL write acks (WB-MARKET — the LAST plumbing batch,
// CLOSES the sweep). PLUMBING ONLY — no UI.
//
// FAST-MODE educated-guess decoders for the three confirm-gated marketProxy
// WRITES deferred the whole sweep because each spends or commits real value:
//   • PlacePlexSellOrder — lists PLEX for sale; the handler returns a boolean
//     (true when it sold into an existing bid OR created a resting order).
//   • ModifyPlexCharOrder — re-prices the caller's OWN PLEX order (owner-checked
//     server-side); returns null on success.
//   • BuyMultipleItems — batch instant-buy that SPENDS ISK immediately; returns
//     an (empty) list on success.
//
// ⚠ NONE is ever fired on the live world in the plumbing pass — these routes are
// verified for reachability + refuses-without-confirm only. The BFF wraps every
// write in the uniform ack `{ ok, applied, result, notifications }`
// (dispatchBridgeWrite), so the decoder reads that envelope, not the raw retail
// return. These shapes are EDUCATED GUESSES from the client + server code, never
// exercised against captured bytes.
//
// ⚠ STAY-OFF-market.ts: this is a NEW file so the sweep never edits the market
// session's web/src/bridge/market.ts. It imports only the shared wire helpers.

import { readPlainJsonField, type JsonValue } from "./wire.ts";

/** The uniform ack every confirm-gated marketProxy write returns. */
export interface MarketWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function ackTruthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/**
 * Decode a plain marketProxy write ack (plex-sell / plex-modify / buy-multiple).
 * The BFF answers `applied: true` whenever the dispatch did not throw (FAST-MODE);
 * a panel re-reads orders / wallet to prove the mutation. A declined write is read
 * as not-applied, never a throw.
 */
export function decodeMarketWriteAck(response: JsonValue): MarketWriteAck {
  return {
    ok: ackTruthy(readPlainJsonField(response, "ok")),
    applied: ackTruthy(readPlainJsonField(response, "applied")),
  };
}
