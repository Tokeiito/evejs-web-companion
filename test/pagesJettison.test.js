"use strict";

// The last two of the page's routes that no test of the BFF's asked, by the game-port audit's own list of 2026-10-12:
//
//   POST /api/bridge/ship/jettison
//   POST /api/bridge/ship/jettison/reconcile
//
// The first is three things, by what the BFF alone knows of who asks. A pilot in a cockpit (the Mining window's
// dumping) and a bot of no operation make the client's one call. A hosted bot of a Mining Operation has the can it
// made found in space and given to the operation, so that the operation's hauler takes that can and no other. And
// a hosted miner whose routine is the operation's own has its jettison kept as custody by the bot host: what was
// to go, whether the call was issued, and what became of it, so that a session lost in the middle is taken up
// from what is known. The second route is that custody looked at again, with nothing sent.
//
// The custody's reckoning and the bot host's keeping of it have tests of their own, each with the other stood in
// for; the page's askers answer themselves in theirs. What reads the world for them (a pilot's flight, its scene,
// its holds, a can's contents), what sends the call, and what gives the can to the operation are in the route,
// and nothing asked the route. So each route is asked here BY THE PAGE'S OWN ASKER (web/src/app/api.ts).
//
// The operation and its target board are the BFF's own, on a clock the test holds. THE BOT HOST IS THE REAL ONE,
// with the engine it runs a bot by stood in for (no bot runs): a hosted bot's request is made with the host's own
// fetch for that bot, which is what puts the bot's claim on it, and its custody is kept on the host's own record.
// The server is stood in for: a hold, a scene with its cans, and what becomes of a jettison.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-jettison-"));
process.env.EVEJS_WEB_POC_DATA_DIR = dataDir;

const { createApp } = require("../src/server");
const { createBotHost } = require("../src/botHost");
const { createBeltMemory } = require("../src/beltMemory");
const { createMiningOperationStore } = require("../src/miningOperationStore");
const { createMiningTargetBoard } = require("../src/miningTargetBoard");
const { createMiningOperations } = require("../src/miningOperations");

