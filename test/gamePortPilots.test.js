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
 * A stand-in GamePortSession. `answers` maps "service.method" to a value or to
 * a function of the arguments; a function may throw. Selecting puts the
 * character on the session as the server's session change does.
 */
function fakeSession({ answers = {}, userid = ACCOUNT, loginError = null, comesOnline = true, inSpace = false, handshakeAnswer = null } = {}) {
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
      const key = `${service}.${method}`;
      if (key === "charUnboundMgr.SelectCharacterID" && !(key in answers)) {
        if (comesOnline) {
          const place = inSpace ? { solarsystemid: SYSTEM } : { stationid: STATION };
          Object.assign(session.attributes, { charid: BigInt(args[0]), corpid: 1000044, solarsystemid2: SYSTEM, shipid: SHIP, ...place });
          session.change({ charid: [null, args[0]], stationid: [null, STATION] });
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
      const key = `${service}.${method}`;
      const answer = key in answers ? answers[key] : null;
      return typeof answer === "function" ? answer(args, kwargs) : answer;
    },
    /** A Moniker's bind: answers "N=1:<n>", counting up. */
    async bind(service, params) {
      if (session.closed) throw sessionError("CONNECTION_CLOSED");
      session.binds.push({ service, params });
      const answer = answers[`bind:${service}`];
      if (typeof answer === "function") return answer(params);
      session.objects += 1;
      return { objectID: `N=1:${session.objects}`, nodeID: 1, result: null };
    },
    /** A call on a bound object. The inventory managers hand back another bound object. */
    async callBound(objectID, method, args = [], kwargs = null) {
      if (session.closed) throw sessionError("CONNECTION_CLOSED");
      session.boundCalls.push({ objectID, method, args, kwargs });
      const key = `bound:${method}`;
      if (key in answers) return typeof answers[key] === "function" ? answers[key](args, kwargs, objectID) : answers[key];
      if (method === "GetInventory" || method === "GetInventoryFromId") {
        session.objects += 1;
        return boundObject(`N=1:${session.objects}`);
      }
      return null;
    },
    binds: [],
    proxyCalls: [],
    boundCalls: [],
    objects: 0,
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
  ]);
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
    args: [{ charid: [null, PILOT], stationid: [null, STATION] }], kwargs: null,
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
    "charUnboundMgr.GetCharacterSelectionData", "charUnboundMgr.GetCharacterLockType", "charUnboundMgr.SelectCharacterID", "beyonce.GetFormations",
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
  assert.equal(made[0].calls.length, 3 + 40);
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
  // With the client's keyword: its online modules by slot, of which this ship's dogma names none.
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:1", method: "Undock", args: [SHIP, false], kwargs: { onlineModules: { type: "dict", entries: [] } } });
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

