"use strict";

// A tally of what the BFF asks the web gateway, and what the plan makes of each row.
//
// The plan's cutover (docs/game-port-transport-plan.md, Phase 5) is done when the only gateway routes the BFF
// calls are the account-level ones of 2.3. The tally is how that is read: kept in the gateway client, beneath the
// seam that sends a pilot to its transport.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { KINDS, ROUTES, createGatewayLedger, kindOf } = require("../src/gatewayLedger");
const { namedInThePlan, report } = require("../scripts/gateway-ledger-report");

const HANDLE = "opaque-gateway-session";
const brief = (ledger) => ledger.rows().map((row) => [row.fn, row.pair, row.held, row.online, row.calls, row.kind]);

/** A stand-in for the gateway client: each function says what it was called with, and on what. */
function standIn() {
  const client = {
    seen: [],
    name: "the gateway",
    async callMethod(...args) { client.seen.push(["callMethod", this === client, args]); return { result: 1 }; },
    async bindObject(...args) { client.seen.push(["bindObject", this === client, args]); return { boundHandle: "b" }; },
    async callBoundMethod(...args) { client.seen.push(["callBoundMethod", this === client, args]); return { result: 2 }; },
    async getSkills(...args) { client.seen.push(["getSkills", this === client, args]); return { skills: [] }; },
    async getSnapshot() { return {}; },
    async getCharacterStatus() { return { online: true }; },
    async saveOfflineSkillQueue() { return {}; },
    async getGatewayHealth() { return { ok: true }; },
    async readFlightStatus() { throw new Error("refused"); },
    createChatSession() { throw new Error("no chat here"); },
  };
  return client;
}

test("every function of the client is counted as it is called, and called as it was: its arguments, its answer, and the client it is of", async () => {
  const ledger = createGatewayLedger();
  const client = standIn();
  const counted = ledger.counted(client);
  assert.deepEqual(await counted.callMethod("corpRegistry", "GetCorporation", [], null, { userid: 2 }, HANDLE), { result: 1 });
  assert.deepEqual(await counted.getSkills(2, 140000001), { skills: [] });
  assert.deepEqual(client.seen, [["callMethod", true, ["corpRegistry", "GetCorporation", [], null, { userid: 2 }, HANDLE]], ["getSkills", true, [2, 140000001]]]);
  // What is no function is handed on as it is, and what the client has not got, the counted one has not got.
  assert.deepEqual([counted.name, counted.seen, typeof counted.openSessionEventStream, "openSessionEventStream" in counted], ["the gateway", client.seen, "undefined", false]);
  // A call that fails is counted all the same, and fails for who made it, whether it throws or rejects.
  await assert.rejects(counted.readFlightStatus(HANDLE), /refused/);
  assert.throws(() => counted.createChatSession({}), /no chat here/);
  assert.deepEqual(brief(ledger).map((row) => [row[0], row[4]]).sort(), [["callMethod", 1], ["createChatSession", 1], ["getSkills", 1], ["readFlightStatus", 1]]);
});

test("a call or a bind is a row for each pair, held or not; anything else is a row for its function", async () => {
  const ledger = createGatewayLedger();
  const counted = ledger.counted(standIn());
  for (let time = 0; time < 3; time += 1) await counted.callMethod("invbroker", "GetInventory", [60003760], null, {}, HANDLE);
  await counted.callMethod("structureDirectory", "GetStructureInfo", [1], null, { userid: 2 });
  await counted.callMethod("structureDirectory", "GetStructureInfo", [2], null, { userid: 2 }, undefined);
  await counted.callMethod("structureDirectory", "GetStructureInfo", [3], null, { userid: 2 }, HANDLE);
  await counted.bindObject("invbroker", "GetInventory", [60003760], null, {}, HANDLE);
  await counted.bindObject("invbroker", "GetInventory", [60003760], null, {}, "");
  await counted.callBoundMethod("invbroker", "List", [4], null, {}, HANDLE, "bound");
  await counted.getGatewayHealth();
  await counted.getGatewayHealth();
  // The most called first; among equals, by function and pair.
  assert.deepEqual(brief(ledger), [
    ["callMethod", "invbroker.GetInventory", true, null, 3, "pilot"],
    ["callMethod", "structureDirectory.GetStructureInfo", false, null, 2, "unheld"],
    ["getGatewayHealth", null, null, null, 2, "account"],
    ["bindObject", "invbroker.GetInventory", true, null, 1, "pilot"],
    ["bindObject", "invbroker.GetInventory", false, null, 1, "unheld"],
    ["callBoundMethod", "invbroker.List", true, null, 1, "pilot"],
    ["callMethod", "structureDirectory.GetStructureInfo", true, null, 1, "pilot"],
  ]);
  assert.deepEqual(ledger.rows().map((row) => row.route), ["/call", "/call", "/health", "/bound/bind", "/bound/bind", "/bound/call", "/call"]);
  ledger.forget();
  assert.deepEqual(ledger.rows(), []);
});

