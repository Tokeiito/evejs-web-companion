// A pushed session change, read for the names of what changed.

import test from "node:test";
import assert from "node:assert/strict";

import { sessionChangeNames } from "./sessionChange.ts";

test("the names of what changed, from the object both transports push", () => {
  assert.deepEqual(sessionChangeNames("OnSessionChanged", [{ stationid: [60003760, null], solarsystemid: [null, 30000142] }]), ["stationid", "solarsystemid"]);
  assert.deepEqual(sessionChangeNames("OnSessionChanged", [{}]), []);
});

test("the names of what changed, from a dict as the wire spells one", () => {
  const change = { type: "dict", entries: [["stationid", [null, 60003760]], ["shipid", [1, 2]], [7, [0, 1]]] };
  assert.deepEqual(sessionChangeNames("OnSessionChanged", [change]), ["stationid", "shipid"]);
  assert.deepEqual(sessionChangeNames("OnSessionChanged", [{ type: "dict", entries: [] }]), []);
});

test("a session change that says nothing has no names, and anything else is not a session change", () => {
  assert.deepEqual(sessionChangeNames("OnSessionChanged", []), []);
  assert.deepEqual(sessionChangeNames("OnSessionChanged", [null]), []);
  assert.deepEqual(sessionChangeNames("OnSessionChanged", ["stationid"]), []);
  assert.deepEqual(sessionChangeNames("OnSessionChanged", [["stationid"]]), []);
  assert.equal(sessionChangeNames("OnAgentMissionChange", [{ stationid: [1, 2] }]), null);
  assert.equal(sessionChangeNames(null, [{ stationid: [1, 2] }]), null);
});
