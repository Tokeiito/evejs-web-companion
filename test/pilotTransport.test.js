"use strict";

// The seam the game port goes in behind (src/pilotTransport.js): each of the
// pilot's nine functions reaches the transport that holds its session, and
// nothing else changes.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACCOUNT_SERVICES,
  GAME_PORT_HANDLE_PREFIX,
  PILOT_FUNCTIONS,
  createPilotTransport,
  isGamePortHandle,
  pilotTransportSetting,
} = require("../src/pilotTransport");
const eveGatewayClient = require("../src/eveGatewayClient");

/** A transport that records what reached it and answers with its own name. */
function recorder(label, names = Object.keys(PILOT_FUNCTIONS)) {
  const calls = [];
  const transport = { calls };
  for (const name of names) {
    transport[name] = function (...args) {
      calls.push({ name, args, self: this });
      return name === "selectCharacter"
        ? { bridgeSessionID: label === "gameport" ? `${GAME_PORT_HANDLE_PREFIX}abc` : "Zm9vYmFy", via: label }
        : { via: label };
    };
  }
  return transport;
}

const GP = `${GAME_PORT_HANDLE_PREFIX}abc`;
const GW = "Zm9vYmFyLWJhel9xdXV4"; // what a gateway handle looks like: base64url, no colon

/** One call of each handle-routed function, with the handle where that function takes it. */
const callWith = (transport, handle) => ({
  callMethod: () => transport.callMethod("corpRegistry", "GetTitles", [], null, { userid: 4 }, handle),
  bindObject: () => transport.bindObject("invbroker", "GetInventory", [10004], null, { userid: 4 }, handle),
  callBoundMethod: () => transport.callBoundMethod("invbroker", "List", [], null, { userid: 4 }, handle, "bound-1"),
  releaseBridgeSession: () => transport.releaseBridgeSession(handle, { userid: 4 }),
  readFlightStatus: () => transport.readFlightStatus(handle, { userid: 4 }),
  readScannerState: () => transport.readScannerState(handle, { userid: 4 }),
  readSpaceSnapshot: () => transport.readSpaceSnapshot(handle, { userid: 4 }),
  openSessionEventStream: () => transport.openSessionEventStream({ bridgeSessionID: handle, userid: 4 }),
});

test("the pilot interface is the gateway client's own nine functions", () => {
  for (const name of Object.keys(PILOT_FUNCTIONS)) {
    assert.equal(typeof eveGatewayClient[name], "function", `${name} is a function of the gateway client`);
  }
  assert.equal(Object.keys(PILOT_FUNCTIONS).length, 9);
});

test("with no game port, the gateway client comes back untouched", () => {
  const gateway = recorder("gateway");
  assert.equal(createPilotTransport({ gateway }), gateway);
  assert.equal(createPilotTransport({ gateway, gamePort: null, transportFor: () => "gameport" }), gateway);
});

test("a game-port handle reaches the game port, with the same arguments, for every function", () => {
  const [gateway, gamePort] = [recorder("gateway"), recorder("gameport")];
  const transport = createPilotTransport({ gateway, gamePort });
  for (const [name, call] of Object.entries(callWith(transport, GP))) {
    assert.deepEqual(call(), { via: "gameport" }, name);
  }
  assert.equal(gateway.calls.length, 0);
  assert.deepEqual(gamePort.calls.map((call) => call.name), Object.keys(callWith(transport, GP)));
  assert.deepEqual(gamePort.calls[0].args, ["corpRegistry", "GetTitles", [], null, { userid: 4 }, GP]);
  assert.deepEqual(gamePort.calls[2].args, ["invbroker", "List", [], null, { userid: 4 }, GP, "bound-1"]);
  assert.equal(gamePort.calls[0].self, gamePort, "called as a method of its own transport");
});

test("a gateway handle, or none, reaches the gateway", () => {
  const [gateway, gamePort] = [recorder("gateway"), recorder("gameport")];
  const transport = createPilotTransport({ gateway, gamePort, transportFor: () => "gameport" });
  for (const [name, call] of Object.entries(callWith(transport, GW))) {
    assert.deepEqual(call(), { via: "gateway" }, name);
  }
  // A call with no held session is an account-level one: the gateway's, always.
  assert.deepEqual(transport.callMethod("charUnboundMgr", "GetCharacterSelectionData", [], null, { userid: 4 }), { via: "gateway" });
  assert.deepEqual(transport.callMethod("charUnboundMgr", "GetCharacterSelectionData", [], null, { userid: 4 }, undefined), { via: "gateway" });
  assert.equal(gamePort.calls.length, 0);
  assert.equal(gateway.calls[0].self, gateway);
});

