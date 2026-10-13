"use strict";

// A pilot whose ship the server changed by itself, asked after BY THE PAGE'S OWN ASKERS (web/src/app/api.ts) of the
// BFF's own routes:
//
//   GET /api/bridge/flight/status      getFlightStatus
//   GET /api/bridge/fitting            loadFitting
//
// The retail client goes by session.shipid for the ship it is in (eveCfg.GetActiveShip, 1510). When a ship is
// destroyed the server puts the pilot in a capsule and says so by a session change; godma primes itself again and
// the inventory cache lets the old ship go (godma.py 1156 and 1202, invCache.py 156). The BFF keeps the ship of a
// held session for itself, to bind the ship's inventory by and to know godma's ship for its own. Until 2026-10-12
// only a boarding the BFF had asked for ever changed it: after a ship's loss the BFF went on binding a ship that
// was no more (the server's FakeItemNotFound, each time) and, godma's ship no longer being "its" ship, asked the
// server dogmaIM.ShipGetInfo and ShipOnlineModules, which the client never asks (godma.py 2409, 697). A hosted run
// of that day has them 80 and 40 times after a miner's Venture was destroyed.
//
// The read that adopts the new ship is the flight status's own, which the page and every bot make continuously to
// learn where the pilot is. A route that reads the flight for a guard of its own does not: it was asked about the
// ship the page knew, and must go on seeing that ship is no longer the pilot's.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const ACCOUNT = { username: "miner-account", accountID: 4001, role: "0", banned: false };
const PILOT = { characterID: 7001, accountID: 4001, characterName: "Miner One" };
const VENTURE = 507001;
const CAPSULE = 507777;
const JITA = 30000142;
const TOKEN = "token-tab";
const activeServers = new Set();

const list = (items) => ({ type: "list", items });
/** A ship's row as godma holds one: what ShipGetInfo would answer of it. */
const rowOf = (shipID) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["itemID", shipID], ["attributes", { type: "dict", entries: [[48, 150]] }]] } });

/**
 * The BFF over a server, with one pilot held in space: the held session's own ship is `heldShip`, and the server
 * says the pilot is in `flies`. `gamePort: false` holds the pilot on the gateway, which keeps no godma.
 * `asked` is everything asked of the transport, in order.
 */
