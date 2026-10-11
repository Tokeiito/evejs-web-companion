"use strict";

// scripts/gamePortAudit.js: what the BFF hands its pilot transport, looked at while the repository's own tests
// run. Two things are looked for: an argument the game port's marshal cannot write, and a call still being made,
// or begun, once its request has been answered. (How it is put into the test processes: scripts/game-port-audit.js.)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { NO_REQUEST, PAGES_OWN_CALL, coverage, createAudit, gather, judge, pageSources, routePatterns } = require("../scripts/gamePortAudit");
const { appRoutes, tableOf } = require("../scripts/appRoutes");
const { retailForm } = require("../src/gamePort/retailCalls");
const { marshalEncode } = require("../src/gameProtocol/marshal");
const { isBridgeWritePair } = require("../src/bridgeCallPolicy");

/** An audit with the BFF's own tools, a request a test sets, and what it noted and saw kept. */
function made(overrides = {}) {
  const notes = [];
  const seen = [];
  const state = { request: null };
  const audit = createAudit({
    retailForm, marshalEncode, isBridgeWritePair,
    currentRequest: () => state.request,
    note: (finding) => notes.push(finding),
    saw: (route, fn, pair) => seen.push([route, fn, pair]),
    ...overrides,
  });
  return { ...audit, notes, seen, state };
}

/** A transport that answers when it is told to. */
function slowGateway() {
  const asked = [];
  const gateway = {
    name: "a gateway",
    readFlightStatus: (handle) => ({ handle }),
    callMethod: (...args) => new Promise((resolve, reject) => asked.push({ fn: "callMethod", args, resolve, reject })),
    bindObject: (...args) => new Promise((resolve, reject) => asked.push({ fn: "bindObject", args, resolve, reject })),
    callBoundMethod: (...args) => new Promise((resolve, reject) => asked.push({ fn: "callBoundMethod", args, resolve, reject })),
  };
  return { gateway, asked };
}

const PLACE = { itemID: 60003760, typeID: 52678, ownerID: 7, flagID: 4, solarSystemID: 30000142, canView: true, canTake: true };
const JOB = {
  blueprintID: 7100000001, blueprintTypeID: 681, activityID: 1, facilityID: 60003760, solarSystemID: 30000142, characterID: 7, corporationID: 98000000,
  account: [7, 1000], runs: 3, licensedRuns: 1, cost: 0, tax: 0, time: 0, materials: {}, inputLocation: PLACE, outputLocation: PLACE, productTypeID: 0,
};

test("a call the marshal can write, as the ledger reshapes it, is no finding; one it cannot is, with its route", async () => {
  const { auditGateway, notes, seen, state } = made();
  const { gateway, asked } = slowGateway();
  const audited = auditGateway(gateway);
  state.request = { route: "POST /api/bridge/industry/install", answered: false };

  // The install's request is a plain object, which the ledger makes the client's dict: it can be written.
  const first = audited.callMethod("industryManager", "InstallJob", [JOB], null, { userid: 4 }, "handle");
  // Handed on as it was given, and answered as the transport answers.
  assert.deepEqual(asked[0].args, ["industryManager", "InstallJob", [JOB], null, { userid: 4 }, "handle"]);
  asked[0].resolve({ result: 5 });
  assert.deepEqual(await first, { result: 5 });
  assert.deepEqual(notes, []);

  // A plain object nothing reshapes cannot.
  state.request = { route: "POST /api/bridge/market/buy-multiple", answered: false };
  const second = audited.callMethod("marketProxy", "BuyMultipleItems", [[{ typeID: 34, quantity: 100 }]], null, {}, "handle");
  asked[1].resolve(null);
  await second;
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].kind, notes[0].fn, notes[0].pair, notes[0].route, notes[0].status], ["unsendable", "callMethod", "marketProxy.BuyMultipleItems", "POST /api/bridge/market/buy-multiple", "unchecked"]);
  assert.match(notes[0].detail, /^Cannot marshal value: object \{"typeID":34/);

  // A keyword's value is an argument too. And what a bind is given goes as it is, by no shape of the ledger's.
  state.request = { route: "POST /api/bridge/x", answered: false };
  audited.callMethod("station", "GetGuests", [], { where: { here: true } }, {}, "handle");
  audited.bindObject("industryManager", "InstallJob", [JOB], null, {}, "handle");
  audited.callBoundMethod("dogmaIM", "ChangeDroneSettings", [{ aggression: 1 }], null, {}, "handle", "bound");
  assert.deepEqual(notes.slice(1).map((finding) => [finding.kind, finding.fn, finding.pair]),
    [["unsendable", "callMethod", "station.GetGuests"], ["unsendable", "bindObject", "industryManager.InstallJob"], ["unsendable", "callBoundMethod", "dogmaIM.ChangeDroneSettings"]]);
  assert.equal(notes[2].status, "bind");

  // Each call was written down as looked at, by its route.
  assert.deepEqual(seen, [
    ["POST /api/bridge/industry/install", "callMethod", "industryManager.InstallJob"], ["POST /api/bridge/market/buy-multiple", "callMethod", "marketProxy.BuyMultipleItems"],
    ["POST /api/bridge/x", "callMethod", "station.GetGuests"], ["POST /api/bridge/x", "bindObject", "industryManager.InstallJob"], ["POST /api/bridge/x", "callBoundMethod", "dogmaIM.ChangeDroneSettings"],
  ]);
});

