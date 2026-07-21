// bridge/contracts.ts against the shapes contractProxy really emits.
//
// The properties that matter here are the ones a wrong guess gets silently
// wrong rather than loudly:
//  - THE LIST AND THE DETAIL SEND DIFFERENT ROW SHAPES. `buildContractRow`
//    (contractProxyService.js:248) returns a util.KeyVal; but
//    `buildContractDetailContractRow` (:337) returns a PACKEDROW, and so does
//    `buildContractDetailItemRow` (:381). The packed detail row is what the
//    detail bundle carries AND what every search entry's `contract` is.
//    Reading a packedrow with readKeyVal finds no field at all, so the row
//    decodes to null and the detail panel renders an absence — which is why
//    the fixtures below build each row the way its own builder builds it, and
//    not whichever shape is convenient;
//  - A SEARCH ENTRY WRAPS the contract (entry.contract) while a LIST BUNDLE
//    carries rows directly. Reading a search entry as a row finds no
//    contractID and drops every result — an empty browse indistinguishable
//    from the genuinely empty world;
//  - ISK stays a DECIMAL STRING the whole way, because it exceeds 2^53 and a
//    JS number would round it before it reached the screen;
//  - a zero assigneeID means "open to anyone", a real state, not a bad id;
//  - `maxResults` is NOT read, because it lies about the page stride.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_TYPE_COURIER,
  contractRefusalMessage,
  contractStatusLabel,
  contractTypeLabel,
  decodeContractDetail,
  decodeContractList,
  decodeContractSearch,
  decodeContractSummary,
  formatIsk,
  formatVolume,
} from "./contracts.ts";
import type { JsonValue } from "./wire.ts";

const CONTRACT_ID = 8100;
const ISSUER_ID = 140000009;
const START_STATION = 60003760;
const END_STATION = 60008494;

function long(value: string): JsonValue {
  return { type: "long", value } as unknown as JsonValue;
}

/**
 * A FILETIME exactly as it reaches the browser: a BARE DECIMAL STRING.
 *
 * ⚠ NOT a `{type:"long"}` wrapper. The server holds these as BigInt and the
 * gateway's `encodeJsonSafeCallValue` renders every BigInt as a plain decimal
 * string, so that is what is on the wire. Fixtures that used the wrapper were
 * asserting against a shape the server never sends (R32).
 */
function filetime(value: string): JsonValue {
  return value as unknown as JsonValue;
}

function list(items: readonly unknown[]): JsonValue {
  return { type: "list", items } as unknown as JsonValue;
}

