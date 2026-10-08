"use strict";

// test/fixtures/destinyUndock.json is what a real eve.js server sent a client
// that undocked, stopped and docked again on the game port
// (scripts/record-destiny.js). It is the material the ballpark is built
// against. These pin what is in it, read with the session's own notification
// reader, so that anything built on the recording starts from known ground.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const fixture = require("./fixtures/destinyUndock.json");
const { marshalDecode } = require("../src/gameProtocol/marshal");
const { TYPE, parsePacket } = require("../src/gamePort/packets");
const { readNotification } = require("../src/gamePort/session");

const text = (value) => (Buffer.isBuffer(value) ? value.toString("latin1") : value);

/** Every notification in the recording, in order, with when it arrived. */
function notifications() {
  const out = [];
  for (const frame of fixture.frames) {
    if (frame.from !== "server") continue;
    let payload = Buffer.from(frame.hex, "hex");
    // machoNet: anything that does not start "~" is zlib.
    if (payload[0] !== 0x7e) {
      try {
        payload = zlib.inflateSync(payload);
      } catch {
        continue; // the handshake's raw values
      }
    }
    let packet = null;
    try {
      packet = parsePacket(marshalDecode(payload));
    } catch {
      continue;
    }
    if (packet && packet.command === TYPE.NOTIFICATION) out.push({ atMs: frame.atMs, during: frame.during, ...readNotification(packet) });
  }
  return out;
}

/** The (stamp, name, args) events inside every DoDestinyUpdate, in order. */
function destinyEvents(all = notifications()) {
  const events = [];
  for (const notification of all.filter((entry) => entry.method === "DoDestinyUpdate")) {
    const [list, waitForBubble] = notification.args;
    for (const [stamp, [name, args]] of list.items) events.push({ stamp, name: text(name), args, waitForBubble, during: notification.during });
  }
  return events;
}

test("the recording is a whole undock, stop and dock, and the character ended docked", () => {
  assert.equal(fixture.docked, true);
  assert.ok(fixture.stationID > 0 && fixture.solarSystemID > 0 && fixture.shipID > 0);
  assert.deepEqual([...new Set(fixture.frames.map((frame) => frame.during))], [
    "connect", "login", "select", "undock", "enter space", "in space", "stop", "in space, stopped", "dock", "docked",
  ].filter((step) => fixture.frames.some((frame) => frame.during === step)));
  assert.ok(fixture.frames.every((frame) => Number.isInteger(frame.atMs) && frame.atMs >= 0));
});

test("it carries the notifications a client in space is sent", () => {
  const counts = {};
  for (const { method } of notifications()) counts[method] = (counts[method] ?? 0) + 1;
  assert.deepEqual(counts, fixture.notifications, "the tally the recorder made is what the frames hold");
  for (const name of ["DoDestinyUpdate", "DoSimClockRebase", "OnSetTimeDilation", "OnDockingAccepted", "OnDockingFinished", "OnMachoObjectDisconnect"]) {
    assert.ok(counts[name] >= 1, name);
  }
});

test("a DoDestinyUpdate is (a list of (stamp, (name, args)), waitForBubble)", () => {
  for (const notification of notifications().filter((entry) => entry.method === "DoDestinyUpdate")) {
    assert.equal(notification.args.length, 2);
    const [list, waitForBubble] = notification.args;
    assert.equal(list.type, "list");
    assert.equal(typeof waitForBubble, "boolean");
    for (const event of list.items) {
      assert.equal(event.length, 2);
      assert.equal(typeof event[0], "number", "a stamp");
      assert.equal(event[1].length, 2);
      assert.ok(Buffer.isBuffer(event[1][0]) || typeof event[1][0] === "string", "a name");
    }
  }
});

