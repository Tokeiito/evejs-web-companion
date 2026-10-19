// A module fitted and unfitted by the page itself (the plan's Phase 6b): the first of the page's own calls on an
// inventory's own object.
//
// Until 2026-10-13 each was a route of the BFF (POST /api/bridge/fitting/fit and .../unfit), which named the
// slot's flag from a family and a place in it, read the ship's slots, made the one call on the inventory it had
// bound, and read the slots again for its verdict.
//
// AN INVENTORY'S OWN OBJECT. The client asks an inventory by the thing it is of: invCache.GetInventoryFromId(itemID)
// is a ship's, a container's or a customs office's, and invCache.GetInventory(const.containerHangar) is the hangar
// of where the pilot is docked. What either answers is an object, and Add and the rest are asked of it. The page
// says which with `of`: a thing's number, or THE_HANGAR; the BFF binds it as its routes bound it, and holds none
// for the page (bridgeCallPolicy.js, PAGE_OBJECT_CALLS: "inventory").
//
// THE CALLS, as the client makes them:
//
//   a module fitted     clientDogmaLocation.TryFit (669 to 673), the ship's own inventory:
//                         shipInv = invCache.GetInventoryFromId(shipID, locationID=session.stationid)
//                         shipInv.Add(item.itemID, item.locationID, qty=1, flag=flagID)
//                       the item, the place it lies in (the station or structure for the hangar, the ship for its
//                       hold), one of it, and the slot's flag.
//   fitted anywhere     fittingUtil.TryFit (117 to 157) and the fitting screen's FitModule (tryFit.py 125 to 135),
//                       on the ship's own inventory and past invCache's own Add:
//                         shipInv.moniker.MultiAdd(itemIDs, sourceID, flag=const.flagAutoFit)
//                       a list of the items, the place they lie in, and the server to pick each a slot.
//   a module unfitted   fittingSlotController.UnfitModule (217 to 243). A module in a weapon bank asks its pilot
//                       first (ClearGroupModule, Yes and No, Yes kept where the pilot says not to be asked again),
//                       and on Yes takes one module out of the bank (UngroupModule, clientDogmaLocation 784:
//                         remoteDogmaLM.UnlinkModule(shipID, masterID)
//                       which answers the slave the server took out; the client's own banks lose it, and the bank
//                       where none is left); a module with a charge has it unloaded (UnfitCharge, 169 to 188:
//                         remoteDogmaLM.UnloadAmmo(shipID, [moduleID], destination)
//                       the bank's master where the module is still in a bank, to the hangar docked and the ship's
//                       hold in space). Then, docked, the hangar's inventory:
//                         invCache.GetInventory(const.containerHangar).Add(moduleID, shipID, flag=const.flagHangar)
//                       and in space, the ship's own:
//                         shipInv.Add(moduleID, shipID, qty=None, flag=const.flagCargo)
//
// The flags are the client's own (inventorycommon/const.py, read from the compiled module): flagAutoFit 0,
// flagHangar 4, flagCargo 5, and a slot's from bridge/fitting.ts (low 11 to 18, mid 19 to 26, high 27 to 34, rigs
// from 92, subsystems from 125). No Tranquility recording has a module fitted by a slot's own call; the one
// recorded move into a slot was followed by the client's onlining of it (bridge/dogmaWrites.ts).
//
// WHAT THE SERVER TAKES FROM THE CALLER: the inventory (any thing's number), the item, the place it is said to lie
// in, the flag. It refuses a thing that is another pilot's (FakeItemNotFound: asked live on 2026-10-13, one pilot's
// stack by another in the same station), a place that is not the item's, a module the ship will not take
// (ModuleFitFailed and the fitting's own refusals), and a structure's fitting service that is not open.
//
// ⚠ THE ANSWER IS NOT WHAT THE PAGE GOES BY. The server moves nothing and says nothing for a module the pilot has
// not the skill for, so the slots are read before and after. A module fitted out of a stack is a new row with a
// number the page never saw: the verdict of a fitting is the item in a slot, or a slot filled that was empty.

