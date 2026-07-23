// R80 corpRegistry member-roster + tracking decoders against REAL captured bytes.
//
// Fixtures are the EXACT retail shapes captured live through /api/bridge/call on
// 2026-07-22: Farmer (character 140000005, corp 98000001) for the populated own-corp
// rows, and the arg-injection probes (as Farmer, injecting Test Two's corp 98000000 /
// char 140000002) for the "foreign id returns nothing" cases. Member role masks +
// FILETIMEs exceed 2^53 and are asserted to survive as raw decimal STRINGS.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpMember,
  decodeCorpMembersByIds,
  decodeCorpMembersPaged,
  decodeCorpEveOwners,
} from "./corpMembers.ts";
import { decodeCorpMemberTracking } from "./corpMemberTracking.ts";
import type { JsonValue } from "./wire.ts";

const MEMBER_COLUMNS = [
  ["characterID", 3], ["corporationID", 3], ["divisionID", 3], ["squadronID", 3],
  ["title", 130], ["roles", 64], ["grantableRoles", 64], ["startDateTime", 64],
  ["baseID", 3], ["rolesAtHQ", 64], ["grantableRolesAtHQ", 64], ["rolesAtBase", 64],
  ["grantableRolesAtBase", 64], ["rolesAtOther", 64], ["grantableRolesAtOther", 64],
  ["titleMask", 3], ["accountKey", 3], ["rowDate", 64], ["blockRoles", 11], ["ownerName", 130],
];

// A member packedrow in the name-keyed `fields` variant (GetMember / …ByIds / …Paged).
function memberRow(fields: Record<string, JsonValue>): JsonValue {
  return { type: "packedrow", columns: MEMBER_COLUMNS, fields } as unknown as JsonValue;
}

// Farmer's REAL member row (corp 98000001), verbatim from the capture.
const REAL_FARMER_MEMBER = memberRow({
  characterID: 140000005, corporationID: 98000001, divisionID: 0, squadronID: 0,
  title: "", roles: "1212031284210036097", grantableRoles: "1212031284210036097",
  startDateTime: "134276026827720000", baseID: 60015249,
  rolesAtHQ: "134209536", grantableRolesAtHQ: "134209536", rolesAtBase: "134209536",
  grantableRolesAtBase: "134209536", rolesAtOther: "134209536", grantableRolesAtOther: "134209536",
  titleMask: 0, accountKey: 1000, rowDate: "134276026827720000", blockRoles: 0, ownerName: "Farmer",
});

const REAL_ASDF_MEMBER = memberRow({
  characterID: 998830009, corporationID: 98000001, divisionID: 0, squadronID: 0,
  title: "", roles: "0", grantableRoles: "0", startDateTime: "134276061981200000", baseID: 60015249,
  rolesAtHQ: "0", grantableRolesAtHQ: "0", rolesAtBase: "0", grantableRolesAtBase: "0",
  rolesAtOther: "0", grantableRolesAtOther: "0", titleMask: 0, accountKey: 1000,
  rowDate: "134276061981200000", blockRoles: 0, ownerName: "asdf",
});

test("GetMember decodes a member row, preserving >2^53 role masks and FILETIMEs as strings", () => {
  const m = decodeCorpMember(REAL_FARMER_MEMBER);
  assert.ok(m);
  assert.equal(m.characterID, 140000005);
  assert.equal(m.corporationID, 98000001);
  assert.equal(m.ownerName, "Farmer");
  assert.equal(m.baseID, 60015249);
  assert.equal(m.accountKey, 1000);
  // The bytes that would round if Number()-coerced — kept as exact decimal strings.
  assert.equal(m.roles, "1212031284210036097");
  assert.equal(m.grantableRoles, "1212031284210036097");
  assert.equal(m.startDateTime, "134276026827720000");
  assert.equal(m.rowDate, "134276026827720000");
  assert.equal(m.rolesAtHQ, "134209536");
});

test("GetMember returns null for a foreign memberID (not in the session corp)", () => {
  // Live: as Farmer, GetMember(140000002) -> null.
  assert.equal(decodeCorpMember(null), null);
});

test("GetMembersByIds decodes the found members; a foreign id yields []", () => {
  const found = decodeCorpMembersByIds({ type: "list", items: [REAL_FARMER_MEMBER] } as unknown as JsonValue);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.characterID, 140000005);
  // Live: as Farmer, GetMembersByIds([140000002]) -> {type:"list", items:[]}.
  assert.deepEqual(decodeCorpMembersByIds({ type: "list", items: [] } as unknown as JsonValue), []);
});

test("GetMembersPaged decodes the page rows and the paging counters", () => {
  // Farmer's REAL page 1: two members, total 2, page 0, perPage 50.
  const paged = {
    type: "objectex1",
    header: [
      { type: "token", value: "eve.common.script.util.pagedCollection.PagedResultSet" },
      [{ type: "list", items: [REAL_FARMER_MEMBER, REAL_ASDF_MEMBER] }, 2, 0, 50],
    ],
    list: [], dict: [],
  } as unknown as JsonValue;
  const page = decodeCorpMembersPaged(paged);
  assert.equal(page.totalCount, 2);
  assert.equal(page.page, 0);
  assert.equal(page.perPage, 50);
  assert.equal(page.members.length, 2);
  assert.deepEqual(page.members.map((m) => m.ownerName), ["Farmer", "asdf"]);
});

