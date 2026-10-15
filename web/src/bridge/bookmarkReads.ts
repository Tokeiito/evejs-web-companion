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
// of the bookmark manager by its name, nothing sent. Recorded on Tranquility so, in three recordings (four
// askings, three with their answers; counted again 2026-10-11, and the five written here before is not what is
// counted). It answers three lists for the session's own character.
//
// THE FOLDERS ARE THOSE THE PILOT KNOWS, ACTIVE OR NOT; the bookmarks and the subfolders are those of the active
// folders alone. This server answers so (bookmarkRuntimeState.js, getMyActiveBookmarks), and the client is written
// for it: what it keeps at a login is this answer, and its Locations panel lists the folders it keeps that are not
// active under a heading of their own (bookmarksPanel.py, 272 to 276). No recording has a folder that is not
// active. A FOLDER A CLIENT OFFERS TO SAVE IN IS AN ACTIVE ONE, not one it may only view, and not a full one
// (bookmarkSvc.GetFilteredFoldersAndSubfolders, 395 to 412).
//
// ONE OF THE FOLDERS HERE IS THIS SERVER'S OWN: "Agent Missions", a personal folder it files a mission's spots in
// and marks not active each time it does (agentMissionRuntime.js, ensureMissionBookmarkFolder). No recording has
// such a folder. Its bookmarks are answered only while a pilot has marked it active. Nothing of the page reads it:
// a mission's spots are the journal's (bridge/agents.ts), as they are a client's.
//
// WHAT A ROW IS. A recorded bookmark is a row of 14 columns; this server's is a KeyVal of 15 names, which are the
// 15 of the KeyVal a client makes of a bookmark it has just saved and keeps beside the rows
// (bookmarkSvc.NewBookmarkCreated, 635). A recorded folder has an ownerID this server's has not; nothing of the
// client's reads one.
//
// WHAT IS KEPT. The client asks once in a session and keeps the three, changing what it keeps as it makes,
// changes and deletes a bookmark itself, and as the server tells it a shared folder changed
// (OnSharedBookmarksFolderUpdated and its fellows). The page keeps nothing: it asks each time it wants them.
//
// ON THE GAME PORT THE TRANSPORT KEEPS THEM (src/gamePort/pilots.js, bookmarksRead). They are asked for as a
// character is chosen, as a client asks, and from then on the page's asking is answered from what is kept, with
// nothing sent. A PLACE BOOKMARKED ON THE BALLPARK'S OBJECT, the page's one write of a bookmark
// (bridge/bookmarkWrites.ts), is worked into what is kept as the client works it (bookmarkSvc.NewBookmarkCreated,
// 634 to 640): the bookmark is made of what the park answered and of what was sent, and nothing is asked. At any
// other write of the pilot's own of a bookmark, a folder or a subfolder, and at the server's word of a shared
// folder, what is kept is let go and asked for when it is next wanted: once more than a client asks, which works
// each of those into what it keeps too. A bookmark whose time has run out by the server's clock is not handed on.
// Through the gateway each asking is sent.
//
// AN ANSWER THAT IS NOT THE THREE LISTS IS NOT "NO BOOKMARKS". The route answered a read that had failed with
// nothing and a code beside it, and the page read nothing as no bookmarks: a bot's warp to a saved spot was told
// the spot was not in its list, and stopped. The read fails as the call fails, and says so where the answer is
// not the three lists.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";
import { decodeAccessGroup, decodeAccessGroups, decodeActiveBookmarks, decodeFolderInfo, decodeFolderList, type AccessGroup, type ActiveBookmarks, type BookmarkFolder } from "./bookmarks.ts";

/**
 * The folders the pilot knows, active or not, and the bookmarks and subfolders of the active ones, as the server
 * lists them. Fails as the
 * call fails; and where the server's answer is not its three lists, which is no list of bookmarks at all.
 */
export async function readMyActiveBookmarks(ask: Ask): Promise<ActiveBookmarks> {
  const answered = await ask("accessGroupBookmarkMgr", "GetMyActiveBookmarks", []);
  if (!Array.isArray(answered) || answered.length !== 3) {
    throw new Error("Your bookmarks could not be read (the server did not answer with its three lists).");
  }
  return decodeActiveBookmarks(answered);
}

/**
 * The folder `folderID` as the server has it now (bookmarkSvc.GetBookmarkFolder with refresh, 517 to 522:
 * accessGroupBookmarkMgr.GetFolderInfo(folderID)), which Edit Folder asks before its window opens (bookmarksPanel.py
 * EditACLFolder, 428 to 433). Fails as the call fails, and where the answer is no folder.
 */
export async function readFolderInfo(ask: Ask, folderID: number): Promise<BookmarkFolder> {
  const folder = decodeFolderInfo(await ask("accessGroupBookmarkMgr", "GetFolderInfo", [folderID]));
  if (folder === null) {
    throw new Error("That folder could not be read.");
  }
  return folder;
}

/**
 * The folders the pilot may administer, known to it or not (bookmarkSvc.SearchFoldersWithAdminAccess, 714 to 717:
 * accessGroupBookmarkMgr.SearchFoldersWithAdminAccess(), by name and with nothing), for the Locations window's Folders
 * with Admin Access (bookmarksPanel.py GetAdminFolders, 606 to 637). Fails as the call fails.
 */
export async function readFoldersWithAdminAccess(ask: Ask): Promise<readonly BookmarkFolder[]> {
  return decodeFolderList(await ask("accessGroupBookmarkMgr", "SearchFoldersWithAdminAccess", []));
}

/**
 * The pilot's access lists (accessGroupsController.GetMyGroups, 102 to 109: ownerGroupManager.GetMyGroups(), by name
 * and with nothing), which the folder window offers a shared folder's four access levels from
 * (bookmarkContainerWindow.py GetAccessGroups, 134 to 136). Fails as the call fails.
 */
export async function readMyAccessGroups(ask: Ask): Promise<readonly AccessGroup[]> {
  return decodeAccessGroups(await ask("ownerGroupManager", "GetMyGroups", []));
}

/**
 * An access list that is none of the pilot's, by its number (accessGroupsController.GetGroupInfoFromID with
 * fetchToServer, 173 to 186: ownerGroupManager.GetGroup(groupID)), for its name. Answers null where the server has none
 * the pilot may see. Fails as the call fails.
 */
export async function readAccessGroup(ask: Ask, groupID: number): Promise<AccessGroup | null> {
  return decodeAccessGroup(await ask("ownerGroupManager", "GetGroup", [groupID]));
}
