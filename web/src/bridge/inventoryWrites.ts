// An inventory's own writes made by the page itself (the plan's Phase 6b), on an inventory's own object: after a
// module's fitting (bridge/fitModule.ts) and a customs office's transfer (bridge/customsWrites.ts), the
// inventory's own.
//
// A STACK DROPPED ON A STACK. Until 2026-10-13 it was a route of the BFF's (POST /api/bridge/inventory/merge), which
// listed the place, sent MultiMerge on the place's binding and listed it again for its verdict. The client:
//
//   the drop       item.py, an item's OnDropData (958 to 1078): each stack of the same type dropped on this one is
//                  (its itemID, this one's itemID, its whole stack, or a number asked with shift held), and the
//                  source is where the dropped stacks lie (`sourceID = node.rec.locationID`, 1004)
//   the window's   invControllers.MultiMerge (327 to 335): the target's container's own controller hands
//                  [(source, destination, qty), ...] and the source on to its inventory
//   the call       invCache's container's MultiMerge (1100 to 1124): self.moniker.MultiMerge(ops, sourceContainerID)
//                  on the inventory the target is in: the hangar's for a stack in the hangar
//                  (invCache.GetInventory(const.containerHangar)), a thing's own for one in a ship or a container
//
// Recorded on Tranquility once ("Unknown Events Level 2"): in the hangar's container, MultiMerge([(source, target,
// 3822)], 60001717), a list of one tuple and the station the dropped stack lay in.
//
// WHAT THE SERVER TAKES FROM THE CALLER (invBrokerService.Handle_MultiMerge, read 2026-10-13): the stacks named and
// the source; in a hangar it moves nothing of a stack that is not the session's own character's, and a ship's or a
// container's inventory is held to whose it is. It answers nothing whether it merged or not: the page reads the
// place again for its verdict.

//
// ITEMS TRASHED. Until 2026-10-13 a route (POST /api/bridge/inventory/trash), which listed the place, sent TrashItems
// on the inventory manager and listed the place again. The client (invItemFunctions.TrashInvItems, 602 to 626): the
// items must lie in one place, the pilot is asked, each must be of a type that may be trashed, and then
//
//   errors = invCache.GetInventoryMgr().TrashItems(itemsToTrash, locationID)
//
// on the inventory manager of where the session is (eveMoniker.GetInventoryMgr, 122 to 131: the solar system's
// where the session has one, else the station's), not on any inventory's own object. `locationID` is the station or
// structure the first item lies in directly, the office's station for a corporation's item, and otherwise the
// place the item lies in, a ship or a container (invCache.GetStationIDOfItem, 660 to 691). Each error answered is
// shown, and nothing else is done.
//
// WHAT THE SERVER TAKES FROM THE CALLER (invBroker/trash.js, Handle_TrashItems and _isInventoryItemTrashable, read
// 2026-10-13): the session's own character's items, or a director's corporation items in the office here; never
// the ship the pilot is in, a fitted module or anything in space; all of one owner. It answers None, or a list of
// refusals (CannotTrashItem) where it destroys nothing.

import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** `of`, for the hangar of where the pilot is docked: invCache.GetInventory(const.containerHangar). */
const THE_HANGAR = "hangar";

const whole = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Merges one stack into another of its type, in the inventory the target lies in (the hangar's, or a thing's own by
 * its number), the source lying in `sourceLocationID`: the whole of it, as a drop without shift sends.
 */
export async function mergeStacks(
  act: Ask,
  inventory: number | typeof THE_HANGAR,
  sourceLocationID: number,
  sourceItemID: number,
  destinationItemID: number,
  quantity: number,
): Promise<void> {
  if (!whole(sourceItemID) || !whole(destinationItemID) || sourceItemID === destinationItemID) {
    throw new Error("Two different stacks are required to merge.");
  }
  if (!whole(quantity)) throw new Error("A stack's whole quantity is required to merge it.");
  if (!whole(sourceLocationID)) throw new Error("Where that stack lies is not known.");
  await act("invbroker", "MultiMerge", [[[sourceItemID, destinationItemID, quantity]], sourceLocationID], null, inventory);
}

/** The refusals TrashItems answered, as the wire spelled the list; none for an answer of None. */
function refusalsOf(answer: JsonValue): readonly string[] {
  const items = Array.isArray(answer)
    ? answer
    : answer !== null && typeof answer === "object" && Array.isArray((answer as { items?: unknown }).items)
      ? ((answer as { items: JsonValue[] }).items)
      : [];
  return items.map((each) => (typeof each === "string" ? each : JSON.stringify(each)));
}

/**
 * Destroys items that lie in one place, on the inventory manager of where the pilot is, naming the place as the
 * client names it (`locationID`). Fails where the server answers refusals, with the server's own words.
 */
export async function trashItems(act: Ask, itemIDs: readonly number[], locationID: number): Promise<void> {
  if (itemIDs.length === 0 || !itemIDs.every(whole)) throw new Error("At least one item is required.");
  if (!whole(locationID)) throw new Error("Where those items lie is not known.");
  const refusals = refusalsOf(await act("invbroker", "TrashItems", [[...itemIDs], locationID]));
  if (refusals.length > 0) throw new Error(`The server would not destroy those items (${refusals.join(", ")}).`);
}
