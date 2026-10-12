"use strict";

// Seven of the page's routes that no test of the BFF's asked, by the game-port audit's own list of 2026-10-12:
// a Mining Operation's target as its hosted bots work it, and the Mining window's delete.
//
//   GET  /api/mining-operations/assignment/current      POST /api/mining-operations/member/ready
//   POST /api/mining-operations/target/reserve          POST /api/mining-operations/member/drain-complete
//   POST /api/mining-operations/target/activate         POST /api/mining-operations/:operationID/delete
//   POST /api/mining-operations/target/depleted
//
// None makes a call of the game's. The first six are a hosted bot's alone: each wants the bot's own web session
// with its pilot held, and the bot host's private header on the request, and answers from the BFF's own keeping
// of the operation and of the target board. What can go wrong between the bot's page and the BFF is the wire
// itself, and neither side's own tests would see it. So each is asked here BY THE PAGE'S OWN ASKER
// (web/src/app/api.ts) of the BFF's own route, with the request a hosted bot makes: its token, and its claim.
//
// The operation, the target board and the belt memory are the BFF's own, on a clock the test holds. The bot host
// is stood in for (as test/miningOperationsRoutes.test.js stands one in): which pilot a bot runs, by what
// secret, and for which operation. An operation is begun as the start route begins one, and not through it:
// the launch is that file's to test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-mining-targets-"));
process.env.EVEJS_WEB_POC_DATA_DIR = dataDir;

const { createApp } = require("../src/server");
const { BOT_HEADER } = require("../src/botHost");
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
];
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
  { scriptID: "lone-miner", name: "Operation miner", rev: 1, doc: { format: "evejs-bot-script", program: [
    { id: "mine", kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } } },
    { id: "deliver", kind: "macro", macro: "deliver-ore", args: {} },
  ] } },
];
const START = 1_800_000_000_000;
const LEASE_MS = 30_000;
const realFetch = globalThis.fetch;
const activeServers = new Set();

const belt = (targetName, more = {}) => ({ targetType: "BELT", systemID: JITA, systemName: "Jita", targetName, ...more });
const keyOf = (targetName) => `BELT:${JITA}:${targetName}`;
const member = (pilot, role, automationID) => ({ ...pilot, accountName: ACCOUNT.username, role, automationID });

/**
 * The BFF on a server, with the operations it keeps on a clock the test holds, a bot host stood in for, and the
 * page's own askers. `bot(pilot)` are a hosted bot's request options for that pilot; `tab` a tab's with no pilot.
 */