function keyVal(fields: Record<string, unknown>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

/**
 * A blue.DBRow as `buildPackedRow` (serviceHelpers.js:110) really emits it:
 * a descriptor header, the column list, and a name-keyed `fields` object.
 * Deliberately NOT a util.KeyVal — that is the whole point of these fixtures.
 */
function packedRow(
  columns: readonly (readonly [string, number])[],
  fields: Record<string, unknown>,
): JsonValue {
  return {
    type: "packedrow",
    header: {
      type: "objectex1",
      header: [{ type: "token", value: "blue.DBRowDescriptor" }, [columns]],
      list: [],
      dict: [],
    },
    columns,
    fields,
  } as unknown as JsonValue;
}

/** CONTRACT_DETAIL_ROW_DESCRIPTOR_COLUMNS, verbatim (contractProxyService.js:54). */
const DETAIL_ROW_COLUMNS = [
  ["contractID", 3], ["type", 3], ["issuerID", 3], ["issuerCorpID", 3],
  ["forCorp", 11], ["availability", 3], ["assigneeID", 3], ["acceptorID", 3],
  ["dateIssued", 64], ["dateExpired", 64], ["dateAccepted", 64],
  ["dateCompleted", 64], ["dateDeleted", 64], ["startStationID", 20],
  ["startSolarSystemID", 3], ["startRegionID", 3], ["endStationID", 20],
  ["endSolarSystemID", 3], ["endRegionID", 3], ["price", 5], ["reward", 5],
  ["collateral", 5], ["title", 130], ["description", 130], ["status", 3],
  ["crateID", 20], ["volume", 5], ["startStationDivision", 3],
  ["issuerWalletKey", 3], ["acceptorWalletKey", 3],
] as const satisfies readonly (readonly [string, number])[];

/** CONTRACT_DETAIL_ITEM_ROW_DESCRIPTOR_COLUMNS, verbatim (:86). */
const DETAIL_ITEM_COLUMNS = [
  ["contractID", 3], ["itemID", 20], ["quantity", 3], ["itemTypeID", 3],
  ["inCrate", 11], ["parentID", 20], ["productivityLevel", 3],
  ["materialLevel", 3], ["copy", 3], ["licensedProductionRunsRemaining", 3],
  ["damage", 5], ["flagID", 3], ["recordID", 20],
] as const satisfies readonly (readonly [string, number])[];

function rowset(columns: readonly string[], lines: readonly unknown[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: { type: "dict", entries: [["columns", list(columns)], ["lines", list(lines)]] },
  } as unknown as JsonValue;
}

function contractRow(overrides: Record<string, unknown> = {}): JsonValue {
  return keyVal({
    contractID: CONTRACT_ID,
    type: CONTRACT_TYPE_COURIER,
    status: 0,
    availability: 0,
    issuerID: ISSUER_ID,
    issuerCorpID: 98000000,
    forCorp: false,
    assigneeID: 0,
    acceptorID: 0,
    dateIssued: filetime("133000000000000000"),
    dateExpired: filetime("134000000000000000"),
    dateAccepted: filetime("0"),
    dateCompleted: filetime("0"),
    numDays: 7,
    startStationID: START_STATION,
    endStationID: END_STATION,
    startSolarSystemID: 30000142,
    endSolarSystemID: 30002187,
    price: 0,
    reward: 2500000,
    collateral: 10000000,
    volume: 1200,
    title: "Ore run",
    description: "Take the ore to Amarr.",
    ...overrides,
  });
}

/**
 * The row the DETAIL bundle and every SEARCH entry actually carry —
 * `buildContractDetailContractRow` (contractProxyService.js:337), field for
 * field. It is a packedrow, and it is a DIFFERENT set of columns from the list
 * row: it adds regions, the crate and the wallet keys, and it carries no
 * `numDays` at all.
 */
function detailContractRow(overrides: Record<string, unknown> = {}): JsonValue {
  return packedRow(DETAIL_ROW_COLUMNS, {
    contractID: CONTRACT_ID,
    type: CONTRACT_TYPE_COURIER,
    issuerID: ISSUER_ID,
    issuerCorpID: 98000000,
    forCorp: false,
    availability: 0,
    assigneeID: 0,
    acceptorID: 0,
    dateIssued: filetime("133000000000000000"),
    dateExpired: filetime("134000000000000000"),
    dateAccepted: filetime("0"),
    dateCompleted: filetime("0"),
    dateDeleted: filetime("0"),
    startStationID: START_STATION,
    startSolarSystemID: 30000142,
    startRegionID: 10000002,
    endStationID: END_STATION,
    endSolarSystemID: 30002187,
    endRegionID: 10000043,
    price: 0,
    reward: 2500000,
    collateral: 10000000,
    title: "Ore run",
    description: "Take the ore to Amarr.",
    status: 0,
    crateID: 0,
    volume: 1200,
    startStationDivision: null,
    issuerWalletKey: null,
    acceptorWalletKey: null,
    ...overrides,
  });
}

/**
 * A detail ITEM row — `buildContractDetailItemRow` (:381). Also a packedrow,
 * and note it names the type `itemTypeID`: there is NO `typeID` column here,
 * unlike the list bundle's KeyVal item rows.
 */
function detailItemRow(overrides: Record<string, unknown> = {}): JsonValue {
  return packedRow(DETAIL_ITEM_COLUMNS, {
    contractID: CONTRACT_ID,
    itemID: 5000,
    quantity: 500,
    itemTypeID: 34,
    inCrate: true,
    parentID: 0,
    productivityLevel: null,
    materialLevel: null,
    copy: null,
    licensedProductionRunsRemaining: null,
    damage: null,
    flagID: 0,
    recordID: 1,
    ...overrides,
  });
}

// --- the browse -------------------------------------------------------------

test("⚠ a SEARCH ENTRY WRAPS the contract — reading it as a row drops everything", () => {
  const result = keyVal({
    contracts: list([
      keyVal({ contract: detailContractRow(), items: list([]), bids: list([]) }),
    ]),
    numFound: 1,
    searchTime: 0,
    maxResults: 1000,
  });
  const { contracts, numFound } = decodeContractSearch(result);
  assert.equal(contracts.length, 1, "the nested contract must be unwrapped");
  assert.equal(contracts[0]?.contractID, CONTRACT_ID);
  assert.equal(numFound, 1);
});

test("an empty browse decodes to no contracts and numFound 0", () => {
  const result = keyVal({
    contracts: list([]),
    numFound: 0,
    searchTime: 0,
    maxResults: 1000,
  });
  const { contracts, numFound } = decodeContractSearch(result);
  assert.deepEqual(contracts, []);
  assert.equal(numFound, 0);
});

test("numFound is the TOTAL across pages, not the page length", () => {
  const result = keyVal({
    contracts: list([keyVal({ contract: detailContractRow() })]),
    numFound: 420,
    maxResults: 1000,
  });
  const { contracts, numFound } = decodeContractSearch(result);
  assert.equal(contracts.length, 1);
  assert.equal(numFound, 420, "so the panel can say 'showing 1 of 420'");
});

test("a malformed browse decodes to nothing rather than throwing", () => {
  assert.deepEqual(decodeContractSearch(null).contracts, []);
  assert.deepEqual(decodeContractSearch("nonsense" as unknown as JsonValue).contracts, []);
});

// --- the list bundle --------------------------------------------------------

test("a LIST BUNDLE carries contract rows directly, not wrapped", () => {
  const bundle = keyVal({
    contracts: list([contractRow()]),
    items: { type: "dict", entries: [] },
  });
  const rows = decodeContractList(bundle);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.contractID, CONTRACT_ID);
  assert.equal(rows[0]?.title, "Ore run");
});

