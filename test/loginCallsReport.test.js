"use strict";

// scripts/login-calls-report.js: what a client asked of the server as it logged in, read out of the server's own
// log, and the retail client's login set beside the game port's. The logs here are made up, in the two forms the
// server has written its packet lines in.

const test = require("node:test");
const assert = require("node:assert/strict");
const { callsIn, methodServices, attributed, compare, knownCalls, report } = require("../scripts/login-calls-report");

const NOW = [
  "[2026-10-06T15:08:55.416Z] [PKT] IN  machoNet CALL_REQ src=client dst=node",
  "[2026-10-06T15:08:55.416Z] [PKT] IN  machoNet GetServiceInfo() callID=1",
  "[2026-10-06T15:08:55.500Z] [PKT] IN  PING_REQ PING_REQ src=client dst=any",
  "[2026-10-06T15:08:56.000Z] [PKT] IN  charUnboundMgr GetCharacterSelectionData() callID=2",
  "[2026-10-06T15:08:56.100Z] [PKT] OUT charUnboundMgr response callID=2",
  "[2026-10-06T15:09:21.840Z] [PKT] IN  charUnboundMgr SelectCharacterID() callID=3",
  "[2026-10-06T15:09:22.700Z] [PKT] IN  dogmaIM MachoResolveObject() callID=4",
  "[2026-10-06T15:09:22.750Z] [PKT] IN  dogmaIM MachoBindObject() callID=5",
  "[2026-10-06T15:09:22.758Z] [DBG] bound object registered: N=65450:1 -> dogmaIM",
  "[2026-10-06T15:09:22.800Z] [PKT] IN  CALL_REQ CALL_REQ src=client dst=node",
  "[2026-10-06T15:09:22.801Z] [PKT] IN  N=65450:1 GetAllInfo() callID=6",
  "[2026-10-06T15:09:22.900Z] [PKT] IN  N=65450:7 GetWars() callID=7",
  "[2026-10-06T15:09:23.000Z] [PKT] IN  standingMgr GetNPCNPCStandings() callID=8",
  "[2026-10-06T15:09:23.100Z] [PKT] IN  N=65450:1 GetAllInfo() callID=9",
].join("\n");

// The older form: colours, a clock with no date, and no word of which service an object is.
const THEN = [
  "\u001b[2m20:48:33\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mmachoNet\u001b[39m\u001b[22m \u001b[36mCALL_REQ src=client dst=node\u001b[39m",
  "\u001b[2m20:48:33\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mmachoNet\u001b[39m\u001b[22m \u001b[36mGetServiceInfo() callID=1\u001b[39m",
  "\u001b[2m20:48:35\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mPING_REQ\u001b[39m\u001b[22m \u001b[36mPING_REQ src=client dst=any\u001b[39m",
  "\u001b[2m20:48:35\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m Ping request received",
  "\u001b[2m20:48:57\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mcharUnboundMgr\u001b[39m\u001b[22m \u001b[36mSelectCharacterID() callID=51\u001b[39m",
  "\u001b[2m20:48:57\u001b[22m \u001b[44m\u001b[37m INFO  \u001b[39m\u001b[49m [CharService] SelectCharacterID(140000001)",
  "\u001b[2m20:48:58\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mN=65450:3\u001b[39m\u001b[22m \u001b[36mGetAllInfo() callID=52\u001b[39m",
  "\u001b[2m20:48:58\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mN=65450:9\u001b[39m\u001b[22m \u001b[36mList() callID=53\u001b[39m",
  "\u001b[2m20:48:58\u001b[22m \u001b[46m\u001b[30m IN  \u001b[39m\u001b[49m \u001b[1m\u001b[36mstandingMgr\u001b[39m\u001b[22m \u001b[36mGetCharStandings() callID=54\u001b[39m",
].join("\r\n");

const pairs = (calls) => calls.map((call) => call.pair);