const ACCOUNT = { username: "miner-account", accountID: 4001, role: "0", banned: false };
const JITA = 30000142;
const PILOTS = [
  { characterID: 7001, accountID: 4001, characterName: "Miner One" },
  { characterID: 7002, accountID: 4001, characterName: "Miner Two" },
  { characterID: 7003, accountID: 4001, characterName: "Cargo One" },
  { characterID: 7004, accountID: 4001, characterName: "Miner Alone" },
  { characterID: 7009, accountID: 4001, characterName: "Tab One" },
];
const [MINER_ONE, MINER_TWO, HAULER, ALONE, TAB] = PILOTS;
const SYSTEMS = { [JITA]: { solarSystemID: JITA, solarSystemName: "Jita" }, 30004504: { solarSystemID: 30004504, solarSystemName: "4C-B7X" } };
const SCRIPTS = [
  { scriptID: "crew-miner", name: "Operation jetcan miner", rev: 1, doc: { program: [
    { kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
    { kind: "macro", macro: "jettison-ore", args: {} },
  ] } },
  { scriptID: "crew-hauler", name: "Operation hauler", rev: 1, doc: { program: [
    { kind: "macro", macro: "travel-to-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
    { kind: "macro", macro: "loot-containers", args: {} },
    { kind: "macro", macro: "deliver-ore", args: {} },
  ] } },
];
const START = 1_800_000_000_000;
const ORE_HOLD = 134;
const CARGO = 5;
const realFetch = globalThis.fetch;
const activeServers = new Set();
const activeHosts = new Set();

const list = (items) => ({ type: "list", items });
const shipOf = (characterID) => 500000 + characterID;
const belt = (targetName) => ({ targetType: "BELT", systemID: JITA, systemName: "Jita", targetName });
const member = (pilot, role, automationID) => ({ ...pilot, accountName: ACCOUNT.username, role, automationID });
const refusedAs = (status, code) => (error) => error.status === status && error.code === code;
/** What the custody's asker throws for a jettison that is not settled: its name, whether it was issued, and its state. */
/** `says`: the refusal's own words, as the bot's log will have them after its code. Left out, the words are not looked at. */
const custodyError = (code, notIssued, state, says = null) => (error) => error.name !== "AssertionError" && error.code === code && error.notIssued === notIssued &&
  (error.custody ? error.custody.state : null) === state && (says === null || (says instanceof RegExp ? says.test(error.message) : error.message === says));
/** What a refusal says when no cause was thrown: a custody stands, and that is all there is to say. */
const STANDS = "Jettison custody requires reconciliation; no second jettison was issued.";
const lost = () => Object.assign(new Error("the answer was lost"), { code: "TEST_ANSWER_LOST" });

/**
 * The server: each pilot in its own ship in Jita, what its holds have (`world.stack`), the cans in space, and what
 * becomes of a jettison (`world.jettison`, or of each in turn): it "lands", its answer is "lost" after it landed,
 * it "never" happens and no answer comes, it is "refused" (nothing moved, and the answer says so), or it lands in
 * a can the scene does not show ("unseen"), or not until the look numbered `world.arrivesAt` after it.
 * `world.sent` is every call that changes anything, and `world.amid` is
 * told of a read as it is answered, for what a test changes in the middle of a request.
 */
function space() {
  const world = { tick: 0, system: JITA, holds: new Map(), cans: new Map(), unseen: new Set(), unreadable: new Set(), nextCan: 9001,
    jettison: "lands", arrivesAt: null, looksSince: null, sent: [], asked: [], listedFlags: null, amid: () => {} };
  const row = (fields) => ({ type: "packedrow", fields });
  const pilotOf = (handle) => Number(String(handle).replace("gp:", "").replace("held-", ""));
  world.stack = (characterID, itemID, { typeID = 1230, quantity = 1000, flagID = ORE_HOLD, categoryID = 25 } = {}) => {
    const hold = world.holds.get(shipOf(characterID)) || [];
    hold.push({ itemID, typeID, quantity, ownerID: characterID, locationID: shipOf(characterID), flagID, categoryID });
    world.holds.set(shipOf(characterID), hold);
  };
  /** The items leave the pilot's holds for a new can of the pilot's in space: the can's number. */
  world.land = (characterID, itemIDs, { seen = true } = {}) => {
    const hold = world.holds.get(shipOf(characterID)) || [];
    const going = hold.filter((each) => itemIDs.includes(each.itemID));
    world.holds.set(shipOf(characterID), hold.filter((each) => !itemIDs.includes(each.itemID)));
    const canID = world.nextCan;
    world.nextCan += 1;
    world.cans.set(canID, { ownerID: characterID, rows: going.map((each) => ({ ...each, locationID: canID, flagID: 0 })) });
    if (!seen) world.unseen.add(canID);
    return canID;
  };
  world.scene = (characterID) => {
    world.tick += 1;
    // A can the scene has not got yet is in it at the look numbered `arrivesAt` after the jettison (1 is the first).
    if (world.looksSince !== null) {
      world.looksSince += 1;
      if (world.arrivesAt !== null && world.looksSince >= world.arrivesAt) world.unseen.clear();
    }
    return { inSpace: true, shipID: shipOf(characterID), solarSystemID: world.system, sampledAtMs: START + world.tick,
      ship: world.nobodyFlies ? { itemID: shipOf(characterID) } : { itemID: shipOf(characterID), characterID },
      entities: [{ kind: "asteroid", itemID: 40, ownerID: 1 }, ...[...world.cans].filter(([canID]) => !world.unseen.has(canID))
        .map(([canID, can]) => ({ kind: "container", itemID: canID, ownerID: can.ownerID }))] };
  };
  world.gateway = {
    async readFlightStatus(handle) {
      world.asked.push("flight");
      return { flight: { inSpace: true, docked: false, shipID: shipOf(pilotOf(handle)), solarSystemID: world.system, stationID: null }, notifications: [] };
    },
    async readSpaceSnapshot(handle) {
      world.asked.push("scene");
      return { space: world.scene(pilotOf(handle)), notifications: [] };
    },
    async bindObject(service, method, args) { return { boundHandle: `inv-${args[0]}`, notifications: [] }; },
    async callBoundMethod(service, method, args, kwargs, fields, bridgeSessionID, handle) {
      const id = Number(String(handle).replace("inv-", ""));
      world.asked.push(`${method} ${id}`);
      if (method === "ListByFlags") {
        world.listedFlags = args[0];
        world.amid("the holds listed");
        return { result: list((world.holds.get(id) || []).filter((each) => args[0].includes(each.flagID)).map(row)), notifications: [] };
      }
      assert.equal(method, "List");
      if (world.unreadable.has(id)) throw Object.assign(new Error("the can's contents cannot be read"), { code: "TEST_UNREADABLE" });
      return { result: list(world.cans.get(id).rows.map(row)), notifications: [] };
    },
    async callMethod(service, method, args, kwargs, fields, bridgeSessionID) {
      world.sent.push({ call: `${service}.${method}`, args, kwargs, of: bridgeSessionID });
      assert.deepEqual([service, method], ["ship", "Jettison"]);
      world.amid("the call arrives");
      const how = Array.isArray(world.jettison) ? world.jettison.shift() : world.jettison;
      if (how === "refused") return { result: [list([]), list([])], notifications: [] };
      if (how === "never") throw lost();
      world.land(pilotOf(bridgeSessionID), args[0], { seen: how !== "unseen" });
      world.looksSince = 0;
      if (how === "lost") throw lost();
      // As the server answers the client: the items that went to a can, and those launched for themselves.
      return { result: [list(args[0]), list([])], notifications: [] };
    },
  };
  return world;
}

/**
 * The BFF over that server, with the operations it keeps on a clock the test holds, the real bot host with no bot
 * run by it, and the page's own askers. `tab` asks as a cockpit with pilot 7009 held; `hosted(pilot, more)` starts
 * a hosted bot for a pilot and answers the request options that bot's own flow is given.
 */
async function crew(world, { gamePort = false } = {}) {
  const clock = { at: START };
  /** What the BFF waited, by its own sleep, which a test's BFF does not sleep for. */
  const slept = [];
  const now = () => clock.at;
  const store = createMiningOperationStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-jettison-store-")),
    resolveSystem: (id) => SYSTEMS[Number(id)] || null, resolveStation: () => null });
  const board = createMiningTargetBoard({ now });
  const operations = createMiningOperations({ store, targetBoard: board, beltMemory: createBeltMemory({ now }), now });
  const held = new Map();
  const errors = [];
  const webAuth = {
    createSessionToken() { webAuth.made += 1; return `token-${webAuth.made}`; },
    // A token names its own web session: a hosted bot has one of its own for its pilot.
    verifySessionToken(token) {
      return /^token-(\d+|tab)$/.test(String(token)) ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: `session-${String(token).slice(6)}` } : null;
    },
    countConfiguredUsers() { return 1; },
    made: 0,
  };
  // The engine a bot is run by, stood in for: a store that says its pilot is online, and a flow that does nothing.
  const given = [];
  let secrets = 0;
  const engine = (characterID) => {
    const state = { station: { online: null }, flight: { status: { shipID: shipOf(characterID) } }, space: { snapshot: null }, customBot: { status: "idle" } };
    const listeners = new Set();
    const push = (snapshot) => { state.customBot = snapshot; for (const listener of listeners) listener(state); };
    return {
      store: { station: { get: () => state.station }, flight: { get: () => state.flight }, space: { get: () => state.space }, customBot: { get: () => state.customBot },
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } },
      flow: {
        async selectCharacter() { state.station.online = { characterID, characterName: PILOTS.find((pilot) => pilot.characterID === characterID).characterName }; },
        async startCustomBot() { push({ status: "running", phase: "Mining" }); },
        suspendHostedSession() { push({ status: "paused" }); return Promise.resolve(); },
        async verifyHostedSessionRecovery() {},
        resumeHostedSession() { push({ status: "running", phase: "Mining" }); },
        async prepareHostedBotStop() {},
        async prepareCustomBotParking() {},
        async parkCustomBot() {},
        stopCustomBot() { push({ status: "idle" }); },
        abortRoute() {},
        async logout() {},
      },
    };
  };
  let starting = null;
  const host = createBotHost({
    baseUrl: "http://127.0.0.1:0",
    webAuth,
    createClaimSecret: () => { secrets += 1; return `claim-${secrets}`; },
    loadAccount: async () => ({ ...ACCOUNT }),
    loadScript: (scriptID) => ({ scriptID, name: "Hosted routine", rev: 1, doc: starting.doc }),
    disconnectOwnedSession: async () => {},
    errorLogger(error) { errors.push(error); },
    loadStack: async () => ({
      createClientStore: () => starting.engine.store,
      createAppFlow: (clientStore, options) => { given.push(options); return starting.engine.flow; },
      decodeScriptValue: (value) => ({ ok: true, doc: value }),
      analyzeBotRunPolicy: () => ({ restartSafe: false, riskClasses: ["fleet"] }),
      supportsHostedOreJettisonRecovery: (doc) => doc.oreCustody === true,
      validateBotLaunchGrant: (grant) => ({ ok: true, grant }),
    }),
  });
  activeHosts.add(host);
  const app = createApp({
    eveStore: {
      getAccount: async (username) => (username === ACCOUNT.username ? { ...ACCOUNT } : null),
      getCharacterForAccount: async (accountID, characterID) => PILOTS.find((each) => each.characterID === Number(characterID)) || null,
      listCharactersForAccount: async () => PILOTS.map((each) => ({ ...each })),
    },
    eveGatewayClient: world.gateway,
    // A pilot on the game port: the same server, reached by the transport that speaks the client's protocol.
    ...(gamePort ? { gamePortPilots: world.gateway, pilotTransportFor: () => "gameport" } : {}),
    transitionSleep: async (ms) => { slept.push(ms); },
    webAuth,
    botHost: host,
    bridgeSessionStore: held,
    botScriptStore: { get: (scriptID) => SCRIPTS.find((each) => each.scriptID === scriptID) || null, list: () => SCRIPTS },
    staticData: {
      listMiningResources: () => [],
      getStation: () => null,
      getSolarSystem: (id) => SYSTEMS[Number(id)] || null,
      getSolarSystemName: (id) => (SYSTEMS[Number(id)] || {}).solarSystemName || `System ${id}`,
    },
    miningOperationStore: store,
    miningTargetBoard: board,
    miningOperations: operations,
    errorLogger(error) { errors.push(error); },
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = await import("../web/src/app/api.ts");
  const paths = [];
  const bodies = [];
  const answers = [];
  // The page's own request: what was asked, what was sent with it and what was answered are kept. A hosted bot's
  // goes by the host's own fetch for that bot, which is what puts the claim on it.
  const asking = (token, fetchOfTheBots = null) => ({
    baseUrl,
    token,
    fetch: async (input, init = {}) => {
      paths.push(`${init.method || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "")}`);
      bodies.push(init.body === undefined ? null : JSON.parse(init.body));
      const response = await (fetchOfTheBots ? fetchOfTheBots(input, init) : realFetch(input, init));
      answers.push([response.status, await response.clone().json().catch(() => null)]);
      return response;
    },
  });
  /** A pilot in space in its own ship, held by a web session: a hosted bot's where its row has the bot's claim. */
  const online = (pilot, sessionID, secret = null) => {
    const row = { characterID: pilot.characterID, accountID: ACCOUNT.accountID, bridgeSessionID: `${gamePort ? "gp:" : ""}held-${pilot.characterID}`, solarSystemID: JITA,
      activeShipID: shipOf(pilot.characterID), boundHandles: new Map(), streamSubscribers: new Set(), transition: null, droneRecoveryReady: true,
      ...(secret ? { botClaimSecret: secret } : {}) };
    held.set(sessionID, row);
    return row;
  };
  online(TAB, "session-tab");
  const tab = asking("token-tab");
  /** A hosted bot started for a pilot by the real host, its pilot online in the bot's own session. */
  async function hosted(pilot, { operationID = null, operationRole = null, operationRunID = null, oreCustody = false } = {}) {
    starting = { doc: { oreCustody }, engine: engine(pilot.characterID) };
    const started = await host.start({ account: { ...ACCOUNT }, characterID: pilot.characterID, scriptID: oreCustody ? "mcc.miner" : "crew-miner", scriptName: "Hosted routine",
      scriptRev: 1, doc: starting.doc, grant: { scriptRev: 1, riskClasses: ["fleet"], maxRuntimeMinutes: 10 }, operationID, operationRole, operationRunID });
    assert.equal(started.ok, true, JSON.stringify(started));
    const flowsOwn = given.at(-1);
    const secret = `claim-${secrets}`;
    const row = online(pilot, webAuth.verifySessionToken(flowsOwn.initialSessionToken).sessionID, secret);
    return { botID: started.bot.botID, row, token: flowsOwn.initialSessionToken, options: asking(flowsOwn.initialSessionToken, flowsOwn.fetch),
      custodyOf: () => host.list(ACCOUNT.accountID).find((each) => each.botID === started.bot.botID).jettisonCustody };
  }
  /** A jetcan crew begun as the start route begins one, two miners and a hauler, with a belt reserved by the first. */
  async function jetcanCrew({ oreCustody = false, unloadPolicy = "HAULER_SERVICE" } = {}) {
    // A crew whose miners unload for themselves has no hauler.
    const members = [member(MINER_ONE, "MINER", "crew-miner"), member(MINER_TWO, "MINER", "crew-miner"),
      ...(unloadPolicy === "HAULER_SERVICE" ? [member(HAULER, "HAULER", "crew-hauler")] : [])];
    const saved = await api.saveMiningOperation({ name: "Jetcan crew",
      area: { anchorSystemID: JITA, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
      targetPolicy: "ANY_ELIGIBLE", unloadPolicy, members }, tab);
    const { operationID } = saved.operations.find((each) => each.definition.name === "Jetcan crew").definition;
    assert.equal(operations.begin(operationID, ["BELT"], "run-1").ok, true);
    const bots = {};
    for (const each of members) {
      bots[each.characterID] = await hosted(each, { operationID, operationRole: each.role, operationRunID: "run-1", oreCustody: oreCustody && each.role === "MINER" });
      assert.equal(operations.memberStarted(operationID, each.characterID, bots[each.characterID].botID), true);
    }
    operations.finishLaunch(operationID);
    return { operationID, bots };
  }
  const reset = () => { paths.length = 0; bodies.length = 0; answers.length = 0; world.sent.length = 0; world.asked.length = 0; slept.length = 0; };
  return { app, api, host, clock, operations, board, held, errors, paths, bodies, answers, slept, tab, asking, hosted, jetcanCrew, reset };
}

test.afterEach(async () => {
  for (const host of activeHosts) {
    activeHosts.delete(host);
    await host.stopAll();
  }
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    server.closeAllConnections();
    closing.push(new Promise((resolve) => { server.close(() => resolve()); }));
  }
  await Promise.all(closing);
});

// ---------------------------------------------------------------------------------------------------------------
// The one call
// ---------------------------------------------------------------------------------------------------------------

test("a cockpit's jettison: the page posts the items with its confirmation, the BFF makes the client's one call with the items as one list, and the page reads nothing of the answer", { timeout: 20000 }, async () => {
  const world = space();
  const { api, tab, paths, bodies, answers, held, asking } = await crew(world);
  world.stack(7009, 901);
  world.stack(7009, 902, { flagID: CARGO, typeID: 34, categoryID: 4 });
  assert.equal(await api.jettisonItems([901, 902], tab), null);
  assert.deepEqual([paths, bodies], [["POST /api/bridge/ship/jettison"], [{ itemIDs: [901, 902], confirm: true }]]);
  // GetShipAccess().Jettison(itemIDs) (invItemFunctions.py 63): the items' IDs as one list, and nothing else.
  assert.deepEqual(world.sent, [{ call: "ship.Jettison", args: [[901, 902]], kwargs: null, of: "held-7009" }]);
  assert.deepEqual(answers[0], [200, { ok: true, applied: true, result: [list([901, 902]), list([])], notifications: [] }]);
  // Nothing of space or of a hold is read for it: the cockpit's own next read of its hold is what says what went.
  assert.deepEqual(world.asked, []);
  assert.deepEqual([...world.cans.keys()], [9001]);

  // A jettison the server answers as having moved nothing is answered the same way: the page is not told.
  world.jettison = "refused";
  world.stack(7009, 903);
  assert.equal(await api.jettisonItems([903], tab), null);
  assert.deepEqual(answers[1][1].result, [list([]), list([])]);
  // Nobody held by the tab: refused, and nothing sent.
  held.delete("session-tab");
  await assert.rejects(api.jettisonItems([903], tab), refusedAs(409, "NO_LIVE_SESSION"));
  await assert.rejects(api.jettisonItems([903], asking(null)), refusedAs(401, "AUTH_REQUIRED"));
  assert.equal(world.sent.length, 2);
});

test("a hosted bot of no operation jettisons as a cockpit does: the one call, with no scene read and no can kept", { timeout: 20000 }, async () => {
  const world = space();
  const { api, hosted, answers, asking } = await crew(world);
  const bot = await hosted(ALONE);
  world.stack(7004, 911);
  // A bot's action sends its invocation only where its jettison is the host's to keep: this one's is not.
  assert.equal(await api.jettisonItems([911], bot.options), null);
  assert.deepEqual(world.sent, [{ call: "ship.Jettison", args: [[911]], kwargs: null, of: "held-7004" }]);
  assert.deepEqual([answers[0][0], answers[0][1].applied, world.asked, bot.custodyOf()], [200, true, [], null]);
  // The bot's session asked with its token alone, as anything but the host's own fetch would: it has not the
  // bot's claim on it, and a hosted pilot's writes are the bot's alone.
  await assert.rejects(api.jettisonItems([911], asking(bot.token)), refusedAs(409, "HOSTED_GENERATION_CHANGED"));
  assert.equal(world.sent.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// A Mining Operation's can
// ---------------------------------------------------------------------------------------------------------------

test("a hosted miner of an operation: the can its jettison made is found in the pilot's scene and given to the operation, which its hauler is then answered", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, answers, reset } = await crew(world);
  const { bots } = await jetcanCrew();
  world.stack(7001, 921);
  // Before the operation has a target there is nowhere for a can to belong: refused, and nothing sent.
  await assert.rejects(api.jettisonItems([921], bots[7001].options), refusedAs(409, "OPERATION_TARGET_REQUIRED"));
  assert.deepEqual(world.sent, []);
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  // A can of another pilot's is in space already, and one of the miner's own from before: neither is the new one.
  world.land(7002, []);
  world.stack(7001, 920);
  world.land(7001, [920]);
  reset();

  assert.equal(await api.jettisonItems([921], bots[7001].options), null);
  assert.deepEqual(world.sent, [{ call: "ship.Jettison", args: [[921]], kwargs: null, of: "held-7001" }]);
  assert.deepEqual(answers[0], [200, { ok: true, applied: true, result: [list([921]), list([])], notifications: [] }]);
  // The scene was read before the call and after it, and no hold.
  assert.deepEqual(world.asked, ["scene", "scene"]);
  // The new can is the operation's, and the old ones are not: the hauler and the miner are answered it.
  assert.deepEqual((await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs, [9003]);
  const mine = await api.readMiningOperationAssignment(bots[7001].options);
  assert.deepEqual([mine.ownedContainerIDs, mine.containerProvenanceUnconfirmed, mine.state], [[9003], false, "TRAVELING"]);

  // The hauler has no ore to jettison for the operation: refused, and nothing sent.
  await assert.rejects(api.jettisonItems([1], bots[7003].options), refusedAs(409, "OPERATION_TARGET_REQUIRED"));
  assert.equal(world.sent.length, 1);
});

test("a hosted miner of an operation: a can that shows a moment late is found, and a jettison that moved nothing and made no can is answered as done, with nothing given to the operation", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world);
  const { bots } = await jetcanCrew();
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 931);
  // The can is in space and the scene has not got it yet: it has it at the second look after. Through the
  // gateway the scene is the server's own, and the route looks twice more, a fifth of a second apart.
  [world.jettison, world.arrivesAt] = ["unseen", 2];
  reset();
  assert.equal(await api.jettisonItems([931], bots[7001].options), null);
  assert.deepEqual([world.asked, slept, (await api.readMiningOperationAssignment(bots[7001].options)).ownedContainerIDs], [["scene", "scene", "scene"], [200], [9001]]);

  world.jettison = "refused";
  world.stack(7001, 932);
  assert.equal(await api.jettisonItems([932], bots[7001].options), null);
  const after = await api.readMiningOperationAssignment(bots[7001].options);
  assert.deepEqual([after.ownedContainerIDs, after.containerProvenanceUnconfirmed], [[9001], false]);
});

