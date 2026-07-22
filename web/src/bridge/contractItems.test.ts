// R62 contractProxy bids/escrow/item decoders against REAL captured bytes.
//
// The fixtures below are the EXACT retail shapes captured live from Farmer
// (char 140000005, docked station 60000358) through GET /api/bridge/contract-items
// on 2026-07-22.
//
//   • GetItemsInDockableLocation -> POPULATED: Farmer's hangar items, wrapped in
//     a `__builtin__.set` objectex1; a fitted ship (quantity -1 singleton) and a
//     Veldspar stack (383139). itemID 9988400023309 exceeds 2^32.
//   • GetItemsInContainer(ship)  -> POPULATED: the ship's fitted modules (quantity
//     -1 singletons at slot flags), a plain list of packedrows.
//   • GetNumItemsInContainers    -> POPULATED: {9988400023309: 20}.
//   • GetMyContractEscrow / NumOutstandingContracts / GetMyBids -> EMPTY (Farmer
//     issues no contracts, holds no bids — legitimate states).
//   • GetCourierContractFromItemID(ship) -> null (the item is on no contract).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeContainerItemCounts,
  decodeContainerItems,
  decodeContractEscrow,
  decodeCourierContract,
  decodeDockableLocationItems,
  decodeMyBids,
  decodeOutstandingCounts,
} from "./contractItems.ts";
import type { JsonValue } from "./wire.ts";

// --- Real captured bytes (verbatim, trimmed to a couple of rows) ------------

const ESCROW = {"type":"object","name":"util.KeyVal","args":{"type":"dict","entries":[["iskEscrow",0],["itemsEscrow",0]]}} as unknown as JsonValue;

const MY_BIDS = {"type":"object","name":"util.KeyVal","args":{"type":"dict","entries":[["contracts",{"type":"list","items":[]}],["items",{"type":"dict","entries":[]}]]}} as unknown as JsonValue;

const OUTSTANDING = {"type":"object","name":"util.KeyVal","args":{"type":"dict","entries":[["nonCorpForMyChar",0],["myCorpTotal",0],["nonCorpForMyCorp",0],["myCharTotal",0]]}} as unknown as JsonValue;

const CONTAINER_ITEMS = {"type":"list","items":[{"type":"packedrow","header":{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]]],{"type":"list","items":[["stacksize",{"type":"token","value":"eve.common.script.sys.eveCfg.StackSize"}],["singleton",{"type":"token","value":"eve.common.script.sys.eveCfg.Singleton"}]]}],"list":[],"dict":[]},"columns":[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]],"fields":{"itemID":9988400023306,"typeID":448,"ownerID":140000005,"locationID":9988400023309,"flagID":20,"quantity":-1,"groupID":52,"categoryID":7,"customInfo":"","stacksize":1,"singleton":1}},{"type":"packedrow","header":{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]]],{"type":"list","items":[["stacksize",{"type":"token","value":"eve.common.script.sys.eveCfg.StackSize"}],["singleton",{"type":"token","value":"eve.common.script.sys.eveCfg.Singleton"}]]}],"list":[],"dict":[]},"columns":[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]],"fields":{"itemID":9988400023307,"typeID":28578,"ownerID":140000005,"locationID":9988400023309,"flagID":11,"quantity":-1,"groupID":546,"categoryID":7,"customInfo":"","stacksize":1,"singleton":1}}]} as unknown as JsonValue;

const DOCKABLE_ITEMS = {"type":"objectex1","header":[{"type":"token","value":"__builtin__.set"},[{"type":"list","items":[{"type":"packedrow","header":{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]]],{"type":"list","items":[["stacksize",{"type":"token","value":"eve.common.script.sys.eveCfg.StackSize"}],["singleton",{"type":"token","value":"eve.common.script.sys.eveCfg.Singleton"}]]}],"list":[],"dict":[]},"columns":[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]],"fields":{"itemID":9988400023309,"typeID":17480,"ownerID":140000005,"locationID":60000358,"flagID":4,"quantity":-1,"groupID":463,"categoryID":6,"customInfo":"","stacksize":1,"singleton":1}},{"type":"packedrow","header":{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]]],{"type":"list","items":[["stacksize",{"type":"token","value":"eve.common.script.sys.eveCfg.StackSize"}],["singleton",{"type":"token","value":"eve.common.script.sys.eveCfg.Singleton"}]]}],"list":[],"dict":[]},"columns":[["itemID",20],["typeID",3],["ownerID",3],["locationID",20],["flagID",2],["quantity",3],["groupID",3],["categoryID",3],["customInfo",129]],"fields":{"itemID":9988400037372,"typeID":1230,"ownerID":140000005,"locationID":60000358,"flagID":4,"quantity":383139,"groupID":462,"categoryID":25,"customInfo":"","stacksize":383139,"singleton":0}}]}]],"list":[],"dict":[]} as unknown as JsonValue;

const CONTAINER_COUNTS = {"type":"dict","entries":[[9988400023309,20]]} as unknown as JsonValue;

const COURIER_NULL = null as unknown as JsonValue;

