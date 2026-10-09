"use strict";

// src/gamePort/retailCalls.js: each call as the retail client sends it, and the
// tally of how what was called compares. Every reshaping here was read off the
// decompiled client; the entry names the file and line.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CONTRACT_SEARCH_KEYWORDS, MONIKER_SERVICES, PROXY_SERVICES, REPEATS, RETAIL_CALLS, createCallLedger, list, madeOnMoniker, retailForm, retailNeeds } = require("../src/gamePort/retailCalls");
const { keywordOrder } = require("../src/gamePort/py27");
const contract = require("../contracts/evejs-web-bridge-contract.json");

const form = (pair, args, kwargs = null) => {
  const [service, method] = pair.split(".");
  return retailForm(service, method, args, kwargs);
};

test("a pair nobody has checked goes out as the BFF spelt it, and says so", () => {
  const args = [1, [2, 3]];
  const kwargs = { flag: 5 };
  const answer = retailForm("someService", "SomeMethod", args, kwargs);
  assert.deepEqual(answer, { args, kwargs, status: "unchecked", source: null, note: null, moniker: false, proxy: false });
  assert.equal(answer.args, args, "untouched, not copied");
  assert.deepEqual(retailForm("someService", "SomeMethod", undefined, undefined), { args: [], kwargs: null, status: "unchecked", source: null, note: null, moniker: false, proxy: false });
});

test("a pair that is the same as the client's is left alone", () => {
  const answer = form("agentMgr.DoAction", [376]);
  assert.deepEqual([answer.args, answer.kwargs, answer.status], [[376], null, "same"]);
  assert.match(answer.source, /agentDialogueWindow\.py:\d+$/);
});

