// R80 corpRegistry titles / labels / contacts / bulletins + char info-window decoders.
//
// Empty shapes are REAL-captured (Farmer, corp 98000001, seeds no labels/contacts/
// bulletins) through /api/bridge/call on 2026-07-22; the GetTitles 16-title scheme and
// the info-window KeyVal are real populated captures. The populated label/contact/
// bulletin fixtures are built from the SAME server builder that produced the captured
// (empty) descriptors — identical columns, rows added — so the decoders are exercised
// against both the empty and the populated path.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpTitles,
  decodeCorpLabels,
  decodeCorpContacts,
  decodeCorpBulletins,
  decodeCharInfoWindow,
} from "./corpRegistryMeta.ts";
import type { JsonValue } from "./wire.ts";

const long = (v: string): JsonValue => ({ type: "long", value: v } as unknown as JsonValue);

// --- GetTitles (CIndexedRowset keyed by titleID, positional `values`) -----------
const TITLE_COLUMNS = [
  ["titleID", 3], ["titleName", 130], ["roles", 20], ["grantableRoles", 20],
  ["rolesAtHQ", 20], ["grantableRolesAtHQ", 20], ["rolesAtBase", 20],
  ["grantableRolesAtBase", 20], ["rolesAtOther", 20], ["grantableRolesAtOther", 20],
];
function titleRow(titleID: number, name: string, roles: string): JsonValue {
  return {
    type: "packedrow", columns: TITLE_COLUMNS,
    values: [titleID, name, long(roles), long("0"), long("0"), long("0"), long("0"), long("0"), long("0"), long("0")],
  } as unknown as JsonValue;
}
function cIndexedRowset(idName: string, pairs: readonly (readonly [number, JsonValue])[]): JsonValue {
  return {
    type: "objectex2",
    header: [
      [{ type: "token", value: "carbon.common.script.sys.crowset.CIndexedRowset" }],
      { type: "dict", entries: [["idName", idName], ["columnName", idName]] },
    ],
    list: [],
    dict: pairs.map(([k, v]) => [k, v]),
  } as unknown as JsonValue;
}

test("GetTitles decodes the default 16-title scheme (empty names, zero roles)", () => {
  // Real capture: title ids 1,2,4,…,32768, all empty names / zero masks.
  const ids = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
  const titles = decodeCorpTitles(cIndexedRowset("titleID", ids.map((id) => [id, titleRow(id, "", "0")] as const)));
  assert.equal(titles.length, 16);
  assert.deepEqual(titles.map((t) => t.titleID), ids);
  assert.equal(titles[0]!.titleName, "");
  assert.equal(titles[0]!.roles, "0");
});

test("GetTitles decodes a populated title's name and >2^53 role mask as a string", () => {
  const titles = decodeCorpTitles(cIndexedRowset("titleID", [[1, titleRow(1, "Director", "1212031284210036097")]]));
  assert.equal(titles.length, 1);
  assert.equal(titles[0]!.titleName, "Director");
  assert.equal(titles[0]!.roles, "1212031284210036097");
});

// --- GetLabels (CIndexedRowset keyed by labelID) --------------------------------
const LABEL_COLUMNS = [["labelID", 20], ["name", 130], ["color", 3]];
function labelRow(labelID: number, name: string, color: number): JsonValue {
  return { type: "packedrow", columns: LABEL_COLUMNS, values: [labelID, name, color] } as unknown as JsonValue;
}

test("GetLabels is [] for a corp with no labels (real empty capture)", () => {
  const empty = cIndexedRowset("labelID", []);
  assert.deepEqual(decodeCorpLabels(empty), []);
});

test("GetLabels decodes a populated label row", () => {
  const labels = decodeCorpLabels(cIndexedRowset("labelID", [[1, labelRow(1, "Blues", 16711680)]]));
  assert.equal(labels.length, 1);
  assert.deepEqual(labels[0], { labelID: "1", name: "Blues", color: 16711680 });
});