test("a service's object is bound with what the retail client's moniker for it carries", async () => {
  const docked = await selected();
  const bind = (service, args) => docked.pilots.bindObject(service, "MachoBindObject", args, null, WHO, docked.handle);
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
  const { pilots, session, handle } = await selected();
  await rejects(pilots.bindObject("entity", "MachoBindObject", [], null, WHO, handle), "BOUND_NO_OBJECT", /entity\.MachoBindObject did not return a bound object/);
  await rejects(pilots.bindObject("beyonce", "MachoBindObject", [[SYSTEM, 5]], null, WHO, handle), "BOUND_NO_OBJECT");
  assert.deepEqual(session.binds, []);

  delete session.attributes.stationid;
  session.attributes.solarsystemid = SYSTEM;
  await pilots.bindObject("entity", "MachoBindObject", [], null, WHO, handle);
  await pilots.bindObject("beyonce", "MachoBindObject", [[SYSTEM, 5]], null, WHO, handle);
  await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHO, handle);
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
  await pilots.callBoundMethod("invbroker", "GetCapacity", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "GetCapacity", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "List", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "Add", [1, STATION], { flag: 5 }, WHO, handle, boundHandle);
  await pilots.callMethod("station", "GetGuests", [], null, WHO, handle);
  await pilots.callMethod("someService", "SomeMethod", [], null, WHO, handle);
  await rejects(pilots.callMethod("machoNet", "GetTime", [], null, WHO, handle), "CALL_NOT_ALLOWED");
  const tally = Object.fromEntries(pilots.callLedger().map((row) => [row.pair, row.statuses]));
  assert.deepEqual(tally, {
    "invbroker.GetCapacity": { "web-only": 2 },
    "charUnboundMgr.GetCharacterLockType": { same: 1 },
    "charUnboundMgr.GetCharacterSelectionData": { same: 1 },
    "charUnboundMgr.SelectCharacterID": { same: 1 },
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
  const ship = (await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHO, handle)).boundHandle;
  // The hangar is "N=1:2" (the manager that made it is "N=1:1"); the ship object is "N=1:3".
  session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:3"), 1065450, null]);
  await rejects(pilots.callBoundMethod("ship", "Board", [1], null, WHO, handle, ship), "BOUND_HANDLE_NOT_FOUND");
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
  const noObject = await selected({ answers: { "bind:agentMgr": () => { throw sessionError("BIND_FAILED", "agentMgr did not return a bound object."); } } });
  await rejects(noObject.pilots.bindObject("agentMgr", "MachoBindObject", [1], null, WHO, noObject.handle), "BOUND_NO_OBJECT", /^agentMgr\.MachoBindObject did not return a bound object\.$/);
  const nowhere = await selected({ answers: { "bind:agentMgr": () => { throw sessionError("RESOLVE_FAILED", "agentMgr could not say where its object lives."); } } });
  await rejects(nowhere.pilots.bindObject("agentMgr", "MachoBindObject", [1], null, WHO, nowhere.handle), "BOUND_NO_OBJECT");
  const empty = await selected({ answers: { "bound:GetInventoryFromId": () => null } });
  await rejects(empty.pilots.bindObject("invbroker", "GetInventoryFromId", [5], null, WHO, empty.handle), "BOUND_NO_OBJECT");

  const refused = await selected({ answers: { "bound:GetInventoryFromId": () => { throw refusedBy("FakeItemNotFound"); } } });
  await rejects(refused.pilots.bindObject("invbroker", "GetInventoryFromId", [5], null, WHO, refused.handle), "CALL_REFUSED", /^FakeItemNotFound$/);
  // A failed bind leaves no handle behind, and the manager it did bind is still the manager.
  assert.equal(refused.session.binds.length, 1);

  const lost = await selected({ answers: { "bind:ship": () => { throw sessionError("CONNECTION_LOST"); } } });
  await rejects(lost.pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHO, lost.handle), "SESSION_NOT_FOUND");
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

  // Asked again (the contraband question answered, say): the same two objects, and godma is not primed again.
  await pilots.callMethod("ship", "Undock", [SHIP, true], { onlineModules: [] }, FIELDS, handle);
  assert.equal(session.binds.length, 2);
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:2", method: "Undock", args: [SHIP, true], kwargs: { onlineModules: { type: "dict", entries: [[19, FITTED_MODULE]] } } });
  assert.equal(session.boundCalls.filter((call) => call.method === "GetAllInfo").length, 1);

  // The server lets the ship object go: the next call binds another.
  session.notify("OnMachoObjectDisconnect", [Buffer.from("N=1:2"), 0, 0]);
  await pilots.callMethod("ship", "Undock", [SHIP, false], null, FIELDS, handle);
  assert.deepEqual([session.binds.length, session.binds.at(-1), session.boundCalls.at(-1).objectID], [3, { service: "ship", params: [STATION, 15] }, "N=1:3"]);
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
  assert.deepEqual(session.boundCalls.at(-1), { objectID: "N=1:1", method: "Undock", args: [SHIP, false], kwargs: { onlineModules: { type: "dict", entries: [[19, FITTED_MODULE]] } } });
});