test("List goes out as List(flag=flag): a keyword, and None when there is no flag", () => {
  assert.deepEqual(form("invbroker.List", [5]), { args: [], kwargs: { flag: 5 }, status: "reshaped", source: RETAIL_CALLS["invbroker.List"].source, note: "List(flag=flag)", moniker: false, proxy: false });
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

// ── calls the client makes on a moniker ──────────────────────────────────────

const withContext = (pair, args, kwargs, context) => {
  const [service, method] = pair.split(".");
  return retailForm(service, method, args, kwargs, context);
};

test("undock goes to the ship's moniker with the online modules by slot, as the station service sends it", () => {
  const online = () => [[19, 9001], [27, 9002]];
  const answer = withContext("ship.Undock", [5000, false], { onlineModules: [] }, { onlineModules: online });
  assert.deepEqual(answer, {
    args: [5000, false],
    kwargs: { onlineModules: { type: "dict", entries: [[19, 9001], [27, 9002]] } },
    status: "reshaped",
    source: RETAIL_CALLS["ship.Undock"].source,
    note: RETAIL_CALLS["ship.Undock"].note,
    moniker: true,
    proxy: false,
  });
  assert.match(answer.source, /ui\/station\/base\.py:498$/);
  // The second argument is a yes or a no: only a true is a yes.
  assert.deepEqual(withContext("ship.Undock", [5000, true], null, { onlineModules: online }).args, [5000, true]);
  assert.deepEqual(withContext("ship.Undock", [5000, 1], null, { onlineModules: online }).args, [5000, false]);
  assert.deepEqual(withContext("ship.Undock", [5000], null, { onlineModules: online }).args, [5000, false]);
  // No module online is still an answer: an empty dict, and the client's call.
  assert.deepEqual(((form) => [form.kwargs, form.status])(withContext("ship.Undock", [5000, false], null, { onlineModules: () => [] })), [{ onlineModules: { type: "dict", entries: [] } }, "reshaped"]);
  // Dogma not to be had: an empty dict goes, and the tally says the call is not the client's.
  for (const context of [{}, { onlineModules: () => null }, undefined]) {
    const blind = withContext("ship.Undock", [5000, false], { onlineModules: [] }, context);
    assert.deepEqual([blind.kwargs, blind.status, blind.moniker], [{ onlineModules: { type: "dict", entries: [] } }, "differs", true]);
    assert.match(blind.note, /online modules by slot/);
  }
  // Another keyword a route sent is kept.
  assert.deepEqual(Object.keys(withContext("ship.Undock", [5000, false], { other: 1 }, { onlineModules: online }).kwargs), ["other", "onlineModules"]);
});

test("a module is switched on with its effect named and its repeats the client's: 1000 to go on, 0 for one that cannot", () => {
  assert.equal(REPEATS, 1000);
  const knows = { effectName: (itemID) => (itemID === 7 ? "burn" : null), effectRepeats: (itemID, name) => (name === "burn" ? true : name === "fire" ? false : null) };
  const on = (args, context = knows) => withContext("dogmaIM.Activate", args, null, context);
  // The BFF's -1 is "go on repeating".
  assert.deepEqual(on([7, "burn", undefined, -1]), { args: [7, "burn", null, 1000], kwargs: null, status: "reshaped", source: RETAIL_CALLS["dogmaIM.Activate"].source, note: RETAIL_CALLS["dogmaIM.Activate"].note, moniker: true, proxy: false });
  assert.match(RETAIL_CALLS["dogmaIM.Activate"].source, /shipmodulebutton\.py:1348$/);
  // An effect that cannot repeat is sent once, whatever was asked.
  assert.deepEqual(on([8, "fire", 4242, -1]).args, [8, "fire", 4242, 0]);
  // A count the caller gave is the caller's: once, or five times.
  assert.deepEqual([on([7, "burn", null, 0]).args[3], on([7, "burn", null, 5]).args[3], on([7, "burn", null, "0"]).args[3]], [0, 5, 0]);
  // No name given: the module's own, from what the pilot knows of it. A name on the wire may be bytes.
  assert.deepEqual(on([7, "", null, -1]).args, [7, "burn", null, 1000]);
  assert.deepEqual(on([9, Buffer.from("glow"), null, 0]).args, [9, "glow", null, 0]);
  assert.deepEqual(on([7, null, null, -1]).args, [7, "burn", null, 1000]);
  // No name to be had: it goes as it came, and the tally says so.
  const nameless = on([9, "", null, -1]);
  assert.deepEqual([nameless.args, nameless.status, nameless.moniker], [[9, "", null, -1], "differs", true]);
  assert.match(nameless.note, /always names/);
  assert.deepEqual(on([9, "", null, -1], {}).status, "differs");
  // Named, but whether it repeats is not known: the -1 goes as it is, and that is said. A count given needs no such knowledge.
  const unsure = on([9, "glow", null, -1]);
  assert.deepEqual([unsure.args, unsure.status], [[9, "glow", null, -1], "differs"]);
  assert.match(unsure.note, /1000 or 0/);
  assert.deepEqual([on([9, "glow", null, 0]).status, on([9, "glow", null, 0]).args], ["reshaped", [9, "glow", null, 0]]);
  assert.deepEqual(on([9, "glow", null, -1], {}).status, "differs");
});

test("a module is switched off by its effect's name, on the same moniker", () => {
  const knows = { effectName: (itemID) => (itemID === 7 ? "burn" : null) };
  const off = (args, context = knows) => withContext("dogmaIM.Deactivate", args, null, context);
  assert.deepEqual(off([7, "burn"]), { args: [7, "burn"], kwargs: null, status: "reshaped", source: RETAIL_CALLS["dogmaIM.Deactivate"].source, note: RETAIL_CALLS["dogmaIM.Deactivate"].note, moniker: true, proxy: false });
  assert.match(RETAIL_CALLS["dogmaIM.Deactivate"].source, /godma\.py:2101$/);
  assert.deepEqual(off([7, ""]).args, [7, "burn"]);
  assert.deepEqual(off([7]).args, [7, "burn"]);
  const nameless = off([9, ""]);
  assert.deepEqual([nameless.args, nameless.status, nameless.moniker], [[9, ""], "differs", true]);
  assert.match(nameless.note, /always names/);
  assert.equal(off([9, ""], {}).status, "differs");
});

test("what a call needs the pilot to have first is said by the registry: godma primed, for these three", () => {
  assert.deepEqual(["ship.Undock", "dogmaIM.Activate", "dogmaIM.Deactivate"].map((pair) => retailNeeds(...pair.split("."))), ["dogma", "dogma", "dogma"]);
  assert.deepEqual([retailNeeds("invbroker", "List"), retailNeeds("agentMgr", "DoAction"), retailNeeds("someService", "SomeMethod"), retailNeeds("dogmaIM", "GetTargets")], [null, null, null, null]);
});

test("everything of ship, dogmaIM and corpRegistry is made on a moniker, read or not, but the three the client asks by name", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MONIKER_SERVICES).map(([service, named]) => [service, [...named].sort()])), {
    ship: ["GetShipFittingInfo"],
    dogmaIM: ["CreateNewbieShip", "GetRequiredSkillLevels"],
    // The client never asks the corporation registry by name at all.
    corpRegistry: [],
  });
  assert.deepEqual([madeOnMoniker("corpRegistry", "GetCorporation"), madeOnMoniker("corpRegistry", "AddBulletin"), madeOnMoniker("corpRegistry", "MachoBindObject")], [true, true, false]);
  assert.deepEqual([madeOnMoniker("ship", "Undock"), madeOnMoniker("dogmaIM", "GetTargets"), madeOnMoniker("ship", "SomethingNobodyRead"), madeOnMoniker("dogmaIM", "Overload")], [true, true, true, true]);
  assert.deepEqual([madeOnMoniker("ship", "GetShipFittingInfo"), madeOnMoniker("dogmaIM", "CreateNewbieShip"), madeOnMoniker("dogmaIM", "GetRequiredSkillLevels")], [false, false, false]);
  // Other services are asked by name, whatever their methods are called; and a bind is a bind, not a call on what it makes.
  assert.deepEqual([madeOnMoniker("invbroker", "List"), madeOnMoniker("agentMgr", "DoAction"), madeOnMoniker("toString", "Undock"), madeOnMoniker("constructor", "x")], [false, false, false, false]);
  assert.deepEqual([madeOnMoniker("ship", "MachoBindObject"), madeOnMoniker("dogmaIM", "MachoBindObject")], [false, false]);
  // The form says so for a pair nobody has read, and for one that has an entry.
  assert.deepEqual(retailForm("ship", "SomethingNobodyRead", [1], null), { args: [1], kwargs: null, status: "unchecked", source: null, note: null, moniker: true, proxy: false });
  assert.equal(retailForm("dogmaIM", "CreateNewbieShip", [1, 2], null).moniker, false);
  for (const pair of Object.keys(RETAIL_CALLS)) {
    const [service, method] = pair.split(".");
    // On the moniker for every pair of those three services but the ones the client asks by the service's name.
    assert.equal(retailForm(service, method, [], null).moniker, Object.hasOwn(MONIKER_SERVICES, service) && !MONIKER_SERVICES[service].has(method), pair);
  }
});