test("what is not a call of a pilot's is handed on untouched, and a refusal comes through as it was", async () => {
  const { auditGateway, notes, seen } = made();
  const { gateway, asked } = slowGateway();
  const audited = auditGateway(gateway);
  assert.equal(audited.name, "a gateway");
  assert.deepEqual(audited.readFlightStatus("handle"), { handle: "handle" });
  assert.deepEqual([notes, seen], [[], []]);

  const refused = audited.callMethod("station", "GetGuests", [], null, {}, "handle");
  const why = Object.assign(new Error("no"), { code: "CALL_REFUSED" });
  asked[0].reject(why);
  await assert.rejects(refused, (error) => error === why);
  // With no request, it is said so.
  assert.deepEqual(seen, [[NO_REQUEST, "callMethod", "station.GetGuests"]]);
  assert.deepEqual(notes, []);
});

test("a ledger's shape that throws is a finding of its own, and the call is looked at as it came", () => {
  const { auditGateway, notes } = made({ retailForm: () => { throw new Error("the shape broke"); } });
  const audited = auditGateway(slowGateway().gateway);
  audited.callMethod("station", "GetGuests", [{ plain: true }], null, {}, "handle");
  assert.deepEqual(notes.map((finding) => [finding.kind, finding.pair, finding.detail.slice(0, 22)]), [["shape-threw", "station.GetGuests", "the shape broke"], ["unsendable", "station.GetGuests", "Cannot marshal value: "]]);
});

test("a call begun after its request was answered, or still being made when it was, is a finding; one that was done is not", async () => {
  const { auditGateway, notes, state } = made();
  const { gateway, asked } = slowGateway();
  const audited = auditGateway(gateway);
  const request = { route: "POST /api/bridge/industry/preview", answered: false };
  state.request = request;

  // Done before the answer: nothing.
  const done = audited.callMethod("industryMonitor", "ConnectJob", [JOB], null, {}, "handle");
  asked[0].resolve([7, null]);
  await done;
  // Being made when the answer went: a finding, once it is over. A refusal ends it as well as an answer does.
  const pending = audited.callMethod("industryMonitor", "DisconnectJob", [7], null, {}, "handle");
  const read = audited.callBoundMethod("dogmaIM", "GetAllInfo", [], null, {}, "handle", "bound");
  request.answered = true;
  assert.deepEqual(notes, []);
  asked[1].resolve(null);
  asked[2].reject(new Error("gone"));
  await pending;
  await assert.rejects(read);
  // Begun after the answer: a finding at once.
  audited.callBoundMethod("ship", "LaunchDrones", [[1]], null, {}, "handle", "bound");
  assert.deepEqual(notes.map((finding) => [finding.kind, finding.when, finding.fn, finding.pair, finding.route, finding.write]), [
    ["after-answer", "pending", "callMethod", "industryMonitor.DisconnectJob", "POST /api/bridge/industry/preview", true],
    ["after-answer", "pending", "callBoundMethod", "dogmaIM.GetAllInfo", "POST /api/bridge/industry/preview", false],
    ["after-answer", "begun", "callBoundMethod", "ship.LaunchDrones", "POST /api/bridge/industry/preview", true],
  ]);
  // (A call begun after the answer is noted once, as begun, and not again as pending when it ends.)
  asked[3].resolve(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notes.length, 3);

  // A read by the service's name is no write; and with no request there is nothing to be after.
  state.request = { route: "GET /api/bridge/x", answered: true };
  audited.callMethod("industryManager", "GetJobCounts", [7], null, {}, "handle");
  assert.deepEqual([notes[3].when, notes[3].write], ["begun", false]);
  state.request = null;
  audited.callMethod("industryManager", "GetJobCounts", [7], null, {}, "handle");
  assert.equal(notes.length, 4);
});

