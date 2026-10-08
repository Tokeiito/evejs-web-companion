"use strict";

// src/gamePort/destiny/state.js reads the ballpark's state blob, ported from
// CCP's destiny (Thunkers.cpp, ReadBallFromStream). Three kinds of evidence:
//
//   - CCP's own byte fixtures (python/destiny/test/ballpark/test_stream_read_write.py);
//   - the three blobs a real server sent, in test/fixtures/destinyUndock.json,
//     checked against what the same recording says in plain numbers;
//   - records written here field by field from the C++ reader's order, for the
//     modes and shapes the recording does not hold. Those check this reader
//     against the layout as read from the source, not against a real blob;
//     a recording with a warp in it will add those.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const fixture = require("./fixtures/destinyUndock.json");
const { marshalDecode } = require("../src/gameProtocol/marshal");
const { TYPE, parsePacket } = require("../src/gamePort/packets");
const { readNotification } = require("../src/gamePort/session");
const { DestinyStateError, FLAG, MODE, MODE_NAME, PACKET, flagsOf, readState } = require("../src/gamePort/destiny/state");

const text = (value) => (Buffer.isBuffer(value) ? value.toString("latin1") : value);
const number = (value) => (typeof value === "bigint" ? Number(value) : value);

/** The (stamp, name, args) events inside every DoDestinyUpdate of the recording, in order. */
function destinyEvents() {
  const events = [];
  for (const frame of fixture.frames) {
    if (frame.from !== "server") continue;
    let payload = Buffer.from(frame.hex, "hex");
    if (payload[0] !== 0x7e) {
      try {
        payload = zlib.inflateSync(payload);
      } catch {
        continue;
      }
    }
    let packet = null;
    try {
      packet = parsePacket(marshalDecode(payload));
    } catch {
      continue;
    }
    if (!packet || packet.command !== TYPE.NOTIFICATION) continue;
    const notification = readNotification(packet);
    if (notification.method !== "DoDestinyUpdate") continue;
    for (const [stamp, [name, args]] of notification.args[0].items) events.push({ stamp, name: text(name), args });
  }
  return events;
}

const EVENTS = destinyEvents();
const argsOf = (name) => EVENTS.find((event) => event.name === name).args;
/** A slim item's fields, whether it came as a dict, a SlimItem object, or the first of a (slim, damage) pair. */
function slimFields(slim) {
  const item = Array.isArray(slim) ? slim[0] : slim;
  const dict = item.type === "object" ? item.args : item;
  return new Map(dict.entries.map(([key, value]) => [text(key), value]));
}
const keyValField = (keyVal, name) => (keyVal.args.entries.find(([key]) => text(key) === name) || [])[1];

/** The recording's three blobs: [the ship alone, the grid's state, what was added after]. */
function recordedBlobs() {
  const added = EVENTS.filter((event) => event.name === "AddBalls2");
  const state = EVENTS.find((event) => event.name === "SetState");
  return {
    ship: { stamp: added[0].stamp, blob: added[0].args[0][0], slims: added[0].args[0][1].items },
    grid: { stamp: state.stamp, blob: keyValField(state.args[0], "state"), slims: keyValField(state.args[0], "slims").items },
    later: { stamp: added[1].stamp, blob: added[1].args[0][0], slims: added[1].args[0][1].items },
  };
}

// ── CCP's own fixtures ───────────────────────────────────────────────────────

test("CCP's fixtures: an empty balls packet and an empty full state, at tick 0", () => {
  assert.deepEqual(readState(Buffer.from([0x01, 0, 0, 0, 0])), { packet: PACKET.BALLS, stamp: 0, balls: [] });
  assert.deepEqual(readState(Buffer.from([0x00, 0, 0, 0, 0])), { packet: PACKET.FULL_STATE, stamp: 0, balls: [] });
});

test("the modes and flags are destiny's own numbers", () => {
  assert.deepEqual(MODE, { GOTO: 0, FOLLOW: 1, STOP: 2, WARP: 3, ORBIT: 4, MISSILE: 5, MUSHROOM: 6, BOID: 7, TROLL: 8, MINIBALL: 9, FIELD: 10, RIGID: 11, FORMATION: 12 });
  assert.equal(MODE_NAME[4], "ORBIT"); // michelle.py hard-codes DESTINY_MODE_ORBIT = 4
  assert.deepEqual(FLAG, { FREE: 1, GLOBAL: 2, MASSIVE: 4, INTERACTIVE: 8, SPACE_JUNK: 16, HAS_MINI_BOXES: 32, HAS_MINI_BALLS: 64, HAS_MINI_CAPSULES: 128 });
});