test("targeting, onlining, scooping and leaving a ship are the client's calls as they stand", () => {
  for (const [pair, args, where] of [
    ["dogmaIM.GetTargets", [], /godma\.py:2361$/],
    ["dogmaIM.AddTarget", [9001], /targetMgr\.py:1366$/],
    ["dogmaIM.CancelAddTarget", [9001], /targetMgr\.py:1303$/],
    ["dogmaIM.RemoveTarget", [9001], /targetMgr\.py:1385$/],
    ["dogmaIM.SetModuleOnline", [5000, 7], /clientDogmaLocation\.py:702$/],
    ["dogmaIM.TakeModuleOffline", [5000, 7], /clientDogmaLocation\.py:718$/],
    ["ship.ScoopDrone", [[11, 12]], /droneFunctions\.py:195$/],
    ["ship.LeaveShip", [5000], /ui\/station\/base\.py:248$/],
  ]) {
    const answer = form(pair, args);
    assert.deepEqual([answer.args, answer.kwargs, answer.status, answer.moniker], [args, null, "same", true], pair);
    assert.match(answer.source, where, pair);
  }
});

test("ammunition goes in and out with its modules as a list, and one module by itself when a quantity is named", () => {
  assert.deepEqual(form("dogmaIM.LoadAmmo", [5000, [7, 8], [31, 32], 60003760]).args, [5000, list([7, 8]), list([31, 32]), 60003760]);
  assert.deepEqual(form("dogmaIM.LoadAmmo", [5000, list([7]), list([31]), 5000]).args, [5000, list([7]), list([31]), 5000], "already lists: kept");
  assert.equal(form("dogmaIM.LoadAmmo", [5000, [7], [31], 5000]).status, "reshaped");
  const hangar = [60003760, 140000001, 4];
  // No quantity: the modules as a list, the place as it came (a tuple, which is what an array is on the wire).
  assert.deepEqual(form("dogmaIM.UnloadAmmo", [5000, [7, 8], hangar]).args, [5000, list([7, 8]), hangar]);
  assert.deepEqual(form("dogmaIM.UnloadAmmo", [5000, [7], hangar, null]).args, [5000, list([7]), hangar]);
  // A quantity: the one module by itself.
  assert.deepEqual(form("dogmaIM.UnloadAmmo", [5000, [7], hangar, 40]).args, [5000, 7, hangar, 40]);
  assert.deepEqual(form("dogmaIM.UnloadAmmo", [5000, list([7]), hangar, 40]).args, [5000, 7, hangar, 40]);
  assert.deepEqual(form("dogmaIM.UnloadAmmo", [5000, 7, hangar, 40]).args, [5000, 7, hangar, 40]);
  assert.equal(form("dogmaIM.UnloadAmmo", [5000, [7], hangar, 40]).status, "reshaped");
  // Several modules and a quantity is not a call the client has.
  const several = form("dogmaIM.UnloadAmmo", [5000, [7, 8], hangar, 40]);
  assert.deepEqual([several.args, several.status], [[5000, [7, 8], hangar, 40], "differs"]);
  assert.match(several.note, /one module/);
});