async function crew() {
  const clock = { at: START };
  const now = () => clock.at;
  const store = createMiningOperationStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-mining-targets-store-")),
    resolveSystem: (id) => SYSTEMS[Number(id)] || null, resolveStation: () => null });
  const board = createMiningTargetBoard({ now });
  const beltMemory = createBeltMemory({ now });
  const operations = createMiningOperations({ store, targetBoard: board, beltMemory, now });
  const held = new Map();
  /** characterID -> the bot that runs it: its secret, and the operation it is of, if any. */
  const claims = new Map();
  const errors = [];
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
    eveGatewayClient: {},
    webAuth: {
      createSessionToken() { return "token-tab"; },
      // A token names its own web session: a hosted bot has one of its own for its pilot.
      verifySessionToken(token) {
        return /^token-(\d+|tab)$/.test(String(token)) ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: `session-${String(token).slice(6)}` } : null;
      },
      countConfiguredUsers() { return 1; },
    },
    botHost: {
      async start() { return { ok: false, code: "NOT_IN_THIS_TEST" }; },
      async stop() { return { ok: false, code: "BOT_NOT_FOUND" }; },
      async activateOperationMember() { return { ok: false, code: "BOT_NOT_FOUND" }; },
      async extendOperationGrant() { return { ok: false }; },
      async prepareOperationStop() { return { ok: false }; },
      async parkOperationMember() { return { ok: false }; },
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
    errorLogger(error) { errors.push(error); },
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = await import("../web/src/app/api.ts");
  const paths = [];
  const answers = [];
  // The page's own request with a session's token, and a hosted bot's claim on it where there is one: what was
  // asked and what was answered are kept, and it is sent on.
  const asking = (token, secret) => ({
    baseUrl,
    token,
    fetch: async (input, init = {}) => {
      paths.push(`${init.method || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "")}`);
      const headers = new Headers(init.headers);
      if (secret) headers.set(BOT_HEADER, secret);
      const response = await realFetch(input, { ...init, headers });
      answers.push(await response.clone().json().catch(() => null));
      return response;
    },
  });
  /** A pilot online in a web session of its own, in Jita: a hosted bot's where it is given a secret. */
  const online = (pilot, secret = null) => held.set(`session-${pilot.characterID}`, { characterID: pilot.characterID, accountID: ACCOUNT.accountID,
    bridgeSessionID: `held-${pilot.characterID}`, solarSystemID: JITA, ...(secret ? { botClaimSecret: secret } : {}) });
  const tab = asking("token-tab", null);
  /**
   * An operation saved by the page's own asker, and begun as the start route begins one: each member's bot
   * hosted, with a secret of its own, its pilot online in its own session. Answers the operation's id and each
   * member's request options, by characterID.
   */
  async function begun(name, unloadPolicy, members, runID) {
    const saved = await api.saveMiningOperation({ name,
      area: { anchorSystemID: JITA, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
      targetPolicy: "ANY_ELIGIBLE", unloadPolicy, members }, tab);
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
    answers.length = 0;
    return { operationID, bots };
  }
  return { api, clock, operations, board, beltMemory, store, held, claims, errors, paths, answers, asking, online, tab, begun };
}

/** A jetcan crew: two miners and a hauler, the hauler's service the unload. */
const jetcanCrew = (fixture) => fixture.begun("Jetcan crew", "HAULER_SERVICE",
  [member(PILOTS[0], "MINER", "crew-miner"), member(PILOTS[1], "MINER", "crew-miner"), member(PILOTS[2], "HAULER", "crew-hauler")], "run-1");

const refusedAs = (status, code) => (error) => error.status === status && error.code === code;

test.afterEach(async () => {
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    server.closeAllConnections();
    closing.push(new Promise((resolve) => { server.close(() => resolve()); }));
  }
  await Promise.all(closing);
});

test("a hosted bot's assignment: the page asks with the bot's own claim, and reads what the operation has for that pilot", async () => {
  const fixture = await crew();
  const { api, operations, paths, errors } = fixture;
  const { operationID, bots } = await jetcanCrew(fixture);
  const area = operations.definition(operationID).area;
  const common = { operationID, operationRunID: "run-1", operationName: "Jetcan crew", unloadPolicy: "HAULER_SERVICE", travelAssist: "DISABLED",
    resourcePolicy: null, area, state: "SELECTING", stopRequested: false, currentTarget: null, logisticsTarget: null, ownedContainerIDs: [],
    miningOwnerIDs: [7001, 7002], containerProvenanceUnconfirmed: false, rendezvous: null };

  assert.deepEqual(await api.readMiningOperationAssignment(bots[7001]), { ...common, role: "MINER" });
  assert.deepEqual(await api.readMiningOperationAssignment(bots[7003]), { ...common, role: "HAULER" });
  assert.deepEqual(area, { anchorSystemID: JITA, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] });
  assert.deepEqual(paths, ["GET /api/mining-operations/assignment/current", "GET /api/mining-operations/assignment/current"]);
  assert.deepEqual(errors, []);
});

test("a hosted bot's assignment: a bot of no operation reads none; a request with no claim, another's claim or no pilot online is refused", async () => {
  const fixture = await crew();
  const { api, claims, online, asking, tab } = fixture;
  const { bots } = await jetcanCrew(fixture);
  // An ordinary hosted script: a bot's claim, and no operation it is of.
  claims.set(7004, { secret: "secret-7004", operationID: null });
  online(PILOTS[3], "secret-7004");
  assert.equal(await api.readMiningOperationAssignment(asking("token-7004", "secret-7004")), null);
  // The pilot's own session with no claim on the request (a cockpit beside the bot), and with another bot's.
  await assert.rejects(api.readMiningOperationAssignment(asking("token-7001", null)), refusedAs(409, "BOT_CLAIM_REQUIRED"));
  await assert.rejects(api.readMiningOperationAssignment(asking("token-7001", "secret-7002-run-1")), refusedAs(409, "HOSTED_GENERATION_CHANGED"));
  // A tab with no pilot online.
  await assert.rejects(api.readMiningOperationAssignment(tab), refusedAs(409, "NO_LIVE_SESSION"));
  // And the bot's own is read still.
  assert.equal((await api.readMiningOperationAssignment(bots[7001])).role, "MINER");
});

