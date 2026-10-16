// A saved fitting loaded onto the ship the pilot is in, as the client's fitting service loads one
// (eve/client/script/environment/fittingSvc.py LoadFitting, 554 to 618; shipfitting/fitting.py Fitting).
//
// The client sorts the fitting's entries by their flag (Fitting.__init__): a slot's module by the slot, and drones,
// fighters, fuel, implants and charges by type. Of each it asks the hangar only for what the ship does not already
// hold in that flag. It names the hangar's stacks of each type, taking stacks until the count is met, and makes one
// call on the ship's own inventory:
//
//   shipInv.FitFitting(activeShip, shipTypeID, itemsToFit, session.stationid or session.structureid,
//                      fittingObjKeyVal, cargoItemsByType, fitRigs)
//
// which answers what failed to load, each type and how many (failedToLoad).

import type { Ask } from "./ask.ts";
import { decodeInventoryRows } from "./inventoryShip.ts";
import { THE_HANGAR } from "./fitModule.ts";
import { unwrapLong, type JsonValue } from "./wire.ts";

/** inventorycommon/const.py: the flags and the group and category the client's Fitting sorts entries by. */
const FLAG_HANGAR = 4;
const FLAG_CARGO = 5;
const FLAG_DRONE_BAY = 87;
const FLAG_RIG_SLOT0 = 92;
const FLAG_RIG_SLOT7 = 99;
const FLAG_SUBSYSTEM_SLOT0 = 125;
const FLAG_SUBSYSTEM_SLOT7 = 132;
const FLAG_HIDDEN_MODIFIERS = 156;
const FLAG_FIGHTER_BAY = 158;
const GROUP_ICE_PRODUCT = 423;
const CATEGORY_IMPLANT = 20;
const GROUP_STRATEGIC_CRUISER = 963;
/** inventorycommon/const.py subsystemSlotFlags: the visible four (numVisibleSubsystems). */
export const VISIBLE_SUBSYSTEM_FLAGS: readonly number[] = [125, 126, 127, 128];

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, at) => from + at);
/**
 * inventorycommon/const.py fittingFlags: the low, medium and high slots, the four visible subsystems, three rig
 * slots and the service slots (IsShipFittingFlag, with flagHiddenModifers).
 */
const FITTING_FLAGS = new Set([...range(11, 34), ...VISIBLE_SUBSYSTEM_FLAGS, 92, 93, 94, ...range(164, 171)]);

export const isRigFlag = (flag: number): boolean => flag >= FLAG_RIG_SLOT0 && flag <= FLAG_RIG_SLOT7;
const isSubsystemFlag = (flag: number): boolean => flag >= FLAG_SUBSYSTEM_SLOT0 && flag <= FLAG_SUBSYSTEM_SLOT7;
const isModuleFlag = (flag: number): boolean => FITTING_FLAGS.has(flag);
/** inventorycommon/util.py IsModularShip: a strategic cruiser. */
export const isModularShip = (groupID: number | null): boolean => groupID === GROUP_STRATEGIC_CRUISER;

/** One entry of a saved fitting's fitData: a type, its flag and how many. */
export interface FitDataEntry {
  readonly typeID: number;
  readonly flagID: number;
  readonly quantity: number;
}

/** An item the ship or the hangar holds, as its List gives it. */
export interface HeldItem {
  readonly itemID: number;
  readonly typeID: number;
  readonly flagID: number | null;
  /** The stack's size (an assembled item is one). */
  readonly quantity: number;
}

/** shipfitting/fitting.py Fitting: the fitting sorted, and what the hangar is to supply. */
export interface FittingForApplying {
  /** itemTypes: each type and how many of it the hangar is to supply. */
  readonly itemTypes: Map<number, number>;
  readonly modulesByFlag: Readonly<Record<number, number>>;
  readonly dronesByType: Readonly<Record<number, number>>;
  readonly fightersByType: Readonly<Record<number, number>>;
  readonly chargesByType: Readonly<Record<number, number>>;
  readonly iceByType: Readonly<Record<number, number>>;
  readonly implantsByType: Readonly<Record<number, number>>;
  /** rigsToFit: each rig slot's rig. */
  readonly rigsByFlag: Readonly<Record<number, number>>;
  readonly numSubSystems: number;
}

