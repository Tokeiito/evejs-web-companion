// R62 — decoding the contractProxy BIDS / ESCROW / ITEM-SOURCE reads
// (PLUMBING ONLY — no UI).
//
// The my-bids / escrow / outstanding-counts / item-source reads that sit beside
// the R17 contract browse. GET /api/bridge/contract-items returns seven raw
// retail-shaped contractProxy results, captured live from Farmer (char
// 140000005, docked station 60000358) on 2026-07-22. Every read is
// session-scoped, and the item reads are ownership-gated server-side (a
// container/location that is not the session owner's answers empty), so no
// argument points one at another owner's items.
//
// ⚠ THREE ROW SHAPES on one service, all read through R32's `readRowField`:
//   • GetMyContractEscrow / NumOutstandingContracts -> a bare util.KeyVal.
//   • GetMyBids -> an EMPTY contract bundle {contracts:[], items:{}} (the
//     auction/bid surface is a SERVER STUB) -> reuse `decodeContractList`.
//   • GetItemsInContainer -> a plain list of inventory PACKEDROWS.
//   • GetItemsInDockableLocation -> the SAME packedrows wrapped in a
//     `__builtin__.set` (objectex1), NOT a bare list — the item list rides
//     header[1][0]. A decoder that reads it as a list finds nothing.
//   • GetNumItemsInContainers -> a dict keyed by containerID -> count.
//   • GetCourierContractFromItemID -> a single contract util.KeyVal, or null
//     -> reuse `decodeContractRow`.
//
// ⚠ INVENTORY ROW `quantity` IS -1 FOR AN ASSEMBLED SINGLETON (measured live:
// quantity -1, singleton 1, stacksize 1 — a fitted ship in the hangar). `units`
// below is the render-safe rule (a singleton is 1, else its stacksize) — the
// same rule R37 personalAssets / R61 corpAssets apply — so a UI never shows
// "-1" of a ship. itemID is int64 (measured 9988400023309 > 2^32, still < 2^53).
//
// R7d: every id (itemID / typeID / ownerID / locationID / containerID + the
// contract/entity ids inside a courier row) survives as a numeric field for a
// future UI to resolve; ISK escrow is a bigint-safe decimal string. Empty (no
// bids, no escrow, no outstanding contracts, no items in a foreign/empty
// container, no courier contract for an item) is a legitimate state.

import { decodeContractList, decodeContractRow } from "./contracts.ts";
import type { ContractRow } from "../store/types.ts";
import { isListValue, readKeyVal, readRowField, unwrapLong, type JsonValue } from "./wire.ts";

// --- Escrow + outstanding counts (bare util.KeyVal) -------------------------

/** Contract escrow — what the character has locked behind their OWN outstanding
 * contracts (contractProxy.GetMyContractEscrow). ⚠ NOT market-order escrow
 * (marketProxy.GetCharEscrow is a different call on a different service). */
export interface ContractEscrow {
  /** ISK locked in contract rewards, as a decimal string (bigint-safe). */
  readonly isk: string;
  /** Count of items locked in the character's contract crates. */
  readonly items: number;
}

/** The outstanding-contract counts behind the panel headline
 * (contractProxy.NumOutstandingContracts). */