test("drones are launched as a list of stacks, on nobody's behalf when it is the pilot's own", () => {
  const stacks = [[11, 1], [12, 3]];
  const launch = (args, context = { characterID: 140000001 }) => withContext("ship.LaunchDrones", args, null, context);
  assert.deepEqual(launch([stacks, 140000001, false]).args, [list(stacks), null, false]);
  assert.deepEqual(launch([stacks, 0, false]).args, [list(stacks), null, false]);
  assert.deepEqual(launch([stacks]).args, [list(stacks), null, false]);
  assert.deepEqual(launch([stacks, 0, false], {}).args, [list(stacks), null, false]);
  // On another's behalf (a corporation's, say) the name stays; and without knowing who the pilot is, so does the pilot's.
  assert.deepEqual(launch([stacks, 98000001, true]).args, [list(stacks), 98000001, true]);
  assert.deepEqual(launch([stacks, 140000001, false], {}).args, [list(stacks), 140000001, false]);
  // Only a true is a yes.
  assert.deepEqual(launch([stacks, 0, 1]).args[2], false);
  assert.match(RETAIL_CALLS["ship.LaunchDrones"].source, /eveMisc\.py:29$/);
});

test("the ship's configuration is asked for by the ship's ID, which the pilot knows", () => {
  const asked = (args, context) => withContext("ship.GetShipConfiguration", args, null, context);
  assert.deepEqual([asked([], { shipID: 5000 }).args, asked([], { shipID: 5000 }).status], [[5000], "reshaped"]);
  assert.deepEqual(asked([6000], { shipID: 5000 }).args, [6000], "one named already is kept");
  const blind = asked([], {});
  assert.deepEqual([blind.args, blind.status], [[], "differs"]);
  assert.match(blind.note, /names the ship/);
  assert.equal(asked([], { shipID: null }).status, "differs");
});

test("two reads the client never makes are still sent, and said to be the web client's own", () => {
  for (const pair of ["dogmaIM.ShipGetInfo", "dogmaIM.ShipOnlineModules"]) {
    const answer = form(pair, []);
    assert.deepEqual([answer.args, answer.status, answer.moniker], [[], "web-only", true], pair);
    assert.ok(answer.note.length > 40, pair);
  }
});

test("the account's calls with no character chosen: what the client sends, and what it never asks", () => {
  const info = retailForm("charUnboundMgr", "GetCharCreationInfo", [], null);
  assert.equal(info.status, "web-only");
  assert.match(info.source, /login\/charcreation\/steps\/bloodLineStep\.py:107$/);
  assert.deepEqual(info.args, []);
  assert.match(info.note, /never asks/);

  // ValidateNameEx(charName, how many names the screen has checked before this one).
  const first = retailForm("charUnboundMgr", "ValidateNameEx", ["A Name"], null);
  assert.equal(first.status, "reshaped");
  assert.match(first.source, /steps\/sections\/chooseNameSection\.py:201$/);
  assert.deepEqual(first.args, ["A Name", 0]);
  assert.equal(first.kwargs, null);
  // A count that is given is the caller's to give, and whatever else came with it goes too.
  assert.deepEqual(retailForm("charUnboundMgr", "ValidateNameEx", ["A Name", 3], null).args, ["A Name", 3]);
  const more = retailForm("charUnboundMgr", "ValidateNameEx", ["A Name", 0, "more"], { a: 1 });
  assert.deepEqual(more.args, ["A Name", 0, "more"]);
  assert.deepEqual(more.kwargs, { a: 1 });

  // The client's ten, with a doll, are not the web client's to send.
  const seven = ["A Name", 2, 1, 8, null, null, 0];
  const made = retailForm("charUnboundMgr", "CreateCharacterWithDoll", seven, null);
  assert.equal(made.status, "differs");
  assert.match(made.source, /ui\/services\/ccSvc\.py:97$/);
  assert.deepEqual(made.args, seven);
  assert.match(made.note, /raceID, bloodlineID, genderID, ancestryID, charInfo, portraitInfo, schoolID, None, qaStarterSystemID/);

  // Asked of the service by name, as the client asks them: none is a moniker's.
  assert.deepEqual([info.moniker, first.moniker, made.moniker], [false, false, false]);
});

test("saved fittings are asked of the owner's manager with the owner, as fittingSvc asks", () => {
  const context = { characterID: 140000001, corporationID: 1000044, allianceID: 99000001 };
  const cases = [
    ["charFittingMgr", 140000001],
    ["corpFittingMgr", 1000044],
    ["allianceFittingMgr", 99000001],
  ];
  for (const [service, owner] of cases) {
    // The BFF leaves the owner to the server; the client names it.
    const filled = retailForm(service, "GetFittings", [], null, context);
    assert.equal(filled.status, "reshaped", service);
    assert.match(filled.source, /environment\/fittingSvc\.py:430$/);
    assert.deepEqual(filled.args, [owner], service);
    assert.equal(filled.kwargs, null);
    assert.equal(filled.moniker, false);
    // An owner that is given is the caller's to give, and the call is then the client's as it stands.
    const given = retailForm(service, "GetFittings", [7, "more"], { a: 1 }, context);
    assert.deepEqual(given.args, [7, "more"]);
    assert.equal(given.status, "same", service);
    assert.equal(retailForm(service, "GetFittings", [null], null, context).status, "reshaped", "an owner of nothing is no owner");
    assert.deepEqual(retailForm(service, "GetFittings", [7], { a: 1 }, context).kwargs, { a: 1 });
  }
  // A pilot in no alliance: the client does not ask, and the BFF's call goes as it was.
  const none = retailForm("allianceFittingMgr", "GetFittings", [], null, { characterID: 140000001, corporationID: 1000044, allianceID: null });
  assert.equal(none.status, "differs");
  assert.deepEqual(none.args, []);
  assert.match(none.note, /no alliance/);
  assert.match(retailForm("corpFittingMgr", "GetFittings", [], null, {}).note, /no corporation/);
  assert.match(retailForm("charFittingMgr", "GetFittings", [], null).note, /no character/);
});