// ── what a real server sent ──────────────────────────────────────────────────

test("each recorded blob reads to its last byte, with the stamp of the event that carried it", () => {
  const { ship, grid, later } = recordedBlobs();
  for (const [name, { stamp, blob }, packet, balls] of [["ship", ship, PACKET.BALLS, 1], ["grid", grid, PACKET.FULL_STATE, 76], ["later", later, PACKET.BALLS, 19]]) {
    const state = readState(blob);
    assert.equal(state.packet, packet, name);
    assert.equal(state.stamp, stamp, name);
    assert.equal(state.balls.length, balls, name);
  }
  assert.deepEqual([ship.blob.length, grid.blob.length, later.blob.length], [129, 3054, 1747]);
});

test("the ship's record says what the server then says about the ship in plain numbers", () => {
  const { ship } = recordedBlobs();
  const [ball] = readState(ship.blob).balls;
  assert.equal(ball.id, fixture.shipID);
  assert.equal(ball.mode, MODE.GOTO);
  assert.deepEqual(flagsOf(ball), { isFree: true, isGlobal: false, isMassive: false, isInteractive: true, isSpaceJunk: false });
  // SetBallPosition, SetBallVelocity, SetBallMass, SetMaxSpeed and SetBallAgility for the same ball, sent as doubles.
  const [, x, y, z] = argsOf("SetBallPosition");
  assert.deepEqual(ball.position, { x, y, z });
  const [, vx, vy, vz] = argsOf("SetBallVelocity");
  assert.deepEqual(ball.velocity, { x: vx, y: vy, z: vz });
  assert.equal(ball.mass, argsOf("SetBallMass")[1]);
  assert.equal(ball.maxVelocity, argsOf("SetMaxSpeed")[1]);
  // Agility is a float32 in the record: 4.35 to the nearest one.
  assert.equal(argsOf("SetBallAgility")[1], 4.35);
  assert.equal(ball.agility, Math.fround(4.35));
  assert.notEqual(ball.agility, 4.35);
  assert.equal(ball.speedFraction, 1);
  assert.equal(ball.radius, Math.fround(38.4), "a Reaper");
  assert.equal(ball.formationID, -1);
  assert.deepEqual([ball.isCloaked, ball.harmonic, ball.allianceID], [0, -1, 0]);
  // It is going where GotoDirection then sends it: the goto point lies along that direction from the ship.
  const direction = argsOf("GotoDirection").slice(1);
  const offset = [ball.goto.x - x, ball.goto.y - y, ball.goto.z - z];
  const length = Math.hypot(...offset);
  assert.ok(length > 1e9, "a point far ahead");
  for (const [index, component] of offset.entries()) assert.ok(Math.abs(component / length - direction[index]) < 1e-6);
  // And the slim item beside it names the same ball, with the pilot's corporation.
  const slim = slimFields(ship.slims[0]);
  assert.equal(number(slim.get("itemID")), ball.id);
  assert.equal(slim.get("corpID"), ball.corporationID);
});

test("every ball of the grid's state has its slim item, and the ship is among them as it was sent", () => {
  const { ship, grid } = recordedBlobs();
  const state = readState(grid.blob);
  assert.deepEqual(state.balls.map((ball) => ball.id).sort(), grid.slims.map((slim) => number(slimFields(slim).get("itemID"))).sort());
  assert.equal(new Set(state.balls.map((ball) => ball.id)).size, 76, "no ball twice");
  const counts = {};
  for (const ball of state.balls) counts[MODE_NAME[ball.mode]] = (counts[MODE_NAME[ball.mode]] ?? 0) + 1;
  assert.deepEqual(counts, { RIGID: 75, GOTO: 1 });

  const ego = state.balls.find((ball) => ball.id === fixture.shipID);
  const [alone] = readState(ship.blob).balls;
  // The state is stamped one tick after the ship was added, and the ship's
  // record in it is the same record, field for field: this server restamps the
  // ball where it was put, it does not send it a second's travel further on.
  assert.equal(grid.stamp, ship.stamp + 1);
  assert.deepEqual(ego, alone);
});

