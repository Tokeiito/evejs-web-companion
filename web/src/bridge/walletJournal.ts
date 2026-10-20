// The wallet's Transactions tab, as the client has it.
//
// THE READ (accountsvc.py GetPersonalTransactions, 108 to 122): account.GetTransactions(accountingKeyCash, year, month,
// False), None and None for the last thirty days, a year and a month (1 to 12) for one of the five before this one.
// The account service keeps each answer until any account changes (OnAccountChange, 64) or the pilot does.
//
// THE LINES IT DERIVES (transactionsUtil.py GetDerivedTransactions, 24 to 99). An entry whose description is YAML
// for a mapping can carry taxes taken from it, and the client shows each as its own line:
//   - a corporation tax (derivedTransactionParentMapping's kinds: {kind: [corporationID, amount]}), a line of its
//     own just after the entry (sortValue + 0.5), less by the tax, the corporation its second party; the entry is
//     shown as it was before the tax, its amount and its balance more by it;
//   - the security tax on a mission's reward or a bounty (securityTaxAmount, with grossRewardAmount or
//     grossBountyAmount), a line just before (a quarter less), less by it, to CONCORD; the entry shown at its gross
//     amount, its balance more by the tax.
//
// EACH LINE (transactionsPanel.py Transaction, 25 to 41): its date (FmtWalletDate), its kind's name, its amount (red
// less, green more) and balance (FmtWalletCurrency: whole ISK, truncated, unless the wallet's cents setting is on),
// and its description: FmtWalletEntry (walletEntryFormat.py 20 to 26) by the kind's journal message with the two
// parties' names and the reference, unless the kind has none or is worded by hand (_FmtWalletEntryManual); with a
// hint (GetTransactionHint, 102 to 159) the description is "[r] " before it, and the hint is the line's tooltip.
//
// Not done: the hand-worded kinds that need what the page has not (a project's or a freelance job's link, a daily
// goal, the cosmetic market, an achievement), which are worded "-" as the client words a kind it cannot; the hints of
// a bounty's reimbursement and of the virtual goods store.

import type { NameRef } from "../store/names.ts";
import { unwrapCachedResult } from "./market.ts";
import { isListValue, readRowField, unwrapLong, type JsonValue } from "./wire.ts";

/** An entry kind as account.GetEntryTypes lists it: the message its name is (entryTypeNameID), and the server's name. */
export interface EntryKind {
  readonly nameID: number | null;
  readonly name: string | null;
}

/**
 * account.GetEntryTypes (a cached result of rows): each kind's name, which the client's account service makes the
 * message by entryTypeNameID (GetStaticData, 86 to 95).
 */
export function decodeEntryKinds(result: JsonValue | null | undefined): ReadonlyMap<number, EntryKind> {
  const kinds = new Map<number, EntryKind>();
  const list = result === null || result === undefined ? null : unwrapCachedResult(result);
  if (list === null || !isListValue(list)) return kinds;
  for (const row of list.items) {
    const id = numberOf(readRowField(row, "entryTypeID"));
    if (id === null) continue;
    const nameID = numberOf(readRowField(row, "entryTypeNameID"));
    const name = readRowField(row, "entryTypeName");
    kinds.set(id, { nameID: nameID !== null && nameID > 0 ? nameID : null, name: typeof name === "string" && name !== "" ? name : null });
  }
  return kinds;
}

/** The pilot's journal for a period as the flow keeps it for the tab. */
export interface WalletJournalRead {
  /** None and None for the last thirty days; else a year and a month, 1 to 12. */
  readonly year: number | null;
  readonly month: number | null;
  readonly loaded: boolean;
  readonly lines: readonly JournalLine[];
  readonly kinds: ReadonlyMap<number, EntryKind>;
  /** Each kind's journal message, from the client's own data; null where that could not be read. */
  readonly journalMessageIDs: Readonly<Record<string, number>> | null;
  readonly error: string | null;
}

export interface CorpWalletJournalRead extends WalletJournalRead {
  readonly accountKey: number;
  readonly corporationID: number | null;
}

