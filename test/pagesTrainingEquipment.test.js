"use strict";

// Three of the page's routes that no test of the BFF's asked, by the game-port audit's own list of 2026-10-12:
//
//   POST /api/pilot-training/equipment/review
//   POST /api/pilot-training/equipment/apply
//   POST /api/pilot-training/equipment/recover
//
// They are the Pilot Training page's "Provision Equipment": a plan for one of a pilot's training configurations,
// the plan applied (the BFF takes the pilot for a moment, looks at its ship, makes it the accepted fitting's and
// lets it go), and the control an Apply left unproven looked at again. The three are one loop in src/server.js over
// src/trainingEquipment.js, which is a consumer of the Ship Provisioning Center's Apply and of the training's own
// qualification read. Each of those has its tests, with the other stood in for; the page's askers answer
// themselves in theirs. So each route is asked here BY THE PAGE'S OWN ASKER (web/src/app/api.ts) of the BFF's own
// route, with the Center, the qualification read and the custody engine the BFF's own, and the server stood in for.
//
// The data folder is a temporary one, set before the server is loaded.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-training-equipment-"));
process.env.EVEJS_WEB_POC_DATA_DIR = DATA;

const { createApp } = require("../src/server");

const realFetch = globalThis.fetch;
const activeServers = new Set();
/** What a test holds open, let go of whatever the test found. */
const letGo = new Set();

const object = (fields) => ({ type: "object", args: { type: "dict", entries: Object.entries(fields) } });
const list = (items) => ({ type: "list", items });
const refused = (status, code) => (error) => error.status === status && error.code === code;

const SKILL = 3386;
const TYPES = {
  1: { typeID: 1, categoryID: 6, groupID: 25, name: "Test frigate" }, // the fitting's hull: it wants the skill at 3
  2: { typeID: 2, categoryID: 7, groupID: 54, name: "Test module" },
  [SKILL]: { typeID: SKILL, categoryID: 16, name: "Test skill" },
};
const staticData = {
  getType: (id) => TYPES[id] || null,
  getTypeName: (id) => `Type ${id}`,
  getSkillType: (id) => (id === SKILL ? { typeID: id, name: "Test skill" } : null),
  getTypeDogma: (id) => (TYPES[id] ? { attributes: id === 1 ? { 182: SKILL, 277: 3 } : {} } : null),
  getStation: () => ({ stationName: "Test station" }),
};

const ACCOUNTS = {
  owner: { username: "owner", accountID: 7, role: "0", banned: false },
  other: { username: "other", accountID: 8, role: "0", banned: false },
};
const PILOTS = [
  { accountID: 7, characterID: 11, characterName: "Test01", corporationID: 20 },
  { accountID: 8, characterID: 21, characterName: "Mate01", corporationID: 40 },
];
const tokenOf = (account) => `token-of-${account.username}`;

/**
 * The server the BFF asks: pilot 11 offline, its one skill at the level the hull wants, in a ship that is already
 * its corporation's saved fitting's, so that an Apply takes it, finds nothing to do and lets it go.
 * `world.skillLevel` and `world.savedDate` change what the pilot has trained and when the fitting was saved;
 * `world.fitted` is whether the ship has the fitting's module; `world.stuck` leaves the pilot online after its release.
 * `world.saved`, where a test sets it, says what the library answers at its n-th asking (`world.libraryAsked`) instead.
 */