import type { SlotFamily } from "../store/types.ts";
import type { Ask } from "./ask.ts";
import { unloadAmmo, type AmmoSession } from "./dogmaWrites.ts";
import { slotFlagOf } from "./fitting.ts";
import type { JsonValue } from "./wire.ts";
import { unwrapLong } from "./wire.ts";

/** invConst.flagAutoFit, flagHangar and flagCargo. */
const FLAG_AUTO_FIT = 0;
const FLAG_HANGAR = 4;
const FLAG_CARGO = 5;

/** `of`, for the hangar of where the pilot is docked: invCache.GetInventory(const.containerHangar). */
export const THE_HANGAR = "hangar";

/** The ship a module is fitted to, and where the pilot is docked (null in space). */
export interface FittingPlace {
  readonly shipID: number;
  readonly dockedAt: number | null;
}

/** The modules fitted to the ship now, each by its own number, with a name for the slot it is in. */
export type FittedNow = () => Promise<ReadonlyMap<number, string>>;

function itemNumber(itemID: number): number {
  if (!Number.isSafeInteger(itemID) || itemID <= 0) throw new Error("That module could not be identified.");
  return itemID;
}

/** Did a fitting land: the item is in a slot, or a slot is filled that was empty before. */
function fitLanded(before: ReadonlyMap<number, string>, after: ReadonlyMap<number, string>, itemID: number): boolean {
  if (after.has(itemID)) return true;
  const filledBefore = new Set(before.values());
  return [...after.values()].some((slot) => !filledBefore.has(slot));
}

/**
 * Fits a module from the hangar or from the ship's own hold, into a slot or wherever the server picks ("auto"); or
 * one fitted already into another slot ("slot": dropped on it, the fitting slot's FitModule, TryFit with the item
 * where it lies, the ship). Answers whether the slots say it landed. Fails as the call fails.
 */
export async function fitModule(
  act: Ask,
  fitted: FittedNow,
  place: FittingPlace,
  itemID: number,
  source: "hangar" | "cargo" | "slot",
  slot: { readonly family: SlotFamily; readonly index: number } | "auto",
): Promise<{ readonly applied: boolean }> {
  const flag = slot === "auto" ? FLAG_AUTO_FIT : slotFlagOf(slot.family, slot.index);
  if (flag === null) throw new Error("That is not a slot this ship has.");
  if (source === "hangar" && place.dockedAt === null) throw new Error("The hangar is at hand only while docked.");
  const liesIn = source === "hangar" ? place.dockedAt! : place.shipID;
  const before = await fitted();
  if (flag === FLAG_AUTO_FIT) await act("invbroker", "MultiAdd", [[itemNumber(itemID)], liesIn], { flag }, place.shipID);
  else await act("invbroker", "Add", [itemNumber(itemID), liesIn], { qty: 1, flag }, place.shipID);
  return { applied: fitLanded(before, await fitted(), itemID) };
}

/** dogma/const.py dgmGroupableGroupIDs (1754): the weapons that group, turrets and launchers, inventorycommon's numbers. */
export const GROUPABLE_GROUP_IDS: ReadonlySet<number> = new Set([53, 55, 74, 56, 511, 524, 1674, 1673, 506, 512, 510, 771, 507, 508, 509, 1245, 1328, 1562, 1327]);

/** eveCfg.py 406 to 457, cfg.__chargecompatiblegroups__: the modules a charge is loaded into (the slot's IsChargeable). */
export const CHARGEABLE_GROUP_IDS: ReadonlySet<number> = new Set([
  483, 53, 55, 56, 76, 74, 481, 317, 862, 506, 512, 511, 508, 510, 771, 507, 509, 524, 1674, 1673, 501, 4807, 589, 212, 1332,
  290, 208, 213, 291, 209, 899, 1156, 1199, 1226, 1245, 646, 1396, 1328, 1549, 1562, 1327, 1699, 1700, 1697, 1698, 1770,
  1442, 1974, 1986, 2013, 4060, 1330,
]);

