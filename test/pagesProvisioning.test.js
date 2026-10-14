"use strict";

// Five of the page's routes that no test of the BFF's asked, by the game-port audit's own list of 2026-10-12:
//
//   POST /api/bridge/provisioning/reconcile        GET  /api/ship-provisioning/operation
//   POST /api/ship-provisioning/login              GET  /api/mining-operations/preparation-options
//   POST /api/ship-provisioning/recover
//
// The first is the cockpit's: a held pilot's transfer whose outcome was not proven is looked at again, and nothing
// is sent. It has two askers in the Provisioning panel, one for supplies loaded and one for a ship being made,
// and the route answers each from another branch. The next three are the Ship Provisioning Center's, a page of
// its own with a door of its own: its sign-in, the state of an Apply it polls while one runs, and the control an
// Apply left unproven looked at again. The last is the Mining window's read of the fittings a member's
// preparation may name.
//
// Each side had tests of its own and neither met the other: the page's answer themselves, and the BFF's ask
// their routes by hand. So each route is asked here BY THE PAGE'S OWN ASKER (web/src/app/api.ts,
// web/src/provisioning/centerClient.ts) of the BFF's own route, over a server that is stood in for.
//
// The Center's askers take no options: they use the tab's own `fetch`, with a path that has no origin. That
// `fetch` is stood in for, and sends the path on to the BFF. The data folder is a temporary one, set before the
// server is loaded.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-provisioning-"));
process.env.EVEJS_WEB_POC_DATA_DIR = DATA;

const { createApp } = require("../src/server");

const realFetch = globalThis.fetch;
const activeServers = new Set();
/** What a test holds open, let go of whatever the test found. */
const letGo = new Set();

const object = (fields) => ({ type: "object", args: { type: "dict", entries: Object.entries(fields) } });
const list = (items) => ({ type: "list", items });
const refused = (status, code) => (error) => error.status === status && error.code === code;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** Waits a little at a time for something to be so, to a bound, and fails where it never is. */
async function until(what, isSo, ms = 3000) {
  for (const end = Date.now() + ms; !isSo();) {
    if (Date.now() > end) throw new Error(`never so: ${what}`);
    await pause(5);
  }
}
const TYPES = {
  1: { categoryID: 6, groupID: 25 }, // the fitting's hull, a frigate
  99: { categoryID: 6, groupID: 25 }, // the hull a pilot sits in before another is made
  2: { categoryID: 7, groupID: 54 }, // a module
  3: { categoryID: 8, groupID: 83, volume: 0.01 }, // a charge
};
const staticData = { getType: (id) => TYPES[id], getTypeName: (id) => `Type ${id}`, getStation: () => ({ stationName: "Test station" }) };
/** A corporation's saved fitting as the server answers one. */
const fitting = (fittingID, corporationID, name, items) => [fittingID, object({ fittingID, ownerID: corporationID, shipTypeID: 1, name,
  savedDate: { type: "long", value: "100" }, fitData: list(items.map((item) => ({ type: "tuple", items: item }))) })];

async function listening(app, reached = []) {
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  // What has reached the BFF, as it arrives: a request not yet answered is in it.
  server.on("request", (req) => { reached.push(`${req.method} ${req.url}`); });
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

/** The page's own request with a session's token: what it asked, with what, and what it was answered are kept. */
function asking(baseUrl, token) {
  const paths = [];
  const bodies = [];
  const answers = [];
  const cookies = [];
  const options = {
    baseUrl,
    token,
    fetch: async (input, init) => {
      paths.push(`${(init && init.method) || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "")}`);
      bodies.push(init && init.body ? JSON.parse(init.body) : null);
      const response = await realFetch(input, init);
      cookies.push(response.headers.get("set-cookie"));
      answers.push(await response.clone().json().catch(() => null));
      return response;
    },
  };
  return { options, paths, bodies, answers, cookies };
}

test.afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const open of letGo) open();
  letGo.clear();
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    server.closeAllConnections();
    closing.push(new Promise((resolve) => { server.close(() => resolve()); }));
  }
  await Promise.all(closing);
});

// ---------------------------------------------------------------------------------------------------------------
// The cockpit's: POST /api/bridge/provisioning/reconcile
// ---------------------------------------------------------------------------------------------------------------

const COCKPIT = "cockpit-token";
const MATE = "mate-token";

/**
 * A BFF with pilot 10 held by one tab and pilot 11, of the same account, by another. `world.gateway` is the
 * server: what it has, and what it was sent that changes anything (`world.sent`).
 */
async function cockpit(world) {
  const held = { accountID: 7, characterID: 10, corporationID: 20, activeShipID: 50, stationID: 60,
    bridgeSessionID: "held-10", boundHandles: new Map(), streamSubscribers: new Set(), droneRecoveryReady: true };
  const mate = { accountID: 7, characterID: 11, corporationID: 20, activeShipID: 51, stationID: 60,
    bridgeSessionID: "held-11", boundHandles: new Map(), streamSubscribers: new Set(), droneRecoveryReady: true };
  const sessions = new Map([["tab", held], ["tab-2", mate]]);
  const app = createApp({
    eveGatewayClient: world.gateway,
    bridgeSessionStore: sessions,
    errorLogger() {},
    staticData,
    eveStore: {
      async getAccount() { return { accountID: 7, username: "test", banned: false }; },
      async getCharacterForAccount(accountID, characterID) { return { characterID, characterName: `Pilot ${characterID}` }; },
      async listCharactersForAccount() { return [10, 11].map((characterID) => ({ accountID: 7, characterID, corporationID: 20, characterName: `Pilot ${characterID}` })); },
    },
    webAuth: { verifySessionToken: (token) => (token === COCKPIT ? { accountID: 7, username: "test", sessionID: "tab" }
      : token === MATE ? { accountID: 7, username: "test", sessionID: "tab-2" } : null) },
  });
  const baseUrl = await listening(app);
  const api = await import("../web/src/app/api.ts");
  return { app, api, held, mate, sessions, page: asking(baseUrl, COCKPIT), other: asking(baseUrl, MATE) };
}

/**
 * Pilot 10 in a fitted frigate with 3,200 of the 5,000 charges its saved fitting carries, and 4,000 more in its
 * hangar (`world.stock`, one stack; `world.second` is another, where a test has one). The move the BFF asks is
 * 1,800 of them into the hold. `world.add` says what becomes of it, or of each sending in turn.
 */
