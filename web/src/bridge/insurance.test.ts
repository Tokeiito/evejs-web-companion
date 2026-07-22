// Ship-insurance decoders (goal R65) against REAL captured bytes.
//
// Captured live from Farmer (character 140000005, corp 98000001) through
// POST /api/bridge/call on 2026-07-22:
//   • insuranceSvc.GetContracts()            -> {type:"list", items:[]}  (Farmer
//       has no ship currently insured — a REAL empty state, not a failure).
//   • insuranceSvc.GetContractForShip(shipID) -> null  (both the char's own active
//       ship AND an un-owned itemID answered null; canSessionSeeContract gates it,
//       so an un-owned ship never leaks another owner's policy).
//   • insuranceSvc.GetInsurancePrice(587)  -> 195117        (a bare JSON number)
//   • insuranceSvc.GetInsurancePrice(638)  -> 110653546     (a bare JSON number)
//   • insuranceSvc.GetInsurancePrices([587,638,640])
//         -> {type:"dict", entries:[[587,195117],[638,110653546],[640,82991168]]}.
//
// ⚠ A NON-EMPTY GetContracts / GetContractForShip row could not be captured
// without INSURING a ship first (InsureShip is a WRITE, out of scope for this
// reads-only batch). The populated-row fixture below is therefore built to the
// EXACT shape of the server's buildClientContract (eve.js
// server/src/services/insurance/insuranceRuntime.js:434-448): a util.KeyVal with
// contractID / shipID / typeID / ownerID / fraction / startDate / endDate, where
// startDate & endDate are buildFiletimeLong ({type:"long", value:"<FILETIME>"} —
// the same long wrapper the live bookmark `created` field confirmed on this wire).
//
// R7d: contractID / shipID / typeID / ownerID stay plain numeric fields for a
// future UI to resolve; the decoder renders nothing.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeInsuranceContract,
  decodeInsuranceContracts,
  decodeInsurancePrice,
  decodeInsurancePrices,
} from "./insurance.ts";
import type { JsonValue } from "./wire.ts";

// A populated contract row, in the buildClientContract shape (fraction 0.75 = the
// "standard" insurance package; startDate/endDate are long FILETIMEs > 2^53).
const CONTRACT_ROW: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["contractID", 4211],
      ["shipID", 9988400023309],
      ["typeID", 638],
      ["ownerID", 140000005],
      ["fraction", 0.75],
      ["startDate", { type: "long", value: "134292024069930000" }],
      ["endDate", { type: "long", value: "134366424069930000" }],
    ],
  },
};

test("decodeInsuranceContracts on the real empty list is [] (no ship insured)", () => {
  assert.deepEqual(decodeInsuranceContracts({ type: "list", items: [] }), []);
});

test("decodeInsuranceContracts decodes a populated policy row (buildClientContract shape)", () => {
  const rows = decodeInsuranceContracts({ type: "list", items: [CONTRACT_ROW] });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row!.contractID, 4211);
  assert.equal(row!.shipID, 9988400023309);
  assert.equal(row!.typeID, 638);
  assert.equal(row!.ownerID, 140000005);
  assert.equal(row!.fraction, 0.75);
  // FILETIMEs survive as bigints (they exceed 2^53).
  assert.equal(row!.startDate, 134292024069930000n);
  assert.equal(row!.endDate, 134366424069930000n);
});

test("decodeInsuranceContract reads a single policy KeyVal, and null stays null", () => {
  // GetContractForShip answers null for a ship with no (visible) policy — the
  // real captured answer for both an owned and an un-owned shipID.
  assert.equal(decodeInsuranceContract(null), null);
  const row = decodeInsuranceContract(CONTRACT_ROW);
  assert.equal(row!.contractID, 4211);
  assert.equal(row!.endDate, 134366424069930000n);
});

test("decodeInsurancePrice reads the bare-number premium (real capture)", () => {
  assert.equal(decodeInsurancePrice(195117), 195117);
  assert.equal(decodeInsurancePrice(110653546), 110653546);
  // Absent / non-numeric answers null rather than a substituted zero.
  assert.equal(decodeInsurancePrice(null), null);
});

test("decodeInsurancePrices decodes the real {typeID -> price} dict, sorted by typeID", () => {
  const prices = decodeInsurancePrices({
    type: "dict",
    entries: [
      [638, 110653546],
      [587, 195117],
      [640, 82991168],
    ],
  });
  assert.deepEqual(prices, [
    { typeID: 587, price: 195117 },
    { typeID: 638, price: 110653546 },
    { typeID: 640, price: 82991168 },
  ]);
});

test("decodeInsurancePrices on an empty dict is [] (a real 'no prices asked')", () => {
  assert.deepEqual(decodeInsurancePrices({ type: "dict", entries: [] }), []);
});