test("a hosted miner of an operation: where the can cannot be told, the jettison is refused by name though it may have happened, and the operation is told its cans are not known", { timeout: 20000 }, async () => {
  for (const [why, arrange] of [
    ["no new can is seen", (world) => { world.jettison = "unseen"; }],
    ["two new cans are seen", (world) => { const land = world.land; world.land = (pilot, items, more) => { land(pilot, []); return land(pilot, items, more); }; }],
  ]) {
    const world = space();
    const fixture = await crew(world);
    const { api, jetcanCrew } = fixture;
    const { bots } = await jetcanCrew();
    assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
    world.stack(7001, 941);
    arrange(world);
    fixture.reset();
    await assert.rejects(api.jettisonItems([941], bots[7001].options), refusedAs(409, "OPERATION_CONTAINER_PROVENANCE_UNCONFIRMED"), why);
    assert.equal(world.sent.length, 1, why);
    // Through the gateway a can that is not seen at once is looked for twice more, and no longer.
    assert.deepEqual(fixture.slept, why === "no new can is seen" ? [200, 200] : [], why);
    const told = await api.readMiningOperationAssignment(bots[7003].options);
    assert.deepEqual([told.ownedContainerIDs, told.containerProvenanceUnconfirmed, told.state], [[], true, "DEGRADED"], why);
  }
});

