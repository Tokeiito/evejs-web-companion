// Ore compressed in space (the plan's Phase 6b).
//
// Until 2026-10-14 this was one route of the BFF (POST /api/bridge/mining/compress), which read that the pilot was
// in space, held the call to the ship and the system a hosted bot had observed where it said them, and made the call.
//
// THE CALL, as the client makes it (itemcompression/client/itemCompression.py, CompressItemInSpace, 7 to 15), from
// an item's menu when a compression facility is on the grid (menusvc.py 3403) and from the compression window:
//
//   sm.RemoteSvc('inSpaceCompressionMgr').CompressItemInSpace(compressibleItem.itemID, compressionFacilityBallID)
//
// the stack and the ball of the ship running the compression, its own or another's. It answers None where nothing
// was compressed, and otherwise the six of it: the stack's itemID, typeID and quantity, and what it was made into,
// its itemID, typeID and quantity, which the client tells the pilot. No Tranquility recording has it.
//
// THE PAGE ASKS IT OF THE SERVICE BY ITS NAME, as the client does, on either transport.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the stack and the facility's ball. It acts for the session's own ship and
// answers None for a facility not in range or not running its compression, a stack not the pilot's, and an ore with
// no compressed form alike: the answer does not say which.

import { isListValue, unwrapLong, type JsonValue } from "./wire.ts";
import type { Ask } from "./ask.ts";

/** What one compression made, as the server answers it. */
export interface Compressed {
  readonly sourceItemID: number;
  readonly sourceTypeID: number;
  readonly sourceQuantity: number;
  readonly outputItemID: number;
  readonly outputTypeID: number;
  readonly outputQuantity: number;
}

/** The server's six, or null where it answered None (or anything that is not the six). */
export function decodeCompressed(result: JsonValue): Compressed | null {
  // A tuple comes as a bare array, as the jettison's answer does (bridge/shipWrites.ts).
  const items: readonly JsonValue[] | null = Array.isArray(result) ? result : isListValue(result) ? result.items : null;
  if (items === null || items.length !== 6) return null;
  const numbers = items.map((each) => Number(unwrapLong(each) ?? Number.NaN));
  if (!numbers.every((each) => Number.isSafeInteger(each))) return null;
  const [sourceItemID, sourceTypeID, sourceQuantity, outputItemID, outputTypeID, outputQuantity] = numbers as [number, number, number, number, number, number];
  return { sourceItemID, sourceTypeID, sourceQuantity, outputItemID, outputTypeID, outputQuantity };
}

/**
 * Compresses the stack `itemID` at the facility ship `facilityBallID`. Answers the server's answer as it came: None
 * where nothing was compressed. Fails as the call fails.
 */
export async function compressItemInSpace(act: Ask, itemID: number, facilityBallID: number): Promise<JsonValue> {
  if (!Number.isSafeInteger(itemID) || itemID <= 0 || !Number.isSafeInteger(facilityBallID) || facilityBallID <= 0) {
    throw new Error("That stack or that compression ship could not be identified.");
  }
  return act("inSpaceCompressionMgr", "CompressItemInSpace", [itemID, facilityBallID]);
}