function suppliesWorld() {
  const world = { stock: 4000, second: 0, aboard: 3200, shipOf: { "held-10": 50, "held-11": 51 }, add: "lands", sent: [] };
  const row = (itemID, typeID, quantity, locationID, flagID, singleton = 0) => ({ type: "packedrow",
    fields: { itemID, typeID, quantity, ownerID: 10, locationID, flagID, singleton } });
  world.gateway = {
    async readFlightStatus(handle) {
      return { flight: { shipID: world.shipOf[handle], shipTypeID: 1, docked: true, stationID: 60, structureID: null }, notifications: [] };
    },
    async callMethod(service, method) {
      assert.deepEqual([service, method], ["corpFittingMgr", "GetFittings"]);
      return { result: { type: "dict", entries: [fitting(4, 20, "Exact", [[2, 27, 1], [3, 5, 5000]])] } };
    },
    async bindObject(service, method, args) { return { boundHandle: args[0], notifications: [] }; },
    async callBoundMethod(service, method, args, kwargs, fields, bridgeSessionID, handle) {
      if (method === "GetCapacity") return { result: object({ capacity: args[0] === 5 ? 10000 : 0, used: 0 }) };
      if (method === "ListByFlags") return { result: list([row(70, 2, -1, 50, 27, 1), row(90, 3, world.aboard, 50, 5)]) };
      if (method === "List") return { result: list(handle === 60
        ? [...(world.stock ? [row(100, 3, world.stock, 60, 4)] : []), ...(world.second ? [row(101, 3, world.second, 60, 4)] : [])]
        : args[0] === 5 ? [row(90, 3, world.aboard, 50, 5)] : []) };
      world.sent.push([method, args, kwargs]);
      assert.equal(method, "Add");
      const how = Array.isArray(world.add) ? world.add.shift() : world.add;
      if (how === "lands") world.land(kwargs.qty, args[0]);
      if (how === "in part") world.land(1000, args[0]);
      if (how !== "lands") throw Object.assign(new Error("the answer was lost"), { code: "TEST_ANSWER_LOST" });
      return { result: null, notifications: [] };
    },
  };
  world.land = (quantity, itemID = 100) => { world[itemID === 100 ? "stock" : "second"] -= quantity; world.aboard += quantity; };
  return world;
}

const SUPPLIES = { providerCharacterID: 11, corporationID: 20, fittingID: 4, source: { kind: "hangar" } };

/** The Provisioning panel's Review and Replenish, by its own askers: what the replenishing was answered. */
async function replenish(api, options) {
  const review = await api.reviewProvisioning(SUPPLIES, options);
  assert.equal(review.canApply, true, JSON.stringify(review));
  return api.replenishProvisioning(review.reviewID, review.reviewHash, options);
}

test("supplies whose move was not proven: the page posts the operation's own id, the BFF looks again and sends nothing, and says the custody settled once the move is there", { timeout: 20000 }, async () => {
  const world = suppliesWorld();
  const { api, page } = await cockpit(world);
  // The move is asked, its answer is lost, and at the look after it nothing has moved: the custody is blocked.
  world.add = "lost";
  const blocked = await replenish(api, page.options);
  assert.deepEqual([blocked.state, blocked.result], ["BLOCKED", null]);
  assert.deepEqual(world.sent, [["Add", [100, 60], { flag: 5, qty: 1800 }]]);
  // The panel lists what is pending from its options, and asks about one by the id it reads there.
  const pending = (await api.provisioningOptions(null, page.options)).pending;
  assert.deepEqual(pending, [{ operationID: blocked.operationID, state: "BLOCKED", kind: "REPLENISHMENT", input: SUPPLIES }]);

  // Looked at while the move is still not there: blocked still.
  page.paths.length = 0;
  page.bodies.length = 0;
  assert.deepEqual(await api.reconcileProvisioning(pending[0].operationID, page.options),
    { ok: true, operationID: blocked.operationID, state: "BLOCKED", result: null });
  assert.deepEqual([page.paths, page.bodies], [["POST /api/bridge/provisioning/reconcile"], [{ operationID: blocked.operationID }]]);
  assert.equal((await api.provisioningOptions(null, page.options)).pending[0].state, "BLOCKED");

  // The server made the move after all. Looked at again, it is proven, and the custody is over.
  world.land(1800);
  assert.deepEqual(await api.reconcileProvisioning(pending[0].operationID, page.options),
    { ok: true, operationID: blocked.operationID, state: "RECONCILED", result: null });
  assert.deepEqual((await api.provisioningOptions(null, page.options)).pending, []);
  // Asked again of what is settled, it is settled still.
  assert.equal((await api.reconcileProvisioning(pending[0].operationID, page.options)).state, "RECONCILED");
  // Nothing was sent by any of the looks: the one move asked is the one there is.
  assert.equal(world.sent.length, 1);
  assert.deepEqual([world.stock, world.aboard], [2200, 5000]);
});

test("supplies whose move was not proven: a look is let through where every other write of the pilot's is held back, and the pilot writes again once it is settled", { timeout: 20000 }, async () => {
  const world = suppliesWorld();
  const { api, page } = await cockpit(world);
  world.add = "lost";
  const blocked = await replenish(api, page.options);
  assert.equal(blocked.state, "BLOCKED");
  // The custody holds the pilot's writes back, the same replenishing among them; a review is a read, and says why.
  await assert.rejects(api.replenishProvisioning(blocked.operationID, "any", page.options), refused(409, "REPLENISHMENT_CUSTODY"));
  // (The page's own stacking since 2026-10-14, the client's StackAll on the hangar's own inventory.)
  await assert.rejects(api.bridgeDo(page.options)("invbroker", "StackAll", [4], null, "hangar"), refused(409, "REPLENISHMENT_CUSTODY"));
  const review = await api.reviewProvisioning(SUPPLIES, page.options);
  assert.deepEqual([review.canApply, review.pending], [false, [{ operationID: blocked.operationID, state: "BLOCKED" }]]);
  assert.equal(world.sent.length, 1);

  world.land(1800);
  assert.equal((await api.reconcileProvisioning(blocked.operationID, page.options)).state, "RECONCILED");
  const after = await api.reviewProvisioning(SUPPLIES, page.options);
  assert.deepEqual([after.canApply, after.pending, after.status.supplies], [true, [], "FULL"]);
  assert.equal((await api.replenishProvisioning(after.reviewID, after.reviewHash, page.options)).state, "COMPLETE");
  assert.equal(world.sent.length, 1);
});

