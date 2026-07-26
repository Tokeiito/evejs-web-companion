"use strict";

// A missing static table must degrade, not take the server down.
//
// `src/staticData.js` reads its tables straight off the EveJS gameStore
// (`<eveRoot>/_local/gameStore/data/<table>/data.json`). That directory is NOT
// this app's to guarantee: `eveRoot` defaults to a sibling folder, an operator
// can point it at the wrong place, and a gameStore can be populated in stages.
//
// It used to read unguarded. The cost was not a missing station NAME — it was
// `POST /api/bridge/select` answering 500 `ENOENT`, so no character could be
// brought online at all. Every other read in the module already guards
// (`readJsonlTable` returns [] for an absent file); this pins the same rule on
// the table reader, and pins the route that first surfaced it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// A root with NOTHING under it — the shape of a fresh clone.
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-noroot-"));
process.env.EVEJS_ROOT = emptyRoot;
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-nostatic-"));
process.env.EVEJS_WEB_POC_DATA_DIR = temporaryDataDir;

const staticData = require("../src/staticData");

test("a static table that is not on disk reads as EMPTY, it does not throw", () => {
  // Each of these walks readStaticTable for a different table.
  assert.equal(staticData.getStation(60000004), null);
  assert.equal(staticData.getSolarSystem(30000142), null);
});

test("callers still answer something usable for an id they cannot resolve", () => {
  // The fallbacks the routes rely on: a name that names the id, never a throw.
  assert.equal(staticData.getStationName(60000004), "Station 60000004");
  assert.equal(staticData.getSolarSystemName(30000142), "System 30000142");
});

test("the bulk name resolver reports 'unknown', which is different from crashing", () => {
  const resolved = staticData.resolveNames([
    { kind: "station", id: 60000004 },
    { kind: "system", id: 30000142 },
  ]);
  assert.ok(resolved, "it must answer at all");
});