test("contracts sort newest-issued first", () => {
  const bundle = keyVal({
    contracts: list([
      contractRow({ contractID: 1, dateIssued: filetime("133000000000000000") }),
      contractRow({ contractID: 2, dateIssued: filetime("134000000000000000") }),
    ]),
  });
  assert.deepEqual(
    decodeContractList(bundle).map((row) => row.contractID),
    [2, 1],
  );
});

// --- the fields that a wrong guess would corrupt ----------------------------

test("⚠ ISK stays a DECIMAL STRING — it exceeds 2^53", () => {
  const bundle = keyVal({
    contracts: list([
      contractRow({
        reward: long("9007199254740993"), // 2^53 + 1
        collateral: long("123456789012345678"),
      }),
    ]),
  });
  const row = decodeContractList(bundle)[0];
  assert.equal(
    row?.reward,
    "9007199254740993",
    "a JS number would have rounded this to 9007199254740992",
  );
  assert.equal(row?.collateral, "123456789012345678");
});

test("⚠ a zero assigneeID means OPEN TO ANYONE — a real state, not a bad id", () => {
  const bundle = keyVal({ contracts: list([contractRow({ assigneeID: 0, acceptorID: 0 })]) });
  const row = decodeContractList(bundle)[0];
  assert.equal(row?.assigneeID, null, "so the panel shows no 'reserved for' line at all");
  assert.equal(row?.acceptorID, null);
});

test("a real assignee and acceptor survive decoding", () => {
  const bundle = keyVal({
    contracts: list([contractRow({ assigneeID: 555, acceptorID: 666 })]),
  });
  const row = decodeContractList(bundle)[0];
  assert.equal(row?.assigneeID, 555);
  assert.equal(row?.acceptorID, 666);
});