test("removing an offer is asked as the client asks it: nothing but the call, on the agent's object", () => {
  const form = retailForm("agentMgr", "RemoveOfferFromJournal", [], null);
  assert.equal(form.status, "same");
  assert.match(form.source, /ui\/station\/agents\/agents\.py:783$/);
  assert.deepEqual(form.args, []);
  assert.equal(form.kwargs, null);
});

test("a mission's objectives are asked as the client asks them: with nothing, or from the job board's page with ignoreLocateCheck", () => {
  const plain = retailForm("agentMgr", "GetMissionObjectiveInfo", [], null);
  assert.equal(plain.status, "same");
  assert.deepEqual(plain.args, []);
  assert.equal(plain.kwargs, null);
  // The keyword goes out as it was given.
  const page = retailForm("agentMgr", "GetMissionObjectiveInfo", [], { ignoreLocateCheck: true });
  assert.equal(page.status, "same");
  assert.deepEqual(page.args, []);
  assert.deepEqual(page.kwargs, { ignoreLocateCheck: true });
  assert.match(page.note, /ignoreLocateCheck=True \(jobboard\/client\/features\/agent_missions\/job\.py:413\)/);
});

test("the wallet's reads: the balance, the entry types and the divisions as they stand; the transactions with a bool for whose they are", () => {
  for (const [pair, args] of [["account.GetCashBalance", [0]], ["account.GetEntryTypes", []], ["account.GetWalletDivisionsInfo", []], ["officeManager.GetMyCorporationsOffices", []]]) {
    const form = retailForm(...pair.split("."), args, null);
    assert.deepEqual([form.status, form.args, form.kwargs, form.moniker], ["same", args, null, false], pair);
  }
  // GetTransactions(accountingKeyCash, year, month, False): as the client sends it, it is the client's.
  const asClient = retailForm("account", "GetTransactions", [1000, null, null, false], null);
  assert.deepEqual([asClient.status, asClient.args], ["same", [1000, null, null, false]]);
  assert.deepEqual(retailForm("account", "GetTransactions", [1002, 2026, 9, true], null).args, [1002, 2026, 9, true]);
  // Said with a number, or with less, it goes out as the client's and is counted as reshaped.
  for (const [given, sent] of [[[1000, null, null, 0], [1000, null, null, false]], [[1002, 2026, 9, 1], [1002, 2026, 9, true]], [[1000], [1000, null, null, false]]]) {
    const form = retailForm("account", "GetTransactions", given, null);
    assert.deepEqual([form.status, form.args], [given.length === 4 ? "reshaped" : "same", sent], JSON.stringify(given));
  }
  // The corporation's own record is asked with nothing, of the registry's moniker.
  const corporation = retailForm("corpRegistry", "GetCorporation", [], null);
  assert.deepEqual([corporation.status, corporation.args, corporation.moniker], ["same", [], true]);
});

test("dogma's reads: all info as godma first primes it, an item by its ID, and what the client never asks marked as the web client's own", () => {
  // GetAllInfo(primeCharacter, primeShip, primeStructure): three, as given; with fewer, godma's first priming.
  assert.deepEqual([retailForm("dogmaIM", "GetAllInfo", [true, false, null], null).status, retailForm("dogmaIM", "GetAllInfo", [true, false, null], null).args], ["same", [true, false, null]]);
  for (const given of [[], [true], [true, true]]) {
    const form = retailForm("dogmaIM", "GetAllInfo", given, null);
    assert.deepEqual([form.status, form.args, form.moniker], ["reshaped", [true, true, null], true], JSON.stringify(given));
  }
  // An item is always named.
  assert.equal(retailForm("dogmaIM", "ItemGetInfo", [9988400023309], null).status, "same");
  for (const given of [[], [null], [1, 2]]) {
    const form = retailForm("dogmaIM", "ItemGetInfo", given, null);
    assert.deepEqual([form.status, form.args], ["differs", given], JSON.stringify(given));
    assert.match(form.note, /always names the item/);
  }
  assert.equal(retailForm("dogmaIM", "GetTargeters", [], null).status, "same");
  assert.equal(retailForm("dogmaIM", "GetLayerDamageValuesByItems", [[]], null).status, "differs");
  for (const method of ["GetDroneSettingAttributes", "GetCharacterAttributes", "GetRequiredSkillLevels", "QueryAllAttributesForItem", "QueryAttributeValue", "GetLocationInfo"]) {
    const form = retailForm("dogmaIM", method, [], null);
    assert.equal(form.status, "web-only", method);
    assert.ok(form.note.length > 20, method);
  }
  // The one of those the client's tools ask by the service's name is not made on the moniker.
  assert.equal(retailForm("dogmaIM", "GetRequiredSkillLevels", [587], null).moniker, false);
  assert.equal(retailForm("dogmaIM", "QueryAttributeValue", [1, 4], null).moniker, true);
});

