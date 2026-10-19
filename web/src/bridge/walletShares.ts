// The wallet's Shares tab, as the client has it (panels/sharesPanel.py; personalSharesPanel.py; bco_shares.py).
//
// THE READ (sharesPanel.GetScrollList, 51 to 57; bco_shares.GetSharesByShareholder, 29 to 38): the corporation
// registry's GetSharesByShareholder(corpShares) on its moniker, IsCorpWallet() for corpShares (False for the pilot's
// own), asked each time the tab is chosen and again at the server's word that shares changed (OnShareChange, where the
// pilot is the shareholder or the corporation). A rowset of the shares held, a row a corporation, which the client
// indexes by corporationID.
//
// EACH ROW (GetEntry, 59 to 72): the owner (the pilot), the corporation, the shares (FmtAmt). None: "HintNoShares".

import type { Ask } from "./ask.ts";
import { readRowField, readRowsetRows, unwrapLong, type JsonValue } from "./wire.ts";

/** A holding: the corporation's shares the shareholder holds. */
export interface ShareHolding {
  readonly corporationID: number;
  readonly shares: number;
}

function numberOf(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const long = unwrapLong(value);
  return long === null ? 0 : Number(long);
}

/** A CRowset's rows (DBRows under its `list`), or a Rowset's records. */
function rowsOf(result: JsonValue | null | undefined): readonly unknown[] {
  if (result === null || result === undefined || typeof result !== "object" || Array.isArray(result)) return [];
  const list = (result as { list?: unknown }).list;
  if (Array.isArray(list)) return list;
  return readRowsetRows(result);
}

/** GetSharesByShareholder's rows, by corporation as the client indexes them (Index('corporationID')): one each. */
export function decodeShareHoldings(result: JsonValue | null | undefined): readonly ShareHolding[] {
  const byCorporation = new Map<number, ShareHolding>();
  for (const row of rowsOf(result)) {
    const corporationID = numberOf(readRowField(row, "corporationID"));
    if (corporationID <= 0) continue;
    byCorporation.set(corporationID, {
      corporationID,
      shares: numberOf(readRowField(row, "shares")),
    });
  }
  return [...byCorporation.values()];
}

/** The Shares tab's read: GetSharesByShareholder(False), the pilot's own. Fails as the call fails. */
export async function readMyShares(ask: Ask): Promise<readonly ShareHolding[]> {
  return decodeShareHoldings(await ask("corpRegistry", "GetSharesByShareholder", [false]));
}

/** CorpISKPanel.GetMainTabs / walletUtil.AmAccountantOrJuniorAccountant. */
export function canViewCorporateShares(corpRole: string | null | undefined): boolean {
  try { return (BigInt(corpRole ?? "0") & (256n | 4503599627370496n)) !== 0n; }
  catch { return false; }
}

/** CorpSharesPanel.IsCorpWallet: same current-corporation moniker, corporate holder. */
export async function readCorpShares(ask: Ask): Promise<readonly ShareHolding[]> {
  return decodeShareHoldings(await ask("corpRegistry", "GetSharesByShareholder", [true]));
}