/** A ship's weapon banks as the page's dogma location holds them: each master with its slaves. */
export type WeaponBanks = ReadonlyMap<number, readonly number[]>;

/** baseDogmaLocation.GetMasterModuleID: the master of the bank a module is a slave in, or null. */
function masterOf(banks: WeaponBanks, moduleID: number): number | null {
  for (const [masterID, slaves] of banks) if (slaves.includes(moduleID)) return masterID;
  return null;
}

/** clientDogmaLocation.IsInWeaponBank: the module where it is a bank's master, its master where it is a slave, else null. */
export function weaponBankOf(banks: WeaponBanks, moduleID: number): number | null {
  return banks.has(moduleID) ? moduleID : masterOf(banks, moduleID);
}

/** The module a slot unfits: its number, and whether a charge is loaded in it (the slot's GetCharge). */
export interface SlotModule {
  readonly itemID: number;
  readonly charged: boolean;
}

/**
 * Unfits a module as the client's UnfitModule does: a module in a weapon bank asked of the pilot first and taken out
 * of its bank on Yes, its charge unloaded, and the module put where the client puts it, the hangar of where the pilot
 * is docked and the ship's own hold in space (fittingSlotController.UnfitModule, 217 to 243: `if session.stationid
 * or session.structureid`). Answers whether the slots say it is gone, and nothing where the pilot answered No. Fails
 * as a call fails.
 */
export async function unfitModule(
  act: Ask,
  fitted: FittedNow,
  place: AmmoSession,
  module: SlotModule,
  banks: WeaponBanks,
  clearGroup: () => Promise<boolean>,
): Promise<{ readonly applied: boolean } | undefined> {
  const itemID = module.itemID;
  const masterID = weaponBankOf(banks, itemID);
  let held = banks;
  if (masterID !== null) {
    if (!(await clearGroup())) return undefined;
    const answered = await act("dogmaIM", "UnlinkModule", [place.shipID, masterID]);
    const slaveID = typeof answered === "number" ? answered : Number(unwrapLong(answered));
    held = new Map([...banks].flatMap(([id, slaves]): [number, readonly number[]][] => {
      if (id !== masterID) return [[id, slaves]];
      const left = slaves.filter((slave) => slave !== slaveID);
      return left.length > 0 ? [[id, left]] : [];
    }));
  }
  // UnfitCharge: GetMasterModuleForFlag where the module is still in a bank, the module itself where it is not.
  if (module.charged) await unloadAmmo(act, place, [masterOf(held, itemID) ?? itemID], place.dockedAt !== null ? "hangar" : "cargo");
  if (place.dockedAt !== null) {
    await act("invbroker", "Add", [itemNumber(itemID), place.shipID], { flag: FLAG_HANGAR }, THE_HANGAR);
  } else {
    await act("invbroker", "Add", [itemNumber(itemID), place.shipID], { qty: null, flag: FLAG_CARGO }, place.shipID);
  }
  return { applied: !(await fitted()).has(itemID) };
}

/**
 * A fitted module put into the ship's cargo, as the client's dogma location puts it there (UnloadModuleToContainer,
 * 1077 to 1104), with the ship for the container and the cargo's flag: a module dragged off its slot and dropped on
 * the fitting window's cargo readout (minihangar CargoCargoSlots.OnDropData, 288) or on the ship's cargo hold
 * (invCtrl.ShipCargo, invControllers 514). A module in a weapon bank asks its pilot first (ClearGroupModule), and on
 * Yes the bank is broken up (DestroyWeaponBank(shipID, the bank's master)); then, charge or none,
 *
 *   remoteDogmaLM.UnloadAmmo(shipID, the bank's master or the module, shipID)
 *   shipInv.Add(moduleID, shipID, qty=None, flag=const.flagCargo)
 *
 * which is what Tranquility recorded (a module from a mid slot: UnloadAmmo(ship, module, ship), riding the dogma
 * location's bind, then the Add on the ship's inventory). Answers whether the slots say it is gone, and nothing where
 * the pilot answered No. Fails as a call fails.
 */
