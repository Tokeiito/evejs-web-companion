// Bookmark decoders (goal R65) against REAL captured bytes.
//
// Captured live from Farmer (character 140000005) through POST /api/bridge/call
// on 2026-07-22:
//   • accessGroupBookmarkMgr.GetMyActiveBookmarks() -> a 3-element ARRAY
//       [ {list of folder util.KeyVals}, {list of bookmark util.KeyVals},
//         {list of subfolder util.KeyVals} ]. Farmer had TWO folders ("Agent
//       Missions" 500002 inactive, "Personal Locations" 500001 active), ONE
//       bookmark (900000008, a coordinate bookmark in Perimeter) and ZERO
//       subfolders — so this is a populated capture for folders + bookmarks and a
//       REAL empty for subfolders.
//   • SearchFoldersWithAdminAccess() -> {type:"list", items:[folder KeyVal, …]}
//       (the char's personal + admin-access folders).
//   • GetFolderInfo(500002) -> the single folder KeyVal; GetFolderInfo(unknown)
//       answered 409 (BookmarkFolderNoLongerThere) — resolveFolderView gates it,
//       so a folder the char cannot access is refused, never revealed.
//
// The folder/bookmark field shapes (wstring text, long FILETIMEs, float coords)
// are verbatim from the capture. The single SUBFOLDER row below is built to the
// server's buildSubfolderPayload shape (eve.js bookmarkPayloads.js:90) since
// Farmer had no subfolders to capture.
//
// R7d: folderID / bookmarkID / itemID / typeID / locationID / creatorID / group
// ids stay numeric fields; the decoder renders nothing.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeActiveBookmarks,
  decodeBookmarkFolderUpdatedAck,
  decodeBookmarkWriteAck,
  decodeFolderInfo,
  decodeFolderList,
} from "./bookmarks.ts";
import type { JsonValue } from "./wire.ts";

function folderKeyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

const FOLDER_AGENT: JsonValue = folderKeyVal([
  ["folderID", 500002],
  ["folderName", { type: "wstring", value: "Agent Missions" }],
  ["description", { type: "wstring", value: "System-managed mission bookmarks used by agent mission warp/location flows." }],
  ["creatorID", 140000005],
  ["isPersonal", true],
  ["isActive", false],
  ["accessLevel", 1],
  ["adminGroupID", null],
  ["manageGroupID", null],
  ["useGroupID", null],
  ["viewGroupID", null],
]);

const FOLDER_PERSONAL: JsonValue = folderKeyVal([
  ["folderID", 500001],
  ["folderName", { type: "wstring", value: "Personal Locations" }],
  ["description", { type: "wstring", value: "" }],
  ["creatorID", 140000005],
  ["isPersonal", true],
  ["isActive", true],
  ["accessLevel", 1],
  ["adminGroupID", null],
  ["manageGroupID", null],
  ["useGroupID", null],
  ["viewGroupID", null],
]);

const BOOKMARK_SPOT: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["bookmarkID", 900000008],
      ["folderID", 500001],
      ["itemID", null],
      ["typeID", 5],
      ["flag", null],
      ["memo", { type: "wstring", value: "spot in Perimeter solar system" }],
      ["created", { type: "long", value: "134277705426450000" }],
      ["expiry", null],
      ["x", 800382064839.4822],
      ["y", 54164076845.46208],
      ["z", 1112590662013.8796],
      ["locationID", 30000144],
      ["note", { type: "wstring", value: "" }],
      ["subfolderID", null],
      ["creatorID", 140000005],
    ],
  },
};

// buildSubfolderPayload shape (no subfolder existed to capture live).
const SUBFOLDER_ROW: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["subfolderID", 700003],
      ["folderID", 500001],
      ["subfolderName", { type: "wstring", value: "Wormholes" }],
      ["creatorID", 140000005],
    ],
  },
};

const ACTIVE_BOOKMARKS: JsonValue = [
  { type: "list", items: [FOLDER_AGENT, FOLDER_PERSONAL] },
  { type: "list", items: [BOOKMARK_SPOT] },
  { type: "list", items: [SUBFOLDER_ROW] },
];