/** CorpISKPanel.GetMainTabs/ConstructPanels: Accountant or Junior Accountant. */
export function canViewCorporateJournal(corpRole: string | null | undefined): boolean {
  try { return (BigInt(corpRole ?? "0") & (256n | 4503599627370496n)) !== 0n; }
  catch { return false; }
}

/** Corporate GetTransactions does not run the personal derived-tax pass. */
export function corporateJournalLines(entries: readonly JournalEntry[]): readonly JournalLine[] {
  return entries.map(entry => ({ ...entry, sortValue: entry.transactionID, derived: false }));
}

/** appConst's entry kinds used here. */
const REF = Object.freeze({
  undefined: 0,
  backwardCompatible: 6,
  playerDonation: 10,
  corporationPayment: 11,
  bounty: 16,
  bountyPrize: 17,
  insurance: 19,
  agentMissionReward: 33,
  agentMissionTimeBonusReward: 34,
  cspa: 35,
  cspaOfflineRefund: 36,
  corporationAccountWithdrawal: 37,
  corporationDividendPayment: 38,
  corporationLogoChangeCost: 40,
  releaseOfImpoundedProperty: 41,
  marketEscrow: 42,
  brokerFee: 46,
  warFee: 49,
  allianceMaintainanceFee: 50,
  bountyPrizes: 85,
  sovereignityRegistrarFee: 91,
  sovereignityUpkeepAdjustment: 95,
  planetaryImportTax: 96,
  planetaryExportTax: 97,
  planetaryConstruction: 98,
  bountySurcharge: 101,
  warSurrenderFee: 113,
  warAllyContract: 114,
  bountyReimbursement: 115,
  killRightBuy: 116,
  infrastructureHubBill: 122,
  reprocessingTax: 127,
  marketProviderTax: 149,
  careerProgramPayouts: 185,
  npcBountySecurityTax: 195,
  agentMissionSecurityTax: 197,
});

/** appConst.derivedTransactionParentMapping's kinds: the corporation taxes an entry can carry. */
const CORPORATION_TAX_KINDS: readonly number[] = [92, 93, 94, 103, 126, 175, 191, 201];
/** appConst.COSMETIC_MARKET_TRANSACTION_REFS and FREELANCE_PROJECT_REFS. */
const COSMETIC_AND_FREELANCE_KINDS: readonly number[] = [178, 179, 180, 181, 182, 183, 186, 187, 188, 189, 190, 191];
/**
 * The kinds worded by hand whatever their journal message (MANUAL_WALLET_REFERENCES: the project and daily goal and
 * career payouts, the achievement's reward, which the list names twice, and the cosmetic and freelance kinds).
 */
const MANUAL_KINDS: ReadonlySet<number> = new Set([170, 174, 185, 198, ...COSMETIC_AND_FREELANCE_KINDS]);
const OWNER_CONCORD = 1000125;
const OWNER_BANK = 2;

/** One of the journal's entries as the server sent it (a row of GetTransactions). */
export interface JournalEntry {
  readonly transactionID: number;
  readonly transactionDate: bigint | null;
  readonly referenceID: number | null;
  readonly entryTypeID: number;
  readonly ownerID1: number;
  readonly ownerID2: number;
  readonly amount: number;
  readonly balance: number;
  /** The server's description: free text, or YAML for a mapping. Null for none. */
  readonly description: string | null;
}

/** A line of the tab: an entry, or one the client derives from it. */
export interface JournalLine extends JournalEntry {
  /** GetTransactionKeyVal's sortValue: the entry's number, a derived line's beside it. */
  readonly sortValue: number;
  readonly derived: boolean;
}