test("a target reserved: the page posts what the miner sees and reads whether it was acquired; the operation has it from then, and its other miner is answered with the same", async () => {
  const fixture = await crew();
  const { api, clock, board, paths, answers, errors } = fixture;
  const { operationID, bots } = await jetcanCrew(fixture);

  // As the bot's flow sends one belt: the candidate itself, with nothing listed beside it.
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt II", { siteIdentity: undefined, siteID: undefined, instanceID: undefined, position: undefined, candidates: undefined }), bots[7001]), true);
  const reserved = { targetKey: keyOf("Belt II"), targetType: "BELT", systemID: JITA, systemName: "Jita", targetName: "Belt II", state: "RESERVED",
    claimedByOperationID: operationID, claimedAt: START, lastHeartbeat: START, leaseExpiresAt: START + LEASE_MS, depletionEvidence: null, depletedAt: null };
  assert.deepEqual(answers[0], { ok: true, acquired: true, reason: null, target: reserved });
  assert.deepEqual(board.get(keyOf("Belt II")), reserved);
  const mine = await api.readMiningOperationAssignment(bots[7001]);
  assert.deepEqual([mine.state, mine.currentTarget], ["TRAVELING", reserved]);

  // The other miner, later, whatever it sees: the operation's target is the one, and its lease is renewed.
  clock.at += 10_000;
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7002]), true);
  assert.deepEqual(answers[2].target, { ...reserved, lastHeartbeat: START + 10_000, leaseExpiresAt: START + 10_000 + LEASE_MS });
  assert.equal(board.get(keyOf("Belt I")), null);
  // The hauler reserves nothing.
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt III"), bots[7003]), false);
  assert.deepEqual(answers[3], { ok: true, acquired: false, reason: "NO_AVAILABLE_ELIGIBLE_TARGET", target: null });
  assert.equal(board.get(keyOf("Belt III")), null);

  assert.deepEqual(paths, ["POST /api/mining-operations/target/reserve", "GET /api/mining-operations/assignment/current",
    "POST /api/mining-operations/target/reserve", "POST /api/mining-operations/target/reserve"]);
  assert.deepEqual(errors, []);
});

test("a target reserved from a list: the belts listed are what is chosen among, the first by name where nobody's place is known; one of another system than the pilot's is refused whole", async () => {
  const fixture = await crew();
  const { api, board, answers } = fixture;
  const { operationID, bots } = await jetcanCrew(fixture);

  // The candidate at the top is not one of the list: the list is what the route goes by.
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt IX", { candidates: [belt("Belt B"), belt("Belt A")] }), bots[7001]), true);
  assert.equal(answers[0].target.targetKey, keyOf("Belt A"));
  assert.deepEqual([board.get(keyOf("Belt A")).claimedByOperationID, board.get(keyOf("Belt B")), board.get(keyOf("Belt IX"))], [operationID, null, null]);

  // What a miner says of a system its session is not in is no observation of its own: nothing is reserved.
  const lone = await fixture.begun("Alone", "SELF_UNLOAD", [member(PILOTS[3], "MINER", "lone-miner")], "run-2");
  await assert.rejects(api.reserveMiningOperationTarget(belt("Belt C", { systemID: 30004504, systemName: "4C-B7X" }), lone.bots[7004]),
    refusedAs(409, "SITE_SYSTEM_AUTHORITY_MISMATCH"));
  await assert.rejects(api.reserveMiningOperationTarget(belt("Belt C", { candidates: [belt("Belt C"), belt("Belt D", { systemID: 30004504 })] }), lone.bots[7004]),
    refusedAs(409, "SITE_SYSTEM_AUTHORITY_MISMATCH"));
  assert.equal(board.get(keyOf("Belt C")), null);
  // Another operation's belt is not acquired, and a free one is.
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt A"), lone.bots[7004]), false);
  assert.equal(board.get(keyOf("Belt A")).claimedByOperationID, operationID);
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt IX", { candidates: [belt("Belt A"), belt("Belt B")] }), lone.bots[7004]), true);
  assert.equal(board.get(keyOf("Belt B")).claimedByOperationID, lone.operationID);
});