test("whatever is asked of ship or dogmaIM by name is made on the moniker, read against the client or not", async () => {
  const allowed = new Set(["dogmaIM.GetTargets", "dogmaIM.AddTarget", "dogmaIM.Overload", "dogmaIM.CreateNewbieShip", "ship.LeaveShip", "ship.GetShipConfiguration", "ship.LaunchDrones", "ship.GetShipFittingInfo", "station.GetGuests"]);
  const { pilots, session, handle } = await selected({ answers: { "bound:GetTargets": { type: "list", items: [9001] } } }, { allowed });
  const made = () => session.boundCalls.at(-1);
  const byName = () => session.calls.filter((call) => !call.service.startsWith("charUnboundMgr") && call.method !== "ShipGetInfo").map((call) => `${call.service}.${call.method}`);

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
  // The ship's: its own moniker, and what the pilot knows filled in.
  await pilots.callMethod("ship", "GetShipConfiguration", [], null, FIELDS, handle);
  assert.deepEqual(session.binds.at(-1), { service: "ship", params: [STATION, 15] });
  assert.deepEqual(made(), { objectID: "N=1:2", method: "GetShipConfiguration", args: [SHIP], kwargs: null });
  await pilots.callMethod("ship", "LaunchDrones", [[[11, 1]], PILOT, false], null, FIELDS, handle);
  assert.deepEqual(made(), { objectID: "N=1:2", method: "LaunchDrones", args: [{ type: "list", items: [[11, 1]] }, null, false], kwargs: null });
  await pilots.callMethod("ship", "LeaveShip", [SHIP], null, FIELDS, handle);
  assert.deepEqual(made(), { objectID: "N=1:2", method: "LeaveShip", args: [SHIP], kwargs: null });
  assert.equal(session.binds.length, 2, "one object for each service");
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
  // Moniker('corpRegistry', session.corpid): bound once, and both calls made on what it bound.
  assert.deepEqual(session.binds, [{ service: "corpRegistry", params: 1000044 }]);
  assert.deepEqual(session.boundCalls.map((call) => [call.objectID, call.method, call.args, call.kwargs]), [
    [session.boundCalls[0].objectID, "GetCorporation", [], null],
    [session.boundCalls[0].objectID, "GetShareholders", [98000001], null],
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
  // A ship's moniker is for the place, and goes with it; the registry's does not. (Another station, so the pilot stays docked.)
  const leave = () => pilots.callMethod("ship", "LeaveShip", [SHIP], null, FIELDS, handle);
  await leave();
  await leave();
  session.attributes.stationid = 60000004;
  session.change({ stationid: [STATION, 60000004] });
  await leave();
  await ask();
  assert.deepEqual(session.binds.map((bind) => [bind.service, bind.params]), [["corpRegistry", 1000044], ["ship", [STATION, 15]], ["ship", [60000004, 15]]]);
  // Another corporation: another registry.
  session.attributes.corpid = 98000001;
  session.change({ corpid: [1000044, 98000001] });
  await ask();
  assert.deepEqual(session.binds.filter((bind) => bind.service === "corpRegistry"), [{ service: "corpRegistry", params: 1000044 }, { service: "corpRegistry", params: 98000001 }]);
  const objects = session.boundCalls.filter((call) => call.method === "GetCorporation").map((call) => call.objectID);
  assert.equal(objects[0], objects[1]);
  assert.notEqual(objects[1], objects[2]);
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
  // Addressing a call is the transport's own business: the ledger counts the call as it was spelt.
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "contractProxy.GetLoginInfo").statuses, { same: 1 });
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

// A module fitted while the ship is held is told of by its inventory row (OnItemsChanged), and the client then
// puts it online itself where its type can be: clientDogmaLocation._OnlineModuleIfApplicable and OnlineModule.

const CAN_BE_ONLINE = 3009;
const fittedNow = (itemID, { typeID = CAN_BE_ONLINE, flagID = 30, locationID = SHIP } = {}) => [
  { type: "list", items: [{ type: "packedrow", header: null, columns: [], fields: { itemID, typeID, ownerID: PILOT, locationID, flagID, quantity: -1, groupID: 53, categoryID: 7, customInfo: "", stacksize: 1, singleton: 1 }, values: [] }] },
  { type: "dict", entries: [[3, STATION], [4, 4]] },
  null,
];
const onlineByType = { typeEffects: (typeID) => (typeID === CAN_BE_ONLINE ? [{ effectID: 11 }, { effectID: EFFECT_OF_BEING_ONLINE }] : [{ effectID: 11 }]) };
const toldOnline = (session) => session.boundCalls.filter((call) => call.method === "SetModuleOnline");

test("a module fitted while the ship is held is put online by the client itself: the server is told, and it is online from the moment it is fitted", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo() } }, onlineByType);
  assert.deepEqual((await pilots.shipInfo(FIELDS, handle)).online, [SHIP + 1]);
  session.calls.length = 0;
  session.notify("OnItemsChanged", fittedNow(SHIP + 9));
  assert.deepEqual((await pilots.shipInfo(FIELDS, handle)).online, [SHIP + 1, SHIP + 9]);
  // SetModuleOnline(the ship the module is in, the module), on the dogma location godma was primed from; nothing else was asked.
  const primedFrom = session.boundCalls.find((call) => call.method === "GetAllInfo").objectID;
  assert.deepEqual(toldOnline(session), [{ objectID: primedFrom, method: "SetModuleOnline", args: [SHIP, SHIP + 9], kwargs: null }]);
  assert.deepEqual([session.calls, session.boundCalls.filter((call) => call.method === "GetAllInfo").length], [[], 1]);
  assert.deepEqual(pilots.callLedger().find((row) => row.pair === "dogmaIM.SetModuleOnline").statuses, { same: 1 });
  // A module whose type cannot be online is fitted and no more: nothing is told, and it is not online.
  session.notify("OnItemsChanged", fittedNow(SHIP + 10, { typeID: 3010, flagID: 31 }));
  assert.deepEqual([(await pilots.shipInfo(FIELDS, handle)).online, toldOnline(session).length], [[SHIP + 1, SHIP + 9], 1]);
  // One godma holds already that moves to another slot is not fitted anew.
  session.notify("OnItemsChanged", fittedNow(SHIP + 9, { flagID: 32 }));
  session.notify("OnItemsChanged", fittedNow(SHIP + 2, { typeID: CAN_BE_ONLINE, flagID: 33 }));
  assert.deepEqual([(await pilots.shipInfo(FIELDS, handle)).online, toldOnline(session).length], [[SHIP + 1, SHIP + 9], 1]);
});

