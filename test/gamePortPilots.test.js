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
function fakeSession({ answers = {}, userid = ACCOUNT, loginError = null, comesOnline = true, inSpace = false } = {}) {
  const listeners = { notification: new Set(), sessionChange: new Set(), close: new Set() };
  const session = {
    attributes: {},
    calls: [],
    closed: false,
    logins: [],
    async login(userName, password) {
      session.logins.push([userName, password]);
      if (loginError) throw loginError;
      session.attributes.userid = userid;
      session.change({ userid: [null, userid] });
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
    boundCalls: [],
    objects: 0,
    onNotification(listener) { listeners.notification.add(listener); return () => listeners.notification.delete(listener); },
    onSessionChange(listener) { listeners.sessionChange.add(listener); return () => listeners.sessionChange.delete(listener); },
    onClose(listener) { listeners.close.add(listener); return () => listeners.close.delete(listener); },
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
      "entity.MachoBindObject", "beyonce.MachoBindObject", "scanMgr.GetSystemScanMgr",
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
  // The character's session change, and not the account's from the login before it.
  assert.deepEqual(outcome.notifications, [{
    kind: "sessionchange", service: null, method: "OnSessionChanged",
    args: [{ charid: [null, PILOT], stationid: [null, STATION] }], kwargs: null,
  }]);
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

test("select refuses a pilot in space, before the server brings it online", async () => {
  const built = build({ answers: { "charUnboundMgr.GetCharacterSelectionData": selectionData([characterRow({ stationID: null })]) } });
  await rejects(built.pilots.selectCharacter([PILOT, null, true], null, FIELDS), "PILOT_TRANSPORT_UNAVAILABLE", /in space/);
  assert.deepEqual(built.session.calls.map((call) => call.method), ["GetCharacterSelectionData"]);
  assert.equal(built.session.closed, true);
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
    "corpRegistry.GetTitles": () => { throw new Error("Cannot marshal value: object {\"bare\":1}"); },
    "dogmaIM.ShipGetInfo": () => { throw sessionError("GAME_CALL_REFUSED", "refused: RuntimeError", null); },
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
  assert.deepEqual(first.notifications, [
    { kind: "client", service: null, method: "OnItemsChanged", idType: "charid", args: [1, 2], kwargs: null },
    { kind: "service", service: "agentMgr", method: "OnAgentMissionChange", idType: null, args: ["offered", 3008416], kwargs: null },
  ]);
  assert.deepEqual((await pilots.callMethod("station", "GetGuests", [], null, { userid: ACCOUNT }, handle)).notifications, []);
  session.change({ shipid: [SHIP, 77] });
  assert.equal((await pilots.readFlightStatus(handle, { userid: ACCOUNT })).notifications[0].method, "OnSessionChanged");
  session.notify("OnX");
  assert.equal((await pilots.readSpaceSnapshot(handle, { userid: ACCOUNT })).notifications.length, 1);
  session.notify("OnY");
  assert.equal((await pilots.readScannerState(handle, { userid: ACCOUNT })).notifications.length, 1);
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

test("flight status while docked is the gateway's, with the ship's type from the server's own row", async () => {
  const { pilots, session, handle } = await selected();
  const { flight, notifications } = await pilots.readFlightStatus(handle, { userid: ACCOUNT });
  assert.deepEqual(flight, {
    inSpace: false, docked: true, solarSystemID: SYSTEM, stationID: STATION, structureID: null,
    shipID: SHIP, shipTypeID: 588, shipIsCapsule: false, shipMode: null, shipSpeedFraction: null,
  });
  assert.deepEqual(notifications, []);
  // Asked once per ship, not once per poll.
  await pilots.readFlightStatus(handle, { userid: ACCOUNT });
  await pilots.readFlightStatus(handle, { userid: ACCOUNT });
  assert.equal(session.calls.filter((call) => call.method === "ShipGetInfo").length, 1);
});

test("a capsule is a capsule by its group, and a new ship is asked about again", async () => {
  let info = shipInfo(670, 29);
  const { pilots, session, handle } = await selected({ answers: { "dogmaIM.ShipGetInfo": () => info } });
  assert.equal((await pilots.readFlightStatus(handle)).flight.shipIsCapsule, true);
  session.attributes.shipid = 555;
  info = { type: "dict", entries: [[555, keyVal([["invItem", { type: "packedrow", header: null, columns: [], fields: { typeID: 603, groupID: 25 }, values: [] }]])]] };
  const { flight } = await pilots.readFlightStatus(handle);
  assert.deepEqual([flight.shipID, flight.shipTypeID, flight.shipIsCapsule], [555, 603, false]);
  assert.equal(session.calls.filter((call) => call.method === "ShipGetInfo").length, 2);
});

test("a ship the server will not describe is reported unknown, never guessed, and asked about next time", async () => {
  let fails = true;
  const { pilots, handle } = await selected({ answers: { "dogmaIM.ShipGetInfo": () => { if (fails) throw sessionError("CALL_TIMEOUT"); return shipInfo(); } } });
  const { flight } = await pilots.readFlightStatus(handle);
  assert.deepEqual([flight.docked, flight.shipID, flight.shipTypeID, flight.shipIsCapsule], [true, SHIP, null, null]);
  fails = false;
  assert.equal((await pilots.readFlightStatus(handle)).flight.shipTypeID, 588);
});

test("flight status for a lost connection finds no session", async () => {
  const { pilots, handle } = await selected({ answers: { "dogmaIM.ShipGetInfo": () => { throw sessionError("CONNECTION_LOST"); } } });
  await rejects(pilots.readFlightStatus(handle), "SESSION_NOT_FOUND");
  assert.equal(pilots.size, 0);
});

test("docked, the space snapshot and the scanner are the gateway's docked answers", async () => {
  const { pilots, handle } = await selected({}, { now: () => 1234 });
  assert.deepEqual((await pilots.readSpaceSnapshot(handle, { userid: ACCOUNT })).space, {
    inSpace: false, solarSystemID: SYSTEM, shipID: SHIP, sampledAtMs: 1234, entities: [], ship: null,
  });
  assert.deepEqual((await pilots.readScannerState(handle, { userid: ACCOUNT })).scanner, {
    inSpace: false, solarSystemID: SYSTEM, shipID: SHIP, maxActiveProbes: 0, launcher: null, probes: [],
  });
});

test("a pilot that reaches space is reported in space, and what needs a ballpark refuses", async () => {
  const { pilots, session, handle } = await selected();
  delete session.attributes.stationid;
  session.attributes.solarsystemid = SYSTEM;
  const { flight } = await pilots.readFlightStatus(handle);
  assert.deepEqual([flight.inSpace, flight.docked, flight.stationID, flight.solarSystemID], [true, false, null, SYSTEM]);
  await rejects(pilots.readSpaceSnapshot(handle), "PILOT_TRANSPORT_UNAVAILABLE", /ballpark/);
  await rejects(pilots.readScannerState(handle), "PILOT_TRANSPORT_UNAVAILABLE", /ballpark/);
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
  const { pilots, handle } = await selected();
  const { boundHandle } = await pilots.bindObject("invbroker", "GetInventory", [STATION], null, WHO, handle);
  await pilots.callBoundMethod("invbroker", "GetCapacity", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "GetCapacity", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "List", [4], null, WHO, handle, boundHandle);
  await pilots.callBoundMethod("invbroker", "Add", [1, STATION], { flag: 5 }, WHO, handle, boundHandle);
  await pilots.callMethod("station", "GetGuests", [], null, WHO, handle);
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
    "station.GetGuests": { unchecked: 1 },
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

test("undocking is refused while this transport cannot fly, and never sent", async () => {
  const { pilots, session, handle } = await selected();
  const { boundHandle } = await pilots.bindObject("ship", "MachoBindObject", [[STATION, 15]], null, WHO, handle);
  await rejects(pilots.callBoundMethod("ship", "Undock", [SHIP, false], null, WHO, handle, boundHandle), "PILOT_TRANSPORT_UNAVAILABLE", /Undocking needs a ballpark/);
  assert.deepEqual(session.boundCalls, []);
  // Everything else on the ship's object goes through.
  await pilots.callBoundMethod("ship", "Board", [77], null, WHO, handle, boundHandle);
  assert.equal(session.boundCalls.at(-1).method, "Board");
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