test("the page's own call is looked at as the BFF would hand it on: read back from its JSON, and reshaped", () => {
  const { auditPageCall, notes, seen } = made();
  // A write the page makes itself, in the client's form.
  auditPageCall({ service: "industryManager", method: "CompleteJob", args: [4200001, 30000142], kwargs: null, pilot: true, confirm: true });
  auditPageCall({ service: "beyonce", method: "BookmarkLocation", args: [5, 6, "here", "", 2], kwargs: { subfolderID: null }, pilot: true, confirm: true });
  // What JSON changes is looked at as changed: a date is text by the time the BFF has it, and text can be written.
  assert.throws(() => marshalEncode([new Date(0)]), /Cannot marshal value/);
  auditPageCall({ service: "station", method: "GetGuests", args: [new Date(0)], kwargs: { since: new Date(0) }, pilot: true });
  assert.deepEqual(notes, []);
  auditPageCall({ service: "planetMgr", method: "UserUpdateNetwork", args: [[{ pinID: 1 }]], kwargs: null, pilot: true, confirm: true, of: 40176368 });
  assert.deepEqual(notes.map((finding) => [finding.kind, finding.fn, finding.pair, finding.route]), [["unsendable", "page", "planetMgr.UserUpdateNetwork", PAGES_OWN_CALL]]);
  // A keyword's value is looked at as an argument is.
  auditPageCall({ service: "station", method: "GetGuests", args: [], kwargs: { where: { here: true } }, pilot: true });
  assert.deepEqual([notes.length, notes[1].pair, notes[1].detail.slice(0, 29)], [2, "station.GetGuests", "Cannot marshal value: object "]);
  notes.pop();
  seen.pop();
  assert.deepEqual(seen, [[PAGES_OWN_CALL, "page", "industryManager.CompleteJob"], [PAGES_OWN_CALL, "page", "beyonce.BookmarkLocation"], [PAGES_OWN_CALL, "page", "station.GetGuests"], [PAGES_OWN_CALL, "page", "planetMgr.UserUpdateNetwork"]]);

  // What is not a pilot's call of the page's is nothing to it.
  for (const other of [null, "text", [1], { service: "x", method: "y", args: [{}] }, { service: "x", method: "y", args: [{}], pilot: false }, { service: "x", args: [{}], pilot: true }, { service: "x", method: "y", args: "none", pilot: true }]) {
    auditPageCall(other);
  }
  assert.equal(notes.length, 1);
  assert.equal(seen.length, 4);
});

// The app's own table of routes, as scripts/appRoutes.js lists it: in the app's order, whatever registered each.
const TABLE = [
  { method: "GET", path: "/api/bridge/industry" },
  { method: "POST", path: "/api/bridge/industry/install" },
  { method: "GET", path: "/api/bridge/planets" },
  { method: "GET", path: "/api/bridge/planets/:planetID/launch" },
  { method: "POST", path: "/api/bridge/planets/:planetID/launch" },
  { method: "POST", path: "/api/bridge/market/buy-multiple" },
  { method: "GET", path: "/api/bridge/chat/:channel" },
  { method: "POST", path: "/api/bridge/call" },
  // A page of the BFF's own, and nothing the page fetches.
  { method: "GET", path: "/goblin-factory" },
];
const API = `
  const data = await getJson("/api/bridge/industry", options);
  await postJson("/api/bridge/industry/install", body, options);
  // Until it left its route this was postJson("/api/bridge/market/buy-multiple", body, options).
  await postJson(\`/api/bridge/planets/\${planetID}/launch\`, body, options);
  await getJson(\`/api/bridge/chat/\${channel}?since=\${since}\`, options);
  await postJson("/api/bridge/call", body, options);
`;

