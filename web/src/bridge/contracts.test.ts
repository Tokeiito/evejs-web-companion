// bridge/contracts.ts against the shapes contractProxy really emits.
//
// The properties that matter here are the ones a wrong guess gets silently
// wrong rather than loudly:
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
    dateIssued: long("133000000000000000"),
    dateExpired: long("134000000000000000"),
    dateAccepted: long("0"),
    dateCompleted: long("0"),
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

// --- the browse -------------------------------------------------------------

test("⚠ a SEARCH ENTRY WRAPS the contract — reading it as a row drops everything", () => {
  const result = keyVal({
    contracts: list([
      keyVal({ contract: contractRow(), items: list([]), bids: list([]) }),
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
    contracts: list([keyVal({ contract: contractRow() })]),
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
      contractRow({ contractID: 1, dateIssued: long("133000000000000000") }),
      contractRow({ contractID: 2, dateIssued: long("134000000000000000") }),
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

test("dates stay bigints — FILETIMEs exceed 2^53", () => {
  const bundle = keyVal({ contracts: list([contractRow()]) });
  const row = decodeContractList(bundle)[0];
  assert.equal(row?.dateIssued, 133000000000000000n);
  // A zero date means "has not happened yet" and decodes to null, not 0n.
  assert.equal(row?.dateAccepted, null);
});

// --- the detail --------------------------------------------------------------

test("a detail bundle decodes the contract, its items and its endpoints", () => {
  const bundle = keyVal({
    startSolarSystemName: "Jita",
    items: list([
      keyVal({ recordID: 1, itemID: 5000, itemTypeID: 34, typeID: 34, quantity: 500, inCrate: true }),
      keyVal({ recordID: 2, itemID: 5001, itemTypeID: 35, typeID: 35, quantity: 10, inCrate: false }),
    ]),
    bids: list([]),
    contract: contractRow(),
    startSolarSystemID: 30000142,
    endSolarSystemID: 30002187,
  });
  const detail = decodeContractDetail(bundle);
  assert.ok(detail);
  assert.equal(detail.contract.contractID, CONTRACT_ID);
  assert.equal(detail.items.length, 2);
  assert.equal(detail.startSolarSystemID, 30000142);
  assert.equal(detail.endSolarSystemID, 30002187);
});

test("⚠ inCrate separates what is HANDED OVER from what is ASKED FOR", () => {
  const bundle = keyVal({
    items: list([
      keyVal({ typeID: 34, quantity: 500, inCrate: true }),
      keyVal({ typeID: 35, quantity: 10, inCrate: false }),
    ]),
    contract: contractRow(),
    startSolarSystemID: 1,
    endSolarSystemID: 2,
  });
  const detail = decodeContractDetail(bundle);
  // The difference between a gift and a trade.
  assert.equal(detail?.items[0]?.inCrate, true);
  assert.equal(detail?.items[1]?.inCrate, false);
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
