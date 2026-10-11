// A place in space bookmarked by the page itself (the plan's Phase 6b).
//
// Until 2026-10-11 it was one route of the BFF (POST /api/bridge/flight/bookmark-location).
//
// THE CALL, as the client makes it (bookmarkSvc.ACLBookmarkLocation, 609 to 620), from the bookmark's window
// (bookmarkLocationWindow.Confirm, 211: a name of nothing is refused there, and a tab in it is made a space):
//
//   bp = sm.StartService('michelle').GetRemotePark()
//   bp.BookmarkLocation(itemID, folderID, name, comment, expiry, subfolderID=subfolderID)
//
// on the ballpark's own object, the subfolder by keyword every time and None where there is none. With no
// ballpark the client says it must be in flight and asks nothing. A region, a constellation, a system, a station
// or a structure is not asked of the park at all: accessGroupBookmarkMgr's BookmarkStaticLocation is (613), which
// the page does not ask. The thing is the pilot's own ship for "save location"
// (addressbookService.BookmarkCurrentLocation, 394), or anything on the grid, from its menu. No Tranquility
// recording has a bookmark made.
//
// THE PAGE ASKS IT OF BEYONCE BY ITS NAME, as it asks the park's other calls: the game port makes it on the
// park's object, and refuses it for a pilot with none (src/gamePort/retailCalls.js, ON_THE_PARK).
//
// WHAT THE SERVER TAKES FROM THE CALLER: the thing, which it looks for in the session's own scene (the pilot's
// ship, or another thing there; BookmarkNotAvailable otherwise), and the folder, which the session's own
// character must be able to write to (BookmarkFolderNoLongerThere, FolderAccessDenied, FolderCapacityExceeded,
// BookmarkSubfolderNoLongerThere). It answers the bookmark as eight values, its number first.
//
// ⚠ THE ANSWER IS NOT WHAT A CALLER GOES BY. The page's one caller reads its bookmarks again and looks for the
// bookmark there (nav/siteLogisticsBookmark.ts).

import type { Ask } from "./ask.ts";
import { unwrapLong } from "./wire.ts";

/** bookmarkConst: how long a bookmark is kept for. */
export const BOOKMARK_EXPIRY = Object.freeze({ none: 0, fourHours: 1, twoDays: 2, oneDay: 3 } as const);

const anID = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
/** idCheckers.IsRegion, IsConstellation, IsSolarSystem and IsStation, by the number alone. */
const isStaticPlace = (itemID: number): boolean => (itemID >= 10_000_000 && itemID <= 39_999_999) || (itemID >= 60_000_000 && itemID <= 63_999_999);

/**
 * Bookmarks where the thing `itemID` is in space, in the folder `folderID`, kept for `expiry` (one of
 * BOOKMARK_EXPIRY). Asks nothing for what the client asks nothing for. Answers the new bookmark's number, or null
 * where the answer names none. Fails as the call fails.
 */
export async function bookmarkLocation(act: Ask, itemID: number, folderID: number, name: string, comment: string, expiry: number, subfolderID: number | null = null): Promise<number | null> {
  if (!anID(itemID)) {
    throw new Error("There is nothing there to bookmark.");
  }
  if (isStaticPlace(itemID)) {
    throw new Error("A station, a system, a constellation or a region is not bookmarked this way.");
  }
  if (!anID(folderID)) {
    throw new Error("That is no bookmark folder.");
  }
  const label = name.replace(/\t/g, " ");
  if (label.trim() === "") {
    throw new Error("A bookmark needs a name.");
  }
  if (!(Object.values(BOOKMARK_EXPIRY) as number[]).includes(expiry)) {
    throw new Error("That is no time to keep a bookmark for.");
  }
  if (subfolderID !== null && !anID(subfolderID)) {
    throw new Error("That is no bookmark subfolder.");
  }
  const answer = await act("beyonce", "BookmarkLocation", [itemID, folderID, label, comment, expiry], { subfolderID });
  const made = Array.isArray(answer) ? unwrapLong(answer[0]) : null;
  return made !== null && made > 0n && made <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(made) : null;
}
