"use strict";

// The survey scan, asked by the page's own asker (web/src/app/api.ts, runSurveyScan) of the BFF's own route:
//
//   GET /api/bridge/mining/scan      miningScanMgr.perform_scan()
//
// WHEN THE RETAIL CLIENT ASKS AT ALL is what is held here. Its command (eveCommands.py 1052, CmdMiningScan) goes
// no further than "in space"; its overlay (mining/client/mining_overlay_controller.py 88) refuses in warp and
// while the last scan's wave is still playing; and its scanning service
// (mining/client/asteroid_scanning_service.py 103) reads the ship's miningScannerUpgrade from godma
// (mining_util.py 26: int() of attribute 5979, and None where godma has none) and then
//
//   if not tier: return                       nothing asked, nothing done
//   if tier > MiningScan.TIER_1 (0): ...      sm.RemoteSvc('miningScanMgr').perform_scan(), ten times a minute at most
//   else: a scan of the client's own          nothing asked
//
// So the server is asked only from a ship whose upgrade is one or more: a fitted Mining Survey Chipset, online,
// adds one (effect 12591, miningSensorArrayScannerUpgrade). On the game port the BFF has godma's value and asks
// as the client would; on the gateway it has not, and asks as it did.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const ACCOUNT = { username: "miner-account", accountID: 4001, role: "0", banned: false };
const PILOT = { characterID: 7001, accountID: 4001, characterName: "Miner One" };
const SHIP = 507001;
const JITA = 30000142;
const TOKEN = "token-tab";
const MINING_SCANNER_UPGRADE = 5979;
const RESULTS = [[50001248, 1230, 4200], [50001249, 1228, 0]];
const activeServers = new Set();

/**
 * The BFF over a server that answers a scan, with one pilot held in space in its ship, and the page's own asker.
 * `godma` is what the game port's godma has of the ship (attribute -> value); `gamePort: false` holds the pilot
 * on the gateway, which keeps no godma, and `beside` gives that BFF a game port all the same, for its other
 * pilots. `asked` is everything asked of the transport, in order.
 */