test("supplies whose move landed in part: looked at again it is not proven, and stays blocked", { timeout: 20000 }, async () => {
  const world = suppliesWorld();
  const { api, page } = await cockpit(world);
  world.add = "in part";
  const blocked = await replenish(api, page.options);
  assert.equal(blocked.state, "BLOCKED");
  assert.deepEqual([world.stock, world.aboard], [3000, 4200]);
  assert.equal((await api.reconcileProvisioning(blocked.operationID, page.options)).state, "BLOCKED");
  // The rest of it arriving is what proves it.
  world.land(800);
  assert.equal((await api.reconcileProvisioning(blocked.operationID, page.options)).state, "RECONCILED");
  assert.equal(world.sent.length, 1);
});

test("supplies moved in two sendings, the second not proven: the one that was proven does not settle the custody, and the second arriving does", { timeout: 20000 }, async () => {
  const world = suppliesWorld();
  const { api, page } = await cockpit(world);
  // Two stacks in the hangar, the first too small for what is wanted: it is moved whole, and the rest asked of the second.
  [world.stock, world.second, world.add] = [1000, 3000, ["lands", "lost"]];
  const blocked = await replenish(api, page.options);
  assert.equal(blocked.state, "BLOCKED");
  assert.deepEqual(world.sent, [["Add", [100, 60], { flag: 5, qty: 1000 }], ["Add", [101, 60], { flag: 5, qty: 800 }]]);
  assert.equal((await api.reconcileProvisioning(blocked.operationID, page.options)).state, "BLOCKED");
  world.land(800, 101);
  assert.equal((await api.reconcileProvisioning(blocked.operationID, page.options)).state, "RECONCILED");
  assert.deepEqual([world.stock, world.second, world.aboard, world.sent.length], [0, 2200, 5000, 2]);
});

test("a look at custody is refused by name: an operation that is another pilot's or nobody's, a pilot in another ship, a session changing place, and no pilot at all", { timeout: 20000 }, async () => {
  const world = suppliesWorld();
  const { api, page, other, held, sessions } = await cockpit(world);
  world.add = "lost";
  const blocked = await replenish(api, page.options);
  world.land(1800);
  const stillBlocked = async () => (await api.provisioningOptions(null, page.options)).pending.map((each) => each.state);

  // Another pilot of the same account, held by another tab; and an id the BFF has not.
  await assert.rejects(api.reconcileProvisioning(blocked.operationID, other.options), refused(409, "OPERATION_NOT_OWNED"));
  await assert.rejects(api.reconcileProvisioning("no-such-operation", page.options), refused(409, "OPERATION_NOT_OWNED"));
  // The pilot has boarded another ship since: what its hold has says nothing of the move.
  world.shipOf["held-10"] = 52;
  held.activeShipID = 52;
  await assert.rejects(api.reconcileProvisioning(blocked.operationID, page.options), refused(409, "RECONCILIATION_SCOPE_CHANGED"));
  world.shipOf["held-10"] = 50;
  held.activeShipID = 50;
  // While the session changes place there is no place to look from.
  held.transition = { phase: "requested", kind: "undock" };
  await assert.rejects(api.reconcileProvisioning(blocked.operationID, page.options), refused(409, "PROVISIONING_CONTEXT_UNAVAILABLE"));
  delete held.transition;
  assert.deepEqual(await stillBlocked(), ["BLOCKED"]);

  // Nobody held by the tab that asks.
  sessions.delete("tab");
  await assert.rejects(api.reconcileProvisioning(blocked.operationID, page.options), refused(409, "NO_LIVE_SESSION"));
  sessions.set("tab", held);
  // None of the refusals settled it or sent anything, and it is settled when asked as it should be.
  assert.equal(world.sent.length, 1);
  assert.equal((await api.reconcileProvisioning(blocked.operationID, page.options)).state, "RECONCILED");
});

/**
 * Pilot 10 in a hull that is not the fitting's, with three packaged hulls of the fitting's and two of its module in
 * the hangar. A ship is made in three sendings (assemble, board, fit); `world.assemble` says what becomes of the first.
 */