function numberOf(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const long = unwrapLong(value);
  if (long !== null) return Number(long);
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

/** GetTransactions' rows, a DBRow or a KeyVal each. */
export function decodeJournalEntries(result: JsonValue | null | undefined): readonly JournalEntry[] {
  if (result === null || result === undefined || !isListValue(result)) return [];
  return result.items.map((row): JournalEntry => {
    const date = unwrapLong(readRowField(row, "transactionDate") as JsonValue);
    const description = readRowField(row, "description");
    return {
      transactionID: numberOf(readRowField(row, "transactionID")) ?? 0,
      transactionDate: date !== null && date > 0n ? date : null,
      referenceID: numberOf(readRowField(row, "referenceID")),
      entryTypeID: numberOf(readRowField(row, "entryTypeID")) ?? 0,
      ownerID1: numberOf(readRowField(row, "ownerID1")) ?? 0,
      ownerID2: numberOf(readRowField(row, "ownerID2")) ?? 0,
      amount: numberOf(readRowField(row, "amount")) ?? 0,
      balance: numberOf(readRowField(row, "balance")) ?? 0,
      description: typeof description === "string" && description !== "" ? description : null,
    };
  });
}

// --- YAML, as much of it as the server's descriptions are written in ------------------------------------------------

type Yaml = string | number | boolean | null | readonly Yaml[] | { readonly [key: string]: Yaml };

function scalarOf(text: string): Yaml {
  const t = text.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true" || t === "false") return t === "true";
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith("\"") && t.endsWith("\"") && t.length >= 2) return t.slice(1, -1).replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
  if (t.startsWith("[") || t.startsWith("{")) return flowOf(t);
  return t;
}

/** A flow collection: [a, b] or {k: v}, nested, quotes kept whole. */
function flowOf(text: string): Yaml {
  const inner = text.trim().slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i]!;
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === "\"") quote = c;
    else if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (inner.slice(start).trim() !== "") parts.push(inner.slice(start));
  if (text.trim().startsWith("[")) return parts.map(scalarOf);
  const mapping: Record<string, Yaml> = {};
  for (const part of parts) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    mapping[String(scalarOf(part.slice(0, at)))] = scalarOf(part.slice(at + 1));
  }
  return mapping;
}

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function blockOf(lines: readonly YamlLine[], from: number, indent: number): { value: Yaml; next: number } {
  const first = lines[from];
  if (first === undefined) return { value: null, next: from };
  if (first.text.startsWith("- ") || first.text === "-") {
    const items: Yaml[] = [];
    let at = from;
    while (at < lines.length && lines[at]!.indent === indent && (lines[at]!.text.startsWith("- ") || lines[at]!.text === "-")) {
      items.push(scalarOf(lines[at]!.text.slice(1)));
      at += 1;
    }
    return { value: items, next: at };
  }
  const mapping: Record<string, Yaml> = {};
  let at = from;
  while (at < lines.length && lines[at]!.indent === indent) {
    const line = lines[at]!;
    const colon = line.text.search(/:(\s|$)/);
    if (colon < 0) return { value: mapping, next: at };
    const key = String(scalarOf(line.text.slice(0, colon)));
    const rest = line.text.slice(colon + 1).trim();
    at += 1;
    if (rest !== "") {
      // A plain scalar the dump wrapped onto lines indented under it.
      let value = rest;
      while (at < lines.length && lines[at]!.indent > indent && !/:(\s|$)/.test(lines[at]!.text) && !lines[at]!.text.startsWith("- ")) {
        value += ` ${lines[at]!.text}`;
        at += 1;
      }
      mapping[key] = scalarOf(value);
    } else if (at < lines.length && (lines[at]!.indent > indent || (lines[at]!.indent === indent && lines[at]!.text.startsWith("- ")))) {
      const nested = blockOf(lines, at, lines[at]!.indent);
      mapping[key] = nested.value;
      at = nested.next;
    } else {
      mapping[key] = null;
    }
  }
  return { value: mapping, next: at };
}

/** yaml.load of a description, where it is a mapping (the only shape the client reads anything from); else null. */
export function descriptionMapping(description: string | null): Readonly<Record<string, Yaml>> | null {
  if (description === null || description.trim() === "") return null;
  const trimmed = description.trim();
  if (trimmed.startsWith("{")) {
    const flow = flowOf(trimmed);
    return flow !== null && typeof flow === "object" && !Array.isArray(flow) ? (flow as Record<string, Yaml>) : null;
  }
  const lines: YamlLine[] = description.split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  if (lines.length === 0 || !/:(\s|$)/.test(lines[0]!.text)) return null;
  const parsed = blockOf(lines, 0, lines[0]!.indent);
  return parsed.next === lines.length && parsed.value !== null && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? (parsed.value as Record<string, Yaml>)
    : null;
}