test("what does not move is rigid: no mass, corporation or velocity in its record, and destiny's defaults in their place", () => {
  const { grid } = recordedBlobs();
  const rigid = readState(grid.blob).balls.filter((ball) => ball.mode === MODE.RIGID);
  assert.equal(rigid.length, 75);
  for (const ball of rigid) {
    assert.deepEqual(
      [ball.mass, ball.isCloaked, ball.harmonic, ball.corporationID, ball.allianceID, ball.maxVelocity, ball.agility, ball.speedFraction, ball.velocity],
      [1.0e34, 0, -1, -1, -1, 0, 1, 0, { x: 0, y: 0, z: 0 }],
    );
    assert.equal(flagsOf(ball).isFree, false);
    assert.ok(ball.radius > 0);
  }
  // The station the pilot left is there, a rigid ball named by its slim item.
  const station = rigid.find((ball) => ball.id === fixture.stationID);
  assert.ok(station, "the station is a ball");
  const slim = slimFields(grid.slims.find((entry) => number(slimFields(entry).get("itemID")) === fixture.stationID));
  assert.match(text(slim.get("name")), /^Jita IV - Moon 4/);
  assert.deepEqual(flagsOf(station), { isFree: false, isGlobal: true, isMassive: true, isInteractive: false, isSpaceJunk: false });
});

test("the balls added after are the sentry guns and what stands by them, one slim item each", () => {
  const { later } = recordedBlobs();
  const state = readState(later.blob);
  assert.deepEqual(state.balls.map((ball) => ball.id).sort(), later.slims.map((slim) => number(slimFields(slim).get("itemID"))).sort());
  const counts = {};
  for (const ball of state.balls) counts[MODE_NAME[ball.mode]] = (counts[MODE_NAME[ball.mode]] ?? 0) + 1;
  assert.deepEqual(counts, { STOP: 17, RIGID: 2 });
  const stopped = state.balls.filter((ball) => ball.mode === MODE.STOP);
  assert.equal(stopped.filter((ball) => flagsOf(ball).isFree).length, 16);
  for (const ball of stopped.filter((entry) => flagsOf(entry).isFree)) {
    assert.deepEqual(ball.velocity, { x: 0, y: 0, z: 0 });
    assert.ok(ball.mass > 0 && ball.mass < 1e34);
  }
});

// ── records written from the layout ──────────────────────────────────────────

/** Bytes, appended to field by field as the C++ writer does. */
function writer() {
  const chunks = [];
  const put = (size, write) => { const b = Buffer.alloc(size); write(b); chunks.push(b); return api; };
  const api = {
    u8: (v) => put(1, (b) => b.writeUInt8(v)),
    i8: (v) => put(1, (b) => b.writeInt8(v)),
    u16: (v) => put(2, (b) => b.writeUInt16LE(v)),
    i32: (v) => put(4, (b) => b.writeInt32LE(v)),
    i64: (v) => put(8, (b) => b.writeBigInt64LE(BigInt(v))),
    f32: (v) => put(4, (b) => b.writeFloatLE(v)),
    f64: (v) => put(8, (b) => b.writeDoubleLE(v)),
    vec: (x, y, z) => api.f64(x).f64(y).f64(z),
    bytes: () => Buffer.concat(chunks),
  };
  return api;
}

/** A free ball's record up to and including formationID: 100 bytes. */
function freeHead(w, { id = 500, mode, flags = FLAG.FREE | FLAG.INTERACTIVE }) {
  return w.i64(id).u8(mode).f32(50).vec(1, 2, 3).u8(flags)
    .f64(1e6).i8(0).i64(-1).i32(98000001).i32(99000001)
    .f32(300).vec(10, 20, 30).f32(3.5).f32(0.5)
    .i8(-1);
}
const header = (packet = PACKET.BALLS, stamp = 1000) => writer().u8(packet).i32(stamp);
const only = (bytes) => {
  const state = readState(bytes);
  assert.equal(state.balls.length, 1);
  return state.balls[0];
};
const FREE_FIELDS = { radius: 50, position: { x: 1, y: 2, z: 3 }, mass: 1e6, isCloaked: 0, harmonic: -1, corporationID: 98000001, allianceID: 99000001, maxVelocity: 300, velocity: { x: 10, y: 20, z: 30 }, agility: 3.5, speedFraction: 0.5, formationID: -1 };