export async function unloadModuleToCargo(
  act: Ask,
  fitted: FittedNow,
  place: AmmoSession,
  itemID: number,
  banks: WeaponBanks,
  clearGroup: () => Promise<boolean>,
): Promise<{ readonly applied: boolean } | undefined> {
  return unloadModuleToContainer(act, fitted, place, itemID, banks, clearGroup, { inventory: place.shipID, containerItemID: place.shipID, flag: FLAG_CARGO });
}

/**
 * Where UnloadModuleToContainer (1077 to 1104) puts a module: the container's inventory (`containerArgs`: the ship's,
 * the hangar's binding, a container's), its item (containerInv.GetItem(), which UnloadAmmo names), the container's flag
 * (its controller's locationFlag, None for a container), and, for an audit log secure container named with no flag,
 * the owner UnloadAmmo names with it (1089 to 1095: the corporation where the container is the corporation's).
 */
export interface ModuleDestination {
  readonly inventory: number | typeof THE_HANGAR;
  readonly containerItemID: number;
  readonly flag: number | null;
  readonly auditLogOwnerID?: number | null;
}

/**
 * A fitted module put into a container as the client's dogma location puts it (UnloadModuleToContainer, 1077 to 1104):
 * a module in a weapon bank asks its pilot first (ClearGroupModule) and on Yes the bank is broken up; then, charge or
 * none, UnloadAmmo(shipID, the bank's master or the module, the container's item) (for an audit log secure container
 * named with no flag, (the container, its owner, None)); then the container's inventory's Add of it from the ship:
 * the ship's own or one with a flag with qty=None and the flag, else with nothing named (1097 to 1103). The cargo
 * (unloadModuleToCargo) is the ship with flagCargo, as Tranquility recorded it. Answers whether the slots say it is
 * gone, and nothing where the pilot answered No. Fails as a call fails.
 */
export async function unloadModuleToContainer(
  act: Ask,
  fitted: FittedNow,
  place: AmmoSession,
  itemID: number,
  banks: WeaponBanks,
  clearGroup: () => Promise<boolean>,
  destination: ModuleDestination,
): Promise<{ readonly applied: boolean } | undefined> {
  let masterModuleID: number | null = null;
  if (weaponBankOf(banks, itemID) !== null) {
    if (!(await clearGroup())) return undefined;
    masterModuleID = masterOf(banks, itemID) ?? itemID;
    await act("dogmaIM", "DestroyWeaponBank", [place.shipID, masterModuleID]);
  }
  const unloaded = masterModuleID ?? itemNumber(itemID);
  if (destination.auditLogOwnerID !== undefined && destination.auditLogOwnerID !== null && destination.flag === null) {
    await act("dogmaIM", "UnloadAmmo", [place.shipID, unloaded, [destination.containerItemID, destination.auditLogOwnerID, null]]);
  } else {
    await act("dogmaIM", "UnloadAmmo", [place.shipID, unloaded, destination.containerItemID]);
  }
  if (destination.inventory === place.shipID || destination.flag !== null) {
    await act("invbroker", "Add", [itemNumber(itemID), place.shipID], { qty: null, flag: destination.flag }, destination.inventory);
  } else {
    await act("invbroker", "Add", [itemNumber(itemID), place.shipID], null, destination.inventory);
  }
  return { applied: !(await fitted()).has(itemID) };
}

/**
 * One fitted weapon grouped with another by a drop on its slot with Shift held (the fitting slot's LinkWithWeapon,
 * clientDogmaLocation.LinkWeapons 751 to 782, merge as it is given there): onto the bank of the slot dropped on, its
 * master where it is in one, else the module itself; the one dragged by itself LinkWeapons(shipID, master, it), as
 * Tranquility recorded it, and one in a bank MergeModuleGroups(shipID, master, the master of its bank). The answer is
 * the ship's banks, which the transport keeps. The client's own refusals before it asks are its caller's.
 */