function trainingWorld() {
  const world = { online: false, stuck: false, skillLevel: 3, savedDate: "100", fitted: true, saved: null, libraryAsked: 0, selections: [], releases: [], sheets: [] };
  const row = (itemID, typeID, locationID, flagID, singleton) => ({ type: "packedrow", fields: { itemID, typeID, ownerID: 11, locationID, flagID, singleton, quantity: 1 } });
  world.store = {
    async getAccount(username) { return ACCOUNTS[username] ? { ...ACCOUNTS[username] } : null; },
    async listCharactersForAccount(accountID) { return PILOTS.filter((pilot) => pilot.accountID === accountID).map((pilot) => ({ ...pilot })); },
    async getCharacterForAccount(accountID, characterID) { return PILOTS.find((pilot) => pilot.accountID === accountID && pilot.characterID === characterID) || null; },
  };
  world.gateway = {
    async getSkills(accountID, characterID) {
      world.sheets.push([accountID, characterID]);
      return { characterName: "Test01", serverNowMs: 1_800_000_000_000, skills: [{ typeID: SKILL, level: world.skillLevel, skillPoints: 8000 }],
        queue: { active: false, entries: [] } };
    },
    async getCharacterStatus(accountID, characterID) { return { characterID, online: world.online, controlState: world.online ? "retail_client" : "offline" }; },
    async selectCharacter(args) {
      world.selections.push(args);
      world.online = true;
      return { bridgeSessionID: "training-handle", session: { characterID: args[0], corporationID: 20, stationID: 60, shipID: 50 } };
    },
    async releaseBridgeSession(handle) { world.releases.push(handle); if (!world.stuck) world.online = false; return { released: true, characterID: 11 }; },
    async readFlightStatus() { return { flight: { shipID: 50, shipTypeID: 1, docked: true, stationID: 60 }, notifications: [] }; },
    async callMethod(service, method, args, kwargs, fields, handle) {
      assert.deepEqual([service, method], ["corpFittingMgr", "GetFittings"]);
      const corporationID = handle ? args[0] : fields.corpid;
      world.libraryAsked += 1;
      const now = { savedDate: world.savedDate, items: [[2, 27, 1]], ...(world.saved ? world.saved(world.libraryAsked) : null) };
      return { result: { type: "dict", entries: [[4, object({ fittingID: 4, ownerID: corporationID, shipTypeID: 1, name: "Exact frigate",
        savedDate: { type: "long", value: now.savedDate }, fitData: list(now.items.map((items) => ({ type: "tuple", items }))) })]] } };
    },
    async bindObject(service, method, args) { return { boundHandle: args[0], notifications: [] }; },
    async callBoundMethod(service, method, args, kwargs, fields, handle, bound) {
      if (method === "ListByFlags") return { result: list(world.fitted ? [row(90, 2, 50, 27, 1)] : []) };
      assert.equal(method, "List");
      return { result: list(bound === 60 ? [row(50, 1, 60, 4, 1)] : []) };
    },
  };
  return world;
}

/** The page's own request with a session's token: what it asked, with what, and what it was answered are kept. */
function asking(baseUrl, token) {
  const paths = [];
  const bodies = [];
  const answers = [];
  const options = {
    baseUrl,
    token,
    fetch: async (input, init) => {
      paths.push(`${(init && init.method) || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "")}`);
      bodies.push(init && init.body ? JSON.parse(init.body) : null);
      const response = await realFetch(input, init);
      answers.push(await response.clone().json().catch(() => null));
      return response;
    },
  };
  return { options, paths, bodies, answers };
}

/** The BFF over that server, the page's askers, and (where a test holds an Apply open) the state it is held at. */
async function training(world, { holdAt = null } = {}) {
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
    provisioningCenterFault: async (state) => { if (state === holdAt) { reached(); await gate; } },
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = await import("../web/src/app/api.ts");
  const client = await import("../web/src/provisioning/centerClient.ts");
  // The Center's own askers use the tab's own fetch, with a path that has no origin: sent on to the BFF.
  globalThis.fetch = (input, init = {}) => realFetch(`${baseUrl}${input}`, init);
  return { app, api, client, baseUrl, arrived, open, page: asking(baseUrl, tokenOf(ACCOUNTS.owner)), others: asking(baseUrl, tokenOf(ACCOUNTS.other)) };
}

/**
 * What the Pilot Training page has when Provision Equipment is pressed: the corporation fitting it accepted as a
 * pilot's configuration, read from the page's own qualification read, and the plan's request made of it.
 */