export interface OutstandingContractCounts {
  readonly nonCorpForMyChar: number;
  readonly myCorpTotal: number;
  readonly nonCorpForMyCorp: number;
  readonly myCharTotal: number;
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/** An ISK amount as a bigint-safe DECIMAL STRING; "0" when absent/malformed. */
function toAmount(value: JsonValue | undefined): string {
  const long = unwrapLong(value);
  if (long !== null) {
    return long.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  return "0";
}

/** Decode contractProxy.GetMyContractEscrow() -> {isk, items}. Empty (0/0) for a
 * character issuing no contracts is a REAL state. */
export function decodeContractEscrow(result: JsonValue): ContractEscrow {
  return {
    isk: toAmount(readKeyVal(result, "iskEscrow")),
    items: toNumber(readKeyVal(result, "itemsEscrow")),
  };
}

/** Decode contractProxy.NumOutstandingContracts() -> the four counts. */
export function decodeOutstandingCounts(result: JsonValue): OutstandingContractCounts {
  return {
    nonCorpForMyChar: toNumber(readKeyVal(result, "nonCorpForMyChar")),
    myCorpTotal: toNumber(readKeyVal(result, "myCorpTotal")),
    nonCorpForMyCorp: toNumber(readKeyVal(result, "nonCorpForMyCorp")),
    myCharTotal: toNumber(readKeyVal(result, "myCharTotal")),
  };
}

// --- My bids (empty contract bundle) ----------------------------------------

/**
 * Decode contractProxy.GetMyBids() -> the contracts the character is bidding on.
 * The server STUBS this to an empty bundle {contracts:[], items:{}} (no bidding
 * modelled), so this is always `[]` today; it reuses `decodeContractList` so a
 * future populated bundle decodes for free.
 */
export function decodeMyBids(result: JsonValue): readonly ContractRow[] {
  return decodeContractList(result);
}

// --- Inventory item rows (packedrow) ----------------------------------------

/** One item a player can put on a contract (contractProxy.GetItemsInContainer /
 * GetItemsInDockableLocation). */
export interface ContractInventoryItem {
  readonly itemID: number;
  readonly typeID: number;
  readonly ownerID: number;
  readonly locationID: number;
  readonly flagID: number;
  /** The raw wire quantity: -1 for an assembled singleton. Prefer `units`. */
  readonly quantity: number;
  /** Render-safe count: 1 for a singleton, else the stacksize. */
  readonly units: number;
  readonly singleton: boolean;
  readonly groupID: number;
  readonly categoryID: number;
  readonly customInfo: string;
  readonly stacksize: number;
}

function decodeInventoryItemRow(row: JsonValue): ContractInventoryItem | null {
  const itemID = toNumber(readRowField(row, "itemID"));
  if (itemID <= 0) {
    return null;
  }
  const singleton = toNumber(readRowField(row, "singleton")) === 1;
  const stacksize = toNumber(readRowField(row, "stacksize"));
  const quantity = toNumber(readRowField(row, "quantity"));
  const customInfo = readRowField(row, "customInfo");
  return {
    itemID,
    typeID: toNumber(readRowField(row, "typeID")),
    ownerID: toNumber(readRowField(row, "ownerID")),
    locationID: toNumber(readRowField(row, "locationID")),
    flagID: toNumber(readRowField(row, "flagID")),
    quantity,
    // ⚠ NOT the raw quantity (which is -1 for an assembled singleton).
    units: singleton ? 1 : Math.max(0, stacksize || quantity || 0),
    singleton,
    groupID: toNumber(readRowField(row, "groupID")),
    categoryID: toNumber(readRowField(row, "categoryID")),
    customInfo: typeof customInfo === "string" ? customInfo : "",
    stacksize,
  };
}

/**
 * The item list a `__builtin__.set` (objectex1) wraps: `header` is
 * [tokenObj, [listObj]], so the items live at header[1][0].items. `[]` for a
 * non-set / malformed value.
 */
function pythonSetItems(result: JsonValue | null | undefined): readonly JsonValue[] {
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    (result as { type?: unknown }).type !== "objectex1"
  ) {
    return [];
  }
  const header = (result as { header?: unknown }).header;
  if (!Array.isArray(header) || header.length < 2) {
    return [];
  }
  const carrier = header[1];
  const listValue = Array.isArray(carrier) ? carrier[0] : carrier;
  return isListValue(listValue) ? (listValue.items as readonly JsonValue[]) : [];
}

/**
 * Decode contractProxy.GetItemsInContainer(...) -> the items in one container, a
 * plain list of inventory packedrows. `[]` for an empty / foreign container.
 */
export function decodeContainerItems(result: JsonValue): readonly ContractInventoryItem[] {
  const items: ContractInventoryItem[] = [];
  const list = isListValue(result) ? (result.items as readonly JsonValue[]) : [];
  for (const row of list) {
    const decoded = decodeInventoryItemRow(row);
    if (decoded) {
      items.push(decoded);
    }
  }
  return items;
}

/**
 * Decode contractProxy.GetItemsInDockableLocation(...) -> the hangar items
 * available to contract, wrapped in a `__builtin__.set`. `[]` for an empty
 * hangar.
 */
export function decodeDockableLocationItems(result: JsonValue): readonly ContractInventoryItem[] {
  const items: ContractInventoryItem[] = [];
  for (const row of pythonSetItems(result)) {
    const decoded = decodeInventoryItemRow(row);
    if (decoded) {
      items.push(decoded);
    }
  }
  return items;
}

// --- Container item counts (dict) -------------------------------------------

/** How many items sit in one container (contractProxy.GetNumItemsInContainers). */
export interface ContainerItemCount {
  readonly containerID: number;
  readonly count: number;
}

/**
 * Decode contractProxy.GetNumItemsInContainers(...) -> a dict keyed by
 * containerID -> item count. `[]` for no readable containers.
 */
export function decodeContainerItemCounts(result: JsonValue): readonly ContainerItemCount[] {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return [];
  }
  const candidate = result as { type?: unknown; entries?: unknown };
  if (candidate.type !== "dict" || !Array.isArray(candidate.entries)) {
    return [];
  }
  const rows: ContainerItemCount[] = [];
  for (const entry of candidate.entries as readonly JsonValue[]) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }
    const containerID = toNumber(entry[0] as JsonValue);
    if (containerID <= 0) {
      continue;
    }
    rows.push({ containerID, count: toNumber(entry[1] as JsonValue) });
  }
  return rows;
}

// --- Courier contract from an item ------------------------------------------

/**
 * Decode contractProxy.GetCourierContractFromItemID(itemID) -> the courier
 * contract a crate item belongs to, or null. `null` for an item on no contract
 * is a REAL "not on a contract" answer; a present contract is a util.KeyVal read
 * by the R17 `decodeContractRow`.
 */
export function decodeCourierContract(result: JsonValue): ContractRow | null {
  if (result === null || result === undefined) {
    return null;
  }
  return decodeContractRow(result);
}