function hullWorld() {
  const item = (itemID, typeID, quantity, locationID, flagID, singleton = 0) => ({ itemID, typeID, quantity, locationID, flagID, singleton, ownerID: 10 });
  const world = { ship: 50, assemble: "lands", sent: [], fitted: [],
    hangar: [item(50, 99, 1, 60, 4, 1), item(70, 1, 3, 60, 4), item(80, 2, 2, 60, 4)] };
  world.assembleNow = () => { world.hangar[1].quantity -= 1; world.hangar.push(item(71, 1, 1, 60, 4, 1)); };
  world.gateway = {
    async readFlightStatus(handle) {
      const shipID = handle === "held-11" ? 51 : world.ship;
      return { flight: { docked: true, stationID: 60, shipID, shipTypeID: shipID === 50 ? 99 : 1 }, notifications: [] };
    },
    async callMethod(service, method, args) {
      if (method === "AssembleShip") {
        world.sent.push([`${service}.${method}`, args]);
        if (world.assemble !== "lands") throw Object.assign(new Error("the answer was lost"), { code: "TEST_ANSWER_LOST" });
        world.assembleNow();
        return { result: null, notifications: [] };
      }
      assert.deepEqual([service, method], ["corpFittingMgr", "GetFittings"]);
      return { result: { type: "dict", entries: [fitting(4, 20, "Strict new hull", [[2, 27, 1]])] }, notifications: [] };
    },
    async bindObject(service, method, args) {
      return { boundHandle: method === "MachoBindObject" ? (service === "ship" ? "ship" : "manager") : String(args[0]), notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, fields, sessionID, handle) {
      if (method === "List") return { result: list(handle === "60" ? world.hangar : []), notifications: [] };
      if (method === "ListByFlags") return { result: list(handle === "71" ? world.fitted : []), notifications: [] };
      world.sent.push([`${service}.${method}`, args]);
      if (method === "Board") { world.ship = 71; return { result: null, notifications: [] }; }
      assert.equal(method, "FitFitting");
      world.hangar.find((each) => each.itemID === 80).quantity -= 1;
      world.fitted.push(item(81, 2, 1, 71, 27, 1));
      return { result: null, notifications: [] };
    },
  };
  return world;
}

test("a ship being made whose step was not proven: the page's look answers READY once the step is there, with the hull it proved, and the page goes on from it to the finished ship", { timeout: 20000 }, async () => {
  const world = hullWorld();
  const { api, page } = await cockpit(world);
  world.assemble = "lost";
  const review = await api.reviewShipProvisioning(SUPPLIES, null, page.options);
  assert.equal(review.canApply, true, JSON.stringify(review.plan));
  const blocked = await api.provisionShip(review.reviewID, review.reviewHash, page.options);
  assert.deepEqual([blocked.state, blocked.reason, blocked.manifest.targetHullID], ["BLOCKED", "OUTCOME_AMBIGUOUS", null]);
  assert.deepEqual(world.sent, [["ship.AssembleShip", [[70], "", null]]]);
  const row = (await api.provisioningOptions(null, page.options)).pending[0];
  assert.deepEqual(row, { operationID: blocked.operationID, state: "BLOCKED", kind: "SHIP_PROVISION", input: SUPPLIES });

  // Looked at while no hull has been assembled: blocked still, and the panel goes no further (it wants READY).
  page.paths.length = 0;
  page.bodies.length = 0;
  const still = await api.reconcileProvisioning(row.operationID, page.options);
  assert.deepEqual([still.operationID, still.state, still.reason, still.result, still.manifest.targetHullID],
    [blocked.operationID, "BLOCKED", "OUTCOME_AMBIGUOUS", null, null]);
  assert.deepEqual([page.paths, page.bodies], [["POST /api/bridge/provisioning/reconcile"], [{ operationID: blocked.operationID }]]);

  // The server assembled it after all. Looked at again: the new hull is the one proven, and the ship may go on.
  world.assembleNow();
  const ready = await api.reconcileProvisioning(row.operationID, page.options);
  assert.deepEqual([ready.operationID, ready.state, ready.reason, ready.result, ready.manifest.targetHullID, ready.manifest.originalShipID],
    [blocked.operationID, "READY", null, null, 71, 50]);
  // Looked at again while nothing has changed, it is ready still.
  assert.deepEqual(await api.reconcileProvisioning(row.operationID, page.options), ready);
  assert.equal(world.sent.length, 1);

  // As the panel goes on (continueShip): its options for the row's provider, the plan asked again for the same
  // operation, and the plan applied. The hull is boarded and fitted, and nothing is assembled a second time.
  const options = await api.provisioningOptions(row.input.providerCharacterID, page.options);
  assert.equal(options.pending[0].state, "READY");
  const plan = await api.reviewShipProvisioning({ providerCharacterID: row.input.providerCharacterID, corporationID: options.definitionCorporationID,
    fittingID: row.input.fittingID, source: row.input.source }, row.operationID, page.options);
  assert.deepEqual([plan.canApply, plan.plan.mode, plan.plan.targetHullID], [true, "CONTINUE", 71]);
  const done = await api.provisionShip(plan.reviewID, plan.reviewHash, page.options);
  assert.deepEqual([done.operationID, done.state, done.result.equipment, done.manifest.targetHullID], [blocked.operationID, "COMPLETE", "VERIFIED", 71]);
  assert.deepEqual(world.sent.map(([name]) => name), ["ship.AssembleShip", "ship.Board", "invbroker.FitFitting"]);
  assert.deepEqual((await api.provisioningOptions(null, page.options)).pending, []);
});

test("a ship being made: a look at one that is another pilot's is refused, and one the world no longer agrees with is refused and blocked by name", { timeout: 20000 }, async () => {
  const world = hullWorld();
  const { api, page, other } = await cockpit(world);
  world.assemble = "lost";
  const review = await api.reviewShipProvisioning(SUPPLIES, null, page.options);
  const blocked = await api.provisionShip(review.reviewID, review.reviewHash, page.options);
  assert.equal(blocked.state, "BLOCKED");
  await assert.rejects(api.reconcileProvisioning(blocked.operationID, other.options), refused(409, "OPERATION_NOT_OWNED"));
  // The hull was assembled, and a module was put in it by another hand before the look: a new hull is to be empty.
  world.assembleNow();
  world.fitted.push({ itemID: 81, typeID: 2, quantity: 1, locationID: 71, flagID: 27, singleton: 1, ownerID: 10 });
  await assert.rejects(api.reconcileProvisioning(blocked.operationID, page.options), refused(409, "ASSEMBLED_HULL_NOT_EMPTY"));
  assert.deepEqual((await api.provisioningOptions(null, page.options)).pending.map((each) => each.state), ["BLOCKED"]);
  assert.equal(world.sent.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// The Ship Provisioning Center's: its login, its operation and its recover
// ---------------------------------------------------------------------------------------------------------------

const ACCOUNTS = {
  owner: { username: "owner", accountID: 7, role: "0", banned: false },
  other: { username: "other", accountID: 8, role: "0", banned: false },
  barred: { username: "barred", accountID: 9, role: "0", banned: true },
};
const PILOTS = [
  { accountID: 7, characterID: 11, characterName: "Test01", corporationID: 20 },
  { accountID: 7, characterID: 12, characterName: "Test02", corporationID: 30 },
  { accountID: 8, characterID: 21, characterName: "Mate01", corporationID: 40 },
  { accountID: 9, characterID: 31, characterName: "Barred01", corporationID: 50 },
];
const tokenOf = (account) => `token-of-${account.username}`;

/**
 * The server the Center's BFF asks: pilot 11 offline in a ship that is already its saved fitting's, so that an
 * Apply selects it, finds nothing to do and lets it go. `world.stuck` leaves it online after its release, and
 * `world.control` is what the server says of it instead, where a test says the two halves of that apart.
 * `world.releasing`, where a test sets it, is what a release waits on before it is answered.
 */
function centerWorld() {
  const world = { online: false, stuck: false, control: null, releasing: null, selections: 0, releases: [], statusAsked: 0, asked: [], created: [], libraries: [], library: null, libraryFault: null };
  const row = (itemID, typeID, locationID, flagID, singleton) => ({ type: "packedrow", fields: { itemID, typeID, ownerID: 11, locationID, flagID, singleton, quantity: 1 } });
  world.library = (corporationID) => [fitting(4, corporationID, "Exact frigate", [[2, 27, 1]])];
  world.store = {
    async getAccount(username) {
      world.asked.push(["account", username]);
      return ACCOUNTS[username] ? { ...ACCOUNTS[username], passwordHash: "the server's own, and not the page's" } : null;
    },
    async createAccount(username) { world.created.push(username); return { created: true, account: { username, accountID: 99, role: "0", banned: false } }; },
    async listCharactersForAccount(accountID) { return PILOTS.filter((pilot) => pilot.accountID === accountID).map((pilot) => ({ ...pilot })); },
    async getCharacterForAccount(accountID, characterID) { return PILOTS.find((pilot) => pilot.accountID === accountID && pilot.characterID === characterID) || null; },
  };
  world.gateway = {
    async getCharacterStatus(accountID, characterID) {
      world.statusAsked += 1;
      return { characterID, online: world.online, controlState: world.online ? "retail_client" : "offline", ...world.control };
    },
    async selectCharacter(args) { world.selections += 1; world.online = true; return { bridgeSessionID: "center-handle", session: { characterID: args[0], corporationID: 20, stationID: 60, shipID: 50 } }; },
    async releaseBridgeSession(handle) {
      world.releases.push(handle);
      await world.releasing;
      if (!world.stuck) world.online = false;
      return { released: true, characterID: 11 };
    },
    async readFlightStatus() { return { flight: { shipID: 50, shipTypeID: 1, docked: true, stationID: 60 }, notifications: [] }; },
    async callMethod(service, method, args, kwargs, fields, handle) {
      assert.deepEqual([service, method], ["corpFittingMgr", "GetFittings"]);
      world.libraries.push({ args, fields: fields || null, handle: handle || null });
      if (world.libraryFault) throw world.libraryFault;
      return { result: { type: "dict", entries: world.library(handle ? args[0] : fields.corpid) } };
    },
    async bindObject(service, method, args) { return { boundHandle: args[0], notifications: [] }; },
    async callBoundMethod(service, method, args, kwargs, fields, handle, bound) {
      if (method === "ListByFlags") return { result: list([row(90, 2, 50, 27, 1)]) };
      assert.equal(method, "List");
      return { result: list(bound === 60 ? [row(50, 1, 60, 4, 1)] : []) };
    },
  };
  return world;
}

/** The Center's BFF over that server, and the Center's own askers on the tab's own `fetch`. */
async function center(world, { journal = null, holdAt = null } = {}) {
  let reached;
  const arrived = new Promise((resolve) => { reached = resolve; });
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  letGo.add(open);
  const app = createApp({
    eveStore: world.store,
    eveGatewayClient: world.gateway,
    staticData,
    errorLogger() {},
    webAuth: {
      createSessionToken: tokenOf,
      verifySessionToken(token) {
        const account = Object.values(ACCOUNTS).find((each) => tokenOf(each) === token);
        return account ? { username: account.username, accountID: account.accountID, sessionID: `web-${account.username}` } : null;
      },
      countConfiguredUsers() { return 0; },
    },
    ...(journal ? { provisioningCenterJournalPath: journal } : {}),
    provisioningCenterFault: async (state) => { if (state === holdAt) { reached(); await gate; } },
  });
  const requests = [];
  const baseUrl = await listening(app, requests);
  const client = await import("../web/src/provisioning/centerClient.ts");
  const api = await import("../web/src/app/api.ts");
  // The tab's own fetch: a path with no origin, as a browser takes one, is sent to the BFF, and what was sent kept.
  const sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const response = await realFetch(`${baseUrl}${input}`, init);
    sent.push({ path: `${init.method || "GET"} ${input}`, authorization: (init.headers || {}).authorization, credentials: init.credentials,
      body: init.body, cookie: response.headers.get("set-cookie") });
    return response;
  };
  return { app, client, api, baseUrl, sent, requests, arrived, open };
}

const REVIEW = { characterID: 11, providerCharacterID: 11, fittingID: 4, sourceKind: "hangar", corporationID: 20, division: 1 };
/** Waits for an Apply to be held where it was told to be; one that ends first fails the test, and is not waited for. */
const held = (arrived, applying) => Promise.race([arrived,
  applying.then((early) => { throw new Error(`the Apply ended before it was held: ${JSON.stringify(early)}`); })]);
/** What the Center's page keeps of an Apply, as the BFF says it. */
const outcomeOf = (operationID, fields) => ({ operationID, state: null, reason: null, control: null, revalidation: null, provisioning: null,
  release: null, finalReview: null, selectedReview: null, custodyOperationID: null, finalObservedAt: null, ...fields });

test("the Center's sign-in: the page posts the account's name and its password to the Center's own door with no token, and reads the session's token and the account's name; the token is the one the Center's reads take", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { client, sent } = await center(world);
  const value = await client.centerLogin("owner", "whatever it is");
  // What the page keeps: `value.sessionToken` and `value.account.username`.
  assert.deepEqual(value, { ok: true, sessionToken: "token-of-owner", account: ACCOUNTS.owner, accountCreated: false,
    characters: PILOTS.filter((pilot) => pilot.accountID === 7) });
  assert.deepEqual(sent, [{ path: "POST /api/ship-provisioning/login", authorization: undefined, credentials: "omit",
    body: "{\"username\":\"owner\",\"password\":\"whatever it is\"}", cookie: null }]);
  // The password is not looked at, and is not handed to the server's store: the name alone is.
  assert.deepEqual(world.asked, [["account", "owner"]]);
  assert.equal((await client.centerLogin("  owner ", "")).sessionToken, "token-of-owner");
  assert.deepEqual(world.asked[1], ["account", "owner"]);
  // The token the door gave is the one the Center's own reads are asked with.
  const roster = await client.centerRoster(value.sessionToken);
  assert.deepEqual(roster.pilots.map((pilot) => [pilot.characterID, pilot.name, pilot.control.owner]), [[11, "Test01", "OFF"], [12, "Test02", "OFF"]]);
  assert.equal(sent.at(-1).authorization, "Bearer token-of-owner");
  // Nobody was selected by any of it.
  assert.equal(world.selections, 0);
});

test("the Center's sign-in makes no account and sets no cookie: an unknown name is refused by its sentence, as an empty one is, and a banned account by name; the cockpit's own door makes the account and sets the cookie", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { client, api, baseUrl, sent } = await center(world);
  await assert.rejects(client.centerLogin("nobody-yet", "x"), /^Error: Unknown EveJS account\.$/);
  assert.deepEqual([world.created, world.asked], [[], [["account", "nobody-yet"]]]);
  // A name that is nothing is refused before the server is asked for it.
  await assert.rejects(client.centerLogin("   ", "x"), /^Error: Unknown EveJS account\.$/);
  await assert.rejects(client.centerLogin("", ""), /^Error: Unknown EveJS account\.$/);
  assert.equal(world.asked.length, 1);
  await assert.rejects(client.centerLogin("barred", "x"), /^Error: ACCOUNT_BANNED$/);
  assert.deepEqual(sent.map((each) => each.cookie), [null, null, null, null]);

  // The cockpit's door, asked by the cockpit's own asker with the same unknown name: an account is made, and a
  // cookie set, where the Center's door did neither.
  const cockpitsDoor = asking(baseUrl, null);
  const made = await api.login("nobody-yet", "x", cockpitsDoor.options);
  assert.deepEqual(cockpitsDoor.paths, ["POST /api/login"]);
  assert.deepEqual([made.accountCreated, world.created], [true, ["nobody-yet"]]);
  assert.match(cockpitsDoor.cookies[0], /token-of-nobody-yet/);
});

test("an Apply's state while it runs: the page polls by the operation's id with its token, and reads the state the Apply has reached; asked to recover one that is running, the BFF changes nothing; after it, the poll reads what the Apply answered", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { client, sent, arrived, open } = await center(world, { holdAt: "READING" });
  const token = (await client.centerLogin("owner", "")).sessionToken;
  const accepted = (await client.centerReview(token, REVIEW)).applyReview;
  assert.equal(accepted.canApply, true, JSON.stringify(accepted));
  // Before the Apply is asked there is nothing by that id: the page's poll takes that for "not yet".
  await assert.rejects(client.centerOperation(token, accepted.reviewID), /^Error: OPERATION_NOT_OWNED$/);

  const applying = client.centerApply(token, accepted.reviewID, accepted.reviewHash);
  await held(arrived, applying);
  sent.length = 0;
  const running = outcomeOf(accepted.reviewID, { state: "READING", release: { state: "UNVERIFIED" } });
  assert.deepEqual(await client.centerOperation(token, accepted.reviewID), { ok: true, outcome: running });
  assert.deepEqual(sent, [{ path: `GET /api/ship-provisioning/operation?operationID=${accepted.reviewID}`, authorization: "Bearer token-of-owner",
    credentials: "omit", body: undefined, cookie: null }]);
  // The pilot is the Apply's while it runs, and a recover asked meanwhile lets go of nothing.
  assert.deepEqual([world.selections, world.online], [1, true]);
  assert.deepEqual(await client.centerRecover(token, accepted.reviewID), { ok: true, outcome: running });
  assert.deepEqual([world.releases, world.online], [[], true]);

  open();
  const applied = await applying;
  assert.deepEqual([applied.outcome.state, applied.outcome.reason, applied.outcome.release.state, applied.outcome.control.state,
    applied.outcome.revalidation.state, applied.outcome.finalReview.status.equipment],
  ["ALREADY_SATISFIED", null, "VERIFIED_OFFLINE", "MAINTENANCE", "VERIFIED_SELECTED", "VERIFIED"]);
  assert.deepEqual(await client.centerOperation(token, accepted.reviewID), applied);
  // Recover of what is finished answers it as it is, and asks the server nothing.
  const statusAsked = world.statusAsked;
  assert.deepEqual(await client.centerRecover(token, accepted.reviewID), applied);
  assert.deepEqual([world.selections, world.releases, world.online, world.statusAsked], [1, ["center-handle"], false, statusAsked]);
});

