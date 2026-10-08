"use strict";

// src/gamePort/retailCalls.js: each call as the retail client sends it, and the
// tally of how what was called compares. Every reshaping here was read off the
// decompiled client; the entry names the file and line.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RETAIL_CALLS, createCallLedger, list, retailForm } = require("../src/gamePort/retailCalls");
const contract = require("../contracts/evejs-web-bridge-contract.json");

const form = (pair, args, kwargs = null) => {
  const [service, method] = pair.split(".");
  return retailForm(service, method, args, kwargs);
};

test("a pair nobody has checked goes out as the BFF spelt it, and says so", () => {
  const args = [1, [2, 3]];
  const kwargs = { flag: 5 };
  const answer = retailForm("someService", "SomeMethod", args, kwargs);
  assert.deepEqual(answer, { args, kwargs, status: "unchecked", source: null, note: null });
  assert.equal(answer.args, args, "untouched, not copied");
  assert.deepEqual(retailForm("someService", "SomeMethod", undefined, undefined), { args: [], kwargs: null, status: "unchecked", source: null, note: null });
});

test("a pair that is the same as the client's is left alone", () => {
  const answer = form("agentMgr.DoAction", [376]);
  assert.deepEqual([answer.args, answer.kwargs, answer.status], [[376], null, "same"]);
  assert.match(answer.source, /agentDialogueWindow\.py:\d+$/);
});

test("List goes out as List(flag=flag): a keyword, and None when there is no flag", () => {
  assert.deepEqual(form("invbroker.List", [5]), { args: [], kwargs: { flag: 5 }, status: "reshaped", source: RETAIL_CALLS["invbroker.List"].source, note: "List(flag=flag)" });
  assert.deepEqual(form("invbroker.List", []).kwargs, { flag: null });
  assert.deepEqual(form("invbroker.List", [], { flag: 4 }).kwargs, { flag: 4 }, "already a keyword: kept");
  assert.deepEqual(form("invbroker.List", [0]).kwargs, { flag: 0 }, "flag 0 is a flag");
});

test("ListByFlags goes out as ListByFlags(flags=[...]): a keyword, and a list", () => {
  const answer = form("invbroker.ListByFlags", [[11, 12, 13]]);
  assert.deepEqual([answer.args, answer.kwargs], [[], { flags: { type: "list", items: [11, 12, 13] } }]);
  assert.deepEqual(form("invbroker.ListByFlags", [{ type: "list", items: [5] }]).kwargs, { flags: { type: "list", items: [5] } });
  assert.deepEqual(form("invbroker.ListByFlags", []).kwargs, { flags: { type: "list", items: [] } });
});

test("MultiAdd's item IDs go out as a list; the rest is as given", () => {
  const answer = form("invbroker.MultiAdd", [[100, 101], 60003760], { flag: 5 });
  assert.deepEqual(answer.args, [{ type: "list", items: [100, 101] }, 60003760]);
  assert.deepEqual(answer.kwargs, { flag: 5 });
  assert.equal(answer.status, "reshaped");
});

test("Add is the client's when it carries a quantity, and is marked when it does not", () => {
  const whole = form("invbroker.Add", [100, 60003760], { flag: 5 });
  assert.equal(whole.status, "differs");
  assert.match(whole.note, /always sends qty/);
  assert.deepEqual([whole.args, whole.kwargs], [[100, 60003760], { flag: 5 }], "sent as it is: the quantity is not invented");
  const split = form("invbroker.Add", [100, 60003760], { flag: 5, qty: 3 });
  assert.equal(split.status, "same");
  assert.deepEqual(split.kwargs, { flag: 5, qty: 3 });
});

test("a call the client never makes is still sent, and is counted as the web client's own", () => {
  const answer = form("invbroker.GetCapacity", [5]);
  assert.deepEqual([answer.args, answer.kwargs, answer.status], [[5], null, "web-only"]);
  assert.match(answer.note, /never asks the server/);
});

test("no keywords is null, as the BFF passes it", () => {
  assert.equal(form("agentMgr.DoAction", [null], {}).kwargs, null);
  assert.equal(form("invbroker.StackAll", [4]).kwargs, null);
  // A reshaping that ends with no keywords says null too, not an empty object.
  assert.equal(form("invbroker.MultiAdd", [[1], 2]).kwargs, null);
  assert.equal(form("invbroker.MultiAdd", [[1], 2], {}).kwargs, null);
});

test("list() wraps an array and leaves anything else", () => {
  assert.deepEqual(list([1, 2]), { type: "list", items: [1, 2] });
  const wrapped = { type: "list", items: [1] };
  assert.equal(list(wrapped), wrapped);
  assert.equal(list(null), null);
});

