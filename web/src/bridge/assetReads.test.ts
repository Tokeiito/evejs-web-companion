// Where a pilot's things are, read by the page itself: the call as the client makes it, the stations read off the
// rowset, "owns nothing" said only of a rowset read and empty, and an answer that is no rowset told from that.

import test from "node:test";
import assert from "node:assert/strict";

import { readAssetStations } from "./assetReads.ts";
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
