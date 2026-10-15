// The wallet's Overview tab, as the client has it (panels/personal/overviewPanel.py; transactionOverviewController.py).
//
// WHAT IT READS (TransactionOverviewController._Update, 54 to 60): the account service's journal for the last thirty
// days with the lines it derives (GetPersonalTransactions(), None and None), leaving out the market's own kinds
// (REFTYPEID_BLACKLIST: a market transaction, the market's escrow) and any line whose kind has no name; and the
// market service's trades (GetPersonalMarketTransactions), leaving out those made for the corporation, each as items
// bought or sold of its type's category.
//
// WHAT IT SHOWS (OverviewPanel): income or expenses, as the radio buttons choose (each with its total, FmtISK, a "+"
// before one not less than nought); a donut of their groups (refGroupByRefType: Corp and Alliance, Agents and
// Missions, Trade, Bounty, Industry, Transfers, Miscellaneous, HyperNet Relay), each in its group's colour, income
// largest first and expenses most first; in its middle the total the short way (FmtAmt 'sn'), "30 Days Income" or
// "30 Days Expenses", and the group's name once one is chosen; beside it each group as "12.3% Name" by its colour, its
// ISK its hint. A group chosen (its segment or its entry) shows its kinds instead (by kind and category), each a shade
// of the group's colour; Back returns to the groups.

import type { EntryKind, JournalLine } from "./walletJournal.ts";
import type { MarketTransaction } from "./marketTransactions.ts";

/** The last thirty days' journal, with the lines derived from it, as the flow keeps it for the tab. */
export interface WalletOverviewRead {
  readonly loaded: boolean;
  readonly lines: readonly JournalLine[];
  readonly kinds: ReadonlyMap<number, EntryKind>;
  readonly error: string | null;
}

/** appConst.refGroups, by kind (refGroupByRefType); a kind in none is Miscellaneous (7). */
const GROUP_KINDS: Readonly<Record<number, readonly number[]>> = {
  1: [11, 113, 114, 13, 22, 38, 39, 40, 48, 49, 50, 86, 87, 88],
  2: [103, 129, 25, 27, 30, 31, 33, 34, 7, 93, 94],
  3: [1, 102, 106, 107, 136, 137, 138, 141, 142, 149, 194, 2, 26, 42, 46, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 77, 79, 80, 81, 82,
    // COSMETIC_MARKET_TRANSACTION_REFS, put among the trade's after the groups are made.
    178, 179, 180, 181, 182, 183],
  4: [101, 115, 16, 17, 85, 92],
  5: [112, 120, 127, 135, 196, 56, 57, 58, 59, 60, 96, 97, 98],
  6: [10, 3, 37],
  8: [143, 144, 145, 146],
};
const MISC_GROUP = 7;
const GROUP_BY_KIND: ReadonlyMap<number, number> = new Map(
  Object.entries(GROUP_KINDS).flatMap(([group, kinds]) => kinds.map((kind) => [kind, Number(group)] as const)),
);

/** GetGroupID: a kind's group. */
export function kindGroup(entryTypeID: number): number {
  return GROUP_BY_KIND.get(entryTypeID) ?? MISC_GROUP;
}

/** NAME_BY_REFGROUPID: each group's name's label. */
export const GROUP_LABELS: Readonly<Record<number, string>> = {
  1: "UI/Wallet/WalletWindow/TransactionGroups/CorpAlliance",
  2: "UI/Wallet/WalletWindow/TransactionGroups/AgentsAndMissions",
  3: "UI/Wallet/WalletWindow/TransactionGroups/Trade",
  4: "UI/Wallet/WalletWindow/TransactionGroups/Bounty",
  5: "UI/Wallet/WalletWindow/TransactionGroups/Industry",
  6: "UI/Wallet/WalletWindow/TransactionGroups/Transfers",
  7: "UI/Wallet/WalletWindow/TransactionGroups/Miscellaneous",
  8: "UI/HyperNet/WindowTitle",
};

/** COLOR_BY_REFGROUPID. */
export const GROUP_COLORS: Readonly<Record<number, string>> = {
  1: "#5c59d8", 2: "#e68348", 3: "#31c4a1", 4: "#e53a3a", 5: "#3de53a", 6: "#e6e048", 7: "#808080", 8: "#3aa8e5",
};

/** REFTYPEID_BLACKLIST: the market's own kinds, which its trades stand for. */
const LEFT_OUT_KINDS: ReadonlySet<number> = new Set([2, 42]);
/** appConst.refMarketTransaction, the kind a trade is counted as. */
const MARKET_TRANSACTION = 2;

/** A group of the overview: the groups' or, once one is chosen, its kinds' (TransactionGroup). */
export interface OverviewGroup {
  readonly key: string;
  readonly name: string;
  /** Null for a group of groups; the kind for a group of one kind. */
  readonly refTypeID: number | null;
  readonly refGroupID: number;
  readonly amount: number;
  /** Its amount over the total of its side. */
  readonly ratio: number;
}

export interface OverviewSides {
  readonly income: readonly OverviewGroup[];
  readonly expenses: readonly OverviewGroup[];
  readonly totalIncome: number;
  readonly totalExpenses: number;
}

