// The multifit window's reckoning and its call (eve/client/script/ui/shared/fitting/multiFitWnd.py MultiFitWnd;
// eve/client/script/environment/fittingSvc.py GetQtyInLocationByTypeIDs, GetMaxAvailabeAndMissingForFullFit,
// FindPersonalContainers and DoFitManyShips).
//
// The window fits a saved fitting to as many of its hull's packaged ships in the hangar as asked, at most the global
// config's bulkFit_maxShips (GetMaxShipsToFit, '30'). It counts the hangar's packaged ships of the hull, and how many
// rounds of the fitting the equipment's place holds (the item hangar, or one of the pilot's own containers in it),
// and fits the fewer of those and of what was asked, with one call on the ship service bound for where the pilot is:
//
//   GetShipAccess().FitShips(shipTypeID=..., fitInfo=Fitting.GetKeyValForApplyingFit(), itemLocationID=
//       session.stationid or session.structureid, cargoItemsByType=..., fitRigs=..., name=..., numToFit=...,
//       itemContainerID=...)
//
// which answers None, or (failedToLoad, failedShipID): what could not be loaded, and a ship it could not fit.

import type { Ask } from "./ask.ts";
import { decodeInventoryRows } from "./inventoryShip.ts";
import { THE_HANGAR } from "./fitModule.ts";
import type { FittingParts } from "./fittingLoad.ts";
import { unwrapLong, type JsonValue } from "./wire.ts";

/** globalConfig/const.py BULK_FIT_SHIPS_CONFIG and BULK_FIT_SHIPS_DEFAULT. */
export const BULK_FIT_SHIPS_CONFIG = "bulkFit_maxShips";
const BULK_FIT_SHIPS_DEFAULT = 30;

/**
 * GetMaxShipsToFit (getFunctions.py 48, GetGlobalConfigIntValue 24 to 31): the config's value as Python's int reads it;
 * its default where it gives none or one that is no whole number.
 */
export function maxShipsToFit(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  return BULK_FIT_SHIPS_DEFAULT;
}

const FLAG_HANGAR = 4;
/** inventorycommon/const.py: the containers FindPersonalContainers takes. */
const PERSONAL_CONTAINER_GROUPS: readonly number[] = [448, 340, 12, 649];
/** inventorycommon/const.py ixSingleton: the column an item's change names where it was packaged or assembled. */
const IX_SINGLETON = 10;

/** An item of a place, as its List gives it. */
export interface PlaceItem {
  readonly itemID: number;
  readonly typeID: number;
  readonly groupID: number | null;
  readonly ownerID: number | null;
  /** item.stacksize: one for an assembled item. */
  readonly stacksize: number;
  /** item.singleton (an assembled item, whose quantity is -1). */
  readonly singleton: boolean;
}

function whole(value: JsonValue | undefined): number | null {
  const long = unwrapLong(value);
  const number = typeof value === "number" ? value : long !== null ? Number(long) : NaN;
  return Number.isSafeInteger(number) ? number : null;
}