test("select goes where the setting says, and is told who is asking", () => {
  const [gateway, gamePort] = [recorder("gateway"), recorder("gameport")];
  const asked = [];
  const transport = createPilotTransport({
    gateway,
    gamePort,
    transportFor(who) {
      asked.push(who);
      return who.userName === "test" ? "gameport" : "gateway";
    },
  });
  const viaGamePort = transport.selectCharacter([140000001, null, true], null, { userid: 4, userName: "test" });
  const viaGateway = transport.selectCharacter([140000005, null, true], null, { userid: 9, userName: "someone" });
  assert.equal(viaGamePort.via, "gameport");
  assert.equal(viaGateway.via, "gateway");
  assert.ok(isGamePortHandle(viaGamePort.bridgeSessionID));
  assert.ok(!isGamePortHandle(viaGateway.bridgeSessionID));
  assert.deepEqual(asked, [
    { accountID: 4, characterID: 140000001, userName: "test" },
    { accountID: 9, characterID: 140000005, userName: "someone" },
  ]);
  assert.deepEqual(gamePort.calls[0].args, [[140000001, null, true], null, { userid: 4, userName: "test" }]);
});

test("everything that is not a pilot's goes to the gateway, as it is", () => {
  const gateway = { ...recorder("gateway"), getAccount: () => "account", version: 7 };
  const gamePort = { ...recorder("gameport"), getAccount: () => "never" };
  const transport = createPilotTransport({ gateway, gamePort });
  assert.equal(transport.getAccount, gateway.getAccount);
  assert.equal(transport.getAccount("test"), "account");
  assert.equal(transport.version, 7);
  assert.equal(transport.createChatSession, undefined);
});

test("a function the gateway lacks stays absent unless the game port has it", () => {
  // Fake gateways in the suite leave functions out, and src/server.js asks
  // `typeof gateway.readSpaceSnapshot === "function"` before using one.
  const gateway = recorder("gateway", ["callMethod", "selectCharacter"]);
  const neither = createPilotTransport({ gateway, gamePort: recorder("gameport", ["callMethod"]) });
  assert.equal(neither.readSpaceSnapshot, undefined);
  assert.equal("readSpaceSnapshot" in neither, false);
  assert.equal(typeof neither.callMethod, "function");

  const onlyGamePort = createPilotTransport({ gateway, gamePort: recorder("gameport", ["callMethod", "readFlightStatus"]) });
  assert.equal(typeof onlyGamePort.readFlightStatus, "function");
  assert.equal("readFlightStatus" in onlyGamePort, true);
  assert.deepEqual(onlyGamePort.readFlightStatus(GP, { userid: 4 }), { via: "gameport" });
  assert.throws(() => onlyGamePort.readFlightStatus(GW, { userid: 4 }), { code: "PILOT_TRANSPORT_UNAVAILABLE" });
});

test("the same function object is handed out each time", () => {
  const transport = createPilotTransport({ gateway: recorder("gateway"), gamePort: recorder("gameport") });
  assert.equal(transport.callMethod, transport.callMethod);
});

test("what makes a handle a game-port handle", () => {
  assert.equal(isGamePortHandle(GP), true);
  assert.equal(isGamePortHandle(GW), false);
  assert.equal(isGamePortHandle(""), false);
  assert.equal(isGamePortHandle(undefined), false);
  assert.equal(isGamePortHandle(null), false);
  assert.equal(isGamePortHandle(12), false);
  // The gateway mints base64url, which has no colon, so the two cannot be confused.
  assert.equal(/^[A-Za-z0-9_-]+$/.test(GAME_PORT_HANDLE_PREFIX), false);
});