test("a hosted miner of an operation: a scene that is not the target's system is refused before anything is sent, and an answer lost after the call leaves the operation's cans not known", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew } = await crew(world);
  const { bots } = await jetcanCrew();
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 951);
  world.system = 30004504;
  await assert.rejects(api.jettisonItems([951], bots[7001].options), (error) => error.code === "OPERATION_CONTAINER_SCENE_UNREADABLE");
  assert.deepEqual([world.sent, (await api.readMiningOperationAssignment(bots[7003].options)).containerProvenanceUnconfirmed], [[], false]);
  world.system = JITA;
  world.jettison = "lost";
  await assert.rejects(api.jettisonItems([951], bots[7001].options), (error) => error.code === "TEST_ANSWER_LOST");
  const told = await api.readMiningOperationAssignment(bots[7003].options);
  assert.deepEqual([world.sent.length, told.ownedContainerIDs, told.containerProvenanceUnconfirmed], [1, [], true]);
});

// ---------------------------------------------------------------------------------------------------------------
// A hosted miner's custody
// ---------------------------------------------------------------------------------------------------------------

const invocation = (invocationID) => ({ runID: "run-of-the-bot", invocationID, stepPath: "loop/jettison-ore" });

test("a hosted miner whose jettison the host keeps: the page posts the items and the invocation, and reads the custody settled: the ore gone from the hold, the one new can with exactly it, and the can given to the operation", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, paths, bodies, answers, slept, reset } = await crew(world);
  const { operationID, bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 961, { quantity: 4000 });
  world.stack(7001, 962, { typeID: 1228, quantity: 250 });
  world.stack(7001, 963, { flagID: CARGO, typeID: 18000, quantity: 2, categoryID: 8 });
  world.land(7002, []);
  reset();

  const whenTheCallArrived = [];
  world.amid = (what) => { if (what === "the call arrives") whenTheCallArrived.push([bots[7001].custodyOf().state, Number.isFinite(bots[7001].custodyOf().issuedAtMs)]); };
  const receipt = await api.jettisonItems([961, 962], bots[7001].options, invocation(1));
  world.amid = () => {};
  assert.deepEqual([paths, bodies], [["POST /api/bridge/ship/jettison"], [{ itemIDs: [961, 962], confirm: true, invocation: invocation(1) }]]);
  // Before the call left the BFF the host had it as issued: a call whose answer never comes is still known of.
  assert.deepEqual(whenTheCallArrived, [["issued-pending", true]]);
  // Through the gateway the can is in the scene when the call answers, and nothing is waited for.
  assert.deepEqual(slept, []);
  assert.deepEqual(world.sent, [{ call: "ship.Jettison", args: [[961, 962]], kwargs: null, of: "held-7001" }]);
  // What the bot's flow goes by: a state it can go on from.
  assert.deepEqual([receipt.state, api.recoverableHostedJettison(receipt), receipt.containerID, receipt.reason], ["confirmed-created", true, 9002, null]);
  assert.deepEqual([receipt.scope.operationID, receipt.scope.pilotID, receipt.scope.shipID, receipt.scope.systemID, receipt.scope.targetKey, receipt.scope.botID,
    receipt.scope.runID, receipt.scope.invocationID, receipt.scope.stepPath],
  [operationID, 7001, shipOf(7001), JITA, `BELT:${JITA}:Belt I`, bots[7001].botID, "run-of-the-bot", 1, "loop/jettison-ore"]);
  assert.deepEqual([receipt.items.map((each) => [each.itemID, each.typeID, each.quantity, each.flagID]), receipt.existingContainerIDs, receipt.resultMovedIDs, receipt.resultLaunchedIDs,
    receipt.sourceAfter.map((each) => each.itemID)],
  [[[961, 1230, 4000, ORE_HOLD], [962, 1228, 250, ORE_HOLD]], [], [961, 962], [], [963]]);
  assert.deepEqual(answers[0][1], { ok: true, accepted: true, notIssued: false, jettisonCustody: receipt, notifications: [] });
  // What was read for it: where the pilot is, its scene and its holds before the call; and after it the scene, the
  // holds, the one new can's contents, and where the pilot is again. The holds are the five a miner's ore may be in.
  assert.deepEqual(world.asked, ["flight", "scene", `ListByFlags ${shipOf(7001)}`, "scene", `ListByFlags ${shipOf(7001)}`, "List 9002", "flight"]);
  assert.deepEqual(world.listedFlags, [5, 134, 135, 181, 182]);
  // The host has it on the bot's own record, and the operation has the can.
  assert.deepEqual(bots[7001].custodyOf(), receipt);
  assert.deepEqual((await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs, [9002]);

  // The same invocation asked again (a retry of the bot's): answered from what is kept, and nothing sent.
  assert.deepEqual(await api.jettisonItems([961, 962], bots[7001].options, invocation(1)), receipt);
  assert.equal(world.sent.length, 1);
  // The same invocation with other items is not that invocation.
  await assert.rejects(api.jettisonItems([961], bots[7001].options, invocation(1)), custodyError("JETTISON_INVOCATION_CHANGED", false, "confirmed-created"));
  // The next invocation of the run is a new jettison. Of the miner's cans it is the new one alone that is opened.
  world.stack(7001, 964);
  reset();
  const next = await api.jettisonItems([964], bots[7001].options, invocation(2));
  assert.deepEqual([next.state, next.containerID, next.existingContainerIDs, world.sent.length], ["confirmed-created", 9003, [9002], 1]);
  assert.deepEqual(world.asked.filter((each) => each.startsWith("List ")), ["List 9003"]);
  assert.deepEqual((await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs, [9002, 9003]);
  // An invocation that goes back, or is of another run than the custody's, is no next one: refused, and nothing sent.
  world.stack(7001, 965);
  await assert.rejects(api.jettisonItems([965], bots[7001].options, invocation(1)), custodyError("JETTISON_PENDING", false, "confirmed-created"));
  await assert.rejects(api.jettisonItems([965], bots[7001].options, { ...invocation(3), runID: "another-run" }), custodyError("JETTISON_PENDING", false, "confirmed-created"));
  assert.equal(world.sent.length, 1);
  assert.equal((await api.jettisonItems([965], bots[7001].options, invocation(3))).state, "confirmed-created");
});

