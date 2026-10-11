// A pilot's planetary launches, read by the page itself: the call as the client makes it, the rowset read, and an
// answer of nothing told from no launches.
//
// A server that could not put its answer on the wire answers the call with nothing at all (None). That is not
// "no launches": the list is a rowset even when it is empty. The read says so, so that a haul does not fly past
// a container it was never told about.

import test from "node:test";
import assert from "node:assert/strict";

import { readMyLaunches } from "./launchReads.ts";
import type { JsonValue } from "./wire.ts";

// The shape this server's gateway printed for a pilot with one launch (2026-10-09), with numbers made up.
const COLUMNS = [["launchID", 3], ["solarSystemID", 3], ["itemID", 20], ["ownerID", 3], ["planetID", 3], ["status", 17], ["launchTime", 64], ["x", 5], ["y", 5], ["z", 5]];
const DESCRIPTOR = { type: "objectex1", header: [{ type: "token", value: "blue.DBRowDescriptor" }, [COLUMNS]], list: [], dict: [] };
const rowset = (rows: unknown[][]): JsonValue => ({
  type: "objectex2",
  header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", DESCRIPTOR]] }],
  list: rows.map((values) => ({ type: "packedrow", header: DESCRIPTOR, columns: COLUMNS, values })),
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

test("a pilot's launches are asked for with nothing, and read off the rowset; an empty rowset is no launches", async () => {
  const one = asker(rowset([[1000001, 30000142, 9000000000123, 90000001, 40000001, 0, "134360000000000000", 1.5, 2.5, 3.5]]));
  const launches = await readMyLaunches(one.ask);
  // planetUISvc.py 172: sm.RemoteSvc('planetMgr').GetMyLaunchesDetails().
  assert.deepEqual(one.asked, [["planetMgr", "GetMyLaunchesDetails", [], null, null]]);
  assert.deepEqual(launches.map((launch) => [launch.launchID, launch.solarSystemID, launch.itemID, launch.ownerID, launch.planetID, launch.launchTime, launch.x, launch.y, launch.z]),
    [[1000001, 30000142, 9000000000123, 90000001, 40000001, 134360000000000000n, 1.5, 2.5, 3.5]]);
  assert.deepEqual(await readMyLaunches(asker(rowset([])).ask), []);
});

test("a launches read the server answered with nothing is unread, not no launches", async () => {
  for (const nothing of [null, undefined]) {
    await assert.rejects(readMyLaunches(asker(nothing as JsonValue | undefined).ask), /^Error: Your planet launches could not be read \(the server answered with nothing\)\.$/, String(nothing));
  }
});

test("a read that failed fails as the call failed: the caller has the call's own reason", async () => {
  const refused = Object.assign(new Error("CALL_FAILED"), { code: "CALL_FAILED" });
  await assert.rejects(readMyLaunches(asker(refused).ask), (error) => error === refused);
});