test("every entry names a pair the web client may call, a status, and where it was read", () => {
  const allowed = new Set(contract.gatewayAllowlist.pairs);
  const clientRoot = path.resolve(__dirname, "..", "..", "eve.js", "tools", "ClientCodeGrabber", "Latest");
  const haveClient = fs.existsSync(clientRoot);
  for (const [pair, entry] of Object.entries(RETAIL_CALLS)) {
    assert.ok(allowed.has(pair), `${pair} is on the allowlist`);
    assert.ok(["same", "reshaped", "differs", "web-only"].includes(entry.status), `${pair} has a status`);
    assert.match(entry.source, /\.py(:\d+)?$/, `${pair} names a client file`);
    if (entry.status === "reshaped") assert.equal(typeof entry.shape, "function", `${pair} says how`);
    if (entry.status === "differs" || entry.status === "web-only") assert.ok(entry.note, `${pair} says what differs`);
    // Where the decompiled client is on this machine, the file each entry cites is really there.
    if (haveClient) assert.ok(fs.existsSync(path.join(clientRoot, entry.source.replace(/:\d+$/, ""))), `${pair}: ${entry.source} exists`);
  }
});

test("the ledger tallies each pair by how it compared, most called first", () => {
  const ledger = createCallLedger();
  for (let index = 0; index < 3; index += 1) ledger.note("invbroker", "GetCapacity", form("invbroker.GetCapacity", [5]));
  ledger.note("invbroker", "Add", form("invbroker.Add", [1, 2], { flag: 5, qty: 1 }));
  ledger.note("invbroker", "Add", form("invbroker.Add", [1, 2], { flag: 5 }));
  ledger.note("invbroker", "Add", form("invbroker.Add", [1, 2], { flag: 5, qty: 1 }));
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  const rows = ledger.rows();
  assert.deepEqual(rows.map((row) => [row.pair, row.calls, row.statuses]), [
    ["invbroker.Add", 3, { same: 2, differs: 1 }],
    ["invbroker.GetCapacity", 3, { "web-only": 3 }],
    ["station.GetGuests", 1, { unchecked: 1 }],
  ]);
  assert.match(rows[0].note, /always sends qty/, "the note is the difference, whenever it was seen, not the description");
  rows[0].statuses.x = 1;
  assert.equal(ledger.rows()[0].statuses.x, undefined, "a copy, not the tally itself");
  // Most called first; a tie goes by name.
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  assert.deepEqual(ledger.rows().map((row) => row.pair), ["station.GetGuests", "invbroker.Add", "invbroker.GetCapacity"]);
});

// ── the report ───────────────────────────────────────────────────────────────