async function accepted(api, options) {
  const read = await api.loadQualification(11, "HAULER", [], options, null);
  const fit = read.fittings[0];
  const config = { configurationID: "frigate", roleID: "HAULER", order: 0, corporationOwnerID: read.corporationID, fittingID: fit.fittingID,
    hullTypeID: fit.shipTypeID, acceptedSavedDate: fit.savedDate, acceptedFingerprint: fit.fingerprint };
  return { config, request: { characterID: 11, role: "HAULER", configurationID: "frigate", configurations: [config], targetStage: "frigate", source: { kind: "hangar" } } };
}
/** The page's read of the pilot again, as it makes one after an Apply or a recover: the configuration's stage. */
const stageOf = async (api, options, config) => (await api.loadQualification(11, "HAULER", [config], options, "frigate")).report.stages[0];
/** Waits for an Apply to be held where it was told to be; one that ends first fails the test, and is not waited for. */
const held = (arrived, applying) => Promise.race([arrived,
  applying.then((early) => { throw new Error(`the Apply ended before it was held: ${JSON.stringify(early)}`); })]);

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

test("an equipment plan: the page posts the pilot, its role, its configurations, the one to equip, the target and the source, and reads the plan to confirm, the Center's preflight and the qualification read afresh, with nobody selected", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { app, api, page } = await training(world);
  const { request } = await accepted(api, page.options);
  page.paths.length = 0;
  page.bodies.length = 0;
  const review = await api.reviewTrainingEquipment(request, page.options);
  assert.deepEqual([page.paths, page.bodies], [["POST /api/pilot-training/equipment/review"], [request]]);

  assert.equal(review.configurationID, "frigate");
  // The plan to confirm: what the page's button goes by, and what it sends back.
  const plan = review.applyReview;
  assert.deepEqual([plan.canApply, plan.reasons, plan.suppliesPolicy, plan.plan.mode, plan.plan.targetHullName, plan.plan.hullQuantity],
    [true, [], "NEW_HULL_ONLY", "PENDING_SELECTED_REVIEW", "Exact frigate", null]);
  assert.match(plan.reviewHash, /^[a-f0-9]{64}$/);
  assert.equal(typeof plan.reviewID, "string");
  // The Center's preflight: the pilot free, the definition the configuration accepted, the source asked for.
  assert.deepEqual([review.detail.pilot.characterID, review.detail.pilot.control.owner, review.detail.pilot.control.online, review.detail.pendingApply],
    [11, "OFF", false, []]);
  assert.deepEqual([review.detail.selected.name, review.detail.selected.shipTypeID, review.detail.selected.definition.fittingID,
    review.detail.selected.definition.savedDate, review.detail.selected.definition.fingerprint, review.detail.selected.definition.characterID],
  ["Exact frigate", 1, 4, request.configurations[0].acceptedSavedDate, request.configurations[0].acceptedFingerprint, 11]);
  assert.deepEqual([review.detail.candidateSource.kind, review.detail.candidateSource.take], ["hangar", "UNKNOWN"]);
  // The qualification read afresh: trained for the hull, and nothing known of what the pilot's ship has.
  const stage = review.fresh.report.stages[0];
  assert.deepEqual([review.fresh.report.pilot.characterID, review.fresh.corporationID, stage.id, stage.fitting.status, stage.skillQualification],
    [11, 20, "frigate", "READY", "READY"]);
  assert.deepEqual([stage.equipmentReadiness, stage.equipmentReason, stage.dutyReadiness, stage.equipment.control.owner],
    ["UNKNOWN", "Authoritative equipment observation is incomplete.", "NOT_READY", "OFF"]);
  // Nobody was selected, and nothing of the pilot's is held.
  assert.deepEqual([world.selections, app.locals.bridgeSessions.size], [[], 0]);

  // Of a source the page sends, its own fields alone are taken.
  const padded = await api.reviewTrainingEquipment({ ...request, source: { kind: "hangar", itemID: 5 } }, page.options);
  assert.deepEqual([padded.detail.candidateSource.kind, Object.hasOwn(padded.detail.candidateSource, "itemID"), padded.applyReview.reviewHash],
    ["hangar", false, plan.reviewHash]);
  // The corporation's hangar division as the source, where the page names one: the plan is of that source.
  const fromCorp = await api.reviewTrainingEquipment({ ...request, source: { kind: "corp", corporationID: 20, division: 2 } }, page.options);
  assert.deepEqual([fromCorp.detail.candidateSource.kind, fromCorp.detail.candidateSource.corporationID, fromCorp.detail.candidateSource.division, fromCorp.applyReview.canApply],
    ["corp", 20, 2, true]);
  assert.notEqual(fromCorp.applyReview.reviewHash, plan.reviewHash);
});

