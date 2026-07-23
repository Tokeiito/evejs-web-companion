// R84 allianceRegistry governance decoders (contacts / applications / bulletins) against
// REAL captured bytes.
//
// The EMPTY fixtures are the EXACT retail shapes captured live through /api/bridge/call on
// 2026-07-22 (as Test Two, char 140000002, corp 98000000, a MEMBER of Elysian 99000000 —
// whose alliance is seeded but carries no contacts / applications / bulletins — and as
// Farmer, alliance-less). The POPULATED fixtures mirror the server builders (buildDict /
// buildAllianceApplicationsIndexRowset / buildBulletinRow) exactly, since the world seeds
// no governance rows to capture live. FILETIMEs are asserted to survive as raw decimal
// STRINGS; the IndexRowset is read from its "items" dict (not "lines"); bulletins are
// packed rows (blue.DBRow), NOT KeyVals.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeAllianceContacts,
  decodeAllianceApplications,
  decodeAllianceBulletins,
} from "./allianceGovernance.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries.map((e) => [e[0], e[1]]) },
  };
}

// --- GetAllianceContacts ---------------------------------------------------

// Farmer / Test Two REAL empty contacts dict, verbatim.
const REAL_CONTACTS_EMPTY: JsonValue = { type: "dict", entries: [] };

// Builder-mirrored populated contacts dict (buildDict of [contactID, KeyVal]).
const CONTACTS_POPULATED: JsonValue = {
  type: "dict",
  entries: [
    [98000005, keyVal([["contactID", 98000005], ["relationshipID", 5], ["labelMask", 0]])],
    [98000006, keyVal([["contactID", 98000006], ["relationshipID", -10], ["labelMask", 4]])],
  ],
};

test("decodeAllianceContacts returns [] for the real empty contacts dict", () => {
  assert.deepEqual(decodeAllianceContacts(REAL_CONTACTS_EMPTY), []);
  assert.deepEqual(decodeAllianceContacts(null), []);
});

test("decodeAllianceContacts reads contactID / relationshipID / labelMask", () => {
  const contacts = decodeAllianceContacts(CONTACTS_POPULATED);
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts[0], { contactID: 98000005, relationshipID: 5, labelMask: 0 });
  assert.deepEqual(contacts[1], { contactID: 98000006, relationshipID: -10, labelMask: 4 });
});

// --- GetApplications (IndexRowset) -----------------------------------------

const APPLICATION_HEADER = [
  "allianceID",
  "corporationID",
  "applicationText",
  "state",
  "applicationDateTime",
];

function indexRowset(header: readonly string[], items: readonly (readonly [JsonValue, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.IndexRowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: [...header] }],
        ["columns", { type: "list", items: [...header] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["idName", "corporationID"],
        ["items", { type: "dict", entries: items.map((e) => [e[0], e[1]]) }],
      ],
    },
  };
}

// Test Two / Farmer REAL empty applications IndexRowset, verbatim.
const REAL_APPLICATIONS_EMPTY = indexRowset(APPLICATION_HEADER, []);

// Builder-mirrored populated IndexRowset: rows under "items", keyed by corporationID,
// each a {type:"list"} of cells in header order. applicationDateTime is a FILETIME long.
const APPLICATIONS_POPULATED = indexRowset(APPLICATION_HEADER, [
  [
    98000002,
    { type: "list", items: [99000000, 98000002, "We would like to join.", 1, { type: "long", value: "134274243506850000" }] },
  ],
]);

test("decodeAllianceApplications returns [] for the real empty IndexRowset", () => {
  assert.deepEqual(decodeAllianceApplications(REAL_APPLICATIONS_EMPTY), []);
  assert.deepEqual(decodeAllianceApplications(null), []);
});

test("decodeAllianceApplications reads the IndexRowset 'items' rows, FILETIME as string", () => {
  const apps = decodeAllianceApplications(APPLICATIONS_POPULATED);
  assert.equal(apps.length, 1);
  const a = apps[0]!;
  assert.equal(a.allianceID, 99000000);
  assert.equal(a.corporationID, 98000002);
  assert.equal(a.applicationText, "We would like to join.");
  assert.equal(a.state, 1);
  assert.equal(a.applicationDateTime, "134274243506850000");
  assert.equal(typeof a.applicationDateTime, "string");
});

// --- GetBulletins (packed rows) --------------------------------------------

const BULLETIN_COLUMNS = [
  ["bulletinID", 0x03],
  ["ownerID", 0x03],
  ["createDateTime", 0x40],
  ["editDateTime", 0x40],
  ["editCharacterID", 0x03],
  ["title", 0x82],
  ["body", 0x82],
  ["sortOrder", 0x03],
];

function bulletinRow(fields: Record<string, JsonValue>): JsonValue {
  return { type: "packedrow", columns: BULLETIN_COLUMNS as unknown as JsonValue, fields };
}

// Test Two / Farmer REAL empty bulletins list, verbatim.
const REAL_BULLETINS_EMPTY: JsonValue = { type: "list", items: [] };

// Builder-mirrored populated bulletins list (buildBulletinRow — create/edit DateTime are
// STRINGS on the wire, not long wrappers).
const BULLETINS_POPULATED: JsonValue = {
  type: "list",
  items: [
    bulletinRow({
      bulletinID: 7,
      ownerID: 99000000,
      createDateTime: "134274243506850000",
      editDateTime: "134274243506860000",
      editCharacterID: 140000002,
      title: "Fleet tonight",
      body: "Form up at 2000.",
      sortOrder: 0,
    }),
  ],
};

test("decodeAllianceBulletins returns [] for the real empty bulletins list", () => {
  assert.deepEqual(decodeAllianceBulletins(REAL_BULLETINS_EMPTY), []);
  assert.deepEqual(decodeAllianceBulletins(null), []);
});

test("decodeAllianceBulletins reads a packed bulletin row, dates as raw strings", () => {
  const bulletins = decodeAllianceBulletins(BULLETINS_POPULATED);
  assert.equal(bulletins.length, 1);
  const b = bulletins[0]!;
  assert.equal(b.bulletinID, 7);
  assert.equal(b.ownerID, 99000000);
  assert.equal(b.createDateTime, "134274243506850000");
  assert.equal(b.editDateTime, "134274243506860000");
  assert.equal(typeof b.createDateTime, "string");
  assert.equal(b.editCharacterID, 140000002);
  assert.equal(b.title, "Fleet tonight");
  assert.equal(b.body, "Form up at 2000.");
  assert.equal(b.sortOrder, 0);
});
