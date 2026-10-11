// Where a pilot's things are, read by the page itself: the call as the client makes it, the stations read off the
// rowset, "owns nothing" said only of a rowset read and empty, and an answer that is no rowset told from that.

import test from "node:test";
import assert from "node:assert/strict";

import { readAssetStationItems, readAssetStations } from "./assetReads.ts";
import type { JsonValue } from "./wire.ts";

// The form this server's charMgr printed (a CRowset whose rows are positional packed rows, on `list`), with
// numbers made up.
const COLUMNS = [["stationID", 20], ["solarSystemID", 20], ["typeID", 3], ["itemCount", 3], ["upkeepState", 17]];
const rowset = (rows: unknown[][]): JsonValue => ({
  type: "objectex2",
  header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", { type: "objectex1", header: [], list: [], dict: [] }]] }],
  list: rows.map((values) => ({ type: "packedrow", header: { type: "objectex1", header: [], list: [], dict: [] }, columns: COLUMNS, values })),
  dict: [],
}) as unknown as JsonValue;

function asker(answer: JsonValue | Error | undefined) {
  const asked: unknown[] = [];
  const ask = async (service: string, method: string, args: readonly JsonValue[], kwargs?: unknown, of?: unknown) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    if (answer instanceof Error) throw answer;
    return answer as JsonValue;
  };
  return { ask, asked };
}

test("where a pilot's things are is asked with nothing, of no object the page names, and read off the rowset", async () => {
  const one = asker(rowset([[60000002, 30000002, 1529, 4, null], [60000001, 30000001, 52678, 9, null]]));
  const read = await readAssetStations(one.ask);
  // assetsWindow.py 923: sm.GetService('invCache').GetInventory(const.containerGlobal).ListStations(), which is
  // invCache.py 833: self.moniker.ListStations(). The object is the pilot's own; the page says nothing of which.
  assert.deepEqual(one.asked, [["charMgr", "ListStations", [], null, null]]);
  assert.deepEqual(read.stations.map((row) => [row.stationID, row.solarSystemID, row.typeID, row.itemCount]), [[60000001, 30000001, 52678, 9], [60000002, 30000002, 1529, 4]]);
  assert.equal(read.ownsNothing, false);
});

test("a pilot owns nothing where the rowset was read and has no rows, and only there", async () => {
  assert.deepEqual(await readAssetStations(asker(rowset([])).ask), { stations: [], ownsNothing: true });
  // Rows the page can make nothing of are not nothing owned: the server listed something.
  assert.deepEqual(await readAssetStations(asker(rowset([[0, 30000001, 52678, 9, null]])).ask), { stations: [], ownsNothing: false });
});

test("an answer that is no rowset is the pilot's things unread, not nothing owned", async () => {
  const answers: Array<[string, unknown]> = [["nothing", null], ["nothing at all", undefined], ["a list", { type: "list", items: [] }], ["an array", []], ["a number", 0], ["a rowset with no rows of its own", { type: "objectex2", header: [], dict: [] }]];
  for (const [what, answer] of answers) {
    await assert.rejects(readAssetStations(asker(answer as JsonValue | undefined).ask), /^Error: Your assets could not be read \(the server did not answer with its rowset\)\.$/, what);
  }
});

test("a read that failed fails as the call failed: the caller has the call's own reason", async () => {
  const refused = Object.assign(new Error("CALL_FAILED"), { code: "CALL_FAILED" });
  await assert.rejects(readAssetStations(asker(refused).ask), (error) => error === refused);
});

// --- what is at one station ---------------------------------------------------

// The form this server's charMgr printed: a plain list whose rows are name-keyed packed rows. Numbers made up.
const item = (fields: Record<string, unknown>): JsonValue => ({ type: "packedrow", header: { type: "objectex1", header: [], list: [], dict: [] }, columns: [], fields }) as unknown as JsonValue;
const listOf = (...rows: readonly JsonValue[]): JsonValue => ({ type: "list", items: rows }) as unknown as JsonValue;
const STACK = item({ itemID: 9000000000001, typeID: 34, ownerID: 90000001, locationID: 60000001, flagID: 4, quantity: 12, groupID: 18, categoryID: 4, customInfo: "", singleton: 0, stacksize: 12 });

test("what is at a station is asked with the station alone, of no object the page names, and handed on as the list it is", async () => {
  const one = asker(listOf(STACK));
  const read = await readAssetStationItems(one.ask, 60000001);
  // assetsWindow.py 745: ...GetInventory(const.containerGlobal).ListStationItems(locationID), which is
  // invCache.py 849: self.moniker.ListStationItems(stationID).
  assert.deepEqual(one.asked, [["charMgr", "ListStationItems", [60000001], null, null]]);
  assert.deepEqual(read, { listed: listOf(STACK), hasNoItems: false });
  // A station is empty where the list was read and has no rows, and only there.
  assert.deepEqual(await readAssetStationItems(asker(listOf()).ask, 60000001), { listed: listOf(), hasNoItems: true });
});

test("what is no station is asked of nobody", async () => {
  for (const station of [0, -60000001, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, "60000001", null]) {
    const none = asker(listOf(STACK));
    await assert.rejects(readAssetStationItems(none.ask, station as number), /^Error: No location was named\.$/, String(station));
    assert.deepEqual(none.asked, [], String(station));
  }
});

test("an answer that is no list is the station unread, not an empty station", async () => {
  const answers: Array<[string, unknown]> = [["nothing", null], ["nothing at all", undefined], ["a rowset", rowset([])], ["an array", []], ["a number", 0], ["a list with no rows of its own", { type: "list" }], ["a dict", { type: "dict", items: [] }]];
  for (const [what, answer] of answers) {
    await assert.rejects(readAssetStationItems(asker(answer as JsonValue | undefined).ask, 60000001), /^Error: What is stored there could not be read \(the server did not answer with a list\)\.$/, what);
  }
});

test("a station's read that failed fails as the call failed", async () => {
  const refused = Object.assign(new Error("CALL_REFUSED"), { code: "CALL_REFUSED" });
  await assert.rejects(readAssetStationItems(asker(refused).ask, 60000001), (error) => error === refused);
});
