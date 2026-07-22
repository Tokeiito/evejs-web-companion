// Mail aux decoder (goal R59) against REAL captured bytes + the server's own
// populated builder shapes.
//
// ⚠ Farmer belongs to NO mailing lists and has NO custom labels, so the LIVE
// capture through GET /api/bridge/mail-aux on 2026-07-22 was five EMPTY answers:
// labels {type:"dict",entries:[]}, joinedLists {type:"dict",entries:[]}, listInfo
// null, listMembers {type:"dict",entries:[]}, listSettings null. Those empty paths
// are asserted directly. The POPULATED fixtures mirror the server's builders —
// mailMgrService.buildLabelKeyVal (KeyVal{labelID,name,color}),
// mailingListsMgrService.buildMailingListInfoKeyVal
// (KeyVal{id,name,displayName,isMuted,isOperator,isOwner}),
// buildMailingListSettingsKeyVal, and the GetMembers dict (memberID->accessLevel)
// — using the same dict/KeyVal wire primitives proven live in the notification +
// calendar captures.
//
// ⚠ R7d: labelID / listID / memberID / entityID survive as numeric fields; the
// sweep proves it (companion proves the sweep is not vacuous).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeJoinedLists,
  decodeMailLabels,
  decodeMailingListInfo,
  decodeMailingListMembers,
  decodeMailingListSettings,
} from "./mailAux.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function dict(entries: readonly [number | string, JsonValue][]): JsonValue {
  return { type: "dict", entries: entries as unknown as JsonValue[][] } as unknown as JsonValue;
}

// The EXACT live empty captures (Farmer).
const EMPTY_DICT = dict([]);

// Populated fixtures mirroring the server builders.
const LABELS = dict([
  [3, keyVal([["labelID", 3], ["name", "Work"], ["color", 16711680]])],
  [8, keyVal([["labelID", 8], ["name", "Fleet"], ["color", 255]])],
]);
const LIST_KEYVAL = keyVal([
  ["id", 100],
  ["name", "corp-ops"],
  ["displayName", "Corp Ops"],
  ["isMuted", false],
  ["isOperator", true],
  ["isOwner", false],
]);
const JOINED_LISTS = dict([[100, LIST_KEYVAL]]);
const MEMBERS = dict([
  [140000005, 3],
  [140000178, 1],
]);
const SETTINGS = keyVal([
  ["defaultAccess", 1],
  ["defaultMemberAccess", 2],
  ["cost", 0],
  ["access", dict([[98000001, 3]])],
]);

test("decodeMailLabels on the live empty dict is empty (a real 'no labels')", () => {
  assert.deepEqual(decodeMailLabels(EMPTY_DICT), []);
});

test("decodeMailLabels decodes the server's labelID -> KeyVal folders", () => {
  assert.deepEqual(decodeMailLabels(LABELS), [
    { labelID: 3, name: "Work", color: 16711680 },
    { labelID: 8, name: "Fleet", color: 255 },
  ]);
});

test("decodeJoinedLists on the live empty dict is empty (a real 'in no lists')", () => {
  assert.deepEqual(decodeJoinedLists(EMPTY_DICT), []);
});

test("decodeJoinedLists decodes the server's listID -> MailingList KeyVal", () => {
  assert.deepEqual(decodeJoinedLists(JOINED_LISTS), [
    { listID: 100, name: "corp-ops", displayName: "Corp Ops", isMuted: false, isOperator: true, isOwner: false },
  ]);
});

test("decodeMailingListInfo decodes a single MailingList KeyVal, null when absent", () => {
  assert.deepEqual(decodeMailingListInfo(LIST_KEYVAL), {
    listID: 100,
    name: "corp-ops",
    displayName: "Corp Ops",
    isMuted: false,
    isOperator: true,
    isOwner: false,
  });
  // The live capture for an unknown list (listID 0) was null.
  assert.equal(decodeMailingListInfo(null), null);
});

test("decodeMailingListMembers on the live empty dict is empty", () => {
  assert.deepEqual(decodeMailingListMembers(EMPTY_DICT), []);
});

test("decodeMailingListMembers decodes memberID -> accessLevel from the dict keys", () => {
  assert.deepEqual(decodeMailingListMembers(MEMBERS), [
    { memberID: 140000005, accessLevel: 3 },
    { memberID: 140000178, accessLevel: 1 },
  ]);
});

test("decodeMailingListSettings decodes the settings KeyVal + nested access dict, null when absent", () => {
  assert.deepEqual(decodeMailingListSettings(SETTINGS), {
    defaultAccess: 1,
    defaultMemberAccess: 2,
    cost: 0,
    access: [{ entityID: 98000001, accessLevel: 3 }],
  });
  assert.equal(decodeMailingListSettings(null), null);
});

// R7d id-sweep: every id survives as a numeric field.
function mailAuxIds(): number[] {
  return [
    ...decodeMailLabels(LABELS).map((l) => l.labelID),
    ...decodeJoinedLists(JOINED_LISTS).map((l) => l.listID),
    ...decodeMailingListMembers(MEMBERS).map((m) => m.memberID),
    ...decodeMailingListSettings(SETTINGS)!.access.map((a) => a.entityID),
  ];
}

test("R7d: mail-aux decoders preserve labelID/listID/memberID/entityID as numeric fields", () => {
  const ids = mailAuxIds();
  assert.ok(ids.includes(3), "labelID preserved");
  assert.ok(ids.includes(100), "listID preserved");
  assert.ok(ids.includes(140000005), "memberID preserved");
  assert.ok(ids.includes(98000001), "access entityID preserved");
});

test("the mail-aux id sweep actually reads distinct decoded content (not vacuous)", () => {
  // Companion: a distinct member id decodes to a distinct value.
  const members = decodeMailingListMembers(dict([[555, 9]]));
  assert.deepEqual(members, [{ memberID: 555, accessLevel: 9 }]);
});