test("the report lists each pair under the worst status it was seen with, and counts them", () => {
  const { report, worst } = require("../scripts/call-ledger-report");
  assert.equal(worst({ same: 2, differs: 1 }), "differs");
  assert.equal(worst({ reshaped: 1 }), "reshaped");
  assert.equal(worst({ "web-only": 1, unchecked: 4 }), "web-only");
  assert.equal(worst({}), "unchecked");
  const ledger = createCallLedger();
  for (let index = 0; index < 3; index += 1) ledger.note("invbroker", "GetCapacity", form("invbroker.GetCapacity", [5]));
  ledger.note("invbroker", "Add", form("invbroker.Add", [1, 2], { flag: 5, qty: 1 }));
  ledger.note("invbroker", "Add", form("invbroker.Add", [1, 2], { flag: 5 }));
  ledger.note("invbroker", "List", form("invbroker.List", [5]));
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  ledger.note("station", "GetGuests", retailForm("station", "GetGuests", [], null));
  const text = report(ledger.rows(), { what: "a test", generatedOn: "2026-10-08" });
  assert.match(text, /^# Game-port call ledger\n/);
  assert.match(text, /on 2026-10-08, from a test\./);
  assert.match(text, /\| web-only \| 1 \| 3 \|/);
  assert.match(text, /\| differs \| 1 \| 2 \|/);
  assert.match(text, /\| unchecked \| 1 \| 2 \|/);
  assert.match(text, /\| reshaped \| 1 \| 1 \|/);
  assert.match(text, /\| same \| 0 \| 0 \|/);
  assert.match(text, /\| \*\*total\*\* \| \*\*4\*\* \| \*\*8\*\* \|/);
  assert.match(text, /## unchecked \(1\)\n\n`station\.GetGuests` ×2\n/);
  assert.match(text, /\| `invbroker\.Add` \| 2 \| `eve\/client\/script\/environment\/invControllers\.py:213` \| The client always sends qty/);
  assert.equal(text.includes("## same"), false, "an empty group has no section");
});

// ── the scanner ──────────────────────────────────────────────────────────────

test("RequestScans goes out as the client's {probeID: probe}, each probe a util.KeyVal, or as None", () => {
  const route = { 990000000005: { typeID: 30013, pos: [1.5, 2, 3], destination: [4, 5, 6], scanRange: 2393565931200, rangeStep: 7, state: 1, expiry: "134359490166880000" } };
  const shaped = form("scanMgr.RequestScans", [route]);
  assert.equal(shaped.status, "reshaped");
  assert.deepEqual(shaped.args, [{
    type: "dict",
    entries: [[990000000005, {
      type: "object",
      name: "util.KeyVal",
      args: { type: "dict", entries: [["probeID", 990000000005], ["typeID", 30013], ["pos", [1.5, 2, 3]], ["destination", [4, 5, 6]], ["scanRange", 2393565931200], ["rangeStep", 7], ["state", 1], ["expiry", 134359490166880000n]] },
    }]],
  }]);
  assert.equal(shaped.kwargs, null);
  const fields = (probe) => new Map(form("scanMgr.RequestScans", [{ 7: probe }]).args[0].entries[0][1].args.entries);
  // A position in a list wrapper, a time as a long or a number, no destination (it is where the probe is), nothing at all.
  assert.deepEqual(fields({ pos: { type: "list", items: [1, 2, 3, 4] } }).get("pos"), [1, 2, 3]);
  assert.deepEqual(fields({ pos: [1, 2, 3] }).get("destination"), [1, 2, 3]);
  assert.deepEqual(fields({ pos: [1, 2, 3, 4] }).get("pos"), [1, 2, 3], "three numbers and no more");
  assert.equal(fields({ expiry: { type: "long", value: "55" } }).get("expiry"), 55n);
  assert.equal(fields({ expiry: 55 }).get("expiry"), 55n);
  assert.equal(fields({ expiry: 55n }).get("expiry"), 55n);
  assert.deepEqual([...fields({})], [["probeID", 7], ["typeID", null], ["pos", [0, 0, 0]], ["destination", [0, 0, 0]], ["scanRange", 0], ["rangeStep", 0], ["state", 0], ["expiry", null]]);
  assert.equal(fields({ expiry: "soon" }).get("expiry"), null);
  // No probes: None, which is the ship's own scan. What is no probe is left out.
  for (const none of [null, undefined, {}, { x: { typeID: 1 } }, { 0: { typeID: 1 } }, { 5: null }, { "5.5": {} }]) {
    assert.deepEqual(form("scanMgr.RequestScans", [none]).args, [null], JSON.stringify(none));
  }
  assert.deepEqual(form("scanMgr.RequestScans", []).args, [null]);
  // Already a dict, as the client would hand it: left alone.
  const dict = { type: "dict", entries: [[5, { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [] } }]] };
  assert.equal(form("scanMgr.RequestScans", [dict]).args[0], dict);
  // Two probes keep the order they were given in.
  assert.deepEqual(form("scanMgr.RequestScans", [{ 9: {}, 8: {} }]).args[0].entries.map(([probeID]) => probeID), [8, 9]);
});

test("the probes to recall and the probes to switch go out as lists; the rest of the scan calls are the client's as they stand", () => {
  assert.deepEqual(form("scanMgr.RecoverProbes", [[5, 6]]).args, [{ type: "list", items: [5, 6] }]);
  assert.deepEqual(form("scanMgr.SetActivityState", [[5, 6], true]).args, [{ type: "list", items: [5, 6] }, true]);
  assert.deepEqual(form("scanMgr.SetActivityState", [{ type: "list", items: [5] }, false]).args, [{ type: "list", items: [5] }, false]);
  for (const [pair, args] of [["scanMgr.GetSystemScanMgr", []], ["scanMgr.DestroyProbe", [5]], ["scanMgr.ReconnectToLostProbes", []], ["scanMgr.ConeScan", [1, 2, 0, 0, 1]], ["dogmaIM.LaunchProbes", [9988400109051, 4]]]) {
    const shaped = form(pair, args);
    assert.deepEqual([shaped.status, shaped.args], ["same", args], pair);
  }
  // Two calls the client never makes: it keeps a probe's destination and range step itself.
  for (const pair of ["scanMgr.SetProbeDestination", "scanMgr.SetProbeRangeStep"]) {
    const shaped = form(pair, [5, 3]);
    assert.deepEqual([shaped.status, shaped.args], ["web-only", [5, 3]], pair);
    assert.match(shaped.note, /RequestScans/);
  }
});