test("the setting: the game port unless told otherwise, with single accounts overridden", () => {
  // Nothing said, or said empty (as a compose file passes on a variable that is not set): the game port.
  assert.equal(pilotTransportSetting({}).transportFor({ userName: "test" }), "gameport");
  assert.equal(pilotTransportSetting({}).fallback, "gameport");
  assert.equal(pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: "", EVEJS_PILOT_TRANSPORT_OVERRIDES: "" }).transportFor({ userName: "test" }), "gameport");
  assert.equal(pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: "gameport" }).transportFor({ userName: "test" }), "gameport");
  assert.equal(pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: " GamePort " }).transportFor({}), "gameport");
  // The way back: the gateway, for everybody.
  assert.equal(pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: "gateway" }).transportFor({ userName: "test" }), "gateway");
  assert.equal(pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: " GateWay " }).transportFor({}), "gateway");
  assert.equal(pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: "gateway" }).fallback, "gateway");

  const mixed = pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: "gateway", EVEJS_PILOT_TRANSPORT_OVERRIDES: "test=gameport, Test2 = gameport ,rrfarmer=gateway" });
  assert.equal(mixed.transportFor({ userName: "test" }), "gameport");
  assert.equal(mixed.transportFor({ userName: "TEST2" }), "gameport");
  assert.equal(mixed.transportFor({ userName: "rrfarmer" }), "gateway");
  assert.equal(mixed.transportFor({ userName: "anyone" }), "gateway");
  assert.equal(mixed.transportFor({}), "gateway");

  // With nothing said for the rest, an override is the one account that is not on the game port.
  const reversed = pilotTransportSetting({ EVEJS_PILOT_TRANSPORT_OVERRIDES: "rrfarmer=gateway" });
  assert.equal(reversed.transportFor({ userName: "rrfarmer" }), "gateway");
  assert.equal(reversed.transportFor({ userName: "test" }), "gameport");
  assert.equal(reversed.transportFor({}), "gameport");
});

test("a BFF started with nothing said holds its pilots on the game port; told the gateway, it has no game port at all", () => {
  const { createApp } = require("../src/server");
  const built = (env) => createApp({ bridgeSessionStore: new Map(), eveStore: {}, webAuth: { requireAuth: (req, res, next) => next() }, env });
  const transportOf = (app) => (app.locals.gamePortPilots ? "a game port" : "none");
  assert.equal(transportOf(built({})), "a game port");
  assert.equal(transportOf(built({ EVEJS_PILOT_TRANSPORT: "gameport" })), "a game port");
  assert.equal(transportOf(built({ EVEJS_PILOT_TRANSPORT: "gateway" })), "none");
  // One account sent to the game port is enough for there to be one; one sent to the gateway leaves it for the rest.
  assert.equal(transportOf(built({ EVEJS_PILOT_TRANSPORT: "gateway", EVEJS_PILOT_TRANSPORT_OVERRIDES: "test=gameport" })), "a game port");
  assert.equal(transportOf(built({ EVEJS_PILOT_TRANSPORT_OVERRIDES: "rrfarmer=gateway" })), "a game port");
  assert.equal(transportOf(built({ EVEJS_PILOT_TRANSPORT: "gateway", EVEJS_PILOT_TRANSPORT_OVERRIDES: "rrfarmer=gateway" })), "none");
  // A setting that is not a transport stops the BFF being built.
  assert.throws(() => built({ EVEJS_PILOT_TRANSPORT: "tcp" }), /EVEJS_PILOT_TRANSPORT must be/);
});

test("a setting that is not a transport is refused at start-up, not guessed at", () => {
  assert.throws(() => pilotTransportSetting({ EVEJS_PILOT_TRANSPORT: "tcp" }), /EVEJS_PILOT_TRANSPORT must be/);
  assert.throws(() => pilotTransportSetting({ EVEJS_PILOT_TRANSPORT_OVERRIDES: "test=tcp" }), /for "test" must be/);
  assert.throws(() => pilotTransportSetting({ EVEJS_PILOT_TRANSPORT_OVERRIDES: "test" }), /is not name=transport/);
  assert.throws(() => pilotTransportSetting({ EVEJS_PILOT_TRANSPORT_OVERRIDES: "test=gameport=x" }), /is not name=transport/);
  assert.throws(() => pilotTransportSetting({ EVEJS_PILOT_TRANSPORT_OVERRIDES: "=gameport" }), /is not name=transport/);
});