test("a target reserved looks first at which of the operation's bots are hosted still: a member whose bot is gone is found so, and the operation told", async () => {
  const fixture = await crew();
  const { api, claims, operations } = fixture;
  const { operationID, bots } = await jetcanCrew(fixture);
  // The second miner's bot is the host's no more. Nothing of the operation has heard of it yet.
  claims.delete(7002);
  assert.equal(operations.runtimeFor(operationID).members.get(7002).runtimeState, "RUNNING");
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001]), true);
  const gone = operations.runtimeFor(operationID).members.get(7002);
  assert.deepEqual([gone.runtimeState, gone.reason], ["FAILED", "The hosted automation is no longer running."]);
  assert.equal((await api.readMiningOperationAssignment(bots[7001])).state, "DEGRADED");
});

test("a target worked: made active, found empty, the miners clear of it, and the hauler done with it, each by the page's own asker", async () => {
  const fixture = await crew();
  const { api, clock, operations, board, beltMemory, paths, answers, errors } = fixture;
  const { operationID, bots } = await jetcanCrew(fixture);
  const key = keyOf("Belt I");
  await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001]);
  paths.length = 0;
  answers.length = 0;

  // Active: the miner's, by the target's own key. Another key, and the hauler's asking, change nothing.
  assert.equal(await api.activateMiningOperationTarget(keyOf("Belt II"), bots[7001]), undefined);
  assert.equal(await api.activateMiningOperationTarget(key, bots[7003]), undefined);
  assert.equal(board.get(key).state, "RESERVED");
  assert.equal(await api.activateMiningOperationTarget(key, bots[7001]), undefined);
  assert.deepEqual(answers.splice(0), [{ ok: true, applied: false }, { ok: true, applied: false }, { ok: true, applied: true }]);
  assert.equal(board.get(key).state, "ACTIVE");
  assert.equal((await api.readMiningOperationAssignment(bots[7002])).state, "MINING");

  // Found empty: the first miner's word, with what it saw. The hauler is working, so the target drains, and the
  // miners are held until each is clear of it.
  clock.at += 5_000;
  assert.equal(await api.depleteMiningOperationTarget(keyOf("Belt II"), { partialDumpConfirmed: true }, bots[7001]), undefined);
  assert.equal(board.get(key).state, "ACTIVE");
  assert.equal(await api.depleteMiningOperationTarget(key, { partialDumpConfirmed: true, rocksLeft: 0 }, bots[7001]), undefined);
  assert.deepEqual(answers.splice(0).slice(1, 3), [{ ok: true, applied: false }, { ok: true, applied: true }]);
  const drained = board.get(key);
  assert.deepEqual([drained.state, drained.claimedByOperationID, drained.depletedAt, drained.depletionEvidence],
    ["DRAINING", operationID, START + 5_000, { source: "belt-memory", reportedByCharacterID: 7001, partialDumpConfirmed: true, rocksLeft: 0 }]);
  assert.deepEqual(beltMemory.dryBelts("Jita").map((row) => [row.beltName, row.all]), [["Belt I", true]]);
  const second = await api.readMiningOperationAssignment(bots[7002]);
  assert.deepEqual([second.state, second.currentTarget.targetKey, second.rendezvous],
    ["DRAINING", key, { kind: "MINER_CLEARANCE", required: [7001, 7002], ready: [7001], thisMemberReady: false }]);
  assert.equal((await api.readMiningOperationAssignment(bots[7001])).rendezvous.thisMemberReady, true);

  // Ready: the hauler's asking is nobody's; the second miner's lets the miners go on, with no target.
  answers.length = 0;
  assert.equal(await api.markMiningOperationMemberReady(bots[7003]), undefined);
  assert.notEqual((await api.readMiningOperationAssignment(bots[7002])).rendezvous, null);
  assert.equal(await api.markMiningOperationMemberReady(bots[7002]), undefined);
  assert.deepEqual([answers[0], answers[2]], [{ ok: true, applied: false }, { ok: true, applied: true }]);
  const after = await api.readMiningOperationAssignment(bots[7002]);
  assert.deepEqual([after.state, after.currentTarget, after.rendezvous, after.logisticsTarget], ["RELOCATING", null, null, null]);

  // The hauler has the drained target for its own still, and says when it is done with it: once.
  const hauling = await api.readMiningOperationAssignment(bots[7003]);
  assert.deepEqual([hauling.currentTarget, hauling.logisticsTarget.targetKey, hauling.logisticsTarget.state], [null, key, "DRAINING"]);
  answers.length = 0;
  assert.equal(await api.finishMiningOperationDrain(key, bots[7001]), undefined);
  assert.equal(await api.finishMiningOperationDrain(keyOf("Belt II"), bots[7003]), undefined);
  assert.equal(board.get(key).state, "DRAINING");
  assert.equal(await api.finishMiningOperationDrain(key, bots[7003]), undefined);
  assert.equal(await api.finishMiningOperationDrain(key, bots[7003]), undefined);
  assert.deepEqual(answers, [{ ok: true, applied: false }, { ok: true, applied: false }, { ok: true, applied: true }, { ok: true, applied: false }]);
  assert.deepEqual([board.get(key).state, board.get(key).claimedByOperationID], ["DEPLETED", null]);
  assert.equal((await api.readMiningOperationAssignment(bots[7003])).logisticsTarget, null);
  assert.deepEqual(operations.runtimeFor(operationID).history.map((row) => row.kind),
    ["TARGET_RESERVED", "TARGET_SELECTION", "TARGET_ACTIVE", "TARGET_DEPLETED", "RENDEZVOUS_RELEASED", "LOGISTICS_TAIL_COMPLETED", "HAULER_DRAIN_COMPLETED"]);

  // The belt found empty is not reserved again, and another is.
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt I"), bots[7002]), false);
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt II"), bots[7002]), true);

  assert.equal(paths.filter((asked) => asked.startsWith("POST")).join(" | "), [
    "target/activate", "target/activate", "target/activate", "target/depleted", "target/depleted", "member/ready", "member/ready",
    "member/drain-complete", "member/drain-complete", "member/drain-complete", "member/drain-complete", "target/reserve", "target/reserve",
  ].map((route) => `POST /api/mining-operations/${route}`).join(" | "));
  assert.deepEqual(errors, []);
});

