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
//   a module unfitted   fittingSlotController.UnfitModule (217 to 243). Docked, the hangar's inventory:
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
import { slotFlagOf } from "./fitting.ts";
import type { JsonValue } from "./wire.ts";

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
 * Fits a module from the hangar or from the ship's own hold, into a slot or wherever the server picks ("auto").
 * Answers whether the slots say it landed. Fails as the call fails.
 */
export async function fitModule(
  act: Ask,
  fitted: FittedNow,
  place: FittingPlace,
  itemID: number,
  source: "hangar" | "cargo",
  slot: { readonly family: SlotFamily; readonly index: number } | "auto",
): Promise<{ readonly applied: boolean }> {
  const flag = slot === "auto" ? FLAG_AUTO_FIT : slotFlagOf(slot.family, slot.index);
  if (flag === null) throw new Error("That is not a slot this ship has.");
  if (source === "hangar" && place.dockedAt === null) throw new Error("The hangar is at hand only while docked.");
  const liesIn = source === "cargo" ? place.shipID : place.dockedAt!;
  const before = await fitted();
  if (flag === FLAG_AUTO_FIT) await act("invbroker", "MultiAdd", [[itemNumber(itemID)], liesIn], { flag }, place.shipID);
  else await act("invbroker", "Add", [itemNumber(itemID), liesIn], { qty: 1, flag }, place.shipID);
  return { applied: fitLanded(before, await fitted(), itemID) };
}

/**
 * Unfits a module where the client's Unfit puts it: the hangar of where the pilot is docked, and the ship's own
 * hold in space (fittingSlotController.UnfitModule, 237 to 241: `if session.stationid or session.structureid`).
 * Answers whether the slots say it is gone. Fails as the call fails.
 */
export async function unfitModule(
  act: Ask,
  fitted: FittedNow,
  place: FittingPlace,
  itemID: number,
): Promise<{ readonly applied: boolean }> {
  if (place.dockedAt !== null) {
    await act("invbroker", "Add", [itemNumber(itemID), place.shipID], { flag: FLAG_HANGAR }, THE_HANGAR);
  } else {
    await act("invbroker", "Add", [itemNumber(itemID), place.shipID], { qty: null, flag: FLAG_CARGO }, place.shipID);
  }
  return { applied: !(await fitted()).has(itemID) };
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