// ── the account's own calls ──────────────────────────────────────────────────

const byName = ({ userName }) => (userName === "test" ? "gameport" : "gateway");
const withAccountCall = () => recorder("gameport", [...Object.keys(PILOT_FUNCTIONS), "accountCall"]);

test("the account's own call goes where the account is", () => {
  const gateway = recorder("gateway");
  const gamePort = withAccountCall();
  const asked = [];
  const seam = createPilotTransport({ gateway, gamePort, transportFor: (who) => { asked.push(who); return byName(who); } });

  assert.deepEqual(seam.accountCall("charUnboundMgr", "GetCharCreationInfo", [], null, { accountID: 4, userName: "test" }), { via: "gameport" });
  assert.deepEqual(asked, [{ accountID: 4, characterID: null, userName: "test" }]);
  assert.deepEqual(gamePort.calls.map((call) => [call.name, call.args]), [
    ["accountCall", ["charUnboundMgr", "GetCharCreationInfo", [], null, { userid: 4, userName: "test" }]],
  ]);
  assert.equal(gamePort.calls[0].self, gamePort);
  assert.equal(gateway.calls.length, 0);
});

test("for an account on the gateway it is the gateway's call, on a session that names the account and nothing else", () => {
  const gateway = recorder("gateway");
  const gamePort = withAccountCall();
  const seam = createPilotTransport({ gateway, gamePort, transportFor: byName });

  assert.deepEqual(seam.accountCall("charUnboundMgr", "CreateCharacterWithDoll", ["A Name", 2, 1, 8, null, null, 0], { a: 1 }, { accountID: 9, userName: "rrfarmer" }), { via: "gateway" });
  assert.deepEqual(gateway.calls.map((call) => [call.name, call.args]), [
    // No login name, and no session handle: exactly what the BFF sent before there was a game port.
    ["callMethod", ["charUnboundMgr", "CreateCharacterWithDoll", ["A Name", 2, 1, 8, null, null, 0], { a: 1 }, { userid: 9 }]],
  ]);
  assert.equal(gateway.calls[0].self, gateway);
  assert.equal(gamePort.calls.length, 0);
});

test("only what the retail client asks before a character is chosen is asked for an account on the game port; the rest is refused, and nobody is asked", async () => {
  assert.deepEqual([...ACCOUNT_SERVICES], ["charUnboundMgr"]);
  const gateway = recorder("gateway");
  const gamePort = withAccountCall();
  const seam = createPilotTransport({ gateway, gamePort, transportFor: byName });
  // A pilot's call with no pilot chosen: the retail client has none to make, and the gateway is not asked to make it as nobody.
  const refused = seam.accountCall("corpRegistry", "GetTitles", [], null, { accountID: 4, userName: "test", fields: { languageID: "DE" } });
  assert.ok(refused instanceof Promise, "refused as a failed call is, not thrown at the caller");
  await assert.rejects(refused, (error) => {
    // The web gateway's own code and status for a call it refuses.
    assert.deepEqual([error.code, error.statusCode], ["CALL_NOT_ALLOWED", 403]);
    assert.match(error.message, /^corpRegistry\.GetTitles needs a pilot/);
    return true;
  });
  assert.deepEqual([gateway.calls.length, gamePort.calls.length], [0, 0]);
  // The same from an account on the gateway is the gateway's to answer, as it was.
  assert.deepEqual(seam.accountCall("corpRegistry", "GetTitles", [], null, { accountID: 9, userName: "rrfarmer", fields: { languageID: "DE" } }), { via: "gateway" });
  assert.deepEqual(gateway.calls.map((call) => [call.name, call.args]), [["callMethod", ["corpRegistry", "GetTitles", [], null, { languageID: "DE", userid: 9 }]]]);
  assert.equal(gamePort.calls.length, 0);
});

test("with a game port that cannot make an account's call, the account is the gateway's for everything", () => {
  const gateway = recorder("gateway");
  const seam = createPilotTransport({ gateway, gamePort: recorder("gameport"), transportFor: () => "gameport" });
  assert.deepEqual(seam.accountCall("corpRegistry", "GetTitles", [], null, { accountID: 4, userName: "test" }), { via: "gateway" });
  assert.deepEqual(gateway.calls.map((call) => [call.name, call.args]), [["callMethod", ["corpRegistry", "GetTitles", [], null, { userid: 4 }]]]);
});