test("a record's tail is what its mode says, in destiny's order", () => {
  const tails = {
    [MODE.GOTO]: [(w) => w.vec(7, 8, 9), { goto: { x: 7, y: 8, z: 9 } }, 124],
    [MODE.FOLLOW]: [(w) => w.i64(60003760).f32(2500), { followId: 60003760, followRange: 2500 }, 112],
    [MODE.ORBIT]: [(w) => w.i64(60003760).f32(7500), { followId: 60003760, followRange: 7500 }, 112],
    [MODE.STOP]: [(w) => w, {}, 100],
    [MODE.FIELD]: [(w) => w, {}, 100],
    [MODE.TROLL]: [(w) => w.i32(990), { effectStamp: 990 }, 104],
    [MODE.FORMATION]: [(w) => w.i64(77).f32(100).i32(991), { followId: 77, followRange: 100, effectStamp: 991 }, 116],
    [MODE.MISSILE]: [(w) => w.i64(77).f32(40).i64(88).i32(992).vec(4, 5, 6), { followId: 77, followRange: 40, ownerId: 88, effectStamp: 992, goto: { x: 4, y: 5, z: 6 } }, 148],
    [MODE.MUSHROOM]: [(w) => w.f32(12).f64(34.5).i32(993).i64(88), { followRange: 12, span: 34.5, effectStamp: 993, ownerId: 88 }, 124],
    // Where it ends, when it began (negative while aligning), how far in all, how close to stop, how fast.
    [MODE.WARP]: [(w) => w.vec(1e12, 2e12, 3e12).i32(-1).f64(4.5e12).f64(15000).i64(3), { goto: { x: 1e12, y: 2e12, z: 3e12 }, effectStamp: -1, totalWarpLength: 4.5e12, minRange: 15000, warpFactor: 3 }, 152],
  };
  for (const [mode, [tail, fields, size]] of Object.entries(tails)) {
    const bytes = tail(freeHead(header(), { mode: Number(mode) })).bytes();
    assert.equal(bytes.length, 5 + size, `${MODE_NAME[mode]} is ${size} bytes`);
    const ball = only(bytes);
    assert.deepEqual(ball, { id: 500, mode: Number(mode), flags: 9, ...FREE_FIELDS, ...fields, miniBalls: [], miniCapsules: [], miniBoxes: [] }, MODE_NAME[mode]);
  }
});

test("a rigid ball is 39 bytes; a ball that is not free carries no velocity; either may be followed by another", () => {
  const rigid = (w, id) => w.i64(id).u8(MODE.RIGID).f32(1000).vec(1, 2, 3).u8(FLAG.GLOBAL | FLAG.MASSIVE).i8(-1);
  const fixedStop = (w, id) => w.i64(id).u8(MODE.STOP).f32(45).vec(4, 5, 6).u8(FLAG.INTERACTIVE).f64(5000).i8(1).i64(42).i32(7).i32(8).i8(3);
  const one = rigid(header(PACKET.FULL_STATE, 7), 40000001).bytes();
  assert.equal(one.length, 5 + 39);
  const three = fixedStop(rigid(fixedStop(header(), 1), 2), 3).bytes();
  assert.equal(three.length, 5 + 64 + 39 + 64);
  const { balls, stamp, packet } = readState(three);
  assert.deepEqual([packet, stamp, balls.map((ball) => [ball.id, ball.mode])], [PACKET.BALLS, 1000, [[1, 2], [2, 11], [3, 2]]]);
  assert.deepEqual(
    [balls[0].mass, balls[0].isCloaked, balls[0].harmonic, balls[0].corporationID, balls[0].allianceID, balls[0].formationID, balls[0].maxVelocity, balls[0].velocity],
    [5000, 1, 42, 7, 8, 3, 0, { x: 0, y: 0, z: 0 }],
  );
  assert.equal(readState(one).balls[0].mass, 1.0e34);
});