test("a read of one character says whether that character was online here then, and so whether the plan keeps it", async () => {
  const online = new Set([140000001]);
  const ledger = createGatewayLedger({ isOnline: (characterID) => online.has(characterID) });
  const counted = ledger.counted(standIn());
  await counted.getSkills(2, 140000001);
  await counted.getSkills(2, 140000002);
  await counted.getSkills(2, "140000001");
  await counted.saveOfflineSkillQueue(2, 140000001, {});
  await counted.saveOfflineSkillQueue(2, 140000002, {});
  await counted.getCharacterStatus(2, 140000001);
  await counted.getSnapshot(2, 140000001);
  await counted.getSnapshot(2, 140000002);
  // What is no character is nobody's: not said to be online or offline.
  await counted.getSkills(2, 0);
  await counted.getSkills(2);
  assert.deepEqual(brief(ledger).map((row) => [row[0], row[3], row[4], row[5]]).sort(), [
    // The status of a character is account-level whoever it is.
    ["getCharacterStatus", true, 1, "account"],
    // The skills, and the queue saved, are kept for pilots who are offline: of one online here it is another matter.
    // (As the rows sort: one that is nobody's first.)
    ["getSkills", null, 2, "account"], ["getSkills", false, 1, "account"], ["getSkills", true, 2, "online"],
    // The snapshot is no route the plan keeps, whoever it is of.
    ["getSnapshot", false, 1, "unlisted"], ["getSnapshot", true, 1, "unlisted"],
    ["saveOfflineSkillQueue", false, 1, "account"], ["saveOfflineSkillQueue", true, 1, "online"],
  ]);
  // Who is online is asked of whatever is being watched now; one that fails or says neither is "not known".
  const later = createGatewayLedger();
  const again = later.counted(standIn());
  await again.getSkills(2, 140000001);
  later.watch({ isOnline: () => true });
  await again.getSkills(2, 140000001);
  later.watch({ isOnline: () => { throw new Error("no"); } });
  await again.getSkills(2, 140000001);
  later.watch({ isOnline: () => "yes" });
  await again.getSkills(2, 140000001);
  later.watch({});
  await again.getSkills(2, 140000001);
  assert.deepEqual(brief(later).map((row) => [row[3], row[4], row[5]]), [[null, 4, "account"], [true, 1, "online"]]);
});

test("what the plan makes of each of the client's functions", () => {
  const row = (fn, more = {}) => ({ fn, route: ROUTES[fn], pair: null, held: null, online: null, calls: 1, ...more });
  // The pilot's nine: a held pilot's own, which a pilot on the game port asks none of.
  for (const fn of ["selectCharacter", "callBoundMethod", "releaseBridgeSession", "readFlightStatus", "readScannerState", "readSpaceSnapshot", "openSessionEventStream"]) {
    assert.equal(kindOf(row(fn)), "pilot", fn);
  }
  // A call or a bind with a session named is the pilot's; with none it is made as a pilot who is not logged in.
  for (const fn of ["callMethod", "bindObject"]) {
    assert.deepEqual([kindOf(row(fn, { held: true })), kindOf(row(fn, { held: false }))], ["pilot", "unheld"], fn);
  }
  assert.equal(kindOf(row("callBoundMethod", { held: false })), "pilot");
  // The account-level routes of 2.3.
  for (const fn of ["getGatewayHealth", "getStatus", "getAccount", "createAccount", "listCharacters", "getCharacterStatus"]) {
    assert.deepEqual([kindOf(row(fn)), kindOf(row(fn, { online: true }))], ["account", "account"], fn);
  }
  for (const fn of ["getSkills", "saveOfflineSkillQueue"]) {
    assert.deepEqual([kindOf(row(fn)), kindOf(row(fn, { online: false })), kindOf(row(fn, { online: true }))], ["account", "account", "online"], fn);
  }
  // The snapshot's route is not among them; nor is a function nobody has given a route.
  assert.deepEqual([kindOf(row("getSnapshot")), kindOf(row("somethingNew", { route: null }))], ["unlisted", "unlisted"]);
  assert.equal(kindOf(row("createChatSession")), "chat");
  // Every kind there is has its meaning, and every function a route.
  assert.deepEqual(Object.keys(KINDS).sort(), ["account", "chat", "online", "pilot", "unheld", "unlisted"]);
  for (const meaning of Object.values(KINDS)) assert.ok(meaning.length > 20, meaning);
});