test("a game port that cannot make the account's call leaves it to the gateway", () => {
  const gateway = recorder("gateway");
  const gamePort = recorder("gameport");
  const seam = createPilotTransport({ gateway, gamePort, transportFor: () => "gameport" });
  assert.deepEqual(seam.accountCall("charUnboundMgr", "GetCharCreationInfo", [], null, { accountID: 4, userName: "test" }), { via: "gateway" });
  assert.equal(gamePort.calls.length, 0);
});

test("the account's call is handed on as it was given, and nobody is not on the game port", () => {
  const gateway = recorder("gateway");
  const gamePort = withAccountCall();
  const asked = [];
  const seam = createPilotTransport({ gateway, gamePort, transportFor: (who) => { asked.push(who); return "gateway"; } });
  seam.accountCall("charUnboundMgr", "GetCharCreationInfo");
  assert.deepEqual(asked, [{ accountID: null, characterID: null, userName: "" }]);
  // What is left out is left out: each transport has its own defaults, as it had before there was a seam.
  assert.deepEqual(gateway.calls[0].args, ["charUnboundMgr", "GetCharCreationInfo", undefined, undefined, { userid: null }]);
});

test("the seam has the account's call only when there is a game port", () => {
  const gateway = recorder("gateway");
  const seam = createPilotTransport({ gateway, gamePort: withAccountCall(), transportFor: byName });
  assert.equal("accountCall" in seam, true);
  assert.equal(typeof seam.accountCall, "function");
  assert.equal(seam.accountCall, seam.accountCall, "the same function each time");
  // With none, the gateway client is what comes back, and it has no such function: the BFF calls it as it always did.
  assert.equal("accountCall" in createPilotTransport({ gateway }), false);
  assert.equal(createPilotTransport({ gateway }).accountCall, undefined);
});

test("what the browser asks to be shown goes with the account's call to the gateway, and never names another account", () => {
  const gateway = recorder("gateway");
  const gamePort = withAccountCall();
  const seam = createPilotTransport({ gateway, gamePort, transportFor: byName });
  seam.accountCall("charUnboundMgr", "GetCharacterSelectionData", [], null, { accountID: 9, userName: "rrfarmer", fields: { languageID: "DE", userid: 999 } });
  assert.deepEqual(gateway.calls[0].args, ["charUnboundMgr", "GetCharacterSelectionData", [], null, { languageID: "DE", userid: 9 }]);
  // The game port logs in as the client does and is told who, and nothing of the browser's.
  seam.accountCall("charUnboundMgr", "GetCharacterSelectionData", [], null, { accountID: 4, userName: "test", fields: { languageID: "DE" } });
  assert.deepEqual(gamePort.calls[0].args, ["charUnboundMgr", "GetCharacterSelectionData", [], null, { userid: 4, userName: "test" }]);
  // Fields that are not an object are no fields.
  seam.accountCall("charUnboundMgr", "GetCharacterSelectionData", [], null, { accountID: 9, userName: "rrfarmer", fields: "languageID" });
  assert.deepEqual(gateway.calls[1].args[4], { userid: 9 });
});

// ── which transport a pilot would be selected on ─────────────────────────────

test("the seam says which transport a pilot would be chosen on, and a process with no game port has no such question", () => {
  const asked = [];
  const seam = createPilotTransport({ gateway: recorder("gateway"), gamePort: withAccountCall(), transportFor: (who) => { asked.push(who); return byName(who); } });
  assert.equal(seam.getSelectTransport({ accountID: 4, characterID: 140000001, userName: "test" }), "gameport");
  assert.equal(seam.getSelectTransport({ accountID: 9, characterID: 140000009, userName: "rrfarmer" }), "gateway");
  assert.deepEqual(asked, [{ accountID: 4, characterID: 140000001, userName: "test" }, { accountID: 9, characterID: 140000009, userName: "rrfarmer" }]);
  assert.equal("getSelectTransport" in seam, true);
  // Nothing of it reaches either transport.
  assert.equal(typeof createPilotTransport({ gateway: recorder("gateway") }).getSelectTransport, "undefined");
});