test("the agents' table and journal, and the standings, are asked with nothing, as the client asks", () => {
  for (const pair of ["agentMgr.GetAgents", "agentMgr.GetMyJournalDetails", "standingMgr.GetCharStandings", "standingMgr.GetCorpStandings"]) {
    const form = retailForm(...pair.split("."), [], null);
    assert.deepEqual([form.status, form.args, form.kwargs, form.moniker], ["same", [], null, false], pair);
  }
});

test("the services the client reaches with sm.ProxySvc are called at its proxy node, and no others", () => {
  // Every sm.ProxySvc('<name>') of the decompiled client. A service among them is asked no other way.
  assert.deepEqual([...PROXY_SERVICES].sort(), ["XmppChatMgr", "alert", "bountyProxy", "calendarProxy", "clientStatLogger", "contractProxy", "corpRecProxy", "eventLog", "fleetProxy", "machoNet", "marketProxy", "pingService", "raffleProxy", "search"]);
  for (const service of PROXY_SERVICES) assert.equal(retailForm(service, "AnyMethod", [], null).proxy, true, service);
  // A service's name ending in Proxy or Mgr says nothing: the calendar has one of each kind.
  for (const service of ["account", "calendarMgr", "contractMgr", "standingMgr", "dogmaIM", "corpRegistry", "ship", "charMgr", "notificationMgr", "someService"]) {
    assert.equal(retailForm(service, "AnyMethod", [], null).proxy, false, service);
  }
  // With an entry of its own or without, shaped or not.
  assert.equal(form("contractProxy.GetLoginInfo", []).proxy, true);
  assert.equal(form("contractProxy.SearchContracts", [], { contractType: 3 }).proxy, true);
  assert.equal(form("account.GetTransactions", [1000, null, null, 0]).proxy, false);
  // No service is both the proxy's and a moniker's.
  for (const service of PROXY_SERVICES) assert.equal(Object.hasOwn(MONIKER_SERVICES, service), false, service);
});

