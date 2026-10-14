// Ore and items reprocessed at the refinery of where the pilot is docked, by the page itself (the plan's Phase 6b).
//
// Until 2026-10-14 this was one route of the BFF (POST /api/bridge/reprocessing/reprocess), which read where each
// item lay, made one call for each place on the refinery's object, and read the places again where an answer did
// not say what it had reprocessed.
//
// THE CALL, as the client makes it (reprocessing/ui/itemReprocessor.py, Reprocess 13 to 41 and _DoReprocess 70 to
// 71), from the reprocessing window's Reprocess (controller.py 78 to 82):
//
//   self.reprocessingSvc.GetReprocessingSvc().Reprocess(itemIDs, fromLocation, ownerID, outputLocationID,
//                                                       outputFlagID)
//
// on the refinery's object for where the pilot is docked, Moniker('reprocessingSvc', session.structureid or
// session.stationid); one call for each place the items lie in (the hangar's are of the station or structure, a
// hold's of the ship), the items a list; the output the window names, the hangar of where the pilot is docked
// (reprocessingWnd.py 344 to 367), with the pilot as its owner there. The ship the pilot is in is never reprocessed
// (CannotReprocessActive, 43 to 46). It answers the items it reprocessed and what they made by type; the window
// goes by the first (controller.py 78 to 82).
//
// THE PAGE ASKS IT OF THE REFINERY BY ITS NAME, and names no object: the BFF binds the refinery of where the pilot
// is docked, as its route bound it (bridgeCallPolicy.js, PAGE_OBJECT_CALLS: "refinery").

import type { Ask } from "./ask.ts";
import { isListValue, unwrapLong, type JsonValue } from "./wire.ts";

/** inventorycommon/const.py: flagHangar. */
const FLAG_HANGAR = 4;

/** Where what is made goes: the hangar of where the pilot is docked, the pilot's own. */
export interface RefineryOutput {
  readonly dockedAt: number;
  readonly ownerID: number;
}

/** The items a Reprocess answered as reprocessed: the first of its two. Null where the answer is no such thing. */
export function reprocessedOf(answer: JsonValue): ReadonlySet<number> | null {
  const first = Array.isArray(answer) && answer.length === 2 ? answer[0] : null;
  const items: readonly JsonValue[] | null = isListValue(first) ? first.items : Array.isArray(first) ? first : null;
  if (items === null) return null;
  const ids = items.map((each) => Number(unwrapLong(each) ?? Number.NaN));
  return ids.every((id) => Number.isSafeInteger(id) && id > 0) ? new Set(ids) : null;
}

/**
 * Reprocesses the items, one call for each place they lie in (`places`: each item's place), the output the hangar
 * of where the pilot is docked. The ship the pilot is in is refused before anything is asked, and an item of no
 * place known is asked of nobody. Answers, for each place asked, the items it said it reprocessed (null where its
 * answer did not say) beside the items asked. Fails as a call fails.
 */
export async function reprocess(
  act: Ask,
  itemIDs: readonly number[],
  places: ReadonlyMap<number, number>,
  activeShipID: number | null,
  output: RefineryOutput,
): Promise<readonly { readonly asked: readonly number[]; readonly said: ReadonlySet<number> | null }[]> {
  if (activeShipID !== null && itemIDs.includes(activeShipID)) {
    throw Object.assign(new Error("The ship you are flying cannot be reprocessed."), { code: "CannotReprocessActive" });
  }
  const byPlace = new Map<number, number[]>();
  for (const itemID of new Set(itemIDs)) {
    const place = places.get(itemID);
    if (place !== undefined) byPlace.set(place, [...(byPlace.get(place) ?? []), itemID]);
  }
  const outcomes: { readonly asked: readonly number[]; readonly said: ReadonlySet<number> | null }[] = [];
  for (const [place, asked] of byPlace) {
    const answer = await act("reprocessingSvc", "Reprocess", [asked, place, output.ownerID, output.dockedAt, FLAG_HANGAR]);
    outcomes.push({ asked, said: reprocessedOf(answer) });
  }
  return outcomes;
}
