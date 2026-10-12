// A shared bookmark folder taken up and switched on by the page itself, as a pilot does in the client's Locations
// panel.
//
// A SHARED FOLDER A PILOT MAY USE IS NOT YET ONE IT SEES. The server lists a pilot's personal folders and the
// shared folders the pilot KNOWS (bookmarkRuntimeState.js, listFolderViews), and hands on the bookmarks of the
// known folders that are ACTIVE alone; a warp to a bookmark asks for an active folder too (beyonceService.js,
// resolveBookmarkAnyStore, requireActive). Access by the folder's groups only makes a folder one the pilot may
// take up.
//
// THE CALLS, as the client makes them:
//
//   self.accessGroupBookmarkMgr.SearchFoldersWithAdminAccess()            (bookmarkSvc.py 715)
//   self.accessGroupBookmarkMgr.AddToKnownFolders(folderID, isActive)     (bookmarkSvc.py 357)
//   self.accessGroupBookmarkMgr.UpdateKnownFolderState(folderID, isActive) (bookmarkSvc.py 483)
//
// by the manager's name. The search is how the client's panel finds a folder to add by its name
// (bookmarksPanel.py 638): it answers the pilot's personal folders and every shared folder the pilot administers.
// Adding a folder is linkedBookmarkFolderWindow.py 173.
//
// THE LIMITS. A pilot may have three shared folders active (appConst.MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS), five
// personal ones (MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS), and know thirty (MAX_KNOWN_BOOKMARK_FOLDERS). The client
// refuses one active past the limit itself before asking (bookmarkSvc.ValidateActiveFolderCount, 506); the server
// refuses it too (TooManyActiveFolders). Adding a folder as active past the limit is NOT refused by this server: it
// adds the folder not active and says nothing (bookmarkRuntimeState.js, addKnownFolder), so the caller reads the
// folders again rather than trust the ask.

import type { Ask } from "./ask.ts";
import { decodeFolderList, type BookmarkFolder } from "./bookmarks.ts";

/** appConst.MAX_ACTIVE_SHARED_BOOKMARK_FOLDERS. */
export const MAX_ACTIVE_SHARED_FOLDERS = 3;
/** appConst.MAX_ACTIVE_PERSONAL_BOOKMARK_FOLDERS. */
export const MAX_ACTIVE_PERSONAL_FOLDERS = 5;
/** appConst.MAX_KNOWN_BOOKMARK_FOLDERS. */
export const MAX_KNOWN_FOLDERS = 30;

const anID = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/** The pilot's personal folders and the shared folders it administers. Fails as the call fails. */
export async function readFoldersWithAdminAccess(ask: Ask): Promise<BookmarkFolder[]> {
  return decodeFolderList(await ask("accessGroupBookmarkMgr", "SearchFoldersWithAdminAccess", []));
}

/** Takes up the shared folder `folderID`, active or not. Fails as the call fails. */
export async function addToKnownFolders(act: Ask, folderID: number, isActive: boolean): Promise<void> {
  if (!anID(folderID)) {
    throw new Error("That is no bookmark folder.");
  }
  await act("accessGroupBookmarkMgr", "AddToKnownFolders", [folderID, isActive]);
}

/** Switches the known folder `folderID` on or off. Fails as the call fails (TooManyActiveFolders past the limit). */
export async function updateKnownFolderState(act: Ask, folderID: number, isActive: boolean): Promise<void> {
  if (!anID(folderID)) {
    throw new Error("That is no bookmark folder.");
  }
  await act("accessGroupBookmarkMgr", "UpdateKnownFolderState", [folderID, isActive]);
}
