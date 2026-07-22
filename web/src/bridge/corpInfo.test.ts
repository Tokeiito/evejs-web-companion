// R61 corp identity / settings / audit decoders against REAL captured bytes.
//
// The fixtures are the EXACT retail shapes captured live from Farmer (character
// 140000005, corp 98000001) through GET /api/bridge/corp on 2026-07-22:
//   • GetPublicInfo(corpID)               -> a util.KeyVal (public corp identity).
//   • GetCorporations(corpID)             -> a single util.Row (51 columns).
//   • GetCorporationIDForCharacter(charID)-> a bare INT (98000001).
//   • GetAggressionSettings(corpID)       -> a named AggressionSettings object.
//   • GetAggressionSettingsForCorps([id]) -> a per-corp dict of the same.
//   • AuditMember(memberID)               -> a 2-tuple of CRowsets, EMPTY for
//     Farmer (no seeded member events / role history) — a legitimate empty state.
//
// R7d: every id (corporationID / ceoID / creatorID / allianceID / stationID)
// survives as a numeric field for a future UI to resolve; FILETIMEs stay bigint.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpPublicInfo,
  decodeCorporationRow,
  decodeCorporationIDForCharacter,
  decodeAggressionSettings,
  decodeAggressionSettingsForCorps,
  decodeAuditMember,
} from "./corpInfo.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } } as unknown as JsonValue;
}
function long(value: string): JsonValue {
  return { type: "long", value } as unknown as JsonValue;
}

// --- GetPublicInfo (verbatim) ---------------------------------------------
const REAL_PUBLIC_INFO = keyVal([
  ["corporationID", 98000001],
  ["corporationName", "Farmer Corporation"],
  ["ticker", "TRAV"],
  ["tickerName", "TRAV"],
  ["ceoID", 140000005],
  ["creatorID", 140000005],
  ["allianceID", null],
  ["warFactionID", null],
  ["description", ""],
  ["stationID", 60003760],
  ["shares", 1000],
  ["deleted", 0],
  ["url", "http://"],
  ["taxRate", 0],
  ["loyaltyPointTaxRate", 0],
  ["friendlyFire", 0],
  ["allowWar", 1],
  ["memberCount", 2],
  ["applicationsEnabled", 1],
  ["isRecruiting", 1],
  ["shape1", 505],
  ["shape2", 415],
  ["shape3", 415],
  ["color1", null],
  ["color2", null],
  ["color3", null],
  ["typeface", null],
]);

// --- GetCorporations (verbatim util.Row) ----------------------------------
const CORP_ROW_HEADER = [
  "corporationID", "corporationName", "ticker", "tickerName", "ceoID", "creatorID",
  "allianceID", "factionID", "warFactionID", "membership", "description", "url",
  "stationID", "deleted", "taxRate", "loyaltyPointTaxRate", "friendlyFire",
  "memberCount", "memberLimit", "shares", "allowWar", "allowedMemberRaceIDs",
  "corporationType", "minimumJoinStanding", "sendCharTerminationMessage",
  "createDate", "aggressionEnableAfter", "aggressionDisableAfter", "applicationsEnabled",
  "division1", "division2", "division3", "division4", "division5", "division6", "division7",
  "walletDivision1", "walletDivision2", "walletDivision3", "walletDivision4",
  "walletDivision5", "walletDivision6", "walletDivision7",
  "shape1", "shape2", "shape3", "color1", "color2", "color3", "typeface", "isRecruiting",
];
const CORP_ROW_LINE: JsonValue[] = [
  98000001, "Farmer Corporation", "TRAV", "TRAV", 140000005, 140000005,
  null, null, null, 1, "", "http://",
  60003760, 0, 0, 0, 0,
  2, 20, 1000, 1, 2,
  0, 0, 1,
  long("134276026827950000"), long("0"), long("134276026827950000"), 1,
  "Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Division 6", "Division 7",
  "Wallet Division 1", "Wallet Division 2", "Wallet Division 3", "Wallet Division 4",
  "Wallet Division 5", "Wallet Division 6", "Wallet Division 7",
  505, 415, 415, null, null, null, null, 1,
];
const REAL_CORP_ROW: JsonValue = {
  type: "object",
  name: "util.Row",
  args: { type: "dict", entries: [["header", { type: "list", items: CORP_ROW_HEADER }], ["line", { type: "list", items: CORP_ROW_LINE }]] },
} as unknown as JsonValue;

