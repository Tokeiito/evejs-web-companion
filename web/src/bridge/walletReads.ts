// The wallet's reads, made by whoever shows the wallet (the plan's Phase 6b).
//
// Until 2026-10-10 the page asked one route of the BFF (GET /api/bridge/wallet)
// and the route made five calls of the server. A retail client has no such
// route. Its wallet and account services make the calls, each when it is
// wanted, and keep what they are told
// (eve/client/script/ui/shared/neocom/wallet/walletSvc.py,
// eve/client/script/ui/services/accountsvc.py). This is those services' asking,
// written once for the page and the hosted bots. Each call is made by the
// generic `call` (bridge/callMethod.ts), and so goes on the pilot's socket like
// any other request; the BFF relays it and decides nothing.
//
// THE CALLS, as the client makes them:
//
//   account.GetCashBalance(0)                          walletSvc.py 41: the pilot's own ISK
//   account.GetTransactions(1000, None, None, False)   accountsvc.py 116: the pilot's own, this month, of
//                                                      its cash (accountingKeyCash)
//   account.GetEntryTypes()                            accountsvc.py 98: the names of an entry's kinds,
//                                                      asked once and kept (GetStaticData)
//   account.GetWalletDivisionsInfo()                   accountsvc.py 132: the corporation's divisions
//   corpRegistry.GetCorporation()                      the corporation's own row, for its wallet divisions' names
//
// On Tranquility (Archive/Open Wallet - Plex - Corp Wallet - Corp Transfers) a
// wallet opened is GetTransactions(1000, None, None, False) and GetEntryTypes()
// once, with the balance already had from the login.
//
// WHAT IS KEPT. The entry kinds, as the client keeps them: asked once, however
// many want them and however many at once, until the pilot is another one
// (`forget`). Nothing else is kept here yet: the page reads the wallet when its
// window asks, as it did of the route.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { JsonValue } from "./wire.ts";

/** One call of the server's, by its service and method, answered with its result. Fails as the call fails. */
export type Ask = (service: string, method: string, args: readonly JsonValue[]) => Promise<JsonValue>;

/** The wallet's five reads as the server answered them, each with why it failed where it did (decoded in bridge/wallet.ts). */
export interface RawWalletReads {
  readonly cash: JsonValue;
  readonly divisions: JsonValue;
  /** Division ordinal (1..7) -> the corporation's own name for it, null where it has given none. */
  readonly divisionNames: JsonValue;
  readonly transactions: JsonValue;
  readonly entryTypes: JsonValue;
  readonly errors: {
    readonly cash: string | null;
    readonly divisions: string | null;
    readonly corp: string | null;
    readonly transactions: string | null;
    readonly entryTypes: string | null;
  };
}

export interface WalletReads {
  /** The whole wallet: every read asked together, each failing by itself. Fails only where the pilot's session is lost. */
  read(): Promise<RawWalletReads>;
  /** The pilot's own ISK and nothing else, as the server answers it. */
  cash(): Promise<JsonValue>;
  /** The pilot is another one: what was kept was the last one's. */
  forget(): void;
}

/** appConst.accountingKeyCash: the account a character's ISK is in. */
const ACCOUNTING_KEY_CASH = 1000;
/** A corporation has seven wallet divisions. */
const CORP_DIVISION_COUNT = 7;
const SESSION_NOT_FOUND = "SESSION_NOT_FOUND";

/** Why a read failed, in the code its failure carries. */
function codeOf(reason: unknown): string {
  const code = reason !== null && typeof reason === "object" ? (reason as { code?: unknown }).code : undefined;
  return typeof code === "string" && code !== "" ? code : "READ_FAILED";
}

/**
 * The names a corporation has given its wallet divisions, from its own row (corpRegistry.GetCorporation: a
 * util.Row, a `header` of column names beside a `line` of values). By the division's ordinal, 1 to 7; null where
 * the corporation has given none, and for anything that is no such row.
 *
 * As the client names them (bco_corporations.py GetDivisionNames, 138): the second to the seventh by the row's
 * `walletDivision2` to `walletDivision7`, and the first by no column at all, since it is the master wallet and
 * has the client's own word. The row's `division1` to `division7` are the hangar's divisions, which until
 * 2026-10-10 were read here in their place.
 */
export function divisionNamesOf(corporation: JsonValue): Record<string, string | null> {
  const row = corporation !== null && typeof corporation === "object" && !Array.isArray(corporation) ? (corporation as Record<string, JsonValue>) : {};
  const args = row.type === "object" && row.args !== null && typeof row.args === "object" && !Array.isArray(row.args) ? (row.args as Record<string, JsonValue>) : {};
  const entries = Array.isArray(args.entries) ? args.entries : [];
  const listed = (name: string): readonly JsonValue[] => {
    const entry = entries.find((each) => Array.isArray(each) && each[0] === name);
    const list = Array.isArray(entry) ? entry[1] : null;
    const items = list !== null && typeof list === "object" && !Array.isArray(list) ? (list as Record<string, JsonValue>).items : null;
    return Array.isArray(items) ? items : [];
  };
  const header = listed("header");
  const line = listed("line");
  const names: Record<string, string | null> = {};
  for (let division = 1; division <= CORP_DIVISION_COUNT; division += 1) {
    const at = division === 1 ? -1 : header.indexOf(`walletDivision${division}`);
    const value = at >= 0 ? line[at] : null;
    names[String(division)] = typeof value === "string" && value.trim() !== "" ? value : null;
  }
  return names;
}

/** The wallet's reads for one pilot's session, asked with `ask`. */
export function createWalletReads(ask: Ask): WalletReads {
  let kinds: Promise<JsonValue> | null = null;
  /** GetStaticData: asked once and kept. Those that want it together wait for the one asking; one that fails is not kept. */
  const entryKinds = (): Promise<JsonValue> => {
    if (kinds === null) {
      const asking = ask("account", "GetEntryTypes", []);
      kinds = asking;
      asking.catch(() => {
        if (kinds === asking) kinds = null;
      });
    }
    return kinds;
  };
  const cash = (): Promise<JsonValue> => ask("account", "GetCashBalance", [0]);
  return {
    cash,
    async read() {
      const [balance, divisions, corporation, transactions, entryTypes] = await Promise.allSettled([
        cash(),
        ask("account", "GetWalletDivisionsInfo", []),
        ask("corpRegistry", "GetCorporation", []),
        ask("account", "GetTransactions", [ACCOUNTING_KEY_CASH, null, null, false]),
        entryKinds(),
      ]);
      const reads = [balance, divisions, corporation, transactions, entryTypes];
      // No read can make up for a session that is lost: said, so that the page goes back to choosing a pilot.
      for (const each of reads) {
        if (each.status === "rejected" && codeOf(each.reason) === SESSION_NOT_FOUND) throw each.reason;
      }
      const value = (each: PromiseSettledResult<JsonValue>): JsonValue => (each.status === "fulfilled" ? each.value ?? null : null);
      const failure = (each: PromiseSettledResult<JsonValue>): string | null => (each.status === "rejected" ? codeOf(each.reason) : null);
      return {
        cash: value(balance),
        divisions: value(divisions),
        divisionNames: corporation.status === "fulfilled" ? divisionNamesOf(corporation.value) : {},
        transactions: value(transactions),
        entryTypes: value(entryTypes),
        errors: {
          cash: failure(balance),
          divisions: failure(divisions),
          corp: failure(corporation),
          transactions: failure(transactions),
          entryTypes: failure(entryTypes),
        },
      };
    },
    forget() {
      kinds = null;
    },
  };
}