test("the BFF's routes are taken as its app lists them, and each is said to be the page's or not by the whole path", () => {
  const routes = routePatterns(TABLE, API);
  assert.deepEqual(routes.map((route) => [route.method, route.pattern, route.named]), [
    ["GET", "/api/bridge/industry", true], ["POST", "/api/bridge/industry/install", true],
    // The beginning of a path the page names is not that path. A path is the page's by whichever method.
    ["GET", "/api/bridge/planets", false], ["GET", "/api/bridge/planets/:planetID/launch", true], ["POST", "/api/bridge/planets/:planetID/launch", true],
    // Named in a comment only.
    ["POST", "/api/bridge/market/buy-multiple", false], ["GET", "/api/bridge/chat/:channel", true], ["POST", "/api/bridge/call", true],
  ]);
  const launch = routes[4];
  assert.deepEqual(
    [launch.matches("/api/bridge/planets/40176368/launch"), launch.matches("/api/bridge/planets/:n/launch"), launch.matches("/api/bridge/planets/launch"), launch.matches("/api/bridge/planets/1/launch/now"),
      launch.matches("/api/bridge/planets/1/2/launch"), launch.matches("/x/api/bridge/planets/1/launch")],
    [true, true, false, false, false, false],
  );
  // A path is taken as the app takes one: whatever its case, and with a last "/" or without.
  assert.deepEqual(
    [launch.matches("/API/Bridge/planets/7/LAUNCH"), launch.matches("/api/bridge/planets/7/launch/"), launch.matches("/api/bridge/planets/7/launch//"), launch.matches("/api/bridge/planets/7/launches")],
    [true, true, false, false],
  );
});

test("the app's table is read off its stack: a route by each of its paths and each of its methods, in the app's order, and what is no route left out", () => {
  const stack = [
    { handle() {} },
    { route: { path: "/api/a", methods: { get: true } } },
    { route: { path: ["/api/b", "/api/c"], methods: { post: true } } },
    { route: { path: "/api/d", methods: { get: true, post: true } } },
    // (A path that is no text is none the page's sources can name.)
    { route: { path: /^\/api\/e$/, methods: { get: true } } },
  ];
  const expected = [["GET", "/api/a"], ["POST", "/api/b"], ["POST", "/api/c"], ["GET", "/api/d"], ["POST", "/api/d"]];
  for (const app of [{ router: { stack } }, { _router: { stack } }]) {
    assert.deepEqual(tableOf(app).map((route) => [route.method, route.path]), expected);
  }
  assert.deepEqual(tableOf({}), []);
});