test("⚠ a FILETIME arrives as a BARE DECIMAL STRING, not a {type:'long'} wrapper", () => {
  // The gateway renders every BigInt as a plain decimal string, so this is the
  // only date shape the browser ever sees. Reading it as a long wrapper dated
  // every contract to null — a detail panel with no expiry on it.
  const detail = decodeContractDetail(
    keyVal({ contract: detailContractRow(), items: list([]) }),
  );
  assert.equal(detail?.contract.dateIssued, 133000000000000000n);
  assert.equal(detail?.contract.dateExpired, 134000000000000000n);
  // Zero still means "has not happened yet", not the epoch.
  assert.equal(detail?.contract.dateAccepted, null);
});

test("the {type:'long'} wrapper is still accepted — the contract allows both", () => {
  const bundle = keyVal({
    contracts: list([contractRow({ dateIssued: long("133000000000000000") })]),
  });
  assert.equal(decodeContractList(bundle)[0]?.dateIssued, 133000000000000000n);
});

test("dates stay bigints — FILETIMEs exceed 2^53", () => {
  const bundle = keyVal({ contracts: list([contractRow()]) });
  const row = decodeContractList(bundle)[0];
  assert.equal(row?.dateIssued, 133000000000000000n);
  // A zero date means "has not happened yet" and decodes to null, not 0n.
  assert.equal(row?.dateAccepted, null);
});

// --- the detail --------------------------------------------------------------

test("⚠ THE DETAIL ROW IS A PACKEDROW — reading it as a KeyVal drops the contract", () => {
  const bundle = keyVal({
    startSolarSystemName: "Jita",
    items: list([detailItemRow(), detailItemRow({ recordID: 2, itemID: 5001, itemTypeID: 35, quantity: 10, inCrate: false })]),
    bids: list([]),
    contract: detailContractRow(),
    startSolarSystemID: 30000142,
    endSolarSystemID: 30002187,
  });
  const detail = decodeContractDetail(bundle);
  // Before R32 this was null: every readKeyVal against the packed row returned
  // undefined, contractID fell to 0, and decodeContractRow bailed.
  assert.ok(detail, "the packed detail row must decode, not vanish");
  assert.equal(detail.contract.contractID, CONTRACT_ID);
  assert.equal(detail.items.length, 2);
  assert.equal(detail.startSolarSystemID, 30000142);
  assert.equal(detail.endSolarSystemID, 30002187);
});

test("⚠ the packed detail row's FIELDS survive, not merely its id", () => {
  const detail = decodeContractDetail(
    keyVal({ contract: detailContractRow(), items: list([]), startSolarSystemID: 30000142, endSolarSystemID: 30002187 }),
  );
  const row = detail?.contract;
  assert.ok(row);
  assert.equal(row.type, CONTRACT_TYPE_COURIER);
  assert.equal(row.issuerID, ISSUER_ID);
  assert.equal(row.title, "Ore run");
  assert.equal(row.description, "Take the ore to Amarr.");
  assert.equal(row.startStationID, START_STATION);
  assert.equal(row.endStationID, END_STATION);
  assert.equal(row.volume, 1200);
  assert.equal(row.dateIssued, 133000000000000000n);
  assert.equal(row.dateAccepted, null);
  // ISK off a packed row is still a decimal string, not a JS number.
  assert.equal(row.reward, "2500000");
  assert.equal(row.collateral, "10000000");
});

test("⚠ ISK beyond 2^53 survives the PACKED row too", () => {
  const detail = decodeContractDetail(
    keyVal({ contract: detailContractRow({ reward: long("9007199254740993") }), items: list([]) }),
  );
  assert.equal(detail?.contract.reward, "9007199254740993");
});

test("⚠ DETAIL ITEM ROWS ARE PACKEDROWS TOO, and name the type `itemTypeID`", () => {
  const detail = decodeContractDetail(
    keyVal({ contract: detailContractRow(), items: list([detailItemRow()]) }),
  );
  // There is no `typeID` column on this row at all — only `itemTypeID`.
  assert.equal(detail?.items.length, 1, "a packed item row must not be dropped");
  assert.equal(detail?.items[0]?.typeID, 34);
  assert.equal(detail?.items[0]?.quantity, 500);
});

