"use strict";

// Four of the page's routes that no test of the BFF's asked, by the game-port audit's own list of 2026-10-12:
// a Mining Operation's support pilot, and what its operation does when the support is lost.
//
//   GET  /api/mining-operations/support-context     POST /api/mining-operations/support-stop
//   POST /api/mining-operations/support-status      POST /api/bots/mining-support-anchors/release
//
// The first three are a hosted bot's of an operation alone (its own web session with its pilot held, and the bot
// host's private header on the request); the release is any held pilot's. Two reach beyond the BFF's own
// keeping: the context reads the operation's fleets through the bot host, and an emergency stop reads the
// pilot's own scene through the pilot's transport. What can go wrong between the bot's page and the BFF is the
// wire itself, and neither side's own tests would see it. So each is asked here BY THE PAGE'S OWN ASKER
// (web/src/app/api.ts) of the BFF's own route, with the request a hosted bot makes.
//
// The operation, its policy for a lost support, the anchors' board and the stopping of an operation are the
// BFF's own, on a clock the test holds. The bot host and the pilot's transport are stood in for: which pilot a
// bot runs and for which operation, what fleets the host has read, and what scene a pilot's session answers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-mining-support-"));
process.env.EVEJS_WEB_POC_DATA_DIR = dataDir;

const { createApp } = require("../src/server");
const { BOT_HEADER } = require("../src/botHost");
const { createBeltMemory } = require("../src/beltMemory");
const { createMiningOperationStore } = require("../src/miningOperationStore");
const { createMiningTargetBoard } = require("../src/miningTargetBoard");
const { createMiningOperations } = require("../src/miningOperations");
const { createMiningSupportAnchorBoard } = require("../src/miningSupportAnchorBoard");