test("decodeActiveBookmarks decodes the real [folders, bookmarks, subfolders] 3-array", () => {
  const decoded = decodeActiveBookmarks(ACTIVE_BOOKMARKS);
  assert.equal(decoded.folders.length, 2);
  assert.equal(decoded.bookmarks.length, 1);
  assert.equal(decoded.subfolders.length, 1);

  const agent = decoded.folders[0]!;
  assert.equal(agent.folderID, 500002);
  assert.equal(agent.folderName, "Agent Missions");
  assert.equal(agent.description, "System-managed mission bookmarks used by agent mission warp/location flows.");
  assert.equal(agent.creatorID, 140000005);
  assert.equal(agent.isPersonal, true);
  assert.equal(agent.isActive, false);
  assert.equal(agent.accessLevel, 1);
  assert.equal(agent.adminGroupID, null);

  const bm = decoded.bookmarks[0]!;
  assert.equal(bm.bookmarkID, 900000008);
  assert.equal(bm.folderID, 500001);
  assert.equal(bm.itemID, null);
  assert.equal(bm.typeID, 5);
  assert.equal(bm.memo, "spot in Perimeter solar system");
  assert.equal(bm.note, "");
  // The created FILETIME survives as a bigint (it exceeds 2^53); no expiry.
  assert.equal(bm.created, 134277705426450000n);
  assert.equal(bm.expiry, null);
  // Coordinates survive as floats.
  assert.equal(bm.x, 800382064839.4822);
  assert.equal(bm.z, 1112590662013.8796);
  assert.equal(bm.locationID, 30000144);
  assert.equal(bm.subfolderID, null);

  const sub = decoded.subfolders[0]!;
  assert.equal(sub.subfolderID, 700003);
  assert.equal(sub.folderID, 500001);
  assert.equal(sub.subfolderName, "Wormholes");
});

test("decodeActiveBookmarks with an empty subfolder list keeps subfolders empty", () => {
  const decoded = decodeActiveBookmarks([
    { type: "list", items: [FOLDER_PERSONAL] },
    { type: "list", items: [] },
    { type: "list", items: [] },
  ]);
  assert.equal(decoded.folders.length, 1);
  assert.deepEqual(decoded.bookmarks, []);
  assert.deepEqual(decoded.subfolders, []);
});

test("decodeFolderList decodes the SearchFoldersWithAdminAccess folder list", () => {
  const folders = decodeFolderList({ type: "list", items: [FOLDER_AGENT, FOLDER_PERSONAL] });
  assert.equal(folders.length, 2);
  assert.deepEqual(folders.map((f) => f.folderID), [500002, 500001]);
  assert.equal(folders[1]!.folderName, "Personal Locations");
});

test("decodeFolderInfo reads one folder KeyVal, and null/absent stays null", () => {
  const folder = decodeFolderInfo(FOLDER_AGENT);
  assert.equal(folder!.folderID, 500002);
  assert.equal(folder!.isActive, false);
  // GetFolderInfo on an inaccessible folder is refused server-side (409), never a
  // decodable row; a null/garbage value decodes to null rather than an empty row.
  assert.equal(decodeFolderInfo(null), null);
  assert.equal(decodeFolderInfo({ type: "list", items: [] }), null);
});

// --- R87 write acks (Phase-3 accessGroupBookmarkMgr WRITES) ------------------

test("R87 — a plain bookmark write ack decodes to {ok, applied}", () => {
  const ack = decodeBookmarkWriteAck({ ok: true, applied: true, result: null });
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R87 — a declined bookmark write is read as not-applied, not a throw", () => {
  const ack = decodeBookmarkWriteAck({ ok: true, applied: false });
  assert.equal(ack.applied, false);
});

test("R87 — an UpdateFolder ack carries the resulting access-level int", () => {
  const ack = decodeBookmarkFolderUpdatedAck({ ok: true, applied: true, accessLevel: 3 });
  assert.deepEqual(ack, { ok: true, applied: true, accessLevel: 3 });
});