test("a hosted miner's custody refuses before anything is sent: what is not ore, what is not in its holds, an invocation that is none, and no target; and the page is told nothing was issued", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew } = await crew(world);
  const { bots } = await jetcanCrew({ oreCustody: true });
  world.stack(7001, 971);
  world.stack(7001, 972, { flagID: CARGO, typeID: 18000, quantity: 2, categoryID: 8 });
  // No target yet: the custody has no scope.
  await assert.rejects(api.jettisonItems([971], bots[7001].options, invocation(1)), custodyError("JETTISON_SCOPE_CHANGED", true, null, "The captured ore logistics assignment is unavailable."));
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  // Each refusal says its own cause: the bot's log has these words after the code.
  await assert.rejects(api.jettisonItems([972], bots[7001].options, invocation(1)), custodyError("JETTISON_NOT_ISSUED", true, null, "Only exact owned whole ore stacks support hosted recovery: item 972 is not ore."));
  await assert.rejects(api.jettisonItems([979], bots[7001].options, invocation(1)), custodyError("JETTISON_NOT_ISSUED", true, null, "Only exact owned whole ore stacks support hosted recovery: item 979 is not in the ship's holds."));
  await assert.rejects(api.jettisonItems([971], bots[7001].options, { runID: "", invocationID: 1, stepPath: "x" }),
    custodyError("JETTISON_NOT_ISSUED", true, null, "Jettison pre-dispatch authority is unreadable: the asking does not say which run, which of its askings and which step it is."));
  // A scene whose ship is not said to be flown by the pilot, as the game port's was: said so, where it was one
  // sentence for every cause.
  world.nobodyFlies = true;
  await assert.rejects(api.jettisonItems([971], bots[7001].options, invocation(1)),
    custodyError("JETTISON_NOT_ISSUED", true, null, "Jettison pre-dispatch authority is unreadable: the scene's ship is not said to be flown by this pilot."));
  world.nobodyFlies = false;
  assert.deepEqual([world.sent, bots[7001].custodyOf()], [[], null]);
  // The pilot in another system than its target's: no scope.
  world.system = 30004504;
  await assert.rejects(api.jettisonItems([971], bots[7001].options, invocation(1)), custodyError("JETTISON_SCOPE_CHANGED", true, null));
  world.system = JITA;
  // The BFF has the pilot in another ship than the one it flies: no scope.
  bots[7001].row.activeShipID = 1;
  await assert.rejects(api.jettisonItems([971], bots[7001].options, invocation(1)), custodyError("JETTISON_SCOPE_CHANGED", true, null));
  bots[7001].row.activeShipID = shipOf(7001);
  assert.deepEqual([world.sent, bots[7001].custodyOf()], [[], null]);
  // The same, changed after the hold was read and before the call: the custody is begun, and refused before
  // anything is sent, which the host keeps and the page is told.
  world.amid = (what) => { if (what === "the holds listed") bots[7001].row.activeShipID = 1; };
  await assert.rejects(api.jettisonItems([971], bots[7001].options, invocation(1)), custodyError("JETTISON_SCOPE_CHANGED", true, "refused-before-dispatch", "Jettison scope changed before dispatch."));
  world.amid = () => {};
  bots[7001].row.activeShipID = shipOf(7001);
  assert.deepEqual([world.sent, bots[7001].custodyOf().state, bots[7001].custodyOf().issuedAtMs], [[], "refused-before-dispatch", null]);
  // And it is issued when asked as it should be, by the next invocation.
  assert.equal((await api.jettisonItems([971], bots[7001].options, invocation(2))).state, "confirmed-created");
});

