// ESS (essMgr) reads decoder (goal R69) against real captured / builder-mirrored bytes.
// Farmer's highsec system has no ESS, so the live data read is `null` and both theft reads
// are empty lists. The POPULATED EssData fixture reproduces buildEssDataPayload /
// buildMainBankLinkPayload exactly (bare dict body, nested link dict, long timestamps).
// R7d: ids stay numeric; ISK values are money reals; FILETIMEs are bigint.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeEssData, decodeIsLinkedToReserveBank, decodeEssThefts } from "./ess.ts";
import type { JsonValue } from "./wire.ts";

// --- wire-shape helpers -----------------------------------------------------

function list(items: JsonValue[]): JsonValue {
  return { type: "list", items };
}
function dict(entries: [string, JsonValue][]): JsonValue {
  return { type: "dict", entries };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}

// --- GetDataForClientSolarSystem --------------------------------------------

test("decodeEssData returns null for the real no-ESS highsec system", () => {
  assert.equal(decodeEssData(null), null);
  // A non-dict value is not ESS data either.
  assert.equal(decodeEssData(list([])), null);
});

test("decodeEssData reads a populated ESS dict with an active main-bank link", () => {
  const real = dict([
    ["essID", 1040000000001],
    ["beaconID", 1040000000001],
    ["typeID", 55914],
    ["solarSystemID", 30004759],
    ["currentOutput", 1.75],
    ["mainValue", 125000000.5],
    ["reserveValue", 40000000],
    [
      "mainBankLink",
      dict([
        ["linkID", "a1b2c3"],
        ["characterID", 140000005],
        ["startedAt", long("133500000000000000")],
        ["completesAt", long("133500003600000000")],
      ]),
    ],
    ["reserveBankLastPulseInitiated", long("133500000600000000")],
    ["reserveBankPulsesRemaining", 12],
    ["reserveBankPulsesTotal", 15],
    ["reserveBankActiveLinks", 2],
  ]);
  const data = decodeEssData(real);
  assert.ok(data);
  assert.equal(data!.essID, 1040000000001);
  assert.equal(data!.typeID, 55914);
  assert.equal(data!.currentOutput, 1.75);
  // ISK values kept as money reals (2dp), not lost.
  assert.equal(data!.mainValue, 125000000.5);
  assert.equal(data!.reserveValue, 40000000);
  assert.equal(data!.reserveBankPulsesRemaining, 12);
  assert.equal(data!.reserveBankActiveLinks, 2);
  // The link carries a bigint FILETIME and the linked character's id (public in-space).
  assert.equal(data!.mainBankLink!.linkID, "a1b2c3");
  assert.equal(data!.mainBankLink!.characterID, 140000005);
  assert.equal(data!.mainBankLink!.startedAt, 133500000000000000n);
  assert.equal(data!.mainBankLink!.completesAt, 133500003600000000n);
  assert.equal(data!.reserveBankLastPulseInitiated, 133500000600000000n);
});

test("decodeEssData reads a null main-bank link and null last-pulse (no active link)", () => {
  const real = dict([
    ["essID", 1040000000002],
    ["beaconID", 1040000000002],
    ["typeID", 55914],
    ["solarSystemID", 30004760],
    ["currentOutput", 1.5],
    ["mainValue", 0],
    ["reserveValue", 0],
    ["mainBankLink", null],
    ["reserveBankLastPulseInitiated", null],
    ["reserveBankPulsesRemaining", 0],
    ["reserveBankPulsesTotal", 0],
    ["reserveBankActiveLinks", 0],
  ]);
  const data = decodeEssData(real);
  assert.equal(data!.mainBankLink, null);
  assert.equal(data!.reserveBankLastPulseInitiated, null);
  assert.equal(data!.mainValue, 0);
});

// --- IsClientLinkedToReserveBank --------------------------------------------

test("decodeIsLinkedToReserveBank reads the boolean", () => {
  assert.equal(decodeIsLinkedToReserveBank(false), false);
  assert.equal(decodeIsLinkedToReserveBank(true), true);
  assert.equal(decodeIsLinkedToReserveBank(1), true);
});

// --- GetMainBankTheftsForClientSolarSystem / GetReserveBankThefts... --------

test("decodeEssThefts returns [] for the real empty theft list and passes items through", () => {
  assert.deepEqual(decodeEssThefts(list([])), []);
  assert.deepEqual(decodeEssThefts(null), []);
  // No per-entry server builder exists (buildTheftHistoryPayload = buildList(entries)); the
  // raw items are surfaced faithfully. This world never seeds one, so this is defensive.
  const entry: JsonValue = { characterID: 140000009, amount: 5000000 };
  assert.deepEqual(decodeEssThefts(list([entry])), [entry]);
});