test("an Apply that could not see its pilot let go: the page's recover posts the operation's id, the BFF asks for the release again and looks, and frees the pilot once the server has it offline", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { client, sent, requests } = await center(world);
  const token = (await client.centerLogin("owner", "")).sessionToken;
  const accepted = (await client.centerReview(token, REVIEW)).applyReview;
  // The release is answered, and the server has the pilot online still.
  world.stuck = true;
  const applied = (await client.centerApply(token, accepted.reviewID, accepted.reviewHash)).outcome;
  assert.deepEqual([applied.state, applied.reason, applied.release.state, applied.release.exactSessionReleased],
    ["UNCERTAIN", "CONTROL_RELEASE_UNPROVEN", "SESSION_RELEASED_OFFLINE_UNPROVEN", true]);
  // The page lists it under the pilot's review, with the button that recovers it; no new Apply is offered.
  const review = await client.centerReview(token, REVIEW);
  assert.deepEqual(review.pendingApply, [{ operationID: accepted.reviewID, state: "UNCERTAIN", reason: "CONTROL_RELEASE_UNPROVEN", active: false }]);
  assert.equal(review.applyReview.canApply, false);
  assert.equal((await client.centerRoster(token)).pilots[0].control.owner, "RECOVERY_OR_OPERATION");

  // Recovered while the server has it online still: the release is asked for again, by the same handle, and it
  // is uncertain still.
  sent.length = 0;
  const again = (await client.centerRecover(token, accepted.reviewID)).outcome;
  assert.deepEqual(sent, [{ path: "POST /api/ship-provisioning/recover", authorization: "Bearer token-of-owner", credentials: "omit",
    body: JSON.stringify({ operationID: accepted.reviewID }), cookie: null }]);
  assert.deepEqual([again.operationID, again.state, again.release.state], [accepted.reviewID, "UNCERTAIN", "SESSION_RELEASED_OFFLINE_UNPROVEN"]);
  assert.deepEqual(world.releases, ["center-handle", "center-handle"]);
  assert.equal((await client.centerOperation(token, accepted.reviewID)).outcome.state, "UNCERTAIN");

  // Offline is both of two things the server says: not online, and let go of. Either alone is uncertain still.
  world.control = { online: false, controlState: "retail_client" };
  assert.equal((await client.centerRecover(token, accepted.reviewID)).outcome.state, "UNCERTAIN");
  world.control = { online: true, controlState: "offline" };
  assert.equal((await client.centerRecover(token, accepted.reviewID)).outcome.state, "UNCERTAIN");
  // And what is said of another character says nothing of this one.
  world.control = { characterID: 12, online: false, controlState: "offline" };
  assert.equal((await client.centerRecover(token, accepted.reviewID)).outcome.state, "UNCERTAIN");
  world.control = null;
  assert.equal(world.releases.length, 5);

  // The server lets go. Recovered again: seen offline, the Apply ends as what it had come to, and the pilot is free.
  // Asked a second time while the first is still at the server (as two tabs might), it is recovered once: the
  // second asking waits for the first, asks for no release of its own, and is answered the same.
  world.online = false;
  let answerRelease;
  world.releasing = new Promise((resolve) => { answerRelease = resolve; });
  letGo.add(answerRelease);
  const recovers = () => requests.filter((each) => each === "POST /api/ship-provisioning/recover").length;
  const before = recovers();
  const first = client.centerRecover(token, accepted.reviewID);
  await until("the first recover's release is asked of the server", () => world.releases.length === 6);
  let secondAnswered = false;
  const second = client.centerRecover(token, accepted.reviewID);
  second.then(() => { secondAnswered = true; }, () => { secondAnswered = true; });
  await until("the second recover reaches the BFF", () => recovers() === before + 2);
  await pause(150);
  assert.equal(secondAnswered, false, "the second recover was answered while the first was still releasing");
  answerRelease();
  const [freed, same] = (await Promise.all([first, second])).map((each) => each.outcome);
  assert.deepEqual(same, freed);
  assert.equal(world.releases.length, 6);
  assert.deepEqual([freed.state, freed.release.state, freed.release.evidence], ["ALREADY_SATISFIED", "VERIFIED_OFFLINE", "AUTHORITATIVE_CHARACTER_STATUS"]);
  assert.deepEqual(await client.centerOperation(token, accepted.reviewID), { ok: true, outcome: freed });
  const after = await client.centerReview(token, REVIEW);
  assert.deepEqual([after.pendingApply, after.applyReview.canApply], [[], true]);
  assert.equal((await client.centerRoster(token)).pilots[0].control.owner, "OFF");
  // One selection in all: recovering never takes the pilot again.
  assert.equal(world.selections, 1);
});