test("a server that has the module online already says so, and it is online; refused for any other reason, or not answered, it is not online after all", async () => {
  const outcome = async (answer) => {
    const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:SetModuleOnline": answer } }, onlineByType);
    await pilots.shipInfo(FIELDS, handle);
    session.notify("OnItemsChanged", fittedNow(SHIP + 9));
    return [(await pilots.shipInfo(FIELDS, handle)).online, toldOnline(session).length];
  };
  assert.deepEqual(await outcome(() => { throw refusedBy("EffectAlreadyActive2"); }), [[SHIP + 1, SHIP + 9], 1]);
  assert.deepEqual(await outcome(() => { throw refusedBy("NotEnoughCpu"); }), [[SHIP + 1], 1]);
  assert.deepEqual(await outcome(() => { throw new Error("no answer"); }), [[SHIP + 1], 1]);
});

test("a module is put online while the answer is awaited, and several fitted at once are told of one after another, in order", async () => {
  let answer;
  const waiting = new Promise((resolve) => { answer = resolve; });
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo(), "bound:SetModuleOnline": () => waiting } }, onlineByType);
  await pilots.shipInfo(FIELDS, handle);
  session.notify("OnItemsChanged", [{ type: "list", items: [...fittedNow(SHIP + 9)[0].items, ...fittedNow(SHIP + 8, { flagID: 31 })[0].items] }, { type: "dict", entries: [[3, STATION], [4, 4]] }, null]);
  // What the undock hands over is read as it stands: both are online now, with the server yet to answer for the first.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(toldOnline(session).map((call) => call.args), [[SHIP, SHIP + 9]]);
  const reading = pilots.shipInfo(FIELDS, handle);
  answer(null);
  assert.deepEqual((await reading).online, [SHIP + 1, SHIP + 9, SHIP + 8]);
  assert.deepEqual(toldOnline(session).map((call) => call.args), [[SHIP, SHIP + 9], [SHIP, SHIP + 8]]);
});

test("a module fitted to a ship the pilot is no longer in is not put online", async () => {
  const { pilots, session, handle } = await selected({ answers: { "bound:GetAllInfo": ownShipAllInfo() } }, onlineByType);
  await pilots.shipInfo(FIELDS, handle);
  // The session is in another ship; godma still holds the one before, until it is next read.
  session.attributes.shipid = 555;
  session.notify("OnItemsChanged", fittedNow(SHIP + 9));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(toldOnline(session), []);
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