export async function linkWeapons(act: Ask, place: AmmoSession, toID: number, fromID: number, banks: WeaponBanks, merge = true): Promise<void> {
  if (toID === fromID) return;
  const masterID = masterOf(banks, toID) ?? toID;
  const inBank = weaponBankOf(banks, fromID);
  // 772 to 776: a module dragged that is in a bank brings its bank (MergeModuleGroups), or, not merging (the HUD's
  // drag with Shift held), is peeled off it and linked alone (PeelAndLink).
  if (inBank !== null) await act("dogmaIM", merge ? "MergeModuleGroups" : "PeelAndLink", [place.shipID, masterID, inBank]);
  else await act("dogmaIM", "LinkWeapons", [place.shipID, masterID, itemNumber(fromID)]);
}

/**
 * The charge in a slot put into the ship's cargo, as the client's dogma location puts it there
 * (UnloadAmmoToContainer, 1106 to 1134), with (the ship, the pilot, the cargo's flag) for where: a slot's charge
 * dragged off it and dropped on the fitting window's cargo readout (minihangar 290) or on the ship's cargo hold
 * (invControllers 517). The module is the one in the charge's slot (the ship's listing of that flag, the item that is
 * not the charge), its bank's master where it is a slave in one, and no quantity is named (None: all of it):
 *
 *   remoteDogmaLM.UnloadAmmo(shipID, moduleID, (shipID, charID, const.flagCargo), None)
 *
 * It answers the stacks the charges went to (what the client's FitCharges loads from next: itemID[0]). The cargo too
 * full for a bank's charges (NotEnoughCargoSpace, unloading through a master) is said by the client's own
 * NotEnoughCargoSpaceToUnloadBank, which this answers as "bankWithoutRoom"; any other refusal fails as the call fails.
 */
export async function unloadChargeToCargo(
  act: Ask,
  place: AmmoSession,
  moduleID: number,
  banks: WeaponBanks,
  isNoRoom: (error: unknown) => boolean,
): Promise<{ readonly kind: "unloaded"; readonly stackIDs: readonly number[] } | { readonly kind: "bankWithoutRoom" }> {
  return unloadChargeToContainer(act, place, moduleID, banks, isNoRoom, [place.shipID, place.characterID, FLAG_CARGO]);
}

/**
 * The charge in a slot put into a container as UnloadAmmoToContainer (1106 to 1134) puts it: `destination` is the
 * client's (the container's first argument, the owner, its flag): the ship, the pilot and a hold's flag; the hangar's
 * (const.containerHangar, the pilot, flagHangar: AddItems 515 to 517); a container's own, its owner and None. The rest
 * as unloadChargeToCargo.
 */
export async function unloadChargeToContainer(
  act: Ask,
  place: AmmoSession,
  moduleID: number,
  banks: WeaponBanks,
  isNoRoom: (error: unknown) => boolean,
  destination: readonly [number, number, number | null],
): Promise<{ readonly kind: "unloaded"; readonly stackIDs: readonly number[] } | { readonly kind: "bankWithoutRoom" }> {
  const masterID = masterOf(banks, itemNumber(moduleID));
  let answered;
  try {
    answered = await act("dogmaIM", "UnloadAmmo", [place.shipID, masterID ?? moduleID, [...destination], null]);
  } catch (error) {
    if (masterID !== null && isNoRoom(error)) return { kind: "bankWithoutRoom" };
    throw error;
  }
  const listed = Array.isArray(answered) ? answered : answered && typeof answered === "object" && Array.isArray((answered as { items?: unknown }).items) ? (answered as { items: readonly unknown[] }).items : [];
  const stackIDs = listed.map((id) => (typeof id === "number" ? id : Number(unwrapLong(id)))).filter((id) => Number.isSafeInteger(id) && id > 0);
  return { kind: "unloaded", stackIDs };
}

