// A pilot's bookmarks, read by the page itself: the call as the client makes it, the three lists read, and an
// answer that is not the three lists told from no bookmarks.
//
// The route the page asked before answered a read that had failed with nothing, and the page read nothing as no
// bookmarks: a bot was told its saved spot was not in the list, and stopped. The read fails as the call fails.

import test from "node:test";
import assert from "node:assert/strict";

import { readMyActiveBookmarks } from "./bookmarkReads.ts";
import type { JsonValue } from "./wire.ts";

// The server's forms (eve.js bookmarkPayloads.js: a KeyVal for each row), with names and numbers made up.
const keyVal = (entries: readonly (readonly [string, unknown])[]): JsonValue =>
  ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } }) as unknown as JsonValue;
const text = (value: string) => ({ type: "wstring", value });
const list = (...items: readonly JsonValue[]): JsonValue => ({ type: "list", items }) as unknown as JsonValue;
const FOLDER = keyVal([
  ["folderID", 500001], ["folderName", text("Places")], ["description", text("")], ["creatorID", 90000001], ["isPersonal", true],
  ["isActive", true], ["accessLevel", 1], ["adminGroupID", null], ["manageGroupID", null], ["useGroupID", null], ["viewGroupID", null],
]);
const SPOT = keyVal([
  ["bookmarkID", 900000008], ["folderID", 500001], ["itemID", null], ["typeID", 5], ["flag", null], ["memo", text("Safe one")],
  ["created", { type: "long", value: "134360000000000000" }], ["expiry", null], ["x", 1000.5], ["y", -2000.5], ["z", 3000.5],
  ["locationID", 30000142], ["note", text("behind the moon")], ["subfolderID", 700003], ["creatorID", 90000001],
]);
const SUBFOLDER = keyVal([["subfolderID", 700003], ["folderID", 500001], ["subfolderName", text("Safes")], ["creatorID", 90000001]]);

function asker(answer: JsonValue | Error | undefined) {
  const asked: unknown[] = [];
  const ask = async (service: string, method: string, args: readonly JsonValue[], kwargs?: unknown, of?: unknown) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    if (answer instanceof Error) throw answer;
    return answer as JsonValue;
  };
  return { ask, asked };
}

test("a pilot's bookmarks are asked for with nothing, and read off the three lists; three empty lists are no bookmarks", async () => {
  const one = asker([list(FOLDER), list(SPOT), list(SUBFOLDER)]);
  const read = await readMyActiveBookmarks(one.ask);
  // bookmarkSvc.py 163: folders, bookmarks, subfolders = self.accessGroupBookmarkMgr.GetMyActiveBookmarks().
  assert.deepEqual(one.asked, [["accessGroupBookmarkMgr", "GetMyActiveBookmarks", [], null, null]]);
  assert.deepEqual(read.folders.map((each) => [each.folderID, each.folderName, each.isPersonal, each.isActive]), [[500001, "Places", true, true]]);
  assert.deepEqual(read.bookmarks.map((each) => [each.bookmarkID, each.folderID, each.memo, each.note, each.locationID, each.itemID, each.x, each.y, each.z, each.subfolderID]),
    [[900000008, 500001, "Safe one", "behind the moon", 30000142, null, 1000.5, -2000.5, 3000.5, 700003]]);
  assert.deepEqual(read.subfolders.map((each) => [each.subfolderID, each.folderID, each.subfolderName]), [[700003, 500001, "Safes"]]);
  assert.deepEqual(await readMyActiveBookmarks(asker([list(), list(), list()]).ask), { folders: [], bookmarks: [], subfolders: [] });
});

test("an answer that is not the three lists is unread, not no bookmarks", async () => {
  for (const [what, answer] of [["nothing", null], ["nothing at all", undefined], ["two lists", [list(FOLDER), list(SPOT)]], ["four", [list(), list(), list(), list()]], ["one list", list(SPOT)], ["a number", 0]] as const) {
    await assert.rejects(readMyActiveBookmarks(asker(answer as JsonValue | undefined).ask), /^Error: Your bookmarks could not be read \(the server did not answer with its three lists\)\.$/, what);
  }
});

test("a read that failed fails as the call failed: the caller has the call's own reason", async () => {
  const refused = Object.assign(new Error("CALL_FAILED"), { code: "CALL_FAILED" });
  await assert.rejects(readMyActiveBookmarks(asker(refused).ask), (error) => error === refused);
});