// --- The lines the client derives -----------------------------------------------------------------------------------

const num = (value: Yaml | undefined): number | null => (typeof value === "number" ? value : null);

/**
 * _GetPersonalTransactions: each entry, then the lines GetDerivedTransactions makes of it (the corporation taxes put
 * first, then the security tax), the entry changed as the client changes it.
 */
export function journalLines(entries: readonly JournalEntry[]): readonly JournalLine[] {
  const out: JournalLine[] = [];
  for (const entry of entries) {
    const parent: { -readonly [K in keyof JournalLine]: JournalLine[K] } = { ...entry, sortValue: entry.transactionID, derived: false };
    const derived: JournalLine[] = [];
    const mapping = descriptionMapping(entry.description);
    if (mapping !== null) {
      for (const kind of CORPORATION_TAX_KINDS) {
        const tax = mapping[String(kind)];
        if (!Array.isArray(tax)) continue;
        const corporationID = num(tax[0]);
        const taxAmount = num(tax[1]);
        if (corporationID === null || taxAmount === null) continue;
        // A copy of the entry as it is before the tax is put back on it.
        derived.unshift({ ...parent, amount: -taxAmount, sortValue: entry.transactionID + 0.5, ownerID2: corporationID, entryTypeID: kind, derived: true, description: null });
        parent.amount += taxAmount;
        parent.balance += taxAmount;
      }
      const securityTax = num(mapping.securityTaxAmount) ?? 0;
      const security = parent.entryTypeID === REF.agentMissionReward || parent.entryTypeID === REF.agentMissionTimeBonusReward
        ? { gross: num(mapping.grossRewardAmount), kind: REF.agentMissionSecurityTax }
        : parent.entryTypeID === REF.bountyPrize || parent.entryTypeID === REF.bountyPrizes
          ? { gross: num(mapping.grossBountyAmount), kind: REF.npcBountySecurityTax }
          : null;
      if (securityTax > 0 && security !== null && security.gross !== null) {
        derived.push({ ...parent, amount: -securityTax, transactionID: entry.transactionID - 0.25, sortValue: entry.transactionID - 0.25, entryTypeID: security.kind, ownerID2: OWNER_CONCORD, description: null, derived: true });
        parent.amount = security.gross;
        parent.balance += securityTax;
      }
    }
    out.push(parent, ...derived);
  }
  return out;
}

// --- Each line's description ----------------------------------------------------------------------------------------

/** What a line's words are made with. */
export interface EntryWordsContext {
  /** The kind's journal message (entryJournalMessageID); null where it has none. */
  readonly journalMessageID: (entryTypeID: number) => number | null;
  /** A label's or a message's ("#id") words filled with these arguments; null where they are not to hand. */
  readonly said: (label: string, args: Readonly<Record<string, JsonValue>>) => string | null;
  /** cfg.eveowners' name, as the page has it ("" while it has not). */
  readonly ownerName: (ownerID: number) => string;
  readonly locationName: (locationID: number) => string;
  readonly typeName: (typeID: number) => string;
}

const FR = "UI/Generic/FormatReference";

/**
 * The page's name kind for an owner as cfg.eveowners has it: an agent (a character the agents' table names, numbered 3
 * million to 4 million) by the agents' kind, which the page's owners do not answer; any other owner by the owners'.
 */
export function ownerNameKind(ownerID: number): "agent" | "owner" {
  return ownerID >= 3_000_000 && ownerID < 4_000_000 ? "agent" : "owner";
}

/** eveFormat.GetName: (none) for -1, a type's name for a negative number, else the owner's. */
function nameOf(id: number | null, ctx: Pick<EntryWordsContext, "ownerName" | "typeName">): string {
  return id === -1 ? "(none)" : id !== null && id < 0 ? ctx.typeName(-id) : id === null ? "" : ctx.ownerName(id);
}

