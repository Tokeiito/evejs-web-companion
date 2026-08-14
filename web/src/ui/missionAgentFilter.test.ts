// The Mission bot picker's client-side filters (type-to-search + Level /
// Corporation): a pure derivation over the Choice rows the panel already
// built. The panel derives `chosen` — what Start actually flies to — from the
// FILTERED list, so these rules decide what the bot can be sent to; pin them.

import test from "node:test";
import assert from "node:assert/strict";

import { filterAgentChoices, type FilterableAgentChoice } from "./missionAgentFilter.ts";

interface Row extends FilterableAgentChoice {
  readonly id: number;
}

function row(over: Partial<Row> & Pick<Row, "id">): Row {
  return {
    label: `Agent ${over.id}`,
    stationName: "A Station",
    level: 1,
    corporationID: 1000002,
    ...over,
  };
}

const LOCAL = row({ id: 1, label: "Antaken Kamola", stationName: "Muvolailen X - Moon 3", level: 1 });
const NAVY = row({ id: 2, label: "Ossitte Oskold", stationName: "Jita IV - Moon 4", level: 3, corporationID: 1000035 });
const BLANK = row({ id: 3, label: "Unrated Agent", stationName: null, level: null, corporationID: null });
const ALL = [LOCAL, NAVY, BLANK];

const NO_FILTER = { searchText: "", level: null, corporationID: null } as const;

function ids(rows: readonly Row[]): number[] {
  return rows.map((r) => r.id);
}

// --- no filter: everything survives, order preserved ------------------------

test("no filter keeps every choice in its given order", () => {
  assert.deepEqual(ids(filterAgentChoices(ALL, NO_FILTER)), [1, 2, 3]);
});

// --- text search ------------------------------------------------------------

test("the search matches name and station, case-insensitively, as a substring", () => {
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, searchText: "antaken" })), [1]);
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, searchText: "JITA" })), [2]);
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, searchText: "kam" })), [1]);
});

test("an 'lN' query finds agents by level, like the Agent Finder's search", () => {
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, searchText: "l3" })), [2]);
});

test("whitespace-only search is no filter, and a miss is empty — not everything", () => {
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, searchText: "   " })), [1, 2, 3]);
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, searchText: "zzz" })), []);
});

// --- level ------------------------------------------------------------------

test("a specific level keeps only that level; unknown level matches no specific one", () => {
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, level: 1 })), [1]);
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, level: 3 })), [2]);
  // BLANK's level is null — it must not sneak into a specific-level view.
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, level: 5 })), []);
});

// --- corporation ------------------------------------------------------------

test("a specific corporation keeps only its agents; unknown employer matches only All", () => {
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, corporationID: 1000002 })), [1]);
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, corporationID: 1000035 })), [2]);
  assert.deepEqual(ids(filterAgentChoices(ALL, { ...NO_FILTER, corporationID: 999999 })), []);
});

// --- combination ------------------------------------------------------------

test("filters combine with AND — every active rule must pass", () => {
  // Three rows that each fail exactly ONE of the three rules, so dropping any
  // single rule admits an extra row and fails the assertion (this suite once
  // kept passing with the level rule deleted — this shape is the fix):
  //   id 4 passes all three; id 5 fails only level; id 6 fails only corp;
  //   LOCAL/NAVY/BLANK fail the "cbd" search.
  const both = [
    row({ id: 4, label: "Second CBD Agent", level: 3 }),
    row({ id: 5, label: "CBD Trainee", level: 1 }),
    row({ id: 6, label: "CBD Defector", level: 3, corporationID: 1000035 }),
    ...ALL,
  ];
  assert.deepEqual(
    ids(filterAgentChoices(both, { searchText: "cbd", level: 3, corporationID: 1000002 })),
    [4],
  );
});