test("collision sub-shapes follow the tail: balls, then capsules, then boxes, each behind its count", () => {
  const flags = FLAG.GLOBAL | FLAG.HAS_MINI_BALLS | FLAG.HAS_MINI_CAPSULES | FLAG.HAS_MINI_BOXES;
  const w = header().i64(9).u8(MODE.RIGID).f32(10).vec(0, 0, 0).u8(flags).i8(-1);
  w.u16(2).vec(1, 2, 3).f32(4).vec(5, 6, 7).f32(8);
  w.u16(1).vec(1, 2, 3).vec(4, 5, 6).f32(7);
  w.u16(1).vec(1, 2, 3).vec(1, 0, 0).vec(0, 1, 0).vec(0, 0, 1);
  const ball = only(w.bytes());
  assert.deepEqual(ball.miniBalls, [{ center: { x: 1, y: 2, z: 3 }, radius: 4 }, { center: { x: 5, y: 6, z: 7 }, radius: 8 }]);
  assert.deepEqual(ball.miniCapsules, [{ a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 }, radius: 7 }]);
  assert.deepEqual(ball.miniBoxes, [{ corner: { x: 1, y: 2, z: 3 }, x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } }]);
  assert.equal(w.bytes().length, 5 + 39 + (2 + 2 * 28) + (2 + 52) + (2 + 96), "28, 52 and 96 bytes an item");
  // Only the shapes whose flag is set are there to read.
  const ballsOnly = only(header().i64(9).u8(MODE.RIGID).f32(10).vec(0, 0, 0).u8(FLAG.HAS_MINI_BALLS).i8(-1).u16(1).vec(1, 2, 3).f32(4).bytes());
  assert.deepEqual([ballsOnly.miniBalls.length, ballsOnly.miniCapsules.length, ballsOnly.miniBoxes.length], [1, 0, 0]);
});

test("each flag is its own bit, and the stamp is a signed int32", () => {
  const withFlags = (flags) => flagsOf(only(header().i64(9).u8(MODE.STOP).f32(1).vec(0, 0, 0).u8(flags).f64(1).i8(0).i64(-1).i32(-1).i32(-1).i8(-1).bytes()));
  const none = { isFree: false, isGlobal: false, isMassive: false, isInteractive: false, isSpaceJunk: false };
  assert.deepEqual(withFlags(0), none);
  assert.deepEqual(withFlags(FLAG.GLOBAL), { ...none, isGlobal: true });
  assert.deepEqual(withFlags(FLAG.MASSIVE), { ...none, isMassive: true });
  assert.deepEqual(withFlags(FLAG.INTERACTIVE), { ...none, isInteractive: true });
  assert.deepEqual(withFlags(FLAG.SPACE_JUNK), { ...none, isSpaceJunk: true });
  const free = flagsOf(only(freeHead(header(), { mode: MODE.STOP, flags: FLAG.FREE }).bytes()));
  assert.deepEqual(free, { ...none, isFree: true });
  // int32_t timestamp: a writer that has not started is at tick -1 or 0, and a late one past 2^31 would wrap.
  assert.equal(readState(header(PACKET.BALLS, -1).bytes()).stamp, -1);
  assert.equal(readState(header(PACKET.BALLS, 2147483647).bytes()).stamp, 2147483647);
});

test("an id too large for a number stays exact; a negative one is a number", () => {
  const big = only(header().i64(9007199254740993n).u8(MODE.RIGID).f32(1).vec(0, 0, 0).u8(0).i8(-1).bytes());
  assert.equal(big.id, 9007199254740993n);
  const local = only(header().i64(-1073741824).u8(MODE.RIGID).f32(1).vec(0, 0, 0).u8(0).i8(-1).bytes());
  assert.equal(local.id, -1073741824); // DSTLOCALBALLS
});

test("what cannot be a state is refused, and says where", () => {
  assert.deepEqual(readState(Buffer.alloc(0)), { packet: null, stamp: null, balls: [] });
  assert.throws(() => readState(Buffer.from([2, 0, 0, 0, 0])), (error) => error instanceof DestinyStateError && /Unknown packet type 2/.test(error.message));
  assert.throws(() => readState(Buffer.from([1, 0, 0])), /ends inside a record/);
  // BOID and MINIBALL are modes destiny's reader does not take; nor is 13.
  for (const mode of [MODE.BOID, MODE.MINIBALL, 13]) {
    const bytes = freeHead(header(), { mode }).bytes();
    assert.throws(() => readState(bytes), new RegExp(`Unknown ball mode ${mode} for ball 500`));
  }
  // A record cut short anywhere.
  const whole = freeHead(header(), { mode: MODE.GOTO }).vec(7, 8, 9).bytes();
  for (const cut of [6, 13, 40, 105, 128]) {
    assert.throws(() => readState(whole.subarray(0, cut)), /ends inside a record/, `cut at ${cut}`);
  }
  assert.equal(readState(whole).balls.length, 1);
  // Taking bytes that are not a Buffer.
  assert.equal(readState(new Uint8Array(whole)).balls[0].id, 500);
});