test("an Apply cut off by the BFF's ending: the BFF that starts on its journal holds the pilot, answers the Apply's state as it was kept, and the page's recover ends it once the server has the pilot offline, taking the pilot never", { timeout: 20000 }, async () => {
  const journal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-provisioning-center-")), "control.json");
  const world = centerWorld();
  const first = await center(world, { journal, holdAt: "READING" });
  const token = (await first.client.centerLogin("owner", "")).sessionToken;
  const accepted = (await first.client.centerReview(token, REVIEW)).applyReview;
  const cutOff = first.client.centerApply(token, accepted.reviewID, accepted.reviewHash);
  cutOff.catch(() => {});
  await held(first.arrived, cutOff);
  // The first BFF is asked nothing more: its Apply stays where it was, the pilot selected. Another starts on the
  // same journal, over the same server.
  const { client, sent } = await center(world, { journal });
  const kept = outcomeOf(accepted.reviewID, { state: "READING", release: { state: "UNVERIFIED" } });
  assert.deepEqual(await client.centerOperation(token, accepted.reviewID), { ok: true, outcome: kept });
  assert.equal((await client.centerRoster(token)).pilots[0].control.owner, "RECOVERY_OR_OPERATION");
  assert.deepEqual((await client.centerReview(token, REVIEW)).pendingApply,
    [{ operationID: accepted.reviewID, state: "READING", reason: null, active: false }]);

  // The server has the pilot online: recovered, the Apply is blocked, by name, and the pilot is held still.
  sent.length = 0;
  const blocked = (await client.centerRecover(token, accepted.reviewID)).outcome;
  assert.deepEqual(blocked, outcomeOf(accepted.reviewID, { state: "BLOCKED", reason: "CONTROL_RELEASE_UNPROVEN", release: { state: "UNVERIFIED" } }));
  assert.equal(sent[0].path, "POST /api/ship-provisioning/recover");
  assert.deepEqual(await client.centerOperation(token, accepted.reviewID), { ok: true, outcome: blocked });
  assert.equal((await client.centerRoster(token)).pilots[0].control.owner, "RECOVERY_OR_OPERATION");
  // Not online and not let go of, or let go of and online: blocked still.
  world.control = { online: false, controlState: "retail_client" };
  assert.equal((await client.centerRecover(token, accepted.reviewID)).outcome.state, "BLOCKED");
  world.control = { online: true, controlState: "offline" };
  assert.equal((await client.centerRecover(token, accepted.reviewID)).outcome.state, "BLOCKED");
  world.control = { characterID: 12, online: false, controlState: "offline" };
  assert.equal((await client.centerRecover(token, accepted.reviewID)).outcome.state, "BLOCKED");
  world.control = null;

  // The server has it offline: recovered, the Apply is ended as refused, and the pilot is free for another.
  world.online = false;
  const ended = (await client.centerRecover(token, accepted.reviewID)).outcome;
  assert.deepEqual([ended.state, ended.release.state, ended.release.evidence], ["REFUSED", "VERIFIED_OFFLINE", "AUTHORITATIVE_CHARACTER_STATUS"]);
  assert.equal((await client.centerRoster(token)).pilots[0].control.owner, "OFF");
  assert.equal((await client.centerReview(token, REVIEW)).applyReview.canApply, true);
  // The second BFF never took the pilot and never asked for a release: it has no handle to ask with.
  assert.deepEqual([world.selections, world.releases], [1, []]);
});