test("a hosted miner of a crew whose miners unload for themselves has no custody of a jettison: refused before anything is sent", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew } = await crew(world);
  const { bots } = await jetcanCrew({ oreCustody: true, unloadPolicy: "SELF_UNLOAD" });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 975);
  await assert.rejects(api.jettisonItems([975], bots[7001].options, invocation(1)), custodyError("JETTISON_SCOPE_CHANGED", true, null));
  assert.deepEqual(world.sent, []);
});

test("a hosted miner's jettison whose answer was lost: the page is told it is not settled, a second jettison is held back, and the page's look at the custody settles it from the hold and the can, sending nothing", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, paths, bodies, reset } = await crew(world);
  const { bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 981);
  world.stack(7001, 982);
  // The call is made and its answer lost; the can is in space and its contents cannot be read just then.
  world.jettison = "lost";
  world.unreadable.add(9001);
  await assert.rejects(api.jettisonItems([981], bots[7001].options, invocation(1)), custodyError("TEST_ANSWER_LOST", false, "ambiguous", "the answer was lost"));
  // The host has it as issued (by the BFF's own clock), whatever became of it.
  assert.deepEqual([world.sent.length, bots[7001].custodyOf().state, Number.isFinite(bots[7001].custodyOf().issuedAtMs)], [1, "ambiguous", true]);
  // Until it is settled the miner jettisons nothing more, whatever invocation it says: held back before anything
  // is read of the world, let alone sent.
  reset();
  await assert.rejects(api.jettisonItems([982], bots[7001].options, invocation(2)), custodyError("TEST_ANSWER_LOST", false, "ambiguous", STANDS));
  assert.deepEqual([world.sent, world.asked], [[], []]);

  // Looked at while the can cannot be read: not settled, by name.
  reset();
  await assert.rejects(api.reconcileHostedJettison(bots[7001].options), custodyError("JETTISON_CONTAINER_CONTENTS_UNKNOWN", false, "ambiguous", STANDS));
  assert.deepEqual([paths, bodies], [["POST /api/bridge/ship/jettison/reconcile"], [{}]]);
  assert.deepEqual(world.asked, ["flight", "scene", `ListByFlags ${shipOf(7001)}`, "List 9001", "flight"]);
  // Looked at again once it can: settled, the can the operation's, and nothing sent by either look.
  world.unreadable.clear();
  const settled = await api.reconcileHostedJettison(bots[7001].options);
  assert.deepEqual([settled.state, settled.containerID, settled.reason, settled.resultMovedIDs, world.sent.length], ["confirmed-created", 9001, null, null, 0]);
  assert.deepEqual(bots[7001].custodyOf(), settled);
  assert.deepEqual((await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs, [9001]);
  // Looked at again when settled, it is the same, and no can is opened for it; and the miner jettisons again.
  reset();
  assert.deepEqual((await api.reconcileHostedJettison(bots[7001].options)).state, "confirmed-created");
  assert.deepEqual(world.asked, ["flight", "scene", `ListByFlags ${shipOf(7001)}`, "flight"]);
  world.jettison = "lands";
  assert.equal((await api.jettisonItems([982], bots[7001].options, invocation(2))).state, "confirmed-created");
});