/** A hand-worded kind's label and its arguments (walletEntryFormat._FmtWalletEntryManual), or null for "-". */
function manualWords(line: JournalLine, ctx: Pick<EntryWordsContext, "ownerName" | "locationName" | "typeName">): { label: string; args: Record<string, JsonValue> } | null {
  const name = (id: number | null): string => nameOf(id, ctx);
  const o1 = line.ownerID1;
  const o2 = line.ownerID2;
  const arg1 = line.referenceID;
  const planet = (): string => (arg1 !== null && arg1 !== -1 ? ctx.locationName(arg1) : "");
  switch (line.entryTypeID) {
    case REF.corporationPayment:
      return arg1 !== -1
        ? { label: `${FR}/corpPayment1`, args: { arg: name(arg1), name1: name(o1), name2: name(o2) } }
        : { label: `${FR}/corpPayment2`, args: { name1: name(o1), name2: name(o2) } };
    case REF.cspa:
      return arg1 ? { label: `${FR}/cspaServiceChargePaidBy`, args: { name1: name(o1), name2: name(arg1) } } : { label: `${FR}/cspaServiceCharge`, args: { name: name(o1) } };
    case REF.cspaOfflineRefund:
      return arg1 ? { label: `${FR}/cspaServiceChargeRefundBy`, args: { name1: name(o2), name2: name(arg1) } } : { label: `${FR}/cspaServiceChargeRefundByConcord`, args: { name1: name(o2) } };
    case REF.bounty:
      return { label: `${FR}/bountyPaidTo`, args: { name1: name(o1), name2: name(arg1) } };
    case REF.bountyPrize:
      return arg1 === -1 ? { label: `${FR}/bountyKilledMultipleEntities`, args: { name1: name(o2) } } : { label: `${FR}/bountyKilledHim`, args: { name1: name(o2), name2: name(arg1) } };
    case REF.bountyPrizes:
      return { label: `${FR}/bountyPrizes`, args: { location: arg1 === null ? "" : ctx.locationName(arg1), name1: name(o2) } };
    case REF.killRightBuy:
      return { label: `${FR}/killRightFee`, args: { buyer: name(o1), seller: name(o2), name: name(arg1) } };
    case REF.insurance:
      if (arg1 !== null && arg1 > 0) return { label: `${FR}/insurancePaidByCoveringLoss`, args: { itemname: ctx.typeName(arg1), name1: name(o1), name2: name(o2) } };
      if (arg1 !== null && arg1 < 0) return { label: `${FR}/insurancePaidForShip`, args: { location: ctx.locationName(-arg1), name1: name(o1), name2: name(o2), refID: -arg1 } };
      return { label: `${FR}/insurancePaidTo`, args: { name1: name(o1), name2: name(o2) } };
    case REF.corporationAccountWithdrawal:
      return { label: `${FR}/corpWithdrawl`, args: { name1: name(arg1), name2: name(o1), name3: name(o2) } };
    case REF.corporationDividendPayment:
      return o2 === OWNER_BANK ? { label: `${FR}/corpDividendsPayed`, args: { name: name(o1) } } : { label: `${FR}/corpDividendsPayedFrom`, args: { name1: name(o2), name2: name(arg1) } };
    case REF.corporationLogoChangeCost:
      return { label: `${FR}/corpLogoChangeFee`, args: { name1: name(o1), name2: name(arg1) } };
    case REF.releaseOfImpoundedProperty:
      return { label: `${FR}/releaseImpoundFee`, args: { location: arg1 === null ? "" : ctx.locationName(arg1), name1: name(o1), name2: name(o2) } };
    case REF.brokerFee: {
      const owner = ctx.ownerName(o1);
      return owner !== "" ? { label: `${FR}/marketBrokersFeeBy`, args: { name1: owner } } : { label: `${FR}/marketBrokersFee`, args: {} };
    }
    case REF.marketProviderTax:
      return { label: `${FR}/marketProviderTaxAtStructure`, args: { structureID: arg1 ?? 0 } };
    case REF.marketEscrow: {
      const owner = ctx.ownerName(arg1 === -1 ? o1 : o2);
      if (line.amount < 0) return owner !== "" ? { label: `${FR}/marketEscrowAuthorizedBy`, args: { name: owner } } : { label: `${FR}/marketEscrow`, args: {} };
      return { label: `${FR}/marketEscrowRelease`, args: {} };
    }
    case REF.warFee:
      return { label: `${FR}/warFee`, args: { name: name(arg1) } };
    case REF.allianceMaintainanceFee:
      return { label: `${FR}/allianceMaintenceFee`, args: { name: name(arg1) } };
    case REF.sovereignityRegistrarFee:
      return { label: `${FR}/sovereigntyRegistrarFee`, args: { name: arg1 === null ? "" : ctx.locationName(arg1) } };
    case REF.infrastructureHubBill:
      return { label: `${FR}/infrastructureHubBillRef`, args: { name: arg1 === null ? "" : ctx.locationName(arg1) } };
    case REF.sovereignityUpkeepAdjustment:
      return { label: `${FR}/sovereigntyAdjustmentFee`, args: { name: arg1 === null ? "" : ctx.locationName(arg1) } };
    case REF.planetaryImportTax:
      return { label: `${FR}/planetImportTax`, args: { name: name(o1), planet: planet() } };
    case REF.planetaryExportTax:
      return { label: `${FR}/planetExportTax`, args: { name: name(o1), planet: planet() } };
    case REF.planetaryConstruction:
      return { label: `${FR}/planetConstruction`, args: { name: name(o1), planet: planet() } };
    case REF.warSurrenderFee:
      return { label: `${FR}/WarFeeSurrender`, args: { loser: name(o1), winner: name(o2) } };
    case REF.warAllyContract:
      return { label: `${FR}/WarAllyContract`, args: { defender: name(o1), ally: name(o2) } };
    case REF.reprocessingTax:
      return { label: "UI/Wallet/WalletWindow/ReprocessingWalletEntryDescription", args: { characterName: name(o1), receiverName: name(o2) } };
    case REF.careerProgramPayouts:
      return { label: `${FR}/AirCareerProgramGoalPayout`, args: {} };
    default:
      return null;
  }
}