test("a server's log is read for the calls a client made, in order, in either form the log has been written in", () => {
  const now = callsIn(NOW);
  assert.deepEqual(pairs(now), [
    "machoNet.GetServiceInfo", "charUnboundMgr.GetCharacterSelectionData", "charUnboundMgr.SelectCharacterID",
    "dogmaIM.MachoResolveObject", "dogmaIM.MachoBindObject", "dogmaIM.GetAllInfo", "(an object).GetWars", "standingMgr.GetNPCNPCStandings", "dogmaIM.GetAllInfo",
  ]);
  // A call on a bound object is its service's, where the log says whose object it is; and says it was on an object.
  assert.deepEqual(now.map((call) => [call.service, call.method, call.onObject]).slice(5, 7), [["dogmaIM", "GetAllInfo", true], [null, "GetWars", true]]);
  // Each says whether a character had been chosen by then: the choosing itself is the first that had.
  assert.deepEqual(now.map((call) => call.chosen), [false, false, true, true, true, true, true, true, true]);
  assert.deepEqual([now[0].line, now[2].line, now[5].line, now[2].at], [2, 6, 11, "2026-10-06T15:09:21.840Z"]);

  const then = callsIn(THEN);
  assert.deepEqual(pairs(then), ["machoNet.GetServiceInfo", "charUnboundMgr.SelectCharacterID", "(an object).GetAllInfo", "(an object).List", "standingMgr.GetCharStandings"]);
  assert.deepEqual(then.map((call) => [call.chosen, call.at]), [[false, "20:48:33"], [true, "20:48:57"], [true, "20:48:58"], [true, "20:48:58"], [true, "20:48:58"]]);

  // Only the lines asked for are read.
  assert.deepEqual(pairs(callsIn(NOW, { from: 6, to: 8 })), ["charUnboundMgr.SelectCharacterID", "dogmaIM.MachoResolveObject", "dogmaIM.MachoBindObject"]);
  // Whose object a later line's is was said earlier in the log, before the lines asked for: it is known all the same.
  assert.deepEqual(pairs(callsIn(NOW, { from: 14 })), ["dogmaIM.GetAllInfo"]);
  // An object's number is used again for another service's: the last word before the call is whose it is.
  const reused = `${NOW}
[2026-10-06T15:10:00.000Z] [DBG] bound object registered: N=65450:1 -> crimewatch
[2026-10-06T15:10:01.000Z] [PKT] IN  N=65450:1 GetClientStates() callID=10`;
  assert.deepEqual(pairs(callsIn(reused)).slice(-2), ["dogmaIM.GetAllInfo", "crimewatch.GetClientStates"]);
  assert.deepEqual(callsIn(""), []);
});

test("a call on an object the log does not name is given the one service another log says has that method", () => {
  const table = methodServices(callsIn(NOW));
  assert.deepEqual([...table], [["GetAllInfo", "dogmaIM"]]);
  const named = attributed(callsIn(THEN), table);
  assert.deepEqual(pairs(named), ["machoNet.GetServiceInfo", "charUnboundMgr.SelectCharacterID", "dogmaIM.GetAllInfo", "(an object).List", "standingMgr.GetCharStandings"]);
  assert.deepEqual([named[2].service, named[2].inferred, named[3].service, named[3].inferred, named[0].inferred], ["dogmaIM", true, null, false, false]);
  // A call the log itself names is not one that was inferred, whatever the table has for its method.
  assert.deepEqual(attributed(callsIn(NOW), table).filter((call) => call.inferred), []);
  // A method two services' objects have is nobody's to give.
  const both = [
    { pair: "invbroker.List", service: "invbroker", method: "List", onObject: true },
    { pair: "ship.List", service: "ship", method: "List", onObject: true },
    { pair: "dogmaIM.GetAllInfo", service: "dogmaIM", method: "GetAllInfo", onObject: true },
    // A service's own method by the same name as an object's says nothing of objects.
    { pair: "config.GetAllInfo", service: "config", method: "GetAllInfo", onObject: false },
  ];
  assert.deepEqual([...methodServices(both)], [["GetAllInfo", "dogmaIM"]]);
});

test("the retail client's login is set beside ours: what we ask then too, what a feature or a route of ours asks later, and what we never ask", () => {
  const retail = attributed(callsIn(NOW), new Map());
  const ours = callsIn([
    "[2026-10-09T11:00:00.000Z] [PKT] IN  machoNet GetServiceInfo() callID=1",
    "[2026-10-09T11:00:01.000Z] [PKT] IN  charUnboundMgr GetCharacterSelectionData() callID=2",
    "[2026-10-09T11:00:02.000Z] [PKT] IN  charUnboundMgr SelectCharacterID() callID=3",
    "[2026-10-09T11:00:03.000Z] [PKT] IN  dogmaIM MachoResolveObject() callID=4",
    "[2026-10-09T11:00:03.100Z] [PKT] IN  dogmaIM MachoBindObject() callID=5",
    "[2026-10-09T11:00:03.200Z] [PKT] IN  account GetCashBalance() callID=6",
  ].join("\n"));
  // What ours asks at login is "at login", whether a feature of ours asks it too or not.
  // A feature's call has been read against the client's; a route's is only one the BFF can make. Read outranks routed.
  const compared = compare(retail, ours, { read: new Set(["dogmaIM.GetAllInfo", "machoNet.GetServiceInfo"]), routed: new Set(["standingMgr.GetNPCNPCStandings", "dogmaIM.GetAllInfo", "charUnboundMgr.SelectCharacterID"]) });
  assert.deepEqual(compared.retail.map((row) => [row.pair, row.calls, row.chosen, row.ours]), [
    ["machoNet.GetServiceInfo", 1, false, "at login"],
    ["charUnboundMgr.GetCharacterSelectionData", 1, false, "at login"],
    ["charUnboundMgr.SelectCharacterID", 1, true, "at login"],
    ["dogmaIM.MachoResolveObject", 1, true, "at login"],
    ["dogmaIM.MachoBindObject", 1, true, "at login"],
    // Asked twice by the client, and by a feature of ours when it is wanted.
    ["dogmaIM.GetAllInfo", 2, true, "by a feature"],
    // Whose object it was is not known: it cannot be said that we ask it.
    ["(an object).GetWars", 1, true, "never"],
    ["standingMgr.GetNPCNPCStandings", 1, true, "by a route"],
  ]);
  assert.deepEqual(compared.oursOnly.map((row) => [row.pair, row.calls]), [["account.GetCashBalance", 1]]);
  assert.deepEqual(compared.counts, { pairs: 8, calls: 9, "at login": 5, "by a feature": 1, "by a route": 1, never: 1 });
  // The same call made in both parts of a login is two rows: before a character is chosen, and after.
  const twice = compare([{ pair: "config.Get", chosen: false }, { pair: "config.Get", chosen: true }, { pair: "config.Get", chosen: true }], [], { read: new Set(), routed: new Set() });
  assert.deepEqual(twice.retail.map((row) => [row.pair, row.calls, row.chosen]), [["config.Get", 1, false], ["config.Get", 2, true]]);
});