async function miner({ gamePort = true, godma = {}, docked = false, keepsGodma = true, beside = false } = {}) {
  const asked = [];
  const transport = {
    async readFlightStatus() {
      asked.push("flight");
      return { flight: { inSpace: !docked, docked, shipID: SHIP, solarSystemID: JITA, stationID: docked ? 60003760 : null }, notifications: [] };
    },
    async callMethod(service, method, args, kwargs, fields, bridgeSessionID) {
      asked.push({ call: `${service}.${method}`, args, kwargs, of: bridgeSessionID });
      return { result: RESULTS, notifications: [{ type: "notification", name: "OnTest" }] };
    },
  };
  if ((gamePort || beside) && keepsGodma) {
    transport.shipAttribute = async (attributeID, sessionFields, bridgeSessionID) => {
      asked.push({ godma: attributeID, sessionFields, of: bridgeSessionID });
      const value = godma[attributeID];
      if (value instanceof Error) throw value;
      return value === undefined ? null : value;
    };
  }
  const held = new Map();
  const bridgeSessionID = `${gamePort ? "gp:" : ""}held-${PILOT.characterID}`;
  held.set("session-tab", { characterID: PILOT.characterID, accountID: ACCOUNT.accountID, bridgeSessionID, solarSystemID: JITA, activeShipID: SHIP,
    boundHandles: new Map(), streamSubscribers: new Set(), transition: null, droneRecoveryReady: true });
  const errors = [];
  const app = createApp({
    eveStore: {
      getAccount: async (username) => (username === ACCOUNT.username ? { ...ACCOUNT } : null),
      getCharacterForAccount: async () => ({ ...PILOT }),
      listCharactersForAccount: async () => [{ ...PILOT }],
    },
    eveGatewayClient: transport,
    ...(gamePort || beside ? { gamePortPilots: transport, pilotTransportFor: () => (gamePort ? "gameport" : "gateway") } : {}),
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
  const answers = [];
  const options = {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    token: TOKEN,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      answers.push([`${(init && init.method) || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "")}`, response.status, await response.clone().json().catch(() => null)]);
      return response;
    },
  };
  const scans = () => asked.filter((each) => each.call === "miningScanMgr.perform_scan");
  return { api, options, asked, answers, scans, bridgeSessionID, errors };
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

test("on the game port a ship with a mining scanner upgrade is scanned for: godma is read, the server asked with nothing, and the page told it was asked", async () => {
  const { api, options, asked, answers, bridgeSessionID } = await miner({ godma: { [MINING_SCANNER_UPGRADE]: 1 } });
  const answer = await api.runSurveyScan(options);
  assert.deepEqual(answer, { asked: true, scannerUpgrade: 1, results: RESULTS, notifications: [{ type: "notification", name: "OnTest" }] });
  // In space first, as the client's command looks first; then godma, by the attribute's own number and for this pilot's session; then the one call.
  assert.deepEqual(asked, [
    "flight",
    { godma: 5979, sessionFields: { userid: ACCOUNT.accountID }, of: bridgeSessionID },
    { call: "miningScanMgr.perform_scan", args: [], kwargs: null, of: bridgeSessionID },
  ]);
  assert.deepEqual(answers.map(([path, status]) => [path, status]), [["GET /api/bridge/mining/scan", 200]]);
  assert.deepEqual(answers[0][2], { ok: true, asked: true, scannerUpgrade: 1, results: RESULTS, notifications: [{ type: "notification", name: "OnTest" }] });
});

test("on the game port a ship with no upgrade is not scanned for: the server is asked nothing, and the page is told so with what godma had", async () => {
  // Nought, as a hull with no chipset fitted has it; nothing held of the attribute, which is the client's None;
  // a fraction below one, which int() makes nought; and below nought, where the client makes a scan of its own.
  for (const [value, said] of [[0, 0], [undefined, null], [null, null], [0.9, 0], [-1, -1], [Number.NaN, null], ["1", null]]) {
    const { api, options, asked, answers, scans, bridgeSessionID } = await miner({ godma: { [MINING_SCANNER_UPGRADE]: value } });
    const answer = await api.runSurveyScan(options);
    assert.deepEqual(answer, { asked: false, scannerUpgrade: said, results: null, notifications: [] }, String(value));
    assert.deepEqual(scans(), [], String(value));
    assert.deepEqual(asked, ["flight", { godma: 5979, sessionFields: { userid: ACCOUNT.accountID }, of: bridgeSessionID }], String(value));
    assert.deepEqual(answers[0].slice(1), [200, { ok: true, asked: false, scannerUpgrade: said, results: null, notifications: [] }], String(value));
  }
});

test("the upgrade is taken as the client takes it, int() of godma's value: one and a half is one, and a third tier asks as the second does", async () => {
  for (const [value, said] of [[1.5, 1], [2, 2], [1.0000001, 1], [3, 3]]) {
    const { api, options, scans } = await miner({ godma: { [MINING_SCANNER_UPGRADE]: value } });
    const answer = await api.runSurveyScan(options);
    assert.deepEqual([answer.asked, answer.scannerUpgrade, answer.results], [true, said, RESULTS], String(value));
    assert.equal(scans().length, 1, String(value));
  }
});

test("docked, the scan is refused before godma is read or anything asked", async () => {
  const { api, options, asked } = await miner({ godma: { [MINING_SCANNER_UPGRADE]: 1 }, docked: true });
  await assert.rejects(api.runSurveyScan(options), (error) => error.status === 409 && error.code === "NOT_IN_SPACE");
  assert.deepEqual(asked, ["flight"]);
});

test("godma that cannot be read fails the scan, and the server is asked nothing", async () => {
  const { api, options, scans, errors } = await miner({ godma: { [MINING_SCANNER_UPGRADE]: Object.assign(new Error("the pilot is not held on this transport"), { code: "SESSION_NOT_FOUND" }) } });
  await assert.rejects(api.runSurveyScan(options), (error) => error.status >= 400);
  assert.deepEqual(scans(), []);
  assert.ok(errors.length <= 1);
});

test("where godma is not kept the scan is asked as it was: on the gateway, with a game port beside it or none, and on a game port with no godma to read", async () => {
  for (const setting of [{ gamePort: false, godma: { [MINING_SCANNER_UPGRADE]: 0 } }, { gamePort: false, beside: true, godma: { [MINING_SCANNER_UPGRADE]: 0 } }, { gamePort: true, keepsGodma: false }]) {
    const { api, options, asked, scans, bridgeSessionID } = await miner(setting);
    const answer = await api.runSurveyScan(options);
    // Asked, and nothing known of the ship's upgrade: null is "not known", never "none".
    assert.deepEqual(answer, { asked: true, scannerUpgrade: null, results: RESULTS, notifications: [{ type: "notification", name: "OnTest" }] }, JSON.stringify(setting));
    assert.deepEqual(scans(), [{ call: "miningScanMgr.perform_scan", args: [], kwargs: null, of: bridgeSessionID }]);
    assert.deepEqual(asked.filter((each) => each.godma !== undefined), []);
  }
});
