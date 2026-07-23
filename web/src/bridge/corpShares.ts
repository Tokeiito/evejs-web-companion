// R81 — decoding the corpRegistry SHARE-LEDGER reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-shares returns the raw retail-shaped corpRegistry results,
// captured live from Farmer (corp 98000001) on 2026-07-22. corpRegistry is retail-
// bound per corp (eveMoniker.GetCorpRegistry(corpID)); the gateway dispatches these
// TOP-LEVEL and corpRegistry.MachoBindObject is NOT allowlisted, so no bind can
// redirect the corp.
//
// TWO reads decode here — the wire shapes verified against captured bytes:
//   • GetShareholders(corpID)      -> a util.Rowset (header/columns
//     [shareholderID, corporationID, shares], each `line` a {type:"list"} of three
//     numeric cells). ⚠ ARG-INJECTION: args[0] is a caller-chosen corpID and the
//     handler applies NO session check — a foreign corpID returns THAT corp's ledger
//     (flagged in docs/arg-injection-leak-handoff.md; kept pre-plumbed, not de-listed).
//   • GetSharesByShareholder(flag) -> a CRowset (objectex2; rows on `list` as one
//     positional packedrow [shareholderID, corporationID, shares]). ⚠ args[0] is a
//     COMPANY-vs-PERSONAL 1/0 flag (not a foreign shareholder lookup) — SESSION-SCOPED,
//     returns only the caller's own holding.
//
// ⚠ VALUE ENCODING (verified against bytes): the server builds every cell with Number()
// (shares are a plain JS number), so shareholderID / corporationID / shares cross as
// plain ints. They are kept as data (R7d) — nothing is forced into a label here.

import { readRowField, readRowsetRows, type JsonValue } from "./wire.ts";

/** One shareholder ledger row (GetShareholders / GetSharesByShareholder). */
export interface CorpShareholderRow {
  /** The holder — a characterID or a corporationID (shares can be held by a corp). */
  readonly shareholderID: number;
  /** The corp whose shares these are. */
  readonly corporationID: number;
  /** How many shares the holder owns. */
  readonly shares: number;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNum(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (isRecord(value) && value.type === "long") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number") return inner;
    if (typeof inner === "string" && /^-?\d+$/.test(inner)) return Number(inner);
  }
  return 0;
}

/** The rows of an objectex2 CRowset: they live on `list`. `[]` otherwise. */
function crowsetRows(rowset: JsonValue | null | undefined): readonly JsonValue[] {
  if (isRecord(rowset) && Array.isArray((rowset as { list?: unknown }).list)) {
    return (rowset as { list: readonly JsonValue[] }).list;
  }
  return [];
}

/**
 * Decode corpRegistry.GetShareholders -> the corp's shareholder ledger, in wire order.
 * `[]` is a real "no shareholders recorded" answer. ⚠ CROSS-CORP under arg-injection:
 * the rows belong to whatever corpID the caller supplied (flagged leak).
 */
export function decodeCorpShareholders(
  result: JsonValue | null | undefined,
): CorpShareholderRow[] {
  return readRowsetRows(result).map((row) => ({
    shareholderID: toNum(row.shareholderID),
    corporationID: toNum(row.corporationID),
    shares: toNum(row.shares),
  }));
}

/**
 * Decode corpRegistry.GetSharesByShareholder -> the caller's OWN single shareholding
 * row (the session char's, or the session corp's own shares when ?company=1). null when
 * the CRowset carries no row.
 */
export function decodeCorpSharesByShareholder(
  result: JsonValue | null | undefined,
): CorpShareholderRow | null {
  const rows = crowsetRows(result);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return {
    shareholderID: toNum(readRowField(row, "shareholderID")),
    corporationID: toNum(readRowField(row, "corporationID")),
    shares: toNum(readRowField(row, "shares")),
  };
}