// A populated courier contract (buildContractRow: a util.KeyVal) — the live read
// returned null (the ship is on no contract), so the populated decode is proven
// with the server's own row shape.
const COURIER_POPULATED = {"type":"object","name":"util.KeyVal","args":{"type":"dict","entries":[
  ["contractID",5000001],["type",3],["status",0],["availability",1],
  ["issuerID",140000005],["issuerCorpID",98000001],["forCorp",false],
  ["assigneeID",0],["acceptorID",0],["acceptorWalletKey",null],
  ["dateIssued",{"type":"long","value":"134290000000000000"}],
  ["dateExpired",{"type":"long","value":"134291000000000000"}],
  ["dateAccepted",{"type":"long","value":"0"}],["dateCompleted",{"type":"long","value":"0"}],
  ["numDays",7],["startStationID",60000358],["endStationID",60003760],
  ["startSolarSystemID",30000144],["endSolarSystemID",30000142],
  ["startRegionID",10000002],["endRegionID",10000002],
  ["price",0],["reward",1500000],["collateral",5000000],["volume",120],
  ["title","Haul my stuff"],["description",""],
]}} as unknown as JsonValue;

// --- Tests ------------------------------------------------------------------

test("decodeContractEscrow on the real empty escrow is {isk:'0', items:0}", () => {
  assert.deepEqual(decodeContractEscrow(ESCROW), { isk: "0", items: 0 });
});

test("decodeContractEscrow keeps ISK as a bigint-safe string (never a number)", () => {
  const populated = {"type":"object","name":"util.KeyVal","args":{"type":"dict","entries":[["iskEscrow",{"type":"long","value":"9007199254999999"}],["itemsEscrow",3]]}} as unknown as JsonValue;
  const escrow = decodeContractEscrow(populated);
  assert.equal(escrow.isk, "9007199254999999");
  assert.equal(typeof escrow.isk, "string");
  assert.equal(escrow.items, 3);
});

test("decodeOutstandingCounts decodes the four real counts", () => {
  assert.deepEqual(decodeOutstandingCounts(OUTSTANDING), {
    nonCorpForMyChar: 0, myCorpTotal: 0, nonCorpForMyCorp: 0, myCharTotal: 0,
  });
});

test("decodeMyBids on the real empty stub bundle is [] (no bidding modelled)", () => {
  assert.deepEqual(decodeMyBids(MY_BIDS), []);
});

test("decodeDockableLocationItems unwraps the __builtin__.set to the real hangar items", () => {
  const items = decodeDockableLocationItems(DOCKABLE_ITEMS);
  assert.equal(items.length, 2);
  // The fitted ship: quantity -1 on the wire, but units must be 1 (a singleton).
  assert.equal(items[0]?.itemID, 9988400023309);
  assert.equal(items[0]?.typeID, 17480);
  assert.equal(items[0]?.quantity, -1);
  assert.equal(items[0]?.units, 1);
  assert.equal(items[0]?.singleton, true);
  // The Veldspar stack: units == stacksize.
  assert.equal(items[1]?.units, 383139);
  assert.equal(items[1]?.singleton, false);
});

test("decodeDockableLocationItems keeps a >2^32 itemID exact (bigint-safe, < 2^53)", () => {
  const items = decodeDockableLocationItems(DOCKABLE_ITEMS);
  assert.equal(items[0]?.itemID, 9988400023309);
  assert.ok((items[0]?.itemID ?? 0) > 2 ** 32);
});

test("decodeDockableLocationItems on a NON-set value is [] (reading it as a list finds nothing)", () => {
  // The set wrapper is load-bearing: a bare list must NOT be read as the payload.
  assert.deepEqual(decodeDockableLocationItems({ type: "list", items: [] } as unknown as JsonValue), []);
  assert.deepEqual(decodeDockableLocationItems(null), []);
});

test("decodeContainerItems decodes the real fitted-module rows in a container", () => {
  const items = decodeContainerItems(CONTAINER_ITEMS);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.itemID, 9988400023306);
  assert.equal(items[0]?.flagID, 20);
  assert.equal(items[0]?.units, 1);
  assert.equal(items[0]?.locationID, 9988400023309);
});

test("decodeContainerItems on the real empty container list is []", () => {
  assert.deepEqual(decodeContainerItems({ type: "list", items: [] } as unknown as JsonValue), []);
});

test("decodeContainerItemCounts decodes the real containerID -> count dict", () => {
  assert.deepEqual(decodeContainerItemCounts(CONTAINER_COUNTS), [
    { containerID: 9988400023309, count: 20 },
  ]);
});

test("decodeContainerItemCounts on an empty dict is []", () => {
  assert.deepEqual(decodeContainerItemCounts({ type: "dict", entries: [] } as unknown as JsonValue), []);
});

test("decodeCourierContract on the real null is null (item on no contract)", () => {
  assert.equal(decodeCourierContract(COURIER_NULL), null);
});

test("decodeCourierContract decodes a populated courier contract row", () => {
  const contract = decodeCourierContract(COURIER_POPULATED);
  assert.equal(contract?.contractID, 5000001);
  assert.equal(contract?.type, 3);
  // ISK fields stay decimal strings (bigint-safe, R7d).
  assert.equal(contract?.reward, "1500000");
  assert.equal(contract?.collateral, "5000000");
  // FILETIME decoded to a bigint.
  assert.equal(contract?.dateIssued, 134290000000000000n);
});