test("an equipment plan is refused by name: skills not trained, a fitting changed since it was accepted, a configuration that is none of the pilot's or not of the role, a source that is none, a pilot that is not the account's and no token; a pilot that is online is planned for and not to be confirmed", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { api, page, others, baseUrl } = await training(world);
  const { request } = await accepted(api, page.options);
  const config = request.configurations[0];

  world.skillLevel = 2;
  await assert.rejects(api.reviewTrainingEquipment(request, page.options), refused(409, "SKILLS_NOT_READY"));
  assert.equal(page.answers.at(-1).message, "Training hard skill requirements must be trained before Provision Equipment.");
  world.skillLevel = 3;
  // The corporation saved the fitting again after the page accepted it.
  world.savedDate = "101";
  await assert.rejects(api.reviewTrainingEquipment(request, page.options), refused(409, "REVIEW_STALE"));
  world.savedDate = "100";
  // Saved again between the plan's two reads of the library (the qualification's, and the Center's after it): the
  // second read is not of the fitting the page accepted, by its date or by what is in it.
  for (const change of [{ savedDate: "101" }, { items: [[2, 27, 1], [2, 28, 1]] }]) {
    const from = world.libraryAsked;
    world.saved = (asking) => (asking === from + 2 ? change : null);
    await assert.rejects(api.reviewTrainingEquipment(request, page.options), refused(409, "REVIEW_STALE"));
    assert.equal(page.answers.at(-1).message, "Accept the current Training fitting definition before equipment Review.");
    assert.equal(world.libraryAsked, from + 2);
    world.saved = null;
  }
  // The configuration to equip is not among those sent; and one sent is of another role.
  await assert.rejects(api.reviewTrainingEquipment({ ...request, configurationID: "another" }, page.options), refused(409, "INVALID_TRAINING_CONFIGURATION"));
  await assert.rejects(api.reviewTrainingEquipment({ ...request, configurations: [{ ...config, roleID: "MINER" }] }, page.options), refused(400, "INVALID_TRAINING_CONFIGURATION"));
  // A source that is neither the pilot's hangar nor a division of its own corporation's.
  await assert.rejects(api.reviewTrainingEquipment({ ...request, source: { kind: "container", itemID: 5 } }, page.options), refused(409, "SOURCE_UNSUPPORTED"));
  await assert.rejects(api.reviewTrainingEquipment({ ...request, source: { kind: "corp", corporationID: 20, division: 8 } }, page.options), refused(409, "SOURCE_UNSUPPORTED"));
  await assert.rejects(api.reviewTrainingEquipment({ ...request, source: { kind: "corp", corporationID: 99, division: 1 } }, page.options), refused(409, "SOURCE_UNSUPPORTED"));
  // Another account's pilot; another account asking for this one's; and nobody.
  await assert.rejects(api.reviewTrainingEquipment({ ...request, characterID: 21 }, page.options), refused(404, "CHARACTER_NOT_FOUND"));
  await assert.rejects(api.reviewTrainingEquipment(request, others.options), refused(404, "CHARACTER_NOT_FOUND"));
  await assert.rejects(api.reviewTrainingEquipment(request, asking(baseUrl, null).options), refused(401, "AUTH_REQUIRED"));

  // A pilot somebody is flying: the plan is read, and says why it cannot be confirmed.
  world.online = true;
  const flown = await api.reviewTrainingEquipment(request, page.options);
  assert.deepEqual([flown.applyReview.canApply, flown.applyReview.reasons, flown.detail.pilot.control.owner],
    [false, ["Pilot must be offline and free of known owners."], "OTHER_SESSION"]);
  await assert.rejects(api.applyTrainingEquipment(flown.applyReview.reviewID, flown.applyReview.reviewHash, page.options), refused(409, "REVIEW_REQUIRED"));
  assert.deepEqual(world.selections, []);
});

