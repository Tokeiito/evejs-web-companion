"use strict";

// The game-port transport for a selected pilot (src/gamePort/pilots.js),
// against a stand-in session. What it must match is the gateway client's
// contract: answers, the notification drain, the stream's frames, the error
// codes. test/pilotTransport.test.js covers how a call gets here at all; the
// loop log records the same functions run against the live server.

const test = require("node:test");
const assert = require("node:assert/strict");
const { GamePortPilotError, argumentsToWire, boundObjectID, createGamePortPilots } = require("../src/gamePort/pilots");
const { GAME_PORT_HANDLE_PREFIX, PILOT_FUNCTIONS } = require("../src/pilotTransport");
const { createPilotSpace } = require("../src/gamePort/pilotSpace");
const undockRecording = require("./fixtures/destinyUndock.json");
const { answers: recordedAnswers, notifications: recordedNotifications } = require("./helpers/destinyRecording");
const probeFlight = require("./fixtures/probeFlight.json");

const ACCOUNT = 4;
const PILOT = 140000001;
const STATION = 60003760;
const SYSTEM = 30000142;
const SHIP = 9988400103291;
const FIELDS = { userid: ACCOUNT, userName: "test" };

const keyVal = (entries) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: entries.map(([key, value]) => [Buffer.from(key), value]) } });
const characterRow = (overrides = {}) => keyVal(Object.entries({
  characterID: PILOT, characterName: Buffer.from("Test Pilot"), stationID: STATION, solarSystemID: SYSTEM, ...overrides,
}));
/** GetCharacterSelectionData: (userDetails, trainingDetails, characterDetails, wars), as the wire decodes it. */
const selectionData = (rows = [characterRow()]) => [{ type: "list", items: [] }, [null, null], { type: "list", items: rows }, { type: "list", items: [] }];
const shipInfo = (typeID = 588, groupID = 237) => ({ type: "dict", entries: [[SHIP, keyVal([["itemID", SHIP], ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: SHIP, typeID, groupID }, values: [] }]])]] });

/** What GetAllInfo answers with those rows for the ship's items: godma's priming. */
const godmaOf = (rows) => keyVal([["shipInfo", rows]]);

/** A bound object as the wire carries one: a substruct of a substream of (id, timestamp). */
const boundObject = (id) => ({ type: "substruct", value: { type: "substream", value: [Buffer.from(id), 134359051855730000n] } });

/** The error a GamePortSession raises, by code. */
const sessionError = (code, message = code, refusal = null) => Object.assign(new Error(message), { code, refusal });
const refusedBy = (key, reason = key) => sessionError("GAME_CALL_REFUSED", `refused: ${reason}`, { className: "eveexceptions.UserError", key, values: {}, reason });

/**
 * What a choosing asks by name of a pilot in an NPC corporation and no alliance, in order, after the three of the
 * choosing itself. The first test of a choosing spells the list out; the others hold a choosing to this.
 */
const CHOSEN_ASKS = [
  "standingMgr.GetNPCNPCStandings", "standingMgr.GetCharStandings", "skillMgr2.GetMySkillHandler", "agentMgr.GetMyJournalDetails",
  "charMgr.GetContactList", "onlineStatus.GetInitialState", "notificationMgr.GetAllNotifications", "agentMgr.GetAgents",
];
/** What a choosing sends last, by name, at the proxy node or on an object, after the corporation's reads and the address book's. */
const CHOSEN_LAST = ["GetMyApplications", "GetLoginInfo", "GetAllNotifications", "GetEventList", "GetEventList", "GetAgents"];
/** The last `count` things a choosing sent before those, and those. */
const sentLast = (session, count) => session.sent.slice(-(count + CHOSEN_LAST.length));

/** The node the stand-in's corporation registries live on, and whether a call was made on one of them. */
const REGISTRY_NODE = 2;
const onRegistry = (call) => call.objectID.startsWith(`N=${REGISTRY_NODE}:`);

/**
 * A stand-in GamePortSession. `answers` maps "service.method" to a value or to
 * a function of the arguments; a function may throw. Selecting puts the
 * character on the session as the server's session change does.
 */
function fakeSession({ answers = {}, userid = ACCOUNT, loginError = null, comesOnline = true, inSpace = false, handshakeAnswer = null, corpid = 1000044, allianceid = null, serverNow = 1_700_000_000_000 } = {}) {
  const listeners = { notification: new Set(), sessionChange: new Set(), close: new Set(), clientCall: new Set() };
  const session = {
    attributes: {},
    calls: [],
    closed: false,
    logins: [],
    async login(userName, password) {
      session.logins.push([userName, password]);
      if (loginError) throw loginError;
      // What the session answered the server's login function with (session.js).
      session.handshakeAnswer = handshakeAnswer;
      // The account a name logs in as: one for every name, or told by the name.
      const account = typeof userid === "function" ? userid(userName) : userid;
      session.attributes.userid = account;
      session.change({ userid: [null, account] });
    },
    async call(service, method, args = [], kwargs = null) {
      if (session.closed) throw sessionError("CONNECTION_CLOSED");
      session.calls.push({ service, method, args, kwargs });
      session.sent.push(method);
      const key = `${service}.${method}`;
      if (key === "charUnboundMgr.SelectCharacterID" && !(key in answers)) {
        if (comesOnline) {
          const place = inSpace ? { solarsystemid: SYSTEM } : { stationid: STATION };
          const alliance = allianceid === null ? {} : { allianceid };
          Object.assign(session.attributes, { charid: BigInt(args[0]), corpid, solarsystemid2: SYSTEM, shipid: SHIP, ...alliance, ...place });
          // The server's session change for a character chosen names its corporation among the rest, and its alliance if it is in one.
          session.change({ charid: [null, args[0]], corpid: [null, corpid], stationid: [null, STATION], ...(allianceid === null ? {} : { allianceid: [null, allianceid] }) });
        }
        return null;
      }
      const answer = key in answers ? answers[key] : null;
      return typeof answer === "function" ? answer(args, kwargs) : answer;
    },
    /** sm.ProxySvc(service).method(...): the same call, addressed to the proxy node. */
    async proxyCall(service, method, args = [], kwargs = null) {
      if (session.closed) throw sessionError("CONNECTION_CLOSED");
      session.proxyCalls.push({ service, method, args, kwargs });
      session.sent.push(method);
      const key = `${service}.${method}`;
      const answer = key in answers ? answers[key] : null;
      return typeof answer === "function" ? answer(args, kwargs) : answer;
    },
    /**
     * A Moniker's bind: answers "N=1:<n>", counting up. The call that came with it, if one did, is answered as a
     * call on the new object is, and is listed among the bound calls with them: `carried` says how each bind went.
     * A corporation's registry lives on a node of its own and is counted apart, "N=2:<n>": every choosing binds
     * one, and the count of the rest is what a test caused.
     */
    async bind(service, params, call = null) {
      if (session.closed) throw sessionError("CONNECTION_CLOSED");
      session.binds.push({ service, params });
      session.carried.push(call === null ? null : call[0]);
      const answer = answers[`bind:${service}`];
      if (typeof answer === "function") return answer(params, call);
      const [nodeID, counted] = service === "corpRegistry" ? [REGISTRY_NODE, "registries"] : [1, "objects"];
      session[counted] += 1;
      const objectID = `N=${nodeID}:${session[counted]}`;
      return { objectID, nodeID, result: call === null ? null : await session.callBound(objectID, call[0], call[1], call[2]) };
    },
    /** A call on a bound object. The inventory managers hand back another bound object. */
    async callBound(objectID, method, args = [], kwargs = null) {
      if (session.closed) throw sessionError("CONNECTION_CLOSED");
      session.boundCalls.push({ objectID, method, args, kwargs });
      session.sent.push(method);
      const key = `bound:${method}`;
      if (key in answers) return typeof answers[key] === "function" ? answers[key](args, kwargs, objectID) : answers[key];
      if (method === "GetInventory" || method === "GetInventoryFromId") {
        session.objects += 1;
        return boundObject(`N=1:${session.objects}`);
      }
      return null;
    },
    /** The server's clock as the session's last synchronising has it, in milliseconds: a test may move it on. */
    serverNowMs: serverNow,
    serverNow() { return session.serverNowMs; },
    binds: [],
    /** For each bind, in order: the method of the call it carried, or null for a bind that carried none. */
    carried: [],
    /** The nodes the session was told addresses live on: [service, bindParams, nodeID]. */
    nodes: [],
    setNodeOfAddress(service, bindParams, nodeID) { session.nodes.push([service, bindParams, nodeID]); },
    proxyCalls: [],
    boundCalls: [],
    /** The method of every call, by name, at the proxy node or on an object, in the order they were sent. */
    sent: [],
    objects: 0,
    registries: 0,
    onNotification(listener) { listeners.notification.add(listener); return () => listeners.notification.delete(listener); },
    onSessionChange(listener) { listeners.sessionChange.add(listener); return () => listeners.sessionChange.delete(listener); },
    onClose(listener) { listeners.close.add(listener); return () => listeners.close.delete(listener); },
    onClientCall(listener) { listeners.clientCall.add(listener); return () => listeners.clientCall.delete(listener); },
    clientCalls: null,
    /** The server calls one of the client's own services, as the session hands such a call on. */
    async ask(service, method, args = [], kwargs = null, timeoutSeconds = null) {
      const call = { service, method, args, kwargs, timeoutSeconds };
      const answer = await session.clientCalls(call);
      for (const listener of listeners.clientCall) listener({ ...call, answered: answer !== undefined, answer, error: null });
      return answer;
    },
    close() {
      if (session.closed) return;
      session.closed = true;
      for (const listener of listeners.close) listener(sessionError("CONNECTION_CLOSED"));
    },
    /** The server pushes a notification. */
    notify(method, args = [], service = null) {
      for (const listener of listeners.notification) listener({ service, method, idtype: service ? null : "charid", args, kwargs: null });
    },
    change(changes) {
      for (const listener of listeners.sessionChange) listener(changes, session.attributes);
    },
    /** The connection drops under the session. */
    drop() { session.close(); },
  };
  return session;
}

/** A transport with one stand-in session behind it, and that session. */
function build(sessionOptions = {}, pilotOptions = {}) {
  const made = [];
  const answers = {
    "charUnboundMgr.GetCharacterSelectionData": selectionData(),
    "charUnboundMgr.GetCharacterLockType": null,
    "dogmaIM.ShipGetInfo": shipInfo(),
    "bound:GetAllInfo": godmaOf(shipInfo()),
    ...(sessionOptions.answers || {}),
  };
  const pilots = createGamePortPilots({
    connect: async () => ({ transport: true }),
    createSession() {
      const session = fakeSession({ ...sessionOptions, answers });
      made.push(session);
      return session;
    },
    allowed: new Set([
      "station.GetGuests", "account.GetCashBalance", "corpRegistry.GetTitles", "dogmaIM.ShipGetInfo",
      "invbroker.GetInventory", "invbroker.GetInventoryFromId", "invbroker.MachoBindObject", "invbroker.List", "invbroker.Add", "invbroker.StackAll", "invbroker.ListByFlags", "invbroker.MultiAdd", "invbroker.GetCapacity",
      "ship.MachoBindObject", "ship.Undock", "ship.Board", "dogmaIM.MachoBindObject", "dogmaIM.GetAllInfo",
      "agentMgr.MachoBindObject", "agentMgr.DoAction", "planetMgr.MachoBindObject", "charMgr.MachoBindObject",
      "reprocessingSvc.MachoBindObject", "fleetObjectHandler.MachoBindObject", "fleetObjectHandler.CreateFleet",
      "entity.MachoBindObject", "beyonce.MachoBindObject", "beyonce.CmdStop", "scanMgr.GetSystemScanMgr",
    ]),
    sleep: async () => {},
    selectSettleMs: 200,
    releaseSettleMs: 300,
    ...pilotOptions,
  });
  // Every choosing binds the corporation's registry and asks it its three. That bind and those calls are taken
  // out of the session's lists and kept as its `registryAtChoosing`, so that the lists hold what a test caused
  // and the choosing's other binds, as they did before the choosing bound a registry.
  const select = pilots.selectCharacter;
  pilots.selectCharacter = async (...given) => {
    const outcome = await select(...given);
    const session = made[made.length - 1];
    const ofRegistry = session.binds.map((bind) => bind.service === "corpRegistry");
    // Empties the list, puts back what is not `taken`, and answers what is.
    const take = (list, taken) => list.splice(0, list.length).reduce((aside, item, index) => { (taken(item, index) ? aside : list).push(item); return aside; }, []);
    session.registryAtChoosing = {
      carried: take(session.carried, (method, index) => ofRegistry[index]),
      binds: take(session.binds, (bind, index) => ofRegistry[index]),
      boundCalls: take(session.boundCalls, onRegistry),
    };
    return outcome;
  };
  return { pilots, made, get session() { return made[made.length - 1]; } };
}

async function selected(sessionOptions, pilotOptions) {
  const built = build(sessionOptions, pilotOptions);
  const outcome = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  return { ...built, session: built.session, outcome, handle: outcome.bridgeSessionID };
}

const rejects = (promise, code, message) => assert.rejects(promise, (error) => {
  assert.ok(error instanceof GamePortPilotError, `a GamePortPilotError, not ${error && error.stack}`);
  assert.equal(error.code, code);
  if (message) assert.match(error.message, message);
  return true;
});

// ── the shape ────────────────────────────────────────────────────────────────

test("it is a transport: the pilot's nine functions, all of them", () => {
  const { pilots } = build();
  for (const name of Object.keys(PILOT_FUNCTIONS)) assert.equal(typeof pilots[name], "function", name);
});

// ── select ───────────────────────────────────────────────────────────────────

test("select logs in as the account and makes the retail client's three calls, in order", async () => {
  const { session, outcome, pilots } = await selected();
  assert.deepEqual(session.logins, [["test", ""]]);
  assert.deepEqual(session.calls.map((call) => `${call.service}.${call.method}`), [
    "charUnboundMgr.GetCharacterSelectionData",
    "charUnboundMgr.GetCharacterLockType",
    "charUnboundMgr.SelectCharacterID",
    // The character is chosen: its standings are read, as the client's standing service reads them then.
    "standingMgr.GetNPCNPCStandings",
    "standingMgr.GetCharStandings",
    // And its skill handler is asked for, as the client's skill service asks. This stand-in answers none, so nothing is asked of one.
    "skillMgr2.GetMySkillHandler",
    // And its agents' journal, as the client's journal service asks for it.
    "agentMgr.GetMyJournalDetails",
    // And its contacts and who of them is online, as the client's address book asks. (Its corporation's contacts
    // are asked of the registry, and not at all of an NPC corporation, which the stand-in pilot's is.)
    "charMgr.GetContactList",
    "onlineStatus.GetInitialState",
    // And all its notifications, as the client's notification window asks for them.
    "notificationMgr.GetAllNotifications",
    // And the table of agents, as the client's agents service asks for it. The choosing does not wait on that one.
    "agentMgr.GetAgents",
  ]);
  assert.deepEqual(session.calls.slice(3).map((call) => `${call.service}.${call.method}`), CHOSEN_ASKS);
  assert.deepEqual(session.calls[0].args, []);
  assert.deepEqual(session.calls[1].args, [PILOT]);
  assert.deepEqual(session.calls[2].args, [PILOT, null, true]);
  assert.ok(outcome.bridgeSessionID.startsWith(GAME_PORT_HANDLE_PREFIX));
  assert.equal(outcome.bridgeSessionID.length, GAME_PORT_HANDLE_PREFIX.length + 32);
  assert.equal(pilots.size, 1);
});

test("select answers as the gateway's does: the call, the session echo, and what the server pushed", async () => {
  const { outcome } = await selected();
  assert.equal(outcome.service, "charUnboundMgr");
  assert.equal(outcome.method, "SelectCharacterID");
  assert.equal(outcome.result, null);
  assert.deepEqual(outcome.session, {
    userid: ACCOUNT,
    characterID: PILOT,
    characterName: "Test Pilot",
    stationID: STATION,
    structureID: null,
    solarSystemID: SYSTEM,
    corporationID: 1000044,
    shipID: SHIP,
  });
  // The character's session change, and not the account's from the login before it. It is the session's
  // first event, and says so: its cursor is the one its frame on the stream has.
  assert.equal(outcome.notifications.length, 1);
  const { cursor, ...change } = outcome.notifications[0];
  assert.deepEqual(change, {
    kind: "sessionchange", service: null, method: "OnSessionChanged",
    args: [{ charid: [null, PILOT], corpid: [null, 1000044], stationid: [null, STATION] }], kwargs: null,
  });
  assert.equal(cursor.sequence, 1);
  assert.equal(typeof cursor.epoch === "string" && cursor.epoch.length > 0, true);
});

test("select is refused, and the connection closed, when the server's account is not the BFF's", async () => {
  const built = build({ userid: 9 });
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /different account/);
  assert.equal(built.session.closed, true);
  assert.deepEqual(built.session.calls, [], "nothing was asked of the wrong account");
  assert.equal(built.pilots.size, 0);
});

test("select refuses a character that is not on the account, before asking for it", async () => {
  const built = build({ answers: { "charUnboundMgr.GetCharacterSelectionData": selectionData([characterRow({ characterID: 140000099 })]) } });
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "CALL_REFUSED", /not on this account/);
  assert.equal(built.session.calls.some((call) => call.method === "SelectCharacterID"), false);
  assert.equal(built.session.closed, true);
});

/**
 * Pilot options under which each pilot's ballpark ticks only when the test
 * says so, and whatever goes wrong in a park's own time is kept.
 */
function handTicked() {
  const parks = [];
  const errors = [];
  return {
    parks,
    errors,
    options: {
      createSpace(options) {
        // The park's clock moves only when the test says so: tick() moves it on a second and shows it to the park, which then takes one step.
        const made = { tick: null, stopped: false, sim: 1_000_000 };
        made.space = createPilotSpace({
          ...options,
          simTime: () => made.sim,
          startTicking: (frame) => { made.tick = () => { made.sim += 1000; frame(); }; return made; },
          stopTicking: () => { made.stopped = true; },
        });
        parks.push(made);
        return made.space;
      },
      onSpaceError: (error, what) => errors.push([what, error.message]),
    },
  };
}
const IN_SPACE = { inSpace: true, answers: { "charUnboundMgr.GetCharacterSelectionData": selectionData([characterRow({ stationID: null })]) } };
const WHOSE = { userid: ACCOUNT };
/** The first updates of a real undock, as the session hands them on. */
const recordedUpdates = recordedNotifications(undockRecording).filter((notification) => notification.method === "DoDestinyUpdate");

test("a pilot left in space is selected in space and given a ballpark as the client makes one", async () => {
  const hand = handTicked();
  const built = build(IN_SPACE, hand.options);
  const outcome = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const { session } = built;
  assert.deepEqual([outcome.session.stationID, outcome.session.solarSystemID], [null, SYSTEM]);
  // michelle.AddBallpark: the formations are asked for, the park starts to tick, and the ballpark is bound for the system.
  const first = await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, outcome.bridgeSessionID);
  assert.deepEqual(session.calls.map((call) => `${call.service}.${call.method}`), [
    "charUnboundMgr.GetCharacterSelectionData", "charUnboundMgr.GetCharacterLockType", "charUnboundMgr.SelectCharacterID",
    ...CHOSEN_ASKS, "beyonce.GetFormations",
  ]);
  assert.deepEqual(session.binds, [{ service: "beyonce", params: SYSTEM }]);
  assert.deepEqual([hand.parks.length, typeof hand.parks[0].tick, hand.parks[0].stopped], [1, "function", false]);
  // What the BFF binds is the park's own remote ballpark, the one object everything is asked of: no second bind.
  const second = await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, outcome.bridgeSessionID);
  await built.pilots.callBoundMethod("beyonce", "CmdStop", [], null, WHOSE, outcome.bridgeSessionID, first.boundHandle);
  await built.pilots.callBoundMethod("beyonce", "CmdStop", [], null, WHOSE, outcome.bridgeSessionID, second.boundHandle);
  assert.equal(session.binds.length, 1);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method]), [["N=1:1", "CmdStop"], ["N=1:1", "CmdStop"]]);
  assert.deepEqual(hand.errors, []);
});

test("the space snapshot and the flight status are read from the pilot's own ballpark", async () => {
  const hand = handTicked();
  const built = build(IN_SPACE, hand.options);
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  // Before the server's state has come: in space, and nothing known of it.
  const empty = await built.pilots.readSpaceSnapshot(handle);
  assert.deepEqual([empty.space.inSpace, empty.space.entities, empty.space.ship, empty.space.shipID], [true, [], null, SHIP]);
  assert.deepEqual([(await built.pilots.readFlightStatus(handle)).flight.shipMode], [null]);

  // The server's first updates arrive, and the park ticks.
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const { space, notifications } = await built.pilots.readSpaceSnapshot(handle);
  assert.deepEqual([space.inSpace, space.solarSystemID, space.shipID, space.entities.length], [true, SYSTEM, SHIP, 76]);
  assert.deepEqual(notifications, [], "the ballpark's updates are not handed on as notifications");
  const own = space.entities.find((row) => row.isSelf);
  assert.deepEqual([own.itemID, own.kind, own.typeID, own.name, own.characterID, own.mode, own.maxVelocity], [SHIP, "ship", 588, "Reaper", PILOT, "GOTO", 341]);
  assert.deepEqual([space.ship.itemID, space.ship.mode, space.ship.position, space.ship.velocity], [SHIP, "GOTO", own.position, own.velocity]);
  const station = space.entities.find((row) => row.itemID === STATION);
  assert.deepEqual([station.kind, station.groupID, station.categoryID, station.isSelf], ["station", 15, 3, false]);
  assert.equal(space.sampledAtMs % 1000, 0, "the park's tick, in milliseconds");
  const { flight } = await built.pilots.readFlightStatus(handle);
  assert.deepEqual([flight.inSpace, flight.docked, flight.shipMode, flight.shipSpeedFraction, flight.solarSystemID], [true, false, "GOTO", 1, SYSTEM]);

  // The park steps itself: a tick later the ship has moved a tick's travel, and the rest of the grid has arrived.
  hand.parks[0].tick();
  hand.parks[0].tick();
  const later = (await built.pilots.readSpaceSnapshot(handle)).space;
  assert.equal(later.entities.length, 95);
  const moved = Math.hypot(later.ship.position.x - space.ship.position.x, later.ship.position.y - space.ship.position.y, later.ship.position.z - space.ship.position.z);
  assert.ok(Math.abs(moved - 2 * 341) < 1e-3, `${moved} m in two ticks`);
  assert.equal(later.sampledAtMs - space.sampledAtMs, 2000);
  // The scanner in space answers too: this ship has no launcher that godma was told of, and no probes are out.
  assert.deepEqual((await built.pilots.readScannerState(handle)).scanner, { inSpace: true, solarSystemID: SYSTEM, shipID: SHIP, maxActiveProbes: 8, launcher: null, probes: [] });
  assert.deepEqual(hand.errors, []);
});

test("a pilot docked in a structure is docked", async () => {
  const built = build({ answers: { "charUnboundMgr.GetCharacterSelectionData": selectionData([characterRow({ stationID: null, structureID: 1030000000001 })]) } });
  const outcome = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  assert.ok(outcome.bridgeSessionID);
});

test("select refuses a locked character with the retail client's own reason", async () => {
  for (const [lockType, reason] of [[1, "CharacterTransferring"], [2, "CharacterOnSale"], [7, "CharacterLocked"]]) {
    const built = build({ answers: { "charUnboundMgr.GetCharacterLockType": lockType } });
    await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "CALL_REFUSED", new RegExp(`^${reason}$`));
    assert.equal(built.session.calls.some((call) => call.method === "SelectCharacterID"), false);
  }
});

test("the server's own refusal of the select passes through in its words", async () => {
  const built = build({ answers: { "charUnboundMgr.SelectCharacterID": () => { throw refusedBy("CustomInfo", "Test Pilot is already online."); } } });
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "CALL_REFUSED", /^Test Pilot is already online\.$/);
  assert.equal(built.session.closed, true);
  assert.equal(built.pilots.size, 0);
});

test("a select that brings nobody online is a failure, not a session", async () => {
  const built = build({ comesOnline: false });
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /without bringing a character online/);
  assert.equal(built.session.closed, true);
});

test("select says so when the game server cannot be reached, refuses the login, or drops the connection", async () => {
  const unreachable = createGamePortPilots({ connect: async () => { throw new Error("ECONNREFUSED"); } });
  await rejects(unreachable.selectCharacter([PILOT, null, true], null, FIELDS), "EVE_GATEWAY_UNREACHABLE");

  const refused = build({ loginError: sessionError("LOGIN_REFUSED", "The game server refused the login: banned") });
  await rejects(refused.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /^The game server refused the login: banned$/);
  assert.equal(refused.session.closed, true);
  for (const code of ["LOGON_QUEUE", "BAD_SERVER_SIGNATURE", "INCOMPATIBLE_PROTOCOL", "HANDSHAKE_INCOMPATIBLE_BUILD"]) {
    const built = build({ loginError: sessionError(code, `the session's own words for ${code}`) });
    await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", new RegExp(`own words for ${code}$`));
  }
  const slow = build({ loginError: sessionError("HANDSHAKE_TIMEOUT") });
  await rejects(slow.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "EVE_GATEWAY_TIMEOUT");

  const dropped = build({ answers: { "charUnboundMgr.GetCharacterLockType": () => { throw sessionError("CONNECTION_LOST"); } } });
  await rejects(dropped.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
});

test("select needs an account, its name and a character", async () => {
  const { pilots } = build();
  await rejects(pilots.selectCharacter([PILOT, null, true], null, { userName: "test" }), "CALL_INVALID");
  await rejects(pilots.selectCharacter([PILOT, null, true], null, { userid: ACCOUNT }), "CALL_INVALID", /account's name/);
  await rejects(pilots.selectCharacter([PILOT, null, true], null, { userid: ACCOUNT, userName: "  " }), "CALL_INVALID");
  await rejects(pilots.selectCharacter([0, null, true], null, FIELDS), "CALL_INVALID");
  await rejects(pilots.selectCharacter([], null, FIELDS), "CALL_INVALID");
});

test("the password comes from the BFF's own setting, never from the caller", async () => {
  const built = build({}, { passwordFor: (name) => `secret-for-${name}` });
  await built.pilots.selectCharacter([PILOT, null, true], null, { ...FIELDS, password: "from-the-browser" });
  assert.deepEqual(built.session.logins, [["test", "secret-for-test"]]);
});

// ── calls ────────────────────────────────────────────────────────────────────

test("a call sends the JSON arguments as they are and answers in the gateway's JSON", async () => {
  const { pilots, session, handle } = await selected({ answers: {
    "station.GetGuests": { type: "list", items: [[PILOT, 1000044, 0n, 134359051855730000n], Buffer.from("Jita")] },
  } });
  const args = [34, { type: "list", items: [1, 2] }, { type: "long", value: "134359051855730000" }, "text"];
  const outcome = await pilots.callMethod("station", "GetGuests", args, { passive: 0 }, { userid: ACCOUNT }, handle);
  assert.deepEqual(outcome, {
    service: "station",
    method: "GetGuests",
    result: { type: "list", items: [[PILOT, 1000044, 0, { type: "long", value: "134359051855730000" }], "Jita"] },
    notifications: [],
  });
  const sent = session.calls.at(-1);
  assert.deepEqual(sent.args, args);
  assert.deepEqual(sent.kwargs, { passive: 0 });
});

test("an answer of nothing is null, as the gateway prints it", async () => {
  const { pilots, handle } = await selected({ answers: { "station.GetGuests": undefined } });
  assert.equal((await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle)).result, null);
});

test("only the pairs on the allowlist are sent", async () => {
  const { pilots, session, handle } = await selected();
  const before = session.calls.length;
  await rejects(pilots.callMethod("machoNet", "GetTime", [], null, { userid: ACCOUNT }, handle), "CALL_NOT_ALLOWED", /machoNet\.GetTime is not on the web-call allowlist/);
  await rejects(pilots.callMethod("station", "getguests", [], null, { userid: ACCOUNT }, handle), "CALL_NOT_ALLOWED");
  assert.equal(session.calls.length, before);
});

test("the allowlist it ships with is the gateway's own list of pairs", async () => {
  const contract = require("../contracts/evejs-web-bridge-contract.json");
  const made = [];
  const pilots = createGamePortPilots({
    connect: async () => ({}),
    createSession: () => { made.push(fakeSession({ answers: { "charUnboundMgr.GetCharacterSelectionData": selectionData() } })); return made[0]; },
    sleep: async () => {},
  });
  const { bridgeSessionID } = await pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  for (const pair of contract.gatewayAllowlist.pairs.slice(0, 40)) {
    const [service, method] = pair.split(".");
    await pilots.callMethod(service, method, [], null, { userid: ACCOUNT }, bridgeSessionID);
  }
  // The three of choosing a character, what a choosing asks by name, and the forty but one: the table of agents
  // is among the forty, and is not asked for twice.
  assert.equal(contract.gatewayAllowlist.pairs.slice(0, 40).includes("agentMgr.GetAgents"), true);
  assert.equal(made[0].calls.length, 3 + CHOSEN_ASKS.length + 39);
  assert.equal(contract.gatewayAllowlist.pairs.length, contract.gatewayAllowlist.count);
});

test("a call for someone else's session, or for no session, finds none", async () => {
  const { pilots, handle } = await selected();
  await rejects(pilots.callMethod("station", "GetGuests", [], null, { userid: 9 }, handle), "SESSION_NOT_FOUND");
  await rejects(pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, "gp:nope"), "SESSION_NOT_FOUND");
  await rejects(pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, undefined), "SESSION_NOT_FOUND");
  // Asked without saying who, as release is, the handle alone is enough.
  assert.equal((await pilots.callMethod("station", "GetGuests", [], null, {}, handle)).service, "station");
});

test("what goes wrong in a call is reported in the gateway's terms", async () => {
  const { pilots, handle } = await selected({ answers: {
    "station.GetGuests": () => { throw refusedBy("CustomNotify", "That industry job is not ready yet."); },
    "account.GetCashBalance": () => { throw sessionError("CALL_TIMEOUT", "account.GetCashBalance got no answer"); },
    // Asked by the service's name, a call of the corporation registry is made on the registry's moniker.
    "bound:GetTitles": () => { throw new Error("Cannot marshal value: object {\"bare\":1}"); },
    "dogmaIM.ShipGetInfo": () => { throw sessionError("GAME_CALL_REFUSED", "refused: RuntimeError", null); },
    // Asked by the service's name, a dogma call is made on the dogma location (below).
    "bound:ShipGetInfo": () => { throw sessionError("GAME_CALL_REFUSED", "refused: RuntimeError", null); },
  } });
  const who = { userid: ACCOUNT };
  await rejects(pilots.callMethod("station", "GetGuests", [], null, who, handle), "CALL_REFUSED", /^That industry job is not ready yet\.$/);
  await rejects(pilots.callMethod("account", "GetCashBalance", [], null, who, handle), "EVE_GATEWAY_TIMEOUT");
  await rejects(pilots.callMethod("corpRegistry", "GetTitles", [], null, who, handle), "CALL_INVALID", /cannot be sent/);
  // An exception that is not a game refusal is a failure, with the call named.
  await rejects(pilots.callMethod("dogmaIM", "ShipGetInfo", [], null, who, handle), "CALL_FAILED", /^dogmaIM\.ShipGetInfo failed: /);
  // None of those ended the session.
  assert.equal(pilots.size, 1);
  assert.equal((await rejects(pilots.callMethod("machoNet", "x", [], null, who, handle), "CALL_NOT_ALLOWED")), undefined);
});

test("the status codes are the gateway's", () => {
  const status = (code) => new GamePortPilotError(code, "x").statusCode;
  assert.deepEqual(
    ["CALL_INVALID", "CALL_NOT_ALLOWED", "CALL_FAILED", "CALL_REFUSED", "SESSION_NOT_FOUND", "SESSION_SELECT_FAILED", "EVE_GATEWAY_TIMEOUT", "PILOT_TRANSPORT_UNAVAILABLE", "ANYTHING_ELSE"].map(status),
    [400, 403, 502, 409, 404, 502, 502, 501, 502],
  );
});

test("a connection that drops under a call ends the session, and every later call finds none", async () => {
  const { pilots, session, handle } = await selected({ answers: { "station.GetGuests": () => { throw sessionError("CONNECTION_LOST"); } } });
  await rejects(pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle), "SESSION_NOT_FOUND");
  assert.equal(pilots.size, 0);
  assert.equal(session.closed, true);
  await rejects(pilots.readFlightStatus(handle, { userid: ACCOUNT }), "SESSION_NOT_FOUND");
});

test("a connection that drops on its own ends the session too", async () => {
  const { pilots, session, handle } = await selected();
  session.drop();
  assert.equal(pilots.size, 0);
  await rejects(pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle), "SESSION_NOT_FOUND");
});

// ── what the server pushes ───────────────────────────────────────────────────

test("every answer drains what the server pushed since the last one", async () => {
  const { pilots, session, handle } = await selected();
  session.notify("OnItemsChanged", [1, 2]);
  session.notify("OnAgentMissionChange", [Buffer.from("offered"), 3008416], "agentMgr");
  const first = await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle);
  assert.deepEqual(first.notifications.map(({ cursor, ...notification }) => notification), [
    { kind: "client", service: null, method: "OnItemsChanged", idType: "charid", args: [1, 2], kwargs: null },
    { kind: "service", service: "agentMgr", method: "OnAgentMissionChange", idType: null, args: ["offered", 3008416], kwargs: null },
  ]);
  // Numbered after the session change that selecting drained.
  assert.deepEqual(first.notifications.map((notification) => notification.cursor.sequence), [2, 3]);
  assert.deepEqual((await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle)).notifications, []);
  session.change({ shipid: [SHIP, 77] });
  assert.equal((await pilots.readFlightStatus(handle, { userid: ACCOUNT })).notifications[0].method, "OnSessionChanged");
  session.notify("OnX");
  assert.equal((await pilots.readSpaceSnapshot(handle, { userid: ACCOUNT })).notifications.length, 1);
  session.notify("OnY");
  assert.equal((await pilots.readScannerState(handle, { userid: ACCOUNT })).notifications.length, 1);
});

test("what an answer drains names the stream frame it also went out in, so a reader with both can tell they are one", async () => {
  const { pilots, session, handle } = await selected();
  const frames = [];
  pilots.openSessionEventStream({ bridgeSessionID: handle, userid: ACCOUNT, onFrame: (frame) => frames.push(frame) });
  await Promise.resolve();
  session.notify("OnItemsChanged", [1, 2]);
  // What is not kept takes no number.
  session.notify("DoDestinyUpdate", [[1, 2, 3]]);
  session.notify("OnAgentMissionChange", [Buffer.from("offered"), 3008416], "agentMgr");
  const drained = (await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle)).notifications;
  const streamed = frames.filter((frame) => frame.type === "event");
  assert.deepEqual(streamed.map((frame) => frame.cursor.sequence), [2, 3]);
  assert.deepEqual(drained.map((notification) => notification.cursor), streamed.map((frame) => frame.cursor));
  // The stream's own copy is as it was: the frame carries the cursor, and the notification inside it does not.
  assert.deepEqual(streamed.map((frame) => Object.keys(frame.event.notification).includes("cursor")), [false, false]);
  assert.deepEqual(streamed.map((frame) => frame.event.notification.method), drained.map((notification) => notification.method));
  // With nobody on the stream the answer's copy is numbered all the same: a reader may attach later and be replayed to.
  const alone = await selected();
  alone.session.notify("OnItemsChanged");
  const kept = (await alone.pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, alone.handle)).notifications;
  assert.deepEqual(kept.map((notification) => notification.cursor.sequence), [2]);
});

test("destiny updates are not kept, as on the gateway", async () => {
  const { pilots, session, handle } = await selected();
  const frames = [];
  pilots.openSessionEventStream({ bridgeSessionID: handle, userid: ACCOUNT, onFrame: (frame) => frames.push(frame) });
  await Promise.resolve();
  session.notify("DoDestinyUpdate", [[1, 2, 3]]);
  session.notify("OnItemsChanged");
  assert.deepEqual((await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle)).notifications.map((n) => n.method), ["OnItemsChanged"]);
  assert.deepEqual(frames.filter((frame) => frame.type === "event").map((frame) => frame.event.notification.method), ["OnItemsChanged"]);
});

test("a backlog nobody drains stops growing", async () => {
  const { pilots, session, handle } = await selected();
  for (let index = 0; index < 5000; index += 1) session.notify("OnTick", [index]);
  const { notifications } = await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle);
  assert.equal(notifications.length, 4096);
  assert.deepEqual(notifications.at(-1).args, [4999], "the newest are the ones kept");
});

// ── the event stream ─────────────────────────────────────────────────────────

/** Open a stream and collect what it says. */
function listen(pilots, handle, cursor = null, userid = ACCOUNT) {
  const heard = { frames: [], opened: 0, closed: [] };
  heard.stream = pilots.openSessionEventStream({
    bridgeSessionID: handle, userid, cursor,
    onFrame: (frame) => heard.frames.push(frame),
    onOpen: () => { heard.opened += 1; },
    onClose: (details) => heard.closed.push(details),
  });
  return heard;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a stream opens with a snapshot frame, then carries each notification in the gateway's envelope", async () => {
  const { pilots, session, handle } = await selected();
  const heard = listen(pilots, handle);
  assert.equal(heard.opened, 0, "nothing happens before the caller holds the stream");
  await tick();
  assert.equal(heard.opened, 1);
  assert.equal(heard.frames.length, 1);
  const [snapshot] = heard.frames;
  assert.deepEqual({ ...snapshot, cursor: { ...snapshot.cursor, epoch: "e" } }, {
    source: "evejs-web-gateway", apiVersion: 1, streamVersion: 1, type: "snapshot",
    cursor: { epoch: "e", sequence: 1 }, reason: "no_cursor",
  });
  assert.match(snapshot.cursor.epoch, /^[A-Za-z0-9_-]{8,}$/);

  session.notify("OnItemsChanged", [7]);
  assert.deepEqual(heard.frames[1], {
    source: "evejs-web-gateway", apiVersion: 1, streamVersion: 1, type: "event",
    cursor: { epoch: snapshot.cursor.epoch, sequence: 2 },
    event: { kind: "notification", notification: { kind: "client", service: null, method: "OnItemsChanged", idType: "charid", args: [7], kwargs: null } },
  });
  // The stream is liveness only: the same notification is still on the next answer.
  assert.equal((await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle)).notifications.length, 1);
});

test("a stream resumed with its last cursor is replayed exactly what it missed", async () => {
  const { pilots, session, handle } = await selected();
  const first = listen(pilots, handle);
  await tick();
  session.notify("OnA");
  const cursor = first.frames.at(-1).cursor;
  first.stream.close();
  session.notify("OnB");
  session.notify("OnC");
  assert.equal(first.frames.length, 2, "a closed stream hears nothing more");

  const second = listen(pilots, handle, cursor);
  await tick();
  assert.deepEqual(second.frames.map((frame) => [frame.type, frame.event.notification.method, frame.cursor.sequence]), [
    ["event", "OnB", cursor.sequence + 1],
    ["event", "OnC", cursor.sequence + 2],
  ]);
  // Up to date: nothing to replay, and no snapshot either.
  const third = listen(pilots, handle, second.frames.at(-1).cursor);
  await tick();
  assert.deepEqual(third.frames, []);
});

test("a cursor that cannot be replayed gets a snapshot frame saying so", async () => {
  const { pilots, session, handle } = await selected();
  for (const cursor of [{ epoch: "another-process", sequence: 1 }, { epoch: null, sequence: 0 }]) {
    const heard = listen(pilots, handle, cursor);
    await tick();
    assert.deepEqual(heard.frames.map((frame) => [frame.type, frame.reason]), [["snapshot", "cursor_not_replayable"]]);
  }
  // Older than the history holds.
  const early = listen(pilots, handle);
  await tick();
  const old = early.frames[0].cursor;
  for (let index = 0; index < 300; index += 1) session.notify("OnTick", [index]);
  const late = listen(pilots, handle, old);
  await tick();
  assert.deepEqual(late.frames.map((frame) => frame.type), ["snapshot"]);
  // And one from the future of this stream.
  const ahead = listen(pilots, handle, { epoch: old.epoch, sequence: 99999 });
  await tick();
  assert.deepEqual(ahead.frames.map((frame) => frame.reason), ["cursor_not_replayable"]);
});

test("a notification that arrives while a stream is opening is not lost or reordered", async () => {
  const { pilots, session, handle } = await selected();
  const heard = listen(pilots, handle);
  session.notify("OnEarly");
  await tick();
  assert.deepEqual(heard.frames.map((frame) => frame.type), ["snapshot", "event"]);
  assert.equal(heard.frames[1].event.notification.method, "OnEarly");
});

test("a stream is told when its session ends, and one for no session is told at once", async () => {
  const { pilots, session, handle } = await selected();
  const heard = listen(pilots, handle);
  await tick();
  await pilots.releaseBridgeSession(handle, { userid: ACCOUNT });
  assert.deepEqual(heard.closed, [{ code: 0, reason: "session_released", refusalStatus: 404 }]);
  session.notify("OnAfter");
  assert.equal(heard.frames.length, 1);

  for (const [badHandle, userid] of [["gp:nope", ACCOUNT], [handle, ACCOUNT]]) {
    const none = listen(pilots, badHandle, null, userid);
    assert.deepEqual(none.closed, [], "deferred, so the caller holds the stream first");
    await tick();
    assert.deepEqual(none.closed, [{ code: 0, reason: "session not found", refusalStatus: 404 }]);
    assert.equal(none.opened, 0);
  }
  const closedFirst = pilots.openSessionEventStream({ bridgeSessionID: "gp:nope", onClose: () => assert.fail("closed by the caller first") });
  closedFirst.close();
  await tick();
});

test("someone else's account cannot listen to a session", async () => {
  const { pilots, handle } = await selected();
  const heard = listen(pilots, handle, null, 9);
  await tick();
  assert.equal(heard.opened, 0);
  assert.equal(heard.closed[0].refusalStatus, 404);
});

test("a listener that throws does not stop the others or the session", async () => {
  const { pilots, session, handle } = await selected();
  pilots.openSessionEventStream({ bridgeSessionID: handle, onFrame: () => { throw new Error("listener"); }, onOpen: () => { throw new Error("listener"); } });
  const heard = listen(pilots, handle);
  await tick();
  session.notify("OnItemsChanged");
  assert.equal(heard.frames.length, 2);
  assert.equal(pilots.size, 1);
});

// ── release ──────────────────────────────────────────────────────────────────

test("release closes the connection, and the session is gone", async () => {
  const { pilots, session, handle } = await selected();
  assert.deepEqual(await pilots.releaseBridgeSession(handle, { userid: ACCOUNT }), { released: true, characterID: PILOT });
  assert.equal(session.closed, true);
  assert.equal(pilots.size, 0);
  await rejects(pilots.releaseBridgeSession(handle, { userid: ACCOUNT }), "SESSION_NOT_FOUND");
  await rejects(pilots.releaseBridgeSession("gp:nope"), "SESSION_NOT_FOUND");
});

test("release says released only once the server has the character offline", async () => {
  const asked = [];
  let online = 3;
  const { pilots, handle } = await selected({}, { isOnline: async (accountID, characterID) => { asked.push([accountID, characterID]); online -= 1; return online > 0; } });
  assert.deepEqual(await pilots.releaseBridgeSession(handle, { userid: ACCOUNT }), { released: true, characterID: PILOT });
  assert.deepEqual(asked, [[ACCOUNT, PILOT], [ACCOUNT, PILOT], [ACCOUNT, PILOT]]);
});

test("a character the server still has in game is not reported released", async () => {
  const { pilots, session, handle } = await selected({}, { isOnline: async () => true });
  assert.deepEqual(await pilots.releaseBridgeSession(handle, { userid: ACCOUNT }), { released: false, characterID: PILOT });
  assert.equal(session.closed, true, "the connection is closed all the same");
});

test("release needs the right account when one is named", async () => {
  const { pilots, session, handle } = await selected();
  await rejects(pilots.releaseBridgeSession(handle, { userid: 9 }), "SESSION_NOT_FOUND");
  assert.equal(session.closed, false);
  assert.equal((await pilots.releaseBridgeSession(handle)).released, true);
});

test("shutdown closes every pilot's connection", async () => {
  const built = build();
  await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  assert.equal(built.pilots.size, 2);
  built.pilots.shutdown();
  assert.equal(built.pilots.size, 0);
  assert.deepEqual(built.made.map((session) => session.closed), [true, true]);
});

// ── where the pilot is ───────────────────────────────────────────────────────

test("flight status while docked is the gateway's, with the ship's type as godma holds it", async () => {
  const { pilots, session, handle } = await selected();
  session.calls.length = 0;
  const { flight, notifications } = await pilots.readFlightStatus(handle, { userid: ACCOUNT });
  assert.deepEqual(flight, {
    inSpace: false, docked: true, solarSystemID: SYSTEM, stationID: STATION, structureID: null,
    shipID: SHIP, shipTypeID: 588, shipIsCapsule: false, shipMode: null, shipSpeedFraction: null,
  });
  assert.deepEqual(notifications, []);
  // Godma is primed once for a ship in a place, as the client primes it, not once per poll; and the ship is
  // never asked about by ShipGetInfo, which the client does not send.
  await pilots.readFlightStatus(handle, { userid: ACCOUNT });
  await pilots.readFlightStatus(handle, { userid: ACCOUNT });
  assert.deepEqual(session.boundCalls.filter((call) => call.method === "GetAllInfo").map((call) => call.args), [[true, true, null]]);
  assert.deepEqual(session.calls, []);
});

test("a capsule is a capsule by its group, and a new ship is asked about again", async () => {
  let info = shipInfo(670, 29);
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": () => godmaOf(info) } });
  assert.equal((await pilots.readFlightStatus(handle)).flight.shipIsCapsule, true);
  session.attributes.shipid = 555;
  info = { type: "dict", entries: [[555, keyVal([["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: 555, typeID: 603, groupID: 25 }, values: [] }]])]] };
  const { flight } = await pilots.readFlightStatus(handle);
  assert.deepEqual([flight.shipID, flight.shipTypeID, flight.shipIsCapsule], [555, 603, false]);
  // Godma primed again for the new ship; ShipGetInfo for neither.
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 2);
  assert.equal(session.calls.filter((call) => call.method === "ShipGetInfo").length, 0);
});

test("a ship the server will not describe is reported unknown, never guessed, and asked about next time", async () => {
  let fails = true;
  const { pilots, handle } = await selected({ answers: { "bound:GetAllInfo": () => { if (fails) throw sessionError("CALL_TIMEOUT"); return godmaOf(shipInfo()); } } });
  const { flight } = await pilots.readFlightStatus(handle);
  assert.deepEqual([flight.docked, flight.shipID, flight.shipTypeID, flight.shipIsCapsule], [true, SHIP, null, null]);
  fails = false;
  assert.equal((await pilots.readFlightStatus(handle)).flight.shipTypeID, 588);
});

test("flight status for a lost connection finds no session", async () => {
  const { pilots, handle } = await selected({ answers: { "bound:GetAllInfo": () => { throw sessionError("CONNECTION_LOST"); } } });
  await rejects(pilots.readFlightStatus(handle), "SESSION_NOT_FOUND");
  assert.equal(pilots.size, 0);
});

test("docked, the space snapshot and the scanner are the gateway's docked answers", async () => {
  const { pilots, handle } = await selected({}, { now: () => 1234 });
  // And one thing the gateway's has not: the pace of the pilot's own clock.
  assert.deepEqual((await pilots.readSpaceSnapshot(handle, { userid: ACCOUNT })).space, {
    inSpace: false, solarSystemID: SYSTEM, shipID: SHIP, sampledAtMs: 1234, entities: [], ship: null, timeDilation: 1,
  });
  assert.deepEqual((await pilots.readScannerState(handle, { userid: ACCOUNT })).scanner, {
    inSpace: false, solarSystemID: SYSTEM, shipID: SHIP, maxActiveProbes: 0, launcher: null, probes: [],
  });
});

/** A GetAllInfo answer holding the pilot's ship: 50 of 125 capacitor at the moment T. */
const DOGMA_T = 134359220000000000n;
const DOGMA_T_MS = 1791448400000;
const FITTED_MODULE = SHIP + 1;
const shipAllInfo = (charge = 50) => keyVal([["shipInfo", { type: "dict", entries: [
  [BigInt(SHIP), keyVal([
    ["itemID", BigInt(SHIP)], ["time", DOGMA_T],
    ["attributes", { type: "dict", entries: [[18, charge], [482, 125], [55, 62500], [263, 175], [265, 150], [9, 151]] }],
  ])],
  [BigInt(FITTED_MODULE), keyVal([["itemID", BigInt(FITTED_MODULE)], ["time", DOGMA_T], ["attributes", { type: "dict", entries: [[9, 40]] }], ["activeEffects", { type: "dict", entries: [] }]])],
] }]]);

test("the ship's capacitor and capacities are dogma's, loaded once for a ship in a place as godma loads them", async () => {
  const hand = handTicked();
  let clockMs = DOGMA_T_MS;
  const built = build({ ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": shipAllInfo() } }, { ...hand.options, now: () => clockMs, effectCategory: (effectID) => (effectID === 6731 ? 1 : null) });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const { session } = built;
  const asked = () => session.boundCalls.filter((call) => call.method === "GetAllInfo");

  const first = (await built.pilots.readSpaceSnapshot(handle)).space;
  assert.deepEqual([first.ship.capacitorRatio, first.ship.shieldCapacity, first.ship.armorCapacity, first.ship.hullCapacity], [0.4, 175, 150, 151].map((value, index) => (index === 0 ? first.ship.capacitorRatio : value)));
  assert.ok(Math.abs(first.ship.capacitorRatio - 0.4) < 1e-12);
  assert.equal(first.entities.find((row) => row.isSelf).capacitorRatio, first.ship.capacitorRatio);
  // The dogma location bound for where the pilot is, and asked as godma's Prime asks: a character, a ship, no structure.
  assert.deepEqual(session.binds.at(-1), { service: "dogmaIM", params: [SYSTEM, 5] });
  assert.deepEqual(asked().map((call) => [call.objectID, call.args]), [[`N=1:${session.objects}`, [true, true, null]]]);
  assert.deepEqual(built.pilots.callLedger().find((row) => row.pair === "dogmaIM.GetAllInfo").statuses, { same: 1 });

  // Ten seconds on, nothing asked again: the capacitor has recharged by itself.
  clockMs += 10000;
  const later = (await built.pilots.readSpaceSnapshot(handle)).space;
  assert.equal(asked().length, 1);
  // A recharge time of 62.5 s is a tau of 12.5 s: godma's curve from 0.4, ten seconds on.
  assert.ok(Math.abs(later.ship.capacitorRatio - (1 + (Math.sqrt(0.4) - 1) * Math.exp(-10000 / 12500)) ** 2) < 1e-12, `${later.ship.capacitorRatio} after ten seconds`);
  // The server reports a change: it is taken from the notification, still without asking.
  session.notify("OnModuleAttributeChanges", [{ type: "list", items: [["OnModuleAttributeChange", PILOT, BigInt(SHIP), 18, DOGMA_T + 100000000n, 100, 50, DOGMA_T + 100000000n]] }]);
  assert.ok(Math.abs((await built.pilots.readSpaceSnapshot(handle)).space.ship.capacitorRatio - 0.8) < 1e-12);
  // And the dogma messages that ride with a ballpark update reach the same place.
  session.notify("DoDestinyUpdate", [{ type: "list", items: [[hand.parks[0].space.park.currentTime, [Buffer.from("OnSpecialFX"), []]]] }, false,
    { type: "list", items: [[["OnModuleAttributeChange", PILOT, BigInt(SHIP), 18, DOGMA_T + 100000000n, 25, 100, DOGMA_T + 100000000n], DOGMA_T + 100000000n]] }]);
  assert.ok(Math.abs((await built.pilots.readSpaceSnapshot(handle)).space.ship.capacitorRatio - 0.2) < 1e-12);
  assert.equal(asked().length, 1);

  // A module starts, by the server's word, and is in the snapshot as running; it stops, and is not.
  assert.deepEqual((await built.pilots.readSpaceSnapshot(handle)).space.ship.activeModuleIDs, []);
  const effect = (active) => [BigInt(FITTED_MODULE), 6731, DOGMA_T, active, active, [BigInt(FITTED_MODULE), PILOT, BigInt(SHIP), null, null, [], 6731, null], DOGMA_T, 10000, 1000, null];
  session.notify("OnGodmaShipEffect", effect(1));
  assert.deepEqual((await built.pilots.readSpaceSnapshot(handle)).space.ship.activeModuleIDs, [FITTED_MODULE]);
  session.notify("OnGodmaShipEffect", effect(0));
  assert.deepEqual((await built.pilots.readSpaceSnapshot(handle)).space.ship.activeModuleIDs, []);
  assert.equal(asked().length, 1);

  // Another ship: what was loaded was the old one's, so it is asked for again.
  session.attributes.shipid = 77;
  session.change({ shipid: [SHIP, 77] });
  await built.pilots.readSpaceSnapshot(handle);
  assert.equal(asked().length, 2);
  assert.deepEqual(hand.errors, []);
});

test("if dogma cannot be asked, the snapshot still answers and the readings say unknown", async () => {
  const hand = handTicked();
  const built = build({ ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": () => { throw new Error("not now"); } } }, hand.options);
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const { space } = await built.pilots.readSpaceSnapshot(handle);
  assert.deepEqual([space.entities.length, space.ship.capacitorRatio, space.ship.shieldCapacity, space.ship.mode], [76, null, null, "GOTO"]);
  // It is tried again the next time, not given up on.
  await built.pilots.readSpaceSnapshot(handle);
  assert.equal(built.session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 2);
  // A connection lost in the asking is the session ending.
  const other = handTicked();
  const gone = build({ ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": () => { throw sessionError("CONNECTION_LOST"); } } }, other.options);
  const lost = await gone.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await gone.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, lost.bridgeSessionID);
  for (const update of recordedUpdates.slice(0, 5)) gone.session.notify("DoDestinyUpdate", update.args);
  other.parks[0].tick();
  await rejects(gone.pilots.readSpaceSnapshot(lost.bridgeSessionID), "SESSION_NOT_FOUND");
  assert.deepEqual([gone.session.closed, other.parks[0].stopped], [true, true]);
});

test("undocking is sent; reaching space makes the ballpark, docking lets it go, and another system gets another", async () => {
  const hand = handTicked();
  const { pilots, session, handle } = await selected({}, hand.options);
  const ship = await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHOSE, handle);
  await pilots.callBoundMethod("ship", "Undock", [SHIP, false], null, WHOSE, handle, ship.boundHandle);
  // With the client's keyword: its online modules by slot, of which this ship's dogma names none. Godma's dogma
  // location was bound first, to be primed; the ship's moniker binds with the undock itself.
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:2", method: "Undock", args: [SHIP, false], kwargs: { onlineModules: { type: "dict", entries: [] } } });
  assert.deepEqual([session.binds.map((bind) => bind.service), session.carried], [["dogmaIM", "ship"], ["GetAllInfo", "Undock"]]);
  assert.equal(hand.parks.length, 0, "docked: no ballpark");

  // The session reaches space.
  delete session.attributes.stationid;
  session.attributes.solarsystemid = SYSTEM;
  session.change({ stationid: [STATION, null], solarsystemid: [null, SYSTEM], locationid: [STATION, SYSTEM] });
  await pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  assert.deepEqual([hand.parks.length, hand.parks[0].space.solarSystemID, session.binds.at(-1)], [1, SYSTEM, { service: "beyonce", params: SYSTEM }]);
  const { flight } = await pilots.readFlightStatus(handle);
  assert.deepEqual([flight.inSpace, flight.docked, flight.stationID, flight.solarSystemID], [true, false, null, SYSTEM]);
  // A change that is not about where the pilot is leaves the ballpark alone.
  session.change({ shipid: [SHIP, 77] });
  assert.deepEqual([hand.parks.length, hand.parks[0].stopped], [1, false]);

  // A gate jump: a new system, so the old ballpark goes and a new one is made and bound.
  const NEXT = 30000144;
  Object.assign(session.attributes, { solarsystemid: NEXT, solarsystemid2: NEXT });
  session.change({ solarsystemid: [SYSTEM, NEXT], solarsystemid2: [SYSTEM, NEXT], locationid: [SYSTEM, NEXT] });
  await pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  assert.deepEqual([hand.parks.length, hand.parks[0].stopped, hand.parks[1].space.solarSystemID, session.binds.at(-1)], [2, true, NEXT, { service: "beyonce", params: NEXT }]);
  // An update that comes for the old park after it was let go is not applied to anything.
  assert.equal(hand.parks[0].space.feed({ method: "DoDestinyUpdate", args: recordedUpdates[2].args }), false);

  // Docking: the ballpark is let go, and the snapshot says docked.
  session.attributes.stationid = 60000004;
  delete session.attributes.solarsystemid;
  session.change({ stationid: [null, 60000004], solarsystemid: [NEXT, null], locationid: [NEXT, 60000004] });
  assert.deepEqual([hand.parks.length, hand.parks[1].stopped], [2, true]);
  const { space } = await pilots.readSpaceSnapshot(handle);
  assert.deepEqual([space.inSpace, space.entities, space.ship], [false, [], null]);
  assert.deepEqual(hand.errors, []);
});

test("a pilot's ballpark ends with its session, and what goes wrong in the park's own time is reported, not thrown", async () => {
  const hand = handTicked();
  const built = build(IN_SPACE, hand.options);
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  // An update the park cannot read at all.
  built.session.notify("DoDestinyUpdate", [{ type: "list", items: [[7, null]] }, false]);
  assert.deepEqual(hand.errors.map(([what]) => what), ["DoDestinyUpdate"]);
  await built.pilots.releaseBridgeSession(handle, WHOSE);
  assert.equal(hand.parks[0].stopped, true);
});

// ── bound objects ────────────────────────────────────────────────────────────

const WHO = { userid: ACCOUNT };
const STRUCTURE = 1030000000001;

test("the hangar is bound as invCache binds it: the station's manager, then GetInventory(containerHangar, None)", async () => {
  const { pilots, session, handle } = await selected();
  const bound = await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  assert.deepEqual(session.binds, [{ service: "invbroker", params: [STATION, 15] }]);
  assert.deepEqual(session.boundCalls, [{ objectID: "N=1:1", method: "GetInventory", args: [10004, null], kwargs: null }]);
  assert.deepEqual({ ...bound, boundHandle: "h" }, { boundHandle: "h", service: "invbroker", method: "GetInventory", notifications: [] });
  assert.match(bound.boundHandle, /^[A-Za-z0-9_-]{32}$/);

  // A call on the handle goes to the inventory the manager handed back, not to the manager.
  await pilots.callBoundMethod("invbroker", "StackAll", [4], null, WHO, handle, bound.boundHandle);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:2", method: "StackAll", args: [4], kwargs: null });

  // The manager is a moniker the client keeps: bound once, asked again.
  await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  assert.equal(session.binds.length, 1);
  assert.equal(session.boundCalls.filter((call) => call.method === "GetInventory").length, 2);
});

test("in a structure the hangar is containerStructure, from the manager for where the pilot is", async () => {
  const { pilots, session, handle } = await selected();
  delete session.attributes.stationid;
  Object.assign(session.attributes, { structureid: STRUCTURE, solarsystemid: SYSTEM });
  await pilots.bindObject("invbroker", "GetInventory", [STRUCTURE], null, WHO, handle);
  assert.deepEqual(session.binds, [{ service: "invbroker", params: [SYSTEM, 5] }]);
  assert.deepEqual(session.boundCalls[0].args, [10014, null]);
});

test("a hangar somewhere the pilot is not docked is refused before anything is sent", async () => {
  const { pilots, session, handle } = await selected();
  await rejects(pilots.bindObject("invbroker", "GetInventory", [60000004], null, WHO, handle), "CALL_REFUSED", /not docked there/);
  await rejects(pilots.bindObject("invbroker", "GetInventory", [], null, WHO, handle), "CALL_REFUSED");
  assert.deepEqual([session.binds, session.boundCalls], [[], []]);
});

test("an item's inventory is GetInventoryFromId(itemID, passive), both positional, on the manager for where the pilot is", async () => {
  const { pilots, session, handle } = await selected();
  await pilots.bindObject("invbroker", "GetInventoryFromId", [SHIP], { passive: 0 }, WHO, handle);
  await pilots.bindObject("invbroker", "GetInventoryFromId", [77], { passive: 1 }, WHO, handle);
  await pilots.bindObject("invbroker", "GetInventoryFromId", [78], null, WHO, handle);
  assert.deepEqual(session.binds, [{ service: "invbroker", params: [STATION, 15] }]);
  assert.deepEqual(session.boundCalls.map((call) => [call.method, call.args, call.kwargs]), [
    ["GetInventoryFromId", [SHIP, 0], null],
    ["GetInventoryFromId", [77, 1], null],
    ["GetInventoryFromId", [78, 0], null],
  ]);
});

test("the two inventory managers are two monikers, as invCache keeps them", async () => {
  const { pilots, session, handle } = await selected();
  await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  await pilots.bindObject("invbroker", "GetInventoryFromId", [SHIP], { passive: 0 }, WHO, handle);
  assert.deepEqual(session.binds, [{ service: "invbroker", params: [STATION, 15] }, { service: "invbroker", params: [STATION, 15] }]);
  assert.deepEqual(session.boundCalls.map((call) => call.objectID), ["N=1:1", "N=1:3"]);
});

/** Every service a test binds, with something to ask of what it binds. */
const ASKABLE = { allowed: new Set(["ship", "invbroker", "dogmaIM", "agentMgr", "planetMgr", "charMgr", "reprocessingSvc", "fleetObjectHandler", "entity", "beyonce"].flatMap((service) => [`${service}.MachoBindObject`, `${service}.Ask`])) };

test("a service's object is bound with what the retail client's moniker for it carries", async () => {
  const docked = await selected(undefined, ASKABLE);
  // A moniker binds when it is first called: each is made and asked one thing.
  const bind = async (service, args) => {
    const { boundHandle } = await docked.pilots.bindObject(service, "MachoBindObject", args, null, WHO, docked.handle);
    await docked.pilots.callBoundMethod(service, "Ask", [], null, WHO, docked.handle, boundHandle);
  };
  // Bound for where the pilot is, whatever the BFF passed.
  await bind("ship", [[STATION, 15]]);
  await bind("invbroker", [[STRUCTURE, 15]]);
  await bind("dogmaIM", []);
  // Bound for what they are asked for.
  await bind("agentMgr", [3008416]);
  await bind("planetMgr", [40176368]);
  await bind("charMgr", [[PILOT, 10002]]);
  await bind("reprocessingSvc", [STATION]);
  // A fleet by its ID alone, not the one-tuple the BFF wraps it in; none is None, as session.fleetid is.
  await bind("fleetObjectHandler", [[1099511627776]]);
  await bind("fleetObjectHandler", []);
  assert.deepEqual(docked.session.binds, [
    { service: "ship", params: [STATION, 15] },
    { service: "invbroker", params: [STATION, 15] },
    { service: "dogmaIM", params: [STATION, 15] },
    { service: "agentMgr", params: 3008416 },
    { service: "planetMgr", params: 40176368 },
    { service: "charMgr", params: [PILOT, 10002] },
    { service: "reprocessingSvc", params: STATION },
    { service: "fleetObjectHandler", params: 1099511627776 },
    { service: "fleetObjectHandler", params: null },
  ]);

  docked.session.attributes.fleetid = 1099511627777;
  await bind("fleetObjectHandler", []);
  assert.equal(docked.session.binds.at(-1).params, 1099511627777);
});

test("what only exists in space has no moniker while docked, and its own once there", async () => {
  const { pilots, session, handle } = await selected(undefined, ASKABLE);
  await rejects(pilots.bindObject("entity", "MachoBindObject", [], null, WHO, handle), "BOUND_NO_OBJECT", /entity\.MachoBindObject did not return a bound object/);
  await rejects(pilots.bindObject("beyonce", "MachoBindObject", [[SYSTEM, 5]], null, WHO, handle), "BOUND_NO_OBJECT");
  assert.deepEqual(session.binds, []);

  delete session.attributes.stationid;
  session.attributes.solarsystemid = SYSTEM;
  // Each binds when it is first called, by what it was made with.
  for (const [service, args] of [["entity", []], ["beyonce", [[SYSTEM, 5]]], ["ship", [[STATION, 15]]]]) {
    const { boundHandle } = await pilots.bindObject(service, "MachoBindObject", args, null, WHO, handle);
    assert.equal(session.binds.some((bind) => bind.service === service), false, `${service}: nothing is sent for the making of it`);
    await pilots.callBoundMethod(service, "Ask", [], null, WHO, handle, boundHandle);
  }
  assert.deepEqual(session.binds, [
    { service: "entity", params: SYSTEM },
    { service: "beyonce", params: SYSTEM },
    { service: "ship", params: [SYSTEM, 5] },
  ]);
});

test("a service's own method that answers with a bound object is called, and the object kept", async () => {
  const { pilots, session, handle } = await selected({ answers: {
    "fleetObjectHandler.CreateFleet": () => boundObject("N=1:900"),
    "scanMgr.GetSystemScanMgr": () => null,
  } });
  const bound = await pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, handle);
  assert.deepEqual(session.calls.at(-1), { service: "fleetObjectHandler", method: "CreateFleet", args: [], kwargs: null });
  assert.deepEqual(session.binds, []);
  await pilots.callBoundMethod("fleetObjectHandler", "CreateFleet", [], null, WHO, handle, bound.boundHandle);
  assert.equal(session.boundCalls.at(-1).objectID, "N=1:900");
  await rejects(pilots.bindObject("scanMgr", "GetSystemScanMgr", [], null, WHO, handle), "BOUND_NO_OBJECT", /scanMgr\.GetSystemScanMgr/);
});

test("a call on a bound object sends the arguments, answers in the gateway's JSON and drains the backlog", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:Add": () => ({ type: "list", items: [[SHIP, 134359051855730000n], Buffer.from("Reaper")] }) } });
  const { boundHandle } = await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  session.notify("OnItemsChanged");
  const args = [4, { type: "long", value: "5" }, { type: "Buffer", data: [1, 2] }];
  const outcome = await pilots.callBoundMethod("invbroker", "Add", args, { flag: 5 }, WHO, handle, boundHandle);
  assert.deepEqual(outcome.result, { type: "list", items: [[SHIP, { type: "long", value: "134359051855730000" }], "Reaper"] });
  assert.deepEqual([outcome.service, outcome.method, outcome.notifications.length], ["invbroker", "Add", 1]);
  assert.deepEqual(session.boundCalls.at(-1).args, [4, { type: "long", value: "5" }, Buffer.from([1, 2])]);
  assert.deepEqual(session.boundCalls.at(-1).kwargs, { flag: 5 });
});

test("a call goes out as the retail client sends it, on a service and on a bound object alike", async () => {
  const { pilots, session, handle } = await selected({}, { allowed: new Set(["invbroker.GetInventory", "invbroker.List", "invbroker.ListByFlags", "invbroker.MultiAdd", "invbroker.GetCapacity", "invbroker.Add", "station.GetGuests"]) });
  const { boundHandle } = await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  const sent = async (method, args, kwargs = null) => {
    await pilots.callBoundMethod("invbroker", method, args, kwargs, WHO, handle, boundHandle);
    const { args: sentArgs, kwargs: sentKwargs } = session.boundCalls.at(-1);
    return [sentArgs, sentKwargs];
  };
  // invCache.py: self.moniker.List(flag=flag), self.moniker.ListByFlags(flags=[...]), self.moniker.MultiAdd(list(...), sourceID, **kw)
  assert.deepEqual(await sent("List", [4]), [[], { flag: 4 }]);
  assert.deepEqual(await sent("List", []), [[], { flag: null }]);
  assert.deepEqual(await sent("ListByFlags", [[11, 12]]), [[], { flags: { type: "list", items: [11, 12] } }]);
  assert.deepEqual(await sent("MultiAdd", [[100, 101], STATION], { flag: 5 }), [[{ type: "list", items: [100, 101] }, STATION], { flag: 5 }]);
  // A call the client never makes, and one nobody has checked, go out as the BFF spelt them.
  assert.deepEqual(await sent("GetCapacity", [5]), [[5], null]);
  await pilots.callMethod("station", "GetGuests", [], null, WHO, handle);
  assert.deepEqual(session.calls.at(-1).args, []);
});

test("a service's call is reshaped by the same registry as a bound object's", async () => {
  const asked = [];
  const { pilots, session, handle } = await selected({}, {
    shape(service, method, args, kwargs) {
      asked.push([service, method, args, kwargs]);
      return service === "station"
        ? { args: [{ type: "list", items: args }], kwargs: { where: 1 }, status: "reshaped", source: "x.py:1", note: null }
        : { args, kwargs, status: "unchecked", source: null, note: null };
    },
  });
  await pilots.callMethod("station", "GetGuests", [7, 8], null, WHO, handle);
  assert.deepEqual(session.calls.at(-1), { service: "station", method: "GetGuests", args: [{ type: "list", items: [7, 8] }], kwargs: { where: 1 } });
  assert.deepEqual(asked.at(-1), ["station", "GetGuests", [7, 8], null]);
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "station.GetGuests").statuses, { reshaped: 1 });
});

test("the transport keeps a tally of what it called and how each compared with the retail client", async () => {
  // One pair nobody has read against the client is on this allowlist, so that every kind of status is tallied.
  const { pilots, handle } = await selected({}, { allowed: new Set(["invbroker.GetInventory", "invbroker.MachoBindObject", "invbroker.GetCapacity", "invbroker.List", "invbroker.Add", "station.GetGuests", "someService.SomeMethod"]) });
  const { boundHandle } = await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  // Three times, which is once more than a choosing asks anything.
  for (let time = 0; time < 3; time += 1) await pilots.callBoundMethod("invbroker", "GetCapacity", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "List", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "Add", [1, STATION], { flag: 5 }, WHO, handle, boundHandle);
  await pilots.callMethod("station", "GetGuests", [], null, WHO, handle);
  await pilots.callMethod("someService", "SomeMethod", [], null, WHO, handle);
  await rejects(pilots.callMethod("machoNet", "GetTime", [], null, WHO, handle), "CALL_NOT_ALLOWED");
  const tally = Object.fromEntries(pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual(tally, {
    "invbroker.GetCapacity": { "web-only": 3 },
    "charUnboundMgr.GetCharacterLockType": { same: 1 },
    "charUnboundMgr.GetCharacterSelectionData": { same: 1 },
    "charUnboundMgr.SelectCharacterID": { same: 1 },
    "standingMgr.GetNPCNPCStandings": { same: 1 },
    "standingMgr.GetCharStandings": { same: 1 },
    // Asked for and not answered by this stand-in: nothing was asked of a handler, and nothing of one is tallied.
    "skillMgr2.GetMySkillHandler": { same: 1 },
    "agentMgr.GetMyJournalDetails": { same: 1 },
    "agentMgr.GetAgents": { same: 1 },
    "notificationMgr.GetAllNotifications": { same: 1 },
    "contractProxy.GetLoginInfo": { same: 1 },
    "calendarProxy.GetEventList": { same: 2 },
    "charMgr.GetContactList": { same: 1 },
    "onlineStatus.GetInitialState": { same: 1 },
    "corpRegistry.GetAggressionSettings": { same: 1 },
    "corpRegistry.GetEveOwners": { same: 1 },
    "corpRegistry.GetMyApplications": { same: 1 },
    "invbroker.Add": { differs: 1 },
    "invbroker.GetInventory": { reshaped: 1 },
    "invbroker.List": { reshaped: 1 },
    "station.GetGuests": { same: 1 },
    "someService.SomeMethod": { unchecked: 1 },
  });
  assert.equal(pilots.callLedger()[0].pair, "invbroker.GetCapacity", "most called first");
});

test("a bound call needs a handle of this session, for this service, and a method on the allowlist", async () => {
  const one = await selected();
  const other = await selected();
  const { boundHandle } = await one.pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, one.handle);
  const sent = one.session.boundCalls.length;
  await rejects(one.pilots.callBoundMethod("invbroker", "List", [], null, WHO, one.handle, "not-a-handle"), "BOUND_HANDLE_NOT_FOUND", /Unknown bound-object handle/);
  await rejects(one.pilots.callBoundMethod("invbroker", "List", [], null, WHO, one.handle, undefined), "BOUND_HANDLE_NOT_FOUND");
  await rejects(one.pilots.callBoundMethod("ship", "Board", [], null, WHO, one.handle, boundHandle), "BOUND_HANDLE_NOT_FOUND", /does not belong to the requested service/);
  await rejects(one.pilots.callBoundMethod("invbroker", "TrashItems", [], null, WHO, one.handle, boundHandle), "CALL_NOT_ALLOWED");
  await rejects(one.pilots.callBoundMethod("invbroker", "List", [], null, { userid: 9 }, one.handle, boundHandle), "SESSION_NOT_FOUND");
  // Another pilot's session does not know this one's handle.
  await rejects(other.pilots.callBoundMethod("invbroker", "List", [], null, WHO, other.handle, boundHandle), "BOUND_HANDLE_NOT_FOUND");
  assert.equal(one.session.boundCalls.length, sent);
  assert.equal(other.session.boundCalls.length, 0);
});

test("a bind that is not on the allowlist is not made", async () => {
  const { pilots, session, handle } = await selected();
  await rejects(pilots.bindObject("corpRegistry", "MachoBindObject", [98000001], null, WHO, handle), "CALL_NOT_ALLOWED");
  assert.deepEqual(session.binds, []);
});


test("when the pilot moves, what was bound for the old place is forgotten, and the rest is kept", async () => {
  const { pilots, session, handle } = await selected();
  const hangar = (await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle)).boundHandle;
  const ship = (await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHO, handle)).boundHandle;
  const agent = (await pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, handle)).boundHandle;
  // Something that is not about where the pilot is changes nothing.
  session.change({ shipid: [SHIP, 77] });
  await pilots.callBoundMethod("invbroker", "List", [], null, WHO, handle, hangar);

  session.attributes.stationid = 60000004;
  session.change({ stationid: [STATION, 60000004], locationid: [STATION, 60000004] });
  await rejects(pilots.callBoundMethod("invbroker", "List", [], null, WHO, handle, hangar), "BOUND_HANDLE_NOT_FOUND");
  await rejects(pilots.callBoundMethod("ship", "Board", [1], null, WHO, handle, ship), "BOUND_HANDLE_NOT_FOUND");
  await pilots.callBoundMethod("agentMgr", "DoAction", [], null, WHO, handle, agent);

  // Bound again, it is the new place's manager, bound afresh.
  const binds = session.binds.length;
  await pilots.bindObject("invbroker", "GetInventory", [60000004], null, WHO, handle);
  assert.deepEqual(session.binds.slice(binds), [{ service: "invbroker", params: [60000004, 15] }]);
});

test("when the server says a bound object is gone, its handle is forgotten, as the client forgets the object", async () => {
  // machoNet.OnMachoObjectDisconnect(objectID, clientID, refID) -> session.UnregisterMachoObject(objectID, refID)
  const { pilots, session, handle } = await selected();
  const hangar = (await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle)).boundHandle;
  const agent = (await pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, handle)).boundHandle;
  await pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, handle, agent);
  // The hangar is "N=1:2" (the manager that made it is "N=1:1"); the agent's object, bound by that call, is "N=1:3".
  session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:3"), 1065450, null]);
  await rejects(pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, handle, agent), "BOUND_HANDLE_NOT_FOUND");
  await pilots.callBoundMethod("invbroker", "StackAll", [4], null, WHO, handle, hangar);

  // The inventory manager going takes nothing else with it, but the next hangar bind makes a new one.
  session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:1"), 1065450, null]);
  await pilots.callBoundMethod("invbroker", "StackAll", [4], null, WHO, handle, hangar);
  const binds = session.binds.length;
  await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  assert.equal(session.binds.length, binds + 1, "the manager is bound afresh");

  // The notice still reaches the browser, as on the gateway, and an object nobody holds is no trouble.
  session.notify("OnMachoObjectDisconnect", [Buffer.from("N=9:9"), 1065450, null]);
  const { notifications } = await pilots.callMethod("station", "GetGuests", [], null, WHO, handle);
  // (The two before it went out on the answers above, which drained them.)
  assert.deepEqual(notifications.map((n) => [n.method, n.args[0]]), [["OnMachoObjectDisconnect", "N=9:9"]]);
});

test("a bind's failures are the gateway's: no object, a refusal, a lost session", async () => {
  // (A moniker's own, which come when it is first called, are in "a moniker whose bind finds no object".)
  const nowhere = await selected({ answers: { "bind:invbroker": () => { throw sessionError("RESOLVE_FAILED", "invbroker could not say where its object lives."); } } });
  await rejects(nowhere.pilots.bindObject("invbroker", "GetInventoryFromId", [5], null, WHO, nowhere.handle), "BOUND_NO_OBJECT");
  const empty = await selected({ answers: { "bound:GetInventoryFromId": () => null } });
  await rejects(empty.pilots.bindObject("invbroker", "GetInventoryFromId", [5], null, WHO, empty.handle), "BOUND_NO_OBJECT");

  const refused = await selected({ answers: { "bound:GetInventoryFromId": () => { throw refusedBy("FakeItemNotFound"); } } });
  await rejects(refused.pilots.bindObject("invbroker", "GetInventoryFromId", [5], null, WHO, refused.handle), "CALL_REFUSED", /^FakeItemNotFound$/);
  // A failed bind leaves no handle behind, and the manager it did bind is still the manager.
  assert.equal(refused.session.binds.length, 1);

  const lost = await selected({ answers: { "bind:invbroker": () => { throw sessionError("CONNECTION_LOST"); } } });
  await rejects(lost.pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, lost.handle), "SESSION_NOT_FOUND");
  assert.equal(lost.pilots.size, 0);

  const failing = await selected({ answers: { "bound:List": () => { throw refusedBy("CustomNotify", "That container is locked."); } } });
  const { boundHandle } = await failing.pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, failing.handle);
  await rejects(failing.pilots.callBoundMethod("invbroker", "List", [], null, WHO, failing.handle, boundHandle), "CALL_REFUSED", /^That container is locked\.$/);
});

test("a bound object is found wherever an answer carries it", () => {
  assert.equal(boundObjectID(boundObject("N=65450:12")), "N=65450:12");
  // The (object, result) pair a bind answers with, and one nested in a list.
  assert.equal(boundObjectID([boundObject("N=1:2"), null]), "N=1:2");
  assert.equal(boundObjectID({ type: "list", items: [1, [boundObject("N=1:3")]] }), "N=1:3");
  // A substruct given without its substream, and an ID that is already text.
  assert.equal(boundObjectID({ type: "substruct", value: ["N=1:4", 0n] }), "N=1:4");
  // The first one found is the one.
  assert.equal(boundObjectID([boundObject("N=1:5"), boundObject("N=1:6")]), "N=1:5");
  for (const nothing of [null, undefined, 7, "N=1:2", Buffer.from("N=1:2"), [], { type: "list", items: [] }, { type: "substruct", value: { type: "substream", value: [Buffer.from("not an object"), 0n] } }]) {
    assert.equal(boundObjectID(nothing), null);
  }
});

// ── arguments ────────────────────────────────────────────────────────────────

test("JSON arguments become what the client's marshaller takes, and nothing else changes", () => {
  assert.deepEqual(argumentsToWire([1, "a", null, true, 1.5]), [1, "a", null, true, 1.5]);
  const long = { type: "long", value: "134359051855730000" };
  assert.equal(argumentsToWire(long), long);
  assert.deepEqual(argumentsToWire({ type: "Buffer", data: [1, 2, 255] }), Buffer.from([1, 2, 255]));
  assert.deepEqual(argumentsToWire({ type: "bytes", value: { type: "Buffer", data: [9] } }), Buffer.from([9]));
  assert.deepEqual(
    argumentsToWire({ type: "list", items: [{ type: "Buffer", data: [1] }, [{ type: "Buffer", data: [2] }]] }),
    { type: "list", items: [Buffer.from([1]), [Buffer.from([2])]] },
  );
  assert.deepEqual(
    argumentsToWire({ type: "dict", entries: [["k", { type: "Buffer", data: [3] }]] }),
    { type: "dict", entries: [["k", Buffer.from([3])]] },
  );
  assert.deepEqual(
    argumentsToWire({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["b", { type: "Buffer", data: [4] }]] } }),
    { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["b", Buffer.from([4])]] } },
  );
  const wide = { type: "wstring", value: "Jita" };
  assert.equal(argumentsToWire(wide), wide);
  // A bare object is not a marshal value. It is left for the encoder to refuse by name.
  const bare = { kicked: [] };
  assert.equal(argumentsToWire(bare), bare);
});

// ── what the server asks the client ──────────────────────────────────────────

test("with nobody watching the pilot, the server's question before a mission is quit is answered Yes, and a cache it wants forgotten is None", async () => {
  const told = [];
  const { pilots, made } = build({}, { onClientCall: (call, characterID) => told.push([characterID, call.service, call.method, call.answered, call.answer]) });
  await pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const session = made[0];

  assert.equal(await session.ask("agents", "YesNo", [["UI/Agents/StandardMission/QuitMissionTitle", {}], ["UI/Agents/StandardMission/QuitMissionMessage", {}], 3008416, 4802, "AgtQuitMission"]), true);
  assert.equal(await session.ask("objectCaching", "InvalidateCachedMethodCall", ["charFittingMgr", "GetFittings", PILOT]), null);
  assert.equal(await session.ask("objectCaching", "InvalidateCachedMethodCalls", [[]]), null);
  // A box nobody is there to see is dismissed, as its Cancel button would: not OK, and no number.
  assert.deepEqual(await session.ask("agents", "SingleChoiceBox", ["title", "body", { type: "list", items: ["a", "b"] }]), [false, "radioboxOption1Selected"]);
  assert.equal(await session.ask("agents", "GetQuantity", []), null);
  // The customs question is left unanswered: the server decides for itself when a player is not there.
  assert.equal(await session.ask("XmppChat", "AskYesNoQuestion", ["ChtCustomsConfiscationConfirmation2", { type: "dict", entries: [] }]), undefined);
  // And what this client has no such service for stays unanswered.
  assert.equal(await session.ask("agents", "RemoteNamePopup", ["caption", "label", 1]), undefined);

  assert.deepEqual(told, [
    [PILOT, "agents", "YesNo", true, true],
    [PILOT, "objectCaching", "InvalidateCachedMethodCall", true, null],
    [PILOT, "objectCaching", "InvalidateCachedMethodCalls", true, null],
    [PILOT, "agents", "SingleChoiceBox", true, [false, "radioboxOption1Selected"]],
    [PILOT, "agents", "GetQuantity", true, null],
    [PILOT, "XmppChat", "AskYesNoQuestion", false, undefined],
    [PILOT, "agents", "RemoteNamePopup", false, undefined],
  ]);
});

test("who answers the server's questions can be put in from outside, and is told whose pilot is asked", async () => {
  const asked = [];
  const { pilots, made } = build({}, { answerClientCall: (call, characterID) => { asked.push([characterID, call.method]); return false; } });
  await pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  assert.equal(await made[0].ask("agents", "YesNo", []), false);
  assert.deepEqual(asked, [[PILOT, "YesNo"]]);
});

// ── the server's questions, put to the user ──────────────────────────────────

const DECLINE_QUESTION = [
  ["UI/Agents/StandardMission/DeclineMissionTitle", { type: "dict", entries: [] }],
  ["UI/Agents/StandardMission/DeclineMessage", { type: "dict", entries: [["when", 134359400000000000n]] }],
  3008416,
  4802,
  "AgtDeclineMission",
];

/** A selected pilot with a browser on its stream: the frames it is sent, and timers that fire only when told to. */
async function watched(pilotOptions = {}) {
  const pending = new Map();
  let sequence = 0;
  const timers = {
    setTimeout: (action, delay) => { sequence += 1; pending.set(sequence, { action, delay }); return sequence; },
    clearTimeout: (id) => pending.delete(id),
  };
  const built = build({}, { timers, ...pilotOptions });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const frames = [];
  const stream = built.pilots.openSessionEventStream({ bridgeSessionID: handle, userid: ACCOUNT, onFrame: (frame) => frames.push(frame) });
  await tick();
  frames.length = 0;
  const events = () => frames.filter((frame) => frame.type === "event").map((frame) => frame.event);
  return { ...built, handle, stream, frames, events, timers: pending };
}

test("with a browser on the pilot's stream, the server's question goes to it, and the user's answer goes back to the server", async () => {
  for (const answer of [false, true]) {
    const { pilots, session, handle, events } = await watched({ now: () => 1_000_000, questionWaitMs: 110_000 });
    let settled;
    const asking = session.ask("agents", "YesNo", DECLINE_QUESTION).then((value) => { settled = value; });
    await tick();
    assert.equal(settled, undefined, "the server is kept waiting until the user has answered");

    const [asked] = events();
    assert.equal(asked.kind, "question");
    const { id, ...question } = asked.question;
    assert.match(id, /^[\w-]{12}$/);
    assert.deepEqual(question, {
      service: "agents",
      method: "YesNo",
      kind: "yesNo",
      title: { label: "UI/Agents/StandardMission/DeclineMissionTitle", parameters: { type: "dict", entries: [] }, text: null },
      body: { label: "UI/Agents/StandardMission/DeclineMessage", parameters: { type: "dict", entries: [["when", { type: "long", value: "134359400000000000" }]] }, text: null },
      agentID: 3008416,
      contentID: 4802,
      suppressID: "AgtDeclineMission",
      askedAtMs: 1_000_000,
      expiresAtMs: 1_110_000,
    });

    assert.deepEqual(await pilots.answerClientQuestion(handle, id, answer, FIELDS), { answered: true, questionID: id });
    await asking;
    assert.equal(settled, answer);
    assert.deepEqual(events().slice(1), [{ kind: "question-closed", id, reason: "answered" }]);
    // Answered once: it is no longer open.
    await rejects(pilots.answerClientQuestion(handle, id, true, FIELDS), "QUESTION_NOT_FOUND", /no longer open/);
  }
});

test("a question takes plain text as well as a label, and is never mixed in with the notifications", async () => {
  const { pilots, session, handle, events } = await watched();
  const asking = session.ask("agents", "YesNo", ["Cancel research?", Buffer.from("You will lose the points."), 3008416]);
  await tick();
  const { question } = events()[0];
  assert.deepEqual(question.title, { label: null, parameters: null, text: "Cancel research?" });
  assert.deepEqual(question.body, { label: null, parameters: null, text: "You will lose the points." });
  assert.equal(question.contentID, null);
  assert.equal(question.suppressID, null);
  // What a call returns beside its answer is the server's notifications, and a question is not one.
  const called = await pilots.callMethod("station", "GetGuests", [], null, FIELDS, handle);
  assert.deepEqual(called.notifications, []);
  await pilots.answerClientQuestion(handle, question.id, true, FIELDS);
  assert.equal(await asking, true);
});

test("an answer the question cannot take is refused, the question stays open, and only the pilot's own account answers it", async () => {
  const { pilots, session, handle, events } = await watched();
  let settled;
  const asking = session.ask("agents", "YesNo", DECLINE_QUESTION).then((value) => { settled = value; });
  await tick();
  const { id } = events()[0].question;
  for (const wrong of ["yes", 1, null, undefined, {}]) {
    await rejects(pilots.answerClientQuestion(handle, id, wrong, FIELDS), "CALL_INVALID", /not an answer/);
  }
  await rejects(pilots.answerClientQuestion(handle, id, true, { userid: ACCOUNT + 1 }), "SESSION_NOT_FOUND");
  await rejects(pilots.answerClientQuestion(handle, "", true, FIELDS), "QUESTION_NOT_FOUND");
  await tick();
  assert.equal(settled, undefined, "still open");
  await pilots.answerClientQuestion(handle, id, true, FIELDS);
  await asking;
  assert.equal(settled, true);
});

test("a question the user leaves unanswered closes as No when its time is up, as closing the window does", async () => {
  const { pilots, session, handle, events, timers } = await watched({ questionWaitMs: 110_000 });
  let settled;
  const asking = session.ask("agents", "YesNo", DECLINE_QUESTION).then((value) => { settled = value; });
  await tick();
  const { id } = events()[0].question;
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [110_000]);
  [...timers.values()][0].action();
  await asking;
  assert.equal(settled, false);
  assert.deepEqual(events().slice(1), [{ kind: "question-closed", id, reason: "expired" }]);
  await rejects(pilots.answerClientQuestion(handle, id, true, FIELDS), "QUESTION_NOT_FOUND");
});

test("an answered question's clock is stopped, and two questions are two", async () => {
  const { pilots, session, handle, events, timers } = await watched();
  const first = session.ask("agents", "YesNo", DECLINE_QUESTION);
  const second = session.ask("agents", "YesNo", DECLINE_QUESTION);
  await tick();
  const ids = events().map((event) => event.question.id);
  assert.equal(new Set(ids).size, 2);
  assert.equal(timers.size, 2);
  const clocks = [...timers.values()];
  await pilots.answerClientQuestion(handle, ids[1], true, FIELDS);
  assert.equal(await second, true);
  assert.equal(timers.size, 1, "the answered question's timer is gone, the other's is running");
  await pilots.answerClientQuestion(handle, ids[0], false, FIELDS);
  assert.equal(await first, false);
  assert.equal(timers.size, 0);
  // A clock that fires late, after its question was answered, closes nothing a second time.
  const before = events().length;
  for (const clock of clocks) clock.action();
  assert.equal(events().length, before);
});

test("once the browser has gone, the next question is answered as with nobody watching; one already open stays open", async () => {
  const { pilots, session, handle, stream, events } = await watched();
  let settled;
  const open = session.ask("agents", "YesNo", DECLINE_QUESTION).then((value) => { settled = value; });
  await tick();
  const { id } = events()[0].question;
  stream.close();
  assert.equal(await session.ask("agents", "YesNo", DECLINE_QUESTION), true);
  await tick();
  assert.equal(settled, undefined);
  await pilots.answerClientQuestion(handle, id, false, FIELDS);
  await open;
  assert.equal(settled, false);
});

test("when the pilot's session ends, its open questions close unanswered", async () => {
  const { pilots, session, handle, events, timers } = await watched();
  let settled;
  const asking = session.ask("agents", "YesNo", DECLINE_QUESTION).then((value) => { settled = value; });
  await tick();
  const { id } = events()[0].question;
  await pilots.releaseBridgeSession(handle, FIELDS);
  await asking;
  assert.equal(settled, false);
  assert.equal(timers.size, 0);
  await rejects(pilots.answerClientQuestion(handle, id, true, FIELDS), "SESSION_NOT_FOUND");
});

// ── a research agent's boxes, and the customs question ───────────────────────
//
// The arguments are the ones eve.js sends: researchRuntime.buildFieldChoicePrompt and buildDatacorePrompt through
// researchDialogue.js, and customsInspectionPresentation.buildConfiscationDialogArguments.

const label = (path, entries = []) => [path, { type: "dict", entries }];
const FIELD_CHOICE = [
  label("UI/Agents/Research/SelectResearchTypeTitle"),
  label("UI/Agents/Research/SelectResearchTypeMessage"),
  { type: "list", items: [11433, 11442, 11529].map((skillID) => label("UI/Agents/Research/SkillListing", [["skillID", skillID], ["skillLevel", 2]])) },
  3009373,
];
const DATACORE_KEYWORDS = {
  type: "dict",
  // A keyword's name comes off the wire as bytes.
  entries: [
    ["maxvalue", 12], ["minvalue", 1], ["setvalue", 12],
    ["caption", label("UI/Agents/Research/Datacores")],
    ["label", label("UI/Agents/Research/DatacorePrice", [["datacoreTypeID", 20424], ["rpAmount", 100], ["iskAmount", 10000]])],
    ["digits", 0],
  ].map(([name, value]) => [Buffer.from(name), value]),
};
// The contraband is (UE_LIST, a LIST of (UE_TYPEIDANDQUANTITY, typeID, quantity), separator): the client's
// FormatConvert reads a tuple there as one more typed value, so only a list of entries can be worded.
const CUSTOMS_QUESTION = [
  "ChtCustomsConfiscationConfirmation2",
  { type: "dict", entries: [["contraband", [103, { type: "list", items: [[24, 3721, 10]] }, "<br>"]], ["empire", [2, 500001]]] },
];

test("a research agent's choice of field goes to the user, and comes back as the radio button the client would name", async () => {
  const cases = [
    [{ confirmed: true, index: 1 }, [true, "radioboxOption2Selected"]],
    [{ confirmed: true, index: 0 }, [true, "radioboxOption1Selected"]],
    // Cancel keeps the button that was selected, as the client's box does.
    [{ confirmed: false, index: 2 }, [false, "radioboxOption3Selected"]],
  ];
  for (const [answer, wire] of cases) {
    const { pilots, session, handle, events } = await watched();
    const asking = session.ask("agents", "SingleChoiceBox", FIELD_CHOICE);
    await tick();
    const { question } = events()[0];
    assert.equal(question.kind, "choice");
    assert.equal(question.method, "SingleChoiceBox");
    assert.equal(question.title.label, "UI/Agents/Research/SelectResearchTypeTitle");
    assert.equal(question.body.label, "UI/Agents/Research/SelectResearchTypeMessage");
    assert.equal(question.agentID, 3009373);
    assert.deepEqual(question.choices, [11433, 11442, 11529].map((skillID) => ({
      label: "UI/Agents/Research/SkillListing",
      parameters: { type: "dict", entries: [["skillID", skillID], ["skillLevel", 2]] },
      text: null,
    })));
    for (const wrong of [true, null, { confirmed: true }, { confirmed: true, index: 3 }, { confirmed: true, index: -1 }, { confirmed: true, index: 1.5 }, { confirmed: "yes", index: 1 }]) {
      await rejects(pilots.answerClientQuestion(handle, question.id, wrong, FIELDS), "CALL_INVALID");
    }
    await pilots.answerClientQuestion(handle, question.id, answer, FIELDS);
    assert.deepEqual(await asking, wire);
  }
});

test("a choice nobody makes is dismissed when its time is up: the first button, and not OK", async () => {
  const { session, events, timers } = await watched();
  const asking = session.ask("agents", "SingleChoiceBox", FIELD_CHOICE);
  await tick();
  assert.equal(events()[0].question.kind, "choice");
  [...timers.values()][0].action();
  assert.deepEqual(await asking, [false, "radioboxOption1Selected"]);
});

test("how many datacores goes to the user as a number box with the server's limits, and comes back as the number or None", async () => {
  for (const [answer, wire] of [[5, 5], [1, 1], [12, 12], [null, null]]) {
    const { pilots, session, handle, events } = await watched();
    const asking = session.ask("agents", "GetQuantity", [], DATACORE_KEYWORDS);
    await tick();
    const { question } = events()[0];
    assert.equal(question.kind, "quantity");
    assert.equal(question.method, "GetQuantity");
    assert.deepEqual(question.quantity, { min: 1, max: 12, initial: 12, digits: 0 });
    assert.equal(question.title.label, "UI/Agents/Research/Datacores");
    assert.deepEqual(question.body, {
      label: "UI/Agents/Research/DatacorePrice",
      parameters: { type: "dict", entries: [["datacoreTypeID", 20424], ["rpAmount", 100], ["iskAmount", 10000]] },
      text: null,
    });
    // What the client's own field would not have let through: below, above, a fraction where whole numbers are asked.
    for (const wrong of [0, 13, 2.5, "5", true, undefined, { qty: 5 }, Number.NaN]) {
      await rejects(pilots.answerClientQuestion(handle, question.id, wrong, FIELDS), "CALL_INVALID");
    }
    await pilots.answerClientQuestion(handle, question.id, answer, FIELDS);
    assert.equal(await asking, wire);
  }
});

test("a number box takes a fraction when the server asks for digits, has no ceiling when none is given, and lapses as None", async () => {
  const { pilots, session, handle, events, timers } = await watched();
  const loose = { type: "dict", entries: [["digits", 2]] };
  const asking = session.ask("agents", "GetQuantity", [], loose);
  await tick();
  const { question } = events()[0];
  assert.deepEqual(question.quantity, { min: 0, max: null, initial: null, digits: 2 });
  assert.deepEqual(question.title, { label: null, parameters: null, text: null });
  await rejects(pilots.answerClientQuestion(handle, question.id, -1, FIELDS), "CALL_INVALID");
  await pilots.answerClientQuestion(handle, question.id, 1234567.25, FIELDS);
  assert.equal(await asking, 1234567.25);

  const second = session.ask("agents", "GetQuantity", [], DATACORE_KEYWORDS);
  await tick();
  [...timers.values()][0].action();
  assert.equal(await second, null);
});

test("the customs question goes to the user for as long as the server will wait, and no longer", async () => {
  for (const [answer, wire] of [[true, true], [false, false]]) {
    const { pilots, session, handle, events, timers } = await watched({ now: () => 5_000_000, questionWaitMs: 110_000 });
    const asking = session.ask("XmppChat", "AskYesNoQuestion", CUSTOMS_QUESTION, { type: "dict", entries: [["machoVersion", 1]] }, 30);
    await tick();
    const { id, ...question } = events()[0].question;
    assert.deepEqual(question, {
      service: "XmppChat",
      method: "AskYesNoQuestion",
      kind: "yesNo",
      // The dialog by its name, for its title and for its body, each with the dialog's parameters. The
      // name is the body's label too, for a page that has no client's words.
      title: {
        label: null,
        dialog: "ChtCustomsConfiscationConfirmation2",
        part: "title",
        parameters: { type: "dict", entries: [["contraband", [103, { type: "list", items: [[24, 3721, 10]] }, "<br>"]], ["empire", [2, 500001]]] },
        text: null,
      },
      body: {
        label: "ChtCustomsConfiscationConfirmation2",
        dialog: "ChtCustomsConfiscationConfirmation2",
        part: "body",
        parameters: { type: "dict", entries: [["contraband", [103, { type: "list", items: [[24, 3721, 10]] }, "<br>"]], ["empire", [2, 500001]]] },
        text: null,
      },
      agentID: null,
      contentID: null,
      suppressID: null,
      askedAtMs: 5_000_000,
      // The server's thirty seconds, not this client's hundred and ten.
      expiresAtMs: 5_030_000,
    });
    assert.deepEqual([...timers.values()].map((timer) => timer.delay), [30_000]);
    await rejects(pilots.answerClientQuestion(handle, id, "yes", FIELDS), "CALL_INVALID");
    await pilots.answerClientQuestion(handle, id, answer, FIELDS);
    assert.equal(await asking, wire);
  }
});

test("a customs question nobody answers in time is left unanswered, for the server to decide as it does for an absent player", async () => {
  const told = [];
  const { session, events, timers } = await watched({ onClientCall: (call) => told.push([call.method, call.answered, call.answer]) });
  const asking = session.ask("XmppChat", "AskYesNoQuestion", CUSTOMS_QUESTION, null, 30);
  await tick();
  const { id } = events()[0].question;
  [...timers.values()][0].action();
  assert.equal(await asking, undefined);
  assert.deepEqual(events().slice(1), [{ kind: "question-closed", id, reason: "expired" }]);
  assert.deepEqual(told, [["AskYesNoQuestion", false, undefined]]);
});

test("a question the server will wait a day for still lapses in this client's own time", async () => {
  const { session, timers } = await watched({ questionWaitMs: 110_000 });
  session.ask("agents", "YesNo", DECLINE_QUESTION, null, 86400);
  session.ask("agents", "YesNo", DECLINE_QUESTION, null, 0);
  session.ask("agents", "YesNo", DECLINE_QUESTION, null, null);
  await tick();
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [110_000, 110_000, 110_000]);
});

// ── a refusal, by name ───────────────────────────────────────────────────────

test("a refusal keeps the server's name for it and its values, beside the words", async () => {
  const values = { type: "dict", entries: [["contraband", [103, [[24, 3721, 10]], "<br>"]]] };
  const { pilots } = build({ answers: { "bound:Undock": () => { throw sessionError("GAME_CALL_REFUSED", "refused", { className: "eveexceptions.UserError", key: "ShipContrabandWarningUndock", values, reason: "ShipContrabandWarningUndock" }); } } });
  const { bridgeSessionID: handle } = await pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await assert.rejects(pilots.callMethod("ship", "Undock", [SHIP, false], null, FIELDS, handle), (error) => {
    assert.equal(error.code, "CALL_REFUSED");
    assert.equal(error.message, "ShipContrabandWarningUndock");
    assert.deepEqual(error.refusal, { key: "ShipContrabandWarningUndock", values });
    return true;
  });
});

// ── the scanner in space ─────────────────────────────────────────────────────
//
// What the gateway's scanner state says, made as the retail client's scan
// service knows it: the probes from what the server has told this session, the
// launcher from godma. The answers and the notifications are a real server's
// (test/fixtures/probeFlight.json): this same pilot and ship, a Core Probe
// Launcher I with eight probes in it, four launched, a scan, the four recalled.

const probeAnswer = (step) => recordedAnswers(probeFlight).find((answer) => answer.during === step && answer.value && answer.value.type === "object").value;
const probeNotes = (step) => recordedNotifications(probeFlight).filter((notification) => notification.during === step);
const PROBE_TYPE = 30013;
const scannerStatics = {
  typeAttribute: (typeID, attributeID) => (typeID === PROBE_TYPE ? { 1370: 0.25, 1373: 2 }[attributeID] ?? null : null),
  typeGroup: (typeID) => ({ [PROBE_TYPE]: 479, 30488: 479, 2488: 100 })[typeID] ?? null,
};
async function scanning(pilotOptions = {}, getAllInfo = () => probeAnswer("GetAllInfo in space")) {
  const hand = handTicked();
  const built = build(
    { ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": getAllInfo, "scanMgr.GetSystemScanMgr": boundObject("N=1:77") } },
    { ...hand.options, ...scannerStatics, ...pilotOptions },
  );
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const feed = (step) => probeNotes(step).forEach((notification) => built.session.notify(notification.method, notification.args));
  const scanner = async () => (await built.pilots.readScannerState(handle, WHOSE)).scanner;
  return { ...built, session: built.session, handle, feed, scanner };
}

test("in space the scanner is the launcher godma shows and the probes the server has told of", async () => {
  const { session, feed, scanner } = await scanning();
  const LAUNCHER = { moduleID: probeFlight.moduleID, typeID: 17938, online: true, chargeTypeID: PROBE_TYPE };
  // Eight loaded, none out: all eight could go.
  assert.deepEqual(await scanner(), {
    inSpace: true, solarSystemID: SYSTEM, shipID: SHIP, maxActiveProbes: 8,
    launcher: { ...LAUNCHER, loadedCount: 8, launchCount: 8 },
    probes: [],
  });
  // godma is primed once for the ship in this place, as for the ship's panel.
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1);
  assert.deepEqual(session.boundCalls.find((call) => call.method === "GetAllInfo").args, [true, true, null]);

  // Four launched: the server's own notifications say so, and that four are left in the launcher.
  feed("launch");
  const out = await scanner();
  assert.deepEqual(out.launcher, { ...LAUNCHER, loadedCount: 4, launchCount: 4 });
  assert.deepEqual(out.probes.map((probe) => probe.probeID), probeFlight.probeIDs);
  assert.deepEqual(out.probes[0], {
    probeID: 990000000001,
    typeID: PROBE_TYPE,
    pos: [-107303380589.52992, -18744981743.58154, 436488992639.86847],
    destination: [-107303380589.52992, -18744981743.58154, 436488992639.86847],
    scanRange: 2393565931200,
    rangeStep: 7,
    state: 1,
    expiry: "134359490166880000",
  });
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1, "and godma is not asked again");
  // What is read is plain JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("the launcher's count to launch never passes the eight probes a pilot may have out", async () => {
  // Eight loaded and four out: four more. Three loaded and four out: three. Eight out: none.
  const { session, feed, scanner } = await scanning();
  await scanner();
  feed("launch");
  // Each change later than the last: an older one would be dropped as stale.
  let stamp = 134359450900000000n;
  const quantity = (value) => {
    stamp += 10000000n;
    session.notify("OnModuleAttributeChanges", [{ type: "list", items: [["OnModuleAttributeChange", PILOT, [BigInt(SHIP), 27, PROBE_TYPE], 805, stamp, value, null, stamp]] }]);
  };
  quantity(8);
  assert.deepEqual([(await scanner()).launcher.loadedCount, (await scanner()).launcher.launchCount], [8, 4]);
  quantity(3);
  assert.deepEqual([(await scanner()).launcher.loadedCount, (await scanner()).launcher.launchCount], [3, 3]);
  for (const probeID of [21, 22, 23, 24, 25, 26]) session.notify("OnNewProbe", [keyVal([["probeID", BigInt(probeID)], ["typeID", PROBE_TYPE], ["pos", [1, 2, 3]], ["expiry", 1n]])]);
  const full = await scanner();
  assert.deepEqual([full.probes.length, full.launcher.launchCount], [8, 0], "ten told of, eight shown");
  // A probe the server sent with no step and no range has the client's: the seventh step of its type, sixteen AU.
  assert.deepEqual([full.probes[4].probeID, full.probes[4].rangeStep, full.probes[4].scanRange], [21, 7, 16 * 149597870700]);
  // Told to go somewhere, a probe is bound for there and still where it was.
  session.notify("OnProbesIdle", [[keyVal([["probeID", 21n], ["pos", [9, 9, 9]], ["destination", [4, 5, 6]]])]]);
  const sent = (await scanner()).probes[4];
  assert.deepEqual([sent.pos, sent.destination], [[1, 2, 3], [4, 5, 6]]);
  // The last probe gone from the launcher: still a launcher, with nothing in it.
  quantity(0);
  assert.deepEqual((await scanner()).launcher, { moduleID: probeFlight.moduleID, typeID: 17938, online: true, chargeTypeID: null, loadedCount: 0, launchCount: 0 });
});

test("a launcher holding something that is not a scan probe has nothing to launch, and a ship with no launcher has none", async () => {
  const other = await scanning({ typeGroup: () => 100 });
  assert.deepEqual((await other.scanner()).launcher, { moduleID: probeFlight.moduleID, typeID: 17938, online: true, chargeTypeID: null, loadedCount: 0, launchCount: 0 });
  // The ship of the earlier tests: one module, no launcher.
  const bare = await scanning({}, () => shipAllInfo());
  assert.deepEqual(await bare.scanner(), { inSpace: true, solarSystemID: SYSTEM, shipID: SHIP, maxActiveProbes: 8, launcher: null, probes: [] });
  // godma could not be asked: no launcher is known, and the probes the server told of are still there.
  const unasked = await scanning({}, () => { throw new Error("not now"); });
  unasked.feed("launch");
  const state = await unasked.scanner();
  assert.deepEqual([state.launcher, state.probes.length], [null, 4]);
});

test("what the scan service does after its own calls is done here: probes moving after a scan or a recall, gone when destroyed", async () => {
  const { pilots, session, handle, feed, scanner } = await scanning({ allowed: new Set(["scanMgr.GetSystemScanMgr", "scanMgr.RequestScans", "scanMgr.RecoverProbes", "scanMgr.DestroyProbe", "scanMgr.ConeScan", "dogmaIM.MachoBindObject", "dogmaIM.GetAllInfo", "beyonce.MachoBindObject"]) });
  feed("launch");
  const states = async () => (await scanner()).probes.map((probe) => probe.state);
  const [first, second, third, fourth] = probeFlight.probeIDs;
  const { boundHandle } = await pilots.bindObject("scanMgr", "GetSystemScanMgr", [], null, WHOSE, handle);
  const ask = (method, args, answer = null) => {
    session.boundAnswer = answer;
    return pilots.callBoundMethod("scanMgr", method, args, null, WHOSE, handle, boundHandle);
  };

  // RequestScans with the probes as the BFF's route sends them, keyed by ID: those are moving.
  await ask("RequestScans", [{ [String(first)]: { typeID: PROBE_TYPE }, [String(second)]: { typeID: PROBE_TYPE } }]);
  assert.deepEqual(await states(), [2, 2, 1, 1]);
  // ... and as a dict, as the client sends them.
  await ask("RequestScans", [{ type: "dict", entries: [[BigInt(third), keyVal([["probeID", BigInt(third)]])]] }]);
  assert.deepEqual(await states(), [2, 2, 2, 1]);
  // The server's word that the scan is over makes them idle again.
  feed("scanning");
  assert.deepEqual(await states(), [1, 1, 1, 1]);
  // A scan with no probes at all (the ship's own scanner) moves nothing.
  await ask("RequestScans", [null]);
  await ask("ConeScan", [1, 2, 3, 4, 5]);
  assert.deepEqual(await states(), [1, 1, 1, 1]);
  assert.deepEqual(session.boundCalls.filter((call) => call.objectID === "N=1:77").map((call) => call.method), ["RequestScans", "RequestScans", "RequestScans", "ConeScan"]);
});

test("a recall moves the probes the server answers with, and a destroyed probe is dropped", async () => {
  const [first, second, third, fourth] = probeFlight.probeIDs;
  const answers = { RecoverProbes: { type: "list", items: [BigInt(first), BigInt(third)] }, DestroyProbe: null };
  const hand = handTicked();
  const built = build(
    { ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": () => probeAnswer("GetAllInfo in space"), "scanMgr.GetSystemScanMgr": boundObject("N=1:77"), "bound:RecoverProbes": answers.RecoverProbes, "bound:DestroyProbe": null } },
    { ...hand.options, ...scannerStatics, allowed: new Set(["scanMgr.GetSystemScanMgr", "scanMgr.RecoverProbes", "scanMgr.DestroyProbe", "scanMgr.SetActivityState", "scanMgr.SetProbeDestination", "scanMgr.SetProbeRangeStep", "dogmaIM.MachoBindObject", "dogmaIM.GetAllInfo"]) },
  );
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  probeNotes("launch").forEach((notification) => built.session.notify(notification.method, notification.args));
  // The probes the scanner shows: the ones that are not inactive.
  const probes = async () => (await built.pilots.readScannerState(handle, WHOSE)).scanner.probes.map((probe) => [probe.probeID, probe.state]);
  const { boundHandle } = await built.pilots.bindObject("scanMgr", "GetSystemScanMgr", [], null, WHOSE, handle);
  // All four asked for; the server agrees to two.
  const recalled = await built.pilots.callBoundMethod("scanMgr", "RecoverProbes", [probeFlight.probeIDs], null, WHOSE, handle, boundHandle);
  assert.deepEqual(recalled.result, { type: "list", items: [first, third] });
  assert.deepEqual(await probes(), [[first, 2], [second, 1], [third, 2], [fourth, 1]]);
  // Switched off, sent somewhere, told to look less far: the scanner's own list says so at once.
  await built.pilots.callBoundMethod("scanMgr", "SetActivityState", [[second, first], false], null, WHOSE, handle, boundHandle);
  assert.deepEqual(await probes(), [[first, 2], [third, 2], [fourth, 1]], "only the idle one is switched off, and an inactive probe is not shown");
  await built.pilots.callBoundMethod("scanMgr", "SetActivityState", [[second], true], null, WHOSE, handle, boundHandle);
  assert.deepEqual(await probes(), [[first, 2], [second, 1], [third, 2], [fourth, 1]]);
  await built.pilots.callBoundMethod("scanMgr", "SetProbeDestination", [fourth, [7, 8, 9]], null, WHOSE, handle, boundHandle);
  await built.pilots.callBoundMethod("scanMgr", "SetProbeRangeStep", [fourth, 2], null, WHOSE, handle, boundHandle);
  const moved = (await built.pilots.readScannerState(handle, WHOSE)).scanner.probes.find((probe) => probe.probeID === fourth);
  assert.deepEqual([moved.destination, moved.rangeStep, moved.scanRange], [[7, 8, 9], 2, 0.5 * 149597870700]);
  // They went out as the client sends them: the IDs in a list.
  assert.deepEqual(built.session.boundCalls.filter((call) => call.method === "SetActivityState").map((call) => call.args), [[{ type: "list", items: [second, first] }, false], [{ type: "list", items: [second] }, true]]);
  assert.deepEqual(built.session.boundCalls.find((call) => call.method === "RecoverProbes").args, [{ type: "list", items: probeFlight.probeIDs }]);
  // An idle probe destroyed is gone at once; a moving one stays until the server takes it away.
  await built.pilots.callBoundMethod("scanMgr", "DestroyProbe", [second], null, WHOSE, handle, boundHandle);
  await built.pilots.callBoundMethod("scanMgr", "DestroyProbe", [first], null, WHOSE, handle, boundHandle);
  assert.deepEqual(await probes(), [[first, 2], [third, 2], [fourth, 1]]);
  built.session.notify("OnRemoveProbe", [BigInt(first)]);
  assert.deepEqual(await probes(), [[third, 2], [fourth, 1]]);
});

test("another system, another ship or a structure, and the scanner knows of no probes; other changes leave them", async () => {
  for (const [changes, left] of [
    [{ solarsystemid: [SYSTEM, 30000144] }, 0],
    [{ shipid: [SHIP, SHIP + 5] }, 0],
    [{ structureid: [null, 1030000000001] }, 0],
    [{ corpid: [1000044, 98000001] }, 4],
    [{ solarsystemid2: [SYSTEM, SYSTEM] }, 4],
  ]) {
    const { session, feed, scanner } = await scanning();
    feed("launch");
    assert.equal((await scanner()).probes.length, 4);
    session.change(changes);
    // Read from the scanner itself: a snapshot after a move would ask godma about the new place.
    const state = await scanner().catch(() => null);
    assert.equal(state ? state.probes.length : 0, left, JSON.stringify(changes));
  }
});

test("docked, the scanner is the docked answer whatever probes were out", async () => {
  const { pilots, handle } = await selected({}, { now: () => 1234, ...scannerStatics });
  assert.deepEqual((await pilots.readScannerState(handle, WHOSE)).scanner, { inSpace: false, solarSystemID: SYSTEM, shipID: SHIP, maxActiveProbes: 0, launcher: null, probes: [] });
});

// ── weapon banks and module damage, through the snapshot ─────────────────────

test("the snapshot's weapon banks and module damage are dogma's, and the banks follow the client's own grouping calls", async () => {
  // The ship of the capacitor test, with what GetAllInfo says of its state: one bank, and a damaged module.
  const allInfo = shipAllInfo();
  const fields = allInfo.args.entries;
  fields.push([Buffer.from("activeShipID"), BigInt(SHIP)]);
  fields.push([Buffer.from("shipState"), [{ type: "dict", entries: [] }, { type: "dict", entries: [] }, { type: "dict", entries: [[BigInt(FITTED_MODULE), { type: "list", items: [BigInt(SHIP + 2)] }]] }, { type: "dict", entries: [] }]]);
  const moduleRow = fields.find(([name]) => name.toString() === "shipInfo")[1].entries[1][1].args.entries;
  moduleRow.push([Buffer.from("invItem"), { type: "packedrow", fields: { itemID: FITTED_MODULE, typeID: 3636, locationID: SHIP, flagID: 27, groupID: 53, categoryID: 7 } }]);
  moduleRow.find(([name]) => name.toString() === "attributes")[1].entries.push([3, 10]);

  const hand = handTicked();
  const answers = { ...IN_SPACE.answers, "bound:GetAllInfo": allInfo, "bound:LinkWeapons": { type: "dict", entries: [[BigInt(FITTED_MODULE), { type: "list", items: [BigInt(SHIP + 2), BigInt(SHIP + 3)] }]] }, "bound:UnlinkModule": BigInt(SHIP + 3), "bound:UnlinkAllModules": null, "bound:LinkAllWeapons": { type: "dict", entries: [[BigInt(SHIP + 2), [BigInt(SHIP + 3)]]] } };
  const allowed = new Set(["beyonce.MachoBindObject", "dogmaIM.MachoBindObject", "dogmaIM.GetAllInfo", "dogmaIM.LinkWeapons", "dogmaIM.UnlinkModule", "dogmaIM.UnlinkAllModules", "dogmaIM.LinkAllWeapons", "dogmaIM.Activate"]);
  const built = build({ ...IN_SPACE, answers }, { ...hand.options, now: () => DOGMA_T_MS, allowed });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const ship = async () => (await built.pilots.readSpaceSnapshot(handle)).space.ship;

  // A module with 10 of its 40 hit points gone, and one bank.
  assert.deepEqual([(await ship()).moduleDamage, (await ship()).weaponBanks], [{ [FITTED_MODULE]: 0.25 }, { [FITTED_MODULE]: [SHIP + 2] }]);
  const { boundHandle } = await built.pilots.bindObject("dogmaIM", "MachoBindObject", [], null, WHOSE, handle);
  const ask = (method, args) => built.pilots.callBoundMethod("dogmaIM", method, args, null, WHOSE, handle, boundHandle);
  // The answer to a link is the ship's banks, anew.
  await ask("LinkWeapons", [SHIP, FITTED_MODULE, SHIP + 3]);
  assert.deepEqual((await ship()).weaponBanks, { [FITTED_MODULE]: [SHIP + 2, SHIP + 3] });
  // The answer to an unlink is the slave that came out.
  await ask("UnlinkModule", [SHIP, FITTED_MODULE]);
  assert.deepEqual((await ship()).weaponBanks, { [FITTED_MODULE]: [SHIP + 2] });
  await ask("UnlinkAllModules", [SHIP]);
  assert.deepEqual((await ship()).weaponBanks, {});
  await ask("LinkAllWeapons", [SHIP]);
  assert.deepEqual((await ship()).weaponBanks, { [SHIP + 2]: [SHIP + 3] });
  // Any other call on the dogma location leaves the banks alone, and the server's own word changes them.
  await ask("Activate", [FITTED_MODULE, "x", null, 1]);
  await ask("Activate", [SHIP, "x", null, 1]);
  assert.deepEqual((await ship()).weaponBanks, { [SHIP + 2]: [SHIP + 3] });
  built.session.notify("OnWeaponBanksChanged", [BigInt(SHIP), { type: "dict", entries: [] }]);
  assert.deepEqual((await ship()).weaponBanks, {});
  // This ship's row names no heat capacities: nothing is known of its racks.
  assert.equal((await ship()).rackHeat, null);
  // The module's damage follows the server's changes: burnt out is 1.
  built.session.notify("OnModuleAttributeChanges", [{ type: "list", items: [["OnModuleAttributeChange", PILOT, BigInt(FITTED_MODULE), 3, DOGMA_T + 10000000n, 40, 10, DOGMA_T + 10000000n]] }]);
  assert.deepEqual((await ship()).moduleDamage, { [FITTED_MODULE]: 1 });
});

// ── rack heat, through the snapshot ──────────────────────────────────────────

test("the snapshot's rack heat is dogma's: the server's word for a rack, and the client's reckoning from there", async () => {
  // The ship of the capacitor test with its racks' capacities and rates, and its module one that heats.
  const allInfo = shipAllInfo();
  const [shipRow, moduleRow] = allInfo.args.entries.find(([name]) => name.toString() === "shipInfo")[1].entries.map(([, row]) => row.args.entries);
  shipRow.find(([name]) => name.toString() === "attributes")[1].entries.push([1178, 100], [1199, 100], [1200, 100], [1179, 0.01], [1196, 0.01], [1198, 0.01], [1224, 1]);
  moduleRow.push([Buffer.from("invItem"), { type: "packedrow", fields: { itemID: FITTED_MODULE, typeID: 21857, locationID: SHIP, flagID: 19, groupID: 46, categoryID: 7 } }]);
  moduleRow.find(([name]) => name.toString() === "attributes")[1].entries.push([1180, 0.04]);

  const hand = handTicked();
  let clockMs = DOGMA_T_MS;
  const built = build({ ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": allInfo } }, { ...hand.options, now: () => clockMs });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const heat = async () => (await built.pilots.readSpaceSnapshot(handle)).space.ship.rackHeat;
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

  assert.deepEqual(await heat(), { high: 0, mid: 0, low: 0 });
  // The server says the mid rack is at 50 of its 100: that, and a minute on what the client's formula makes of it.
  built.session.notify("OnModuleAttributeChanges", [{ type: "list", items: [["OnModuleAttributeChange", PILOT, BigInt(SHIP), 1176, DOGMA_T, 50, 0, DOGMA_T]] }]);
  assert.deepEqual(await heat(), { high: 0, mid: 0.5, low: 0 });
  clockMs += 60000;
  close((await heat()).mid, 0.27440581804701324);
  // The server says the module is heating the high rack: a second on, the client's number for 0.04 from cold.
  built.session.notify("OnHeatAdded", [1175, BigInt(FITTED_MODULE)]);
  clockMs += 1000;
  close((await heat()).high, 0.039210560847676845);
  built.session.notify("OnHeatRemoved", [1175, BigInt(FITTED_MODULE)]);
  clockMs += 60000;
  close((await heat()).high, 0.039210560847676845 * Math.exp(-0.6));
  assert.equal(built.session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1, "all of it without asking again");
});

// ── the warp, through the snapshot ───────────────────────────────────────────

test("a warp ordered at a thing is remembered as the client remembers its own order, and the snapshot says where the warp is aimed", async () => {
  const hand = handTicked();
  const allowed = new Set(["beyonce.MachoBindObject", "beyonce.CmdWarpToStuff", "beyonce.CmdWarpToStuffAutopilot", "beyonce.CmdStop"]);
  const built = build(IN_SPACE, { ...hand.options, allowed });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const { boundHandle } = await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const park = hand.parks[0].space.park;
  const ego = park.ballpark.ball(park.ego);
  const off = (ball) => Math.hypot(ball.newPos.x - ego.newPos.x, ball.newPos.y - ego.newPos.y, ball.newPos.z - ego.newPos.z);
  // Two things on the recorded grid a long way off, in different directions.
  const distant = [...park.ballpark.balls.values()].filter((ball) => !ball.isFree && park.slimItems.has(ball.id) && off(ball) > 1e10);
  const there = distant[0];
  const elsewhere = distant.find((ball) => {
    const cosine = ((ball.newPos.x - ego.newPos.x) * (there.newPos.x - ego.newPos.x) + (ball.newPos.y - ego.newPos.y) * (there.newPos.y - ego.newPos.y) + (ball.newPos.z - ego.newPos.z) * (there.newPos.z - ego.newPos.z)) / (off(ball) * off(there));
    return cosine < 0.9;
  });
  assert.ok(there && elsewhere, "the recorded grid has two far things in different directions");
  const warp = async () => (await built.pilots.readSpaceSnapshot(handle)).space.ship.warp;
  const order = (method, args, kwargs = null) => built.pilots.callBoundMethod("beyonce", method, args, kwargs, WHOSE, handle, boundHandle);

  // Flying, not warping: nothing is said of a warp.
  assert.equal(await warp(), null);
  // The pilot's own order, then the server's: a WarpTo for the ship, at the thing.
  await order("CmdWarpToStuff", ["item", there.id], { minRange: 0 });
  built.session.notify("DoDestinyUpdate", [{ type: "list", items: [[park.currentTime, [Buffer.from("WarpTo"), [BigInt(park.ego), there.newPos.x, there.newPos.y, there.newPos.z, 20000, 3000]]]] }, false]);
  hand.parks[0].tick();
  assert.deepEqual(await warp(), { preparing: true, point: { ...there.newPos }, destinationID: there.id });
  // The autopilot's warp is remembered the same way; here it names the other thing, which the warp is not aimed at.
  await order("CmdWarpToStuffAutopilot", [elsewhere.id]);
  assert.deepEqual(await warp(), { preparing: true, point: { ...there.newPos }, destinationID: null });
  await order("CmdWarpToStuffAutopilot", [there.id]);
  assert.equal((await warp()).destinationID, there.id);
  // A warp to something that is no thing in space (a bookmark) forgets the thing, whatever number the bookmark has.
  await order("CmdWarpToStuff", ["bookmark", there.id], { minRange: 0 });
  assert.equal((await warp()).destinationID, null);
  // Another movement order leaves what was remembered alone.
  await order("CmdWarpToStuff", ["item", there.id], { minRange: 0 });
  await order("CmdStop", []);
  assert.equal((await warp()).destinationID, there.id);
  assert.deepEqual(hand.errors, []);
});

// ── what was last aligned to, through the snapshot ───────────────────────────

test("an align is remembered as the client's menu remembers it, until the ship is steered by hand or seen doing something else", async () => {
  const hand = handTicked();
  const allowed = new Set(["beyonce.MachoBindObject", "beyonce.CmdAlignTo", "beyonce.CmdGotoDirection", "beyonce.CmdStop", "beyonce.CmdOrbit"]);
  const built = build(IN_SPACE, { ...hand.options, allowed });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const { boundHandle } = await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  hand.parks[0].tick();
  const park = hand.parks[0].space.park;
  const ship = async () => (await built.pilots.readSpaceSnapshot(handle)).space.ship;
  const order = (method, args, kwargs = null) => built.pilots.callBoundMethod("beyonce", method, args, kwargs, WHOSE, handle, boundHandle);
  const server = (name, args) => {
    built.session.notify("DoDestinyUpdate", [{ type: "list", items: [[park.currentTime, [Buffer.from(name), [BigInt(park.ego), ...args]]]] }, false]);
    hand.parks[0].tick();
  };

  // Just undocked, flying straight out: aligned to nothing.
  assert.deepEqual([(await ship()).mode, (await ship()).alignTarget], ["GOTO", null]);
  // The pilot's own order names a thing: it is kept, and said while the ship flies a course.
  await order("CmdAlignTo", [], { dstID: 40009089, bookmarkID: null });
  assert.deepEqual((await ship()).alignTarget, { itemID: 40009089, bookmark: false });
  // A bookmark instead.
  await order("CmdAlignTo", [], { dstID: null, bookmarkID: 777 });
  assert.deepEqual((await ship()).alignTarget, { itemID: null, bookmark: true });
  // A bookmark has no thing behind it, whatever else the order carries.
  await order("CmdAlignTo", [], { dstID: 40009089, bookmarkID: 777 });
  assert.deepEqual((await ship()).alignTarget, { itemID: null, bookmark: true });
  // An order that names neither keeps nothing.
  await order("CmdAlignTo", [], { dstID: null, bookmarkID: null });
  assert.equal((await ship()).alignTarget, null);
  await order("CmdAlignTo", [], null);
  assert.equal((await ship()).alignTarget, null);
  // It is kept for as long as the ship flies a course, however long that is.
  await order("CmdAlignTo", [], { dstID: 40009089, bookmarkID: null });
  for (let tick = 0; tick < 6; tick += 1) hand.parks[0].tick();
  assert.deepEqual([(await ship()).mode, (await ship()).alignTarget], ["GOTO", { itemID: 40009089, bookmark: false }]);
  // Steered by hand: forgotten.
  await order("CmdGotoDirection", [1, 0, 0]);
  assert.equal((await ship()).alignTarget, null);

  // Ordered from a standstill: the ship is still stopped for a tick or two, and that is not held against it.
  server("Stop", []);
  assert.equal((await ship()).mode, "STOP");
  await order("CmdAlignTo", [], { dstID: 40009089, bookmarkID: null });
  assert.equal((await ship()).alignTarget, null, "not said of a ship that is not yet flying the course");
  server("GotoDirection", [0, 1, 0]);
  assert.deepEqual([(await ship()).mode, (await ship()).alignTarget], ["GOTO", { itemID: 40009089, bookmark: false }]);
  // Seen stopped for longer than that: forgotten, and flying a course again does not bring it back.
  server("Stop", []);
  hand.parks[0].tick();
  hand.parks[0].tick();
  hand.parks[0].tick();
  assert.equal((await ship()).alignTarget, null);
  server("GotoDirection", [0, 0, 1]);
  assert.deepEqual([(await ship()).mode, (await ship()).alignTarget], ["GOTO", null]);
  assert.deepEqual(hand.errors, []);
});

// ── the pilot's clock ────────────────────────────────────────────────────────

/** A pilot in space on the real clock of the test, its park shown that clock when the test says: frames[0]() is one frame. */
async function clockedPilot(sessionOptions = {}) {
  const allInfo = shipAllInfo();
  const [shipRow] = allInfo.args.entries.find(([name]) => name.toString() === "shipInfo")[1].entries.map(([, row]) => row.args.entries);
  shipRow.find(([name]) => name.toString() === "attributes")[1].entries.push([1178, 100], [1199, 100], [1200, 100], [1179, 0.01], [1196, 0.01], [1198, 0.01], [1224, 1]);
  const state = { now: DOGMA_T_MS, frames: [], spaces: [], errors: [] };
  const built = build({ ...IN_SPACE, ...sessionOptions, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": allInfo } }, {
    createSpace(options) {
      const space = createPilotSpace({ ...options, startTicking: (frame) => { state.frames.push(frame); return "timer"; }, stopTicking: () => {} });
      state.spaces.push(space);
      return space;
    },
    onSpaceError: (error, what) => state.errors.push([what, error.message]),
    now: () => state.now,
  });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await built.pilots.bindObject("beyonce", "MachoBindObject", [], null, WHOSE, handle);
  for (const update of recordedUpdates.slice(0, 5)) built.session.notify("DoDestinyUpdate", update.args);
  /** Real time goes by, a frame every 50 ms; how many steps the park took. */
  const run = (ms) => {
    const before = state.spaces[0].park.currentTime;
    for (let gone = 0; gone < ms; gone += 50) {
      state.now += 50;
      state.frames[0]();
    }
    return state.spaces[0].park.currentTime - before;
  };
  const snapshot = async () => (await built.pilots.readSpaceSnapshot(handle)).space;
  return { built, state, handle, run, snapshot, park: () => state.spaces[0].park };
}
/** The answer of a session that was sent the login function we know (session.js). */
const HANDLER_ANSWER = "TIDI_HANDLER:OK\nPORTRAIT_UPLOAD_HANDLER:OK\nSKILL_EXTRACTOR_ACCESS_TOKEN:OK\n";

test("a pilot's clock is the client's: slowed by the server's notice, and its park, its dogma and its snapshot go by it", async () => {
  const { built, state, run, snapshot, park } = await clockedPilot({ handshakeAnswer: HANDLER_ANSWER });
  const stamp = recordedUpdates[2].args[0].items[0][0];
  // The park's first frame came when it started; a second of frames later the state is applied and the park has stepped.
  assert.equal(run(950), 0);
  assert.equal(park().validState, false);
  // In space with nothing in the park yet, the snapshot still says the pace.
  assert.deepEqual(((space) => [space.inSpace, space.ship, space.timeDilation])(await snapshot()), [true, null, 1]);
  run(50);
  assert.deepEqual([park().validState, park().currentTime], [true, stamp + 1]);
  assert.equal((await snapshot()).timeDilation, 1);

  // The server slows the system to half pace. The client's clock changes pace two real seconds on.
  built.session.notify("OnSetTimeDilation", [0.5, 0.5, 0]);
  assert.equal(run(2000), 2);
  assert.equal((await snapshot()).timeDilation, 1);
  // From then a step takes two real seconds, and the pilot is shown the pace.
  assert.equal(run(1950), 0);
  assert.equal(run(50), 1);
  assert.equal(run(4000), 2);
  assert.equal((await snapshot()).timeDilation, 0.5);

  // Dogma measures in the same clock: a rack at half its heat, a real minute on, has cooled for thirty seconds.
  const simNow = BigInt(Math.trunc(DOGMA_T_MS + 3000 + 3000)) ;
  const filetime = (simNow + 11644473600000n) * 10000n;
  built.session.notify("OnModuleAttributeChanges", [{ type: "list", items: [["OnModuleAttributeChange", PILOT, BigInt(SHIP), 1176, filetime, 50, 0, filetime]] }]);
  assert.equal((await snapshot()).ship.rackHeat.mid, 0.5);
  state.now += 60_000;
  const cooled = (await snapshot()).ship.rackHeat.mid;
  assert.ok(Math.abs(cooled - 0.5 * Math.exp(-0.3)) < 1e-9, `${cooled} is not ${0.5 * Math.exp(-0.3)}`);

  // Lifted: full pace again two seconds on.
  built.session.notify("OnSetTimeDilation", [1, 1, 100000000]);
  state.frames[0]();
  run(2050);
  assert.equal((await snapshot()).timeDilation, 1);
  assert.equal(run(2000), 2);
  assert.deepEqual(state.errors, []);
});

test("the park's clock is the pilot's: a rebase moves the park, and a pilot never given the handler keeps the real clock", async () => {
  const { built, run, snapshot, park } = await clockedPilot();
  run(1000);
  assert.equal(park().validState, true);
  // The notice goes unheard: a step a second, and nothing to show.
  built.session.notify("OnSetTimeDilation", [0.5, 0.5, 0]);
  assert.equal(run(6000), 6);
  assert.equal((await snapshot()).timeDilation, 1);
  // A rebase is the park's whoever the pilot is: half a second on, and the next step is half a second later.
  built.session.notify("DoSimClockRebase", [[134359220000000000n, 134359220005000000n]]);
  assert.equal(run(1000), 0);
  assert.equal(run(500), 1);
  // Docked or in space, the snapshot says the pace.
  const docked = build({}, { now: () => DOGMA_T_MS });
  const { bridgeSessionID: handle } = await docked.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  assert.deepEqual(((space) => [space.inSpace, space.timeDilation])((await docked.pilots.readSpaceSnapshot(handle)).space), [false, 1]);
});

test("between two ticks a pilot's snapshot moves: the ship is where the client draws it at each reading", async () => {
  const { state, run, snapshot, park } = await clockedPilot();
  run(3000);
  assert.equal(park().validState, true);
  const tick = park().currentTime;
  const places = [];
  for (let reads = 0; reads < 4; reads += 1) {
    const space = await snapshot();
    places.push({ position: space.ship.position, speed: Math.hypot(space.ship.velocity.x, space.ship.velocity.y, space.ship.velocity.z), sampledAtMs: space.sampledAtMs });
    state.now += 200;
  }
  // No step was taken in those 600 ms, and the ship moved 200 ms of travel between each reading and the next.
  assert.equal(park().currentTime, tick);
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  for (let reads = 1; reads < 4; reads += 1) {
    assert.ok(Math.abs(far(places[reads].position, places[reads - 1].position) - 341 * 0.2) < 1e-3, `${far(places[reads].position, places[reads - 1].position)} m`);
    assert.ok(Math.abs(places[reads].speed - 341) < 1e-6);
    assert.equal(places[reads].sampledAtMs, tick * 1000);
  }
  // The first reading was taken at the step: where the ship was a tick before the park's place for it.
  const ball = park().ballpark.ball(SHIP);
  assert.deepEqual(places[0].position, { x: ball.oldPos.x, y: ball.oldPos.y, z: ball.oldPos.z });
});

// ── calls the client makes on a moniker ──────────────────────────────────────

/** The ship of the capacitor test with its module online in the first medium slot, and what godma is told a module is. */
function fittedAllInfo({ online = true } = {}) {
  const allInfo = shipAllInfo();
  const moduleRow = allInfo.args.entries.find(([name]) => name.toString() === "shipInfo")[1].entries[1][1].args.entries;
  moduleRow.push([Buffer.from("invItem"), { type: "packedrow", fields: { itemID: FITTED_MODULE, typeID: 21857, locationID: SHIP, flagID: 19, groupID: 46, categoryID: 7 } }]);
  // An active effect, as godma.RefreshItemEffects reads one: the effect's ID, then its environment; whether it runs is in the sixth place.
  const line = [BigInt(FITTED_MODULE), PILOT, BigInt(SHIP), null, null, [], 16, DOGMA_T, 0, 0];
  if (online) moduleRow.find(([name]) => name.toString() === "activeEffects")[1].entries.push([16, line]);
  return allInfo;
}
/** The static data's effects for the two module types these tests fit: an afterburner, and a made-up module with two effects to switch on. */
const TYPE_EFFECTS = {
  21857: [
    { effectID: 13, name: "medPower", effectCategoryID: 0, durationAttributeID: null },
    { effectID: 16, name: "online", effectCategoryID: 1, durationAttributeID: null },
    { effectID: 3175, name: "overloadSelfSpeedBonus", effectCategoryID: 5, durationAttributeID: null },
    { effectID: 6731, name: "moduleBonusAfterburner", effectCategoryID: 1, durationAttributeID: 73 },
  ],
};
const MODULE_PAIRS = new Set(["ship.MachoBindObject", "ship.Undock", "dogmaIM.Activate", "dogmaIM.Deactivate"]);
const moduleOptions = (more = {}) => ({ typeEffects: (typeID) => TYPE_EFFECTS[typeID] ?? [], typeAttribute: () => null, allowed: MODULE_PAIRS, ...more });

test("undock is made as the client makes it: on the ship object bound for the station, with the online modules by slot", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": fittedAllInfo() } }, moduleOptions());
  // The BFF's route asks the service by name, with an empty list.
  await pilots.callMethod("ship", "Undock", [SHIP, false], { onlineModules: [] }, FIELDS, handle);
  assert.equal(session.calls.some((call) => call.service === "ship"), false, "nothing was asked of the service by name");
  // godma primed first, from the dogma location bound for the station; then the ship bound for the station, and Undock on it.
  assert.deepEqual(session.binds, [{ service: "dogmaIM", params: [STATION, 15] }, { service: "ship", params: [STATION, 15] }]);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method]), [["N=1:1", "GetAllInfo"], ["N=1:2", "Undock"]]);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:2", method: "Undock", args: [SHIP, false], kwargs: { onlineModules: { type: "dict", entries: [[19, FITTED_MODULE]] } } });
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "ship.Undock").statuses, { reshaped: 1 });

  // Asked again (the contraband question answered, say): while the pilot is docked in a station gameui makes the ship's
  // moniker anew each time, so the ship is bound again, carrying the call. Godma's dogma location is kept, and not primed again.
  await pilots.callMethod("ship", "Undock", [SHIP, true], { onlineModules: [] }, FIELDS, handle);
  assert.deepEqual([session.binds.length, session.binds.at(-1), session.carried], [3, { service: "ship", params: [STATION, 15] }, ["GetAllInfo", "Undock", "Undock"]]);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:3", method: "Undock", args: [SHIP, true], kwargs: { onlineModules: { type: "dict", entries: [[19, FITTED_MODULE]] } } });
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1);
});

test("a module whose online effect is not running is not among the online modules, and with no dogma the tally says the call differs", async () => {
  const offline = await selected({ answers: { "bound:GetAllInfo": fittedAllInfo({ online: false }) } }, moduleOptions());
  await offline.pilots.callMethod("ship", "Undock", [SHIP, false], { onlineModules: [] }, FIELDS, offline.handle);
  assert.deepEqual(offline.session.boundCalls.at(-1).kwargs, { onlineModules: { type: "dict", entries: [] } });
  assert.deepEqual(offline.pilots.callLedger().find((row) => row.pair === "ship.Undock").statuses, { reshaped: 1 });
  // Dogma cannot be asked: the undock is still sent, on the moniker, and counted as not the client's.
  const blind = await selected({ answers: { "bound:GetAllInfo": () => { throw sessionError("GAME_CALL_FAILED", "no"); } } }, moduleOptions());
  await blind.pilots.callMethod("ship", "Undock", [SHIP, false], { onlineModules: [] }, FIELDS, blind.handle);
  assert.deepEqual(blind.session.boundCalls.at(-1), { objectID: "N=1:2", method: "Undock", args: [SHIP, false], kwargs: { onlineModules: { type: "dict", entries: [] } } });
  const row = blind.pilots.callLedger().find((each) => each.pair === "ship.Undock");
  assert.deepEqual(row.statuses, { differs: 1 });
  assert.match(row.note, /online modules by slot/);
});

test("a module is switched on and off as the client does it: on the dogma location bound for where the pilot is, its effect named", async () => {
  const hand = handTicked();
  const built = build({ ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": fittedAllInfo() } }, { ...hand.options, ...moduleOptions() });
  const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const { session } = built;
  const binds = () => session.binds.filter((bind) => bind.service === "dogmaIM");
  // The BFF's route: by the service's name, no effect named, -1 for "go on".
  await built.pilots.callMethod("dogmaIM", "Activate", [FITTED_MODULE, "", null, -1], null, WHOSE, handle);
  assert.equal(session.calls.some((call) => call.service === "dogmaIM" && call.method === "Activate"), false);
  assert.deepEqual(binds(), [{ service: "dogmaIM", params: [SYSTEM, 5] }]);
  const location = session.boundCalls.find((call) => call.method === "GetAllInfo").objectID;
  assert.deepEqual(session.boundCalls.at(-1), { objectID: location, method: "Activate", args: [FITTED_MODULE, "moduleBonusAfterburner", null, 1000], kwargs: null });
  // With a target, and a count of the caller's.
  await built.pilots.callMethod("dogmaIM", "Activate", [FITTED_MODULE, "moduleBonusAfterburner", 4242, 0], null, WHOSE, handle);
  assert.deepEqual(session.boundCalls.at(-1).args, [FITTED_MODULE, "moduleBonusAfterburner", 4242, 0]);
  await built.pilots.callMethod("dogmaIM", "Deactivate", [FITTED_MODULE, ""], null, WHOSE, handle);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: location, method: "Deactivate", args: [FITTED_MODULE, "moduleBonusAfterburner"], kwargs: null });
  // One dogma location for all of it, godma's own.
  assert.equal(binds().length, 1);
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1);
  // A module godma was never told of: sent as it came, and counted as not the client's.
  await built.pilots.callMethod("dogmaIM", "Activate", [FITTED_MODULE + 50, "", null, -1], null, WHOSE, handle);
  assert.deepEqual(session.boundCalls.at(-1).args, [FITTED_MODULE + 50, "", null, -1]);
  const tally = Object.fromEntries(built.pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual([tally["dogmaIM.Activate"], tally["dogmaIM.Deactivate"]], [{ reshaped: 2, differs: 1 }, { reshaped: 1 }]);

  // The pilot is somewhere else: the dogma location is bound again for there.
  session.attributes.solarsystemid = SYSTEM + 1;
  session.attributes.solarsystemid2 = SYSTEM + 1;
  session.change({ solarsystemid: [SYSTEM, SYSTEM + 1], solarsystemid2: [SYSTEM, SYSTEM + 1] });
  await built.pilots.callMethod("dogmaIM", "Deactivate", [FITTED_MODULE, "moduleBonusAfterburner"], null, WHOSE, handle);
  assert.deepEqual(binds().at(-1), { service: "dogmaIM", params: [SYSTEM + 1, 5] });
  assert.equal(binds().length, 2);
});

test("which effect a module is switched on by, and whether it repeats, are the module button's rules on the static data", async () => {
  const effects = {
    ...TYPE_EFFECTS,
    // Two effects a pilot could switch on: the client tells them apart by a flag the static data here lacks.
    7001: [{ effectID: 10, name: "targetAttack", effectCategoryID: 2, durationAttributeID: 51 }, { effectID: 101, name: "useMissiles", effectCategoryID: 1, durationAttributeID: 51 }],
    // A target effect with no duration, and a module that forbids repeating.
    7002: [{ effectID: 55, name: "oneShot", effectCategoryID: 2, durationAttributeID: null }],
    7003: [{ effectID: 101, name: "useMissiles", effectCategoryID: 1, durationAttributeID: 51 }],
    7004: [{ effectID: 16, name: "online", effectCategoryID: 1, durationAttributeID: null }, { effectID: 12, name: "hiPower", effectCategoryID: 0, durationAttributeID: null }],
  };
  const fits = async (typeID, more = {}) => {
    const allInfo = fittedAllInfo();
    allInfo.args.entries.find(([name]) => name.toString() === "shipInfo")[1].entries[1][1].args.entries.find(([name]) => name.toString() === "invItem")[1].fields.typeID = typeID;
    const hand = handTicked();
    const built = build({ ...IN_SPACE, answers: { ...IN_SPACE.answers, "bound:GetAllInfo": allInfo } }, { ...hand.options, typeEffects: (id) => effects[id] ?? [], typeAttribute: () => null, allowed: MODULE_PAIRS, ...more });
    const { bridgeSessionID: handle } = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
    return async (args) => {
      await built.pilots.callMethod("dogmaIM", "Activate", args, null, WHOSE, handle);
      return built.session.boundCalls.at(-1).args;
    };
  };
  assert.deepEqual(await (await fits(21857))([FITTED_MODULE, "", null, -1]), [FITTED_MODULE, "moduleBonusAfterburner", null, 1000]);
  // Two candidates: unnamed. Named by the caller, it repeats by its own duration.
  assert.deepEqual(await (await fits(7001))([FITTED_MODULE, "", null, -1]), [FITTED_MODULE, "", null, -1]);
  assert.deepEqual(await (await fits(7001))([FITTED_MODULE, "useMissiles", null, -1]), [FITTED_MODULE, "useMissiles", null, 1000]);
  // No duration: once.
  assert.deepEqual(await (await fits(7002))([FITTED_MODULE, "", 9, -1]), [FITTED_MODULE, "oneShot", 9, 0]);
  // The module forbids repeating (attribute 1014): once, though the effect has a duration.
  const asked = [];
  const launcher = await fits(7003, { typeAttribute: (typeID, attributeID) => { asked.push([typeID, attributeID]); return 1; } });
  assert.deepEqual(await launcher([FITTED_MODULE, "", null, -1]), [FITTED_MODULE, "useMissiles", null, 0]);
  assert.deepEqual(asked.at(-1), [7003, 1014]);
  // Nothing to switch on: online is not it, and nor is a passive effect.
  assert.deepEqual(await (await fits(7004))([FITTED_MODULE, "", null, -1]), [FITTED_MODULE, "", null, -1]);
  // An effect that is not one of the type's: whether it repeats is not known.
  assert.deepEqual(await (await fits(21857))([FITTED_MODULE, "somethingElse", null, -1]), [FITTED_MODULE, "somethingElse", null, -1]);
});

test("a call on a handle the BFF bound itself is shaped with what the pilot knows as well", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": fittedAllInfo() } }, moduleOptions());
  const ship = await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHOSE, handle);
  await pilots.callBoundMethod("ship", "Undock", [SHIP, false], null, WHOSE, handle, ship.boundHandle);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:2", method: "Undock", args: [SHIP, false], kwargs: { onlineModules: { type: "dict", entries: [[19, FITTED_MODULE]] } } });
});

test("whatever is asked of ship or dogmaIM by name is made on the moniker, read against the client or not", async () => {
  const allowed = new Set(["dogmaIM.GetTargets", "dogmaIM.AddTarget", "dogmaIM.Overload", "dogmaIM.CreateNewbieShip", "ship.LeaveShip", "ship.GetShipConfiguration", "ship.LaunchDrones", "ship.GetShipFittingInfo", "station.GetGuests"]);
  const { pilots, session, handle } = await selected({ answers: { "bound:GetTargets": { type: "list", items: [9001] } } }, { allowed });
  const made = () => session.boundCalls.at(-1);
  const chosen = session.calls.length;
  const byName = () => session.calls.slice(chosen).filter((call) => call.method !== "ShipGetInfo").map((call) => `${call.service}.${call.method}`);

  // A read, with the server's answer handed back as any call's is.
  const targets = await pilots.callMethod("dogmaIM", "GetTargets", [], null, FIELDS, handle);
  assert.deepEqual([targets.service, targets.method, targets.result], ["dogmaIM", "GetTargets", { type: "list", items: [9001] }]);
  assert.deepEqual(session.binds, [{ service: "dogmaIM", params: [STATION, 15] }]);
  assert.deepEqual(made(), { objectID: "N=1:1", method: "GetTargets", args: [], kwargs: null });
  await pilots.callMethod("dogmaIM", "AddTarget", [9001], null, FIELDS, handle);
  assert.deepEqual(made(), { objectID: "N=1:1", method: "AddTarget", args: [9001], kwargs: null });
  // One nobody has read against the client: still on the moniker, with its arguments as the BFF spelt them.
  await pilots.callMethod("dogmaIM", "Overload", [7, 3175], null, FIELDS, handle);
  assert.deepEqual(made(), { objectID: "N=1:1", method: "Overload", args: [7, 3175], kwargs: null });
  // The ship's: its own moniker, made anew for each call while the pilot is docked in a station, and what the pilot knows filled in.
  await pilots.callMethod("ship", "GetShipConfiguration", [], null, FIELDS, handle);
  assert.deepEqual(session.binds.at(-1), { service: "ship", params: [STATION, 15] });
  assert.deepEqual(made(), { objectID: "N=1:2", method: "GetShipConfiguration", args: [SHIP], kwargs: null });
  await pilots.callMethod("ship", "LaunchDrones", [[[11, 1]], PILOT, false], null, FIELDS, handle);
  assert.deepEqual(made(), { objectID: "N=1:3", method: "LaunchDrones", args: [{ type: "list", items: [[11, 1]] }, null, false], kwargs: null });
  await pilots.callMethod("ship", "LeaveShip", [SHIP], null, FIELDS, handle);
  assert.deepEqual(made(), { objectID: "N=1:4", method: "LeaveShip", args: [SHIP], kwargs: null });
  assert.deepEqual(session.binds.map((bind) => bind.service), ["dogmaIM", "ship", "ship", "ship"], "one object for the dogma location, and one for each call of the ship's");
  assert.deepEqual(byName(), [], "nothing of either was asked by the service's name");

  // The few the client asks by name are asked by name; so is everything of every other service.
  await pilots.callMethod("dogmaIM", "CreateNewbieShip", [SHIP, STATION], null, FIELDS, handle);
  await pilots.callMethod("ship", "GetShipFittingInfo", [77], null, FIELDS, handle);
  await pilots.callMethod("station", "GetGuests", [], null, FIELDS, handle);
  assert.deepEqual(byName(), ["dogmaIM.CreateNewbieShip", "ship.GetShipFittingInfo", "station.GetGuests"]);

  // The tally: asked by name and made on the moniker is not the client's call as the BFF spelt it, even with the client's arguments.
  const tally = Object.fromEntries(pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual(
    [tally["dogmaIM.GetTargets"], tally["dogmaIM.AddTarget"], tally["dogmaIM.Overload"], tally["ship.GetShipConfiguration"], tally["ship.LaunchDrones"], tally["ship.LeaveShip"], tally["dogmaIM.CreateNewbieShip"]],
    [{ reshaped: 1 }, { reshaped: 1 }, { unchecked: 1 }, { reshaped: 1 }, { reshaped: 1 }, { reshaped: 1 }, { unchecked: 1 }],
  );
});

test("a call on a handle the BFF bound itself, with the client's arguments, is counted as the client's call", async () => {
  const allowed = new Set(["dogmaIM.MachoBindObject", "dogmaIM.GetTargets"]);
  const { pilots, session, handle } = await selected({}, { allowed });
  const bound = await pilots.bindObject("dogmaIM", "MachoBindObject", [[STATION, 15]], null, WHOSE, handle);
  await pilots.callBoundMethod("dogmaIM", "GetTargets", [], null, WHOSE, handle, bound.boundHandle);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:1", method: "GetTargets", args: [], kwargs: null });
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "dogmaIM.GetTargets").statuses, { same: 1 });
});

// ── the account's own calls, with no character chosen ───────────────────────

const ACCOUNT_PAIRS = ["charUnboundMgr.GetCharCreationInfo", "charUnboundMgr.ValidateNameEx", "charUnboundMgr.CreateCharacterWithDoll", "charUnboundMgr.SelectCharacterID"];

/** Timers that fire only when told to: `live` are the ones set and neither cleared nor fired. */
function handTimers() {
  const set = [];
  return {
    set,
    get live() { return set.filter((timer) => !timer.cleared && !timer.fired); },
    setTimeout(action, delay) { const timer = { action, delay, cleared: false, fired: false }; set.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    fire(timer) { timer.fired = true; timer.action(); },
  };
}

/** A transport that may make the account's calls, with its timers in hand. */
function accountBuild(sessionOptions = {}, pilotOptions = {}) {
  const timers = handTimers();
  const built = build(sessionOptions, { allowed: new Set(["dogmaIM.ShipGetInfo", "station.GetGuests", ...ACCOUNT_PAIRS]), timers, ...pilotOptions });
  return { ...built, timers, get session() { return built.session; } };
}
const creationInfo = (pilots, fields = FIELDS) => pilots.accountCall("charUnboundMgr", "GetCharCreationInfo", [], null, fields);

test("an account's own call logs in as the account and asks, with no character chosen", async () => {
  const info = { type: "dict", entries: [[Buffer.from("races"), { type: "list", items: [] }]] };
  const { pilots, made, timers } = accountBuild({ answers: { "charUnboundMgr.GetCharCreationInfo": info } });
  const outcome = await creationInfo(pilots);

  assert.equal(made.length, 1);
  const [session] = made;
  assert.deepEqual(session.logins, [["test", ""]]);
  // Nothing of the selection screen is asked: the call and no other.
  assert.deepEqual(session.calls, [{ service: "charUnboundMgr", method: "GetCharCreationInfo", args: [], kwargs: null }]);
  // The answer in the gateway's own form, with nothing pushed, since nobody is listening on this connection.
  assert.deepEqual(outcome, {
    service: "charUnboundMgr",
    method: "GetCharCreationInfo",
    result: { type: "dict", entries: [["races", { type: "list", items: [] }]] },
    notifications: [],
  });
  assert.equal(pilots.size, 0, "no pilot is held for it");
  // The connection waits a little for the next thing asked, and is closed when nothing comes.
  assert.equal(session.closed, false);
  assert.deepEqual(timers.live.map((timer) => timer.delay), [5000]);
  timers.fire(timers.live[0]);
  assert.equal(session.closed, true);
  assert.equal(timers.live.length, 0);
});

test("how long the account's connection waits is the transport's to be told", async () => {
  const { pilots, timers } = accountBuild({}, { accountIdleMs: 1234 });
  await creationInfo(pilots);
  assert.deepEqual(timers.live.map((timer) => timer.delay), [1234]);
});

test("what is asked for an account in one go is asked on one connection, as the client's screen is one", async () => {
  const { pilots, made, timers } = accountBuild({ answers: { "charUnboundMgr.ValidateNameEx": 1, "charUnboundMgr.CreateCharacterWithDoll": 140000042 } });
  await creationInfo(pilots);
  const [afterFirst] = timers.live;
  await pilots.accountCall("charUnboundMgr", "ValidateNameEx", ["Zaphod Beeblebrox"], null, FIELDS);
  await pilots.accountCall("charUnboundMgr", "CreateCharacterWithDoll", ["Zaphod Beeblebrox", 2, 1, 8, null, null, 0], null, FIELDS);

  assert.equal(made.length, 1, "one connection");
  assert.deepEqual(made[0].logins, [["test", ""]], "one login");
  assert.deepEqual(made[0].calls.map((call) => call.method), ["GetCharCreationInfo", "ValidateNameEx", "CreateCharacterWithDoll"]);
  // Each call puts the hanging up off: the wait is from the last of them.
  assert.equal(afterFirst.cleared, true);
  assert.equal(timers.set.length, 3);
  assert.equal(timers.live.length, 1);
  assert.equal(made[0].closed, false);
  timers.fire(timers.live[0]);
  assert.equal(made[0].closed, true);

  // Asked again after that: a new connection, logged in again.
  await creationInfo(pilots);
  assert.equal(made.length, 2);
  assert.deepEqual(made[1].logins, [["test", ""]]);
  assert.equal(made[1].closed, false);
});

test("calls made at once share the one login, and the connection is not closed under one of them", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { pilots, made, timers } = accountBuild({ answers: { "charUnboundMgr.ValidateNameEx": () => waiting, "charUnboundMgr.GetCharCreationInfo": "info" } });
  const slow = pilots.accountCall("charUnboundMgr", "ValidateNameEx", ["A Name"], null, FIELDS);
  const quick = await creationInfo(pilots);
  assert.equal(quick.result, "info");
  assert.equal(made.length, 1);
  assert.equal(made[0].logins.length, 1);
  // One call is still out: nothing is counting down to hang up on it.
  assert.equal(timers.live.length, 0);
  release(1);
  assert.equal((await slow).result, 1);
  assert.equal(timers.live.length, 1);
  assert.equal(made[0].closed, false);
});

test("an account's own call is sent as the retail client sends it, and counted", async () => {
  const { pilots, session: _unused, made } = accountBuild({ answers: { "charUnboundMgr.ValidateNameEx": 1, "charUnboundMgr.CreateCharacterWithDoll": 140000042 } });
  // The client's second argument: how many names it has checked before this one.
  assert.equal((await pilots.accountCall("charUnboundMgr", "ValidateNameEx", ["Zaphod Beeblebrox"], null, FIELDS)).result, 1);
  assert.deepEqual(made[0].calls[0].args, ["Zaphod Beeblebrox", 0]);
  // What the registry cannot make the client's goes as it was given, bridge JSON turned to what the wire takes.
  const created = await pilots.accountCall("charUnboundMgr", "CreateCharacterWithDoll", ["Zaphod Beeblebrox", 2, 1, 8, { type: "Buffer", data: [1, 2] }, null, 0], { flag: 1 }, FIELDS);
  assert.equal(created.result, 140000042);
  assert.deepEqual(made[0].calls[1].args, ["Zaphod Beeblebrox", 2, 1, 8, Buffer.from([1, 2]), null, 0]);
  assert.deepEqual(made[0].calls[1].kwargs, { flag: 1 });
  const tally = Object.fromEntries(pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual(tally["charUnboundMgr.ValidateNameEx"], { reshaped: 1 });
  assert.deepEqual(tally["charUnboundMgr.CreateCharacterWithDoll"], { differs: 1 });
});

test("an answer of nothing is null, as the gateway says it", async () => {
  const { pilots } = accountBuild({ answers: { "charUnboundMgr.GetCharCreationInfo": () => undefined } });
  assert.equal((await creationInfo(pilots)).result, null);
});

test("each account has its own connection", async () => {
  const { pilots, made, timers } = accountBuild({ userid: (userName) => (userName === "test" ? ACCOUNT : 5) });
  await creationInfo(pilots);
  await creationInfo(pilots, { userid: 5, userName: "test2" });
  await creationInfo(pilots);
  assert.deepEqual(made.map((session) => session.logins), [[["test", ""]], [["test2", ""]]]);
  assert.deepEqual(made.map((session) => session.calls.length), [2, 1]);
  // Hanging up on one leaves the other.
  assert.equal(timers.live.length, 2);
  timers.fire(timers.live[0]);
  assert.deepEqual(made.map((session) => session.closed).sort(), [false, true]);
});

test("an account's own call does not disturb a pilot of the same account", async () => {
  const { pilots, made, timers } = accountBuild();
  const { bridgeSessionID: handle } = await pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  await creationInfo(pilots);
  assert.equal(made.length, 2, "its own connection, not the pilot's");
  assert.equal(made[0].calls.some((call) => call.method === "GetCharCreationInfo"), false);
  timers.fire(timers.live.find((timer) => timer.delay === 5000));
  assert.equal(made[1].closed, true);
  assert.equal(made[0].closed, false);
  assert.equal(pilots.size, 1);
  // The pilot's session still answers.
  await pilots.callMethod("station", "GetGuests", [], null, FIELDS, handle);
});

test("an account's own call needs to know whose it is, before anything is connected", async () => {
  let connects = 0;
  const { pilots, made } = accountBuild({}, { connect: async () => { connects += 1; return {}; } });
  await rejects(creationInfo(pilots, { userName: "test" }), "CALL_INVALID", /userid/);
  await rejects(creationInfo(pilots, { userid: 0, userName: "test" }), "CALL_INVALID", /userid/);
  await rejects(creationInfo(pilots, { userid: ACCOUNT }), "CALL_INVALID", /name/);
  await rejects(creationInfo(pilots, { userid: ACCOUNT, userName: "   " }), "CALL_INVALID", /name/);
  await rejects(pilots.accountCall("charUnboundMgr", "GetCharCreationInfo", [], null, undefined), "CALL_INVALID");
  await rejects(creationInfo(pilots, null), "CALL_INVALID");
  assert.equal(connects, 0);
  assert.equal(made.length, 0);
});

test("the account's name is logged in as it stands, without the space around it", async () => {
  const { pilots, made } = accountBuild();
  await creationInfo(pilots, { userid: ACCOUNT, userName: "  test " });
  assert.deepEqual(made[0].logins, [["test", ""]]);
});

test("an account's own call is held to the allowlist, and never chooses a character", async () => {
  let connects = 0;
  const { pilots, made } = accountBuild({}, { connect: async () => { connects += 1; return {}; } });
  await rejects(pilots.accountCall("charUnboundMgr", "DeleteCharacter", [PILOT], null, FIELDS), "CALL_NOT_ALLOWED", /allowlist/);
  // On the allowlist, for the selection that keeps its session. Here it would bring a character online on a connection nobody keeps.
  await rejects(pilots.accountCall("charUnboundMgr", "SelectCharacterID", [PILOT, null, true], null, FIELDS), "CALL_NOT_ALLOWED", /selecting/);
  assert.equal(connects, 0);
  assert.equal(made.length, 0);
});

test("a name that logs in as another account is not asked on that account's behalf", async () => {
  const { pilots, made, timers } = accountBuild({ userid: 99 });
  await rejects(creationInfo(pilots), "CALL_REFUSED", /different account/);
  assert.deepEqual(made[0].calls, []);
  assert.equal(made[0].closed, true);
  assert.equal(timers.live.length, 0, "and nothing is left counting down");
  // Not kept for the next call either: it is tried afresh.
  await rejects(creationInfo(pilots), "CALL_REFUSED", /different account/);
  assert.equal(made.length, 2);
});

test("the server saying no to the account is an answer: the connection stays", async () => {
  const { pilots, made, timers } = accountBuild({
    answers: { "charUnboundMgr.CreateCharacterWithDoll": () => { throw refusedBy("CharNameInvalid", "That name is taken."); }, "charUnboundMgr.GetCharCreationInfo": "info" },
  });
  await assert.rejects(pilots.accountCall("charUnboundMgr", "CreateCharacterWithDoll", ["Taken"], null, FIELDS), (error) => {
    assert.equal(error.code, "CALL_REFUSED");
    assert.equal(error.message, "That name is taken.");
    assert.deepEqual(error.refusal, { key: "CharNameInvalid", values: {} });
    return true;
  });
  assert.equal(made[0].closed, false);
  assert.equal(timers.live.length, 1);
  assert.equal((await creationInfo(pilots)).result, "info");
  assert.equal(made.length, 1, "the next thing is asked on the same connection");
});

test("an account's own call fails as a call fails, and a connection that failed is not asked again", async () => {
  const unreachable = createGamePortPilots({ connect: async () => { throw new Error("ECONNREFUSED"); }, allowed: new Set(ACCOUNT_PAIRS), timers: handTimers() });
  await rejects(creationInfo(unreachable), "EVE_GATEWAY_UNREACHABLE");
  await rejects(creationInfo(unreachable), "EVE_GATEWAY_UNREACHABLE");

  // The login refused: what the session said, as a failed call.
  const refusedLogin = accountBuild({ loginError: sessionError("LOGIN_REFUSED", "The server refused the login.") });
  await rejects(creationInfo(refusedLogin.pilots), "CALL_FAILED", /GetCharCreationInfo failed: The server refused the login\./);
  assert.equal(refusedLogin.session.closed, true);
  assert.equal(refusedLogin.timers.live.length, 0);

  // The connection goes while the call is out. No session was handed out, so none is reported lost.
  const lost = { now: true };
  const dropped = accountBuild({ answers: { "charUnboundMgr.GetCharCreationInfo": () => { if (lost.now) throw sessionError("CONNECTION_LOST"); return "info"; } } });
  await rejects(creationInfo(dropped.pilots), "CALL_FAILED", /closed the connection/);
  assert.equal(dropped.made[0].closed, true);
  assert.equal(dropped.timers.live.length, 0);
  lost.now = false;
  assert.equal((await creationInfo(dropped.pilots)).result, "info");
  assert.equal(dropped.made.length, 2, "the next call opens another");

  // No answer in time: what state the connection is in nobody knows, so it is not kept.
  const slow = accountBuild({ answers: { "charUnboundMgr.GetCharCreationInfo": () => { throw sessionError("CALL_TIMEOUT"); } } });
  await rejects(creationInfo(slow.pilots), "EVE_GATEWAY_TIMEOUT");
  assert.equal(slow.session.closed, true);
});

test("the server hanging up on a waiting account connection is not found out by the next call", async () => {
  const { pilots, made, timers } = accountBuild({ answers: { "charUnboundMgr.GetCharCreationInfo": "info" } });
  await creationInfo(pilots);
  made[0].drop();
  assert.equal(timers.live.length, 0, "nothing is left counting down to close what is closed");
  assert.equal((await creationInfo(pilots)).result, "info");
  assert.equal(made.length, 2);
  assert.equal(made[1].closed, false);
  // An old connection going does not take the new one with it.
  made[0].close();
  assert.equal((await creationInfo(pilots)).result, "info");
  assert.equal(made.length, 2);
});

test("shutting the transport down hangs up on the accounts too", async () => {
  const { pilots, made, timers } = accountBuild();
  await creationInfo(pilots);
  pilots.shutdown();
  assert.equal(made[0].closed, true);
  assert.equal(timers.live.length, 0);
});

test("a call failing late on a connection already given up does not cost the account its new one", async () => {
  let failLate;
  const late = new Promise((resolve, reject) => { failLate = reject; });
  const state = { lost: true };
  const { pilots, made } = accountBuild({
    answers: {
      "charUnboundMgr.ValidateNameEx": () => late,
      "charUnboundMgr.GetCharCreationInfo": () => {
        if (!state.lost) return "info";
        state.lost = false;
        throw sessionError("CONNECTION_LOST");
      },
    },
  });
  // Two calls out on the first connection. One loses it at once; the other hears later.
  const second = pilots.accountCall("charUnboundMgr", "ValidateNameEx", ["A Name"], null, FIELDS);
  second.catch(() => {});
  await rejects(creationInfo(pilots), "CALL_FAILED", /closed the connection/);
  assert.equal((await creationInfo(pilots)).result, "info");
  assert.equal(made.length, 2, "a second connection");
  failLate(sessionError("CONNECTION_CLOSED"));
  await rejects(second, "CALL_FAILED", /closed the connection/);
  assert.equal(made[1].closed, false);
  assert.equal((await creationInfo(pilots)).result, "info");
  assert.equal(made.length, 2, "still the second connection");
});

test("a connection waiting to be closed does not keep the process alive", async () => {
  const let_go = [];
  const timers = {
    setTimeout(action, delay) { const timer = { action, delay, unref() { let_go.push(timer); return timer; } }; return timer; },
    clearTimeout() {},
  };
  const { pilots } = accountBuild({}, { timers });
  await creationInfo(pilots);
  assert.deepEqual(let_go.map((timer) => timer.delay), [5000]);
});

// ── saved fittings ──────────────────────────────────────────────────────────

test("saved fittings are asked with the owner the pilot's own client would name", async () => {
  const pairs = ["charFittingMgr.GetFittings", "corpFittingMgr.GetFittings", "allianceFittingMgr.GetFittings"];
  const { pilots, session, handle } = await selected({}, { allowed: new Set(["dogmaIM.ShipGetInfo", ...pairs]) });
  for (const pair of pairs) await pilots.callMethod(pair.split(".")[0], "GetFittings", [], null, FIELDS, handle);
  const asked = () => session.calls.filter((call) => call.method === "GetFittings").map((call) => [call.service, call.args]);
  // The character and its corporation from the session; no alliance, so that one goes as the BFF sent it.
  assert.deepEqual(asked(), [["charFittingMgr", [PILOT]], ["corpFittingMgr", [1000044]], ["allianceFittingMgr", []]]);
  session.attributes.allianceid = 99000001;
  await pilots.callMethod("allianceFittingMgr", "GetFittings", [], null, FIELDS, handle);
  assert.deepEqual(asked().at(-1), ["allianceFittingMgr", [99000001]]);
  const tally = Object.fromEntries(pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual(tally["charFittingMgr.GetFittings"], { reshaped: 1 });
  assert.deepEqual(tally["corpFittingMgr.GetFittings"], { reshaped: 1 });
  assert.deepEqual(tally["allianceFittingMgr.GetFittings"], { differs: 1, reshaped: 1 });
});

// ── the corporation registry ─────────────────────────────────────────────────

const REGISTRY_PAIRS = { allowed: new Set(["corpRegistry.GetCorporation", "corpRegistry.GetShareholders", "ship.LeaveShip", "account.GetTransactions"]) };

test("the corporation registry is asked on its moniker, bound for the pilot's corporation, as the client's corp service binds it", async () => {
  const { pilots, session, handle } = await selected({}, REGISTRY_PAIRS);
  session.calls.length = 0;
  await pilots.callMethod("corpRegistry", "GetCorporation", [], null, FIELDS, handle);
  await pilots.callMethod("corpRegistry", "GetShareholders", [98000001], null, FIELDS, handle);
  // Moniker('corpRegistry', session.corpid): bound once, as the character was chosen, and both calls made on what it bound.
  assert.deepEqual([session.registryAtChoosing.binds, session.binds], [[{ service: "corpRegistry", params: 1000044 }], []]);
  const registry = session.registryAtChoosing.boundCalls[0].objectID;
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args, call.kwargs]), [
    [registry, "GetCorporation", [], null],
    [registry, "GetShareholders", [98000001], null],
  ]);
  // Nothing was asked of the service by its name.
  assert.deepEqual(session.calls.filter((call) => call.service === "corpRegistry"), []);
  // Asked by name and made on the moniker: the ledger says the call was not the BFF's as it stood.
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "corpRegistry.GetCorporation").statuses, { reshaped: 1 });
});

test("the registry's moniker is the corporation's: kept when the pilot moves, bound again when the corporation changes", async () => {
  const { pilots, session, handle } = await selected({}, REGISTRY_PAIRS);
  const ask = () => pilots.callMethod("corpRegistry", "GetCorporation", [], null, FIELDS, handle);
  await ask();
  // A ship's moniker is for the place (and, docked in a station, for the one call); the registry's is neither. (Another station, so the pilot stays docked.)
  const leave = () => pilots.callMethod("ship", "LeaveShip", [SHIP], null, FIELDS, handle);
  await leave();
  await leave();
  session.attributes.stationid = 60000004;
  session.change({ stationid: [STATION, 60000004] });
  await leave();
  await ask();
  // The registry was bound as the character was chosen, and not again.
  assert.deepEqual(session.registryAtChoosing.binds, [{ service: "corpRegistry", params: 1000044 }]);
  assert.deepEqual(session.binds.map((bind) => [bind.service, bind.params]), [["ship", [STATION, 15]], ["ship", [STATION, 15]], ["ship", [60000004, 15]]]);
  // Another corporation: another registry, bound once by whatever is asked of it first.
  session.attributes.corpid = 98000001;
  session.change({ corpid: [1000044, 98000001] });
  await ask();
  await settled();
  assert.deepEqual(session.binds.filter((bind) => bind.service === "corpRegistry"), [{ service: "corpRegistry", params: 98000001 }]);
  const objects = session.boundCalls.filter((call) => call.method === "GetCorporation").map((call) => call.objectID);
  assert.deepEqual([objects[0], objects[1]], [session.registryAtChoosing.boundCalls[0].objectID, objects[0]]);
  assert.notEqual(objects[1], objects[2]);
});

// What the client's services ask of the registry as their character is chosen, in the order of a recorded login.
const REGISTRY_READS = ["GetAggressionSettings", "GetEveOwners", "GetMyApplications"];
const REGISTRY_KEPT_PAIRS = { allowed: new Set([...REGISTRY_PAIRS.allowed, ...REGISTRY_READS.map((method) => `corpRegistry.${method}`), "corpRegistry.RegisterNewAggressionSettings", "someService.GetAggressionSettings"]) };
/** A corporation's aggression settings and a pilot's applications in the server's form, with a made-up number to tell one answer from another. */
const aggressionOf = (enableAfter) => ({ type: "object", name: "crimewatch.corp_aggression.settings.AggressionSettings", args: { type: "dict", entries: [["_enableAfter", enableAfter], ["_disableAfter", null]] } });
const applicationsOf = (applicationID) => ({ type: "dict", entries: [[applicationID, { type: "list", items: [applicationID, 98000001, PILOT] }]] });
/** A registry that answers the settings and the applications with the count of times each was asked. */
function registryAnswers(more = {}) {
  const times = {};
  const counted = (method, answer) => () => answer(times[method] = (times[method] || 0) + 1);
  return { "bound:GetAggressionSettings": counted("GetAggressionSettings", aggressionOf), "bound:GetMyApplications": counted("GetMyApplications", applicationsOf), "bound:GetEveOwners": { type: "list", items: [] }, ...more };
}
const registryRead = async (pilots, handle, method, who = FIELDS) => (await pilots.callMethod("corpRegistry", method, [], null, who, handle)).result;
/** What was asked of a registry after the choosing. */
const registryCalls = (session) => session.boundCalls.filter(onRegistry).map((call) => call.method);

test("a character chosen has its corporation's registry bound, and asked what the client's services ask of it then", async () => {
  const { pilots, session } = await selected({}, REGISTRY_KEPT_PAIRS);
  const { binds, carried, boundCalls } = session.registryAtChoosing;
  // Moniker('corpRegistry', session.corpid), bound for its own sake; then the three on what it bound, each with nothing.
  assert.deepEqual([binds, carried], [[{ service: "corpRegistry", params: 1000044 }], [null]]);
  assert.deepEqual(boundCalls, REGISTRY_READS.map((method) => ({ objectID: "N=2:1", method, args: [], kwargs: null })));
  // The address book's come between the members' names and the applications, as in a recorded login. The
  // choosing waits for all of them, and not for the table of agents, which is asked for behind them.
  assert.deepEqual(sentLast(session, 4), ["GetAggressionSettings", "GetEveOwners", "GetContactList", "GetInitialState", ...CHOSEN_LAST]);
  // Nothing was asked of the service by its name, and each is in the ledger as the client's own call.
  assert.deepEqual(session.calls.filter((call) => call.service === "corpRegistry"), []);
  assert.deepEqual(REGISTRY_READS.map((method) => ledgerOf(pilots, `corpRegistry.${method}`)), [
    [{ same: 1 }, "eve/client/script/ui/services/crimewatchSvc.py:615"],
    [{ same: 1 }, "eve/client/script/ui/services/corporation/bco_members.py:136"],
    [{ same: 1 }, "eve/client/script/ui/services/corporation/bco_applications.py:72"],
  ]);
});

test("the corporation's aggression settings are answered from what is kept, and its members' names and the pilot's applications are asked for each time", async () => {
  const { pilots, session, handle } = await selected({ answers: registryAnswers() }, REGISTRY_KEPT_PAIRS);
  // Read at the choosing: answered as the server answered then, with nothing asked and nothing more in the ledger.
  assert.deepEqual([await registryRead(pilots, handle, "GetAggressionSettings"), await registryRead(pilots, handle, "GetAggressionSettings")], [aggressionOf(1), aggressionOf(1)]);
  assert.deepEqual([registryCalls(session), session.binds, ledgerOf(pilots, "corpRegistry.GetAggressionSettings")[0]], [[], [], { same: 1 }]);
  // The members' names prime the client's names and are kept by nobody: asked each time, on the same object, and
  // in the ledger as asked for by name.
  await registryRead(pilots, handle, "GetEveOwners");
  await registryRead(pilots, handle, "GetEveOwners");
  assert.deepEqual([registryCalls(session), session.binds, ledgerOf(pilots, "corpRegistry.GetEveOwners")[0]], [["GetEveOwners", "GetEveOwners"], [], { same: 1, reshaped: 2 }]);
  assert.deepEqual(session.boundCalls.map((call) => call.objectID), ["N=2:1", "N=2:1"]);
  // The pilot's applications are the client's to keep, and are not kept here: each read is the server's answer then.
  assert.deepEqual([await registryRead(pilots, handle, "GetMyApplications"), await registryRead(pilots, handle, "GetMyApplications")], [applicationsOf(2), applicationsOf(3)]);
  assert.deepEqual([registryCalls(session).slice(2), ledgerOf(pilots, "corpRegistry.GetMyApplications")[0]], [["GetMyApplications", "GetMyApplications"], { same: 1, reshaped: 2 }]);
  // A read of the same name on another service is that service's own, asked and noted as any call is.
  await pilots.callMethod("someService", "GetAggressionSettings", [], null, FIELDS, handle);
  assert.deepEqual([session.calls.at(-1).service, ledgerOf(pilots, "someService.GetAggressionSettings")[0]], ["someService", { unchecked: 1 }]);
  // Another account's session reads nothing.
  await assert.rejects(pilots.callMethod("corpRegistry", "GetAggressionSettings", [], null, { userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("the server's word of the corporation's aggression settings is what is kept, and a director's own change is not", async () => {
  const { pilots, session, handle } = await selected({ answers: registryAnswers({ "bound:RegisterNewAggressionSettings": aggressionOf(90) }) }, REGISTRY_KEPT_PAIRS);
  // crimewatchSvc.OnCorpAggressionSettingsChange(aggressionSettings): they are what the server says.
  session.notify("OnCorpAggressionSettingsChange", [aggressionOf(77)]);
  assert.deepEqual(await registryRead(pilots, handle, "GetAggressionSettings"), aggressionOf(77));
  // Another notice of the corporation's changes nothing kept.
  session.notify("OnCorporationChanged", [aggressionOf(78)]);
  session.notify("OnCorporationApplicationChanged", [98000001, PILOT, 5, null]);
  assert.deepEqual([await registryRead(pilots, handle, "GetAggressionSettings"), registryCalls(session)], [aggressionOf(77), []]);
  // corp_ui_home's button, RegisterNewAggressionSettings(bool), on the registry: what it answers is for the window
  // that asked. What crimewatchSvc keeps changes by the server's notice, and not by the call.
  const pressed = await pilots.callMethod("corpRegistry", "RegisterNewAggressionSettings", [true], null, FIELDS, handle);
  assert.deepEqual([pressed.result, session.boundCalls.at(-1)], [aggressionOf(90), { objectID: "N=2:1", method: "RegisterNewAggressionSettings", args: [true], kwargs: null }]);
  assert.deepEqual(ledgerOf(pilots, "corpRegistry.RegisterNewAggressionSettings"), [{ reshaped: 1 }, "eve/client/script/ui/shared/neocom/corporation/corp_ui_home.py:634"]);
  assert.deepEqual(await registryRead(pilots, handle, "GetAggressionSettings"), aggressionOf(77));
  // A notice that says nothing leaves nothing kept: the settings are asked for when they are next wanted, and kept.
  session.notify("OnCorpAggressionSettingsChange", null);
  assert.deepEqual([await registryRead(pilots, handle, "GetAggressionSettings"), await registryRead(pilots, handle, "GetAggressionSettings")], [aggressionOf(2), aggressionOf(2)]);
  assert.deepEqual([registryCalls(session), ledgerOf(pilots, "corpRegistry.GetAggressionSettings")[0]], [["RegisterNewAggressionSettings", "GetAggressionSettings"], { same: 2 }]);
});

test("in another corporation its registry is bound and asked its settings and its members' names, and not the pilot's applications", async () => {
  const { pilots, session, handle } = await selected({ answers: registryAnswers() }, REGISTRY_KEPT_PAIRS);
  // crimewatchSvc.ProcessSessionChange and bco_members.OnSessionChanged: at once, with nothing having asked.
  session.attributes.corpid = 98000001;
  session.change({ corpid: [1000044, 98000001] });
  await settled();
  assert.deepEqual([session.binds, session.carried], [[{ service: "corpRegistry", params: 98000001 }], [null]]);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args]), [["N=2:2", "GetAggressionSettings", []], ["N=2:2", "GetEveOwners", []]]);
  // The settings kept are the new corporation's.
  assert.deepEqual(await registryRead(pilots, handle, "GetAggressionSettings"), aggressionOf(2));
  assert.deepEqual([session.boundCalls.length, ledgerOf(pilots, "corpRegistry.GetAggressionSettings")[0], ledgerOf(pilots, "corpRegistry.GetMyApplications")[0]], [2, { same: 2 }, { same: 1 }]);
  // A read that comes while the new corporation's are being made waits for theirs, and asks nothing itself.
  session.attributes.corpid = 98000002;
  session.change({ corpid: [98000001, 98000002] });
  assert.deepEqual(await registryRead(pilots, handle, "GetAggressionSettings"), aggressionOf(3));
  await settled();
  assert.deepEqual(session.boundCalls.slice(2).map((call) => [call.objectID, call.method]), [["N=2:3", "GetAggressionSettings"], ["N=2:3", "GetEveOwners"]]);
  // The session's corporation gone, as a session winding down has it: nothing is bound, and nothing asked.
  session.attributes.corpid = null;
  session.change({ corpid: [98000002, null] });
  await settled();
  assert.deepEqual([session.binds.length, session.boundCalls.length], [2, 4]);
});

test("the settings that cannot be read at the choosing are asked for when they are wanted, and the choosing is none the worse", async () => {
  let refuse = true;
  const { pilots, session, handle, outcome } = await selected({ answers: registryAnswers({ "bound:GetAggressionSettings": () => { if (refuse) throw refusedBy("NotNow"); return aggressionOf(5); } }) }, REGISTRY_KEPT_PAIRS);
  // Each fails for itself: the two after it were asked.
  assert.deepEqual([outcome.session.characterID, session.registryAtChoosing.boundCalls.map((call) => call.method)], [PILOT, REGISTRY_READS]);
  // What was not read is asked for when it is wanted, a refusal then is the caller's, and an answer is kept.
  await rejects(registryRead(pilots, handle, "GetAggressionSettings"), "CALL_REFUSED");
  refuse = false;
  assert.deepEqual([await registryRead(pilots, handle, "GetAggressionSettings"), await registryRead(pilots, handle, "GetAggressionSettings")], [aggressionOf(5), aggressionOf(5)]);
  assert.deepEqual(registryCalls(session), ["GetAggressionSettings", "GetAggressionSettings"]);
  // In another corporation whose settings cannot be read, the last corporation's are not answered for its own.
  refuse = true;
  session.attributes.corpid = 98000001;
  session.change({ corpid: [1000044, 98000001] });
  await settled();
  await rejects(registryRead(pilots, handle, "GetAggressionSettings"), "CALL_REFUSED");
  // Two at once that find none kept ask once.
  let first = true;
  const lost = await selected({ answers: registryAnswers({ "bound:GetAggressionSettings": () => { if (first) { first = false; throw refusedBy("NotNow"); } return aggressionOf(9); } }) }, REGISTRY_KEPT_PAIRS);
  const [one, two] = await Promise.all([registryRead(lost.pilots, lost.handle, "GetAggressionSettings"), registryRead(lost.pilots, lost.handle, "GetAggressionSettings")]);
  assert.deepEqual([one, two, registryCalls(lost.session)], [aggressionOf(9), aggressionOf(9), ["GetAggressionSettings"]]);
  // A registry that cannot be bound: each of the three tries it for itself, as each of the client's services would, and the choosing stands.
  const unbound = await selected({ answers: { "bind:corpRegistry": () => { throw sessionError("RESOLVE_FAILED", "corpRegistry could not say where its object lives."); } } }, REGISTRY_KEPT_PAIRS);
  assert.deepEqual([unbound.outcome.session.characterID, unbound.session.registryAtChoosing.binds.length, unbound.session.registryAtChoosing.boundCalls], [PILOT, 3, []]);
  // A connection lost in the middle of them is the choosing lost, as one lost anywhere in it is: no session is handed out.
  const built = build({ answers: { "bound:GetEveOwners": () => { built.session.drop(); throw sessionError("CONNECTION_CLOSED"); } } }, REGISTRY_KEPT_PAIRS);
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
  assert.deepEqual([built.session.boundCalls.filter(onRegistry).map((call) => call.method), built.pilots.size], [["GetAggressionSettings", "GetEveOwners"], 0]);
});

// ── the address book ─────────────────────────────────────────────────────────

const ADDRESS_BOOK_PAIRS = { allowed: new Set(["charMgr.GetContactList", "onlineStatus.GetInitialState", "onlineStatus.GetOnlineStatus", "onlineStatus.Prime", "corpRegistry.GetCorporateContacts", "station.GetGuests"]) };
const byNameOf = (session, ...services) => session.calls.filter((call) => services.includes(call.service)).map((call) => [`${call.service}.${call.method}`, call.args, call.kwargs]);

test("a character chosen has its contacts, its corporation's and who of them is online asked for as the client's address book asks", async () => {
  // In a player's corporation: the pilot's own by name, the corporation's of its registry, the online state by name.
  const { pilots, session } = await selected({ corpid: 98000001 }, ADDRESS_BOOK_PAIRS);
  assert.deepEqual(byNameOf(session, "charMgr", "onlineStatus"), [["charMgr.GetContactList", [], null], ["onlineStatus.GetInitialState", [], null]]);
  // The corporation's, on the object the registry was bound to as the character was chosen, with nothing.
  assert.deepEqual([session.registryAtChoosing.binds.length, session.registryAtChoosing.boundCalls.map((call) => [call.objectID, call.method, call.args, call.kwargs])], [1, [
    ["N=2:1", "GetAggressionSettings", [], null], ["N=2:1", "GetEveOwners", [], null], ["N=2:1", "GetCorporateContacts", [], null], ["N=2:1", "GetMyApplications", [], null],
  ]]);
  // Side by side, in the order of a recorded login, after the members' names and before the applications.
  assert.deepEqual(sentLast(session, 5), ["GetAggressionSettings", "GetEveOwners", "GetContactList", "GetCorporateContacts", "GetInitialState", ...CHOSEN_LAST]);
  // Each is in the ledger as the client's own call.
  assert.deepEqual(["charMgr.GetContactList", "corpRegistry.GetCorporateContacts", "onlineStatus.GetInitialState"].map((pair) => ledgerOf(pilots, pair)), [
    [{ same: 1 }, "eve/client/script/ui/shared/neocom/addressBook/addressbookService.py:207"],
    [{ same: 1 }, "eve/client/script/ui/services/corporation/base_corporation.py:993"],
    [{ same: 1 }, "eve/client/script/ui/shared/comtool/onlineStatus.py:79"],
  ]);

  // In an NPC corporation, as the stand-in pilot is by default, the corporation's are none and are not asked for.
  const npc = await selected({}, ADDRESS_BOOK_PAIRS);
  assert.deepEqual([byNameOf(npc.session, "charMgr", "onlineStatus").map(([pair]) => pair), npc.session.registryAtChoosing.boundCalls.map((call) => call.method)], [
    ["charMgr.GetContactList", "onlineStatus.GetInitialState"], REGISTRY_READS,
  ]);
  assert.equal(ledgerOf(npc.pilots, "corpRegistry.GetCorporateContacts"), null);
});

test("nothing of the address book's is kept: a read of it through the BFF asks the server, and the client's own name for its priming is no call of the client's", async () => {
  let asked = 0;
  const { pilots, session, handle } = await selected({ corpid: 98000001, answers: { "charMgr.GetContactList": () => { asked += 1; return { type: "list", items: [asked] }; } } }, ADDRESS_BOOK_PAIRS);
  const read = async (service, method, args = []) => (await pilots.callMethod(service, method, args, null, FIELDS, handle)).result;
  // Asked at the choosing, and again at each read.
  assert.deepEqual([await read("charMgr", "GetContactList"), await read("charMgr", "GetContactList"), ledgerOf(pilots, "charMgr.GetContactList")[0]], [{ type: "list", items: [2] }, { type: "list", items: [3] }, { same: 3 }]);
  await read("onlineStatus", "GetInitialState");
  await read("corpRegistry", "GetCorporateContacts");
  assert.deepEqual([ledgerOf(pilots, "onlineStatus.GetInitialState")[0], ledgerOf(pilots, "corpRegistry.GetCorporateContacts")[0], session.boundCalls.at(-1)], [{ same: 2 }, { same: 1, reshaped: 1 }, { objectID: "N=2:1", method: "GetCorporateContacts", args: [], kwargs: null }]);
  // onlineStatus.GetOnlineStatus(charID) is the client's, for a character its kept state does not have.
  await read("onlineStatus", "GetOnlineStatus", [PILOT + 1]);
  assert.deepEqual([session.calls.at(-1), ledgerOf(pilots, "onlineStatus.GetOnlineStatus")], [{ service: "onlineStatus", method: "GetOnlineStatus", args: [PILOT + 1], kwargs: null }, [{ same: 1 }, "eve/client/script/ui/shared/comtool/onlineStatus.py:56"]]);
  // Prime is the client's own service's method, and never a call of its: asked of the server it is the web's alone.
  await read("onlineStatus", "Prime");
  assert.deepEqual(ledgerOf(pilots, "onlineStatus.Prime"), [{ "web-only": 1 }, "eve/client/script/ui/shared/comtool/onlineStatus.py:74"]);
});

test("each of the address book's reads fails for itself, and the choosing is none the worse", async () => {
  // The pilot's own refused: the corporation's and the online state are asked all the same, and what follows them.
  const refused = await selected({ corpid: 98000001, answers: { "charMgr.GetContactList": () => { throw refusedBy("NotNow"); } } }, ADDRESS_BOOK_PAIRS);
  assert.deepEqual([refused.outcome.session.characterID, sentLast(refused.session, 5)], [PILOT, ["GetAggressionSettings", "GetEveOwners", "GetContactList", "GetCorporateContacts", "GetInitialState", ...CHOSEN_LAST]]);
  // The corporation's refused, and the online state.
  const others = await selected({ corpid: 98000001, answers: { "bound:GetCorporateContacts": () => { throw refusedBy("NotNow"); }, "onlineStatus.GetInitialState": () => { throw refusedBy("NotNow"); } } }, ADDRESS_BOOK_PAIRS);
  assert.deepEqual([others.outcome.session.characterID, sentLast(others.session, 0)], [PILOT, CHOSEN_LAST]);
  // So does the asking for the applications that follows them.
  const unapplied = await selected({ answers: { "bound:GetMyApplications": () => { throw refusedBy("NotNow"); } } }, ADDRESS_BOOK_PAIRS);
  assert.deepEqual([unapplied.outcome.session.characterID, sentLast(unapplied.session, 0)], [PILOT, CHOSEN_LAST]);
  // The choosing waits for the address book's answers: the applications are not asked for, nor a session handed out, before them.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const waiting = build({ answers: { "charMgr.GetContactList": () => gate } }, ADDRESS_BOOK_PAIRS);
  let chosen = false;
  const choosing = waiting.pilots.selectCharacter([PILOT, null, true], null, FIELDS).then(() => { chosen = true; });
  await settled();
  assert.deepEqual([chosen, waiting.session.sent.at(-1)], [false, "GetInitialState"]);
  release(null);
  await choosing;
  assert.deepEqual([chosen, sentLast(waiting.session, 0)], [true, CHOSEN_LAST]);
  // A connection lost under them is the choosing lost, as one lost anywhere in it is: no session is handed out.
  const built = build({ answers: { "onlineStatus.GetInitialState": () => { built.session.drop(); throw sessionError("CONNECTION_CLOSED"); } } }, ADDRESS_BOOK_PAIRS);
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
  assert.deepEqual([built.session.sent.at(-1), built.pilots.size], ["GetInitialState", 0]);
});

// ── the notifications ────────────────────────────────────────────────────────

const NOTIFICATION_READS = ["GetAllNotifications", "GetUnprocessed", "GetByGroupID"];
/** notificationSvc's own marking and deleting, each with what the BFF's route for it sends. */
const NOTIFICATION_WRITES = [["MarkGroupAsProcessed", [3]], ["MarkAllAsProcessed", []], ["MarkAsProcessed", [[88]]], ["DeleteGroupNotifications", [3]], ["DeleteAllNotifications", []], ["DeleteNotifications", [[88]]]];
const NOTIFICATION_PAIRS = { allowed: new Set([...NOTIFICATION_READS, ...NOTIFICATION_WRITES.map(([method]) => method), "LogNotificationInteraction"].map((method) => `notificationMgr.${method}`).concat("someService.GetUnprocessed", "station.GetGuests")) };
/** A notification manager that answers each read with its name and the count of times that read was asked. */
function notificationAnswers(more = {}) {
  const times = {};
  const counted = (method) => () => ({ type: "list", items: [method, times[method] = (times[method] || 0) + 1] });
  return { ...Object.fromEntries(NOTIFICATION_READS.map((method) => [`notificationMgr.${method}`, counted(method)])), ...more };
}
const notified = (session) => session.calls.filter((call) => call.service === "notificationMgr").map((call) => [call.method, call.args, call.kwargs]);
const answered = (method, time) => ({ type: "list", items: [method, time] });

test("a character chosen has all its notifications asked for as the client's notification window asks, and the service's three lists are kept", async () => {
  const { pilots, session, handle } = await selected({ answers: notificationAnswers() }, NOTIFICATION_PAIRS);
  const read = async (method, args = [], kwargs = null) => (await pilots.callMethod("notificationMgr", method, args, kwargs, FIELDS, handle)).result;
  // notificationUI._NotificationProvider: GetAllNotifications(fromID=0), a keyword, by name, as the client's own call.
  assert.deepEqual([notified(session), ledgerOf(pilots, "notificationMgr.GetAllNotifications")], [
    [["GetAllNotifications", [], { fromID: 0 }]], [{ same: 1 }, "eve/client/script/ui/services/mail/notificationSvc.py:93"],
  ]);
  // notificationSvc.allNotifications: read again, however the BFF spells it, it is what was answered then, with nothing asked.
  assert.deepEqual([await read("GetAllNotifications", [0]), await read("GetAllNotifications", [], { fromID: 0 }), await read("GetAllNotifications")], [answered("GetAllNotifications", 1), answered("GetAllNotifications", 1), answered("GetAllNotifications", 1)]);
  assert.deepEqual([notified(session).length, ledgerOf(pilots, "notificationMgr.GetAllNotifications")[0]], [1, { same: 1 }]);
  // From a later one they are another list, which nothing keeps: asked each time, by the keyword.
  assert.deepEqual([await read("GetAllNotifications", [7]), await read("GetAllNotifications", [7])], [answered("GetAllNotifications", 2), answered("GetAllNotifications", 3)]);
  assert.deepEqual([notified(session).slice(1), ledgerOf(pilots, "notificationMgr.GetAllNotifications")[0]], [[["GetAllNotifications", [], { fromID: 7 }], ["GetAllNotifications", [], { fromID: 7 }]], { same: 1, reshaped: 2 }]);
  // notificationSvc.unreadNotifications and notifications[groupID]: asked for when first wanted, and kept, a group at a time.
  assert.deepEqual([await read("GetUnprocessed"), await read("GetUnprocessed")], [answered("GetUnprocessed", 1), answered("GetUnprocessed", 1)]);
  assert.deepEqual([await read("GetByGroupID", [3]), await read("GetByGroupID", [3]), await read("GetByGroupID", [4]), await read("GetByGroupID", [3])], [answered("GetByGroupID", 1), answered("GetByGroupID", 1), answered("GetByGroupID", 2), answered("GetByGroupID", 1)]);
  assert.deepEqual([notified(session).slice(3), ledgerOf(pilots, "notificationMgr.GetUnprocessed")[0], ledgerOf(pilots, "notificationMgr.GetByGroupID")[0]], [
    [["GetUnprocessed", [], null], ["GetByGroupID", [3], null], ["GetByGroupID", [4], null]], { same: 1 }, { same: 2 },
  ]);
  // Two at once that find nothing kept ask once.
  assert.deepEqual(await Promise.all([read("GetByGroupID", [9]), read("GetByGroupID", [9])]), [answered("GetByGroupID", 3), answered("GetByGroupID", 3)]);
  // A read of the same name on another service is that service's own; another account's session reads nothing.
  await pilots.callMethod("someService", "GetUnprocessed", [], null, FIELDS, handle);
  assert.deepEqual([session.calls.at(-1).service, ledgerOf(pilots, "someService.GetUnprocessed")[0]], ["someService", { unchecked: 1 }]);
  await assert.rejects(pilots.callMethod("notificationMgr", "GetUnprocessed", [], null, { userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("what is kept of the notifications is forgotten at the server's word of a change and at the pilot's own marking or deleting", async () => {
  let refuse = false;
  const { pilots, session, handle } = await selected({ answers: notificationAnswers({ "notificationMgr.DeleteNotifications": () => { if (refuse) throw refusedBy("NotNow"); return null; } }) }, NOTIFICATION_PAIRS);
  const read = async (method, args = []) => (await pilots.callMethod("notificationMgr", method, args, null, FIELDS, handle)).result.items[1];
  const all = () => Promise.all([read("GetAllNotifications", [0]), read("GetUnprocessed"), read("GetByGroupID", [3])]);
  assert.deepEqual(await all(), [1, 1, 1]);
  // A notice that is none of the notification service's leaves them kept.
  session.notify("OnNotificationSomethingElse", [1]);
  assert.deepEqual(await all(), [1, 1, 1]);
  // notificationSvc's three notices: each forgets all three lists, which are asked for when next wanted and kept again.
  let asked = 1;
  for (const notice of ["OnNotificationReceived", "OnNotificationDeleted", "OnNotificationUndeleted"]) {
    session.notify(notice, [[88]]);
    asked += 1;
    assert.deepEqual([await all(), await all()], [[asked, asked, asked], [asked, asked, asked]], notice);
  }
  // The pilot's own marking and deleting, each of the six: after it, done or refused. What only logs a look at one changes nothing.
  for (const [write, args] of NOTIFICATION_WRITES) {
    await pilots.callMethod("notificationMgr", write, args, null, FIELDS, handle);
    asked += 1;
    assert.deepEqual([await all(), await all()], [[asked, asked, asked], [asked, asked, asked]], write);
  }
  await pilots.callMethod("notificationMgr", "LogNotificationInteraction", [12], null, FIELDS, handle);
  assert.deepEqual(await all(), [asked, asked, asked]);
  refuse = true;
  await rejects(pilots.callMethod("notificationMgr", "DeleteNotifications", [[88]], null, FIELDS, handle), "CALL_REFUSED");
  assert.deepEqual(await all(), [asked + 1, asked + 1, asked + 1]);

  // An answer on its way when the lists are forgotten may be from before what forgot them: it is handed on, and not kept.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  const late = await selected({ answers: notificationAnswers({ "notificationMgr.GetUnprocessed": () => (held ? { type: "list", items: ["GetUnprocessed", "then"] } : gate) }) }, NOTIFICATION_PAIRS);
  const unread = () => late.pilots.callMethod("notificationMgr", "GetUnprocessed", [], null, FIELDS, late.handle).then((answer) => answer.result.items[1]);
  const first = unread();
  await settled();
  late.session.notify("OnNotificationReceived", [89]);
  held = true;
  release({ type: "list", items: ["GetUnprocessed", "before"] });
  assert.deepEqual([await first, await unread(), await unread()], ["before", "then", "then"]);
  assert.equal(notified(late.session).filter(([method]) => method === "GetUnprocessed").length, 2);
});

test("the notifications that cannot be read at the choosing are asked for when they are wanted, and the choosing is none the worse", async () => {
  let refuse = true;
  const { pilots, session, handle, outcome } = await selected({ answers: { "notificationMgr.GetAllNotifications": () => { if (refuse) throw refusedBy("NotNow"); return answered("GetAllNotifications", "now"); } } }, NOTIFICATION_PAIRS);
  const read = async () => (await pilots.callMethod("notificationMgr", "GetAllNotifications", [0], null, FIELDS, handle)).result;
  assert.deepEqual([outcome.session.characterID, sentLast(session, 0)], [PILOT, CHOSEN_LAST]);
  // A refusal then is the caller's, and leaves nothing kept; an answer is kept.
  await rejects(read(), "CALL_REFUSED");
  refuse = false;
  assert.deepEqual([await read(), await read(), notified(session).length], [answered("GetAllNotifications", "now"), answered("GetAllNotifications", "now"), 3]);
  // A connection lost under it is the choosing lost, as one lost anywhere in it is: no session is handed out.
  const built = build({ answers: { "notificationMgr.GetAllNotifications": () => { built.session.drop(); throw sessionError("CONNECTION_CLOSED"); } } }, NOTIFICATION_PAIRS);
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
  assert.deepEqual([built.session.sent.at(-1), built.pilots.size], ["GetAllNotifications", 0]);
});

// ── the names of owners ──────────────────────────────────────────────────────

const [A_CORPORATION, AN_ALLIANCE, A_CHARACTER] = [98000001, 99000001, PILOT + 1];
const OWNERS_KNOWN = { [A_CORPORATION]: ["Made-up Industries", 2], [AN_ALLIANCE]: ["Made-up", 16159], [A_CHARACTER]: ["Someone Else", 1380] };
/**
 * A config service that answers GetMultiOwnersEx in the form this server's answer comes off the wire in: the
 * columns, the last of them a raw string, and a row for each owner it knows, each name a raw string.
 */
function ownerAnswers(more = {}) {
  return {
    "config.GetMultiOwnersEx": ([asked]) => [
      ["ownerID", "ownerName", "typeID", "gender", Buffer.from("ownerNameID")],
      asked.items.filter((ownerID) => ownerID in OWNERS_KNOWN).map((ownerID) => [ownerID, Buffer.from(OWNERS_KNOWN[ownerID][0]), OWNERS_KNOWN[ownerID][1], 0, null]),
    ],
    ...more,
  };
}
const ownersAsked = (session) => session.calls.filter((call) => call.service === "config").map((call) => [call.method, call.args, call.kwargs]);

test("owners are named as the client's cfg.eveowners names them: those not known asked for together, once, and kept", async () => {
  const { pilots, session, handle } = await selected({ answers: ownerAnswers() }, { allowed: new Set(["station.GetGuests"]) });
  // Nothing is asked until a name is wanted, and nothing for no one.
  assert.deepEqual([ownersAsked(session), [...(await pilots.ownersNamed([], WHO, handle))]], [[], []]);
  // cfg.eveowners.Prime: config.GetMultiOwnersEx(a list of the IDs), by name. The transport's own call: no route's pair.
  const first = await pilots.ownersNamed([A_CORPORATION, AN_ALLIANCE], WHO, handle);
  assert.deepEqual([...first], [[A_CORPORATION, { name: "Made-up Industries", typeID: 2 }], [AN_ALLIANCE, { name: "Made-up", typeID: 16159 }]]);
  assert.deepEqual(ownersAsked(session), [["GetMultiOwnersEx", [{ type: "list", items: [A_CORPORATION, AN_ALLIANCE] }], null]]);
  // Asked about again among others: only what is not known is asked for, each owner once however often it is named.
  const second = await pilots.ownersNamed([AN_ALLIANCE, A_CHARACTER, A_CORPORATION, A_CHARACTER, 0, null, "nobody"], WHO, handle);
  assert.deepEqual([...second], [[AN_ALLIANCE, { name: "Made-up", typeID: 16159 }], [A_CHARACTER, { name: "Someone Else", typeID: 1380 }], [A_CORPORATION, { name: "Made-up Industries", typeID: 2 }]]);
  assert.deepEqual(ownersAsked(session).slice(1), [["GetMultiOwnersEx", [{ type: "list", items: [A_CHARACTER] }], null]]);
  // One the server has no row for is no owner, and is not asked about again (the Recordset's knownLuzers).
  assert.deepEqual([[...(await pilots.ownersNamed([77, A_CORPORATION], WHO, handle))], [...(await pilots.ownersNamed([77], WHO, handle))]], [[[77, null], [A_CORPORATION, { name: "Made-up Industries", typeID: 2 }]], [[77, null]]]);
  assert.deepEqual(ownersAsked(session).slice(2), [["GetMultiOwnersEx", [{ type: "list", items: [77] }], null]]);
  // Two askings at once of one not known ask once.
  const [one, two] = await Promise.all([pilots.ownersNamed([78], WHO, handle), pilots.ownersNamed([78], WHO, handle)]);
  assert.deepEqual([[...one], [...two], ownersAsked(session).length], [[[78, null]], [[78, null]], 4]);
  // Each asking is in the ledger as the client's own call.
  assert.deepEqual(ledgerOf(pilots, "config.GetMultiOwnersEx"), [{ same: 4 }, "carbon/common/script/sys/cfg.py:579"]);
  // Another account's session is told nothing.
  await assert.rejects(pilots.ownersNamed([A_CORPORATION], { userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("an asking for owners' names that fails fails for who asked, keeps nothing, and the next asks again", async () => {
  let refuse = true;
  const rows = { type: "list", items: [{ type: "list", items: [A_CORPORATION, "Made-up Industries", 2, 0, null] }, { type: "list", items: [79, null, 0, 0, null] }] };
  const { pilots, session, handle } = await selected({ answers: { "config.GetMultiOwnersEx": () => { if (refuse) throw refusedBy("NotNow"); return [{ type: "list", items: ["ownerID", "ownerName", "typeID", "gender", "ownerNameID"] }, rows]; } } }, { allowed: new Set(["station.GetGuests"]) });
  await rejects(pilots.ownersNamed([A_CORPORATION, 79], WHO, handle), "CALL_REFUSED");
  refuse = false;
  // Answered as lists, and with a plain string for a name, as any call's answer may be; a row with no name and no type is kept as that.
  assert.deepEqual([...(await pilots.ownersNamed([A_CORPORATION, 79], WHO, handle))], [[A_CORPORATION, { name: "Made-up Industries", typeID: 2 }], [79, { name: null, typeID: 0 }]]);
  assert.deepEqual([ownersAsked(session).length, [...(await pilots.ownersNamed([79], WHO, handle))], ownersAsked(session).length], [2, [[79, { name: null, typeID: 0 }]], 2]);
});

// ── the calendar's months, and the contracts' login figures ──────────────────

/** The client's calendar's own writes that change an event, each with something to send; and two that change none. */
const CALENDAR_WRITES = ["CreatePersonalEvent", "CreateCorporationEvent", "CreateAllianceEvent", "EditPersonalEvent", "EditCorporationEvent", "EditAllianceEvent", "DeleteEvent"];
const CALENDAR_PAIRS = { allowed: new Set(["calendarProxy.GetEventList", "contractProxy.GetLoginInfo", "notificationMgr.GetAllNotifications", "calendarMgr.SendEventResponse", "calendarMgr.UpdateEventParticipants", ...CALENDAR_WRITES.map((method) => `calendarMgr.${method}`), "someService.GetEventList", "someService.DeleteEvent", "station.GetGuests"]) };
/** A calendar that answers a month's events with the month, the year, and the count of times that month was asked for. */
function calendarAnswers(more = {}) {
  const times = {};
  return { "calendarProxy.GetEventList": ([month, year]) => ({ type: "list", items: [month, year, times[`${year}-${month}`] = (times[`${year}-${month}`] || 0) + 1] }), ...more };
}
const atTheProxy = (session) => session.proxyCalls.map((call) => [`${call.service}.${call.method}`, call.args, call.kwargs]);
/** The stand-in's clock is in November 2023 unless a test says. */
const [NOVEMBER, DECEMBER] = [[11, 2023], [12, 2023]];

test("a character chosen has what of its contracts wants attention asked for, and this month's events and the next's, which are kept", async () => {
  const { pilots, session, handle } = await selected({ answers: calendarAnswers({ "contractProxy.GetLoginInfo": () => ({ type: "list", items: ["figures"] }) }) }, CALENDAR_PAIRS);
  const month = async (monthAndYear) => (await pilots.callMethod("calendarProxy", "GetEventList", monthAndYear, null, FIELDS, handle)).result.items;
  // contracts.NeocomBlink and calendar.GetEventsNextXMonths: each at the client's proxy node, the months by the server's clock.
  assert.deepEqual(atTheProxy(session), [["contractProxy.GetLoginInfo", [], null], ["calendarProxy.GetEventList", NOVEMBER, null], ["calendarProxy.GetEventList", DECEMBER, null]]);
  assert.deepEqual([ledgerOf(pilots, "contractProxy.GetLoginInfo"), ledgerOf(pilots, "calendarProxy.GetEventList")], [
    [{ same: 1 }, "eve/client/script/ui/shared/neocom/contracts/contracts.py:191"], [{ same: 2 }, "eve/client/script/ui/services/eveCalendarsvc.py:239"],
  ]);
  // calendar.events[(month, year)]: a month read again is what was answered then, with nothing asked.
  assert.deepEqual([await month(NOVEMBER), await month(DECEMBER), await month(NOVEMBER)], [[11, 2023, 1], [12, 2023, 1], [11, 2023, 1]]);
  assert.deepEqual([session.proxyCalls.length, ledgerOf(pilots, "calendarProxy.GetEventList")[0]], [3, { same: 2 }]);
  // Another month is asked for when it is first wanted, and kept. The same month of another year is another month.
  assert.deepEqual([await month([1, 2024]), await month([1, 2024]), await month([11, 2024])], [[1, 2024, 1], [1, 2024, 1], [11, 2024, 1]]);
  assert.deepEqual([atTheProxy(session).slice(3), ledgerOf(pilots, "calendarProxy.GetEventList")[0]], [[["calendarProxy.GetEventList", [1, 2024], null], ["calendarProxy.GetEventList", [11, 2024], null]], { same: 4 }]);
  // The contracts' figures the client asks for once and keeps nowhere: a read of them through the BFF asks.
  await pilots.callMethod("contractProxy", "GetLoginInfo", [], null, FIELDS, handle);
  assert.deepEqual([atTheProxy(session).at(-1), ledgerOf(pilots, "contractProxy.GetLoginInfo")[0]], [["contractProxy.GetLoginInfo", [], null], { same: 2 }]);
  // A read of the same name on another service is that service's own.
  await pilots.callMethod("someService", "GetEventList", NOVEMBER, null, FIELDS, handle);
  assert.deepEqual([session.calls.at(-1).service, ledgerOf(pilots, "someService.GetEventList")[0]], ["someService", { unchecked: 1 }]);

  // In December the month after is January of the next year.
  const december = await selected({ serverNow: Date.UTC(2026, 11, 15, 12), answers: calendarAnswers() }, CALENDAR_PAIRS);
  assert.deepEqual(atTheProxy(december.session).slice(1), [["calendarProxy.GetEventList", [12, 2026], null], ["calendarProxy.GetEventList", [1, 2027], null]]);
});

test("the months of events kept are forgotten when an event is made, changed or taken away, and in another corporation or alliance", async () => {
  let refuse = false;
  const { pilots, session, handle } = await selected({ ...IN_AN_ALLIANCE, answers: calendarAnswers({ "calendarMgr.DeleteEvent": () => { if (refuse) throw refusedBy("NotNow"); return null; } }) }, CALENDAR_PAIRS);
  const read = async (monthAndYear) => (await pilots.callMethod("calendarProxy", "GetEventList", monthAndYear, null, FIELDS, handle)).result.items[2];
  const both = () => Promise.all([read(NOVEMBER), read(DECEMBER)]);
  assert.deepEqual(await both(), [1, 1]);
  let asked = 1;
  const forgets = async (what, change) => {
    await change();
    asked += 1;
    assert.deepEqual([await both(), await both()], [[asked, asked], [asked, asked]], what);
  };
  const keeps = async (what, change) => {
    await change();
    assert.deepEqual(await both(), [asked, asked], what);
  };
  // The server's word of an event: calendar.OnNewCalendarEvent, OnEditCalendarEvent, OnRemoveCalendarEvent.
  for (const notice of ["OnNewCalendarEvent", "OnEditCalendarEvent", "OnRemoveCalendarEvent"]) await forgets(notice, () => session.notify(notice, [7, PILOT]));
  // A notice of something else, the notifications' among them, leaves the months kept.
  await keeps("another notice", () => { session.notify("OnNotificationReceived", [1]); session.notify("OnCalendarSomethingElse", [1]); });
  // The pilot's own making, changing and deleting of an event, each of the client's seven, done or refused.
  for (const write of CALENDAR_WRITES) await forgets(write, () => pilots.callMethod("calendarMgr", write, [7], null, FIELDS, handle));
  refuse = true;
  await forgets("a deleting refused", () => rejects(pilots.callMethod("calendarMgr", "DeleteEvent", [7], null, FIELDS, handle), "CALL_REFUSED"));
  // An answer to an invitation and a change of who is invited change no event; nor does another service's write of the name.
  await keeps("an answer to an invitation", () => pilots.callMethod("calendarMgr", "SendEventResponse", [7, PILOT, 1], null, FIELDS, handle));
  await keeps("who is invited", () => pilots.callMethod("calendarMgr", "UpdateEventParticipants", [7, [], []], null, FIELDS, handle));
  await keeps("another service's", () => pilots.callMethod("someService", "DeleteEvent", [7], null, FIELDS, handle));
  // calendar.OnSessionChanged: in another corporation, or another alliance, the events are other events.
  await forgets("another corporation", async () => { session.attributes.corpid = 98000002; session.change({ corpid: [98000001, 98000002] }); await settled(); });
  await forgets("another alliance", async () => { session.attributes.allianceid = ALLIANCE + 1; session.change({ allianceid: [ALLIANCE, ALLIANCE + 1] }); await settled(); });
  // Another station is neither.
  await keeps("another station", async () => { session.attributes.stationid = 60000004; session.change({ stationid: [STATION, 60000004] }); await settled(); });
  // What forgets the months leaves the notifications kept, and what forgets those leaves the months.
  const notifications = () => session.calls.filter((call) => call.service === "notificationMgr").length;
  const allOfThem = () => pilots.callMethod("notificationMgr", "GetAllNotifications", [0], null, FIELDS, handle);
  await allOfThem();
  const before = notifications();
  session.notify("OnNewCalendarEvent", [8, PILOT]);
  await allOfThem();
  assert.equal(notifications(), before);
});

test("the calendar's months and the contracts' figures that cannot be read at the choosing leave it none the worse", async () => {
  // The contracts' figures refused, and this month's events: the next month's are asked for all the same.
  let refuse = true;
  const { pilots, session, handle, outcome } = await selected({ answers: calendarAnswers({
    "contractProxy.GetLoginInfo": () => { throw refusedBy("NotNow"); },
    "calendarProxy.GetEventList": ([month, year]) => { if (refuse && month === 11) throw refusedBy("NotNow"); return { type: "list", items: [month, year, "answered"] }; },
  }) }, CALENDAR_PAIRS);
  assert.deepEqual([outcome.session.characterID, sentLast(session, 0)], [PILOT, CHOSEN_LAST]);
  // What was not read is asked for when it is wanted: a refusal then is the caller's, and an answer is kept.
  const november = () => pilots.callMethod("calendarProxy", "GetEventList", NOVEMBER, null, FIELDS, handle).then((answer) => answer.result.items);
  await rejects(november(), "CALL_REFUSED");
  refuse = false;
  assert.deepEqual([await november(), await november(), session.proxyCalls.filter((call) => call.method === "GetEventList").map((call) => call.args[0])], [[11, 2023, "answered"], [11, 2023, "answered"], [11, 12, 11, 11]]);
  // A connection lost under them is the choosing lost, as one lost anywhere in it is: no session is handed out.
  const built = build({ answers: { "calendarProxy.GetEventList": () => { built.session.drop(); throw sessionError("CONNECTION_CLOSED"); } } }, CALENDAR_PAIRS);
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
  assert.deepEqual([built.session.sent.at(-1), built.pilots.size], ["GetEventList", 0]);
});

// ── the alliance's registry ──────────────────────────────────────────────────

const ALLIANCE = 99000001;
const IN_AN_ALLIANCE = { corpid: 98000001, allianceid: ALLIANCE };
const ALLIANCE_PAIRS = { allowed: new Set(["allianceRegistry.GetAllianceContacts", "allianceRegistry.GetRelationships", "allianceRegistry.GetAlliance", "allianceRegistry.GetRankedAlliances", "allianceRegistry.SetRelationship", "ship.LeaveShip", "station.GetGuests"]) };
const ofTheAlliance = (list) => list.filter((bind) => bind.service === "allianceRegistry");

test("a pilot in an alliance has the alliance's moniker made and bound, and its contacts asked for beside the address book's others", async () => {
  const { pilots, session } = await selected(IN_AN_ALLIANCE, ALLIANCE_PAIRS);
  // Moniker('allianceRegistry', (session.allianceid, 1)), bound for its own sake (all_cso.GetMoniker), and then asked.
  assert.deepEqual([session.binds, session.carried], [[{ service: "allianceRegistry", params: [ALLIANCE, 1] }], [null]]);
  assert.deepEqual(session.boundCalls, [{ objectID: "N=1:1", method: "GetAllianceContacts", args: [], kwargs: null }]);
  // The address book asks its four side by side: the bind is on its way while the online state is asked for.
  assert.deepEqual(sentLast(session, 5), ["GetEveOwners", "GetContactList", "GetCorporateContacts", "GetInitialState", "GetAllianceContacts", ...CHOSEN_LAST]);
  assert.deepEqual([session.calls.filter((call) => call.service === "allianceRegistry"), ledgerOf(pilots, "allianceRegistry.GetAllianceContacts")], [[], [{ same: 1 }, "eve/client/script/ui/services/alliances/all_cso.py:243"]]);

  // A pilot in no alliance has no such moniker: nothing of the alliance's is bound or asked.
  const out = await selected({ corpid: 98000001 }, ALLIANCE_PAIRS);
  assert.deepEqual([out.session.binds, out.session.boundCalls, ledgerOf(out.pilots, "allianceRegistry.GetAllianceContacts")], [[], [], null]);

  // A registry that cannot be bound, or contacts refused: the choosing stands, and the rest are asked.
  const unbound = await selected({ ...IN_AN_ALLIANCE, answers: { "bind:allianceRegistry": () => { throw sessionError("RESOLVE_FAILED", "allianceRegistry could not say where its object lives."); } } }, ALLIANCE_PAIRS);
  assert.deepEqual([unbound.outcome.session.characterID, unbound.session.binds.length, sentLast(unbound.session, 1)], [PILOT, 1, ["GetInitialState", ...CHOSEN_LAST]]);
  const refused = await selected({ ...IN_AN_ALLIANCE, answers: { "bound:GetAllianceContacts": () => { throw refusedBy("NotNow"); } } }, ALLIANCE_PAIRS);
  assert.deepEqual([refused.outcome.session.characterID, sentLast(refused.session, 1)], [PILOT, ["GetAllianceContacts", ...CHOSEN_LAST]]);
});

test("what the BFF asks of the alliance's registry is made on the moniker, or by name where the client asks by name", async () => {
  const { pilots, session, handle } = await selected({ ...IN_AN_ALLIANCE, answers: { "bound:GetRelationships": { type: "dict", entries: [[99000002, 5]] }, "allianceRegistry.GetRankedAlliances": { type: "list", items: [1] } } }, ALLIANCE_PAIRS);
  const ask = async (method, args = []) => (await pilots.callMethod("allianceRegistry", method, args, null, FIELDS, handle)).result;
  const byName = () => session.calls.filter((call) => call.service === "allianceRegistry").map((call) => [call.method, call.args]);
  // On what was bound as the character was chosen: no other bind, and nothing by the service's name.
  assert.deepEqual(await ask("GetRelationships"), { type: "dict", entries: [[99000002, 5]] });
  assert.deepEqual([session.boundCalls.at(-1), session.binds.length, byName(), ledgerOf(pilots, "allianceRegistry.GetRelationships")], [
    { objectID: "N=1:1", method: "GetRelationships", args: [], kwargs: null }, 1, [], [{ reshaped: 1 }, "eve/client/script/ui/services/alliances/all_cso_relationships.py:25"],
  ]);
  // A pair nobody has read against the client goes to the moniker too, as it was given.
  await ask("SetRelationship", [5, 99000002]);
  assert.deepEqual([session.boundCalls.at(-1), ledgerOf(pilots, "allianceRegistry.SetRelationship")[0]], [{ objectID: "N=1:1", method: "SetRelationship", args: [5, 99000002], kwargs: null }, { unchecked: 1 }]);
  // The alliance's own record: of the moniker, with nothing, however the BFF named the alliance.
  await ask("GetAlliance");
  await ask("GetAlliance", [ALLIANCE]);
  assert.deepEqual([session.boundCalls.slice(-2), ledgerOf(pilots, "allianceRegistry.GetAlliance")[0]], [
    [{ objectID: "N=1:1", method: "GetAlliance", args: [], kwargs: null }, { objectID: "N=1:1", method: "GetAlliance", args: [], kwargs: null }], { reshaped: 2 },
  ]);
  // Another alliance's, and the ranking of them all, by name.
  await ask("GetAlliance", [ALLIANCE + 1]);
  assert.deepEqual(await ask("GetRankedAlliances", [100]), { type: "list", items: [1] });
  assert.deepEqual([byName(), ledgerOf(pilots, "allianceRegistry.GetAlliance")[0], ledgerOf(pilots, "allianceRegistry.GetRankedAlliances")[0], session.binds.length], [
    [["GetAlliance", [ALLIANCE + 1]], ["GetRankedAlliances", [100]]], { reshaped: 2, same: 1 }, { same: 1 }, 1,
  ]);
});

test("the alliance's moniker is the alliance's: kept when the pilot moves, made and bound again in another alliance, and none in none", async () => {
  const { pilots, session, handle } = await selected(IN_AN_ALLIANCE, ALLIANCE_PAIRS);
  const ask = () => pilots.callMethod("allianceRegistry", "GetRelationships", [], null, FIELDS, handle);
  // Another station: the ship's moniker is for the place, the alliance's is not.
  session.attributes.stationid = 60000004;
  session.change({ stationid: [STATION, 60000004] });
  await ask();
  assert.deepEqual([ofTheAlliance(session.binds).length, session.boundCalls.at(-1).objectID], [1, "N=1:1"]);
  // all_cso.OnSessionChanged: in another alliance its moniker is made and bound at once, with no call. What is asked
  // while it binds waits for the object, and binds nothing itself.
  session.attributes.allianceid = ALLIANCE + 1;
  session.change({ allianceid: [ALLIANCE, ALLIANCE + 1] });
  await ask();
  await settled();
  assert.deepEqual([ofTheAlliance(session.binds), session.carried, session.boundCalls.at(-1)], [
    [{ service: "allianceRegistry", params: [ALLIANCE, 1] }, { service: "allianceRegistry", params: [ALLIANCE + 1, 1] }], [null, null],
    { objectID: "N=1:2", method: "GetRelationships", args: [], kwargs: null },
  ]);
  // A change of the session that is not the alliance's leaves it as it is.
  session.attributes.corpid = 98000002;
  session.change({ corpid: [98000001, 98000002] });
  await settled();
  await ask();
  assert.deepEqual([ofTheAlliance(session.binds).length, session.boundCalls.at(-1).objectID], [2, "N=1:2"]);
  // Out of any alliance: nothing is bound. The client would ask nothing; what the BFF asks goes by name, the web's alone.
  session.attributes.allianceid = null;
  session.change({ allianceid: [ALLIANCE + 1, null] });
  await settled();
  const bound = session.boundCalls.length;
  await ask();
  assert.deepEqual([ofTheAlliance(session.binds).length, session.boundCalls.length - bound, session.calls.at(-1), ledgerOf(pilots, "allianceRegistry.GetRelationships")], [
    2, 0, { service: "allianceRegistry", method: "GetRelationships", args: [], kwargs: null }, [{ reshaped: 3, "web-only": 1 }, "eve/client/script/ui/services/alliances/all_cso_relationships.py:25"],
  ]);
  // In an alliance again, with a bind that fails: the next thing asked binds for itself.
  let fails = true;
  const failing = await selected({ ...IN_AN_ALLIANCE, answers: { "bind:allianceRegistry": (params) => { if (fails) throw sessionError("RESOLVE_FAILED", "no"); return { objectID: "N=1:70", nodeID: 1, result: null }; } } }, ALLIANCE_PAIRS);
  failing.session.attributes.allianceid = ALLIANCE + 1;
  failing.session.change({ allianceid: [ALLIANCE, ALLIANCE + 1] });
  await settled();
  fails = false;
  await failing.pilots.callMethod("allianceRegistry", "GetRelationships", [], null, FIELDS, failing.handle);
  assert.deepEqual([ofTheAlliance(failing.session.binds).map((bind) => bind.params), failing.session.boundCalls.at(-1).objectID], [[[ALLIANCE, 1], [ALLIANCE + 1, 1], [ALLIANCE + 1, 1]], "N=1:70"]);
});

test("the wallet's transactions go out with a bool for whose they are, however the BFF said it", async () => {
  const { pilots, session, handle } = await selected({}, REGISTRY_PAIRS);
  session.calls.length = 0;
  await pilots.callMethod("account", "GetTransactions", [1000, null, null, 0], null, FIELDS, handle);
  await pilots.callMethod("account", "GetTransactions", [1000, null, null, false], null, FIELDS, handle);
  assert.deepEqual(session.calls.filter((call) => call.method === "GetTransactions").map((call) => call.args), [[1000, null, null, false], [1000, null, null, false]]);
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "account.GetTransactions").statuses, { reshaped: 1, same: 1 });
});

test("a service the client reaches through its proxy is called at the proxy node, and any other by its name alone", async () => {
  const pairs = { allowed: new Set(["contractProxy.GetLoginInfo", "contractProxy.SearchContracts", "marketProxy.GetCharOrders", "account.GetCashBalance", "calendarMgr.GetResponsesForCharacter", "calendarProxy.GetEventList"]) };
  const { pilots, session, handle } = await selected({ answers: { "contractProxy.GetLoginInfo": 41, "account.GetCashBalance": 42 } }, pairs);
  session.calls.length = 0;
  session.proxyCalls.length = 0;
  const viaProxy = await pilots.callMethod("contractProxy", "GetLoginInfo", [], null, FIELDS, handle);
  await pilots.callMethod("marketProxy", "GetCharOrders", [], null, FIELDS, handle);
  const byName = await pilots.callMethod("account", "GetCashBalance", [0], null, FIELDS, handle);
  await pilots.callMethod("calendarMgr", "GetResponsesForCharacter", [], null, FIELDS, handle);
  await pilots.callMethod("calendarProxy", "GetEventList", [10, 2026], null, FIELDS, handle);
  await pilots.callMethod("contractProxy", "SearchContracts", [], { contractType: 3, availability: 0, startNum: 0 }, FIELDS, handle);
  const named = (calls) => calls.map((call) => `${call.service}.${call.method}`);
  assert.deepEqual(named(session.proxyCalls), ["contractProxy.GetLoginInfo", "marketProxy.GetCharOrders", "calendarProxy.GetEventList", "contractProxy.SearchContracts"]);
  assert.deepEqual(named(session.calls), ["account.GetCashBalance", "calendarMgr.GetResponsesForCharacter"]);
  // The answer comes back the same either way, and the arguments go as they were shaped.
  assert.deepEqual([viaProxy.result, byName.result], [41, 42]);
  assert.deepEqual(session.proxyCalls[2].args, [10, 2026]);
  assert.equal(Object.keys(session.proxyCalls[3].kwargs).length, 26);
  // Addressing a call is the transport's own business: the ledger counts the call as it was spelt. (Once at the choosing, once here.)
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "contractProxy.GetLoginInfo").statuses, { same: 2 });
});

test("the account's own connection addresses a call the same way: the proxy's services at the proxy node", async () => {
  const { pilots, made } = accountBuild({ answers: { "search.QuickQuery": 7 } }, { allowed: new Set(["search.QuickQuery", "charUnboundMgr.GetCharCreationInfo"]) });
  const found = await pilots.accountCall("search", "QuickQuery", ["zaph", [2]], null, FIELDS);
  await creationInfo(pilots);
  assert.equal(found.result, 7);
  assert.deepEqual(made[0].proxyCalls.map((call) => [call.service, call.method, call.args]), [["search", "QuickQuery", ["zaph", [2]]]]);
  assert.deepEqual(made[0].calls.map((call) => call.method), ["GetCharCreationInfo"]);
});

// ── a ship's attribute, as godma holds it ────────────────────────────────────

const holdsAllInfo = () => keyVal([["shipInfo", { type: "dict", entries: [
  [BigInt(SHIP), keyVal([["itemID", BigInt(SHIP)], ["time", DOGMA_T], ["attributes", { type: "dict", entries: [[38, 3900], [283, 25], [1556, 0]] }]])],
] }]]);

test("a ship's attribute is godma's: held from the one GetAllInfo, and never asked for by itself", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": holdsAllInfo() } });
  session.calls.length = 0;
  assert.equal(await pilots.shipAttribute(38, FIELDS, handle), 3900);
  assert.equal(await pilots.shipAttribute(283, FIELDS, handle), 25);
  // Nought is a value; an attribute the ship has not is not known.
  assert.equal(await pilots.shipAttribute(1556, FIELDS, handle), 0);
  assert.equal(await pilots.shipAttribute(1557, FIELDS, handle), null);
  // Godma primed once, as the client primes it, and nothing else asked of the server.
  assert.deepEqual(session.boundCalls.filter((call) => call.method === "GetAllInfo").map((call) => call.args), [[true, true, null]]);
  assert.deepEqual(session.calls, []);
  // A session is its account's own.
  await rejects(pilots.shipAttribute(38, { userid: 9 }, handle), "SESSION_NOT_FOUND");
  await rejects(pilots.shipAttribute(38, FIELDS, "gp:nope"), "SESSION_NOT_FOUND");
});

test("with dogma not answering, a ship's attribute is not known", async () => {
  const { pilots, handle } = await selected({ answers: { "bound:GetAllInfo": () => { throw new Error("not now"); } } });
  assert.equal(await pilots.shipAttribute(38, FIELDS, handle), null);
});

test("the pilot's ship and its type are what the session and godma already hold", async () => {
  const typed = keyVal([["shipInfo", { type: "dict", entries: [
    [BigInt(SHIP), keyVal([["itemID", BigInt(SHIP)], ["time", DOGMA_T], ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: SHIP, typeID: 77002, groupID: 901 }, values: [] }], ["attributes", { type: "dict", entries: [[38, 3900]] }]])],
  ] }]]);
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": typed } });
  session.calls.length = 0;
  assert.deepEqual(await pilots.ship(FIELDS, handle), { shipID: SHIP, typeID: 77002 });
  assert.deepEqual(await pilots.ship(FIELDS, handle), { shipID: SHIP, typeID: 77002 });
  // Godma primed once, and nothing asked of the server for it.
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1);
  assert.deepEqual(session.calls, []);
  await rejects(pilots.ship({ userid: 9 }, handle), "SESSION_NOT_FOUND");
  // With godma not answering, the ship is still the session's; its type is not known.
  const dark = await selected({ answers: { "bound:GetAllInfo": () => { throw new Error("not now"); } } });
  assert.deepEqual(await dark.pilots.ship(FIELDS, dark.handle), { shipID: SHIP, typeID: null });
});

// ── the ship's own dogma, as godma holds it ──────────────────────────────────

const EFFECT_OF_BEING_ONLINE = 16;
const ownShipAllInfo = () => keyVal([["shipInfo", { type: "dict", entries: [
  [BigInt(SHIP + 3), keyVal([["itemID", BigInt(SHIP + 3)], ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: SHIP + 3, typeID: 3003, groupID: 53, categoryID: 7, flagID: 29, locationID: SHIP }, values: [] }], ["time", DOGMA_T], ["attributes", { type: "dict", entries: [[50, 7]] }], ["activeEffects", { type: "dict", entries: [] }]])],
  [BigInt(SHIP), keyVal([
    ["itemID", BigInt(SHIP)],
    ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: SHIP, typeID: 588, groupID: 237, categoryID: 6 }, values: [] }],
    ["activeEffects", { type: "dict", entries: [] }],
    ["time", DOGMA_T],
    ["attributes", { type: "dict", entries: [[48, 130], [11, 40], [38, 120]] }],
    ["wallclockTime", DOGMA_T],
  ])],
  // Two modules fitted in the ship: one online, one not.
  [BigInt(SHIP + 1), keyVal([["itemID", BigInt(SHIP + 1)], ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: SHIP + 1, typeID: 3001, groupID: 53, categoryID: 7, flagID: 27, locationID: SHIP }, values: [] }], ["time", DOGMA_T], ["attributes", { type: "dict", entries: [[50, 12]] }], ["activeEffects", { type: "dict", entries: [[EFFECT_OF_BEING_ONLINE, [SHIP + 1, EFFECT_OF_BEING_ONLINE, null, null, null, null, null, DOGMA_T, -1, 0]]] }]])],
  [BigInt(SHIP + 2), keyVal([["itemID", BigInt(SHIP + 2)], ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID: SHIP + 2, typeID: 3002, groupID: 53, categoryID: 7, flagID: 28, locationID: SHIP }, values: [] }], ["time", DOGMA_T], ["attributes", { type: "dict", entries: [[50, 9]] }], ["activeEffects", { type: "dict", entries: [] }]])],
] }]]);

test("the ship's own dogma entry is the row godma was primed with, its attributes as godma holds them now, and the modules that are online", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo() } });
  session.calls.length = 0;
  const own = await pilots.shipInfo(FIELDS, handle);
  assert.equal(own.shipID, SHIP);
  // The server's own row for the ship: the fields ShipGetInfo answers, as the page reads them.
  const fields = new Map(own.row.args.entries);
  assert.deepEqual([own.row.name, [...fields.keys()]], ["util.KeyVal", ["itemID", "invItem", "activeEffects", "time", "attributes", "wallclockTime"]]);
  assert.equal(fields.get("invItem").fields.typeID, 588);
  assert.deepEqual(fields.get("attributes"), { type: "dict", entries: [[48, 130], [11, 40], [38, 120]] });
  // Which modules are online is godma's too: the one with the online effect on it.
  assert.deepEqual(own.online, [SHIP + 1]);
  // A change the server tells of is in the entry the next time it is read: nothing is asked again.
  session.notify("OnModuleAttributeChanges", [{ type: "list", items: [["OnModuleAttributeChange", PILOT, BigInt(SHIP), 48, DOGMA_T + 10000000n, 150, 130, DOGMA_T + 10000000n]] }]);
  const later = await pilots.shipInfo(FIELDS, handle);
  assert.deepEqual(new Map(later.row.args.entries).get("attributes"), { type: "dict", entries: [[48, 150], [11, 40], [38, 120]] });
  assert.deepEqual([session.calls, session.boundCalls.filter((call) => call.method === "GetAllInfo").length], [[], 1]);
  // A session is its account's own.
  await rejects(pilots.shipInfo({ userid: 9 }, handle), "SESSION_NOT_FOUND");
});

// A module fitted while the ship is held is told of by its inventory row (OnItemsChanged). The client's godma asks
// the server what dogma has of it, ItemGetInfo(itemID), and holds the answer (godma.UpdateItem); its dogma location
// then fits it and puts it online itself where its type can be (clientDogmaLocation._OnlineModuleIfApplicable,
// OnlineModule). Recorded on Tranquility in that order, both calls on the dogma location godma was primed from.

const CAN_BE_ONLINE = 3009;
const fittedNow = (itemID, { typeID = CAN_BE_ONLINE, flagID = 30, locationID = SHIP, categoryID = 7 } = {}) => [
  { type: "list", items: [{ type: "packedrow", header: null, columns: [], fields: { itemID, typeID, ownerID: PILOT, locationID, flagID, quantity: -1, groupID: 53, categoryID, customInfo: "", stacksize: 1, singleton: 1 }, values: [] }] },
  { type: "dict", entries: [[3, STATION], [4, 4]] },
  null,
];
/** What the server answers ItemGetInfo with: the item's row, as GetAllInfo lists one. */
const itemRow = (itemID, online = false) => keyVal([
  ["itemID", BigInt(itemID)],
  ["invItem", { type: "packedrow", header: null, columns: [], fields: { itemID, typeID: CAN_BE_ONLINE, groupID: 53, categoryID: 7, flagID: 30, locationID: SHIP }, values: [] }],
  ["time", DOGMA_T],
  ["attributes", { type: "dict", entries: [[50, 7]] }],
  ["activeEffects", { type: "dict", entries: online ? [[EFFECT_OF_BEING_ONLINE, [itemID, EFFECT_OF_BEING_ONLINE, null, null, null, null, null, DOGMA_T, -1, 0]]] : [] }],
]);
const onlineByType = { typeEffects: (typeID) => (typeID === CAN_BE_ONLINE ? [{ effectID: 11 }, { effectID: EFFECT_OF_BEING_ONLINE }] : [{ effectID: 11 }]) };
/** The calls the client makes of its own accord after an item change, in the order they were made. */
const ownCalls = (session) => session.boundCalls.filter((call) => call.method === "ItemGetInfo" || call.method === "SetModuleOnline").map((call) => [call.method, call.args]);
const settled = () => new Promise((resolve) => setImmediate(resolve));

test("a module fitted while the ship is held is asked about and then put online, by the client itself and in that order", async () => {
  // As the server has each: not online when it is asked about, as on Tranquility, unless the test says so.
  const serverHasOnline = new Set([SHIP + 10]);
  const { pilots, session, handle } = await selected({ answers: {
    "bound:GetAllInfo": ownShipAllInfo(),
    "bound:ItemGetInfo": ([itemID]) => itemRow(Number(itemID), serverHasOnline.has(Number(itemID))),
  } }, onlineByType);
  assert.deepEqual((await pilots.shipInfo(FIELDS, handle)).online, [SHIP + 1]);
  session.calls.length = 0;
  session.notify("OnItemsChanged", fittedNow(SHIP + 9));
  assert.deepEqual((await pilots.shipInfo(FIELDS, handle)).online, [SHIP + 1, SHIP + 9]);
  // ItemGetInfo(the module), then SetModuleOnline(the ship the module is in, the module): both on the dogma location
  // godma was primed from, and nothing else asked.
  assert.deepEqual(ownCalls(session), [["ItemGetInfo", [SHIP + 9]], ["SetModuleOnline", [SHIP, SHIP + 9]]]);
  const primedFrom = session.boundCalls.find((call) => call.method === "GetAllInfo").objectID;
  assert.deepEqual(session.boundCalls.filter((call) => call.method !== "GetAllInfo").map((call) => [call.objectID, call.kwargs]), [[primedFrom, null], [primedFrom, null]]);
  assert.deepEqual([session.calls, session.boundCalls.filter((call) => call.method === "GetAllInfo").length], [[], 1]);
  const noted = Object.fromEntries(pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual([noted["dogmaIM.ItemGetInfo"], noted["dogmaIM.SetModuleOnline"]], [{ same: 1 }, { same: 1 }]);
  // A module whose type cannot be online is asked about and no more. What the server answers of it is what is held:
  // here that its online effect is running.
  session.notify("OnItemsChanged", fittedNow(SHIP + 10, { typeID: 3010, flagID: 31 }));
  assert.deepEqual((await pilots.shipInfo(FIELDS, handle)).online, [SHIP + 1, SHIP + 9, SHIP + 10]);
  assert.deepEqual(ownCalls(session).slice(2), [["ItemGetInfo", [SHIP + 10]]]);
  // One godma holds already that moves to another slot is asked about again, and is not fitted anew.
  serverHasOnline.add(SHIP + 9);
  session.notify("OnItemsChanged", fittedNow(SHIP + 9, { flagID: 32 }));
  session.notify("OnItemsChanged", fittedNow(SHIP + 2, { flagID: 33 }));
  assert.deepEqual((await pilots.shipInfo(FIELDS, handle)).online, [SHIP + 1, SHIP + 9, SHIP + 10]);
  assert.deepEqual(ownCalls(session).slice(3), [["ItemGetInfo", [SHIP + 9]], ["ItemGetInfo", [SHIP + 2]]]);
  // A drone put in the drone bay is not asked about, and its type has no being online to it.
  session.notify("OnItemsChanged", fittedNow(SHIP + 11, { typeID: 3010, flagID: 87, categoryID: 18 }));
  await pilots.shipInfo(FIELDS, handle);
  assert.equal(ownCalls(session).length, 5);
});

test("a server that has the module online already says so, and it is online; refused for any other reason, or not answered, it is not online after all", async () => {
  const outcome = async (answer) => {
    const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:ItemGetInfo": ([itemID]) => itemRow(Number(itemID)), "bound:SetModuleOnline": answer } }, onlineByType);
    await pilots.shipInfo(FIELDS, handle);
    session.notify("OnItemsChanged", fittedNow(SHIP + 9));
    return [(await pilots.shipInfo(FIELDS, handle)).online, ownCalls(session).map(([method]) => method)];
  };
  const both = ["ItemGetInfo", "SetModuleOnline"];
  assert.deepEqual(await outcome(() => { throw refusedBy("EffectAlreadyActive2"); }), [[SHIP + 1, SHIP + 9], both]);
  assert.deepEqual(await outcome(() => { throw refusedBy("NotEnoughCpu"); }), [[SHIP + 1], both]);
  assert.deepEqual(await outcome(() => { throw new Error("no answer"); }), [[SHIP + 1], both]);
});

test("a module the server would not say anything of is put online all the same", async () => {
  const outcome = async (answer) => {
    const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:ItemGetInfo": answer } }, onlineByType);
    await pilots.shipInfo(FIELDS, handle);
    session.notify("OnItemsChanged", fittedNow(SHIP + 9));
    return [(await pilots.shipInfo(FIELDS, handle)).online, ownCalls(session).map(([method]) => method)];
  };
  assert.deepEqual(await outcome(() => { throw new Error("no answer"); }), [[SHIP + 1, SHIP + 9], ["ItemGetInfo", "SetModuleOnline"]]);
  assert.deepEqual(await outcome(null), [[SHIP + 1, SHIP + 9], ["ItemGetInfo", "SetModuleOnline"]]);
});

test("several modules fitted at once are each asked about and put online in turn, one call at a time, and a read of the ship waits for them", async () => {
  let answer;
  const waiting = new Promise((resolve) => { answer = resolve; });
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:ItemGetInfo": ([itemID]) => itemRow(Number(itemID)), "bound:SetModuleOnline": () => waiting } }, onlineByType);
  await pilots.shipInfo(FIELDS, handle);
  session.notify("OnItemsChanged", [{ type: "list", items: [...fittedNow(SHIP + 9)[0].items, ...fittedNow(SHIP + 8, { flagID: 31 })[0].items] }, { type: "dict", entries: [[3, STATION], [4, 4]] }, null]);
  await settled();
  // The server has yet to answer for the first: nothing is asked of the second.
  assert.deepEqual(ownCalls(session), [["ItemGetInfo", [SHIP + 9]], ["SetModuleOnline", [SHIP, SHIP + 9]]]);
  const reading = pilots.shipInfo(FIELDS, handle);
  answer(null);
  assert.deepEqual((await reading).online, [SHIP + 1, SHIP + 9, SHIP + 8]);
  assert.deepEqual(ownCalls(session).slice(2), [["ItemGetInfo", [SHIP + 8]], ["SetModuleOnline", [SHIP, SHIP + 8]]]);
});

test("the undock hands over the modules that are online once the one just fitted has been answered for", async () => {
  let answer;
  const waiting = new Promise((resolve) => { answer = resolve; });
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:ItemGetInfo": () => waiting } }, onlineByType);
  await pilots.shipInfo(FIELDS, handle);
  session.notify("OnItemsChanged", fittedNow(SHIP + 9));
  const undocking = pilots.callMethod("ship", "Undock", [SHIP, false], { onlineModules: [] }, FIELDS, handle);
  await settled();
  assert.equal(session.boundCalls.some((call) => call.method === "Undock"), false);
  answer(itemRow(SHIP + 9));
  await undocking;
  assert.deepEqual(session.boundCalls.find((call) => call.method === "Undock").kwargs, { onlineModules: { type: "dict", entries: [[27, SHIP + 1], [30, SHIP + 9]] } });
});

test("a module fitted to a ship the pilot is no longer in is neither asked about nor put online", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo() } }, onlineByType);
  await pilots.shipInfo(FIELDS, handle);
  // The session is in another ship; godma still holds the one before, until it is next read.
  session.attributes.shipid = 555;
  session.notify("OnItemsChanged", fittedNow(SHIP + 9));
  await settled();
  assert.deepEqual(ownCalls(session), []);
});

// ── how a Moniker the client keeps is bound ──────────────────────────────────
//
// moniker.py: a call that finds its Moniker unbound goes with the bind, MachoBindObject(params, (method, args,
// keywords)), and the ones after it to the object that bound. Recorded on Tranquility at login for the dogma
// location (GetAllInfo), invCache's two managers (GetInventoryFromId, GetInventory) and the skill handler; the
// corporation's registry is bound with no call (base_corporation.GetCorpRegistry: Bind()), and was recorded so.

test("a call that finds its Moniker unbound goes with the bind, and the calls after it to the object", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:ItemGetInfo": ([itemID]) => itemRow(Number(itemID)) } }, onlineByType);
  assert.deepEqual([session.binds, session.carried], [[], []]);
  // godma's dogma location: the first thing asked of it is GetAllInfo, and its bind carries that.
  await pilots.shipInfo(FIELDS, handle);
  assert.deepEqual([session.binds, session.carried], [[{ service: "dogmaIM", params: [STATION, 15] }], ["GetAllInfo"]]);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args, call.kwargs]), [["N=1:1", "GetAllInfo", [true, true, null], null]]);
  // Bound now: what is asked of it next goes to the object, and nothing is bound.
  session.notify("OnItemsChanged", fittedNow(SHIP + 9));
  await pilots.shipInfo(FIELDS, handle);
  assert.deepEqual([session.binds.length, session.boundCalls.slice(1).map((call) => [call.objectID, call.method])], [1, [["N=1:1", "ItemGetInfo"], ["N=1:1", "SetModuleOnline"]]]);
  // invCache's two managers, each bound by the first thing asked of it and by nothing after.
  await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  await pilots.bindObject("invbroker", "GetInventoryFromId", [SHIP], { passive: 0 }, WHO, handle);
  await pilots.bindObject("invbroker", "GetInventoryFromId", [77], { passive: 1 }, WHO, handle);
  await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  assert.deepEqual(session.carried, ["GetAllInfo", "GetInventory", "GetInventoryFromId"]);
  assert.deepEqual(session.boundCalls.slice(3).map((call) => [call.method, call.args]), [["GetInventory", [10004, null]], ["GetInventoryFromId", [SHIP, 0]], ["GetInventoryFromId", [77, 1]], ["GetInventory", [10004, null]]]);
  // A named call on a service's moniker: the ship's is bound by the undock, with its keyword.
  await pilots.callMethod("ship", "Undock", [SHIP, false], { onlineModules: [] }, FIELDS, handle);
  assert.deepEqual([session.carried.at(-1), session.binds.at(-1)], ["Undock", { service: "ship", params: [STATION, 15] }]);
  assert.deepEqual(session.boundCalls.at(-1).kwargs, { onlineModules: { type: "dict", entries: [[27, SHIP + 1], [30, SHIP + 9]] } });
});

test("the corporation's registry is bound for its own sake, with no call, and then asked", async () => {
  const { pilots, session, handle } = await selected(undefined, REGISTRY_PAIRS);
  await pilots.callMethod("corpRegistry", "GetCorporation", [], null, FIELDS, handle);
  await pilots.callMethod("corpRegistry", "GetShareholders", [98000001], null, FIELDS, handle);
  // The bind was the choosing's, and carried none of what the choosing went on to ask.
  assert.deepEqual([session.registryAtChoosing.binds, session.registryAtChoosing.carried, session.registryAtChoosing.boundCalls[0].method], [[{ service: "corpRegistry", params: 1000044 }], [null], "GetAggressionSettings"]);
  assert.deepEqual([session.binds, session.carried], [[], []]);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args]), [["N=2:1", "GetCorporation", []], ["N=2:1", "GetShareholders", [98000001]]]);
});

test("a Moniker binds once at a time: a call that finds it binding waits for the object; after a bind that failed, the next call binds for itself", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const waiting = await selected({ answers: {
    "bind:dogmaIM": async (params, call) => { await gate; return { objectID: "N=1:90", nodeID: 1, result: `with the bind: ${call[0]}` }; },
    "bound:GetCharacterBaseAttributes": "on the object",
    "bound:GetDroneDamageStates": "on the object too",
  } }, { allowed: new Set(["dogmaIM.GetCharacterBaseAttributes", "dogmaIM.GetDroneDamageStates"]), shape: (service, method, args, kwargs) => ({ args, kwargs, status: "same", source: null, note: null, moniker: true, proxy: false }) });
  const ask = (method) => waiting.pilots.callMethod("dogmaIM", method, [], null, FIELDS, waiting.handle).then((answer) => answer.result);
  const [first, second, third] = [ask("GetCharacterBaseAttributes"), ask("GetDroneDamageStates"), ask("GetCharacterBaseAttributes")];
  await settled();
  assert.deepEqual([waiting.session.binds.length, waiting.session.carried, waiting.session.boundCalls], [1, ["GetCharacterBaseAttributes"], []]);
  release();
  assert.deepEqual(await Promise.all([first, second, third]), ["with the bind: GetCharacterBaseAttributes", "on the object too", "on the object"]);
  assert.deepEqual([waiting.session.binds.length, waiting.session.boundCalls.map((call) => [call.objectID, call.method])], [1, [["N=1:90", "GetDroneDamageStates"], ["N=1:90", "GetCharacterBaseAttributes"]]]);

  // The call that came with a bind is refused: nothing was bound, and the next call goes with a bind of its own.
  let binds = 0;
  const refusing = await selected({ answers: {
    "bind:dogmaIM": async (params, call) => { binds += 1; if (binds === 1) throw refusedBy("NotNow"); return { objectID: "N=1:91", nodeID: 1, result: `bound by ${call[0]}` }; },
  } }, { allowed: new Set(["dogmaIM.GetCharacterBaseAttributes", "dogmaIM.GetDroneDamageStates"]), shape: (service, method, args, kwargs) => ({ args, kwargs, status: "same", source: null, note: null, moniker: true, proxy: false }) });
  const again = (method) => refusing.pilots.callMethod("dogmaIM", method, [], null, FIELDS, refusing.handle).then((answer) => answer.result);
  // Two at once: the one that waited on the failed bind binds for itself.
  const [refused, after] = [again("GetCharacterBaseAttributes"), again("GetDroneDamageStates")];
  await rejects(refused, "CALL_REFUSED");
  assert.deepEqual([await after, refusing.session.carried], ["bound by GetDroneDamageStates", ["GetCharacterBaseAttributes", "GetDroneDamageStates"]]);
});

// ── the monikers the client makes afresh ─────────────────────────────────────
//
// Not every Moniker is kept. crimewatchSvc makes one for each call (eveMoniker.CharGetCrimewatchLocation().X()),
// and gameui.GetShipAccess makes a new ship's one each time while the session has a station, keeping one otherwise
// for as long as the system, the ship and the character are the same. A Moniker made for one call binds carrying
// it. Recorded on Tranquility at login: crimewatch bound twice and ship twice, each bind with its call and nothing
// asked of any of the four objects after; and in this server's log of a retail client, crimewatch bound four times.

const CRIME_PAIRS = { allowed: new Set(["crimewatch.GetClientStates", "crimewatch.GetMySecurityStatus", "crimewatch.SetSafetyLevel", "ship.LeaveShip", "ship.LaunchDrones", "ship.GetShipConfiguration", "ship.Undock", "corpRegistry.GetCorporation"]) };
/** A pilot left in space, with a park that moves only when a test says so. */
async function selectedInSpace(pilotOptions) {
  const built = build(IN_SPACE, { ...handTicked().options, ...pilotOptions });
  const outcome = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  return { ...built, handle: outcome.bridgeSessionID };
}

test("every call of crimewatch is on a Moniker of its own: bound for the one call, carrying it, and never by name", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetClientStates": "states", "bound:GetMySecurityStatus": 0.5 } }, CRIME_PAIRS);
  session.calls.length = 0;
  const states = await pilots.callMethod("crimewatch", "GetClientStates", [], null, FIELDS, handle);
  const status = await pilots.callMethod("crimewatch", "GetMySecurityStatus", [], null, FIELDS, handle);
  await pilots.callMethod("crimewatch", "SetSafetyLevel", [1], null, FIELDS, handle);
  await pilots.callMethod("crimewatch", "GetClientStates", [], null, FIELDS, handle);
  assert.deepEqual([states.result, status.result], ["states", 0.5]);
  assert.deepEqual(session.binds, Array(4).fill({ service: "crimewatch", params: [STATION, 15] }));
  assert.deepEqual(session.carried, ["GetClientStates", "GetMySecurityStatus", "SetSafetyLevel", "GetClientStates"]);
  // Four objects, one call each, and nothing asked of the service by its name.
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args]), [["N=1:1", "GetClientStates", []], ["N=1:2", "GetMySecurityStatus", []], ["N=1:3", "SetSafetyLevel", [1]], ["N=1:4", "GetClientStates", []]]);
  assert.deepEqual(session.calls, []);
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "crimewatch.GetClientStates").statuses, { reshaped: 2 });
  // In space it is the solar system's.
  const flying = await selectedInSpace(CRIME_PAIRS);
  await flying.pilots.callMethod("crimewatch", "GetClientStates", [], null, FIELDS, flying.handle);
  assert.deepEqual([flying.session.binds.filter((bind) => bind.service === "crimewatch"), flying.session.carried.at(-1)], [[{ service: "crimewatch", params: [SYSTEM, 5] }], "GetClientStates"]);
});

test("the ship's Moniker is made anew for each call while the pilot is docked in a station", async () => {
  const { pilots, session, handle } = await selected(undefined, CRIME_PAIRS);
  await pilots.callMethod("ship", "LeaveShip", [SHIP], null, FIELDS, handle);
  await pilots.callMethod("ship", "LeaveShip", [SHIP], null, FIELDS, handle);
  await pilots.callMethod("ship", "GetShipConfiguration", [], null, FIELDS, handle);
  assert.deepEqual(session.binds, Array(3).fill({ service: "ship", params: [STATION, 15] }));
  assert.deepEqual(session.carried, ["LeaveShip", "LeaveShip", "GetShipConfiguration"]);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args]), [["N=1:1", "LeaveShip", [SHIP]], ["N=1:2", "LeaveShip", [SHIP]], ["N=1:3", "GetShipConfiguration", [SHIP]]]);
});

test("in space the ship's Moniker is kept while the ship is the same, and shipConfigSvc's own call still makes its own", async () => {
  const { pilots, session, handle } = await selectedInSpace(CRIME_PAIRS);
  const ships = () => session.binds.filter((bind) => bind.service === "ship").length;
  const drones = () => pilots.callMethod("ship", "LaunchDrones", [[[11, 1]], PILOT, false], null, FIELDS, handle);
  await drones();
  await drones();
  // Bound by the first, which it carried; the second went to the object.
  assert.deepEqual([ships(), session.binds.find((bind) => bind.service === "ship"), session.carried.filter((method) => method === "LaunchDrones").length], [1, { service: "ship", params: [SYSTEM, 5] }, 1]);
  const kept = session.boundCalls.filter((call) => call.method === "LaunchDrones").map((call) => call.objectID);
  assert.deepEqual([kept.length, kept[0] === kept[1]], [2, true]);
  // The configuration read makes a moniker of its own, and leaves the kept one as it is.
  await pilots.callMethod("ship", "GetShipConfiguration", [], null, FIELDS, handle);
  await drones();
  assert.deepEqual([ships(), session.carried.at(-1), session.boundCalls.at(-1).objectID === kept[0]], [2, "GetShipConfiguration", true]);
  // A change of the session that is neither the ship nor the place leaves it kept.
  session.attributes.fleetid = 77;
  session.change({ fleetid: [null, 77] });
  await drones();
  assert.deepEqual([ships(), session.boundCalls.at(-1).objectID === kept[0]], [2, true]);
  // Another ship: gameui lets its moniker go, and the next call makes and binds a new one. The other monikers the
  // client keeps are not the ship's, and stay: the corporation's registry is not bound again.
  await pilots.callMethod("corpRegistry", "GetCorporation", [], null, FIELDS, handle);
  const registries = () => session.registryAtChoosing.binds.length + session.binds.filter((bind) => bind.service === "corpRegistry").length;
  session.attributes.shipid = SHIP + 500;
  session.change({ shipid: [SHIP, SHIP + 500] });
  await drones();
  await drones();
  await pilots.callMethod("corpRegistry", "GetCorporation", [], null, FIELDS, handle);
  assert.deepEqual([ships(), registries(), session.boundCalls.filter((call) => call.method === "LaunchDrones").at(-1).objectID === kept[0]], [3, 1, false]);
  // The server lets that object go: the next call binds another.
  session.notify("OnMachoObjectDisconnect", [Buffer.from(session.boundCalls.filter((call) => call.method === "LaunchDrones").at(-1).objectID), 0, 0]);
  await drones();
  assert.deepEqual([ships(), session.carried.at(-1)], [4, "LaunchDrones"]);
});

// ── the session's own fleet ──────────────────────────────────────────────────

test("the fleet the pilot is in is the session's own word, as the client's fleet service goes by it", async () => {
  // fleetSvc.py: everything it asks of a fleet is behind session.fleetid, which the server sets with a session change.
  const { pilots, session, handle } = await selected();
  session.calls.length = 0;
  assert.deepEqual(await pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: false });
  session.attributes.fleetid = 1099511627776n;
  session.change({ fleetid: [null, 1099511627776n] });
  assert.deepEqual(await pilots.fleet(FIELDS, handle), { fleetID: 1099511627776, holdsObject: false });
  session.attributes.fleetid = null;
  session.change({ fleetid: [1099511627776n, null] });
  assert.deepEqual(await pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: false });
  // Nothing is asked of the server for it, and a session is its account's own.
  assert.deepEqual([session.calls, session.binds], [[], []]);
  assert.throws(() => pilots.fleet({ userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

// ── the fleet's own object ───────────────────────────────────────────────────
//
// fleetSvc.py keeps one object for the fleet the pilot is in, self.fleet: what CreateFleet answered for a fleet the
// pilot formed, or the invite's Moniker for one it joined. Everything it asks of the fleet it asks of that, until
// the session leaves the fleet. It makes no other Moniker for its own fleet.

const FLEET = 654500010000;
const FLEET_PAIRS = { allowed: new Set([
  "fleetObjectHandler.CreateFleet", "fleetObjectHandler.MachoBindObject", "fleetObjectHandler.Init", "fleetObjectHandler.GetInitState", "fleetObjectHandler.GetWings",
  "fleetObjectHandler.LeaveFleet", "fleetObjectHandler.AcceptInvite", "fleetObjectHandler.RejectInvite", "fleetObjectHandler.UpdateMemberInfo",
  "fleetObjectHandler.CreateWing", "fleetObjectHandler.SetOptions", "fleetObjectHandler.KickMember", "fleetObjectHandler.DisbandFleet",
  "dogmaIM.MachoBindObject", "dogmaIM.GetAllInfo",
]) };
/** The binds made for a fleet, each with the call it carried; and the calls made on bound objects, by object. */
const fleetBinds = (session) => session.binds.map((bind, index) => [bind.service, bind.params, session.carried[index]]).filter(([service]) => service === "fleetObjectHandler");
const onObjects = (session, ...methods) => session.boundCalls.filter((call) => methods.includes(call.method)).map((call) => [call.objectID, call.method, call.args, call.kwargs]);
/** The session comes into a fleet, or out of one, as the server's session change says. */
const intoFleet = (session, fleetID) => {
  const before = session.attributes.fleetid ?? null;
  session.attributes.fleetid = fleetID;
  session.change({ fleetid: [before, fleetID] });
};

/** A pilot that has formed a fleet through the BFF's two steps: `made` is the handle CreateFleet's object went by. */
async function formed(answers = {}, pilotOptions = {}) {
  // The session comes into the fleet while Init is being answered, as the server's session change does.
  const built = await selected({ answers: {
    "fleetObjectHandler.CreateFleet": boundObject("N=1:500"), "bound:Init": () => { intoFleet(built.session, FLEET); return null; },
    "bound:GetInitState": "the state", "bound:GetWings": "the wings", ...answers,
  } }, { ...FLEET_PAIRS, ...pilotOptions });
  const made = await built.pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, built.handle);
  await built.pilots.callBoundMethod("fleetObjectHandler", "Init", [null, null], null, WHO, built.handle, made.boundHandle);
  return { ...built, made };
}
/** The BFF asks for "my fleet" and reads it: says the answer. */
async function readOwnFleet({ pilots, handle }, method = "GetInitState") {
  const own = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [], null, WHO, handle);
  return { own, answer: await pilots.callBoundMethod("fleetObjectHandler", method, [], null, WHO, handle, own.boundHandle) };
}

test("a fleet the pilot forms is the object CreateFleet answered: Init goes on it with the ship's type, and everything after", async () => {
  const built = await selected({ answers: { "fleetObjectHandler.CreateFleet": boundObject("N=1:500"), "bound:GetInitState": "the state", "bound:GetWings": "the wings" } }, FLEET_PAIRS);
  const { pilots, session, handle } = built;
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: false });
  const made = await pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, handle);
  // fleetSvc.CreateFleet: self.fleet = sm.RemoteSvc('fleetObjectHandler').CreateFleet(), held from that answer on.
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: true });
  await pilots.callBoundMethod("fleetObjectHandler", "Init", [null, null], null, WHO, handle, made.boundHandle);
  // self.fleet.Init(self.GetMyShipTypeID(), setupName, adInfoData=adInfoData): the ship's type is godma's word for it.
  assert.deepEqual(onObjects(session, "Init"), [["N=1:500", "Init", [588, null], { adInfoData: null }]]);
  intoFleet(session, FLEET);
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: FLEET, holdsObject: true });
  // "My fleet", asked for by the BFF, is that object: no Moniker is made for it, and nothing binds.
  const { own, answer } = await readOwnFleet(built);
  assert.equal(answer.result, "the state");
  assert.equal((await pilots.callBoundMethod("fleetObjectHandler", "GetWings", [], null, WHO, handle, own.boundHandle)).result, "the wings");
  // Another service's Moniker, asked for with nothing named, is that service's own for all that.
  const dogma = await pilots.bindObject("dogmaIM", "MachoBindObject", [], null, WHO, handle);
  await pilots.callBoundMethod("dogmaIM", "GetAllInfo", [true, true, null], null, WHO, handle, dogma.boundHandle);
  // And asked for again, as the BFF asks at every read of the panel, it is that object again.
  assert.equal((await readOwnFleet(built, "GetWings")).answer.result, "the wings");
  // So is the session's own fleet asked for by its number, as the BFF asks where it means this fleet and no other.
  const byNumber = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET]], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "GetWings", [], null, WHO, handle, byNumber.boundHandle);
  assert.deepEqual(fleetBinds(session), []);
  // The first of these is the client's own reading of the fleet it formed; the rest are what was asked here.
  assert.deepEqual(onObjects(session, "GetInitState", "GetWings").map(([objectID, method]) => [objectID, method]), [["N=1:500", "GetInitState"], ["N=1:500", "GetInitState"], ["N=1:500", "GetWings"], ["N=1:500", "GetWings"], ["N=1:500", "GetWings"]]);
  // A fleet that is named is another fleet's Moniker, as an invite's is: bound for itself by its own first call.
  const other = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET + 1]], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "RejectInvite", [true], null, WHO, handle, other.boundHandle);
  assert.deepEqual(fleetBinds(session), [["fleetObjectHandler", FLEET + 1, "RejectInvite"]]);
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: FLEET, holdsObject: true });
  // Whatever is asked of that other fleet's, the pilot's own fleet's object is its own still.
  await pilots.callBoundMethod("fleetObjectHandler", "LeaveFleet", [], null, WHO, handle, other.boundHandle);
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: FLEET, holdsObject: true });
  // UpdateFleetInfo: self.fleet.UpdateMemberInfo(self.GetMyShipTypeID()), whatever the caller named.
  await pilots.callBoundMethod("fleetObjectHandler", "UpdateMemberInfo", [11], null, WHO, handle, own.boundHandle);
  assert.deepEqual(onObjects(session, "UpdateMemberInfo"), [["N=1:500", "UpdateMemberInfo", [588], null]]);
});

test("leaving is asked of the fleet's object, and the object is then forgotten as the client forgets it", async () => {
  let refuse = true;
  const built = await formed({ "bound:LeaveFleet": () => { if (refuse) throw refusedBy("FleetNotAllowed"); return null; } });
  const { pilots, session, handle } = built;
  const { own } = await readOwnFleet(built);
  const leave = () => pilots.callBoundMethod("fleetObjectHandler", "LeaveFleet", [], null, WHO, handle, own.boundHandle);
  // A leaving the server refused has left nothing: the object is the fleet's still.
  await rejects(leave(), "CALL_REFUSED");
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: FLEET, holdsObject: true });
  refuse = false;
  await leave();
  // fleetSvc.LeaveFleet: self.fleet.LeaveFleet(), then self.Clear(), before the session has said anything.
  assert.deepEqual(onObjects(session, "LeaveFleet").map(([objectID]) => objectID), ["N=1:500", "N=1:500"]);
  assert.deepEqual([pilots.fleet(FIELDS, handle), fleetBinds(session)], [{ fleetID: FLEET, holdsObject: false }, []]);
  // Any other call on the fleet's object leaves it held.
  const again = await formed();
  await readOwnFleet(again, "GetWings");
  assert.deepEqual(again.pilots.fleet(FIELDS, again.handle), { fleetID: FLEET, holdsObject: true });
});

test("the fleet's object is kept until the session is in no fleet, or the server lets the object go", async () => {
  // ProcessSessionChange: a fleetid that changes to None forgets self.fleet. One that changes to a fleet does not.
  const left = await formed();
  intoFleet(left.session, FLEET + 5);
  assert.deepEqual(left.pilots.fleet(FIELDS, left.handle), { fleetID: FLEET + 5, holdsObject: true });
  intoFleet(left.session, null);
  assert.deepEqual(left.pilots.fleet(FIELDS, left.handle), { fleetID: null, holdsObject: false });
  // A session change that is about something else forgets nothing.
  const elsewhere = await formed();
  elsewhere.session.change({ fleetrole: [null, 1], wingid: [null, 7] });
  assert.deepEqual(elsewhere.pilots.fleet(FIELDS, elsewhere.handle), { fleetID: FLEET, holdsObject: true });
  // machoNet.OnMachoObjectDisconnect for the fleet's object: it is gone, and "my fleet" is a Moniker by the
  // session's fleet from then on, bound by its first call. Another object's going is nothing to the fleet.
  const dropped = await formed();
  dropped.session.notify("OnMachoObjectDisconnect", ["N=1:499", 1, null]);
  assert.deepEqual(dropped.pilots.fleet(FIELDS, dropped.handle), { fleetID: FLEET, holdsObject: true });
  dropped.session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:500"), 1, null]);
  assert.deepEqual(dropped.pilots.fleet(FIELDS, dropped.handle), { fleetID: FLEET, holdsObject: false });
  assert.equal((await readOwnFleet(dropped)).answer.result, "the state");
  assert.deepEqual(fleetBinds(dropped.session), [["fleetObjectHandler", FLEET, "GetInitState"]]);
  // That Moniker is the BFF's own making, not one the client would hold: it is not the fleet's object.
  assert.deepEqual(dropped.pilots.fleet(FIELDS, dropped.handle), { fleetID: FLEET, holdsObject: false });
  // A CreateFleet that answered no object leaves nothing held.
  const none = await selected({ answers: { "fleetObjectHandler.CreateFleet": null } }, FLEET_PAIRS);
  await rejects(none.pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, none.handle), "BOUND_NO_OBJECT");
  assert.deepEqual(none.pilots.fleet(FIELDS, none.handle), { fleetID: null, holdsObject: false });
  // And another service's object, come by the same road, is not a fleet's.
  const scan = await selected({ answers: { "scanMgr.GetSystemScanMgr": boundObject("N=1:77") } });
  await scan.pilots.bindObject("scanMgr", "GetSystemScanMgr", [], null, WHO, scan.handle);
  assert.deepEqual(scan.pilots.fleet(FIELDS, scan.handle), { fleetID: null, holdsObject: false });
});

test("a fleet the pilot joins by invite is the Moniker that accepted: bound by the acceptance, with the ship's type, and kept", async () => {
  let refuse = true;
  const built = await selected({ answers: { "bound:AcceptInvite": () => { if (refuse) throw refusedBy("FleetNotFound"); return true; }, "bound:GetInitState": "the state" } }, FLEET_PAIRS);
  const { pilots, session, handle } = built;
  // OnFleetInvite: GetFleet(fleetID), a Moniker for the fleet the invite names.
  const declined = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET + 1]], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "RejectInvite", [], null, WHO, handle, declined.boundHandle);
  // A Moniker that declined is nobody's fleet.
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: false });
  const invite = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET]], null, WHO, handle);
  const accept = () => pilots.callBoundMethod("fleetObjectHandler", "AcceptInvite", [null], null, WHO, handle, invite.boundHandle);
  // An acceptance the server refused joined nothing.
  await rejects(accept(), "CALL_REFUSED");
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: false });
  refuse = false;
  session.binds.length = 0;
  session.carried.length = 0;
  session.boundCalls.length = 0;
  await accept();
  // __fleetMoniker.AcceptInvite(self.GetMyShipTypeID()); self.fleet = __fleetMoniker.
  assert.deepEqual(fleetBinds(session), [["fleetObjectHandler", FLEET, "AcceptInvite"]]);
  assert.deepEqual(onObjects(session, "AcceptInvite").map(([, , args, kwargs]) => [args, kwargs]), [[[588], null]]);
  assert.deepEqual(pilots.fleet(FIELDS, handle), { fleetID: null, holdsObject: true });
  intoFleet(session, FLEET);
  const accepted = onObjects(session, "AcceptInvite")[0][0];
  session.binds.length = 0;
  session.carried.length = 0;
  // "My fleet" is that Moniker's object, and nothing binds for it.
  const { answer } = await readOwnFleet(built);
  assert.equal(answer.result, "the state");
  // The fleet's state was read on it when the pilot joined, and is read on it here.
  assert.deepEqual([fleetBinds(session), onObjects(session, "GetInitState").map(([objectID]) => objectID)], [[], [accepted, accepted]]);
});

// ── the fleet as it is kept ──────────────────────────────────────────────────
//
// fleetSvc.py asks a fleet for its state once, when it forms or joins one (InitFleet), and keeps it right from the
// server's notices (src/gamePort/pilotFleet.js). The answers and notices here are a real server's
// (test/fixtures/fleetSession.json: PILOT is its founder).

const fleetRecording = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", "fleetSession.json"), "utf8"),
  (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value));
const recorded = (pilot, call) => fleetRecording[pilot].events.filter((event) => event.kind === "answer" && event.call === call).map((event) => event.value);
const recordedNotice = (pilot, method) => fleetRecording[pilot].events.find((event) => event.kind === "notice" && event.method === method);
const [FOUNDED, WITH_TWO] = recorded("founder", "GetInitState");
const WINGS_AFTER = recorded("founder", "GetWings")[0];
const OTHER = fleetRecording.joiner.characterID;
/** What a read of the kept fleet says, in short: its members' numbers, how many wings it has, its message. */
const keptShort = (kept) => {
  const entries = Object.fromEntries(kept.GetInitState.args.entries);
  return [entries.members.entries.map(([charID]) => Number(charID)), kept.GetWings.entries.length, kept.GetMotd];
};
const everyFleetCall = (session) => session.boundCalls.filter((call) => call.method !== "GetAllInfo").map((call) => `${call.objectID} ${call.method}`);
/** Those calls, but for the two windows' own reads, which have tests of their own (windowCalls). */
const fleetCalls = (session) => everyFleetCall(session).filter((call) => !/ (GetJoinRequests|GetFleetComposition)$/.test(call));

test("forming a fleet reads its state once and asks its number, and after that the fleet is read from what is kept", async () => {
  const built = await formed({ "bound:GetInitState": FOUNDED, "bound:GetFleetID": fleetRecording.fleetID });
  const { pilots, session, handle } = built;
  // fleetSvc.CreateFleet: Init, then InitFleet (GetInitState), then self.fleet.GetFleetID(), all on the one object.
  assert.deepEqual(fleetCalls(session), ["N=1:500 Init", "N=1:500 GetInitState", "N=1:500 GetFleetID"]);
  const kept = await pilots.fleetKept(WHO, handle);
  assert.deepEqual(keptShort(kept), [[PILOT], 1, ""]);
  // In the gateway's form, as a read of GetInitState comes: names as text, numbers as the page reads them.
  assert.deepEqual([kept.GetInitState.type, kept.GetInitState.name, Object.fromEntries(kept.GetInitState.args.entries).fleetID], ["object", "util.KeyVal", 654500010000]);
  assert.ok(Array.isArray(kept.notifications));
  // Read again, and again: nothing is asked.
  await pilots.fleetKept(WHO, handle);
  assert.deepEqual(fleetCalls(session).length, 3);
  assert.deepEqual(fleetBinds(session), []);
  // Another pilot's session cannot read it.
  await assert.rejects(pilots.fleetKept({ userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("what the server says of a fleet afterwards is kept without asking, and a wing or squad notice has the wings asked for again", async () => {
  let wings = WINGS_AFTER;
  const built = await formed({ "bound:GetInitState": FOUNDED, "bound:GetWings": () => { if (wings === null) throw refusedBy("FleetError"); return wings; } });
  const { pilots, session, handle } = built;
  const asked = () => fleetCalls(session).slice(3);
  await pilots.fleetKept(WHO, handle);
  session.notify("OnFleetJoin", recordedNotice("founder", "OnFleetJoin").args);
  // The notices the pilot has been sent since its last read come with this one, once.
  const afterJoin = await pilots.fleetKept(WHO, handle);
  assert.deepEqual([afterJoin.notifications.map((each) => each.method), (await pilots.fleetKept(WHO, handle)).notifications], [["OnFleetJoin"], []]);
  assert.deepEqual([keptShort(afterJoin), asked()], [[[PILOT, OTHER], 1, ""], []]);
  session.notify("OnFleetMotdChanged", recordedNotice("founder", "OnFleetMotdChanged").args);
  session.notify("OnFleetMemberChanged", recordedNotice("founder", "OnFleetMemberChanged").args);
  assert.deepEqual([keptShort(await pilots.fleetKept(WHO, handle)), asked()], [[[PILOT, OTHER], 1, "Fly safe"], []]);
  // OnFleetWingAdded: self.wings = self.fleet.GetWings(), on the fleet's object. One asking for each notice.
  session.notify("OnFleetWingAdded", recordedNotice("founder", "OnFleetWingAdded").args);
  assert.deepEqual([keptShort(await pilots.fleetKept(WHO, handle)), asked()], [[[PILOT, OTHER], 2, "Fly safe"], ["N=1:500 GetWings"]]);
  wings = { type: "dict", entries: [] };
  session.notify("OnFleetSquadDeleted", [5n]);
  session.notify("OnFleetWingDeleted", [6n]);
  assert.deepEqual([keptShort(await pilots.fleetKept(WHO, handle)), asked()], [[[PILOT, OTHER], 0, "Fly safe"], ["N=1:500 GetWings", "N=1:500 GetWings", "N=1:500 GetWings"]]);
  // Several in one notification are each taken; the wings are asked for once for it.
  session.notify("__MultiEvent", [["OnFleetLeave", [OTHER]], ["OnFleetSquadAdded", [5n, 6n]], ["OnFleetWingAdded", [7n]]]);
  assert.deepEqual([keptShort(await pilots.fleetKept(WHO, handle))[0], asked().length], [[PILOT], 4]);
  // Wings that could not be had leave the wings as they were, and the fleet readable.
  wings = null;
  session.notify("OnFleetSquadNameChanged", [6n, "x"]);
  assert.deepEqual([keptShort(await pilots.fleetKept(WHO, handle)), asked().length], [[[PILOT], 0, "Fly safe"], 5]);
});

test("a fleet the pilot joins is read once, after the acceptance; its own OnFleetJoin reads it again only where the object is held", async () => {
  const state = { now: recorded("joiner", "GetInitState")[0] };
  // The stand-in pilot is the recording's founder; the notice is the joiner's, so it is made this pilot's own.
  const theirs = recordedNotice("joiner", "OnFleetJoin").args[0];
  const ownJoin = [{ ...theirs, args: { type: "dict", entries: theirs.args.entries.map(([name, value]) => (String(name) === "charID" ? [name, PILOT] : [name, value])) } }];
  let session;
  const built = await selected({ answers: {
    // On this server the session comes into the fleet, and the pilot's own OnFleetJoin comes, before the acceptance is answered.
    "bound:AcceptInvite": () => { intoFleet(session, FLEET); session.notify("OnFleetJoin", ownJoin); return null; },
    "bound:GetInitState": () => state.now,
  } }, FLEET_PAIRS);
  ({ session } = built);
  const { pilots, handle } = built;
  const invite = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET]], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "AcceptInvite", [null], null, WHO, handle, invite.boundHandle);
  // OnFleetInvite: AcceptInvite, then self.fleet = the Moniker, then InitFleet. One GetInitState, on what bound.
  const object = fleetCalls(session)[0].split(" ")[0];
  assert.deepEqual(fleetCalls(session), [`${object} AcceptInvite`, `${object} GetInitState`]);
  assert.deepEqual(keptShort(await pilots.fleetKept(WHO, handle))[0], [PILOT, OTHER].sort());
  // Tranquility sends it after: the object is held by then, and the state is read again (fleetSvc.OnFleetJoin).
  state.now = FOUNDED;
  session.notify("OnFleetJoin", ownJoin);
  assert.deepEqual([keptShort(await pilots.fleetKept(WHO, handle))[0], fleetCalls(session)], [[PILOT], [`${object} AcceptInvite`, `${object} GetInitState`, `${object} GetInitState`]]);
});

test("out of the fleet nothing is kept: by the pilot's own leaving, the server's word for it, or the session's", async () => {
  const ways = {
    "LeaveFleet": async ({ pilots, handle }) => { const own = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [], null, WHO, handle); await pilots.callBoundMethod("fleetObjectHandler", "LeaveFleet", [], null, WHO, handle, own.boundHandle); },
    "OnFleetLeave": async ({ session }) => session.notify("OnFleetLeave", [PILOT]),
    "OnFleetDisbanded": async ({ session }) => session.notify("OnFleetDisbanded", [[OTHER, PILOT]]),
    "the session": async ({ session }) => intoFleet(session, null),
    "the object let go": async ({ session }) => session.notify("OnMachoObjectDisconnect", ["N=1:500", 1, null]),
  };
  for (const [name, leave] of Object.entries(ways)) {
    const state = { unreadable: false };
    const built = await formed({ "bound:GetInitState": () => { if (state.unreadable) throw refusedBy("FleetNotFound"); return FOUNDED; } });
    assert.deepEqual(keptShort(await built.pilots.fleetKept(WHO, built.handle))[0], [PILOT], name);
    await leave(built);
    assert.deepEqual([await built.pilots.fleetKept(WHO, built.handle), built.pilots.fleet(FIELDS, built.handle).holdsObject], [null, false], name);
    // A wing notice or the pilot's own joining that comes after is nobody's to ask about: nothing is asked, or counted as asked.
    const asked = () => [fleetCalls(built.session).length, built.pilots.callLedger().filter((row) => row.pair.startsWith("fleetObjectHandler.")).map((row) => `${row.pair} ${row.calls}`)];
    const before = asked();
    built.session.notify("OnFleetWingAdded", [5n]);
    built.session.notify("OnFleetJoin", [keyVal([["charID", PILOT]])]);
    built.session.notify("OnFleetMove", []);
    await built.pilots.fleetKept(WHO, built.handle);
    assert.deepEqual(asked(), before, name);
    // A fleet formed after that whose state cannot be read is not the old fleet: nothing is kept of either.
    state.unreadable = true;
    const again = await built.pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, built.handle);
    await built.pilots.callBoundMethod("fleetObjectHandler", "Init", [null, null], null, WHO, built.handle, again.boundHandle);
    assert.deepEqual([await built.pilots.fleetKept(WHO, built.handle), built.pilots.fleet(FIELDS, built.handle).holdsObject], [null, true], name);
  }
  // Another member's leaving is not the pilot's.
  const built = await formed({ "bound:GetInitState": WITH_TWO });
  built.session.notify("OnFleetLeave", [OTHER]);
  assert.deepEqual([keptShort(await built.pilots.fleetKept(WHO, built.handle))[0], built.pilots.fleet(FIELDS, built.handle).holdsObject], [[PILOT], true]);
  // A session that moves to another fleet has no members until the state is read again; the object is kept.
  intoFleet(built.session, FLEET + 5);
  assert.deepEqual(keptShort(await built.pilots.fleetKept(WHO, built.handle))[0], []);
});

test("a message the server has not said is asked for when the fleet is read, and a state that could not be read is asked for again", async () => {
  // fleetSvc.GetMotd: self.fleet.GetMotd() only where self.motd is None.
  const noMotd = { ...FOUNDED, args: { ...FOUNDED.args, entries: FOUNDED.args.entries.map(([name, value]) => (String(name) === "motd" ? [name, null] : [name, value])) } };
  const said = await formed({ "bound:GetInitState": noMotd, "bound:GetMotd": Buffer.from("asked for") });
  assert.deepEqual([keptShort(await said.pilots.fleetKept(WHO, said.handle))[2], fleetCalls(said.session).slice(3)], ["asked for", ["N=1:500 GetMotd"]]);
  await said.pilots.fleetKept(WHO, said.handle);
  assert.deepEqual(fleetCalls(said.session).slice(3), ["N=1:500 GetMotd"]);
  // A pilot who is out of the fleet by the time the message comes has nothing kept to read.
  const gone = await formed({ "bound:GetInitState": noMotd, "bound:GetMotd": () => { intoFleet(gone.session, null); return Buffer.from("late"); } });
  assert.equal(await gone.pilots.fleetKept(WHO, gone.handle), null);

  // The state's reading fails after Init: the fleet is formed all the same, and its number is not asked.
  let fail = true;
  const built = await formed({ "bound:GetInitState": () => { if (fail) throw refusedBy("FleetNotFound"); return FOUNDED; } });
  assert.deepEqual(fleetCalls(built.session), ["N=1:500 Init", "N=1:500 GetInitState"]);
  // Read while it still fails: nothing kept to answer from.
  assert.equal(await built.pilots.fleetKept(WHO, built.handle), null);
  fail = false;
  assert.deepEqual(keptShort(await built.pilots.fleetKept(WHO, built.handle))[0], [PILOT]);
  assert.deepEqual(fleetCalls(built.session), ["N=1:500 Init", "N=1:500 GetInitState", "N=1:500 GetInitState", "N=1:500 GetInitState"]);
  // An answer that is no fleet's state is not kept either.
  const odd = await formed({ "bound:GetInitState": "the state" });
  assert.equal(await odd.pilots.fleetKept(WHO, odd.handle), null);
  // And with no fleet's object held there is nothing to read, and nothing is asked.
  const none = await selected({}, FLEET_PAIRS);
  assert.deepEqual([await none.pilots.fleetKept(WHO, none.handle), fleetCalls(none.session)], [null, []]);
});

test("what the client asks of its fleet of its own accord is asked at once, and an answer that comes too late is not the next fleet's", async () => {
  // Each notice is a tasklet of its own in the client: two wing notices are two askings, neither waiting for the other.
  const waiting = [];
  const state = { now: FOUNDED };
  const built = await formed({ "bound:GetInitState": () => state.now, "bound:GetWings": () => new Promise((resolve) => waiting.push(resolve)) });
  const { pilots, session, handle } = built;
  session.notify("OnFleetWingAdded", [5n]);
  session.notify("OnFleetSquadAdded", [5n, 6n]);
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  await turn();
  assert.deepEqual([waiting.length, fleetCalls(session).slice(3)], [2, ["N=1:500 GetWings", "N=1:500 GetWings"]]);
  // A read of the fleet waits for everything the client is asking, whichever is answered first.
  let read = null;
  const reading = pilots.fleetKept(WHO, handle).then((kept) => { read = kept; });
  waiting[1]({ type: "dict", entries: [] });
  await turn();
  assert.equal(read, null);
  waiting[0](WINGS_AFTER);
  await reading;
  assert.equal(keptShort(read)[1], 2);
  // The pilot leaves, and forms another fleet, before the next is answered: those wings are the old fleet's.
  waiting.length = 0;
  session.notify("OnFleetWingNameChanged", [5n, "x"]);
  await turn();
  assert.equal(waiting.length, 1);
  intoFleet(session, null);
  const again = await pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "Init", [null, null], null, WHO, handle, again.boundHandle);
  for (const answer of waiting) answer(WINGS_AFTER);
  assert.deepEqual(keptShort(await pilots.fleetKept(WHO, handle)), [[PILOT], 1, ""]);

  // A state answered as the session leaves the fleet is nobody's: nothing is kept, held or not.
  let leaving = null;
  const gone = await formed({ "bound:GetInitState": () => { if (leaving) leaving(); return FOUNDED; } });
  leaving = () => intoFleet(gone.session, null);
  gone.session.notify("OnFleetJoin", [keyVal([["charID", PILOT]])]);
  assert.deepEqual([await gone.pilots.fleetKept(WHO, gone.handle), gone.pilots.fleet(FIELDS, gone.handle).holdsObject], [null, false]);
});

// ── what the client does about its fleet of its own accord, beside reading it ──

const ledgerOf = (pilots, pair) => { const row = pilots.callLedger().find((each) => each.pair === pair); return row ? [row.statuses, row.source] : null; };

test("a pilot who is moved finishes the move, and a wing the pilot makes is given a squad, as the client does both", async () => {
  let wing = 654500030002n;
  let squadRefused = false;
  const built = await formed({ "bound:GetInitState": FOUNDED, "bound:CreateWing": () => wing, "bound:CreateSquad": () => { if (squadRefused) throw refusedBy("FleetError"); return 654500040002n; } });
  const { pilots, session, handle } = built;
  const asked = () => fleetCalls(session).slice(3);
  // fleetSvc.OnFleetMove (1813): self.fleet.FinishMove(), on the fleet's object. The session's wing and squad change by it.
  session.notify("OnFleetMove", []);
  await pilots.fleetKept(WHO, handle);
  const finished = session.boundCalls.filter((call) => call.method === "FinishMove");
  assert.deepEqual([asked(), finished.map((call) => [call.args, call.kwargs])], [["N=1:500 FinishMove"], [[[], null]]]);
  assert.deepEqual(ledgerOf(pilots, "fleetObjectHandler.FinishMove"), [{ same: 1 }, "eve/client/script/parklife/fleetSvc.py:1816"]);

  // fleetSvc.CreateWing (575): wingID = self.fleet.CreateWing(); if wingID: self.CreateSquad(wingID). Both before it is over.
  const own = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [], null, WHO, handle);
  const makeWing = (handleOf = own) => pilots.callBoundMethod("fleetObjectHandler", "CreateWing", [], null, WHO, handle, handleOf.boundHandle);
  const made = await makeWing();
  assert.equal(made.result, 654500030002);
  assert.deepEqual([asked().slice(1), session.boundCalls.at(-1).args, session.boundCalls.at(-1).kwargs], [["N=1:500 CreateWing", "N=1:500 CreateSquad"], [654500030002n], null]);
  assert.deepEqual(ledgerOf(pilots, "fleetObjectHandler.CreateSquad")[0], { same: 1 });
  // No wing, no squad: the server answered none, or nothing.
  for (const none of [null, 0, 0n]) {
    wing = none;
    const before = asked().length;
    await makeWing();
    assert.deepEqual(asked().slice(before), ["N=1:500 CreateWing"], String(none));
  }
  // A squad the server will not make leaves the wing made, and the call's answer the wing's.
  wing = 654500030003n;
  squadRefused = true;
  assert.equal((await makeWing()).result, 654500030003);
  assert.deepEqual(asked().slice(-2), ["N=1:500 CreateWing", "N=1:500 CreateSquad"]);
  // The wing is not made, as far as its maker is told, until its squad has been asked for and answered.
  squadRefused = false;
  let squadAnswers = null;
  const slow = await formed({ "bound:GetInitState": FOUNDED, "bound:CreateWing": 654500030009n, "bound:CreateSquad": () => new Promise((resolve) => { squadAnswers = resolve; }) });
  const slowOwn = await slow.pilots.bindObject("fleetObjectHandler", "MachoBindObject", [], null, WHO, slow.handle);
  let wingMade = false;
  const making = slow.pilots.callBoundMethod("fleetObjectHandler", "CreateWing", [], null, WHO, slow.handle, slowOwn.boundHandle).then(() => { wingMade = true; });
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([wingMade, typeof squadAnswers], [false, "function"]);
  squadAnswers(654500040009n);
  await making;
  // A wing asked of another fleet's Moniker is not the client's own doing, and nothing follows it.
  const other = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET + 1]], null, WHO, handle);
  await makeWing(other);
  assert.deepEqual(fleetCalls(session).slice(-1).map((call) => call.split(" ")[1]), ["CreateWing"]);
  assert.notEqual(fleetCalls(session).at(-1).split(" ")[0], "N=1:500");
});

test("the fleet's writes are judged and shaped by what is kept: who its boss is, its options, and who the pilot is", async () => {
  const built = await formed({ "bound:GetInitState": WITH_TWO });
  const { pilots, session, handle } = built;
  const own = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [], null, WHO, handle);
  const write = (method, args) => pilots.callBoundMethod("fleetObjectHandler", method, args, null, WHO, handle, own.boundHandle);
  const statuses = (method) => ledgerOf(pilots, `fleetObjectHandler.${method}`)[0];
  const optionsOf = (keyValue) => Object.fromEntries(keyValue.args.entries.map(([name, value]) => [String(name), value]));
  // fleetSvc.SetOptions: a copy of the kept options, a KeyVal as the server's is, with free move changed.
  await write("SetOptions", [{ isFreeMove: true }]);
  const sent = session.boundCalls.at(-1).args[0];
  assert.deepEqual([sent.type, String(sent.name), optionsOf(sent)], ["object", "util.KeyVal", { isFreeMove: true, isRegistered: false, autoJoinSquadID: null }]);
  assert.deepEqual(statuses("SetOptions"), { reshaped: 1 });
  // The options the server then says are the ones a later copy is of.
  session.notify("OnFleetOptionsChanged", [sent, keyVal([["isFreeMove", true], ["isRegistered", true], ["autoJoinSquadID", 7n]])]);
  await write("SetOptions", [{ isFreeMove: false }]);
  assert.deepEqual(optionsOf(session.boundCalls.at(-1).args[0]), { isFreeMove: false, isRegistered: true, autoJoinSquadID: 7n });
  // The pilot is the boss of the recording's fleet: it may disband it, and kick the other. Its own number is not kicked.
  await write("KickMember", [OTHER]);
  await write("KickMember", [PILOT]);
  assert.deepEqual(statuses("KickMember"), { same: 1, differs: 1 });
  await write("DisbandFleet", []);
  assert.deepEqual(statuses("DisbandFleet"), { same: 1 });
  // The boss is another now: the client would refuse to disband, itself.
  session.notify("OnFleetMemberChanged", [PILOT, 1n, -1, -1, 1, 2, null, -1, -1, 1, 0, null, false]);
  await write("DisbandFleet", []);
  assert.deepEqual(statuses("DisbandFleet"), { same: 1, differs: 1 });
  // Out of the fleet nothing is kept to copy: the options go as they were spelt, and are said to differ.
  intoFleet(session, null);
  const gone = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[FLEET]], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "SetOptions", [{ isFreeMove: true }], null, WHO, handle, gone.boundHandle);
  assert.deepEqual([session.boundCalls.at(-1).args, statuses("SetOptions")], [[{ isFreeMove: true }], { reshaped: 2, differs: 1 }]);
});

// ── the two windows the fleet's main one offers to some: join requests, composition ──
//
// fleetwindow.py offers the join requests' window to the boss, and the composition's to a commander or the boss.
// Nobody else's client asks for either. The page shows both with the fleet, so a read of the fleet is those
// windows shown, for those who would have them.

const REQUESTS = { type: "dict", entries: [[140000003, keyVal([["charID", 140000003], ["corpID", 98000000]])]] };
const compositionOf = (shipTypeID) => ({ type: "list", items: [keyVal([["characterID", PILOT], ["shipTypeID", shipTypeID]])] });
/** The pilot's own record changed to this role and job, as the server's notice says it. */
const ownChange = (role, job) => ["OnFleetMemberChanged", [PILOT, 1n, -1, -1, 1, 2, null, -1, -1, role, job, null, false]];
const windowCalls = (session) => everyFleetCall(session).filter((call) => / (GetJoinRequests|GetFleetComposition)$/.test(call)).map((call) => call.split(" ")[1]);
const requestIDs = (kept) => kept.GetJoinRequests.entries.map(([charID]) => Number(charID));
const shipsOf = (kept) => (kept.GetFleetComposition === null ? null : kept.GetFleetComposition.items.map((entry) => Object.fromEntries(entry.args.entries).shipTypeID));

test("the boss's fleet is read with its join requests, asked once, and its composition, kept twenty seconds", async () => {
  const clock = { now: 1_800_000_000_000 };
  let ship = 588;
  const built = await formed({ "bound:GetInitState": WITH_TWO, "bound:GetJoinRequests": REQUESTS, "bound:GetFleetComposition": () => compositionOf(ship) }, { now: () => clock.now });
  const { pilots, session, handle } = built;
  const read = () => pilots.fleetKept(WHO, handle);
  // The first read: both windows shown for the first time.
  const first = await read();
  assert.deepEqual([windowCalls(session), requestIDs(first), shipsOf(first)], [["GetJoinRequests", "GetFleetComposition"], [140000003], [588]]);
  // Both in the gateway's form, as a read of each comes.
  assert.deepEqual([first.GetJoinRequests.entries[0][1].name, first.GetFleetComposition.items[0].name, first.GetFleetComposition.items[0].args.entries[0][0]], ["util.KeyVal", "util.KeyVal", "characterID"]);
  assert.deepEqual(session.boundCalls.slice(-2).map((call) => [call.objectID, call.args, call.kwargs]), [["N=1:500", [], null], ["N=1:500", [], null]]);
  // Read again, at once and nineteen seconds on: neither is asked, and the answers are what is kept.
  ship = 648;
  for (const later of [0, 19_000, 20_000]) {
    clock.now = 1_800_000_000_000 + later;
    const again = await read();
    assert.deepEqual([windowCalls(session).length, requestIDs(again), shipsOf(again)], [2, [140000003], [588]], String(later));
  }
  // After twenty seconds the composition is asked for again. The join requests are not.
  clock.now += 1;
  assert.deepEqual([shipsOf(await read()), windowCalls(session).slice(2)], [[648], ["GetFleetComposition"]]);
  // The pilot's own record changing is the composition good no longer, however lately it was asked.
  ship = 670;
  session.notify(...ownChange(1, 2));
  assert.deepEqual([shipsOf(await read()), windowCalls(session).slice(3)], [[670], ["GetFleetComposition"]]);
  // The join requests are kept right by the server's notices.
  session.notify("OnFleetJoinRequest", [keyVal([["charID", 140000004]])]);
  assert.deepEqual(requestIDs(await read()), [140000003, 140000004]);
  session.notify("OnJoinRequestUpdate", [{ type: "dict", entries: [] }]);
  assert.deepEqual([requestIDs(await read()), windowCalls(session).length], [[], 4]);
  // Each is in the ledger as the client's own call.
  assert.deepEqual(["GetJoinRequests", "GetFleetComposition"].map((method) => ledgerOf(pilots, `fleetObjectHandler.${method}`)[0]), [{ same: 1 }, { same: 3 }]);
});

test("a member who commands nothing is asked for neither; a commander for the composition; whoever becomes the boss for the join requests", async () => {
  const clock = { now: 1_800_000_000_000 };
  const member = recorded("joiner", "GetInitState")[0];
  // The stand-in pilot is the recording's founder; the joiner's view is made this pilot's by leaving the founder its job and taking a member's role in the session.
  const asMember = { ...member, args: { ...member.args, entries: member.args.entries.map(([name, value]) => (String(name) === "members" ? [name, { type: "dict", entries: value.entries.map(([charID, record]) => [charID, { ...record, args: { ...record.args, entries: record.args.entries.map(([field, each]) => (String(field) === "job" ? [field, 0] : [field, each])) } }]) }] : [name, value])) } };
  const built = await formed({ "bound:GetInitState": asMember, "bound:GetJoinRequests": REQUESTS, "bound:GetFleetComposition": compositionOf(588) }, { now: () => clock.now });
  const { pilots, session, handle } = built;
  const read = () => pilots.fleetKept(WHO, handle);
  const role = (fleetrole) => { session.attributes.fleetrole = fleetrole; session.change({ fleetrole: [null, fleetrole] }); };
  // evefleet.fleetRoleMember: nothing is asked, and nothing is kept to show.
  role(4);
  const plain = await read();
  assert.deepEqual([windowCalls(session), requestIDs(plain), shipsOf(plain)], [[], [], null]);
  // A squad commander, a wing commander and a fleet commander (fleetCmdrRoles) have the composition's window; not the boss's.
  for (const [index, fleetrole] of [3, 2, 1].entries()) {
    role(fleetrole);
    clock.now += 20_001;
    const commanding = await read();
    assert.deepEqual([windowCalls(session), requestIDs(commanding), shipsOf(commanding)], [Array(index + 1).fill("GetFleetComposition"), [], [588]], String(fleetrole));
  }
  // The boss, whatever its role: the join requests, asked the once.
  role(4);
  session.notify(...ownChange(4, 2));
  const boss = await read();
  assert.deepEqual([windowCalls(session).slice(3), requestIDs(boss)], [["GetJoinRequests", "GetFleetComposition"], [140000003]]);
  // No longer the boss, and a member again: nothing is asked, and neither window is the pilot's to be shown.
  session.notify(...ownChange(4, 0));
  clock.now += 20_001;
  const after = await read();
  assert.deepEqual([windowCalls(session).length, requestIDs(after), shipsOf(after)], [5, [], null]);
  // The boss again: what was kept all along is shown, the join requests not asked for a second time.
  session.notify(...ownChange(4, 2));
  const back = await read();
  assert.deepEqual([windowCalls(session).slice(5), requestIDs(back), shipsOf(back)], [["GetFleetComposition"], [140000003], [588]]);
});

test("join requests and a composition that came too late, or could not be had, are not kept for the next fleet", async () => {
  const clock = { now: 1_800_000_000_000 };
  const waiting = [];
  let refuse = false;
  const answers = {
    "bound:GetInitState": WITH_TWO,
    "bound:GetJoinRequests": () => { if (refuse) throw refusedBy("FleetNotCreator"); return new Promise((resolve) => waiting.push(["requests", resolve])); },
    "bound:GetFleetComposition": () => { if (refuse) throw refusedBy("FleetNotFound"); return new Promise((resolve) => waiting.push(["composition", resolve])); },
  };
  const built = await formed(answers, { now: () => clock.now });
  const { pilots, session, handle } = built;
  const settle = async () => { for (let turns = 0; turns < 3; turns += 1) await new Promise((resolve) => setImmediate(resolve)); };
  const asked = () => waiting.map(([what]) => what);
  const formAgain = async () => {
    const again = await pilots.bindObject("fleetObjectHandler", "CreateFleet", [], null, WHO, handle);
    await pilots.callBoundMethod("fleetObjectHandler", "Init", [null, null], null, WHO, handle, again.boundHandle);
    waiting.length = 0;
  };
  // The join requests are asked for, and the pilot is out of the fleet before they are answered: nothing to read.
  const first = pilots.fleetKept(WHO, handle);
  await settle();
  assert.deepEqual(asked(), ["requests"]);
  intoFleet(session, null);
  waiting[0][1](REQUESTS);
  assert.equal(await first, null);
  // In the next fleet they are asked for afresh: the old fleet's were not kept for it.
  await formAgain();
  const second = pilots.fleetKept(WHO, handle);
  await settle();
  assert.deepEqual(asked(), ["requests"]);
  waiting[0][1]({ type: "dict", entries: [] });
  await settle();
  assert.deepEqual(asked(), ["requests", "composition"]);
  // The same of the composition.
  intoFleet(session, null);
  waiting[1][1](compositionOf(588));
  assert.equal(await second, null);
  await formAgain();
  const third = pilots.fleetKept(WHO, handle);
  await settle();
  waiting[0][1](REQUESTS);
  await settle();
  assert.deepEqual(asked(), ["requests", "composition"]);
  waiting[1][1](compositionOf(648));
  const kept = await third;
  assert.deepEqual([requestIDs(kept), shipsOf(kept)], [[140000003], [648]]);

  // Refused: nothing is kept, and the fleet reads all the same.
  intoFleet(session, null);
  await formAgain();
  refuse = true;
  const before = windowCalls(session).length;
  const refused = await pilots.fleetKept(WHO, handle);
  assert.deepEqual([keptShort(refused)[0], requestIDs(refused), shipsOf(refused), windowCalls(session).slice(before)], [[PILOT, OTHER], [], null, ["GetJoinRequests", "GetFleetComposition"]]);
  // At the next read the composition is asked for again, as the client asks where it has none that is good. The join requests' window has been shown.
  refuse = false;
  const again = pilots.fleetKept(WHO, handle);
  await settle();
  assert.deepEqual(asked(), ["composition"]);
  waiting[0][1](compositionOf(670));
  assert.deepEqual(shipsOf(await again), [670]);
});

// ── the standings as they are kept ───────────────────────────────────────────
//
// standingsvc.py reads a character's standings when it is chosen, and again when its corporation changes
// (__RefreshStandings), and keeps them right from the server's notices (src/gamePort/pilotStandings.js). The
// answers here are a real server's (test/fixtures/standingsSession.json).

const standingsRecording = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", "standingsSession.json"), "utf8"),
  (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value));
const standingAnswer = (call) => standingsRecording.events.find((event) => event.kind === "answer" && event.call === call).value;
const STANDING_ANSWERS = {
  "standingMgr.GetNPCNPCStandings": standingAnswer("GetNPCNPCStandings"),
  "standingMgr.GetCharStandings": standingAnswer("GetCharStandings"),
  "standingMgr.GetCorpStandings": standingAnswer("GetCorpStandings"),
};
const PLAYER_CORP = 98000000;
/** The standing calls a session has been asked, by name. */
const standingCalls = (session) => session.calls.filter((call) => call.service === "standingMgr").map((call) => call.method);
/** A kept answer's rows as [fromID, standing], out of the gateway's form. */
const standingRows = (rowset) => (rowset === null ? null : Object.fromEntries(rowset.args.entries).lines.items.map((line) => [line.items[0], line.items[1]]));
const CHAR_ROWS = [[500001, -3.978], [1000002, 1.069], [1000005, -1.107], [1000006, 1.107], [1000044, 1.25], [3008416, -0.53]];
const CORP_ROWS = [[500001, -1.614], [1000002, 1.069], [1000005, -1.107], [1000006, 1.107], [1000044, 1.25], [3008416, -0.53]];

test("a character chosen has its standings read as the client's standing service reads them, and they are kept", async () => {
  // In an NPC corporation, as the stand-in pilot is: the NPCs' standings with each other, then the character's.
  // The corporation's are none, and are not asked for (standingsvc.py 118).
  const { pilots, session, handle } = await selected({ answers: STANDING_ANSWERS });
  assert.deepEqual(session.calls.map((call) => `${call.service}.${call.method}`), [
    "charUnboundMgr.GetCharacterSelectionData", "charUnboundMgr.GetCharacterLockType", "charUnboundMgr.SelectCharacterID", ...CHOSEN_ASKS,
  ]);
  assert.deepEqual(session.calls.slice(3, 5).map((call) => [call.args, call.kwargs]), [[[], null], [[], null]]);
  const kept = await pilots.standingsKept(WHO, handle);
  assert.deepEqual([standingRows(kept.char), kept.corp], [CHAR_ROWS, null]);
  // In the gateway's form, as a read of GetCharStandings comes.
  assert.deepEqual([kept.char.type, kept.char.name, Object.fromEntries(kept.char.args.entries).header.items], ["object", "eve.common.script.sys.rowset.Rowset", ["fromID", "standing"]]);
  // Read again: nothing is asked. And each call the transport made is in the ledger as the client's own.
  await pilots.standingsKept(WHO, handle);
  assert.deepEqual(standingCalls(session), ["GetNPCNPCStandings", "GetCharStandings"]);
  assert.deepEqual(["GetNPCNPCStandings", "GetCharStandings"].map((method) => ledgerOf(pilots, `standingMgr.${method}`)), [[{ same: 1 }, "eve/client/script/ui/services/standingsvc.py:115"], [{ same: 1 }, "eve/client/script/ui/services/standingsvc.py:119"]]);
  assert.equal(ledgerOf(pilots, "standingMgr.GetCorpStandings"), null);
  // Another account's session cannot read them.
  await assert.rejects(pilots.standingsKept({ userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("a pilot in a player's corporation is asked for its corporation's standings too, and what the server says afterwards is kept without asking", async () => {
  const { pilots, session, handle } = await selected({ answers: STANDING_ANSWERS, corpid: PLAYER_CORP });
  assert.deepEqual(standingCalls(session), ["GetNPCNPCStandings", "GetCharStandings", "GetCorpStandings"]);
  const kept = await pilots.standingsKept(WHO, handle);
  assert.deepEqual([standingRows(kept.char), standingRows(kept.corp)], [CHAR_ROWS, CORP_ROWS]);
  // OnStandingSet and OnStandingsModified, to the character and to its corporation.
  session.notify("OnStandingSet", [1000125, PILOT, 3.5]);
  session.notify("OnStandingSet", [500001, PLAYER_CORP, 0]);
  session.notify("OnStandingsModified", [{ type: "list", items: [{ type: "list", items: [1000044, PILOT, 0.5, 0, 10] }] }]);
  const after = await pilots.standingsKept(WHO, handle);
  assert.deepEqual(new Map(standingRows(after.char)).get(1000125), 3.5);
  assert.deepEqual(new Map(standingRows(after.char)).get(1000044), 10 * (1 - (1 - 0.125) * 0.5));
  assert.deepEqual(standingRows(after.corp).map(([fromID]) => fromID), [1000002, 1000005, 1000006, 1000044, 3008416]);
  assert.deepEqual(standingCalls(session).length, 3);
  // idCheckers.IsNPC is above the system's items and below the players' owners: only there are a corporation's standings none.
  for (const [corpid, calls] of [[10000, 3], [10001, 2], [89999999, 2], [90000000, 3]]) {
    const edge = await selected({ answers: STANDING_ANSWERS, corpid });
    assert.equal(standingCalls(edge.session).length, calls, String(corpid));
  }
});

test("a change of corporation has the standings read again, and standings that could not be read are not kept", async () => {
  // standingsvc.ProcessSessionChange: 'corpid' in change and change['corpid'][1].
  const built = await selected({ answers: STANDING_ANSWERS });
  const { pilots, session, handle } = built;
  session.notify("OnStandingSet", [1000125, PILOT, 3.5]);
  session.attributes.corpid = PLAYER_CORP;
  session.change({ corpid: [1000044, PLAYER_CORP] });
  const joined = await pilots.standingsKept(WHO, handle);
  assert.deepEqual(standingCalls(session), ["GetNPCNPCStandings", "GetCharStandings", "GetNPCNPCStandings", "GetCharStandings", "GetCorpStandings"]);
  // What is kept is what the server answered this time: the standing the notice had set is the old reading's.
  assert.deepEqual([standingRows(joined.char), standingRows(joined.corp)], [CHAR_ROWS, CORP_ROWS]);
  // A session change that is about something else, or a corporation left for none, reads nothing.
  session.change({ fleetrole: [null, 1], wingid: [null, 7] });
  session.attributes.corpid = null;
  session.change({ corpid: [PLAYER_CORP, null] });
  await pilots.standingsKept(WHO, handle);
  assert.equal(standingCalls(session).length, 5);

  // The character's standings cannot be read: the character is chosen all the same, and nothing is kept.
  const refused = await selected({ answers: { ...STANDING_ANSWERS, "standingMgr.GetCharStandings": () => { throw refusedBy("NotNow"); } } });
  assert.equal(typeof refused.handle, "string");
  assert.equal(await refused.pilots.standingsKept(WHO, refused.handle), null);
  // The NPCs' cannot: nothing more is asked, and nothing is kept.
  const early = await selected({ answers: { ...STANDING_ANSWERS, "standingMgr.GetNPCNPCStandings": () => { throw refusedBy("NotNow"); } }, corpid: PLAYER_CORP });
  assert.deepEqual([standingCalls(early.session), await early.pilots.standingsKept(WHO, early.handle)], [["GetNPCNPCStandings"], null]);
  // An answer that is no standings is not kept either.
  const odd = await selected({ answers: { ...STANDING_ANSWERS, "standingMgr.GetCharStandings": "the standings" } });
  assert.equal(await odd.pilots.standingsKept(WHO, odd.handle), null);
  // Later readings replace earlier ones; one that fails leaves what was kept.
  let fail = false;
  const kept = await selected({ answers: { ...STANDING_ANSWERS, "standingMgr.GetCharStandings": () => { if (fail) throw refusedBy("NotNow"); return STANDING_ANSWERS["standingMgr.GetCharStandings"]; } } });
  fail = true;
  kept.session.attributes.corpid = PLAYER_CORP;
  kept.session.change({ corpid: [1000044, PLAYER_CORP] });
  assert.deepEqual(standingRows((await kept.pilots.standingsKept(WHO, kept.handle)).char), CHAR_ROWS);
});

// ── the monikers the BFF asks for ────────────────────────────────────────────
//
// The BFF binds an object and then calls it, in two steps (its gateway's way). The client has no such first step:
// a Moniker is made, and binds when it is first called, carrying that call (moniker.py). So a moniker the BFF
// asks for is made and not bound, and what the server sees is the client's bind.

const HANDLE_PAIRS = { allowed: new Set([
  "fleetObjectHandler.MachoBindObject", "fleetObjectHandler.GetInitState", "fleetObjectHandler.GetWings",
  "agentMgr.MachoBindObject", "agentMgr.DoAction", "ship.MachoBindObject", "ship.Board", "crimewatch.MachoBindObject", "crimewatch.GetClientStates",
]) };

test("a moniker the BFF asks for is made and not bound: its first call goes with the bind, and the calls after to the object", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetInitState": "the state", "bound:GetWings": "the wings" } }, HANDLE_PAIRS);
  session.calls.length = 0;
  const fleet = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[1099511627776]], null, WHO, handle);
  assert.deepEqual([typeof fleet.boundHandle, fleet.service, fleet.method], ["string", "fleetObjectHandler", "MachoBindObject"]);
  // Nothing has been sent: not a bind, and nothing by name.
  assert.deepEqual([session.binds, session.boundCalls, session.calls], [[], [], []]);
  const state = await pilots.callBoundMethod("fleetObjectHandler", "GetInitState", [], null, WHO, handle, fleet.boundHandle);
  assert.equal(state.result, "the state");
  assert.deepEqual([session.binds, session.carried], [[{ service: "fleetObjectHandler", params: 1099511627776 }], ["GetInitState"]]);
  const wings = await pilots.callBoundMethod("fleetObjectHandler", "GetWings", [7], { passive: 1 }, WHO, handle, fleet.boundHandle);
  assert.equal(wings.result, "the wings");
  assert.deepEqual([session.binds.length, session.boundCalls.map((call) => [call.objectID, call.method, call.args, call.kwargs])], [1, [["N=1:1", "GetInitState", [], null], ["N=1:1", "GetWings", [7], { passive: 1 }]]]);
  // Another moniker of the same service is another Moniker: bound by its own first call, with what it was asked for.
  const other = await pilots.bindObject("fleetObjectHandler", "MachoBindObject", [[1099511627777]], null, WHO, handle);
  await pilots.callBoundMethod("fleetObjectHandler", "GetWings", [], null, WHO, handle, other.boundHandle);
  assert.deepEqual([session.binds.at(-1), session.carried, session.boundCalls.at(-1).objectID], [{ service: "fleetObjectHandler", params: 1099511627777 }, ["GetInitState", "GetWings"], "N=1:2"]);
  // Two calls at once on one that is not bound: one bind, the other waits for the object.
  const agent = await pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, handle);
  await Promise.all([1, 2].map((actionID) => pilots.callBoundMethod("agentMgr", "DoAction", [actionID], null, WHO, handle, agent.boundHandle)));
  assert.deepEqual([session.binds.filter((bind) => bind.service === "agentMgr"), session.boundCalls.slice(-2).map((call) => [call.objectID, call.args])], [[{ service: "agentMgr", params: 3008416 }], [["N=1:3", [1]], ["N=1:3", [2]]]]);
});

test("where the client makes a Moniker for each call, a moniker the BFF asks for is made anew for each too", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:Board": ([shipID]) => `aboard ${shipID}` } }, HANDLE_PAIRS);
  const ship = await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHO, handle);
  const first = await pilots.callBoundMethod("ship", "Board", [SHIP + 1], null, WHO, handle, ship.boundHandle);
  const second = await pilots.callBoundMethod("ship", "Board", [SHIP + 2], null, WHO, handle, ship.boundHandle);
  // Each answer is its own call's, come back with the bind.
  assert.deepEqual([first.result, second.result], [`aboard ${SHIP + 1}`, `aboard ${SHIP + 2}`]);
  const crime = await pilots.bindObject("crimewatch", "MachoBindObject", [], null, WHO, handle);
  await pilots.callBoundMethod("crimewatch", "GetClientStates", [], null, WHO, handle, crime.boundHandle);
  await pilots.callBoundMethod("crimewatch", "GetClientStates", [], null, WHO, handle, crime.boundHandle);
  // Docked in a station: a bind for each call of the ship's, and for each of crimewatch's anywhere.
  assert.deepEqual(session.binds.map((bind) => bind.service), ["ship", "ship", "crimewatch", "crimewatch"]);
  assert.deepEqual(session.carried, ["Board", "Board", "GetClientStates", "GetClientStates"]);
  assert.deepEqual(session.boundCalls.map((call) => call.objectID), ["N=1:1", "N=1:2", "N=1:3", "N=1:4"]);
});

test("a moniker whose bind finds no object says so at the call that made it bind, and the next call binds again", async () => {
  let answer = () => { throw sessionError("BIND_FAILED", "agentMgr did not return a bound object."); };
  const { pilots, session, handle } = await selected({ answers: { "bind:agentMgr": (params, call) => answer(params, call) } }, HANDLE_PAIRS);
  const agent = await pilots.bindObject("agentMgr", "MachoBindObject", [1], null, WHO, handle);
  const ask = () => pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, handle, agent.boundHandle);
  await rejects(ask(), "BOUND_NO_OBJECT", /^agentMgr\.MachoBindObject did not return a bound object\.$/);
  answer = () => { throw sessionError("RESOLVE_FAILED", "agentMgr could not say where its object lives."); };
  await rejects(ask(), "BOUND_NO_OBJECT");
  // A refusal of the call it carried is the call's own refusal.
  answer = () => { throw refusedBy("NotNow"); };
  await rejects(ask(), "CALL_REFUSED", /^NotNow$/);
  // Any other failure of it is a failed call, and no word about objects.
  answer = () => { throw new Error("the wire fell silent"); };
  await rejects(ask(), "CALL_FAILED", /^agentMgr\.DoAction failed: the wire fell silent$/);
  // Each try was a bind; none bound, so the moniker is still to bind, and does.
  answer = (params, call) => ({ objectID: "N=1:50", nodeID: 1, result: `bound by ${call[0]}` });
  assert.deepEqual([(await ask()).result, session.binds.length], ["bound by DoAction", 5]);
  // A lost connection ends the session, as anywhere.
  answer = null;
  const lost = await selected({ answers: { "bind:agentMgr": () => { throw sessionError("CONNECTION_LOST"); } } }, HANDLE_PAIRS);
  const gone = await lost.pilots.bindObject("agentMgr", "MachoBindObject", [1], null, WHO, lost.handle);
  await rejects(lost.pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, lost.handle, gone.boundHandle), "SESSION_NOT_FOUND");
  assert.equal(lost.pilots.size, 0);
});

// ── the skill handler ────────────────────────────────────────────────────────
//
// skillsvc.GetSkillHandler: the client asks skillMgr2 for its skill handler once, which answers a Moniker, and
// keeps it. Its reads are calls on that moniker: the first goes with the bind, the rest to the object. Recorded
// on Tranquility at login (the moniker names service skillMgr2 and its node; the bind carries GetBoosters), and
// in this server's log of a retail client (the moniker names skillHandler and no node; the bind carries GetSkills).

const skillMoniker = (service, nodeID, characterID = PILOT) => ({ type: "object", name: Buffer.from("carbon.common.script.net.moniker.Moniker"), args: [Buffer.from(service), nodeID, characterID, null] });
const SKILL_PAIRS = { allowed: new Set(["skillHandler.GetImplants", "skillHandler.GetBoosters", "skillHandler.GetSkills", "skillHandler.GetAllSkills", "skillHandler.GetAttributes", "skillHandler.GetSkillHistory", "skillHandler.GetFreeSkillPoints", "skillHandler.GetRespecInfo", "skillHandler.GetSkillPoints", "skillHandler.AbortTraining", "dogmaIM.GetTargets", "someService.GetSkills"]) };
const implantsOf = (...typeIDs) => ({ type: "dict", entries: typeIDs.map((typeID, index) => [index + 1, keyVal([["typeID", typeID]])]) });
const skillOf = (typeID, level, points, rank = 1, virtualLevel = null) => ({ type: "objectex1", header: [{ type: "token", value: "characterskills.common.character_skill_entry.CharacterSkillEntry" }, [typeID, level, points, rank, virtualLevel]], list: [], dict: [] });
const skillsOf = (...entries) => ({ type: "dict", entries: entries.map((entry) => [entry.header[1][0], entry]) });
const historyOf = (...skillTypeIDs) => ({ type: "list", items: skillTypeIDs.map((skillTypeID) => keyVal([["skillTypeID", skillTypeID], ["level", 1]])) });
/** What the handler of a stand-in server answers: a pilot with two skills, nothing queued, no free points. The reads asked after the choosing answer in their own way, so that what is kept can be told from what is asked. */
const handlerAnswers = (more = {}) => ({
  "skillMgr2.GetMySkillHandler": skillMoniker("skillHandler", null),
  "bound:GetSkills": skillsOf(skillOf(3300, 4, 45255), skillOf(3327, 3, 8000, 2)),
  "bound:GetAllSkills": skillsOf(skillOf(3300, 4, 45255), skillOf(3327, 3, 8000, 2), skillOf(3402, 1, 250)),
  "bound:GetBoosters": { type: "dict", entries: [] },
  "bound:GetSkillQueueAndFreePoints": [{ type: "list", items: [] }, 0],
  "bound:CheckAndSendNotifications": { type: "list", items: [] },
  "bound:GetSkillHistory": ([maxresults]) => historyOf(...Array(maxresults === 10 ? 2 : 3).fill(3300)),
  "bound:GetImplants": implantsOf(9899),
  "bound:GetAttributes": { type: "dict", entries: [[164, 20], [165, 21]] },
  "bound:GetFreeSkillPoints": 0,
  "bound:GetRespecInfo": keyVal([["freeRespecs", 3]]),
  "bound:GetSkillPoints": 53505,
  ...more,
});
/** What was asked of the handler's object since `from`: each method, with its arguments where it had any. */
const handlerCalls = (session, from = 0) => session.boundCalls.slice(from).map((call) => (call.args.length ? [call.method, call.args] : call.method));
const LOGIN_READS = ["GetSkills", "GetBoosters", "GetSkillQueueAndFreePoints", "GetAllSkills", "CheckAndSendNotifications", ["GetSkillHistory", [10]]];
const skillRead = async (pilots, handle, method, args = []) => (await pilots.callMethod("skillHandler", method, args, null, FIELDS, handle)).result;
const typesOf = (list) => list.entries.map(([typeID, entry]) => [typeID, entry.header[1][1]]);

test("a character chosen has its skill handler asked for and bound, and asked what the client's skill services ask it then", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers() }, SKILL_PAIRS);
  // Asked of skillMgr2 by name, with nothing, after the standings; the moniker it answered is bound by the first read,
  // by the character, and the rest go to the object, in the order a real client asked this server.
  assert.deepEqual(session.calls.slice(3).map((call) => [`${call.service}.${call.method}`, call.args, call.kwargs]), CHOSEN_ASKS.map((pair) => [pair, [], pair === "notificationMgr.GetAllNotifications" ? { fromID: 0 } : null]));
  assert.deepEqual([session.binds, session.carried, session.nodes], [[{ service: "skillHandler", params: PILOT }], ["GetSkills"], []]);
  assert.deepEqual(handlerCalls(session), LOGIN_READS);
  assert.deepEqual([...new Set(session.boundCalls.map((call) => call.objectID))], ["N=1:1"]);
  assert.deepEqual(session.boundCalls.map((call) => call.kwargs), LOGIN_READS.map(() => null));
  // Each is in the ledger once, as the client's own call, with where the client makes it.
  const sources = { GetSkills: "skillsvc.py:136", GetBoosters: "skillsvc.py:962", GetSkillQueueAndFreePoints: "skillQueueSvc.py:117", GetAllSkills: "skillsvc.py:142", CheckAndSendNotifications: "skillHistoryProvider.py:26", GetSkillHistory: "skillsvc.py:363" };
  for (const [method, source] of Object.entries(sources)) {
    const [statuses, noted] = ledgerOf(pilots, `skillHandler.${method}`);
    assert.deepEqual([statuses, noted.endsWith(source)], [{ same: 1 }, true], method);
  }
  assert.deepEqual(ledgerOf(pilots, "skillMgr2.GetMySkillHandler")[0], { same: 1 });
});

test("what the client's skill services keep is answered from what is kept, and asked for once where it was not", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers() }, SKILL_PAIRS);
  const asked = session.boundCalls.length;
  // Read at the choosing: answered as the server answered then, in the gateway's form, with nothing asked.
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetSkills")), [[3300, 4], [3327, 3]]);
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetAllSkills")), [[3300, 4], [3327, 3], [3402, 1]]);
  assert.deepEqual(await skillRead(pilots, handle, "GetBoosters"), { type: "dict", entries: [] });
  // The history is the one the notifications asked for when the character was chosen, however many are asked for now.
  assert.equal((await skillRead(pilots, handle, "GetSkillHistory")).items.length, 2);
  assert.equal((await skillRead(pilots, handle, "GetSkillHistory", [50])).items.length, 2);
  assert.deepEqual([handlerCalls(session, asked), session.binds.length], [[], 1]);
  // And none of those is a call in the ledger: each was made once, at the choosing.
  for (const method of ["GetSkills", "GetAllSkills", "GetBoosters", "GetSkillHistory"]) assert.deepEqual(ledgerOf(pilots, `skillHandler.${method}`)[0], { same: 1 }, method);

  // Not read at the choosing: asked for when first wanted, with nothing whatever the asker passed, and kept from then.
  const implants = await skillRead(pilots, handle, "GetImplants", [7]);
  assert.deepEqual(implants.entries.map(([slot, row]) => [slot, new Map(row.args.entries).get("typeID")]), [[1, 9899]]);
  assert.deepEqual(await skillRead(pilots, handle, "GetImplants"), implants);
  assert.equal(new Map((await skillRead(pilots, handle, "GetRespecInfo")).args.entries).get("freeRespecs"), 3);
  await skillRead(pilots, handle, "GetRespecInfo");
  // The queue's read said no free points, which is nothing kept: they are asked for once (skillsvc.GetFreeSkillPoints).
  assert.deepEqual([await skillRead(pilots, handle, "GetFreeSkillPoints"), await skillRead(pilots, handle, "GetFreeSkillPoints")], [0, 0]);
  assert.deepEqual(handlerCalls(session, asked), ["GetImplants", "GetRespecInfo", "GetFreeSkillPoints"]);
  // The attributes are asked for behind the boosters and the implants, each asked again though kept (GetCharacterAttributes).
  const then = session.boundCalls.length;
  assert.deepEqual(await skillRead(pilots, handle, "GetAttributes"), { type: "dict", entries: [[164, 20], [165, 21]] });
  await skillRead(pilots, handle, "GetAttributes");
  assert.deepEqual(handlerCalls(session, then), ["GetBoosters", "GetImplants", "GetAttributes"]);
  assert.deepEqual(["GetImplants", "GetBoosters", "GetAttributes", "GetRespecInfo", "GetFreeSkillPoints"].map((method) => ledgerOf(pilots, `skillHandler.${method}`)[0]), [{ same: 2 }, { same: 2 }, { same: 1 }, { same: 1 }, { same: 1 }]);

  // What the services do not keep is asked each time, on the same object, and is in the ledger as asked for by name.
  assert.deepEqual([await skillRead(pilots, handle, "GetSkillPoints"), await skillRead(pilots, handle, "GetSkillPoints")], [53505, 53505]);
  assert.deepEqual([handlerCalls(session, then).slice(3), ledgerOf(pilots, "skillHandler.GetSkillPoints")[0], session.binds.length, session.calls.filter((call) => call.service === "skillMgr2").length], [["GetSkillPoints", "GetSkillPoints"], { reshaped: 2 }, 1, 1]);
  // A read of the same name on another service is that service's own, asked and noted as any call is.
  await pilots.callMethod("someService", "GetSkills", [], null, FIELDS, handle);
  assert.deepEqual([session.calls.at(-1).service, ledgerOf(pilots, "someService.GetSkills")[0]], ["someService", { unchecked: 1 }]);
  // Two at once that are not kept are asked once.
  const lost = await selected({ answers: handlerAnswers() }, SKILL_PAIRS);
  const [one, two] = await Promise.all([skillRead(lost.pilots, lost.handle, "GetImplants"), skillRead(lost.pilots, lost.handle, "GetImplants")]);
  assert.deepEqual([one, handlerCalls(lost.session, LOGIN_READS.length)], [two, ["GetImplants"]]);
  // Another account's session reads nothing.
  await assert.rejects(pilots.callMethod("skillHandler", "GetSkills", [], null, { userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("free points the queue's read came with are kept, and a history not kept is asked for by how many are wanted", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers({ "bound:GetSkillQueueAndFreePoints": [{ type: "list", items: [] }, 5000], "bound:GetFreeSkillPoints": 1 }) }, SKILL_PAIRS);
  const asked = session.boundCalls.length;
  assert.equal(await skillRead(pilots, handle, "GetFreeSkillPoints"), 5000);
  // A skill changes: the history kept is forgotten, and the next asking of it asks, with the client's own count where none is named.
  session.notify("OnServerSkillsChanged", [skillsOf(skillOf(3300, 5, 256000)), null, 7n]);
  assert.equal((await skillRead(pilots, handle, "GetSkillHistory")).items.length, 3);
  assert.equal((await skillRead(pilots, handle, "GetSkillHistory", [10])).items.length, 3);
  assert.deepEqual(handlerCalls(session, asked), [["GetSkillHistory", [50]]]);
  session.notify("OnServerSkillsChanged", [skillsOf(skillOf(3300, 5, 256001)), null, 8n]);
  assert.equal((await skillRead(pilots, handle, "GetSkillHistory", [10])).items.length, 2);
  assert.deepEqual(handlerCalls(session, asked), [["GetSkillHistory", [50]], ["GetSkillHistory", [10]]]);
  assert.deepEqual(ledgerOf(pilots, "skillHandler.GetSkillHistory")[0], { same: 3 });
});

test("what the server says of the pilot's skills afterwards is kept without asking, and the client's own readings after a notice are made", async () => {
  let implants = implantsOf(9899);
  const { pilots, session, handle } = await selected({ answers: handlerAnswers({ "bound:GetImplants": () => implants }) }, SKILL_PAIRS);
  const asked = session.boundCalls.length;
  // A skill trained, one lent by its virtual level, and one taken away.
  session.notify("OnServerSkillsChanged", [skillsOf(skillOf(3300, 5, 256000), skillOf(3336, null, null, 8, 1)), null, 7n]);
  session.notify("OnServerSkillsRemoved", [skillsOf(skillOf(3327, 0, -1, 2)), 8n]);
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetSkills")), [[3300, 5], [3336, null]]);
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetAllSkills")), [[3300, 5], [3402, 1], [3336, null]]);
  session.notify("OnFreeSkillPointsChanged", [1200]);
  assert.equal(await skillRead(pilots, handle, "GetFreeSkillPoints"), 1200);
  assert.deepEqual(handlerCalls(session, asked), []);

  // An implant plugged in: the client reads its boosters, its implants and its attributes again, at once, and they are kept.
  await skillRead(pilots, handle, "GetImplants");
  implants = implantsOf(9899, 9941);
  const then = session.boundCalls.length;
  session.notify("OnServerImplantsChanged", []);
  assert.equal((await skillRead(pilots, handle, "GetImplants")).entries.length, 2);
  assert.deepEqual(await skillRead(pilots, handle, "GetAttributes"), { type: "dict", entries: [[164, 20], [165, 21]] });
  assert.deepEqual(handlerCalls(session, then), ["GetBoosters", "GetImplants", "GetAttributes"]);
  for (const method of ["OnServerBoostersChanged", "OnRespecInfoChanged"]) session.notify(method, []);
  await skillRead(pilots, handle, "GetBoosters");
  assert.deepEqual(handlerCalls(session, then).slice(3), ["GetBoosters", "GetImplants", "GetAttributes", "GetBoosters", "GetImplants", "GetAttributes"]);
  // The respec was forgotten by its notice, and is asked for when next wanted.
  const before = session.boundCalls.length;
  await skillRead(pilots, handle, "GetRespecInfo");
  assert.deepEqual(handlerCalls(session, before), ["GetRespecInfo"]);
  // Readings after a notice that fail leave what was kept, and break nothing.
  const failing = await selected({ answers: handlerAnswers({ "bound:GetImplants": () => { throw refusedBy("NotNow"); } }) }, SKILL_PAIRS);
  failing.session.notify("OnServerBoostersChanged", []);
  assert.deepEqual(await skillRead(failing.pilots, failing.handle, "GetBoosters"), { type: "dict", entries: [] });
  assert.deepEqual(handlerCalls(failing.session, LOGIN_READS.length), ["GetBoosters", "GetImplants"]);
});

test("a forced refresh forgets all the skill service keeps, its handler too: the next read asks for the handler and binds it again", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers() }, SKILL_PAIRS);
  const asked = session.boundCalls.length;
  session.notify("OnSkillForcedRefresh", []);
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetSkills")), [[3300, 4], [3327, 3]]);
  await skillRead(pilots, handle, "GetSkills");
  assert.deepEqual([session.calls.filter((call) => call.service === "skillMgr2").length, session.binds, session.carried], [2, [{ service: "skillHandler", params: PILOT }, { service: "skillHandler", params: PILOT }], ["GetSkills", "GetSkills"]]);
  assert.deepEqual(session.boundCalls.slice(asked).map((call) => [call.objectID, call.method]), [["N=1:2", "GetSkills"]]);
});

test("the handler's reads at the choosing stop at the first that cannot be made, and the choosing is none the worse", async () => {
  let refuse = true;
  const { pilots, session, handle, outcome } = await selected({ answers: handlerAnswers({ "bound:GetBoosters": () => { if (refuse) throw refusedBy("NotNow"); return { type: "dict", entries: [[1, 2]] }; } }) }, SKILL_PAIRS);
  assert.deepEqual([outcome.session.characterID, handlerCalls(session)], [PILOT, ["GetSkills", "GetBoosters"]]);
  // What was read is kept; what was not is asked for when it is wanted, and a refusal then is the caller's.
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetSkills")), [[3300, 4], [3327, 3]]);
  await rejects(skillRead(pilots, handle, "GetBoosters"), "CALL_REFUSED");
  refuse = false;
  assert.deepEqual(await skillRead(pilots, handle, "GetBoosters"), { type: "dict", entries: [[1, 2]] });
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetAllSkills")), [[3300, 4], [3327, 3], [3402, 1]]);
  assert.deepEqual(handlerCalls(session), ["GetSkills", "GetBoosters", "GetBoosters", "GetBoosters", "GetAllSkills"]);
  // An answer that is no list of skills is handed on as it came, and is not kept: the next read asks again.
  const odd = await selected({ answers: handlerAnswers({ "bound:GetSkills": 7 }) }, SKILL_PAIRS);
  assert.deepEqual([await skillRead(odd.pilots, odd.handle, "GetSkills"), await skillRead(odd.pilots, odd.handle, "GetSkills")], [7, 7]);
  assert.deepEqual(handlerCalls(odd.session, LOGIN_READS.length), ["GetSkills", "GetSkills"]);
  // A connection lost in the middle of them is the choosing lost, as one lost anywhere in it is: no session is handed out.
  const built = build({ answers: handlerAnswers({ "bound:GetAllSkills": () => { built.session.drop(); throw sessionError("CONNECTION_CLOSED"); } }) }, SKILL_PAIRS);
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
  assert.deepEqual([handlerCalls(built.session), built.pilots.size], [["GetSkills", "GetBoosters", "GetSkillQueueAndFreePoints", "GetAllSkills"], 0]);
  // And under the standings' readings before them.
  const early = build({ answers: { "standingMgr.GetCharStandings": () => { early.session.drop(); throw sessionError("CONNECTION_CLOSED"); } } }, SKILL_PAIRS);
  await rejects(early.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "SESSION_SELECT_FAILED", /closed the connection/);
  assert.deepEqual([early.session.calls.filter((call) => call.service === "skillMgr2").length, early.pilots.size], [0, 0]);
});

test("the skill handler's moniker is bound by what it says: its own service, and its node where it names one", async () => {
  // As Tranquility answers: service skillMgr2, on a node. The node is told to the session, which then has no need to ask.
  const { pilots, session, handle } = await selected({ answers: handlerAnswers({ "skillMgr2.GetMySkillHandler": skillMoniker("skillMgr2", 2290655) }) }, SKILL_PAIRS);
  assert.deepEqual([session.binds, session.carried, session.nodes], [[{ service: "skillMgr2", params: PILOT }], ["GetSkills"], [["skillMgr2", PILOT, 2290655]]]);
  assert.deepEqual(handlerCalls(session), LOGIN_READS);
  const [first, second] = await Promise.all([skillRead(pilots, handle, "GetSkillPoints"), skillRead(pilots, handle, "GetSkillPoints")]);
  assert.deepEqual([first, second, session.calls.filter((call) => call.service === "skillMgr2").length, session.binds.length], [53505, 53505, 1, 1]);
});

test("with no skill handler answered there is nothing to ask, and the next read asks for one again", async () => {
  let answer = null;
  const { pilots, session, handle } = await selected({ answers: { "skillMgr2.GetMySkillHandler": () => { if (answer instanceof Error) throw answer; return answer; }, "bound:GetImplants": implantsOf() } }, SKILL_PAIRS);
  const read = () => pilots.callMethod("skillHandler", "GetImplants", [], null, FIELDS, handle);
  // The choosing asked, and was answered nothing: no call on a handler was made, and none is in the ledger.
  assert.deepEqual([session.calls.filter((call) => call.service === "skillMgr2").length, session.boundCalls, ledgerOf(pilots, "skillHandler.GetSkills")], [1, [], null]);
  // Nothing answered, something that is no moniker (one of them shaped like one), a moniker with no state, no service
  // or nothing to bind by, and a refusal.
  const likeOne = { ...skillMoniker("skillHandler", null), name: Buffer.from("something.Else") };
  const stateless = { ...skillMoniker("skillHandler", null), args: null };
  for (const each of [null, 7, { type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: [] } }, likeOne, stateless, skillMoniker("", null), { ...skillMoniker("skillHandler", null), args: [Buffer.from("skillHandler"), null, null, null] }]) {
    answer = each;
    await rejects(read(), "CALL_FAILED", /skill handler/);
  }
  answer = refusedBy("NotNow");
  await rejects(read(), "CALL_REFUSED");
  assert.deepEqual([session.binds, session.calls.filter((call) => call.service === "skillMgr2").length, ledgerOf(pilots, "skillHandler.GetImplants")], [[], 9, null]);
  answer = skillMoniker("skillHandler", null);
  assert.deepEqual((await read()).result, implantsOf());
  assert.deepEqual([session.binds, session.carried, ledgerOf(pilots, "skillHandler.GetImplants")[0]], [[{ service: "skillHandler", params: PILOT }], ["GetImplants"], { same: 1 }]);
});

test("the skill handler's object is the character's wherever it is: kept when the pilot moves, and bound again only when the server lets it go", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers({ "bound:GetTargets": { type: "list", items: [] } }) }, SKILL_PAIRS);
  await pilots.callMethod("dogmaIM", "GetTargets", [], null, FIELDS, handle);
  assert.deepEqual(session.binds.map((bind) => bind.service), ["skillHandler", "dogmaIM"]);
  // Another station: dogma's moniker is the old place's, and is bound again. The handler's is not.
  session.attributes.stationid = 60000004;
  session.change({ stationid: [STATION, 60000004], locationid: [STATION, 60000004] });
  await skillRead(pilots, handle, "GetSkillPoints");
  await pilots.callMethod("dogmaIM", "GetTargets", [], null, FIELDS, handle);
  assert.deepEqual([session.binds.map((bind) => bind.service), session.boundCalls.at(-2).objectID, session.calls.filter((call) => call.service === "skillMgr2").length], [["skillHandler", "dogmaIM", "dogmaIM"], "N=1:1", 1]);
  // The server lets the handler's object go: the moniker is the one the client has, and binds again by its next call.
  session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:1"), 1065450, null]);
  assert.equal(await skillRead(pilots, handle, "GetSkillPoints"), 53505);
  assert.deepEqual([session.binds.at(-1), session.carried.at(-1), session.calls.filter((call) => call.service === "skillMgr2").length], [{ service: "skillHandler", params: PILOT }, "GetSkillPoints", 1]);
  // What is kept was not the object's to take with it.
  const asked = session.boundCalls.length;
  assert.deepEqual(typesOf(await skillRead(pilots, handle, "GetSkills")), [[3300, 4], [3327, 3]]);
  assert.equal(session.boundCalls.length, asked);
});

// ── the Skills window's sheet ────────────────────────────────────────────────
//
// pilots.js skillSheet: the sheet made from what the client's skill services keep (skillSheet.js), with what is
// not kept asked for as the client's windows would ask.

const queuedSkill = (typeID, toLevel, position, start, end) => ({
  type: "object", name: Buffer.from("utillib.KeyVal"),
  args: { type: "dict", entries: [[Buffer.from("trainingStartSP"), 45255], [Buffer.from("queuePosition"), position], [Buffer.from("trainingTypeID"), typeID], [Buffer.from("trainingDestinationSP"), 256000], [Buffer.from("trainingEndTime"), end], [Buffer.from("trainingStartTime"), start], [Buffer.from("trainingToLevel"), toLevel]] },
});
/** 2026-10-09T13:29:15Z as the server counts time, and as this machine does. */
const QUEUE_START = 134360261550000000n;
const QUEUE_START_MS = Number((QUEUE_START - 116444736000000000n) / 10000n);
const TRAINING = { "bound:GetSkillQueueAndFreePoints": [{ type: "list", items: [queuedSkill(3300, 5, 0, QUEUE_START, QUEUE_START + 36_000_000_000n)] }, 0] };
/** Pilot options for a sheet: the skill handler's pairs, and what the client knows of a type without asking. */
const SHEET = { ...SKILL_PAIRS, typeNames: (typeID) => ({ name: `Skill ${typeID}`, groupName: "A group" }), typeAttribute: (typeID, attributeID) => ({ 180: 165, 181: 164 })[attributeID] ?? null };
const sheetRows = (sheet) => sheet.skills.map((row) => [row.typeID, row.level, row.skillPoints, row.inTraining]);

test("the Skills window's sheet is made from what is kept, and asks only for what the client's window would ask", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers({ "bound:GetFreeSkillPoints": 700 }), serverNow: QUEUE_START_MS + 120_000 }, SHEET);
  const asked = session.boundCalls.length;
  const sheet = await pilots.skillSheet(WHO, handle);
  assert.deepEqual([sheet.characterID, sheet.characterName, sheet.serverNowMs, sheet.queueWarning], [PILOT, "Test Pilot", QUEUE_START_MS + 120_000, null]);
  assert.deepEqual(sheetRows(sheet), [[3300, 4, 45255, false], [3327, 3, 8000, false]]);
  assert.deepEqual(sheet.skills[0], { typeID: 3300, name: "Skill 3300", groupName: "A group", level: 4, rank: 1, skillPoints: 45255, levelSkillPoints: [250, 1415, 8000, 45255, 256000], inTraining: false });
  // The total is of the list with the lapsed (three skills) and the free points.
  assert.deepEqual([sheet.totalSkillPoints, sheet.freeSkillPoints, sheet.queue], [45255 + 8000 + 250 + 700, 700, { active: false, entries: [], endTimeMs: null, maxEntries: 150 }]);
  // The lists and the queue were read at the choosing. The free points were not kept by it (the queue came with none),
  // and are asked for once. Nothing is in training, so the attributes are not wanted.
  assert.deepEqual(handlerCalls(session, asked), ["GetFreeSkillPoints"]);
  await pilots.skillSheet(WHO, handle);
  assert.deepEqual(handlerCalls(session, asked), ["GetFreeSkillPoints"]);
  // What the server says afterwards is in the next sheet, with nothing asked.
  session.notify("OnServerSkillsChanged", [skillsOf(skillOf(3300, 5, 256000), skillOf(3402, 2, 1415)), null, 7n]);
  session.notify("OnFreeSkillPointsChanged", [0]);
  const later = await pilots.skillSheet(WHO, handle);
  assert.deepEqual([sheetRows(later), later.totalSkillPoints, handlerCalls(session, asked)], [[[3300, 5, 256000, false], [3327, 3, 8000, false], [3402, 2, 1415, false]], 256000 + 8000 + 1415, ["GetFreeSkillPoints"]]);
  // Another account's session reads nothing.
  await assert.rejects(pilots.skillSheet({ userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("with a skill in training the sheet asks for the character's attributes as the client does, once, and reckons the skill's points from them", async () => {
  const { pilots, session, handle } = await selected({ answers: handlerAnswers(TRAINING), serverNow: QUEUE_START_MS + 120_000 }, SHEET);
  const asked = session.boundCalls.length;
  const sheet = await pilots.skillSheet(WHO, handle);
  // skillsvc.GetCharacterAttributes: the boosters and the implants again, then the attributes. 21 and half of 20 a minute, for two minutes.
  assert.deepEqual(handlerCalls(session, asked), ["GetFreeSkillPoints", "GetBoosters", "GetImplants", "GetAttributes"]);
  assert.deepEqual(sheet.queue, {
    active: true,
    entries: [{ queuePosition: 0, typeID: 3300, toLevel: 5, startSP: 45255, destinationSP: 256000, startTimeMs: QUEUE_START_MS, endTimeMs: QUEUE_START_MS + 3_600_000, skillPointsPerMinute: 31 }],
    endTimeMs: QUEUE_START_MS + 3_600_000,
    maxEntries: 150,
  });
  assert.deepEqual(sheetRows(sheet), [[3300, 4, 45255 + 62, true], [3327, 3, 8000, false]]);
  // Again: nothing asked, and the points are the clock's.
  session.serverNowMs += 60_000;
  assert.deepEqual([sheetRows(await pilots.skillSheet(WHO, handle))[0], handlerCalls(session, asked).length], [[3300, 4, 45255 + 93, true], 4]);
  // The queue stopped by the server: nothing is in training, and the points are the entry's.
  session.notify("OnSkillQueuePausedServer", []);
  const stopped = await pilots.skillSheet(WHO, handle);
  assert.deepEqual([stopped.queue.active, stopped.queue.entries.map((entry) => [entry.startTimeMs, entry.endTimeMs, entry.skillPointsPerMinute]), sheetRows(stopped)[0]], [false, [[null, null, 0]], [3300, 4, 45255, false]]);
  // A sheet first asked for with nothing in training, and then with something: the attributes are asked for then.
  const idle = await selected({ answers: handlerAnswers(), serverNow: QUEUE_START_MS }, SHEET);
  await idle.pilots.skillSheet(WHO, idle.handle);
  idle.session.notify("OnNewSkillQueueSaved", [TRAINING["bound:GetSkillQueueAndFreePoints"][0]]);
  const from = idle.session.boundCalls.length;
  assert.equal((await idle.pilots.skillSheet(WHO, idle.handle)).queue.entries[0].skillPointsPerMinute, 31);
  assert.deepEqual(handlerCalls(idle.session, from), ["GetBoosters", "GetImplants", "GetAttributes"]);
});

test("a sheet for a pilot whose reads at the choosing could not be made asks for them, and fails as its reads fail", async () => {
  let refuse = true;
  const answers = handlerAnswers({ ...TRAINING, "bound:GetBoosters": () => { if (refuse) throw refusedBy("NotNow"); return { type: "dict", entries: [] }; } });
  const { pilots, session, handle } = await selected({ answers, serverNow: QUEUE_START_MS }, SHEET);
  // The choosing read the skills and stopped at the boosters: no queue, no list with the lapsed.
  assert.deepEqual(handlerCalls(session), ["GetSkills", "GetBoosters"]);
  // The sheet asks for the list, the queue (PrimeSkillQueue) and the free points; the queue has a skill in training, so
  // the attributes are wanted, and the boosters before them are refused: the sheet is refused, as the client's window would fail.
  await rejects(pilots.skillSheet(WHO, handle), "CALL_REFUSED");
  assert.deepEqual(handlerCalls(session, 2), ["GetAllSkills", "GetSkillQueueAndFreePoints", "GetFreeSkillPoints", "GetBoosters"]);
  refuse = false;
  const sheet = await pilots.skillSheet(WHO, handle);
  assert.deepEqual([sheet.queue.active, sheet.queue.entries[0].skillPointsPerMinute, handlerCalls(session, 6)], [true, 31, ["GetBoosters", "GetImplants", "GetAttributes"]]);
  assert.deepEqual(ledgerOf(pilots, "skillHandler.GetSkillQueueAndFreePoints"), [{ same: 1 }, "eve/client/script/ui/services/skillQueueSvc.py:117"]);
  // A connection lost under it ends the session, as anywhere.
  const lost = await selected({ answers: handlerAnswers({ "bound:GetFreeSkillPoints": () => { throw sessionError("CONNECTION_LOST"); } }) }, SHEET);
  await rejects(lost.pilots.skillSheet(WHO, lost.handle), "SESSION_NOT_FOUND");
  assert.equal(lost.pilots.size, 0);
});

test("a queue is saved as the client's queue panel saves one: on the handler, each entry by its place, started, and the queue asked for again", async () => {
  let queue = [{ type: "list", items: [] }, 0];
  let tell = () => {};
  // The server says the queue was saved before it answers the save, as this server and Tranquility do.
  const answers = handlerAnswers({ "bound:GetSkillQueueAndFreePoints": () => queue, "bound:SaveNewQueue": () => { queue = TRAINING["bound:GetSkillQueueAndFreePoints"]; tell(); return null; } });
  const { pilots, session, handle } = await selected({ answers, serverNow: QUEUE_START_MS + 60_000 }, SHEET);
  tell = () => session.notify("OnNewSkillQueueSaved", [queue[0]]);
  const asked = session.boundCalls.length;
  const saved = await pilots.saveSkillQueue([[3300, 5], [3327, 4]], WHO, handle);
  // What the save answered, and what the server pushed while it was made, as any call's answer has them.
  assert.deepEqual([saved.service, saved.method, saved.result, saved.notifications.map((notice) => notice.method)], ["skillHandler", "SaveNewQueue", null, ["OnNewSkillQueueSaved"]]);
  // skillQueueSvc.TrimQueue reckons each entry's training time, which reads the attributes (the boosters and the implants
  // before them). Then the save, and the panel's new transaction.
  assert.deepEqual(session.boundCalls.slice(asked).map((call) => call.method), ["GetBoosters", "GetImplants", "GetAttributes", "SaveNewQueue", "GetSkillQueueAndFreePoints"]);
  const save = session.boundCalls.find((call) => call.method === "SaveNewQueue");
  // SaveNewQueue({0: (3300, 5), 1: (3327, 4)}, activate=True), on the handler's own object.
  assert.deepEqual([save.objectID, save.args, save.kwargs], ["N=1:1", [{ type: "dict", entries: [[0, [3300, 5]], [1, [3327, 4]]] }], { activate: true }]);
  assert.deepEqual(session.calls.filter((call) => call.method === "SaveNewQueue"), [], "not by name, on any service");
  assert.deepEqual([ledgerOf(pilots, "skillHandler.SaveNewQueue"), ledgerOf(pilots, "skillMgr.SaveNewQueue")], [[{ same: 1 }, "eve/client/script/ui/services/skillQueueSvc.py:153"], null]);
  // The queue the new transaction was answered is the queue kept: the sheet has it, with nothing more asked.
  const then = session.boundCalls.length;
  const sheet = await pilots.skillSheet(WHO, handle);
  assert.deepEqual([sheet.queue.active, sheet.queue.entries.map((entry) => [entry.typeID, entry.toLevel]), handlerCalls(session, then)], [true, [[3300, 5]], ["GetFreeSkillPoints"]]);
  // Saved again: the attributes are kept, and are not asked for.
  await pilots.saveSkillQueue([[3300, 5]], WHO, handle);
  assert.deepEqual(handlerCalls(session, then).slice(1), [["SaveNewQueue", [{ type: "dict", entries: [[0, [3300, 5]]] }]], "GetSkillQueueAndFreePoints"]);
  // An empty queue has nothing to reckon: saved as it is, started as the client always says, and asked for again.
  const empty = await selected({ answers: handlerAnswers() }, SHEET);
  const from = empty.session.boundCalls.length;
  await empty.pilots.saveSkillQueue([], WHO, empty.handle);
  assert.deepEqual(empty.session.boundCalls.slice(from).map((call) => [call.method, call.args, call.kwargs]), [["SaveNewQueue", [{ type: "dict", entries: [] }], { activate: true }], ["GetSkillQueueAndFreePoints", [], null]]);
  // Another account's session saves nothing.
  await assert.rejects(pilots.saveSkillQueue([[3300, 5]], { userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
});

test("a queue the server refuses is refused with the server's word, and the queue is asked for again unless the client would not", async () => {
  let refusal = "QueueTooLong";
  const answers = handlerAnswers({ "bound:SaveNewQueue": () => { throw refusedBy(refusal); }, "bound:GetAttributes": { type: "dict", entries: [[164, 20], [165, 21]] } });
  const { pilots, session, handle } = await selected({ answers }, SHEET);
  await skillRead(pilots, handle, "GetAttributes");
  const asked = session.boundCalls.length;
  const refused = await pilots.saveSkillQueue([[3300, 5]], WHO, handle).then(() => null, (error) => error);
  assert.deepEqual([refused.code, refused.message, refused.refusal.key], ["CALL_REFUSED", "QueueTooLong", "QueueTooLong"]);
  // The panel rolls its change back and opens a new transaction: the queue is asked for.
  assert.deepEqual(handlerCalls(session, asked).map((call) => (Array.isArray(call) ? call[0] : call)), ["SaveNewQueue", "GetSkillQueueAndFreePoints"]);
  // After these two it opens none, and asks for nothing.
  for (const key of ["UserAlreadyHasSkillInTraining", "SkillInQueueRequiresOmegaCloneState"]) {
    refusal = key;
    const from = session.boundCalls.length;
    await rejects(pilots.saveSkillQueue([[3300, 5]], WHO, handle), "CALL_REFUSED");
    assert.deepEqual(session.boundCalls.slice(from).map((call) => call.method), ["SaveNewQueue"], key);
  }
  // Every save sent is in the ledger, refused or not.
  assert.deepEqual(ledgerOf(pilots, "skillHandler.SaveNewQueue")[0], { same: 3 });
  // The asking after a save failing is no failure of the save.
  const flaky = await selected({ answers: handlerAnswers({ "bound:SaveNewQueue": null }) }, SHEET);
  let asks = 0;
  flaky.session.callBound = ((original) => async (objectID, method, args, kwargs) => {
    if (method === "GetSkillQueueAndFreePoints" && (asks += 1)) throw refusedBy("NotNow");
    return original(objectID, method, args, kwargs);
  })(flaky.session.callBound);
  assert.equal((await flaky.pilots.saveSkillQueue([], WHO, flaky.handle)).result, null);
  assert.equal(asks, 1);
  // With no handler to save on there is no save, and none in the ledger.
  const none = await selected({ answers: {} }, SHEET);
  await rejects(none.pilots.saveSkillQueue([], WHO, none.handle), "CALL_FAILED", /skill handler/);
  assert.deepEqual([none.session.boundCalls, ledgerOf(none.pilots, "skillHandler.SaveNewQueue")], [[], null]);
  // A connection lost under the save ends the session, as anywhere.
  const lost = await selected({ answers: handlerAnswers({ "bound:SaveNewQueue": () => { throw sessionError("CONNECTION_LOST"); } }) }, SHEET);
  await rejects(lost.pilots.saveSkillQueue([], WHO, lost.handle), "SESSION_NOT_FOUND");
  assert.equal(lost.pilots.size, 0);
});

// ── the agents' journal ──────────────────────────────────────────────────────
//
// journal.py: the whole journal is asked for once and kept; a mission's change marks its agent, whose own part is
// then asked for on the agent's own moniker and put into what is kept (pilotJournal.js). The moniker is the one
// the client's agents service keeps for the agent, whoever asks on it.

const missionOf = (agentID, state = 1, contentID = 1) => [state, 0, "UI/Agents/MissionTypes/Courier", 5000 + contentID, agentID, 134365346460600000n, { type: "list", items: [] }, 0, 0, contentID];
const journalWith = (...missions) => [{ type: "list", items: missions }, { type: "list", items: [] }];
const JOURNAL_PAIRS = { allowed: new Set(["agentMgr.MachoBindObject", "agentMgr.DoAction", "agentMgr.GetMyJournalDetails", "station.GetGuests"]) };
const journalStates = (journal) => journal[0].items.map((each) => [each[0], each[4], each[9]]);
const journalAsked = (session) => session.calls.filter((call) => call.service === "agentMgr" && call.method === "GetMyJournalDetails").map((call) => call.method);

test("a character chosen has its agents' journal read as the client's journal service reads it, and it is kept", async () => {
  const { pilots, session, handle } = await selected({ answers: { "agentMgr.GetMyJournalDetails": journalWith(missionOf(3008416)) } }, JOURNAL_PAIRS);
  // By name, with nothing, after the standings and the skill handler.
  assert.deepEqual(session.calls.slice(3).map((call) => [`${call.service}.${call.method}`, call.args, call.kwargs])[3], ["agentMgr.GetMyJournalDetails", [], null]);
  assert.deepEqual(ledgerOf(pilots, "agentMgr.GetMyJournalDetails"), [{ same: 1 }, "eve/client/script/ui/shared/neocom/journal.py:312"]);
  // Read from what is kept, in the gateway's form, with nothing asked.
  const kept = await pilots.journalKept(WHO, handle);
  assert.deepEqual([journalStates(kept), kept[1]], [[[1, 3008416, 1]], { type: "list", items: [] }]);
  assert.deepEqual(kept[0].items[0][5], { type: "long", value: "134365346460600000" });
  await pilots.journalKept(WHO, handle);
  assert.deepEqual([journalAsked(session), session.binds, ledgerOf(pilots, "agentMgr.GetMyJournalDetails")[0]], [["GetMyJournalDetails"], [], { same: 1 }]);
  // Another account's session reads nothing.
  await assert.rejects(pilots.journalKept({ userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
  // A journal that cannot be read at the choosing does not fail the choosing: it is asked for when it is wanted.
  let refuse = true;
  const late = await selected({ answers: { "agentMgr.GetMyJournalDetails": () => { if (refuse) throw refusedBy("NotNow"); return journalWith(missionOf(3008416)); } } }, JOURNAL_PAIRS);
  assert.equal(late.outcome.session.characterID, PILOT);
  refuse = false;
  // Two readers at once are one reading: the second finds what the first kept.
  const [one, two] = await Promise.all([late.pilots.journalKept(WHO, late.handle), late.pilots.journalKept(WHO, late.handle)]);
  assert.deepEqual([journalStates(one), journalStates(two), journalAsked(late.session).length], [[[1, 3008416, 1]], [[1, 3008416, 1]], 2]);
});

test("after a mission changes, its agent is asked for its own part on its own moniker, at once, and that is put into what is kept", async () => {
  let own = journalWith(missionOf(3008416, 2));
  const { pilots, session, handle } = await selected({ answers: { "agentMgr.GetMyJournalDetails": journalWith(missionOf(3008416), missionOf(3008417, 2, 7)), "bound:GetMyJournalDetails": () => own } }, JOURNAL_PAIRS);
  session.notify("OnAgentMissionChange", [Buffer.from("accepted"), 3008416]);
  await settled();
  // Moniker('agentMgr', agentID), bound by this first call on it. The other agent's mission is as it was.
  assert.deepEqual([session.binds, session.carried, session.boundCalls.map((call) => [call.objectID, call.method, call.args, call.kwargs])], [[{ service: "agentMgr", params: 3008416 }], ["GetMyJournalDetails"], [["N=1:1", "GetMyJournalDetails", [], null]]]);
  assert.deepEqual(journalStates(await pilots.journalKept(WHO, handle)), [[2, 3008417, 7], [2, 3008416, 1]]);
  // It was not asked for by name again, and the reading after asks nothing.
  assert.deepEqual([journalAsked(session), session.boundCalls.length], [["GetMyJournalDetails"], 1]);
  assert.deepEqual(ledgerOf(pilots, "agentMgr.GetMyJournalDetails")[0], { same: 2 });
  // Changed again, and gone: asked on the object the moniker bound, with no second bind.
  own = journalWith();
  session.notify("OnAgentMissionChange", ["quit", 3008416]);
  await settled();
  assert.deepEqual([session.binds.length, session.boundCalls.map((call) => call.objectID), journalStates(await pilots.journalKept(WHO, handle))], [1, ["N=1:1", "N=1:1"], [[2, 3008417, 7]]]);
  // Two agents changed before anything is read: both asked, each on its own moniker.
  own = journalWith();
  const before = session.boundCalls.length;
  session.notify("__MultiEvent", []);
  session.notify("OnAgentMissionChange", ["offered", 3008418]);
  session.notify("OnAgentMissionChange", ["offered", 3008417]);
  await settled();
  await pilots.journalKept(WHO, handle);
  assert.deepEqual(session.binds.map((bind) => bind.params), [3008416, 3008418, 3008417]);
  assert.deepEqual([session.boundCalls.length - before, journalStates(await pilots.journalKept(WHO, handle))], [2, []]);
});

test("a change with no agent forgets the journal, which is read again in whole; a reading that fails leaves what was kept", async () => {
  let whole = journalWith(missionOf(3008416));
  let refuse = false;
  const answers = { "agentMgr.GetMyJournalDetails": () => { if (refuse) throw refusedBy("NotNow"); return whole; }, "bound:GetMyJournalDetails": () => { throw refusedBy("NotNow"); } };
  const { pilots, session, handle } = await selected({ answers }, JOURNAL_PAIRS);
  whole = journalWith(missionOf(3008416), missionOf(3008417));
  session.notify("OnAgentMissionChange", ["reset", null]);
  await settled();
  assert.deepEqual([journalAsked(session), journalStates(await pilots.journalKept(WHO, handle)).length, session.binds], [["GetMyJournalDetails", "GetMyJournalDetails"], 2, []]);
  // An agent's own answer refused: the reading the notice set going fails quietly, the agent is marked no longer, and
  // what was kept is what is read, with nothing asked again.
  session.notify("OnAgentMissionChange", ["accepted", 3008416]);
  await settled();
  const asked = session.boundCalls.length;
  assert.deepEqual([journalStates(await pilots.journalKept(WHO, handle)).length, session.boundCalls.length - asked, journalAsked(session).length], [2, 0, 2]);
  // The whole journal refused when it is wanted: the reader is refused, and the next reader asks again.
  refuse = true;
  session.notify("OnAgentMissionChange", ["reset", null]);
  await settled();
  await rejects(pilots.journalKept(WHO, handle), "CALL_REFUSED");
  refuse = false;
  assert.equal(journalStates(await pilots.journalKept(WHO, handle)).length, 2);
  // An answer that is no journal is nothing kept: the reader is told so, and may ask as it used to.
  let answer = 7;
  const none = await selected({ answers: { "agentMgr.GetMyJournalDetails": () => answer, "bound:GetMyJournalDetails": journalWith(missionOf(3008416, 2)) } }, JOURNAL_PAIRS);
  assert.equal(await none.pilots.journalKept(WHO, none.handle), null);
  // A mission changes while none is kept: the whole journal is read, and that is all that reading does. The agent
  // stays marked, and is asked for its own part by the reading after.
  answer = journalWith(missionOf(3008416));
  none.session.notify("OnAgentMissionChange", ["accepted", 3008416]);
  await settled();
  assert.deepEqual([journalAsked(none.session).length, none.session.boundCalls.length], [3, 0]);
  assert.deepEqual([journalStates(await none.pilots.journalKept(WHO, none.handle)), none.session.boundCalls.map((call) => call.method)], [[[2, 3008416, 1]], ["GetMyJournalDetails"]]);
  // A connection lost under a reading ends the session, as anywhere.
  const lost = await selected({ answers: { "agentMgr.GetMyJournalDetails": journalWith() } }, JOURNAL_PAIRS);
  lost.session.notify("OnAgentMissionChange", ["reset", null]);
  lost.session.call = async () => { throw sessionError("CONNECTION_LOST"); };
  await rejects(lost.pilots.journalKept(WHO, lost.handle), "SESSION_NOT_FOUND");
  assert.equal(lost.pilots.size, 0);
});

test("an agent has one object, whoever asks on it: the BFF's handle and the journal's own reading share the moniker", async () => {
  const answers = { "agentMgr.GetMyJournalDetails": journalWith(missionOf(3008416)), "bound:GetMyJournalDetails": journalWith(missionOf(3008416, 2)), "bound:DoAction": "talked" };
  const { pilots, session, handle } = await selected({ answers }, JOURNAL_PAIRS);
  // The BFF talks to the agent first: its handle's moniker binds, carrying the talk.
  const agent = (await pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, handle)).boundHandle;
  await pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, handle, agent);
  session.notify("OnAgentMissionChange", ["accepted", 3008416]);
  await settled();
  // The journal's reading goes to that object: nothing more is bound.
  assert.deepEqual([session.binds, session.carried, session.boundCalls.map((call) => [call.objectID, call.method])], [[{ service: "agentMgr", params: 3008416 }], ["DoAction"], [["N=1:1", "DoAction"], ["N=1:1", "GetMyJournalDetails"]]]);
  // Asked on at the same moment by the BFF's handle and by the journal's reading, an agent not yet bound is bound once.
  const both = await selected({ answers }, JOURNAL_PAIRS);
  const held = (await both.pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, both.handle)).boundHandle;
  const talking = both.pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, both.handle, held);
  both.session.notify("OnAgentMissionChange", ["accepted", 3008416]);
  await talking;
  await both.pilots.journalKept(WHO, both.handle);
  assert.deepEqual([both.session.binds.length, both.session.boundCalls.map((call) => call.objectID)], [1, ["N=1:1", "N=1:1"]]);
  // A second handle for the same agent is the same object too; another agent's is its own.
  const again = (await pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, handle)).boundHandle;
  const other = (await pilots.bindObject("agentMgr", "MachoBindObject", [3008417], null, WHO, handle)).boundHandle;
  await pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, handle, again);
  await pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, handle, other);
  assert.deepEqual([session.binds.map((bind) => bind.params), session.boundCalls.slice(2).map((call) => call.objectID)], [[3008416, 3008417], ["N=1:1", "N=1:2"]]);
  // The other way about: the journal's reading binds the moniker, and the BFF's handle asked for after uses what it bound.
  const first = await selected({ answers }, JOURNAL_PAIRS);
  first.session.notify("OnAgentMissionChange", ["accepted", 3008416]);
  await settled();
  const later = (await first.pilots.bindObject("agentMgr", "MachoBindObject", [3008416], null, WHO, first.handle)).boundHandle;
  await first.pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, first.handle, later);
  assert.deepEqual([first.session.binds.length, first.session.carried, first.session.boundCalls.map((call) => [call.objectID, call.method])], [1, ["GetMyJournalDetails"], [["N=1:1", "GetMyJournalDetails"], ["N=1:1", "DoAction"]]]);
  // The server lets the object go: the handles for it are forgotten, and the agent's moniker binds again by its next call.
  first.session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:1"), 1065450, null]);
  await rejects(first.pilots.callBoundMethod("agentMgr", "DoAction", [null], null, WHO, first.handle, later), "BOUND_HANDLE_NOT_FOUND");
  first.session.notify("OnAgentMissionChange", ["quit", 3008416]);
  await settled();
  assert.deepEqual([first.session.binds.length, first.session.carried.at(-1), first.session.boundCalls.at(-1).objectID], [2, "GetMyJournalDetails", "N=1:2"]);
});

// ── the agents' table ────────────────────────────────────────────────────────
//
// agents.py __GetAllAgents: the client asks for the whole table of agents once, as its character is chosen, and
// keeps it for as long as it runs. Each pilot here asks the same, and one copy is kept for them all.

const agentsRowset = (...agentIDs) => ({
  type: "object", name: Buffer.from("eve.common.script.sys.rowset.Rowset"),
  args: { type: "dict", entries: [[Buffer.from("header"), { type: "list", items: [Buffer.from("agentID"), Buffer.from("stationID")] }], [Buffer.from("lines"), { type: "list", items: agentIDs.map((agentID) => ({ type: "list", items: [agentID, STATION] })) }]] },
});
const AGENT_PAIRS = { allowed: new Set(["agentMgr.GetAgents", "station.GetGuests", "someService.GetAgents"]) };
const agentIDsIn = (result) => new Map(result.args.entries).get("lines").items.map((line) => line.items[0]);
const agentsAsked = (session) => session.calls.filter((call) => call.service === "agentMgr" && call.method === "GetAgents");
const readAgents = async (pilots, handle, who = WHO) => (await pilots.callMethod("agentMgr", "GetAgents", [], null, who, handle)).result;

test("the table of agents is asked for as a character is chosen, and a read of it after is answered from what was answered then", async () => {
  const { pilots, session, handle } = await selected({ answers: { "agentMgr.GetAgents": agentsRowset(3008416, 3008417) } }, AGENT_PAIRS);
  // By name, with nothing: the last thing the choosing asks.
  assert.deepEqual([agentsAsked(session), session.calls.at(-1).method], [[{ service: "agentMgr", method: "GetAgents", args: [], kwargs: null }], "GetAgents"]);
  const first = await readAgents(pilots, handle);
  // In the gateway's form, as a read of it came before.
  assert.deepEqual([first.type, first.name, agentIDsIn(first)], ["object", "eve.common.script.sys.rowset.Rowset", [3008416, 3008417]]);
  // Read again: the very table that was kept, with nothing asked and nothing more in the ledger.
  const again = await pilots.callMethod("agentMgr", "GetAgents", [], null, WHO, handle);
  assert.equal(again.result, first);
  assert.deepEqual([again.service, again.method, again.notifications, agentsAsked(session).length, ledgerOf(pilots, "agentMgr.GetAgents")], ["agentMgr", "GetAgents", [], 1, [{ same: 1 }, "eve/client/script/ui/station/agents/agents.py:92"]]);
  // A read of the same name on another service is that service's own: asked, and noted as any call is.
  await pilots.callMethod("someService", "GetAgents", [], null, WHO, handle);
  assert.deepEqual([session.calls.at(-1).service, ledgerOf(pilots, "someService.GetAgents")[0], agentsAsked(session).length], ["someService", { unchecked: 1 }, 1]);
  // Another account's session reads nothing, and a transport the pair is not allowed on does not hand it over.
  await assert.rejects(pilots.callMethod("agentMgr", "GetAgents", [], null, { userid: 9 }, handle), (error) => error.code === "SESSION_NOT_FOUND");
  const closed = await selected({ answers: { "agentMgr.GetAgents": agentsRowset(1) } }, { allowed: new Set(["station.GetGuests"]) });
  await rejects(closed.pilots.callMethod("agentMgr", "GetAgents", [], null, WHO, closed.handle), "CALL_NOT_ALLOWED");
});

test("one table of agents is kept for all pilots: each asks as it is chosen, and what the last was answered is what any of them reads", async () => {
  let asked = 0;
  const built = build({
    userid: (userName) => (userName === "test" ? ACCOUNT : 5),
    answers: {
      "charUnboundMgr.GetCharacterSelectionData": selectionData([characterRow(), characterRow({ characterID: 140000099 })]),
      "agentMgr.GetAgents": () => agentsRowset(3008416, 3008500 + (asked += 1)),
    },
  }, AGENT_PAIRS);
  const one = await built.pilots.selectCharacter([PILOT, null, true], null, FIELDS);
  const own = await readAgents(built.pilots, one.bridgeSessionID);
  assert.deepEqual(agentIDsIn(own), [3008416, 3008501]);
  const other = { userid: 5, userName: "other" };
  const two = await built.pilots.selectCharacter([140000099, null, true], null, other);
  // Each pilot's own session asked, once, as its client would.
  assert.deepEqual(built.made.map((session) => agentsAsked(session).length), [1, 1]);
  const [theirs, mine] = [await readAgents(built.pilots, two.bridgeSessionID, { userid: 5 }), await readAgents(built.pilots, one.bridgeSessionID)];
  assert.deepEqual([agentIDsIn(theirs), mine === theirs, asked], [[3008416, 3008502], true, 2]);
});

test("a table of agents that could not be read at the choosing does not fail it, and is asked for when it is wanted", async () => {
  let refuse = true;
  let asked = 0;
  const { pilots, session, handle, outcome } = await selected({ answers: { "agentMgr.GetAgents": () => { asked += 1; if (refuse) throw refusedBy("NotNow"); return agentsRowset(3008416); } } }, AGENT_PAIRS);
  assert.deepEqual([outcome.session.characterID, asked], [PILOT, 1]);
  // Wanted and refused: the reader is refused. Wanted again once it can be had: asked, once for two readers at once, and kept.
  await rejects(pilots.callMethod("agentMgr", "GetAgents", [], null, WHO, handle), "CALL_REFUSED");
  refuse = false;
  const [first, second] = await Promise.all([readAgents(pilots, handle), readAgents(pilots, handle)]);
  await readAgents(pilots, handle);
  assert.deepEqual([agentIDsIn(first), first === second, asked, agentsAsked(session).length], [[3008416], true, 3, 3]);
  // A connection lost under the asking ends the session, as anywhere.
  let drop = false;
  const lost = await selected({ answers: { "agentMgr.GetAgents": () => { if (drop) throw sessionError("CONNECTION_LOST"); throw refusedBy("NotNow"); } } }, AGENT_PAIRS);
  drop = true;
  await rejects(lost.pilots.callMethod("agentMgr", "GetAgents", [], null, WHO, lost.handle), "SESSION_NOT_FOUND");
  assert.equal(lost.pilots.size, 0);
});

test("with godma not primed there is no entry to give, and the ship is still said", async () => {
  const { pilots, handle } = await selected({ answers: { "bound:GetAllInfo": () => { throw new Error("not now"); } } });
  assert.deepEqual(await pilots.shipInfo(FIELDS, handle), { shipID: SHIP, row: null, online: [] });
});

test("the ship's entry has its capacitor as it has recharged to, as godma reckons it, and no entry at all for a ship godma could not be primed for", async () => {
  let clockMs = DOGMA_T_MS;
  let answers = true;
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": () => { if (!answers) throw new Error("not now"); return shipAllInfo(); } } }, { now: () => clockMs });
  const charge = async () => new Map(new Map((await pilots.shipInfo(FIELDS, handle)).row.args.entries).get("attributes").entries).get(18);
  assert.equal(await charge(), 50);
  // Ten seconds on, nothing asked: 50 of 125 has recharged by itself, and the entry says what it is now.
  clockMs += 10000;
  const later = await charge();
  assert.ok(later > 50 && later < 125, String(later));
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1);
  // Another ship, and dogma not answering for it: there is no entry, and the last ship's is not handed over in its place.
  session.attributes.shipid = 555;
  answers = false;
  assert.deepEqual(await pilots.shipInfo(FIELDS, handle), { shipID: 555, row: null, online: [] });
});