test("the page's sources are every source under web/src but its tests and their fixtures", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "page-sources-"));
  try {
    const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
    write("web/src/app/api.ts", "IN-API");
    write("web/src/bridge/callMethod.ts", "IN-CALL");
    write("web/src/ui/App.svelte", "IN-SVELTE");
    write("web/src/app/api.test.ts", "IN-TEST");
    write("web/src/app/botFixtures.ts", "IN-FIXTURES");
    write("web/src/ui/app.css", "IN-CSS");
    write("web/dist/app.js", "IN-DIST");
    write("src/server.js", "IN-BFF");
    const text = pageSources(root);
    assert.deepEqual(["IN-API", "IN-CALL", "IN-SVELTE", "IN-TEST", "IN-FIXTURES", "IN-CSS", "IN-DIST", "IN-BFF"].map((each) => text.includes(each)),
      [true, true, true, false, false, false, false, false]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the app itself lists the routes its source's text has not, and the page's are told by all of the page's sources", () => {
  const root = path.join(__dirname, "..");
  const table = appRoutes();
  const has = (method, at) => table.some((route) => route.method === method && route.path === at);
  // A list of paths in one registration, a helper that registers, and a file of routes of its own.
  for (const [method, at] of [["POST", "/api/login"], ["GET", "/api/bridge/drones"], ["GET", "/api/bridge/script/observation"],
    ["POST", "/api/bridge/drones/recall"], ["POST", "/api/bridge/provisioning/reconcile"]]) {
    assert.equal(has(method, at), true, `${method} ${at}`);
  }
  // And every route the text has, each once.
  const byText = [...fs.readFileSync(path.join(root, "src/server.js"), "utf8").matchAll(/app\.(get|post|put|delete)\("(\/api\/[^"]+)"/g)].map((found) => [found[1].toUpperCase(), found[2]]);
  assert.ok(byText.length > 500, String(byText.length));
  assert.deepEqual(byText.filter(([method, at]) => !has(method, at)), []);
  assert.equal(new Set(table.map((route) => `${route.method} ${route.path}`)).size, table.length);

  const routes = routePatterns(table, pageSources(root));
  const named = (method, pattern) => { const route = routes.find((each) => each.method === method && each.pattern === pattern); return route ? route.named : null; };
  // Named by the page's api.ts, though the text of the BFF's source has no such route; named by another source of
  // the page's than its api.ts (the generic call, the event stream); and named by nothing of the page's.
  assert.deepEqual([named("GET", "/api/bridge/drones"), named("POST", "/api/bridge/provisioning/reconcile"), named("POST", "/api/bridge/call"), named("GET", "/api/bridge/events"),
    named("POST", "/api/bridge/mail/mark-read"), named("POST", "/api/bridge/chat/send-message")], [true, true, true, true, false, false]);
});

test("findings are gathered by kind, route and call, each route by the BFF's own pattern for it", () => {
  const routes = routePatterns(TABLE, API);
  const rows = gather([
    { kind: "unsendable", fn: "callMethod", pair: "marketProxy.BuyMultipleItems", route: "POST /api/bridge/market/buy-multiple", status: "unchecked", detail: "Cannot marshal value: object {}", test: "test/b.test.js" },
    { kind: "unsendable", fn: "callMethod", pair: "marketProxy.BuyMultipleItems", route: "POST /api/bridge/market/buy-multiple", status: "unchecked", detail: "Cannot marshal value: object {}", test: "test/a.test.js" },
    { kind: "unsendable", fn: "callMethod", pair: "marketProxy.BuyMultipleItems", route: "POST /api/bridge/market/buy-multiple", status: "unchecked", detail: "Cannot marshal value: object {}", test: "test/b.test.js" },
    { kind: "after-answer", when: "pending", fn: "callBoundMethod", pair: "planetMgr.UserLaunchCommodities", route: "POST /api/bridge/planets/40176368/launch", write: true, test: "test/a.test.js" },
    { kind: "after-answer", when: "begun", fn: "callBoundMethod", pair: "planetMgr.UserLaunchCommodities", route: "POST /api/bridge/planets/40176369/launch", write: true, test: "test/a.test.js" },
    { kind: "unsendable", fn: "page", pair: "x.Y", route: PAGES_OWN_CALL, status: "unchecked", detail: "Cannot marshal value: object {}", test: "web/src/app/x.test.ts" },
    { kind: "unsendable", fn: "callMethod", pair: "x.Y", route: "POST /api/elsewhere", status: "unchecked", detail: "", test: "test/a.test.js" },
  ], routes);
  assert.deepEqual(rows.map((row) => [row.kind, row.when, row.route, row.named, row.pair, row.tests]), [
    ["after-answer", "begun", "POST /api/bridge/planets/:planetID/launch", true, "planetMgr.UserLaunchCommodities", ["test/a.test.js"]],
    ["after-answer", "pending", "POST /api/bridge/planets/:planetID/launch", true, "planetMgr.UserLaunchCommodities", ["test/a.test.js"]],
    ["unsendable", null, PAGES_OWN_CALL, true, "x.Y", ["web/src/app/x.test.ts"]],
    ["unsendable", null, "POST /api/bridge/market/buy-multiple", false, "marketProxy.BuyMultipleItems", ["test/a.test.js", "test/b.test.js"]],
    ["unsendable", null, "POST /api/elsewhere", false, "x.Y", ["test/a.test.js"]],
  ]);
});

test("a finding is expected only where it is listed and no window can meet it; a listed one not found is said to be gone", () => {
  const row = (more) => ({ kind: "unsendable", when: null, fn: "callMethod", route: "POST /api/bridge/market/buy-multiple", named: false, pair: "marketProxy.BuyMultipleItems", tests: [], ...more });
  const known = [
    { kind: "unsendable", route: "POST /api/bridge/market/buy-multiple", pair: "marketProxy.BuyMultipleItems", why: "asked by nothing of the page" },
    { kind: "unsendable", route: "POST /api/bridge/industry/install", pair: "industryManager.InstallJob", why: "listed, and the page's" },
    { kind: "unsendable", route: "POST /api/bridge/fleet/options", pair: "fleetObjectHandler.SetOptions", why: "asked by nothing of the page" },
  ];
  const verdict = judge([
    row(),
    row({ pair: "marketProxy.PlacePlexSellOrder" }),
    row({ route: "POST /api/bridge/market/buy" }),
    row({ kind: "after-answer", when: "pending" }),
    row({ route: "POST /api/bridge/industry/install", pair: "industryManager.InstallJob", named: true }),
    row({ route: PAGES_OWN_CALL, pair: "x.Y", named: true, fn: "page" }),
  ], known);
  assert.deepEqual(verdict.expected.map((each) => [each.pair, each.why]), [["marketProxy.BuyMultipleItems", "asked by nothing of the page"]]);
  // Another call of the same route, the same call by another route, another kind of finding for the same call,
  // and whatever a window can meet.
  assert.deepEqual(verdict.unexpected.map((each) => [each.kind, each.route, each.pair]), [
    ["unsendable", "POST /api/bridge/market/buy-multiple", "marketProxy.PlacePlexSellOrder"], ["unsendable", "POST /api/bridge/market/buy", "marketProxy.BuyMultipleItems"],
    ["after-answer", "POST /api/bridge/market/buy-multiple", "marketProxy.BuyMultipleItems"],
    ["unsendable", "POST /api/bridge/industry/install", "industryManager.InstallJob"], ["unsendable", PAGES_OWN_CALL, "x.Y"],
  ]);
  assert.deepEqual(verdict.gone.map((each) => each.pair), ["fleetObjectHandler.SetOptions"]);
  assert.deepEqual(judge([], []), { expected: [], unexpected: [], gone: [] });
});

test("what was looked at is measured against the routes the page names and the writes it makes itself", () => {
  const routes = routePatterns(TABLE, API);
  const measured = coverage([
    { route: "GET /api/bridge/industry", fn: "request", pair: "-" }, { route: "GET /api/bridge/industry", fn: "callMethod", pair: "industryManager.GetJobCounts" },
    { route: "POST /api/bridge/planets/:n/launch", fn: "request", pair: "-" },
    { route: "POST /api/bridge/market/buy-multiple", fn: "request", pair: "-" }, { route: "POST /api/bridge/market/buy-multiple", fn: "callMethod", pair: "marketProxy.BuyMultipleItems" },
    { route: "GET /api/bridge/chat/local", fn: "request", pair: "-" }, { route: "GET /api/bridge/chat/local", fn: "bindObject", pair: "LSC.MachoBindObject" },
    { route: "POST /api/bridge/call", fn: "request", pair: "-" }, { route: "POST /api/bridge/call", fn: "callMethod", pair: "ship.ScoopDrone" },
    { route: PAGES_OWN_CALL, fn: "page", pair: "ship.ScoopDrone" }, { route: PAGES_OWN_CALL, fn: "page", pair: "station.GetGuests" },
    { route: NO_REQUEST, fn: "callMethod", pair: "ship.Undock" },
  ], routes, ["ship.ScoopDrone", "industryManager.CompleteJob"]);
  assert.deepEqual(measured, {
    named: 6,
    asked: 4,
    called: 3,
    // (The launch's twin by the other method was asked by nothing: a route is asked by its method and its path.)
    notAsked: ["POST /api/bridge/industry/install", "GET /api/bridge/planets/:planetID/launch"],
    askedWithNoCall: ["POST /api/bridge/planets/:planetID/launch"],
    pageCalls: 2,
    pageWritesNotSeen: ["industryManager.CompleteJob"],
    withNoRequest: 1,
  });
});