/** What the overview names things by. */
export interface OverviewNames {
  /** GetRefTypeKeyByID(...).entryTypeName; null where the kind has none. */
  readonly kindName: (entryTypeID: number) => string | null;
  readonly groupName: (refGroupID: number) => string;
  /** evetypes.GetCategoryName(typeID). */
  readonly categoryName: (typeID: number) => string;
  /** ItemsBought or ItemsSold with the category's name. */
  readonly itemsWords: (bought: boolean, categoryName: string) => string;
}

interface Entry {
  readonly amount: number;
  readonly refTypeID: number;
  readonly name: string;
  /** The category's name, for a trade: what its kind's group is told apart by. */
  readonly category: string | null;
}

/** TransactionOverviewController(refGroupID): each side's groups, sorted, with their ratios and totals. */
export function overviewSides(
  lines: readonly JournalLine[],
  trades: readonly MarketTransaction[],
  refGroupID: number | null,
  names: OverviewNames,
): OverviewSides {
  const income: Entry[] = [];
  const expenses: Entry[] = [];
  const filteredOut = (kind: number): boolean => refGroupID !== null && kindGroup(kind) !== refGroupID;
  // _UpdateWalletTransactions.
  for (const line of lines) {
    if (filteredOut(line.entryTypeID) || LEFT_OUT_KINDS.has(line.entryTypeID)) continue;
    const name = names.kindName(line.entryTypeID);
    if (name === null) continue;
    (line.amount < 0 ? expenses : income).push({ amount: line.amount, refTypeID: line.entryTypeID, name, category: null });
  }
  // _UpdateMarketTransactions.
  for (const trade of trades) {
    if (filteredOut(MARKET_TRANSACTION) || trade.isForCorp) continue;
    const category = names.categoryName(trade.typeID);
    const entry = { amount: trade.totalPrice, refTypeID: MARKET_TRANSACTION, name: names.itemsWords(trade.isBuyTransaction, category), category };
    (trade.isBuyTransaction ? expenses : income).push(entry);
  }
  const grouped = (entries: readonly Entry[], largestFirst: boolean): OverviewGroup[] => {
    const groups = new Map<string, { name: string; refTypeID: number | null; refGroupID: number; amount: number }>();
    for (const entry of entries) {
      const key = refGroupID !== null ? `${entry.refTypeID}:${entry.category ?? ""}` : String(kindGroup(entry.refTypeID));
      const held = groups.get(key) ?? (refGroupID !== null
        ? { name: entry.name, refTypeID: entry.refTypeID, refGroupID, amount: 0 }
        : { name: names.groupName(kindGroup(entry.refTypeID)), refTypeID: null, refGroupID: kindGroup(entry.refTypeID), amount: 0 });
      held.amount += entry.amount;
      groups.set(key, held);
    }
    const total = [...groups.values()].reduce((sum, group) => sum + group.amount, 0);
    return [...groups.entries()]
      .map(([key, group]) => ({ key, ...group, ratio: total ? group.amount / total : 0 }))
      .sort((a, b) => (largestFirst ? b.amount - a.amount : a.amount - b.amount));
  };
  const incomeGroups = grouped(income, true);
  const expenseGroups = grouped(expenses, false);
  return {
    income: incomeGroups,
    expenses: expenseGroups,
    totalIncome: incomeGroups.reduce((sum, group) => sum + group.amount, 0),
    totalExpenses: expenseGroups.reduce((sum, group) => sum + group.amount, 0),
  };
}

/**
 * GetDonutChartSegmentColor: a group's colour; a kind's, once a group is chosen, its group's colour at a brightness
 * from 0.3 to 1 of it by its place among the segments.
 */
export function segmentColor(group: OverviewGroup, index: number, count: number): string {
  const base = GROUP_COLORS[group.refGroupID] ?? GROUP_COLORS[MISC_GROUP]!;
  if (group.refTypeID === null) return base;
  const x = count <= 1 ? 1 : 0.3 + (0.7 * index) / (count - 1);
  const r = parseInt(base.slice(1, 3), 16) / 255;
  const g = parseInt(base.slice(3, 5), 16) / 255;
  const b = parseInt(base.slice(5, 7), 16) / 255;
  // Color.SetBrightness: the value of its HSV scaled, the hue and saturation kept.
  const value = Math.max(r, g, b);
  const scale = value === 0 ? 0 : (x * value) / value;
  const hex = (c: number): string => Math.round(Math.min(1, c * scale) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** FmtAmt(amount, 'sn'): grouped under ten thousand, else by the short label of its thousands, millions, billions or trillions. */
export function shortAmount(amount: number, said: (label: string, args: Readonly<Record<string, number>>) => string | null): string | null {
  const whole = Math.trunc(amount);
  const value = Math.abs(whole);
  const F = "/Carbon/UI/Common/Formatting";
  if (value < 10_000) return whole.toLocaleString("en-US");
  if (value < 100_000) return said(`${F}/FmtThousandShort`, { amount: whole / 1_000 });
  if (value < 100_000_000) return said(`${F}/FmtMillionShort`, { amount: whole / 1_000_000 });
  if (value < 100_000_000_000) return said(`${F}/FmtBillionShort`, { amount: whole / 1_000_000_000 });
  return said(`${F}/FmtTrillionShort`, { amount: whole / 1_000_000_000_000 });
}

/** The labels FmtAmt's short form may need. */
export const SHORT_AMOUNT_LABELS: readonly string[] = ["Thousand", "Million", "Billion", "Trillion"].map((size) => `/Carbon/UI/Common/Formatting/Fmt${size}Short`);