test("a contract search goes out with the client's twenty-six keywords, in the order its call writes them", () => {
  const nothing = Object.fromEntries(CONTRACT_SEARCH_KEYWORDS.map((name) => [name, null]));
  // The order the client's call writes them in (contractsearch.py 1367). The order on the wire comes of it
  // wherever two names want the same slot of the dict, so it is kept as written.
  assert.deepEqual([...CONTRACT_SEARCH_KEYWORDS], [
    "itemTypes", "itemTypeName", "itemCategoryID", "itemGroupID", "contractType", "securityClasses", "locationID", "endLocationID", "issuerID",
    "minPrice", "maxPrice", "minReward", "maxReward", "minCollateral", "maxCollateral", "minVolume", "maxVolume",
    "excludeTrade", "excludeMultiple", "excludeNoBuyout", "availability", "description", "searchHint", "sortBy", "sortDir", "startNum",
  ]);

  // What the page gives, None for the rest, and the sort the panel's list starts on: by date created, oldest first.
  const asked = form("contractProxy.SearchContracts", [], { contractType: 3, availability: 0, startNum: 100 });
  assert.equal(asked.status, "reshaped");
  assert.deepEqual(asked.args, []);
  assert.deepEqual(Object.keys(asked.kwargs), [...CONTRACT_SEARCH_KEYWORDS]);
  assert.deepEqual(asked.kwargs, { ...nothing, contractType: 3, availability: 0, sortBy: 0, sortDir: 0, startNum: 100 });

  // For auctions and exchanges together the panel starts sorted by price; the first page starts at nought.
  const items = form("contractProxy.SearchContracts", [], { contractType: 10 });
  assert.deepEqual([items.kwargs.sortBy, items.kwargs.sortDir, items.kwargs.startNum], [1, 0, 0]);
  // A sort and a filter the page chose are kept.
  const chosen = form("contractProxy.SearchContracts", [], { contractType: 3, sortBy: 8, sortDir: 1, locationID: 10000033, minReward: 5000000 });
  assert.deepEqual([chosen.kwargs.sortBy, chosen.kwargs.sortDir, chosen.kwargs.locationID, chosen.kwargs.minReward], [8, 1, 10000033, 5000000]);
  // None is no sort: the panel's list always has one.
  assert.deepEqual([form("contractProxy.SearchContracts", [], { contractType: 3, sortBy: null, sortDir: null }).kwargs.sortBy, form("contractProxy.SearchContracts", [], { contractType: 3, sortBy: null, sortDir: null }).kwargs.sortDir], [0, 0]);

  // Given whole, in whatever order, it is the client's, and goes out in the call's order.
  const whole = form("contractProxy.SearchContracts", [], Object.fromEntries([...CONTRACT_SEARCH_KEYWORDS].reverse().map((name) => [name, name === "contractType" ? 3 : 0])));
  assert.equal(whole.status, "same");
  assert.deepEqual(Object.keys(whole.kwargs), [...CONTRACT_SEARCH_KEYWORDS]);
  assert.equal(whole.kwargs.contractType, 3);
  // The client's call has no positional arguments, no other keyword, and a sort every time: each of those is put right.
  const everything = { ...nothing, contractType: 3, sortBy: 0, sortDir: 0, startNum: 0 };
  assert.equal(form("contractProxy.SearchContracts", [], everything).status, "same");
  for (const [args, kwargs] of [[[3], everything], [[], { ...everything, somethingElse: 1 }], [[], { ...everything, sortBy: null }], [[], { ...everything, startNum: null }]]) {
    const odd = form("contractProxy.SearchContracts", args, kwargs);
    assert.deepEqual([odd.status, odd.args, odd.kwargs], ["reshaped", [], everything], JSON.stringify([args, Object.keys(kwargs).length]));
    assert.deepEqual(Object.keys(odd.kwargs), [...CONTRACT_SEARCH_KEYWORDS]);
  }

  // On the wire: the order the client's own Python gives these keywords and machoVersion
  // (a service's method, the dict copied, machoVersion added), asked of the client's python27.dll.
  assert.deepEqual(keywordOrder(Object.keys(asked.kwargs)), ["itemTypeName", "itemCategoryID", "issuerID", "excludeNoBuyout", "securityClasses", "endLocationID", "availability", "machoVersion", "maxReward", "minVolume", "startNum", "itemTypes", "itemGroupID", "excludeTrade", "maxCollateral", "description", "excludeMultiple", "sortBy", "maxVolume", "contractType", "minPrice", "minReward", "sortDir", "searchHint", "maxPrice", "minCollateral", "locationID"]);
});

test("the contracts' own lists, the market's and the calendar's reads, set beside the client's", () => {
  for (const [pair, args] of [
    ["contractProxy.GetLoginInfo", []],
    ["contractProxy.GetMyExpiredContractList", [false]],
    ["contractProxy.GetMyExpiredContractList", [true]],
    ["marketProxy.GetCharOrders", []],
    ["marketProxy.GetMarketOrderHistory", []],
    ["marketProxy.GetCharEscrow", []],
    ["marketProxy.CharGetTransactions", [null]],
    ["calendarProxy.GetEventList", [10, 2026]],
    ["calendarProxy.GetEventDetails", [77, 140000002]],
    ["calendarMgr.GetResponsesForCharacter", []],
    ["calendarMgr.GetResponsesToEvent", [77, 140000002]],
  ]) {
    const answer = form(pair, args);
    assert.deepEqual([answer.status, answer.args, answer.kwargs], ["same", args, null], pair);
    assert.match(answer.source, /\.py:\d+$/, pair);
  }
  // An event is asked about by its ID and its owner's, for an event the pilot opened: never event nought, never without the owner.
  for (const pair of ["calendarProxy.GetEventDetails", "calendarMgr.GetResponsesToEvent"]) {
    for (const given of [[0, null], [77, null], [0, 140000002], [77], []]) {
      const answer = form(pair, given);
      assert.deepEqual([answer.status, answer.args], ["differs", given], `${pair} ${JSON.stringify(given)}`);
      assert.match(answer.note, /an event the pilot has opened/, pair);
    }
  }
  // The client's contracts service has a wrapper for this that nothing calls.
  const current = form("contractProxy.GetMyCurrentContractList", [false, false]);
  assert.equal(current.status, "web-only");
  assert.match(current.note, /GetContractListForOwner/);
  // The market's transactions are asked for with no date: all of them.
  for (const given of [[0], []]) {
    const answer = form("marketProxy.CharGetTransactions", given);
    assert.deepEqual([answer.status, answer.args], ["reshaped", [null]], JSON.stringify(given));
  }
  // A date is not the client's, and is not thrown away either.
  const dated = form("marketProxy.CharGetTransactions", [134359051855730000]);
  assert.deepEqual([dated.status, dated.args], ["differs", [134359051855730000]]);
});