// --- AggressionSettings (verbatim) ----------------------------------------
function aggression(enableAfter: JsonValue | null, disableAfter: JsonValue | null): JsonValue {
  return {
    type: "object",
    name: "crimewatch.corp_aggression.settings.AggressionSettings",
    args: { type: "dict", entries: [["_enableAfter", enableAfter], ["_disableAfter", disableAfter]] },
  } as unknown as JsonValue;
}
const REAL_AGGRESSION = aggression(long("0"), long("134276026827950000"));
const REAL_AGGRESSION_FOR_CORPS: JsonValue = {
  type: "dict",
  entries: [[98000001, aggression(long("0"), long("134276026827950000"))]],
} as unknown as JsonValue;

// --- AuditMember (verbatim: the real EMPTY 2-tuple of CRowsets) ------------
function emptyCrowset(columns: readonly (readonly [string, number])[]): JsonValue {
  const descriptor = { type: "objectex1", header: [{ type: "token", value: "blue.DBRowDescriptor" }, [[columns]]], list: [], dict: [] };
  return {
    type: "objectex2",
    header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", descriptor]] }],
    list: [],
    dict: [],
  } as unknown as JsonValue;
}
const REAL_AUDIT_EMPTY: JsonValue = [
  emptyCrowset([["eventID", 20], ["eventDateTime", 64], ["eventTypeID", 2], ["characterID", 3], ["corporationID", 3]]),
  emptyCrowset([["characterID", 3], ["corporationID", 3], ["changeTime", 64], ["grantable", 11], ["oldRoles", 20], ["newRoles", 20], ["issuerID", 3]]),
] as unknown as JsonValue;

test("decodeCorpPublicInfo decodes the real corp identity KeyVal", () => {
  assert.deepEqual(decodeCorpPublicInfo(REAL_PUBLIC_INFO), {
    corporationID: 98000001,
    corporationName: "Farmer Corporation",
    ticker: "TRAV",
    tickerName: "TRAV",
    ceoID: 140000005,
    creatorID: 140000005,
    allianceID: null,
    warFactionID: null,
    description: "",
    stationID: 60003760,
    shares: 1000,
    url: "http://",
    taxRate: 0,
    loyaltyPointTaxRate: 0,
    friendlyFire: 0,
    allowWar: 1,
    memberCount: 2,
    applicationsEnabled: 1,
    isRecruiting: true,
  });
});

test("decodeCorpPublicInfo keeps a zero allianceID as null (no alliance), never 0", () => {
  const info = decodeCorpPublicInfo(REAL_PUBLIC_INFO);
  assert.equal(info && info.allianceID, null);
});

test("decodeCorporationRow decodes the util.Row header/line, ids as data and FILETIMEs as bigint", () => {
  const row = decodeCorporationRow(REAL_CORP_ROW);
  assert.ok(row);
  assert.equal(row.corporationID, 98000001);
  assert.equal(row.corporationName, "Farmer Corporation");
  assert.equal(row.ceoID, 140000005);
  assert.equal(row.allianceID, null);
  assert.equal(row.factionID, null);
  assert.equal(row.memberCount, 2);
  assert.equal(row.memberLimit, 20);
  assert.equal(row.shares, 1000);
  assert.equal(row.stationID, 60003760);
  assert.equal(row.createDate, 134276026827950000n);
  assert.equal(row.aggressionEnableAfter, 0n);
  assert.equal(row.aggressionDisableAfter, 134276026827950000n);
  assert.deepEqual(row.divisionNames, ["Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Division 6", "Division 7"]);
  assert.deepEqual(row.walletDivisionNames, ["Wallet Division 1", "Wallet Division 2", "Wallet Division 3", "Wallet Division 4", "Wallet Division 5", "Wallet Division 6", "Wallet Division 7"]);
  assert.equal(row.isRecruiting, true);
});