const ACCOUNT = { username: "miner-account", accountID: 4001, role: "0", banned: false };
const JITA = 30000142;
const FLEET = "654500019999";
const PILOTS = [
  { characterID: 7001, accountID: 4001, characterName: "Miner One" },
  { characterID: 7002, accountID: 4001, characterName: "Miner Two" },
  { characterID: 7005, accountID: 4001, characterName: "Command One" },
  { characterID: 7004, accountID: 4001, characterName: "Miner Alone" },
];
const [MINER_ONE, MINER_TWO, COMMAND, ALONE] = PILOTS;
const SYSTEMS = { [JITA]: { solarSystemID: JITA, solarSystemName: "Jita" } };
const SCRIPTS = [{ scriptID: "lone-miner", name: "Operation miner", rev: 1, doc: { format: "evejs-bot-script", program: [
  { id: "mine", kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
  { id: "deliver", kind: "macro", macro: "deliver-ore", args: {} },
] } }];
const START = 1_800_000_000_000;
const realFetch = globalThis.fetch;
const activeServers = new Set();

const keyVal = (entries) => ({ type: "object", args: { type: "dict", entries } });
const shipOf = (characterID) => 500000 + characterID;
const member = (pilot, role, automationID) => ({ ...pilot, accountName: ACCOUNT.username, role, automationID });
/** A pilot's own scene: its own ship in Jita, sound unless told otherwise. */
const scene = (characterID, ship = {}, more = {}) => ({ inSpace: true, shipID: shipOf(characterID), solarSystemID: JITA, sampledAtMs: 400,
  ship: { itemID: shipOf(characterID), characterID, radius: 100, position: { x: 0, y: 0, z: 0 }, shieldRatio: 0.9, armorRatio: 1, hullRatio: 1,
    miningBurstServices: { activeModuleIDs: [42], bursts: [{ moduleID: 42, typeID: 99, rangeMeters: 90_000 }] },
    compressionService: { state: "active", typeListRanges: [{ typeListID: 10, rangeMeters: 60_000 }], compressors: [{ moduleID: 43, typeID: 100 }] }, ...ship },
  entities: [], ...more });
const refusedAs = (status, code) => (error) => error.status === status && error.code === code;

/**
 * The BFF on a server, with the operations it keeps on a clock the test holds, a bot host and a pilot's transport
 * stood in for, and the page's own askers. `begun` answers a hosted bot's request options for each member.
 */
async function fleet() {
  const clock = { at: START };
  const now = () => clock.at;
  const store = createMiningOperationStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-mining-support-store-")),
    resolveSystem: (id) => SYSTEMS[Number(id)] || null, resolveStation: () => null });
  const board = createMiningTargetBoard({ now });
  const operations = createMiningOperations({ store, targetBoard: board, beltMemory: createBeltMemory({ now }), now });
  const held = new Map();
  const claims = new Map();
  const errors = [];
  const asked = [];
  const stops = [];
  /** What the host has read of the operation's fleets, a pilot's scene by its session, and something to do amid a read. */
  const host = { fleets: [], amid: () => {} };
  const scenes = new Map();
  const transport = { amid: () => {} };
  const sameClaim = (characterID, secret) => claims.has(Number(characterID)) && claims.get(Number(characterID)).secret === secret;
  const rows = () => [...claims].map(([characterID, claim]) => ({
    botID: `bot-${characterID}`, accountID: ACCOUNT.accountID, characterID, characterName: PILOTS.find((pilot) => pilot.characterID === characterID).characterName,
    operationID: claim.operationID, operationRole: claim.operationRole, operationRunID: claim.operationRunID,
    status: "running", phase: "Working", why: null, startedAt: "2026-09-24T00:00:00.000Z", endedAt: null,
  }));
  const app = createApp({
    eveStore: {
      getAccount: async (username) => (username === ACCOUNT.username ? { ...ACCOUNT } : null),
      getCharacterForAccount: async (accountID, characterID) => PILOTS.find((row) => row.characterID === Number(characterID)) || null,
      listCharactersForAccount: async () => PILOTS.map((row) => ({ ...row })),
    },
    // The pilot's transport: its fleet as its session is told it (every pilot online here is of the one fleet),
    // and its own scene.
    eveGatewayClient: {
      async bindObject(service, method, args, kwargs, fields, bridgeSessionID) { return { boundHandle: bridgeSessionID }; },
      async callBoundMethod() {
        return { result: keyVal([["fleetID", { type: "long", value: FLEET }],
          ["members", { type: "dict", entries: [...held.values()].map((row) => [row.characterID, keyVal([["charID", row.characterID], ["solarSystemID", JITA]])]) }]]) };
      },
      async readSpaceSnapshot(bridgeSessionID, session) {
        asked.push(["scene", bridgeSessionID, session]);
        await transport.amid();
        return { space: scenes.get(bridgeSessionID) };
      },
    },
    webAuth: {
      createSessionToken() { return "token-tab"; },
      verifySessionToken(token) {
        return /^token-(\d+|tab)$/.test(String(token)) ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: `session-${String(token).slice(6)}` } : null;
      },
      countConfiguredUsers() { return 1; },
    },
    botHost: {
      async start() { return { ok: false, code: "NOT_IN_THIS_TEST" }; },
      // A bot stopped is the host's no more.
      async stop(botID, accountID) {
        stops.push([botID, accountID]);
        return { ok: claims.delete(Number(String(botID).slice(4))), bot: { botID } };
      },
      async activateOperationMember() { return { ok: false, code: "BOT_NOT_FOUND" }; },
      async extendOperationGrant() { return { ok: false }; },
      async prepareOperationStop() { return { ok: false }; },
      async parkOperationMember() { return { ok: false }; },
      async readOperationFleets(operationID) {
        asked.push(["fleets", operationID]);
        await host.amid();
        return host.fleets;
      },
      listAll: rows,
      list: rows,
      claimedBy: (characterID) => (claims.has(Number(characterID)) ? `bot-${characterID}` : null),
      authorizesClaim: sameClaim,
      operationForClaim: (characterID, secret) => {
        const claim = sameClaim(characterID, secret) ? claims.get(Number(characterID)) : null;
        return claim && claim.operationID ? { operationID: claim.operationID, operationRole: claim.operationRole, operationRunID: claim.operationRunID } : null;
      },
      activeCharacterIDs: () => [],
      activeBots: () => [],
      sampleAllVitals: async () => {},
      resume: async () => {},
      stopAll: async () => {},
    },
    bridgeSessionStore: held,
    botScriptStore: { get: (scriptID) => SCRIPTS.find((row) => row.scriptID === scriptID) || null, list: () => SCRIPTS },
    staticData: {
      listMiningResources: () => [],
      getStation: () => null,
      getSolarSystem: (id) => SYSTEMS[Number(id)] || null,
      getSolarSystemName: (id) => (SYSTEMS[Number(id)] || {}).solarSystemName || `System ${id}`,
    },
    miningOperationStore: store,
    miningTargetBoard: board,
    miningOperations: operations,
    miningSupportAnchorBoard: createMiningSupportAnchorBoard({ now }),
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
  // The page's own request with a session's token, and a hosted bot's claim on it where there is one: what was
  // asked, what was sent and what was answered are kept, and it is sent on.
  const asking = (token, secret) => ({
    baseUrl,
    token,
    fetch: async (input, init = {}) => {
      paths.push(`${init.method || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "")}`);
      bodies.push(init.body === undefined ? null : JSON.parse(init.body));
      const headers = new Headers(init.headers);
      if (secret) headers.set(BOT_HEADER, secret);
      const response = await realFetch(input, { ...init, headers });
      answers.push([response.status, await response.clone().json().catch(() => null)]);
      return response;
    },
  });
  /** A pilot online in a web session of its own, in its own ship in Jita: a hosted bot's where it is given a secret. */
  const online = (pilot, secret = null) => {
    held.set(`session-${pilot.characterID}`, { characterID: pilot.characterID, accountID: ACCOUNT.accountID, bridgeSessionID: `held-${pilot.characterID}`,
      solarSystemID: JITA, activeShipID: shipOf(pilot.characterID), fleetID: null, boundHandles: new Map(), transition: null, streamSubscribers: new Set(),
      ...(secret ? { botClaimSecret: secret } : {}) });
    scenes.set(`held-${pilot.characterID}`, scene(pilot.characterID));
  };
  const tab = asking("token-tab", null);
  /** An operation saved by the page's own asker, and begun as the start route begins one: each member's bot hosted. */
  async function begun(name, members, runID, more = {}) {
    const saved = await api.saveMiningOperation({ name,
      area: { anchorSystemID: JITA, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
      targetPolicy: "ANY_ELIGIBLE", unloadPolicy: "SELF_UNLOAD", members, ...more }, tab);
    const { operationID } = saved.operations.find((row) => row.definition.name === name).definition;
    assert.equal(operations.begin(operationID, ["BELT"], runID).ok, true);
    const bots = {};
    for (const each of members) {
      const secret = `secret-${each.characterID}-${runID}`;
      claims.set(each.characterID, { secret, operationID, operationRole: each.role, operationRunID: runID });
      online(each, secret);
      assert.equal(operations.memberStarted(operationID, each.characterID, `bot-${each.characterID}`), true);
      bots[each.characterID] = asking(`token-${each.characterID}`, secret);
    }
    operations.finishLaunch(operationID);
    paths.length = 0;
    bodies.length = 0;
    answers.length = 0;
    asked.length = 0;
    return { operationID, bots };
  }
  return { api, clock, operations, held, claims, errors, asked, stops, host, scenes, transport, paths, bodies, answers, asking, online, tab, begun };
}

/** Two miners and a support pilot, the operation told what to do when its support is lost. */
const supported = (fixture, supportLoss = "STOP") => fixture.begun("Supported",
  [member(MINER_ONE, "MINER", "lone-miner"), member(MINER_TWO, "MINER", "lone-miner"), { ...COMMAND, accountName: ACCOUNT.username, role: "COMMAND", routineMode: "STANDARD" }],
  "run-1", { support: { version: 1, characterID: COMMAND.characterID, supportLoss } });
const SUPPORT = { version: 1, characterID: 7005, fleetPolicy: "EXISTING_ONLY", maintainBursts: true, useIndustrialCore: false, coreRequirement: "continueWithoutCore",
  enableCompression: false, selfMining: false, tractor: false, collection: "TRACTOR_ONLY", compressCollectedOre: false, supportLoss: "STOP" };
const READY = { state: "READY", core: "active", reason: null, collection: null };

/** Waits, a little at a time, for something the BFF does after it has answered. */
async function until(what) {
  for (let turn = 0; turn < 200; turn += 1) {
    if (what()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
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

test("the support pilot's context: the page asks with the bot's claim, and reads its assignment and the operation's fleets as the bot host has them", async () => {
  const fixture = await fleet();
  const { api, host, asked, paths, errors } = fixture;
  const { operationID, bots } = await supported(fixture);
  host.fleets = [{ characterID: 7001, fleetID: FLEET, observedAtMs: START }, { characterID: 7005, fleetID: FLEET, observedAtMs: START }];

  const context = await api.readMiningOperationSupportContext(bots[7005]);
  assert.deepEqual(context.fleets, host.fleets);
  assert.deepEqual([context.assignment.operationID, context.assignment.role, context.assignment.support, context.assignment.intendedFleetCharacterIDs],
    [operationID, "COMMAND", SUPPORT, [7001, 7002, 7005]]);
  // Nothing has been heard of the support yet: the operation waits for it, from now.
  assert.deepEqual(context.assignment.supportPolicy, { mode: "PAUSE", reason: "RECOVERY: support-observation-unavailable", lostSinceMs: START });
  // A miner of the same operation is answered the same fleets, with its own assignment.
  assert.deepEqual([(await api.readMiningOperationSupportContext(bots[7001])).assignment.role, (await api.readMiningOperationSupportContext(bots[7001])).fleets], ["MINER", host.fleets]);
  assert.deepEqual(paths, ["GET /api/mining-operations/support-context", "GET /api/mining-operations/support-context", "GET /api/mining-operations/support-context"]);
  assert.deepEqual(asked, [["fleets", operationID], ["fleets", operationID], ["fleets", operationID]]);
  assert.deepEqual(errors, []);
});

test("the support pilot's context: an operation with no support has no fleets read; the claim is looked at again after the read; what the host cannot answer is unreadable to the page", async () => {
  const fixture = await fleet();
  const { api, host, claims, asked, online, asking, tab } = fixture;
  const plain = await fixture.begun("Plain", [member(ALONE, "MINER", "lone-miner")], "run-2");
  const context = await api.readMiningOperationSupportContext(plain.bots[7004]);
  assert.deepEqual([context.assignment.role, context.assignment.support, context.fleets], ["MINER", undefined, []]);
  assert.deepEqual(asked, []);

  const { operationID, bots } = await supported(fixture);
  // While the host reads the fleets, the bot is given to another operation: what was read is not the answer.
  host.amid = () => { claims.get(7005).operationID = plain.operationID; };
  await assert.rejects(api.readMiningOperationSupportContext(bots[7005]), refusedAs(409, "OPERATION_CLAIM_CHANGED"));
  claims.get(7005).operationID = operationID;
  // And is the host's no more.
  const claim = claims.get(7005);
  host.amid = () => { claims.delete(7005); };
  await assert.rejects(api.readMiningOperationSupportContext(bots[7005]), refusedAs(409, "HOSTED_GENERATION_CHANGED"));
  claims.set(7005, claim);
  host.amid = () => {};
  // The host answers no list.
  host.fleets = null;
  await assert.rejects(api.readMiningOperationSupportContext(bots[7005]), /Operation fleet observations are unreadable\./);
  host.fleets = [];
  assert.deepEqual((await api.readMiningOperationSupportContext(bots[7005])).fleets, []);
  // A pilot online in a tab with no bot, and no pilot online.
  online(ALONE);
  claims.delete(7004);
  await assert.rejects(api.readMiningOperationSupportContext(asking("token-7004", null)), refusedAs(409, "MINING_OPERATION_CLAIM_REQUIRED"));
  await assert.rejects(api.readMiningOperationSupportContext(tab), refusedAs(409, "NO_LIVE_SESSION"));
});

test("the support pilot's word: the page posts its state, its core, the reason and the collection, and the operation's policy for every member turns on it", async () => {
  const fixture = await fleet();
  const { api, clock, operations, bodies, paths, errors } = fixture;
  const { operationID, bots } = await supported(fixture);
  const policy = async () => (await api.readMiningOperationAssignment(bots[7001])).supportPolicy;

  assert.equal(await api.reportMiningOperationSupport({ ...READY, collection: "TRACTOR_ONLY" }, bots[7005]), undefined);
  assert.deepEqual([paths[0], bodies[0]], ["POST /api/mining-operations/support-status", { state: "READY", core: "active", reason: null, collection: "TRACTOR_ONLY" }]);
  assert.deepEqual(operations.runtimeFor(operationID).supportStatus, { state: "READY", core: "active", collection: "TRACTOR_ONLY", reason: null, observedAtMs: START });
  assert.deepEqual(await policy(), { mode: "NORMAL", reason: null, lostSinceMs: null });
  // Degraded is support still, and its reason is passed on.
  await api.reportMiningOperationSupport({ state: "DEGRADED", core: "inactive", reason: "one burst missing", collection: null }, bots[7005]);
  assert.deepEqual(await policy(), { mode: "NORMAL", reason: "one burst missing", lostSinceMs: null });

  // A word ten seconds old is none: the operation waits, and after thirty seconds lost does what it was told.
  clock.at += 10_000;
  assert.deepEqual(await policy(), { mode: "PAUSE", reason: "RECOVERY: support-observation-unavailable", lostSinceMs: START + 10_000 });
  clock.at += 29_999;
  assert.equal((await policy()).mode, "PAUSE");
  clock.at += 1;
  assert.deepEqual(await policy(), { mode: "STOP", reason: "support-observation-unavailable", lostSinceMs: START + 10_000 });
  // A new word that the support is blocked is a reason, and no support.
  await api.reportMiningOperationSupport({ state: "BLOCKED", core: "unknown", reason: "no fleet", collection: null }, bots[7005]);
  assert.deepEqual(await policy(), { mode: "STOP", reason: "no fleet", lostSinceMs: START + 10_000 });
  // And one that it is ready is support again.
  await api.reportMiningOperationSupport(READY, bots[7005]);
  assert.deepEqual(await policy(), { mode: "NORMAL", reason: null, lostSinceMs: null });

  // A reason and a collection are kept short.
  await api.reportMiningOperationSupport({ state: "RECOVERY", core: "active", reason: "r".repeat(300), collection: "c".repeat(60) }, bots[7005]);
  const kept = operations.runtimeFor(operationID).supportStatus;
  assert.deepEqual([kept.reason.length, kept.collection.length], [240, 40]);
  // Each change of the state or of the reason is the operation's history; the same word again is not.
  assert.deepEqual(operations.runtimeFor(operationID).history.map((row) => [row.kind, row.evidence.state]),
    [["SUPPORT_STATE", "READY"], ["SUPPORT_STATE", "DEGRADED"], ["SUPPORT_STATE", "BLOCKED"], ["SUPPORT_STATE", "READY"], ["SUPPORT_STATE", "RECOVERY"]]);
  await api.reportMiningOperationSupport({ state: "RECOVERY", core: "active", reason: "r".repeat(300), collection: null }, bots[7005]);
  assert.equal(operations.runtimeFor(operationID).history.length, 5);
  assert.deepEqual(errors, []);
});

test("the support pilot's word is the support pilot's alone, and of the states and cores there are: any other is refused, and nothing is kept of it", async () => {
  const fixture = await fleet();
  const { api, operations, answers, online, asking } = fixture;
  const { operationID, bots } = await supported(fixture);
  await api.reportMiningOperationSupport(READY, bots[7005]);
  const kept = operations.runtimeFor(operationID).supportStatus;

  // A miner of the operation; a state and a core that are none.
  await assert.rejects(api.reportMiningOperationSupport({ ...READY, state: "BLOCKED" }, bots[7001]), refusedAs(409, "SUPPORT_REPORT_REFUSED"));
  await assert.rejects(api.reportMiningOperationSupport({ ...READY, state: "FINE" }, bots[7005]), refusedAs(409, "SUPPORT_REPORT_REFUSED"));
  await assert.rejects(api.reportMiningOperationSupport({ ...READY, core: "on" }, bots[7005]), refusedAs(409, "SUPPORT_REPORT_REFUSED"));
  assert.deepEqual(answers.at(-1), [409, { ok: false, error: "SUPPORT_REPORT_REFUSED" }]);
  assert.deepEqual(operations.runtimeFor(operationID).supportStatus, kept);
  // An operation with no support has nobody to say it; and a pilot in a tab with no bot is nobody's.
  const plain = await fixture.begun("Plain", [member(ALONE, "MINER", "lone-miner")], "run-2");
  await assert.rejects(api.reportMiningOperationSupport(READY, plain.bots[7004]), refusedAs(409, "SUPPORT_REPORT_REFUSED"));
  fixture.claims.delete(7004);
  online(ALONE);
  await assert.rejects(api.reportMiningOperationSupport(READY, asking("token-7004", null)), refusedAs(409, "MINING_OPERATION_CLAIM_REQUIRED"));
});

test("an operation stopped for its support: any of its bots may ask, and only while the operation's own policy says stop", async () => {
  const fixture = await fleet();
  const { api, clock, operations, stops, paths, bodies, answers, errors } = fixture;
  const { operationID, bots } = await supported(fixture);
  await api.reportMiningOperationSupport(READY, bots[7005]);
  paths.length = 0;
  bodies.length = 0;

  // The support is there; then lost, and the operation waiting for it.
  await assert.rejects(api.stopMiningOperationForSupport(bots[7001]), refusedAs(409, "SUPPORT_STOP_POLICY_NOT_APPLICABLE"));
  clock.at += 10_000;
  await assert.rejects(api.stopMiningOperationForSupport(bots[7001]), refusedAs(409, "SUPPORT_STOP_POLICY_NOT_APPLICABLE"));
  assert.deepEqual([operations.runtimeFor(operationID).state, stops], ["SELECTING", []]);
  // Thirty seconds lost: the policy is to stop, and a miner's asking stops the operation.
  clock.at += 30_000;
  answers.length = 0;
  assert.equal(await api.stopMiningOperationForSupport(bots[7001]), undefined);
  assert.deepEqual(answers, [[202, { ok: true }]]);
  assert.deepEqual([paths.at(-1), bodies.at(-1)], ["POST /api/mining-operations/support-stop", {}]);
  // The route answers before the bots are stopped: each is, and the operation is stopped then.
  assert.equal(await until(() => operations.runtimeFor(operationID).state === "STOPPED"), true);
  assert.deepEqual(stops.map(([botID]) => botID).sort(), ["bot-7001", "bot-7002", "bot-7005"]);
  assert.deepEqual(errors, []);
});

test("an operation told to go on without its support, or to wait for it, is not stopped for it", async () => {
  for (const [supportLoss, mode] of [["CONTINUE_UNSUPPORTED", "FALLBACK"], ["PAUSE", "PAUSE"]]) {
    const fixture = await fleet();
    const { api, clock, operations, stops } = fixture;
    const { operationID, bots } = await supported(fixture, supportLoss);
    // The first reading is when the support is first found wanting; forty seconds on it is lost.
    await api.readMiningOperationAssignment(bots[7001]);
    clock.at += 40_000;
    assert.equal((await api.readMiningOperationAssignment(bots[7001])).supportPolicy.mode, mode, supportLoss);
    await assert.rejects(api.stopMiningOperationForSupport(bots[7001]), refusedAs(409, "SUPPORT_STOP_POLICY_NOT_APPLICABLE"), supportLoss);
    assert.deepEqual([operations.runtimeFor(operationID).state, stops], ["SELECTING", []], supportLoss);
  }
});

test("an emergency stop is the support pilot's alone, and only by a new reading of its own ship that finds it under a quarter of something", async () => {
  const fixture = await fleet();
  const { api, operations, scenes, asked, stops, paths, bodies, answers, errors } = fixture;
  const { operationID, bots } = await supported(fixture);
  const emergency = (options) => api.stopMiningOperationForSupport(options, "emergency-health-floor");

  // A miner's: not its to ask, and nothing is read for it.
  await assert.rejects(emergency(bots[7001]), refusedAs(409, "SUPPORT_EMERGENCY_NOT_APPLICABLE"));
  assert.deepEqual(asked, []);
  // The support pilot's, its ship sound: its own scene is read, by its own session, and it is not confirmed.
  await assert.rejects(emergency(bots[7005]), refusedAs(409, "SUPPORT_EMERGENCY_UNCONFIRMED"));
  assert.deepEqual(asked, [["scene", "held-7005", { userid: 4001 }]]);
  assert.deepEqual([paths.at(-1), bodies.at(-1)], ["POST /api/mining-operations/support-stop", { reason: "emergency-health-floor" }]);
  // A quarter exactly is not under it; a health not said is not known; another's ship, another system, a scene
  // with no sample and a pilot not in space are no reading of this ship.
  for (const [said, why] of [
    [scene(7005, { shieldRatio: 0.25 }), "a quarter"],
    [scene(7005, { shieldRatio: undefined, armorRatio: undefined, hullRatio: undefined }), "no health said"],
    [scene(7005, { shieldRatio: 0.1, itemID: shipOf(7001) }), "another's ship"],
    [scene(7005, { shieldRatio: 0.1, characterID: 7001 }), "another's pilot"],
    [scene(7005, { shieldRatio: 0.1 }, { shipID: shipOf(7001) }), "another ship's scene"],
    [scene(7005, { shieldRatio: 0.1 }, { solarSystemID: 30004504 }), "another system"],
    [scene(7005, { shieldRatio: 0.1 }, { sampledAtMs: undefined }), "no sample"],
    [scene(7005, { shieldRatio: 0.1 }, { inSpace: false }), "not in space"],
  ]) {
    scenes.set("held-7005", said);
    await assert.rejects(emergency(bots[7005]), refusedAs(409, "SUPPORT_EMERGENCY_UNCONFIRMED"), why);
  }
  assert.deepEqual([operations.runtimeFor(operationID).state, stops], ["SELECTING", []]);

  // Under a quarter of its hull, the rest sound: the operation is stopped, whatever its policy says.
  scenes.set("held-7005", scene(7005, { hullRatio: 0.2 }));
  answers.length = 0;
  assert.equal(await emergency(bots[7005]), undefined);
  assert.deepEqual(answers, [[202, { ok: true }]]);
  assert.equal(await until(() => operations.runtimeFor(operationID).state === "STOPPED"), true);
  assert.equal(stops.length, 3);
  assert.deepEqual(errors, []);
});

test("an emergency stop: a shield at nought is known and is under a quarter; the claim is looked at again after the scene is read", async () => {
  const fixture = await fleet();
  const { api, operations, scenes, claims, transport, stops } = fixture;
  const plain = await fixture.begun("Plain", [member(ALONE, "MINER", "lone-miner")], "run-2");
  const { operationID, bots } = await supported(fixture);
  const emergency = (options) => api.stopMiningOperationForSupport(options, "emergency-health-floor");
  scenes.set("held-7005", scene(7005, { shieldRatio: 0, armorRatio: undefined, hullRatio: undefined }));

  // While its scene is read, the bot is given to another operation: the reading stops nothing.
  transport.amid = () => { claims.get(7005).operationID = plain.operationID; };
  await assert.rejects(emergency(bots[7005]), refusedAs(409, "OPERATION_CLAIM_CHANGED"));
  claims.get(7005).operationID = operationID;
  transport.amid = () => {};
  assert.deepEqual([operations.runtimeFor(operationID).state, stops], ["SELECTING", []]);
  // An operation with no support has no support pilot to ask.
  await assert.rejects(emergency(plain.bots[7004]), refusedAs(409, "SUPPORT_EMERGENCY_NOT_APPLICABLE"));

  assert.equal(await emergency(bots[7005]), undefined);
  assert.equal(await until(() => operations.runtimeFor(operationID).state === "STOPPED"), true);
});

test("a support anchor released: the page posts, and the fleet's board has that pilot's anchor no more, and the others' still", async () => {
  const fixture = await fleet();
  const { api, paths, bodies, answers, tab, errors } = fixture;
  const { bots } = await supported(fixture);
  // Two of the fleet publish what their own scenes say they offer, by the page's own asker.
  await api.publishMiningSupportAnchor(shipOf(7005), 400, bots[7005], { expectedCharacterID: 7005 });
  await api.publishMiningSupportAnchor(shipOf(7001), 400, bots[7001], { expectedCharacterID: 7001 });
  assert.deepEqual((await api.readMiningSupportAnchors(bots[7002])).anchors.map((anchor) => [anchor.characterID, anchor.freshness]), [[7001, "fresh"], [7005, "fresh"]]);
  paths.length = 0;
  bodies.length = 0;
  answers.length = 0;

  assert.equal(await api.releaseMiningSupportAnchor(bots[7005]), undefined);
  assert.deepEqual([paths[0], bodies[0], answers[0]], ["POST /api/bots/mining-support-anchors/release", {}, [200, { ok: true }]]);
  assert.deepEqual((await api.readMiningSupportAnchors(bots[7002])).anchors.map((anchor) => anchor.characterID), [7001]);
  // Released again, and by one that published none: answered, and nothing more is gone.
  assert.equal(await api.releaseMiningSupportAnchor(bots[7005]), undefined);
  assert.equal(await api.releaseMiningSupportAnchor(bots[7002]), undefined);
  assert.deepEqual((await api.readMiningSupportAnchors(bots[7002])).anchors.map((anchor) => anchor.characterID), [7001]);
  // It can publish again after.
  await api.publishMiningSupportAnchor(shipOf(7005), 400, bots[7005], { expectedCharacterID: 7005 });
  assert.deepEqual((await api.readMiningSupportAnchors(bots[7002])).anchors.map((anchor) => anchor.characterID), [7001, 7005]);
  // No pilot online: nobody's anchor to release.
  await assert.rejects(api.releaseMiningSupportAnchor(tab), refusedAs(409, "NO_LIVE_SESSION"));
  assert.deepEqual(errors, []);
});