/** The owners of the rows of a List, by item; the page's row decoder does not keep them. */
function ownersOf(answer: JsonValue): Map<number, number> {
  const owners = new Map<number, number>();
  const visit = (value: JsonValue): void => {
    if (Array.isArray(value)) {
      for (const each of value) visit(each);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, JsonValue>;
    const fields = record.type === "packedrow" && typeof record.fields === "object" && record.fields !== null ? (record.fields as Record<string, JsonValue>) : null;
    if (fields !== null) {
      const itemID = whole(fields.itemID);
      const ownerID = whole(fields.ownerID);
      if (itemID !== null && ownerID !== null) owners.set(itemID, ownerID);
      return;
    }
    for (const each of Object.values(record)) visit(each);
  };
  visit(answer);
  return owners;
}

/**
 * A place's items: the item hangar's (invCache.GetInventory(const.containerHangar).List(const.flagHangar)) where no
 * place is named, else the container's (GetInventoryFromId(locationID).List()).
 */
export async function listPlace(ask: Ask, locationID: number | null): Promise<PlaceItem[]> {
  const answer = locationID === null
    ? await ask("invbroker", "List", [], { flag: FLAG_HANGAR }, THE_HANGAR)
    : await ask("invbroker", "List", [], { flag: null }, locationID);
  const owners = ownersOf(answer);
  return decodeInventoryRows(answer).map((row) => ({
    itemID: row.itemID,
    typeID: row.typeID,
    groupID: row.groupID,
    ownerID: owners.get(row.itemID) ?? null,
    stacksize: row.quantity,
    singleton: row.singleton,
  }));
}

/**
 * fittingSvc.GetQtyInLocationByTypeIDs (653 to 667): how many of each type named the place holds, the stacks added;
 * with onlyGetNonSingletons, the assembled ones (quantity < 0) passed over.
 */
export function qtyInPlaceByTypeIDs(items: readonly PlaceItem[], typeIDs: Iterable<number>, onlyGetNonSingletons = false): Map<number, number> {
  const wanted = new Set(typeIDs);
  const qty = new Map<number, number>();
  for (const item of items) {
    if (!wanted.has(item.typeID)) continue;
    if (onlyGetNonSingletons && item.singleton) continue;
    qty.set(item.typeID, (qty.get(item.typeID) ?? 0) + item.stacksize);
  }
  return qty;
}

/**
 * fittingSvc.GetMaxAvailabeAndMissingForFullFit (528 to 541): for each type the fitting needs (a rig passed over where
 * rigs are not fitted), how many rounds of the fitting the place holds, and what it lacks for numToFit rounds. The
 * rounds available are the fewest of those; none where the fitting needs nothing.
 */
export function maxAvailableAndMissing(
  fitRigs: boolean,
  itemTypes: ReadonlyMap<number, number>,
  numToFit: number,
  qtyByTypeID: ReadonlyMap<number, number>,
  rigTypeIDs: ReadonlySet<number>,
): { readonly maxAvailableFitting: number | null; readonly missingForFullFit: Map<number, number> } {
  const missingForFullFit = new Map<number, number>();
  const rounds: number[] = [];
  for (const [typeID, qtyNeeded] of itemTypes) {
    if (!fitRigs && rigTypeIDs.has(typeID)) continue;
    const qtyInHangar = qtyByTypeID.get(typeID) ?? 0;
    const each = Math.floor(qtyInHangar / qtyNeeded);
    rounds.push(each);
    if (each < numToFit) missingForFullFit.set(typeID, qtyNeeded * numToFit - qtyInHangar);
  }
  return { maxAvailableFitting: rounds.length > 0 ? Math.min(...rounds) : null, missingForFullFit };
}

/**
 * fittingSvc.FindPersonalContainers (669 to 681): the hangar's assembled containers of the four kinds a pilot keeps
 * equipment in (audit log, secure cargo, cargo and freight containers) that are the pilot's own.
 */
export function personalContainers(hangar: readonly PlaceItem[], characterID: number): PlaceItem[] {
  return hangar.filter((item) => item.groupID !== null && PERSONAL_CONTAINER_GROUPS.includes(item.groupID) && item.ownerID === characterID && item.singleton);
}

/**
 * MultiFitWnd.OnItemChange (530 to 535): whether an item's change is one of the hull's ships made assembled or
 * packaged (its change names ixSingleton), which the window counts as a ship fitted.
 */
export function isShipAssembled(args: readonly unknown[], shipTypeID: number): boolean {
  const item = args[0];
  const fields = typeof item === "object" && item !== null ? (item as { readonly fields?: unknown }).fields : null;
  if (typeof fields !== "object" || fields === null || (fields as { readonly typeID?: unknown }).typeID !== shipTypeID) return false;
  const change = args[1];
  const entries = typeof change === "object" && change !== null ? (change as { readonly entries?: unknown }).entries : null;
  return Array.isArray(entries) && entries.some((entry) => Array.isArray(entry) && entry[0] === IX_SINGLETON);
}

/** What FitShips answers: what could not be loaded, each type and how many, and a ship it could not fit. */
export interface FitShipsFailure {
  readonly failedToLoad: readonly { readonly typeID: number; readonly qty: number }[];
  readonly failedShipID: number | null;
}

function sequence(value: JsonValue | undefined): readonly JsonValue[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items)) return (value as { items: JsonValue[] }).items;
  return [];
}

/**
 * fittingSvc.DoFitManyShips's call (504 to 511): FitShips on the ship service bound for where the pilot is, all its
 * arguments keywords. Answers what failed, or null where nothing did.
 */
export async function fitShips(act: Ask, call: {
  readonly shipTypeID: number;
  readonly fitInfo: FittingParts;
  readonly itemLocationID: number;
  readonly cargoItemsByType: Readonly<Record<number, number>>;
  readonly fitRigs: boolean;
  readonly name: string;
  readonly numToFit: number;
  readonly itemContainerID: number | null;
}): Promise<FitShipsFailure | null> {
  const plain = (record: Readonly<Record<number, number>>): Record<string, number> => ({ ...record });
  const answer = await act("ship", "FitShips", [], {
    shipTypeID: call.shipTypeID,
    fitInfo: {
      chargesByType: plain(call.fitInfo.chargesByType), dronesByType: plain(call.fitInfo.dronesByType), fightersByTypeID: plain(call.fitInfo.fightersByTypeID),
      iceByType: plain(call.fitInfo.iceByType), modulesByFlag: plain(call.fitInfo.modulesByFlag), implantsByTypeID: plain(call.fitInfo.implantsByTypeID),
    },
    itemLocationID: call.itemLocationID,
    cargoItemsByType: plain(call.cargoItemsByType),
    fitRigs: call.fitRigs,
    name: call.name,
    numToFit: call.numToFit,
    itemContainerID: call.itemContainerID,
  });
  const parts = sequence(answer);
  if (parts.length < 2) return null;
  const failedToLoad: { typeID: number; qty: number }[] = [];
  for (const entry of sequence(parts[0])) {
    const [typeID, qty] = sequence(entry);
    const type = whole(typeID);
    const count = whole(qty);
    if (type !== null && type > 0 && count !== null) failedToLoad.push({ typeID: type, qty: count });
  }
  const shipID = whole(parts[1]);
  return { failedToLoad, failedShipID: shipID !== null && shipID > 0 ? shipID : null };
}