test("a target whose claim ran out: the miner's next word of it is not applied, and the operation is told it lost its target", async () => {
  const fixture = await crew();
  const { api, clock, board, answers } = fixture;
  const lone = await fixture.begun("Alone", "SELF_UNLOAD", [member(PILOTS[3], "MINER", "lone-miner")], "run-2");
  await api.reserveMiningOperationTarget(belt("Belt I"), lone.bots[7004]);
  // Nobody of the operation asks anything for longer than a claim is kept.
  clock.at += LEASE_MS;
  answers.length = 0;
  await api.activateMiningOperationTarget(keyOf("Belt I"), lone.bots[7004]);
  assert.deepEqual(answers, [{ ok: true, applied: false }]);
  assert.deepEqual([board.get(keyOf("Belt I")).state, board.get(keyOf("Belt I")).claimedByOperationID], ["AVAILABLE", null]);
  const lost = await api.readMiningOperationAssignment(lone.bots[7004]);
  assert.deepEqual([lost.state, lost.currentTarget], ["DEGRADED", null]);
  // A miner unloading for itself: found empty, it is held until it says it is ready.
  assert.equal(await api.reserveMiningOperationTarget(belt("Belt II"), lone.bots[7004]), true);
  await api.activateMiningOperationTarget(keyOf("Belt II"), lone.bots[7004]);
  await api.depleteMiningOperationTarget(keyOf("Belt II"), {}, lone.bots[7004]);
  assert.deepEqual((await api.readMiningOperationAssignment(lone.bots[7004])).rendezvous, { kind: "SELF_UNLOAD", required: [7004], ready: [], thisMemberReady: false });
  assert.deepEqual([board.get(keyOf("Belt II")).state, board.get(keyOf("Belt II")).claimedByOperationID], ["DEPLETED", null]);
  await api.markMiningOperationMemberReady(lone.bots[7004]);
  assert.equal((await api.readMiningOperationAssignment(lone.bots[7004])).rendezvous, null);
});

