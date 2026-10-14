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

import type { Ask } from "./ask.ts";

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