test("⚠ inCrate separates what is HANDED OVER from what is ASKED FOR", () => {
  const bundle = keyVal({
    items: list([
      detailItemRow({ itemTypeID: 34, quantity: 500, inCrate: true }),
      detailItemRow({ itemTypeID: 35, quantity: 10, inCrate: false }),
    ]),
    contract: detailContractRow(),
    startSolarSystemID: 1,
    endSolarSystemID: 2,
  });
  const detail = decodeContractDetail(bundle);
  // The difference between a gift and a trade.
  assert.equal(detail?.items.length, 2);
  assert.equal(detail?.items[0]?.inCrate, true);
  assert.equal(detail?.items[1]?.inCrate, false);
});

test("the LIST bundle's item rows are still KeyVals, and still decode", () => {
  const detail = decodeContractDetail(
    keyVal({
      contract: detailContractRow(),
      items: list([keyVal({ recordID: 1, itemID: 5000, typeID: 34, quantity: 7, inCrate: true })]),
    }),
  );
  assert.equal(detail?.items[0]?.typeID, 34, "both row shapes must decode, not one");
  assert.equal(detail?.items[0]?.quantity, 7);
});

test("a detail bundle with no contract decodes to null", () => {
  assert.equal(decodeContractDetail(null), null);
  assert.equal(decodeContractDetail(keyVal({ items: list([]) })), null);
});

// --- the summary -------------------------------------------------------------

test("⚠ the summary arms are ROWSETS — the counts come from `lines`", () => {
  const info = keyVal({
    needsAttention: rowset(["contractID", "state"], [list([1, 0]), list([2, 0])]),
    inProgress: rowset(["contractID", "startStationID", "endStationID", "expires"], [list([3, 0, 0, 0])]),
    assignedToMe: rowset(["contractID", "issuerID"], []),
  });
  const summary = decodeContractSummary(info);
  assert.equal(summary.needsAttention, 2);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.assignedToMe, 0);
});

test("an empty summary decodes to zeros rather than throwing", () => {
  assert.deepEqual(decodeContractSummary(null), {
    needsAttention: 0,
    inProgress: 0,
    assignedToMe: 0,
  });
});

// --- labels and formatting ---------------------------------------------------

test("contract kinds and statuses read as words, never codes", () => {
  assert.equal(contractTypeLabel(3), "Delivery job");
  assert.equal(contractTypeLabel(1), "Item trade");
  assert.equal(contractStatusLabel(0), "Waiting for someone to take it");
  assert.equal(contractStatusLabel(4), "Finished");
  assert.equal(contractStatusLabel(-1), "Needs your attention");
  // An unknown code still reads as a word, never as a number.
  assert.equal(contractStatusLabel(99), "Unknown");
});

test("ISK formats from a decimal string without going through a JS number", () => {
  assert.equal(formatIsk("2500000"), "2,500,000.00 ISK");
  assert.equal(formatIsk("9007199254740993"), "9,007,199,254,740,993.00 ISK");
  assert.equal(formatIsk(null), "—");
  assert.equal(formatIsk(""), "—");
});

test("a cargo volume reads in cubic metres", () => {
  assert.equal(formatVolume(1200), "1,200 m³");
  assert.equal(formatVolume(0), "—");
});

// --- refusals ----------------------------------------------------------------

test("a known refusal becomes a sentence a player can act on", () => {
  assert.match(
    contractRefusalMessage(Object.assign(new Error("x"), { code: "CONTRACT_NOT_FOUND" })),
    /no longer available/,
  );
});

test("⚠ an UNMAPPED refusal is passed through verbatim, never reworded", () => {
  const error = Object.assign(new Error("ConSomethingUnanticipated"), {
    code: "ConSomethingUnanticipated",
  });
  assert.equal(contractRefusalMessage(error), "ConSomethingUnanticipated");
});