test("a target's five writes are a hosted bot's of an operation alone: a cockpit's, a plain bot's, another bot's claim and no pilot online are each refused, and nothing is changed", async () => {
  const fixture = await crew();
  const { api, claims, online, asking, tab, board, operations } = fixture;
  const { operationID, bots } = await jetcanCrew(fixture);
  await api.reserveMiningOperationTarget(belt("Belt I"), bots[7001]);
  const key = keyOf("Belt I");
  const writes = (options) => [
    () => api.reserveMiningOperationTarget(belt("Belt II"), options),
    () => api.activateMiningOperationTarget(key, options),
    () => api.depleteMiningOperationTarget(key, { partialDumpConfirmed: true }, options),
    () => api.markMiningOperationMemberReady(options),
    () => api.finishMiningOperationDrain(key, options),
  ];
  // A pilot online in a tab, with no bot: no claim to ask by.
  online(PILOTS[3]);
  for (const write of writes(asking("token-7004", null))) await assert.rejects(write(), refusedAs(409, "MINING_OPERATION_CLAIM_REQUIRED"));
  // The same pilot run by a bot of no operation.
  claims.set(7004, { secret: "secret-7004", operationID: null });
  online(PILOTS[3], "secret-7004");
  for (const write of writes(asking("token-7004", "secret-7004"))) await assert.rejects(write(), refusedAs(409, "MINING_OPERATION_CLAIM_REQUIRED"));
  // A miner's own session with no claim on the request, and with the other miner's.
  for (const write of writes(asking("token-7001", null))) await assert.rejects(write(), refusedAs(409, "HOSTED_GENERATION_CHANGED"));
  for (const write of writes(asking("token-7001", "secret-7002-run-1"))) await assert.rejects(write(), refusedAs(409, "HOSTED_GENERATION_CHANGED"));
  // No pilot online.
  for (const write of writes(tab)) await assert.rejects(write(), refusedAs(409, "NO_LIVE_SESSION"));

  assert.deepEqual([board.get(key).state, board.get(keyOf("Belt II"))], ["RESERVED", null]);
  assert.deepEqual(operations.runtimeFor(operationID).history.map((row) => row.kind), ["TARGET_RESERVED", "TARGET_SELECTION"]);
});

test("an operation deleted: the Mining window posts to the operation's own path and reads what is left; one that is running is refused, and one that is not there is not found", async () => {
  const fixture = await crew();
  const { api, tab, store, paths, answers } = fixture;
  const running = await jetcanCrew(fixture);
  const saved = await api.saveMiningOperation({ name: "Draft",
    area: { anchorSystemID: JITA, anchorSystemName: "Jita", reach: "CURRENT_SYSTEM", targetClasses: ["BELT"] },
    targetPolicy: "ANY_ELIGIBLE", unloadPolicy: "SELF_UNLOAD", members: [member(PILOTS[3], "MINER", "lone-miner")] }, tab);
  const draft = saved.operations.find((row) => row.definition.name === "Draft").definition.operationID;
  await api.reserveMiningOperationTarget(belt("Belt I"), running.bots[7001]);
  paths.length = 0;
  answers.length = 0;

  const left = await api.deleteMiningOperation(draft, tab);
  assert.deepEqual(left.operations.map((row) => [row.definition.name, row.runtime.state]), [["Jetcan crew", "TRAVELING"]]);
  assert.deepEqual(left.targetBoard.map((row) => [row.targetKey, row.claimedByOperationID]), [[keyOf("Belt I"), running.operationID]]);
  assert.deepEqual(left.capabilities, answers[0].capabilities);
  assert.equal(left.capabilities.targetClasses.BELT.executable, true);
  assert.equal(store.get(draft), null);
  assert.deepEqual(paths, [`POST /api/mining-operations/${draft}/delete`]);

  // Running: it is to be stopped first, and is there still.
  await assert.rejects(api.deleteMiningOperation(running.operationID, tab),
    (error) => error.status === 409 && error.message === "Stop the operation before deleting it.");
  assert.equal(store.get(running.operationID).name, "Jetcan crew");
  // Gone already, and never there: not found, and the id is made safe for a path.
  await assert.rejects(api.deleteMiningOperation(draft, tab), (error) => error.status === 404);
  await assert.rejects(api.deleteMiningOperation("no such/one", tab), (error) => error.status === 404);
  assert.equal(paths[3], "POST /api/mining-operations/no%20such%2Fone/delete");
  assert.deepEqual(answers.slice(1), [{ ok: false, code: "MINING_OPERATION_ACTIVE", message: "Stop the operation before deleting it." }, { ok: false }, { ok: false }]);
});