test("the report names what it was made from, counts the three kinds, and lists each of the client's calls in the order it first made them", () => {
  const retail = attributed(callsIn(NOW), new Map());
  const ours = callsIn("[2026-10-09T11:00:00.000Z] [PKT] IN  machoNet GetServiceInfo() callID=1\n[2026-10-09T11:00:02.000Z] [PKT] IN  account GetCashBalance() callID=6");
  const text = report({ retail, ours, known: { read: new Set(["dogmaIM.GetAllInfo"]), routed: new Set(["standingMgr.GetNPCNPCStandings"]) }, what: { retail: "a made-up client", ours: "a made-up pilot" } });
  assert.match(text, /^# Game-port login calls\n/);
  assert.match(text, /a made-up client/);
  assert.match(text, /a made-up pilot/);
  assert.match(text, /Do not edit/);
  // The counts, as a table.
  assert.match(text, /\| at login \| 1 \|/);
  assert.match(text, /\| by a feature \| 1 \| 2 \|/);
  assert.match(text, /\| by a route \| 1 \| 1 \|/);
  assert.match(text, /\| never \| 5 \| 5 \|/);
  // Each call once, in the client's order, under the part of the login it was made in.
  const order = ["Before a character is chosen", "`machoNet.GetServiceInfo`", "`charUnboundMgr.GetCharacterSelectionData`", "From the choosing of a character", "`charUnboundMgr.SelectCharacterID`", "`dogmaIM.GetAllInfo` | 2", "`(an object).GetWars`", "`standingMgr.GetNPCNPCStandings`", "Asked by the game port and not by the client", "`account.GetCashBalance`"];
  const at = order.map((piece) => text.indexOf(piece));
  assert.deepEqual(at.map((index) => index >= 0), order.map(() => true), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // It ends with a newline, and says nothing of anybody's clock but as the log had it.
  assert.equal(text.endsWith("\n"), true);
});

test("what of ours can make a call: the registry's calls and the transport's own binds as read, the BFF's list as routed", () => {
  const { read, routed } = knownCalls();
  // A registry pair; and the resolving and binding of a service the transport binds as the client's Moniker does,
  // whether the registry names it a moniker's or the BFF may bind it.
  for (const pair of ["fleetObjectHandler.GetInitState", "skillHandler.MachoBindObject", "skillHandler.MachoResolveObject", "crimewatch.MachoBindObject", "fleetObjectHandler.MachoResolveObject", "invbroker.MachoBindObject"]) assert.equal(read.has(pair), true, pair);
  // A call of the client's own that the transport makes for a feature and no route may ask: read, and not routed.
  assert.deepEqual([read.has("config.GetMultiOwnersEx"), routed.has("config.GetMultiOwnersEx")], [true, false]);
  // The BFF's list has what a route can ask, read or not.
  for (const pair of ["charMgr.GetContactList", "fleetObjectHandler.GetInitState", "invbroker.MachoBindObject"]) assert.equal(routed.has(pair), true, pair);
  // A service nothing of ours binds is not read as bound, and a call nothing of ours makes is on neither.
  for (const pair of ["populationCap.MachoBindObject", "populationCap.MachoResolveObject", "config.GetBlackListedPlanets"]) assert.deepEqual([read.has(pair), routed.has(pair)], [false, false], pair);
  // A resolve is not on the BFF's list of itself: it is the transport's own, with the bind.
  assert.equal(routed.has("invbroker.MachoResolveObject"), false);
});