test("the events, in order: the ship is added, placed and sent on its way, then the grid's state, then the commands", () => {
  const events = destinyEvents();
  assert.deepEqual(events.map((event) => event.name), [
    "AddBalls2",
    "OnSpecialFX", "SetBallPosition", "SetBallMassive", "SetBallMass", "SetBallVelocity", "GotoDirection",
    "SetState",
    "SetBallAgility", "SetMaxSpeed",
    "AddBalls2",
    "Stop",
    "SetBallMassive", "Stop",
  ]);
  // Stamps never go backwards, and are whole seconds of the server's clock.
  const stamps = events.map((event) => event.stamp);
  assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
  assert.ok(stamps.every((stamp) => Number.isInteger(stamp) && stamp > 1_700_000_000 && stamp < 2_000_000_000));
  // Only the first update asks the client to wait for its bubble.
  assert.deepEqual([...new Set(events.filter((event) => event.waitForBubble).map((event) => event.name))], ["AddBalls2"]);
});

test("the movement events name the ship and carry plain numbers", () => {
  const events = destinyEvents();
  const of = (name) => events.find((event) => event.name === name).args;
  const ship = BigInt(fixture.shipID);
  const idOf = (args) => BigInt(args[0]);
  for (const name of ["SetBallPosition", "SetBallMassive", "SetBallMass", "SetBallVelocity", "GotoDirection", "SetBallAgility", "SetMaxSpeed", "Stop"]) {
    assert.equal(idOf(of(name)), ship, name);
  }
  const [, x, y, z] = of("SetBallPosition");
  assert.ok([x, y, z].every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 1e6), "a position in metres, far from the sun");
  const [, vx, vy, vz] = of("SetBallVelocity");
  const direction = of("GotoDirection").slice(1);
  const speed = Math.hypot(vx, vy, vz);
  assert.ok(speed > 0 && speed <= of("SetMaxSpeed")[1], "leaving the station no faster than the ship can go");
  // It is sent off the way it is already moving, and the direction is a unit vector.
  assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-9);
  for (const [index, component] of [vx, vy, vz].entries()) assert.ok(Math.abs(component / speed - direction[index]) < 1e-9);
  assert.ok(of("SetBallAgility")[1] > 0 && of("SetBallMass")[1] > 0);
});

test("the state arrives as binary blobs: one for the ship, one for the grid, one for what is added after", () => {
  const events = destinyEvents();
  const added = events.filter((event) => event.name === "AddBalls2");
  assert.equal(added.length, 2);
  for (const event of added) {
    const [[blob, slims]] = event.args;
    assert.ok(Buffer.isBuffer(blob) && blob.length > 0);
    assert.equal(slims.type, "list");
    assert.ok(slims.items.length >= 1);
  }
  assert.equal(added[0].args[0][1].items.length, 1, "the first is the ship alone");
  assert.ok(added[1].args[0][1].items.length > 1);

  const [state] = events.find((event) => event.name === "SetState").args;
  assert.equal(state.type, "object");
  assert.equal(text(state.name), "util.KeyVal");
  const fields = new Map(state.args.entries.map(([key, value]) => [text(key), value]));
  assert.ok(Buffer.isBuffer(fields.get("state")) && fields.get("state").length > 1000);
  assert.equal(BigInt(fields.get("ego")), BigInt(fixture.shipID));
  assert.equal(fields.get("stamp"), events.find((event) => event.name === "SetState").stamp);
  for (const name of ["damageState", "slims", "solItem", "effectStates", "allianceBridges", "droneState", "aggressors", "dbuffState"]) {
    assert.ok(fields.has(name), `SetState carries ${name}`);
  }
});

test("the clock is rebased and time dilation set before the first update", () => {
  const all = notifications();
  const names = all.map((entry) => entry.method);
  assert.ok(names.indexOf("DoSimClockRebase") < names.indexOf("DoDestinyUpdate"));
  assert.ok(names.indexOf("OnSetTimeDilation") < names.indexOf("DoDestinyUpdate"));
  const [[from, to]] = all.find((entry) => entry.method === "DoSimClockRebase").args;
  assert.equal(typeof from, "bigint");
  assert.ok(to >= from, "file times, the second not before the first");
  assert.deepEqual(all.find((entry) => entry.method === "OnSetTimeDilation").args, [1, 1, 100000000]);
});