test("an Apply cut off and found offline at the first look: it ends refused, and says it was interrupted", { timeout: 20000 }, async () => {
  const journal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-provisioning-center-")), "control.json");
  const world = centerWorld();
  const first = await center(world, { journal, holdAt: "READING" });
  const token = (await first.client.centerLogin("owner", "")).sessionToken;
  const accepted = (await first.client.centerReview(token, REVIEW)).applyReview;
  const cutOff = first.client.centerApply(token, accepted.reviewID, accepted.reviewHash);
  cutOff.catch(() => {});
  await held(first.arrived, cutOff);
  world.online = false;
  const { client } = await center(world, { journal });
  const ended = (await client.centerRecover(token, accepted.reviewID)).outcome;
  assert.deepEqual([ended.state, ended.reason, ended.release.state], ["REFUSED", "INTERRUPTED_REVIEW_REQUIRED", "VERIFIED_OFFLINE"]);
  assert.deepEqual(await client.centerOperation(token, accepted.reviewID), { ok: true, outcome: ended });
});

test("the Center's operation and recover are the account's own: another account's token, an id the BFF has not, and no token are each refused by name, and nothing is changed", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { client } = await center(world);
  const token = (await client.centerLogin("owner", "")).sessionToken;
  const others = (await client.centerLogin("other", "")).sessionToken;
  const accepted = (await client.centerReview(token, REVIEW)).applyReview;
  world.stuck = true;
  await client.centerApply(token, accepted.reviewID, accepted.reviewHash);
  world.online = false;

  await assert.rejects(client.centerOperation(others, accepted.reviewID), /^Error: OPERATION_NOT_OWNED$/);
  await assert.rejects(client.centerRecover(others, accepted.reviewID), /^Error: OPERATION_NOT_OWNED$/);
  await assert.rejects(client.centerOperation(token, "no-such-operation"), /^Error: OPERATION_NOT_OWNED$/);
  await assert.rejects(client.centerRecover(token, "no-such-operation"), /^Error: OPERATION_NOT_OWNED$/);
  await assert.rejects(client.centerOperation("", accepted.reviewID), /^Error: AUTH_REQUIRED$/);
  await assert.rejects(client.centerRecover("not-a-token", accepted.reviewID), /^Error: AUTH_REQUIRED$/);
  // None of them recovered it: it is uncertain still, though the server has had the pilot offline all the while.
  assert.equal((await client.centerOperation(token, accepted.reviewID)).outcome.state, "UNCERTAIN");
  assert.equal(world.releases.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// The Mining window's: GET /api/mining-operations/preparation-options
// ---------------------------------------------------------------------------------------------------------------

const UNSEEN = { kind: "hangar", quality: "UNAVAILABLE", query: "UNKNOWN", take: "UNKNOWN", rows: [], revalidateOnApply: true };

test("the fittings a member's preparation may name: the page asks by the member's account name and pilot, and reads the corporation's saved fittings as contracts, with nobody selected", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { app, api, baseUrl } = await center(world);
  const page = asking(baseUrl, tokenOf(ACCOUNTS.owner));
  const read = await api.getMiningPreparationOptions("owner", 11, null, page.options);
  assert.deepEqual(page.paths, ["GET /api/mining-operations/preparation-options?accountName=owner&characterID=11"]);
  // What the window draws: the library's status, and each contract's name and fitting.
  assert.deepEqual([read.definitions.status, read.definitions.corporationID, read.definitions.providerCharacterID, read.definitions.invalid], ["READY", 20, 11, []]);
  assert.deepEqual(read.definitions.contracts.map((contract) => [contract.name, contract.shipTypeID, contract.definition.fittingID,
    contract.definition.scope, contract.definition.accountID, contract.definition.characterID, contract.definition.corporationID]),
  [["Exact frigate", 1, 4, "CORPORATION", 7, 11, 20]]);
  // What it says of the pilot and of the source: nothing is seen of either until a run prepares.
  assert.deepEqual([read.pilot, read.candidateSource], [{ characterID: 11, control: { state: "UNKNOWN" }, quality: "UNAVAILABLE" }, UNSEEN]);
  // The library was asked on a session of the gateway's own making, for the pilot named, and nobody was selected.
  assert.deepEqual(world.libraries, [{ args: [], fields: { userid: 7, characterID: 11, corpid: 20, corporationID: 20 }, handle: null }]);
  assert.deepEqual([world.selections, app.locals.bridgeSessions.size], [0, 0]);

  // Another pilot of the account as the one whose corporation's fittings are read: the page says which.
  page.paths.length = 0;
  world.libraries.length = 0;
  const provided = await api.getMiningPreparationOptions("owner", 11, 12, page.options);
  assert.deepEqual(page.paths, ["GET /api/mining-operations/preparation-options?accountName=owner&characterID=11&providerCharacterID=12"]);
  assert.deepEqual([provided.definitions.status, provided.definitions.corporationID, provided.definitions.providerCharacterID, provided.pilot.characterID], ["READY", 30, 12, 11]);
  assert.deepEqual(provided.definitions.contracts.map((contract) => [contract.definition.characterID, contract.definition.corporationID]), [[12, 30]]);
  assert.deepEqual(world.libraries.map((each) => each.fields.characterID), [12]);
});

test("the fittings a member's preparation may name: the account is the one the member is named by, whoever is signed in; a fitting that is no contract is said apart, and a library that cannot be read is said so", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { api, baseUrl } = await center(world);
  // A member of another account than the one signed in, as an operation's members are.
  const mate = asking(baseUrl, tokenOf(ACCOUNTS.other));
  const read = await api.getMiningPreparationOptions("owner", 11, null, mate.options);
  assert.deepEqual([read.definitions.status, read.definitions.contracts.length, world.libraries[0].fields.userid], ["READY", 1, 7]);

  const page = asking(baseUrl, tokenOf(ACCOUNTS.owner));
  // One saved fitting with nothing in it beside one that is whole: the first is no contract, and is said so.
  world.library = (corporationID) => [fitting(4, corporationID, "Exact frigate", [[2, 27, 1]]), fitting(5, corporationID, "Nothing in it", [])];
  const mixed = await api.getMiningPreparationOptions("owner", 11, null, page.options);
  assert.deepEqual([mixed.definitions.status, mixed.definitions.contracts.map((contract) => contract.definition.fittingID), mixed.definitions.invalid],
    ["READY", [4], [{ fittingID: 5, reason: "INVALID_FIT" }]]);
  // The server does not answer for the library: the window is told it is unavailable, and lists nothing.
  world.libraryFault = Object.assign(new Error("no corporation fittings"), { code: "TEST_FAULT" });
  const unread = await api.getMiningPreparationOptions("owner", 11, null, page.options);
  assert.deepEqual(unread.definitions, { status: "CORP_UNAVAILABLE", corporationID: 20, providerCharacterID: 11, contracts: [], invalid: [] });
  world.libraryFault = null;
  // A provider that is not the member's account's: not owned, and the server is not asked for its library.
  world.libraries.length = 0;
  const foreign = await api.getMiningPreparationOptions("owner", 11, 21, page.options);
  assert.deepEqual(foreign.definitions, { status: "NOT_OWNED", corporationID: null, providerCharacterID: 21, contracts: [], invalid: [] });
  assert.deepEqual(world.libraries, []);
});

test("the fittings a member's preparation may name: a pilot that is not the named account's, an account the server has not, a banned one and no token are each refused, and the server is not asked for a library", { timeout: 20000 }, async () => {
  const world = centerWorld();
  const { api, baseUrl } = await center(world);
  const page = asking(baseUrl, tokenOf(ACCOUNTS.owner));
  await assert.rejects(api.getMiningPreparationOptions("owner", 21, null, page.options), refused(409, "CHARACTER_NOT_FOUND"));
  await assert.rejects(api.getMiningPreparationOptions("nobody-yet", 11, null, page.options), refused(409, "CHARACTER_NOT_FOUND"));
  await assert.rejects(api.getMiningPreparationOptions("barred", 31, null, page.options), refused(409, "CHARACTER_NOT_FOUND"));
  await assert.rejects(api.getMiningPreparationOptions("", 11, null, page.options), refused(409, "CHARACTER_NOT_FOUND"));
  assert.equal(page.answers[0].message, "Account-owned pilot unavailable.");
  await assert.rejects(api.getMiningPreparationOptions("owner", 11, null, asking(baseUrl, null).options), refused(401, "AUTH_REQUIRED"));
  assert.deepEqual([world.libraries, world.created], [[], []]);
});