test("the character's own reads name the character, as the client names it", () => {
  const withPilot = (pair, args) => retailForm(...pair.split("."), args, null, { characterID: 140000002 });
  // charMgr.GetPublicInfo3(itemID) and GetCharacterDescription(session.charid): asked with none, the pilot's own.
  for (const pair of ["charMgr.GetPublicInfo3", "charMgr.GetCharacterDescription"]) {
    assert.deepEqual([withPilot(pair, []).status, withPilot(pair, []).args], ["reshaped", [140000002]], pair);
    assert.deepEqual([withPilot(pair, [null]).status, withPilot(pair, [null]).args], ["reshaped", [140000002]], pair);
    // Another character's, as the info window asks, goes as it was given.
    assert.deepEqual([withPilot(pair, [140000001]).status, withPilot(pair, [140000001]).args], ["same", [140000001]], pair);
    // With no pilot known there is nothing to name: sent as it was, and said to differ.
    const blind = retailForm(...pair.split("."), [], null, {});
    assert.deepEqual([blind.status, blind.args], ["differs", []], pair);
    assert.match(blind.note, /names the character/, pair);
  }
  // The row is the client's read of its home station; the other two it never makes.
  assert.equal(form("charMgr.GetHomeStationRow", []).status, "same");
  for (const pair of ["charMgr.GetHomeStation", "charMgr.GetCloneInfo"]) {
    assert.equal(form(pair, []).status, "web-only", pair);
    assert.ok(form(pair, []).note.length > 40, pair);
  }
  assert.match(form("charMgr.GetHomeStation", []).note, /GetHomeStationRow/);
  assert.match(form("charMgr.GetCloneInfo", []).note, /jumpCloneSvc/);
});

test("industry's reads, mail's, the notifications' and the fleet's, set beside the client's", () => {
  for (const [pair, args] of [
    ["charMgr.ListStations", []],
    ["blueprintManager.GetBlueprintDataByOwner", [140000002, null]],
    ["blueprintManager.GetBlueprintDataByOwner", [140000002, 60000004]],
    ["industryManager.GetJobsByOwner", [140000002, true]],
    ["industryManager.GetJobsByOwner", [140000002, false]],
    ["industryManager.GetJobCounts", [140000002]],
    ["facilityManager.GetFacilities", []],
    ["facilityManager.GetMaxActivityModifiers", []],
    ["notificationMgr.GetByGroupID", [3]],
    ["notificationMgr.GetUnprocessed", []],
    ["mailMgr.SyncMail", [null, 0]],
    ["mailMgr.SyncMail", [311, 340]],
    ["fleetObjectHandler.GetInitState", []],
    ["fleetObjectHandler.GetWings", []],
    ["fleetObjectHandler.GetMotd", []],
    ["fleetObjectHandler.GetJoinRequests", []],
    ["fleetObjectHandler.GetFleetComposition", []],
  ]) {
    const answer = form(pair, args);
    assert.deepEqual([answer.status, answer.args, answer.kwargs, answer.proxy], ["same", args, null, false], pair);
    assert.match(answer.source, /\.py:\d+$/, pair);
  }
  // All of a pilot's notifications are asked for with the keyword: GetAllNotifications(fromID=fromID).
  for (const given of [[[0], null], [[77], null], [[], null]]) {
    const answer = form("notificationMgr.GetAllNotifications", ...given);
    assert.deepEqual([answer.status, answer.args, answer.kwargs], ["reshaped", [], { fromID: given[0][0] ?? 0 }], JSON.stringify(given));
  }
  const spelt = form("notificationMgr.GetAllNotifications", [], { fromID: 77 });
  assert.deepEqual([spelt.status, spelt.args, spelt.kwargs], ["same", [], { fromID: 77 }]);
  // Said both ways, the keyword is the one that counts, and nothing goes positionally.
  const both = form("notificationMgr.GetAllNotifications", [5], { fromID: 77 });
  assert.deepEqual([both.status, both.args, both.kwargs], ["reshaped", [], { fromID: 77 }]);
});

test("the ledger's last pass left no pair unread", () => {
  // Every pair of docs/game-port-call-ledger.md's pass (the docked routes, as Test Two) has an entry.
  for (const pair of [
    "blueprintManager.GetBlueprintDataByOwner", "charMgr.GetCharacterDescription", "charMgr.GetCloneInfo", "charMgr.GetHomeStation", "charMgr.GetPublicInfo3", "charMgr.ListStations",
    "facilityManager.GetFacilities", "facilityManager.GetMaxActivityModifiers", "fleetObjectHandler.GetFleetComposition", "fleetObjectHandler.GetInitState", "fleetObjectHandler.GetJoinRequests",
    "fleetObjectHandler.GetMotd", "fleetObjectHandler.GetWings", "industryManager.GetJobCounts", "industryManager.GetJobsByOwner", "mailMgr.SyncMail",
    "notificationMgr.GetAllNotifications", "notificationMgr.GetByGroupID", "notificationMgr.GetUnprocessed",
  ]) assert.ok(Object.hasOwn(RETAIL_CALLS, pair), pair);
});