test("the plan applied: the page posts the plan's id and hash with its confirmation and reads the outcome; the pilot is taken once and let go, and the page's next read of the pilot has its equipment verified and its duty ready", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { app, api, page } = await training(world);
  const { config, request } = await accepted(api, page.options);
  const before = await stageOf(api, page.options, config);
  assert.deepEqual([before.equipmentReadiness, before.dutyReadiness], ["UNKNOWN", "NOT_READY"]);
  const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;

  page.paths.length = 0;
  page.bodies.length = 0;
  const outcome = await api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options);
  assert.deepEqual([page.paths, page.bodies], [["POST /api/pilot-training/equipment/apply"], [{ reviewID: plan.reviewID, reviewHash: plan.reviewHash, confirm: true }]]);
  // What the page says of it: the state, the reason, the release, and the equipment as it was last seen.
  assert.deepEqual([outcome.operationID, outcome.state, outcome.reason, outcome.release.state, outcome.control.state, outcome.control.characterID,
    outcome.finalReview.status.equipment, outcome.finalReview.status.supplies],
  [plan.reviewID, "ALREADY_SATISFIED", null, "VERIFIED_OFFLINE", "MAINTENANCE", 11, "VERIFIED", "FULL"]);
  // The pilot was taken once, as a client takes a character, and let go by the handle it was taken with.
  assert.deepEqual([world.selections, world.releases, world.online, app.locals.bridgeSessions.size], [[[11, null, true]], ["training-handle"], false, 0]);

  // The page reads the pilot again after it: what the Apply saw of the ship stands for the equipment, for a while.
  const after = await stageOf(api, page.options, config);
  assert.deepEqual([after.equipmentReadiness, after.equipmentReason, after.dutyReadiness, after.equipment.shipID, after.equipment.quality, after.equipment.observedAt],
    ["VERIFIED", "Verified by the completed selected maintenance operation.", "READY", 50, "COMPLETE", outcome.finalObservedAt]);
  // Asked again with the same plan, the outcome is the one there is, and the pilot is not taken again.
  assert.deepEqual(await api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options), outcome);
  assert.equal(world.selections.length, 1);
});

test("the plan applied to a ship that is not the fitting's, with no hull to make one of: refused by name, the pilot let go, and nothing certified, not even what an Apply before it had verified", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { api, page } = await training(world);
  const { config, request } = await accepted(api, page.options);
  // An Apply that verified the ship, first: the page's read has its equipment verified.
  const first = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
  assert.equal((await api.applyTrainingEquipment(first.reviewID, first.reviewHash, page.options)).state, "ALREADY_SATISFIED");
  assert.equal((await stageOf(api, page.options, config)).equipmentReadiness, "VERIFIED");
  const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
  // The ship has not the fitting's module, which no preflight can see: it is the Apply that finds out.
  world.fitted = false;
  const outcome = await api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options);
  assert.deepEqual([outcome.state, outcome.reason, outcome.release.state, outcome.selectedReview.status.equipment, outcome.finalReview],
    ["REFUSED", "PROVISIONING_PLAN_BLOCKED", "VERIFIED_OFFLINE", "MODIFIED", null]);
  assert.deepEqual([world.selections.length, world.releases.length, world.online], [2, 2, false]);
  const after = await stageOf(api, page.options, config);
  assert.deepEqual([after.equipmentReadiness, after.dutyReadiness], ["UNKNOWN", "NOT_READY"]);
});