/**
 * Fitting.__init__ (16 to 59): each entry sorted by its flag, a cargo entry by its type's group and category (ice is
 * fuel, an implant an implant, anything else a charge), and one of no kind passed over. Then, unless the ship holds the
 * type in that flag in just that number, the hangar is to supply it, less what the ship holds of it there.
 */
export function fittingForApplying(
  fitData: readonly FitDataEntry[],
  shipItems: readonly HeldItem[],
  typeFacts: (typeID: number) => { readonly groupID: number | null; readonly categoryID: number | null },
): FittingForApplying {
  const itemTypes = new Map<number, number>();
  const modulesByFlag: Record<number, number> = {};
  const dronesByType: Record<number, number> = {};
  const fightersByType: Record<number, number> = {};
  const chargesByType: Record<number, number> = {};
  const iceByType: Record<number, number> = {};
  const implantsByType: Record<number, number> = {};
  const rigsByFlag: Record<number, number> = {};
  let numSubSystems = 0;
  for (const { typeID, flagID: flag, quantity } of fitData) {
    let qty = quantity;
    const { groupID, categoryID } = typeFacts(typeID);
    if (isRigFlag(flag)) rigsByFlag[flag] = typeID;
    if (isSubsystemFlag(flag)) numSubSystems += 1;
    if (isModuleFlag(flag) && flag !== FLAG_HIDDEN_MODIFIERS) modulesByFlag[flag] = typeID;
    else if (flag === FLAG_DRONE_BAY) dronesByType[typeID] = qty;
    else if (flag === FLAG_FIGHTER_BAY) fightersByType[typeID] = qty;
    else if (flag === FLAG_CARGO && groupID === GROUP_ICE_PRODUCT) iceByType[typeID] = qty;
    else if (flag === FLAG_CARGO && categoryID === CATEGORY_IMPLANT) implantsByType[typeID] = qty;
    else if (flag === FLAG_CARGO) chargesByType[typeID] = qty;
    else continue;
    let skipType = false;
    for (const item of shipItems) {
      if (item.flagID !== flag || item.typeID !== typeID) continue;
      if (item.quantity === qty) {
        skipType = true;
        break;
      }
      qty -= item.quantity;
    }
    if (skipType) continue;
    itemTypes.set(typeID, (itemTypes.get(typeID) ?? 0) + qty);
  }
  return { itemTypes, modulesByFlag, dronesByType, fightersByType, chargesByType, iceByType, implantsByType, rigsByFlag, numSubSystems };
}

/**
 * LoadFitting (583 to 590): the hangar's stacks of each type the hangar is to supply, a stack named until the count is
 * met; `itemTypes` is left with what is still short.
 */
export function itemsToFitFrom(hangar: readonly HeldItem[], itemTypes: Map<number, number>): Record<number, number[]> {
  const itemsToFit: Record<number, number[]> = {};
  for (const item of hangar) {
    const qtyNeeded = itemTypes.get(item.typeID);
    if (qtyNeeded === undefined || qtyNeeded === 0) continue;
    const quantityToTake = Math.min(item.quantity, qtyNeeded);
    const named = (itemsToFit[item.typeID] ??= []);
    if (!named.includes(item.itemID)) named.push(item.itemID);
    itemTypes.set(item.typeID, qtyNeeded - quantityToTake);
  }
  return itemsToFit;
}

/**
 * shipfitting/fittingStuff.py IsThereRigMismatch (309 to 313): a slot of the fitting's holding another rig, or a rig
 * fitted in a slot the fitting leaves empty.
 */
export function isThereRigMismatch(fitted: Readonly<Record<number, number>>, inFit: Readonly<Record<number, number>>): boolean {
  const otherInSlot = Object.entries(inFit).some(([flag, typeID]) => fitted[Number(flag)] !== undefined && fitted[Number(flag)] !== typeID);
  const notInFit = Object.keys(fitted).some((flag) => inFit[Number(flag)] === undefined);
  return otherInSlot || notInFit;
}