// ── the writer ───────────────────────────────────────────────────────────────

const { writeState } = require("../src/gamePort/destiny/state");

test("writing back what was read gives the server's own bytes, for all three recorded blobs", () => {
  const { ship, grid, later } = recordedBlobs();
  for (const [name, { blob }] of [["ship", ship], ["grid", grid], ["later", later]]) {
    assert.ok(writeState(readState(blob)).equals(blob), `${name}: ${blob.length} bytes, the same`);
  }
});

test("CCP's fixtures, written: an empty balls packet and an empty full state", () => {
  assert.deepEqual([...writeState({ packet: PACKET.BALLS, stamp: 0, balls: [] })], [0x01, 0, 0, 0, 0]);
  assert.deepEqual([...writeState({ packet: PACKET.FULL_STATE, stamp: 0, balls: [] })], [0x00, 0, 0, 0, 0]);
});

test("every mode and every sub-shape writes as it reads", () => {
  const tails = [
    [MODE.GOTO, (w) => w.vec(7, 8, 9)],
    [MODE.FOLLOW, (w) => w.i64(60003760).f32(2500)],
    [MODE.ORBIT, (w) => w.i64(60003760).f32(7500)],
    [MODE.STOP, (w) => w],
    [MODE.FIELD, (w) => w],
    [MODE.TROLL, (w) => w.i32(990)],
    [MODE.FORMATION, (w) => w.i64(77).f32(100).i32(991)],
    [MODE.MISSILE, (w) => w.i64(77).f32(40).i64(88).i32(992).vec(4, 5, 6)],
    [MODE.MUSHROOM, (w) => w.f32(12).f64(34.5).i32(993).i64(88)],
    [MODE.WARP, (w) => w.vec(1e12, 2e12, 3e12).i32(-1).f64(4.5e12).f64(15000).i64(3)],
  ];
  for (const [mode, tail] of tails) {
    const bytes = tail(freeHead(header(PACKET.BALLS, 77), { mode })).bytes();
    assert.ok(writeState(readState(bytes)).equals(bytes), MODE_NAME[mode]);
  }
  const flags = FLAG.GLOBAL | FLAG.HAS_MINI_BALLS | FLAG.HAS_MINI_CAPSULES | FLAG.HAS_MINI_BOXES;
  const shaped = header().i64(9).u8(MODE.RIGID).f32(10).vec(0, 0, 0).u8(flags).i8(-1)
    .u16(2).vec(1, 2, 3).f32(4).vec(5, 6, 7).f32(8)
    .u16(1).vec(1, 2, 3).vec(4, 5, 6).f32(7)
    .u16(1).vec(1, 2, 3).vec(1, 0, 0).vec(0, 1, 0).vec(0, 0, 1).bytes();
  assert.ok(writeState(readState(shaped)).equals(shaped));
  const rigid = header(PACKET.FULL_STATE, 7).i64(40000001).u8(MODE.RIGID).f32(1000).vec(1, 2, 3).u8(FLAG.GLOBAL | FLAG.MASSIVE).i8(-1).bytes();
  assert.ok(writeState(readState(rigid)).equals(rigid));
});

test("the sub-shape flags are written from what the record holds, not from what it claims", () => {
  // The writer sets a flag only when the list is non-empty, so a count of zero is never written.
  const [ball] = readState(header().i64(9).u8(MODE.RIGID).f32(10).vec(0, 0, 0).u8(FLAG.HAS_MINI_BALLS).i8(-1).u16(1).vec(1, 2, 3).f32(4).bytes()).balls;
  const emptied = writeState({ packet: PACKET.BALLS, stamp: 1000, balls: [{ ...ball, miniBalls: [] }] });
  assert.equal(emptied.length, 5 + 39);
  assert.equal(readState(emptied).balls[0].flags & FLAG.HAS_MINI_BALLS, 0);
  const added = writeState({ packet: PACKET.BALLS, stamp: 1000, balls: [{ ...ball, flags: 0, miniBalls: ball.miniBalls }] });
  assert.equal(readState(added).balls[0].flags, FLAG.HAS_MINI_BALLS);
});

test("a mode that has no record cannot be written", () => {
  const [ball] = readState(freeHead(header(), { mode: MODE.STOP }).bytes()).balls;
  assert.throws(() => writeState({ packet: PACKET.BALLS, stamp: 1, balls: [{ ...ball, mode: MODE.BOID }] }), /cannot be written/);
});