for (const [boundary, revalidated] of [["REVALIDATING", null], ["PROVISIONING", "VERIFIED_SELECTED"]]) {
  test(`skills lost while an Apply holds the pilot, at its ${boundary}: the training is read again there, the Apply refuses by name and lets the pilot go`, { timeout: 20000 }, async () => {
    const world = trainingWorld();
    const { api, page, arrived, open } = await training(world, { holdAt: boundary });
    const { request } = await accepted(api, page.options);
    const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
    const applying = api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options);
    await held(arrived, applying);
    world.skillLevel = 2;
    open();
    const outcome = await applying;
    assert.deepEqual([outcome.state, outcome.reason, outcome.release.state, outcome.revalidation && outcome.revalidation.state, outcome.provisioning],
      ["REFUSED", "SKILLS_NOT_READY", "VERIFIED_OFFLINE", revalidated, null]);
    assert.deepEqual([world.selections.length, world.releases, world.online], [1, ["training-handle"], false]);
  });
}

test("the plan applied after the pilot's skills have changed: the Apply takes the pilot, reads its training again before anything is done, refuses by name and lets it go", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { api, page } = await training(world);
  const { config, request } = await accepted(api, page.options);
  const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
  world.skillLevel = 2;
  const outcome = await api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options);
  assert.deepEqual([outcome.state, outcome.reason, outcome.release.state, outcome.provisioning], ["REFUSED", "SKILLS_NOT_READY", "VERIFIED_OFFLINE", null]);
  assert.deepEqual([world.selections.length, world.releases, world.online], [1, ["training-handle"], false]);
  world.skillLevel = 3;
  const after = await stageOf(api, page.options, config);
  assert.deepEqual([after.equipmentReadiness, after.dutyReadiness], ["UNKNOWN", "NOT_READY"]);
});

test("an Apply is the plan's own: a plan that is none, a hash that is not its own, another account's token, and the Center's plan for the Training's Apply or the Training's for the Center's, are each refused, and nobody is taken", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { api, client, page, others, baseUrl } = await training(world);
  const { request } = await accepted(api, page.options);
  const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
  await assert.rejects(api.applyTrainingEquipment("no-such-plan", plan.reviewHash, page.options), refused(409, "REVIEW_REQUIRED"));
  await assert.rejects(api.applyTrainingEquipment(plan.reviewID, "0".repeat(64), page.options), refused(409, "REVIEW_REQUIRED"));
  await assert.rejects(api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, others.options), refused(409, "REVIEW_REQUIRED"));
  await assert.rejects(api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, asking(baseUrl, null).options), refused(401, "AUTH_REQUIRED"));
  // The Ship Provisioning Center's own Apply does not take a plan made for the Training, nor the Training's one of
  // the Center's: each is the consumer's that made it.
  const token = tokenOf(ACCOUNTS.owner);
  await assert.rejects(client.centerApply(token, plan.reviewID, plan.reviewHash), /^Error: REVIEW_REQUIRED$/);
  const centers = (await client.centerReview(token, { characterID: 11, providerCharacterID: 11, fittingID: 4, sourceKind: "hangar", corporationID: 20, division: 1 })).applyReview;
  assert.equal(centers.canApply, true);
  await assert.rejects(api.applyTrainingEquipment(centers.reviewID, centers.reviewHash, page.options), refused(409, "REVIEW_REQUIRED"));
  assert.deepEqual(world.selections, []);
  // And the plan is good still for the one it was made for.
  assert.equal((await api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options)).state, "ALREADY_SATISFIED");
  // Once applied it is in the BFF's journal, and the Center's Apply is not answered its outcome either.
  await assert.rejects(client.centerApply(token, plan.reviewID, plan.reviewHash), /^Error: REVIEW_REQUIRED$/);
  assert.equal(world.selections.length, 1);
});