/**
 * A RIG DESTROYED (the plan's Phase 6b): until 2026-10-14 a route of the BFF's (POST /api/bridge/fitting/destroy-rig),
 * which read the slots for the rig, made the call on the ship's inventory and read the slots again. The client's
 * Unfit of a rig (fittingSlotController.Unfit, 245 to 266), where the ship cannot take one off whole
 * (CanUnfitRigsWithoutDestroying, 268 to 272), tells the pilot and asks (the RigUnFittingInfo dialog, OK / Cancel),
 * and on OK makes
 *
 *   parentInv = invCache.GetInventoryFromId(parentID, locationID=session.stationid)
 *   parentInv.DestroyFitting(self.GetModuleID())
 *
 * on the ship's own inventory. The server (fittingOperations.Handle_DestroyFitting) answers None whatever it did,
 * refuses what is not in a rig slot, holds the ship to the session's access to it, and refuses a cargo rig whose
 * going would leave the hold over full. A ship that can take its rigs off whole (ShipCanUnfitRigs) has them unfitted
 * instead, which the page does not ask yet: it destroys.
 *
 * Held to a rig before the call, as the route held it: the slots are read, and a module in no rig slot is refused.
 * Answers whether the slots say it is gone. Fails as the call fails.
 */
export async function destroyRig(
  act: Ask,
  fitted: FittedNow,
  place: FittingPlace,
  itemID: number,
): Promise<{ readonly applied: boolean }> {
  const slot = (await fitted()).get(itemNumber(itemID));
  if (slot === undefined || !slot.startsWith("rig:")) {
    throw new Error("That module is not a rig on the active ship; unfit it instead.");
  }
  await act("invbroker", "DestroyFitting", [itemID], null, place.shipID);
  return { applied: !(await fitted()).has(itemID) };
}

/**
 * A saved fitting applied to the ship the pilot is in (the plan's Phase 6b): until 2026-10-14 a route of the BFF's
 * (POST /api/bridge/inventory/fit-fitting), which sent the call on the inventory manager's handle. The client
 * (fittingSvc.LoadFitting, 554 to 618) asks it of the ship's own inventory:
 *
 *   shipInv = invCache.GetInventoryFromId(eveCfg.GetActiveShip())
 *   shipInv.FitFitting(activeShip, shipTypeID, itemsToFit, session.stationid or session.structureid,
 *                      fittingObjKeyVal, cargoItemsByType, fitRigs)
 *
 * the hangar's items to fit from by type, the fitting's modules by slot (the game port makes the KeyVal of them,
 * retailCalls.js), what goes in the cargo by type, and whether rigs are fitted. It answers what failed to load.
 * The server refuses a ship that is not the pilot's (FakeItemNotFound: asked live on 2026-10-14, one pilot's module
 * into another's Rifter in the same station). Rigs are left as they are and nothing goes in the cargo: the page's
 * refit names no rig.
 *
 * `aboard` is the fitting's charges and drones by type, the KeyVal's `chargesByType` and `dronesByType`
 * (shipfitting/fitting.py 119): the whole quantity the fitting lists, as the client sends it, and the server moves
 * only what the hold and the bay lack of it (`_fitFittingQuantityItemsToShipBay`). Without it the fitting goes as
 * its modules alone.
 */
export async function applyFitting(
  act: Ask,
  ship: { readonly shipID: number; readonly typeID: number | null },
  dockedAt: number,
  modulesByFlag: Readonly<Record<number, number>>,
  itemsByType: Readonly<Record<number, readonly number[]>>,
  aboard?: {
    readonly chargesByType: Readonly<Record<number, number>>;
    readonly dronesByType: Readonly<Record<number, number>>;
  },
): Promise<void> {
  const shipID = itemNumber(ship.shipID);
  if (!Number.isSafeInteger(dockedAt) || dockedAt <= 0) throw new Error("A fitting is applied only while docked.");
  const items = Object.fromEntries(Object.entries(itemsByType).map(([typeID, itemIDs]) => [typeID, [...itemIDs]]));
  const fitting: JsonValue = aboard === undefined
    ? { ...modulesByFlag }
    : { modulesByFlag: { ...modulesByFlag }, chargesByType: { ...aboard.chargesByType }, dronesByType: { ...aboard.dronesByType } };
  await act("invbroker", "FitFitting", [shipID, ship.typeID, items, dockedAt, fitting, {}, false], null, shipID);
}