async function pilot({ gamePort = true, heldShip = VENTURE, flies = CAPSULE, bound = [] } = {}) {
  const asked = [];
  const world = { flies };
  const transport = {
    async readFlightStatus() {
      // What a test changes while the read is out.
      if (world.amid) await world.amid();
      return { flight: { inSpace: true, docked: false, shipID: world.flies, shipTypeID: world.flies === CAPSULE ? 670 : 32880, solarSystemID: JITA, stationID: null }, notifications: [] };
    },
    async bindObject(service, method, args) {
      asked.push({ bind: `${service}.${method}`, args });
      return { boundHandle: `inv-${args[0]}`, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, fields, bridgeSessionID, handle) {
      asked.push({ bound: `${method}`, of: handle });
      return { result: list([]), notifications: [] };
    },
    async callMethod(service, method) {
      asked.push({ call: `${service}.${method}` });
      // The server's own answers, of the ship the session is in.
      return { result: method === "ShipGetInfo" ? { type: "dict", entries: [[world.flies, rowOf(world.flies)]] } : list([]), notifications: [] };
    },
  };
  if (gamePort) {
    transport.shipInfo = async () => {
      asked.push({ godma: "shipInfo" });
      return { shipID: world.flies, row: rowOf(world.flies), online: [] };
    };
  }
  const held = new Map();
  const bridgeSessionID = `${gamePort ? "gp:" : ""}held-${PILOT.characterID}`;
  const row = { characterID: PILOT.characterID, accountID: ACCOUNT.accountID, bridgeSessionID, solarSystemID: JITA, activeShipID: heldShip, transitionEpoch: 0,
    boundHandles: new Map(bound.map((key) => [key, Promise.resolve(`stale-${key}`)])), streamSubscribers: new Set(), transition: null, droneRecoveryReady: true };
  held.set("session-tab", row);
  const errors = [];
  const app = createApp({
    eveStore: {
      getAccount: async (username) => (username === ACCOUNT.username ? { ...ACCOUNT } : null),
      getCharacterForAccount: async () => ({ ...PILOT }),
      listCharactersForAccount: async () => [{ ...PILOT }],
    },
    eveGatewayClient: transport,
    ...(gamePort ? { gamePortPilots: transport, pilotTransportFor: () => "gameport" } : {}),
    webAuth: {
      createSessionToken() { return TOKEN; },
      verifySessionToken(token) { return token === TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: "session-tab" } : null; },
      countConfiguredUsers() { return 1; },
    },
    bridgeSessionStore: held,
    staticData: {},
    errorLogger(error) { errors.push(error); },
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const api = await import("../web/src/app/api.ts");
  const options = { baseUrl: `http://127.0.0.1:${server.address().port}`, token: TOKEN };
  const binds = () => asked.filter((each) => each.bind).map((each) => [each.bind, each.args[0]]);
  const dogma = () => asked.filter((each) => each.call && each.call.startsWith("dogmaIM.")).map((each) => each.call).sort();
  return { api, options, asked, binds, dogma, row, world, errors };
}

test.afterEach(async () => {
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    server.closeAllConnections();
    closing.push(new Promise((resolve) => { server.close(() => resolve()); }));
  }
  await Promise.all(closing);
});

test("a pilot whose ship was destroyed: once the flight status has been read, the Fitting panel reads the capsule, godma's, and neither binds the lost ship nor asks dogma", async () => {
  const { api, options, asked, binds, dogma, row, errors } = await pilot({ bound: [`cargo:${VENTURE}`] });
  await api.getFlightStatus(options);
  const fitting = await api.loadFitting(options);
  assert.equal(fitting.activeShipID, CAPSULE);
  assert.deepEqual(fitting.shipInfo, { type: "dict", entries: [[CAPSULE, rowOf(CAPSULE)]] });
  assert.deepEqual(fitting.errors, { slots: null, shipInfo: null, online: null });
  // The ship's inventory is bound for the capsule, and for no other; godma is asked, and dogma is not.
  assert.deepEqual(binds(), [["invbroker.GetInventoryFromId", CAPSULE]]);
  assert.deepEqual(dogma(), []);
  assert.equal(asked.filter((each) => each.godma).length, 1);
  // The held session has the capsule for its ship, under a new epoch, and what was bound for the lost ship is gone.
  assert.deepEqual([row.activeShipID, row.transitionEpoch, row.boundHandles.has(`cargo:${VENTURE}`)], [CAPSULE, 1, false]);
  assert.deepEqual(errors, []);
});

test("the flight status itself says the ship and the new epoch, and a second read adopts nothing more", async () => {
  const { api, options, row } = await pilot();
  const first = (await api.getFlightStatus(options)).flight;
  assert.deepEqual([first.shipID, first.transition.epoch, first.transition.kind, first.transition.sessionStable], [CAPSULE, 1, "idle", true]);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [CAPSULE, 1]);
  const second = (await api.getFlightStatus(options)).flight;
  assert.deepEqual([second.shipID, second.transition.epoch], [CAPSULE, 1]);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [CAPSULE, 1]);
});

test("a read that is not the flight status's own adopts nothing: it goes on by the ship the session was held with", async () => {
  // The Fitting panel asked before any read of the flight status: its own look at the flight is for itself.
  const { api, options, binds, dogma, row } = await pilot({ bound: [`cargo:${VENTURE}`] });
  const fitting = await api.loadFitting(options);
  assert.equal(fitting.activeShipID, VENTURE);
  assert.deepEqual([row.activeShipID, row.transitionEpoch, row.boundHandles.has(`cargo:${VENTURE}`)], [VENTURE, 0, true]);
  // Godma's ship is the session's, which is the ship the server would answer of: it answers, and dogma is not asked.
  assert.deepEqual(dogma(), []);
  assert.deepEqual(fitting.shipInfo, { type: "dict", entries: [[CAPSULE, rowOf(CAPSULE)]] });
  // What was bound for the held ship is used as it stands: nothing is bound anew.
  assert.deepEqual(binds(), []);
});