test("the gateway client itself is counted: every function it has is one the tally knows the route of, and the route is the client's", () => {
  const client = require("../src/eveGatewayClient");
  const functions = Object.keys(client).filter((name) => name !== "EveGatewayError" && name !== "gatewayLedger");
  assert.deepEqual(functions.slice().sort(), Object.keys(ROUTES).sort());
  // Each is the counting one, and the error class is left as it is: something to make and to test for.
  for (const name of functions) assert.equal(client[name].name, "counted", name);
  assert.ok(new client.EveGatewayError("x") instanceof Error);
  assert.deepEqual([typeof client.gatewayLedger.rows, Array.isArray(client.gatewayLedger.rows())], ["function", true]);
  // The route written beside each function is the one the client's source asks.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "eveGatewayClient.js"), "utf8");
  for (const [name, route] of Object.entries(ROUTES)) {
    if (name === "createChatSession") continue;
    assert.ok(source.includes(`"${route}"`), `${name}: ${route}`);
    const from = source.indexOf(`function ${name}(`);
    assert.ok(from >= 0, name);
    // Its own function is where the route is asked, before the next function begins. (The event stream's is a constant above it.)
    const body = source.slice(from, source.indexOf("\nfunction ", from + 1) > 0 ? Math.min(...["\nfunction ", "\nasync function "].map((mark) => { const at = source.indexOf(mark, from + 1); return at < 0 ? source.length : at; })) : source.length);
    assert.ok(name === "openSessionEventStream" || body.includes(`"${route}"`), `${name} asks ${route}`);
  }
});

test("a BFF built round a stand-in for the gateway has no tally of the gateway", () => {
  const { createApp } = require("../src/server");
  const app = createApp({ eveGatewayClient: standIn(), eveStore: {}, webAuth: { requireAuth: (req, res, next) => next() } });
  assert.equal(app.locals.gatewayLedger, null);
});

test("a BFF on the gateway client itself has the client's tally, and tells it who is online here", async () => {
  const client = require("../src/eveGatewayClient");
  const { createApp } = require("../src/server");
  const sessions = new Map();
  const configured = process.env.EVEJS_GATEWAY_URL;
  // No gateway to reach: every call of the client's fails before anything is sent, and is counted all the same.
  process.env.EVEJS_GATEWAY_URL = "not a gateway";
  try {
    const app = createApp({ bridgeSessionStore: sessions, eveStore: {}, webAuth: { requireAuth: (req, res, next) => next() }, env: {} });
    assert.equal(app.locals.gatewayLedger, client.gatewayLedger);
    client.gatewayLedger.forget();
    await assert.rejects(client.getSkills(2, 140000001), (error) => error.code === "EVE_GATEWAY_CONFIGURATION");
    // The pilot comes online on this BFF: the same read is of an online pilot now, and another pilot's is not.
    sessions.set("a-web-session", { characterID: 140000001, bridgeSessionID: HANDLE });
    await assert.rejects(client.getSkills(2, 140000001));
    await assert.rejects(client.getSkills(2, 140000002));
    sessions.set("a-web-session-with-nobody", null);
    await assert.rejects(client.getSkills(2, 140000002));
    assert.deepEqual(brief(client.gatewayLedger).map((row) => [row[0], row[3], row[4], row[5]]), [["getSkills", false, 3, "account"], ["getSkills", true, 1, "online"]]);
  } finally {
    if (configured === undefined) delete process.env.EVEJS_GATEWAY_URL;
    else process.env.EVEJS_GATEWAY_URL = configured;
    client.gatewayLedger.forget();
    client.gatewayLedger.watch({});
  }
});

