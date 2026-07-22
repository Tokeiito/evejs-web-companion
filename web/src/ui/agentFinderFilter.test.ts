// The Agent Finder's client-side row filters (goal R52 "within N jumps" +
// R6a text search): a pure derivation over rows the flow already fetched and
// jump-annotated. The BFS that PRODUCES `jumps` is covered in the flow/route
// tests; here we pin only the filter's own rules.

import test from "node:test";
import assert from "node:assert/strict";

import { filterFinderRows, parseJumpsLimit } from "./agentFinderFilter.ts";
import type { AgentFinderRow } from "../store/types.ts";

// A minimal row builder — only the fields the filters read matter.
function row(over: Partial<AgentFinderRow> & Pick<AgentFinderRow, "agentID">): AgentFinderRow {
  return {
    name: `Agent ${over.agentID}`,
    level: 1,
    missionKind: "courier",
    missionTypeLabel: null,
    corporationID: null,
    factionID: null,
    stationID: 60000000 + over.agentID,
    stationName: "A Station",
    solarSystemID: 30000000 + over.agentID,
    solarSystemName: "A System",
    jumps: 0,
    ...over,
  };
}

// A small spread of distances: here (0), near (3), far (12), unreachable (null).
const HERE = row({ agentID: 1, name: "Local Agent", jumps: 0, solarSystemName: "Jita" });
const NEAR = row({ agentID: 2, name: "Near Agent", jumps: 3, solarSystemName: "Perimeter" });
const FAR = row({ agentID: 3, name: "Far Agent", jumps: 12, solarSystemName: "Amarr" });
const GONE = row({ agentID: 4, name: "Island Agent", jumps: null, solarSystemName: "Island" });
const ALL = [HERE, NEAR, FAR, GONE];

function ids(rows: readonly AgentFinderRow[]): number[] {
  return rows.map((r) => r.agentID);
}

// --- parseJumpsLimit: reading the input into an opt-in limit ---------------

test("a blank or whitespace jumps input is no limit (null), NOT zero", () => {
  // Number("") is 0, so a naive parse would collapse a blank field to "0 jumps"
  // and hide every agent that isn't in-system. The blank must read as "no filter".
  assert.equal(parseJumpsLimit(""), null);
  assert.equal(parseJumpsLimit("   "), null);
});

test("a non-negative number parses to that limit; 0 is a real limit", () => {
  assert.equal(parseJumpsLimit("0"), 0);
  assert.equal(parseJumpsLimit("10"), 10);
  assert.equal(parseJumpsLimit("  30 "), 30);
});

test("a negative or non-numeric jumps input is no limit rather than exclude-all", () => {
  assert.equal(parseJumpsLimit("-5"), null);
  assert.equal(parseJumpsLimit("abc"), null);
});

// --- filterFinderRows: the jumps limit -------------------------------------

test("an agent 12 jumps away is hidden at limit 10 and shown at limit 30", () => {
  const at10 = filterFinderRows(ALL, { jumpsLimit: 10, searchText: "" });
  assert.ok(!ids(at10).includes(FAR.agentID), "12-jump agent hidden at limit 10");

  const at30 = filterFinderRows(ALL, { jumpsLimit: 30, searchText: "" });
  assert.ok(ids(at30).includes(FAR.agentID), "12-jump agent shown at limit 30");
});

test("an unreachable agent is hidden when a limit is active and shown when it isn't", () => {
  const limited = filterFinderRows(ALL, { jumpsLimit: 30, searchText: "" });
  assert.ok(!ids(limited).includes(GONE.agentID), "null-jumps agent excluded under a limit");

  const unlimited = filterFinderRows(ALL, { jumpsLimit: null, searchText: "" });
  assert.ok(ids(unlimited).includes(GONE.agentID), "null-jumps agent shown with no limit");
});

test("a same-system agent (0 jumps) passes any limit >= 0", () => {
  assert.ok(ids(filterFinderRows(ALL, { jumpsLimit: 0, searchText: "" })).includes(HERE.agentID));
  assert.ok(ids(filterFinderRows(ALL, { jumpsLimit: 5, searchText: "" })).includes(HERE.agentID));
  // At limit 0, ONLY the same-system agent survives (near/far/unreachable gone).
  assert.deepEqual(ids(filterFinderRows(ALL, { jumpsLimit: 0, searchText: "" })), [HERE.agentID]);
});

test("a blank limit shows all rows including the unreachable one (opt-in)", () => {
  const all = filterFinderRows(ALL, { jumpsLimit: parseJumpsLimit(""), searchText: "" });
  assert.deepEqual(ids(all), [HERE.agentID, NEAR.agentID, FAR.agentID, GONE.agentID]);
});

// --- filterFinderRows: composition with the text search --------------------

test("the jumps filter and text filter both apply (AND), preserving order", () => {
  // Limit 10 drops Far(12) and Island(null); the query then keeps only Near.
  const rows = filterFinderRows(ALL, { jumpsLimit: 10, searchText: "perimeter" });
  assert.deepEqual(ids(rows), [NEAR.agentID]);
});

test("the text filter alone still matches system name (unchanged R6a behaviour)", () => {
  const rows = filterFinderRows(ALL, { jumpsLimit: null, searchText: "amarr" });
  assert.deepEqual(ids(rows), [FAR.agentID]);
});

test("filterFinderRows returns a new array and does not mutate the input", () => {
  const input = [...ALL];
  const out = filterFinderRows(input, { jumpsLimit: 5, searchText: "" });
  assert.notEqual(out, input);
  assert.equal(input.length, ALL.length, "input untouched");
});
