"use strict";

// The game-port transport for a selected pilot (src/gamePort/pilots.js),
// against a stand-in session. What it must match is the gateway client's
// contract: answers, the notification drain, the stream's frames, the error
// codes. test/pilotTransport.test.js covers how a call gets here at all; the
// loop log records the same functions run against the live server.

const test = require("node:test");
const assert = require("node:assert/strict");
const { GamePortPilotError, argumentsToWire, createGamePortPilots } = require("../src/gamePort/pilots");
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
    allowed: new Set(["station.GetGuests", "account.GetCashBalance", "corpRegistry.GetTitles", "dogmaIM.ShipGetInfo"]),
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

test("bound objects are refused for now, by name", async () => {
  const { pilots, handle } = await selected();
  await rejects(pilots.bindObject("invbroker", "GetInventory", [STATION], null, { userid: ACCOUNT }, handle), "PILOT_TRANSPORT_UNAVAILABLE", /invbroker\.GetInventory/);
  await rejects(pilots.callBoundMethod("invbroker", "List", [], null, { userid: ACCOUNT }, handle, "h"), "PILOT_TRANSPORT_UNAVAILABLE");
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