test("decodeCorporationIDForCharacter reads the bare corp int", () => {
  assert.equal(decodeCorporationIDForCharacter(98000001), 98000001);
  assert.equal(decodeCorporationIDForCharacter(0), null);
  assert.equal(decodeCorporationIDForCharacter(null), null);
});

test("decodeAggressionSettings decodes the friendly-fire schedule as bigints", () => {
  // _enableAfter is a genuine long '0' (enabled since epoch) — 0n is data, not absent.
  assert.deepEqual(decodeAggressionSettings(REAL_AGGRESSION), {
    enableAfter: 0n,
    disableAfter: 134276026827950000n,
  });
});

test("decodeAggressionSettings carries a null side (an NPC-corp shape) as null", () => {
  assert.deepEqual(decodeAggressionSettings(aggression(null, long("0"))), {
    enableAfter: null,
    disableAfter: 0n,
  });
});

test("decodeAggressionSettingsForCorps decodes the per-corp dict", () => {
  assert.deepEqual(decodeAggressionSettingsForCorps(REAL_AGGRESSION_FOR_CORPS), [
    { corporationID: 98000001, enableAfter: 0n, disableAfter: 134276026827950000n },
  ]);
});

test("decodeAuditMember on the real empty 2-tuple is {events:[], roleHistory:[]} (legitimate empty)", () => {
  assert.deepEqual(decodeAuditMember(REAL_AUDIT_EMPTY), { events: [], roleHistory: [] });
});

test("decodeAuditMember decodes populated positional rows (shape built from the real column descriptors)", () => {
  // Farmer has no seeded audit events, so this row is synthesized from the REAL
  // column descriptors (captured above) + the handler's positional row order, to
  // prove the row reader works when data lands. buildDbRowset feeds arrays, so the
  // packedrows are POSITIONAL (values), which readRowField handles.
  const eventCols = [["eventID", 20], ["eventDateTime", 64], ["eventTypeID", 2], ["characterID", 3], ["corporationID", 3]] as const;
  const roleCols = [["characterID", 3], ["corporationID", 3], ["changeTime", 64], ["grantable", 11], ["oldRoles", 20], ["newRoles", 20], ["issuerID", 3]] as const;
  const descriptor = (cols: readonly unknown[]) => ({ type: "objectex1", header: [{ type: "token", value: "blue.DBRowDescriptor" }, [[cols]]], list: [], dict: [] });
  const crowset = (cols: readonly (readonly [string, number])[], valueRows: readonly JsonValue[][]): JsonValue => ({
    type: "objectex2",
    header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", descriptor(cols)]] }],
    list: valueRows.map((values) => ({ type: "packedrow", header: descriptor(cols), columns: cols, values })),
    dict: [],
  } as unknown as JsonValue);
  const tuple = [
    crowset(eventCols, [[42, long("134276026827950000"), 7, 140000005, 98000001]]),
    crowset(roleCols, [[140000005, 98000001, long("134276026827950000"), 1, long("0"), long("1"), 140000005]]),
  ] as unknown as JsonValue;
  assert.deepEqual(decodeAuditMember(tuple), {
    events: [{ eventID: 42, eventDateTime: 134276026827950000n, eventTypeID: 7, characterID: 140000005, corporationID: 98000001 }],
    roleHistory: [{ characterID: 140000005, corporationID: 98000001, changeTime: 134276026827950000n, grantable: true, oldRoles: "0", newRoles: "1", issuerID: 140000005 }],
  });
});

test("the corp decoders answer null/[] for a malformed value", () => {
  assert.equal(decodeCorpPublicInfo(null), null);
  assert.equal(decodeCorporationRow(42), null);
  assert.equal(decodeAggressionSettings("nope"), null);
  assert.deepEqual(decodeAggressionSettingsForCorps(null), []);
  assert.deepEqual(decodeAuditMember(null), { events: [], roleHistory: [] });
});