// --- GetCorporateContacts (bare dict {contactID -> util.KeyVal}) -----------------
function contactKeyVal(contactID: number, relationshipID: number, labelMask: number, inWatchlist: number): JsonValue {
  return {
    type: "object", name: "util.KeyVal",
    args: { type: "dict", entries: [
      ["contactID", contactID], ["relationshipID", relationshipID],
      ["labelMask", labelMask], ["inWatchlist", inWatchlist],
    ] },
  } as unknown as JsonValue;
}

test("GetCorporateContacts is [] for a corp with no contacts (real empty capture)", () => {
  assert.deepEqual(decodeCorpContacts({ type: "dict", entries: [] } as unknown as JsonValue), []);
});

test("GetCorporateContacts decodes a populated contact dict", () => {
  const dict = { type: "dict", entries: [[3019494, contactKeyVal(3019494, 5, 0, 1)]] } as unknown as JsonValue;
  const contacts = decodeCorpContacts(dict);
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0], { contactID: 3019494, relationshipID: 5, labelMask: "0", inWatchlist: true });
});

// --- GetBulletins (CRowset, `fields` packedrows) --------------------------------
const BULLETIN_COLUMNS = [
  ["bulletinID", 3], ["ownerID", 3], ["createCharacterID", 3], ["createDateTime", 64],
  ["editCharacterID", 3], ["editDateTime", 64], ["title", 130], ["body", 130], ["sortOrder", 3],
];
function bulletinRow(fields: Record<string, JsonValue>): JsonValue {
  return { type: "packedrow", columns: BULLETIN_COLUMNS, fields } as unknown as JsonValue;
}
function crowset(rows: JsonValue[]): JsonValue {
  return {
    type: "objectex2",
    header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [] }],
    list: rows, dict: [],
  } as unknown as JsonValue;
}

test("GetBulletins is [] for a corp with no bulletins (real empty capture)", () => {
  assert.deepEqual(decodeCorpBulletins(crowset([])), []);
});

test("GetBulletins decodes a populated bulletin, keeping FILETIMEs as strings", () => {
  const row = bulletinRow({
    bulletinID: 7, ownerID: 98000001, createCharacterID: 140000005,
    createDateTime: "134276026827720000", editCharacterID: 140000005,
    editDateTime: "134276030000000000", title: "Ops tonight", body: "Form up 20:00", sortOrder: 0,
  });
  const bulletins = decodeCorpBulletins(crowset([row]));
  assert.equal(bulletins.length, 1);
  assert.deepEqual(bulletins[0], {
    bulletinID: 7, ownerID: 98000001, createCharacterID: 140000005,
    createDateTime: "134276026827720000", editCharacterID: 140000005,
    editDateTime: "134276030000000000", title: "Ops tonight", body: "Form up 20:00", sortOrder: 0,
  });
});

// --- GetInfoWindowDataForChar (util.KeyVal) — own + the flagged foreign leak -----
function infoKeyVal(corpID: number, allianceID: number | null, factionID: number | null): JsonValue {
  const entries: (readonly [string, JsonValue])[] = [
    ["corpID", corpID], ["allianceID", allianceID], ["factionID", factionID], ["title", ""],
  ];
  for (let i = 1; i <= 16; i += 1) entries.push([`title${i}`, ""]);
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } } as unknown as JsonValue;
}

test("GetInfoWindowDataForChar decodes the caller's own char (corp 98000001)", () => {
  const info = decodeCharInfoWindow(infoKeyVal(98000001, null, 500001));
  assert.ok(info);
  assert.equal(info.corpID, 98000001);
  assert.equal(info.allianceID, null);
  assert.equal(info.factionID, 500001);
  assert.equal(info.titleScheme.length, 16);
});

test("GetInfoWindowDataForChar exposes the FOREIGN corp a foreign charID leaks (flagged)", () => {
  // Live: as Farmer, GetInfoWindowDataForChar(140000002) -> corp 98000000, alliance 99000000.
  const info = decodeCharInfoWindow(infoKeyVal(98000000, 99000000, 500001));
  assert.ok(info);
  assert.equal(info.corpID, 98000000);
  assert.equal(info.allianceID, 99000000);
});