/** The rigs fitted, by slot (fittingSvc.GetFittedRigsByFlagID, 695 to 702). */
export function fittedRigsByFlag(shipItems: readonly HeldItem[]): Record<number, number> {
  const rigs: Record<number, number> = {};
  for (const item of shipItems) if (item.flagID !== null && item.flagID >= FLAG_RIG_SLOT0 && item.flagID <= FLAG_RIG_SLOT7) rigs[item.flagID] = item.typeID;
  return rigs;
}

function held(answer: JsonValue): HeldItem[] {
  return decodeInventoryRows(answer).map((row) => ({ itemID: row.itemID, typeID: row.typeID, flagID: row.flagID, quantity: row.quantity }));
}

/** What the ship holds, every flag (invCache's ship inventory List(), as GetFittedRigsByFlagID lists it). */
export async function listShip(ask: Ask, shipID: number): Promise<HeldItem[]> {
  return held(await ask("invbroker", "List", [], { flag: null }, shipID));
}

/** What the hangar holds (invCache.GetInventory(const.containerHangar).List(const.flagHangar)). */
export async function listHangar(ask: Ask): Promise<HeldItem[]> {
  return held(await ask("invbroker", "List", [], { flag: FLAG_HANGAR }, THE_HANGAR));
}

/** Fitting.GetKeyValForApplyingFit (shipfitting/fitting.py 119): the six by their names; the game port makes the KeyVal. */
export interface FittingParts {
  readonly chargesByType: Readonly<Record<number, number>>;
  readonly dronesByType: Readonly<Record<number, number>>;
  readonly fightersByTypeID: Readonly<Record<number, number>>;
  readonly iceByType: Readonly<Record<number, number>>;
  readonly modulesByFlag: Readonly<Record<number, number>>;
  readonly implantsByTypeID: Readonly<Record<number, number>>;
}

function wholeNumber(value: JsonValue | undefined): number | null {
  const long = unwrapLong(value);
  const number = typeof value === "number" ? value : long !== null ? Number(long) : NaN;
  return Number.isSafeInteger(number) ? number : null;
}

function sequence(value: JsonValue | undefined): readonly JsonValue[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items)) return (value as { items: JsonValue[] }).items;
  return [];
}

/**
 * LoadFitting's call (618): on the ship's own inventory. Answers what failed to load, each type and how many, as the
 * server lists it (a list of (typeID, qty)).
 */
export async function fitFitting(
  act: Ask,
  shipID: number,
  shipTypeID: number,
  itemsToFit: Readonly<Record<number, readonly number[]>>,
  locationID: number,
  parts: FittingParts,
  cargoItemsByType: Readonly<Record<number, number>>,
  fitRigs: boolean,
): Promise<{ readonly typeID: number; readonly qty: number }[]> {
  const items = Object.fromEntries(Object.entries(itemsToFit).map(([typeID, itemIDs]) => [typeID, [...itemIDs]]));
  const plain = (record: Readonly<Record<number, number>>): Record<string, number> => ({ ...record });
  const answer = await act("invbroker", "FitFitting", [
    shipID, shipTypeID, items, locationID,
    {
      chargesByType: plain(parts.chargesByType), dronesByType: plain(parts.dronesByType), fightersByTypeID: plain(parts.fightersByTypeID),
      iceByType: plain(parts.iceByType), modulesByFlag: plain(parts.modulesByFlag), implantsByTypeID: plain(parts.implantsByTypeID),
    },
    plain(cargoItemsByType), fitRigs,
  ], null, shipID);
  const failed: { typeID: number; qty: number }[] = [];
  for (const entry of sequence(answer)) {
    const [typeID, qty] = sequence(entry);
    const type = wholeNumber(typeID);
    const count = wholeNumber(qty);
    if (type !== null && type > 0 && count !== null) failed.push({ typeID: type, qty: count });
  }
  return failed;
}