test("GetMembersPaged: an out-of-range page yields empty members with the true total", () => {
  // Live: as Farmer, GetMembersPaged(98000000) -> items [], total 2, page 97999999.
  const paged = {
    type: "objectex1",
    header: [
      { type: "token", value: "eve.common.script.util.pagedCollection.PagedResultSet" },
      [{ type: "list", items: [] }, 2, 97999999, 50],
    ],
    list: [], dict: [],
  } as unknown as JsonValue;
  const page = decodeCorpMembersPaged(paged);
  assert.equal(page.members.length, 0);
  assert.equal(page.totalCount, 2);
  assert.equal(page.page, 97999999);
});

test("GetEveOwners decodes the name-resolution rows (list of util.Row)", () => {
  const owner = (id: number, name: string): JsonValue => ({
    type: "object", name: "util.Row",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: ["ownerID", "ownerName", "typeID", "gender", "ownerNameID"] }],
        ["line", { type: "list", items: [id, name, 1386, 1, null] }],
      ],
    },
  }) as unknown as JsonValue;
  const owners = decodeCorpEveOwners({ type: "list", items: [owner(140000005, "Farmer"), owner(998830009, "asdf")] } as unknown as JsonValue);
  assert.equal(owners.length, 2);
  assert.deepEqual(owners[0], { ownerID: 140000005, ownerName: "Farmer", typeID: 1386, gender: 1, ownerNameID: null });
  assert.equal(owners[1]!.ownerName, "asdf");
});

// --- member tracking (CRowset, positional `values` packedrows, {type:long}) -----

const TRACKING_COLUMNS = [
  ["characterID", 3], ["corporationID", 3], ["title", 130], ["roles", 20],
  ["grantableRoles", 20], ["baseID", 3], ["startDateTime", 64], ["logonDateTime", 64],
  ["logoffDateTime", 64], ["lastOnline", 3], ["locationID", 20], ["shipTypeID", 3],
  ["rolesAtHQ", 20], ["grantableRolesAtHQ", 20], ["rolesAtBase", 20], ["grantableRolesAtBase", 20],
  ["rolesAtOther", 20], ["grantableRolesAtOther", 20], ["factionID", 3],
];
const long = (v: string): JsonValue => ({ type: "long", value: v } as unknown as JsonValue);
function trackingRow(values: JsonValue[]): JsonValue {
  return { type: "packedrow", columns: TRACKING_COLUMNS, values } as unknown as JsonValue;
}
// Farmer's REAL tracking row (online: logonDateTime a long, lastOnline -1, locationID 60003760).
const REAL_TRACK_FARMER = trackingRow([
  140000005, 98000001, "", long("1212031284210036097"), long("1212031284210036097"), 60015249,
  long("134276026827720000"), long("134292376406920000"), null, -1, 60003760, 32872,
  long("134209536"), long("134209536"), long("134209536"), long("134209536"), long("134209536"), long("134209536"), 500001,
]);
const REAL_TRACK_ASDF = trackingRow([
  998830009, 98000001, "", long("0"), long("0"), 60015249,
  long("134276061981200000"), null, null, 453, 60003760, 588,
  long("0"), long("0"), long("0"), long("0"), long("0"), long("0"), 500001,
]);

function crowset(rows: JsonValue[]): JsonValue {
  return {
    type: "objectex2",
    header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [] }],
    list: rows, dict: [],
  } as unknown as JsonValue;
}

test("GetMemberTrackingInfoSimple decodes the CRowset tracking rows", () => {
  const rows = decodeCorpMemberTracking(crowset([REAL_TRACK_FARMER, REAL_TRACK_ASDF]));
  assert.equal(rows.length, 2);
  const farmer = rows[0]!;
  assert.equal(farmer.characterID, 140000005);
  assert.equal(farmer.corporationID, 98000001);
  assert.equal(farmer.locationID, 60003760);
  assert.equal(farmer.shipTypeID, 32872);
  assert.equal(farmer.factionID, 500001);
  assert.equal(farmer.lastOnline, -1); // currently online
  assert.equal(farmer.logonDateTime, "134292376406920000");
  assert.equal(farmer.roles, "1212031284210036097");
  // asdf: never-logged-on style row — logon/logoff null, lastOnline an hours count.
  assert.equal(rows[1]!.logonDateTime, null);
  assert.equal(rows[1]!.logoffDateTime, null);
  assert.equal(rows[1]!.lastOnline, 453);
  assert.equal(rows[1]!.roles, "0");
});

test("GetMemberTrackingInfo peels the CachedMethodCallResult wrapper before the CRowset", () => {
  const cached = {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [] },
      { type: "substream", value: crowset([REAL_TRACK_FARMER]) },
      { type: "list", items: [long("134292376406940000"), 1045842135] },
    ],
  } as unknown as JsonValue;
  const rows = decodeCorpMemberTracking(cached);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.characterID, 140000005);
  assert.equal(rows[0]!.locationID, 60003760);
});

test("member tracking of an empty corp is []", () => {
  assert.deepEqual(decodeCorpMemberTracking(crowset([])), []);
});