test("the report sets the rows beside the plan, and says what still stands before the cutover", () => {
  const rows = [
    { fn: "callMethod", route: "/call", pair: "invbroker.GetInventory", held: true, online: null, calls: 7 },
    { fn: "readSpaceSnapshot", route: "/space/snapshot", pair: null, held: null, online: null, calls: 40 },
    { fn: "getSkills", route: "/skills", pair: null, held: null, online: true, calls: 2 },
    { fn: "getSkills", route: "/skills", pair: null, held: null, online: false, calls: 5 },
    { fn: "getSnapshot", route: "/snapshot", pair: null, held: null, online: true, calls: 1 },
    { fn: "callMethod", route: "/call", pair: "structureDirectory.GetStructureInfo", held: false, online: null, calls: 3 },
    { fn: "callMethod", route: "/call", pair: "corpFittingMgr.GetFittings", held: false, online: null, calls: 1 },
    { fn: "callMethod", route: "/call", pair: "market|Proxy.GetOrders", held: false, online: null, calls: 4 },
    { fn: "getGatewayHealth", route: "/health", pair: null, held: null, online: null, calls: 9 },
    { fn: "createChatSession", route: "the chat edge", pair: null, held: null, online: null, calls: 1 },
  ];
  const text = report(rows, { what: "a made-up walk", generatedOn: "2026-10-10" });
  assert.match(text, /^# What the BFF asks the web gateway\n\nGenerated by `scripts\/gateway-ledger-report\.js` on 2026-10-10, from a made-up walk\./);
  // The summary: rows and calls of each kind, in the order the cutover has to be rid of them.
  const summary = [...text.matchAll(/^\| (pilot|online|unlisted|unheld|account|chat|\*\*total\*\*) \| (\**\d+\**) \| (\**\d+\**) \|/gm)].map((match) => [match[1], match[2], match[3]]);
  assert.deepEqual(summary, [["pilot", "2", "47"], ["online", "1", "2"], ["unlisted", "1", "1"], ["unheld", "3", "8"], ["account", "2", "14"], ["chat", "1", "1"], ["**total**", "**10**", "**73**"]]);
  assert.match(text, /\*\*Still to go before the cutover is done: 4 rows \(50 calls\) under `pilot`, `online` or `unlisted`, and 1 pair asked as a pilot not logged in that the plan does not name\.\*\*/);
  // Each kind's rows, and for a call as a pilot not logged in whether the plan names it. A bar in a pair does not break the table.
  assert.match(text, /## pilot \(2\)\n\n\| Function \| Route \| Pair \| Calls \|\n\|---\|---\|---\|---\|\n\| `callMethod` \| `\/call` \| `invbroker\.GetInventory` \| 7 \|\n\| `readSpaceSnapshot` \| `\/space\/snapshot` \|  \| 40 \|/);
  assert.match(text, /\| `callMethod` \| `structureDirectory\.GetStructureInfo` \| 3 \| yes \|\n\| `callMethod` \| `corpFittingMgr\.GetFittings` \| 1 \| yes \|\n\| `callMethod` \| `market\\\|Proxy\.GetOrders` \| 4 \| \*\*no\*\* \|/);
  assert.match(text, /## online \(1\)\n\n\| Function \| Route \| The character \| Calls \|\n\|---\|---\|---\|---\|\n\| `getSkills` \| `\/skills` \| online here \| 2 \|/);
  assert.match(text, /\| `getSkills` \| `\/skills` \| not online here \| 5 \|\n\| `getGatewayHealth` \| `\/health` \|  \| 9 \|/);
  // A kind with no row has no section.
  const quiet = report(rows.filter((row) => kindOf(row) === "account" || (kindOf(row) === "unheld" && namedInThePlan(row.pair))), { generatedOn: "2026-10-10" });
  assert.doesNotMatch(quiet, /## (pilot|online|unlisted|chat)/);
  assert.match(quiet, /\*\*Nothing here stands between this walk and the cutover:\*\*/);
  assert.match(report([rows[0]], { generatedOn: "2026-10-10" }), /Still to go before the cutover is done: 1 row \(7 calls\) under `pilot`, `online` or `unlisted`\.\*\*/);
  assert.match(report([rows[4]], { generatedOn: "2026-10-10" }), /done: 1 row \(1 call\) under/);
  // A call as a pilot not logged in that the plan does not name stands in the way by itself, with every row kept.
  const unnamedOnly = report([rows[7], rows[8]], { generatedOn: "2026-10-10" });
  assert.match(unnamedOnly, /\*\*Still to go before the cutover is done: 1 pair asked as a pilot not logged in that the plan does not name\.\*\*/);
  assert.doesNotMatch(unnamedOnly, /Nothing here stands/);
  assert.match(report([rows[7], { ...rows[7], pair: "x.Y" }], { generatedOn: "2026-10-10" }), /done: 2 pairs asked as a pilot not logged in/);
  // What the plan names of the calls made as a pilot who is not logged in (2.3).
  assert.deepEqual(["structureDirectory.GetMyDockableStructures", "corpRegistry.GetCorporation", "officeManager.GetMyCorporationsOffices", "corpFittingMgr.GetFittings", "officeManager.RentOffice", "corpFittingMgr.SaveFitting", "charUnboundMgr.GetCharacterSelectionData"].map(namedInThePlan),
    [true, true, true, true, false, false, false]);
});