test("a hosted miner's jettison that never happened, and one the server answered as moving nothing: the first stays unsettled at every look, and the second is settled as nothing done", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew } = await crew(world);
  const { bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 991);
  world.jettison = "refused";
  const nothing = await api.jettisonItems([991], bots[7001].options, invocation(1));
  assert.deepEqual([nothing.state, nothing.containerID, nothing.resultMovedIDs, nothing.sourceAfter.map((each) => each.itemID)], ["confirmed-no-ore-mutation", null, [], [991]]);
  assert.deepEqual((await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs, []);

  world.jettison = "never";
  await assert.rejects(api.jettisonItems([991], bots[7001].options, invocation(2)), custodyError("TEST_ANSWER_LOST", false, "ambiguous"));
  // The ore is in the hold still and there is no can: that is not proof that nothing will come of the call.
  await assert.rejects(api.reconcileHostedJettison(bots[7001].options), custodyError("JETTISON_OUTCOME_UNCONFIRMED", false, "ambiguous"));
  await assert.rejects(api.reconcileHostedJettison(bots[7001].options), custodyError("JETTISON_OUTCOME_UNCONFIRMED", false, "ambiguous"));
  assert.equal(world.sent.length, 2);
});

test("a look at custody is the custody's owner's: a bot with none kept is answered that there is none, and a cockpit, a bot of no operation and a bot whose jettison is not kept are refused by name", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, hosted, tab, answers } = await crew(world);
  const { bots } = await jetcanCrew({ oreCustody: true });
  // A miner whose jettison is kept, with none made yet: none, and nothing read of the world.
  assert.equal(await api.reconcileHostedJettison(bots[7001].options), null);
  assert.deepEqual([answers.at(-1)[1], world.asked], [{ ok: true, accepted: true, notIssued: true, jettisonCustody: null, notifications: [] }, []]);
  // The hauler of the same operation, a bot of no operation, and a cockpit.
  await assert.rejects(api.reconcileHostedJettison(bots[7003].options), refusedAs(409, "JETTISON_CUSTODY_UNAVAILABLE"));
  await assert.rejects(api.reconcileHostedJettison((await hosted(ALONE)).options), refusedAs(409, "JETTISON_CUSTODY_UNAVAILABLE"));
  await assert.rejects(api.reconcileHostedJettison(tab), refusedAs(409, "JETTISON_CUSTODY_UNAVAILABLE"));
  assert.deepEqual(world.sent, []);
});

// ---------------------------------------------------------------------------------------------------------------
// On the game port
// ---------------------------------------------------------------------------------------------------------------
//
// A pilot on the game port sees its own park, and a can is a ball that the ballpark update after the call's answer
// brings. Seen on the running server on 2026-10-12: the can was in a game-port pilot's scene 1635, 944 and 1681 ms
// after the answer in three runs, and 9 ms after it through the gateway, whose scene is the server's own. So on
// the game port the route waits for the can, a quarter of a second at a time and three seconds at most, as a
// launch waits for its drones; and it waits for nothing where the server has said that nothing went.

