// A pilot's bookmarks, read by whoever wants them (the plan's Phase 6b).
//
// Until 2026-10-11 the page asked one route of the BFF (GET /api/bridge/bookmarks), which made two calls (the
// pilot's bookmarks and the folders it administers; a third where a folder was named) and of which the page read
// the bookmarks alone.
//
// THE CALL, as the client makes it (bookmarkSvc.ACLPrimeBookmarks, 157 to 176):
//
//   folders, bookmarks, subfolders = self.accessGroupBookmarkMgr.GetMyActiveBookmarks()
//
// of the bookmark manager by its name, nothing sent. Recorded on Tranquility so, in five recordings. It answers
// three lists for the session's own character: the folders it has active, the bookmarks in them, and their
// subfolders.
//
// WHAT IS KEPT. The client asks once in a session and keeps the three, changing what it keeps as it makes,
// changes and deletes a bookmark itself, and as the server tells it a shared folder changed
// (OnSharedBookmarksFolderUpdated and its fellows). The page keeps nothing: it asks each time it wants them.
//
// AN ANSWER THAT IS NOT THE THREE LISTS IS NOT "NO BOOKMARKS". The route answered a read that had failed with
// nothing and a code beside it, and the page read nothing as no bookmarks: a bot's warp to a saved spot was told
// the spot was not in its list, and stopped. The read fails as the call fails, and says so where the answer is
// not the three lists.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";
import { decodeActiveBookmarks, type ActiveBookmarks } from "./bookmarks.ts";

/**
 * The pilot's active folders, the bookmarks in them and their subfolders, as the server lists them. Fails as the
 * call fails; and where the server's answer is not its three lists, which is no list of bookmarks at all.
 */
export async function readMyActiveBookmarks(ask: Ask): Promise<ActiveBookmarks> {
  const answered = await ask("accessGroupBookmarkMgr", "GetMyActiveBookmarks", []);
  if (!Array.isArray(answered) || answered.length !== 3) {
    throw new Error("Your bookmarks could not be read (the server did not answer with its three lists).");
  }
  return decodeActiveBookmarks(answered);
}