test("while an Apply runs, the web session that asked for it is the Apply's: its sign-out is refused until the Apply has ended", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { api, page, others, arrived, open } = await training(world, { holdAt: "READING" });
  const { request } = await accepted(api, page.options);
  const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
  const applying = api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options);
  await held(arrived, applying);
  await assert.rejects(api.logout(page.options), refused(409, "CHARACTER_IN_USE"));
  // Another account's session is nothing of this Apply's.
  await api.logout(others.options);
  open();
  assert.equal((await applying).state, "ALREADY_SATISFIED");
  await api.logout(page.options);
});

test("an Apply that could not see its pilot let go: the page posts the outcome's own operation to recover, the BFF asks for the release again and looks, and ends the Apply once the server has the pilot offline; what is recovered certifies nothing", { timeout: 20000 }, async () => {
  const world = trainingWorld();
  const { api, page, others, baseUrl } = await training(world);
  const { config, request } = await accepted(api, page.options);
  const plan = (await api.reviewTrainingEquipment(request, page.options)).applyReview;
  world.stuck = true;
  const outcome = await api.applyTrainingEquipment(plan.reviewID, plan.reviewHash, page.options);
  // The page offers "Reconcile control release" for an outcome that is UNCERTAIN or BLOCKED, by its operation.
  assert.deepEqual([outcome.operationID, outcome.state, outcome.reason, outcome.release.state], [plan.reviewID, "UNCERTAIN", "CONTROL_RELEASE_UNPROVEN", "SESSION_RELEASED_OFFLINE_UNPROVEN"]);
  // Until it is recovered no plan of the pilot's is to be confirmed.
  const meanwhile = await api.reviewTrainingEquipment(request, page.options);
  assert.equal(meanwhile.applyReview.canApply, false);
  assert.deepEqual(meanwhile.detail.pendingApply.map((each) => [each.operationID, each.state]), [[plan.reviewID, "UNCERTAIN"]]);

  page.paths.length = 0;
  page.bodies.length = 0;
  const still = await api.recoverTrainingEquipment(outcome.operationID, page.options);
  assert.deepEqual([page.paths, page.bodies], [["POST /api/pilot-training/equipment/recover"], [{ operationID: plan.reviewID }]]);
  assert.deepEqual([still.operationID, still.state, still.release.state], [plan.reviewID, "UNCERTAIN", "SESSION_RELEASED_OFFLINE_UNPROVEN"]);
  assert.deepEqual(world.releases, ["training-handle", "training-handle"]);
  // It is the account's own: another's token, an operation the BFF has not, and nobody are each refused.
  await assert.rejects(api.recoverTrainingEquipment(outcome.operationID, others.options), refused(409, "OPERATION_NOT_OWNED"));
  await assert.rejects(api.recoverTrainingEquipment("no-such-operation", page.options), refused(409, "OPERATION_NOT_OWNED"));
  await assert.rejects(api.recoverTrainingEquipment(outcome.operationID, asking(baseUrl, null).options), refused(401, "AUTH_REQUIRED"));
  assert.equal(world.releases.length, 2);

  world.online = false;
  const ended = await api.recoverTrainingEquipment(outcome.operationID, page.options);
  assert.deepEqual([ended.state, ended.release.state, ended.finalReview.status.equipment], ["ALREADY_SATISFIED", "VERIFIED_OFFLINE", "VERIFIED"]);
  // The pilot was taken once in all. And what an Apply saw before its release was proven is not kept as proof of
  // the pilot's equipment: the page's next read of the pilot knows nothing of it, and a plan may be confirmed again.
  assert.equal(world.selections.length, 1);
  const after = await stageOf(api, page.options, config);
  assert.deepEqual([after.equipmentReadiness, after.dutyReadiness], ["UNKNOWN", "NOT_READY"]);
  assert.equal((await api.reviewTrainingEquipment(request, page.options)).applyReview.canApply, true);
});