test("a pilot in the ship the session was held with: nothing is adopted, and what was bound stays", async () => {
  const { api, options, binds, dogma, row } = await pilot({ flies: VENTURE, bound: ["park:30000142"] });
  await api.getFlightStatus(options);
  const fitting = await api.loadFitting(options);
  assert.equal(fitting.activeShipID, VENTURE);
  assert.deepEqual(binds(), [["invbroker.GetInventoryFromId", VENTURE]]);
  assert.deepEqual(dogma(), []);
  assert.deepEqual([row.activeShipID, row.transitionEpoch, row.boundHandles.has("park:30000142")], [VENTURE, 0, true]);
});

test("on the gateway the capsule is adopted the same, and the ship's dogma is asked of the server as it was there", async () => {
  const { api, options, binds, dogma, row } = await pilot({ gamePort: false });
  await api.getFlightStatus(options);
  const fitting = await api.loadFitting(options);
  assert.equal(fitting.activeShipID, CAPSULE);
  assert.deepEqual(binds(), [["invbroker.GetInventoryFromId", CAPSULE]]);
  assert.deepEqual(dogma(), ["dogmaIM.ShipGetInfo", "dogmaIM.ShipOnlineModules"]);
  assert.deepEqual(fitting.shipInfo, { type: "dict", entries: [[CAPSULE, rowOf(CAPSULE)]] });
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [CAPSULE, 1]);
});

test("while a transition of the BFF's own is afoot, a read adopts nothing: the boarding's own postcondition does", async () => {
  const { api, options, row } = await pilot();
  // A boarding asked for a moment ago, not yet seen to have landed.
  row.transitionEpoch = 1;
  row.cooldownUntilMs = Date.now() + 10_000;
  row.transition = { epoch: 1, kind: "board", phase: "accepted", startedAtMs: Date.now(), shipID: 599, fromShipID: VENTURE };
  const flight = (await api.getFlightStatus(options)).flight;
  assert.deepEqual([flight.shipID, flight.transition.kind, flight.transition.phase], [CAPSULE, "board", "accepted"]);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [VENTURE, 1]);
});

test("a read that was out while a boarding landed says nothing of the ship after it: the boarded ship stays", async () => {
  // The server still says the Venture to a read asked before the boarding; by the time it answers the BFF has
  // boarded another hull, under a new epoch, with its cooldown long past.
  const BOARDED = 507599;
  const { api, options, row, world } = await pilot({ flies: VENTURE });
  world.amid = async () => {
    world.amid = null;
    row.transitionEpoch = 1;
    row.transition = { epoch: 1, kind: "board", phase: "ready", startedAtMs: Date.now() - 60_000, shipID: BOARDED, fromShipID: VENTURE };
    row.cooldownUntilMs = Date.now() - 50_000;
    row.activeShipID = BOARDED;
  };
  const flight = (await api.getFlightStatus(options)).flight;
  assert.equal(flight.shipID, VENTURE);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [BOARDED, 1]);
  // The next read is asked under the new epoch, and is believed.
  world.flies = BOARDED;
  await api.getFlightStatus(options);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [BOARDED, 1]);
});

test("inside the ten seconds a transition of the BFF's own keeps, a read adopts nothing; once they are past, it does", async () => {
  const { api, options, row } = await pilot();
  // An undock that became ready a moment ago: nothing afoot, and its cooldown still running.
  row.transitionEpoch = 1;
  row.transition = { epoch: 1, kind: "undock", phase: "ready", startedAtMs: Date.now() - 2_000, shipID: VENTURE };
  row.cooldownUntilMs = Date.now() + 8_000;
  await api.getFlightStatus(options);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [VENTURE, 1]);
  // The same session a minute on: the cooldown is long past, by the route's own clock.
  row.cooldownUntilMs = Date.now() - 50_000;
  await api.getFlightStatus(options);
  assert.deepEqual([row.activeShipID, row.transitionEpoch], [CAPSULE, 2]);
});