/**
 * FmtWalletEntry(entryTypeID, ownerID1, ownerID2, referenceID, amount, reason): the kind's journal message with the
 * parties' names and the reference, unless the kind has none or is worded by hand; "" for the two kinds worded as
 * nothing; "-" for one the client cannot word. Null while words it needs are not to hand.
 */
export function entryDescription(line: JournalLine, ctx: EntryWordsContext): string | null {
  const messageID = MANUAL_KINDS.has(line.entryTypeID) ? null : ctx.journalMessageID(line.entryTypeID);
  if (messageID !== null) {
    const name1 = nameOf(line.ownerID1, ctx);
    const name2 = nameOf(line.ownerID2, ctx);
    const arg1 = line.referenceID ?? 0;
    return ctx.said(`#${messageID}`, { name1, name2, arg1, name: name1, arg: arg1 });
  }
  if (line.entryTypeID === REF.backwardCompatible || line.entryTypeID === REF.undefined) return "";
  const words = manualWords(line, ctx);
  return words === null ? "-" : ctx.said(words.label, words.args);
}

/** The words and names a line's description and hint need asked for. */
export function entryNeeds(line: JournalLine, journalMessageID: number | null): { readonly words: readonly string[]; readonly refs: readonly NameRef[] } {
  const refs: NameRef[] = [];
  const owner = (id: number | null): void => {
    if (id !== null && id > 0) refs.push({ kind: ownerNameKind(id), id });
    else if (id !== null && id < -1) refs.push({ kind: "type", id: -id });
  };
  const location = (id: number | null): void => {
    if (id === null || id <= 0) return;
    refs.push({ kind: id >= 30_000_000 && id < 40_000_000 ? "system" : id >= 60_000_000 && id < 64_000_000 ? "station" : id >= 40_000_000 && id < 50_000_000 ? "planet" : "structure", id });
  };
  owner(line.ownerID1);
  owner(line.ownerID2);
  const words: string[] = [];
  if (journalMessageID !== null && !MANUAL_KINDS.has(line.entryTypeID)) {
    words.push(`#${journalMessageID}`);
    location(line.referenceID);
  } else {
    owner(line.referenceID);
    location(line.referenceID);
    if (line.entryTypeID === REF.insurance && line.referenceID !== null && line.referenceID > 0) refs.push({ kind: "type", id: line.referenceID });
    if (line.entryTypeID === REF.insurance && line.referenceID !== null && line.referenceID < 0) location(-line.referenceID);
    const label = manualWords(line, { ownerName: () => "x", locationName: () => "", typeName: () => "" })?.label;
    if (label !== undefined) words.push(label);
    // The broker's fee and the escrow are worded by whether the owner is known: the other label too.
    if (line.entryTypeID === REF.brokerFee) words.push(`${FR}/marketBrokersFee`);
    if (line.entryTypeID === REF.marketEscrow) words.push(`${FR}/marketEscrow`);
  }
  const hint = descriptionMapping(line.description);
  if (hint !== null) {
    words.push(...HINT_WORDS);
    const bounties = hint.NBL;
    if (bounties !== null && typeof bounties === "object" && !Array.isArray(bounties)) {
      for (const typeID of Object.keys(bounties)) refs.push({ kind: "type", id: Number(typeID) });
    }
    for (const key of ["constructions"]) {
      const built = hint[key];
      if (built !== null && typeof built === "object" && !Array.isArray(built)) for (const typeID of Object.keys(built)) refs.push({ kind: "type", id: Number(typeID) });
    }
    if (typeof hint.OWNERIDS === "string") for (const id of hint.OWNERIDS.split(",")) owner(Number(id));
  }
  return { words, refs };
}

