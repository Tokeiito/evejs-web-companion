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
// WHAT IS KEPT, as those services keep it, so that several windows that want the
// wallet together ask for each thing once:
//
//   the pilot's ISK      asked once (walletSvc.py 41), and from then on what the server says it is
//                        (OnAccountChange('cash', charID, balance); walletSvc.py 80, 91)
//   the transactions     until the server says any account changed (accountsvc.py 64, 108)
//   the entry kinds      for as long as the pilot is this one (accountsvc.py 86)
//   the divisions        five minutes (accountsvc.py 132). The client also works a division's new balance
//                        into what it shows; here a change to one of the corporation's accounts forgets the
//                        divisions, which asks sooner than the client and is never behind it
//   the corporation      until the server says it changed (bco_corporations.py 42, 79)
//
// An asking that fails is not kept. A read asked for afresh (the window's own
// Refresh, which the client has no need of) forgets all of it but the kinds.
// `cash()` is not kept at all: it is a guard's asking, of the server each time.
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
  /**
   * The whole wallet, from what is kept and by asking for what is not, each read failing by itself. Fails only
   * where the pilot's session is lost. `fresh`: everything but the entry kinds is asked for again.
   */
  read(how?: { readonly fresh?: boolean }): Promise<RawWalletReads>;
  /** The pilot's own ISK and nothing else, asked of the server now. */
  cash(): Promise<JsonValue>;
  /**
   * The server's word that an account changed: OnAccountChange(accountKey, ownerID, balance). `whose` is the pilot
   * and its corporation, to tell its own accounts from another's.
   */
  accountChanged(accountKey: unknown, ownerID: unknown, balance: JsonValue, whose: { readonly characterID: number | null; readonly corporationID: number | null }): void;
  /** The server's word that the corporation changed: its row is asked for again when next wanted. */
  corporationChanged(): void;
  /** The pilot is another one: what was kept was the last one's. */
  forget(): void;
}

export interface WalletDeps {
  /** A clock, for how long the corporation's divisions are kept. */
  readonly now?: () => number;
}

/** appConst.accountingKeyCash: the account a character's ISK is in. */
const ACCOUNTING_KEY_CASH = 1000;
/** A corporation has seven wallet divisions. */
const CORP_DIVISION_COUNT = 7;
const SESSION_NOT_FOUND = "SESSION_NOT_FOUND";
/** accountsvc.py 135: the corporation's divisions are good for five minutes. */
const DIVISIONS_KEPT_MS = 5 * 60_000;
/** The server's names for the accounts it says have changed (walletSvc.py 82): a character's ISK is the first; a corporation has all seven. */
const CASH = "cash";
const CORPORATION_ACCOUNTS: ReadonlySet<unknown> = new Set(["cash", "cash2", "cash3", "cash4", "cash5", "cash6", "cash7"]);

/** A thing asked once and kept. Those that want it together wait for the one asking; an asking that fails is not kept. */
interface Kept {
  read(): Promise<JsonValue>;
  forget(): void;
  /** What is kept is this from now on, with nothing asked. */
  put(value: JsonValue): void;
}

function keptOnce(askIt: () => Promise<JsonValue>): Kept {
  let held: Promise<JsonValue> | null = null;
  return {
    read() {
      if (held === null) {
        const asking = askIt();
        held = asking;
        asking.catch(() => {
          if (held === asking) held = null;
        });
      }
      return held;
    },
    forget() {
      held = null;
    },
    put(value) {
      held = Promise.resolve(value);
    },
  };
}

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
export function createWalletReads(ask: Ask, deps: WalletDeps = {}): WalletReads {
  const now = deps.now ?? (() => Date.now());
  const cash = (): Promise<JsonValue> => ask("account", "GetCashBalance", [0]);
  const kinds = keptOnce(() => ask("account", "GetEntryTypes", []));
  const wealth = keptOnce(cash);
  const ledger = keptOnce(() => ask("account", "GetTransactions", [ACCOUNTING_KEY_CASH, null, null, false]));
  const corporationRow = keptOnce(() => ask("corpRegistry", "GetCorporation", []));
  let divisionsAskedAt = Number.NEGATIVE_INFINITY;
  const divisionsKept = keptOnce(() => {
    divisionsAskedAt = now();
    return ask("account", "GetWalletDivisionsInfo", []);
  });
  const divisionsNow = (): Promise<JsonValue> => {
    if (now() - divisionsAskedAt >= DIVISIONS_KEPT_MS) divisionsKept.forget();
    return divisionsKept.read();
  };
  return {
    cash,
    async read(how = {}) {
      if (how.fresh === true) {
        for (const each of [wealth, ledger, corporationRow, divisionsKept]) each.forget();
      }
      const [balance, divisions, corporation, transactions, entryTypes] = await Promise.allSettled([
        wealth.read(),
        divisionsNow(),
        corporationRow.read(),
        ledger.read(),
        kinds.read(),
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
    accountChanged(accountKey, ownerID, balance, whose) {
      // accountsvc.OnAccountChange (64): whichever account it was, the transactions kept are out of date.
      ledger.forget();
      // walletSvc.OnAccountChange (80): `if balance is not None`.
      if (balance === null || balance === undefined) return;
      const owner = Number(ownerID);
      if (accountKey === CASH && owner === whose.characterID) {
        // _OnCharAccountChange: the pilot's ISK is what the server says, with nothing asked.
        wealth.put(balance);
      } else if (CORPORATION_ACCOUNTS.has(accountKey) && owner === whose.corporationID) {
        divisionsKept.forget();
      }
    },
    corporationChanged() {
      corporationRow.forget();
    },
    forget() {
      for (const each of [kinds, wealth, ledger, corporationRow, divisionsKept]) each.forget();
    },
  };
}