test("on the game port a Mining Operation's can comes with the ballpark update after the answer: the route looks for it a quarter of a second at a time, finds it, and gives it to the operation", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world, { gamePort: true });
  const { bots } = await jetcanCrew();
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 1001);
  // The can is in the pilot's park at the sixth look after the call: a second and a quarter on.
  [world.jettison, world.arrivesAt] = ["unseen", 6];
  reset();
  assert.equal(await api.jettisonItems([1001], bots[7001].options), null);
  assert.deepEqual(world.sent, [{ call: "ship.Jettison", args: [[1001]], kwargs: null, of: "gp:held-7001" }]);
  // One look before the call, six after it, and five waits between those.
  assert.deepEqual([world.asked, slept], [Array(7).fill("scene"), [250, 250, 250, 250, 250]]);
  const mine = await api.readMiningOperationAssignment(bots[7003].options);
  assert.deepEqual([mine.ownedContainerIDs, mine.containerProvenanceUnconfirmed], [[9001], false]);

  // A can that is there at the first look is waited for not at all.
  world.stack(7001, 1002);
  [world.jettison, world.arrivesAt] = ["lands", null];
  reset();
  assert.equal(await api.jettisonItems([1002], bots[7001].options), null);
  assert.deepEqual([world.asked, slept], [["scene", "scene"], []]);
  // And a jettison the server answers as moving nothing has no can to wait for.
  world.stack(7001, 1003);
  world.jettison = "refused";
  reset();
  assert.equal(await api.jettisonItems([1003], bots[7001].options), null);
  assert.deepEqual([world.asked, slept, (await api.readMiningOperationAssignment(bots[7003].options)).containerProvenanceUnconfirmed], [["scene", "scene"], [], false]);
});

test("on the game port a can that does not come is waited for three seconds, a quarter at a time, and the jettison then refused by name; one that comes at the last look is found", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world, { gamePort: true });
  const { bots } = await jetcanCrew();
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 1011);
  // At the thirteenth look after the call, twelve waits on: the last there is.
  [world.jettison, world.arrivesAt] = ["unseen", 13];
  reset();
  assert.equal(await api.jettisonItems([1011], bots[7001].options), null);
  assert.deepEqual([slept.length, slept.reduce((sum, ms) => sum + ms, 0), new Set(slept).size, (await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs],
    [12, 3000, 1, [9001]]);

  world.stack(7001, 1012);
  [world.jettison, world.arrivesAt] = ["unseen", 14];
  reset();
  await assert.rejects(api.jettisonItems([1012], bots[7001].options), refusedAs(409, "OPERATION_CONTAINER_PROVENANCE_UNCONFIRMED"));
  const told = await api.readMiningOperationAssignment(bots[7003].options);
  assert.deepEqual([slept.length, slept.reduce((sum, ms) => sum + ms, 0), told.ownedContainerIDs, told.containerProvenanceUnconfirmed], [12, 3000, [9001], true]);
});

test("on the game port a hosted miner's custody waits for the can too: the ore gone from the hold and no can yet is looked at again a quarter of a second at a time, and settled once the park has it", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world, { gamePort: true });
  const { bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 1021);
  [world.jettison, world.arrivesAt] = ["unseen", 4];
  reset();
  const receipt = await api.jettisonItems([1021], bots[7001].options, invocation(1));
  assert.deepEqual([receipt.state, receipt.containerID, receipt.reason, slept], ["confirmed-created", 9001, null, [250, 250, 250]]);
  // The scene and the hold read after the call, the scene three times more, and then the can that came.
  assert.deepEqual(world.asked, ["flight", "scene", `ListByFlags ${shipOf(7001)}`, "scene", `ListByFlags ${shipOf(7001)}`, "scene", "scene", "scene", "List 9001", "flight"]);
  assert.deepEqual((await api.readMiningOperationAssignment(bots[7003].options)).ownedContainerIDs, [9001]);

  // A jettison the server answers as moving nothing leaves the ore in the hold: no can is waited for.
  world.stack(7001, 1022);
  [world.jettison, world.arrivesAt] = ["refused", null];
  reset();
  assert.deepEqual([(await api.jettisonItems([1022], bots[7001].options, invocation(2))).state, slept], ["confirmed-no-ore-mutation", []]);
});

test("on the game port a hosted miner's can that does not come in three seconds leaves the custody unsettled by name; a look once the park has it settles it, with nothing waited for", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world, { gamePort: true });
  const { bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 1031);
  [world.jettison, world.arrivesAt] = ["unseen", null];
  reset();
  await assert.rejects(api.jettisonItems([1031], bots[7001].options, invocation(1)), custodyError("JETTISON_OUTCOME_UNCONFIRMED", false, "ambiguous"));
  assert.deepEqual([slept.length, slept.reduce((sum, ms) => sum + ms, 0), new Set(slept).size, world.sent.length], [12, 3000, 1, 1]);
  // A look while it has still not come waits for it again, and no longer than that.
  reset();
  await assert.rejects(api.reconcileHostedJettison(bots[7001].options), custodyError("JETTISON_OUTCOME_UNCONFIRMED", false, "ambiguous"));
  assert.equal(slept.length, 12);
  // The park has it: a look finds it at once.
  world.unseen.clear();
  reset();
  const settled = await api.reconcileHostedJettison(bots[7001].options);
  assert.deepEqual([settled.state, settled.containerID, slept, world.sent], ["confirmed-created", 9001, [], []]);
});

test("on the game port a hosted miner's jettison that never happened is not waited for at any look: its ore is in the hold still", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world, { gamePort: true });
  const { bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 1041);
  world.jettison = "never";
  reset();
  await assert.rejects(api.jettisonItems([1041], bots[7001].options, invocation(1)), custodyError("TEST_ANSWER_LOST", false, "ambiguous"));
  await assert.rejects(api.reconcileHostedJettison(bots[7001].options), custodyError("JETTISON_OUTCOME_UNCONFIRMED", false, "ambiguous"));
  assert.deepEqual(slept, []);
});

test("through the gateway a hosted miner's custody is not made to wait: a can the scene has not got leaves it unsettled at once", { timeout: 20000 }, async () => {
  const world = space();
  const { api, jetcanCrew, slept, reset } = await crew(world);
  const { bots } = await jetcanCrew({ oreCustody: true });
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001].options), true);
  world.stack(7001, 1051);
  world.jettison = "unseen";
  reset();
  await assert.rejects(api.jettisonItems([1051], bots[7001].options, invocation(1)), custodyError("JETTISON_OUTCOME_UNCONFIRMED", false, "ambiguous"));
  assert.deepEqual([slept, world.asked.filter((each) => each === "scene").length], [[], 2]);
});