const HINT_WORDS: readonly string[] = [
  "UI/Wallet/WalletWindow/HintExtraReference",
  "UI/Wallet/WalletWindow/HintBountyTruncated",
  "UI/Wallet/WalletWindow/HintBountyPaid",
  "UI/Wallet/WalletWindow/HintBountyPaidTruncated",
  "UI/PI/Planet/CommandCenterUpgradeReason",
  "UI/PI/Planet/ConstructionReason",
  "UI/Inventory/QuantityAndName",
  "UI/PI/Planet/NetworkUpdateTransactionReason",
];

/** The kinds GetTransactionHint gives no hint (NO_TOOLTIP_TYPES). */
const NO_HINT_KINDS: ReadonlySet<number> = new Set([170, 174, 185, 198, 199, ...COSMETIC_AND_FREELANCE_KINDS]);

/**
 * GetTransactionHint, as far as the page has it: a bounty's payers, the description's own words (DESC), the bounties
 * by kind ("type x count", NBL, with its truncation), a planet's network change. Null for none; undefined while words it
 * needs are not to hand.
 */
export function entryHint(line: JournalLine, ctx: Pick<EntryWordsContext, "said" | "ownerName" | "typeName" | "locationName">): string | null | undefined {
  const mapping = descriptionMapping(line.description);
  if (mapping === null) return null;
  if (line.entryTypeID === REF.bountyPrize && typeof mapping.OWNERIDS === "string") {
    const owners = mapping.OWNERIDS.split(",").map((id) => ctx.ownerName(Number(id))).filter((each) => each !== "");
    const truncated = num(mapping.OWNERST) ?? 0;
    const list = owners.length <= 1 ? owners.join("") : truncated ? owners.join(", ") : `${owners.slice(0, -1).join(", ")} and ${owners[owners.length - 1]}`;
    const said = truncated
      ? ctx.said("UI/Wallet/WalletWindow/HintBountyPaidTruncated", { ownerList: list, others: truncated })
      : ctx.said("UI/Wallet/WalletWindow/HintBountyPaid", { ownerList: list });
    return said === null ? undefined : said;
  }
  if (NO_HINT_KINDS.has(line.entryTypeID)) return null;
  const lines: string[] = [];
  if (typeof mapping.DESC === "string" || typeof mapping.DESC === "number") lines.push(String(mapping.DESC));
  const bounties = mapping.NBL;
  if (bounties !== null && typeof bounties === "object" && !Array.isArray(bounties)) {
    for (const [typeID, count] of Object.entries(bounties)) lines.push(`${ctx.typeName(Number(typeID))} x ${String(count)}`);
    if ("NBLT" in mapping) {
      const said = ctx.said("UI/Wallet/WalletWindow/HintBountyTruncated", {});
      if (said === null) return undefined;
      lines.push(said);
    }
  }
  if (line.entryTypeID === REF.planetaryConstruction && lines.length === 0) {
    const upgrade = "oldLevel" in mapping ? ctx.said("UI/PI/Planet/CommandCenterUpgradeReason", { oldLevel: mapping.oldLevel as JsonValue, newLevel: mapping.newLevel as JsonValue }) : "";
    const built = mapping.constructions;
    let constructions: string | null = "";
    if (built !== null && typeof built === "object" && !Array.isArray(built)) {
      const parts = Object.entries(built).map(([typeID, qty]) => ctx.said("UI/Inventory/QuantityAndName", { quantity: qty as JsonValue, name: ctx.typeName(Number(typeID)) }));
      constructions = parts.some((part) => part === null) ? null : ctx.said("UI/PI/Planet/ConstructionReason", { planet: line.referenceID ?? 0, constructions: parts.join("\r\n") });
    }
    const said = upgrade === null || constructions === null ? null : ctx.said("UI/PI/Planet/NetworkUpdateTransactionReason", { ccUpgrade: upgrade, constructions, destructions: "" });
    if (said === null) return undefined;
    lines.push(said);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

// --- The tab's choices ----------------------------------------------------------------------------------------------

/** GetDateComboOptions: the last thirty days (None, None), then each of the five months before this one, newest first. */
export function journalPeriods(today: Date): readonly { readonly year: number | null; readonly month: number | null }[] {
  const periods: { year: number | null; month: number | null }[] = [{ year: null, month: null }];
  let year = today.getFullYear();
  let month = today.getMonth();
  for (let i = 0; i < 5; i += 1) {
    month -= 1;
    if (month === -1) {
      month = 11;
      year -= 1;
    }
    periods.push({ year, month: month + 1 });
  }
  return periods;
}

/** NUM_TRANSACTIONS_PER_PAGE. */
export const JOURNAL_LINES_PER_PAGE = 100;

/** walletConst.SKIP_REF_TYPES: kinds the type filter does not offer. */
const SKIP_KINDS: ReadonlySet<number> = new Set([4, 5, 6, 14, 18, 20, 21, 23, 24, 28, 29, 32, 36, 43, 44, 45, 47, 54, 61, 62]);
/** appConst.refMaxEve. */
const MAX_EVE_KIND = 10000;

/**
 * GetReferenceTypeComboOptions: the kinds the lines are of, but those skipped and those past refMaxEve, by name as
 * lower case, each by its name ("All Types" goes first).
 */
export function journalKindChoices(lines: readonly JournalLine[], kindName: (entryTypeID: number) => string): readonly { readonly entryTypeID: number; readonly name: string }[] {
  const seen = new Set<number>();
  const choices: { entryTypeID: number; name: string }[] = [];
  for (const line of lines) {
    if (seen.has(line.entryTypeID) || SKIP_KINDS.has(line.entryTypeID) || line.entryTypeID >= MAX_EVE_KIND) continue;
    seen.add(line.entryTypeID);
    choices.push({ entryTypeID: line.entryTypeID, name: kindName(line.entryTypeID) });
  }
  return choices.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
}

/** FmtWalletCurrency(amount) without the wallet's cents: whole ISK, truncated (int()) where it is more than one. */
export function walletAmount(amount: number): number {
  return Math.abs(amount) > 1 ? Math.trunc(amount) : Math.round(amount);
}
