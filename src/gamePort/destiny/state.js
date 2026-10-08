"use strict";

// The ballpark's state, as the server sends it: one binary blob.
//
// SetState, AddBalls and AddBalls2 each carry one, and the retail client hands
// all of them to the same reader in its simulation library (destiny). This is
// that reader, ported from CCP's source:
//
//   destiny/src/Thunkers.cpp   PyReadFullStateFromStream  (2083-2143)
//                              ReadFullStateFromStream    (2463-2507)
//                              ReadBallFromStream         (2897-3178)
//   destiny/src/IDstConstants.h   the modes, the flags, the packet types
//
// docs/game-port-destiny-notes.md, section 2, sets the layout out as a table.
//
// The format has no version, no ball count and no length. It is one packet
// byte, a four-byte tick stamp, and then ball records until the bytes run
// out. Every field is the in-memory value copied out, so integers are
// little-endian two's complement and reals are IEEE-754, float32 or float64 as
// the C++ member is.
//
// A float32 field is read into a JS number, which holds it exactly. Anything
// computed from one has to be rounded back to float32 where the C++ stores a
// float; that is the simulation's business, not this reader's.
//
// This module only reads bytes into records. It knows nothing of time, and
// changes no ballpark.

/** IDstConstants.h, enum DSTBALLMODE. */
const MODE = Object.freeze({
  GOTO: 0,
  FOLLOW: 1,
  STOP: 2,
  WARP: 3,
  ORBIT: 4,
  MISSILE: 5,
  MUSHROOM: 6,
  BOID: 7,
  TROLL: 8,
  MINIBALL: 9,
  FIELD: 10,
  RIGID: 11,
  FORMATION: 12,
});
const MODE_NAME = Object.freeze(Object.fromEntries(Object.entries(MODE).map(([name, value]) => [value, name])));

/** IDstConstants.h, enum BALLFLAGS: one byte in a record. */
const FLAG = Object.freeze({
  FREE: 0x01,
  GLOBAL: 0x02,
  MASSIVE: 0x04,
  INTERACTIVE: 0x08,
  SPACE_JUNK: 0x10,
  HAS_MINI_BOXES: 0x20,
  HAS_MINI_BALLS: 0x40,
  HAS_MINI_CAPSULES: 0x80,
});

/** IDstConstants.h, enum DESTINYPACKETS. The two are read alike; what differs is what the caller does next. */
const PACKET = Object.freeze({ FULL_STATE: 0, BALLS: 1 });

class DestinyStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "DestinyStateError";
  }
}

/** A cursor over the blob that refuses to read past its end. */
function reader(buffer) {
  let at = 0;
  const take = (size, read) => {
    if (at + size > buffer.length) {
      throw new DestinyStateError(`The state ends inside a record: ${size} bytes wanted at ${at}, ${buffer.length - at} left.`);
    }
    const value = read(at);
    at += size;
    return value;
  };
  return {
    get at() { return at; },
    get left() { return buffer.length - at; },
    u8: () => take(1, (o) => buffer.readUInt8(o)),
    i8: () => take(1, (o) => buffer.readInt8(o)),
    u16: () => take(2, (o) => buffer.readUInt16LE(o)),
    i32: () => take(4, (o) => buffer.readInt32LE(o)),
    i64: () => take(8, (o) => buffer.readBigInt64LE(o)),
    f32: () => take(4, (o) => buffer.readFloatLE(o)),
    f64: () => take(8, (o) => buffer.readDoubleLE(o)),
    vector() {
      return { x: this.f64(), y: this.f64(), z: this.f64() };
    },
  };
}

/** An int64 as a number when a number holds it exactly (every item ID does), else as it is. */
const whole = (value) => (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value);

/**
 * One ball record (ReadBallFromStream). The fields are the C++ reader's, in its
 * order, with the defaults it gives a field the record does not carry.
 */
function readBall(r) {
  const ball = {
    id: whole(r.i64()),
    mode: r.u8(),
    radius: r.f32(),
    position: r.vector(),
    flags: r.u8(),
    // Defaults for what a record may leave out (Thunkers.cpp 2904-2920).
    mass: 1.0e34,
    isCloaked: 0,
    harmonic: -1,
    corporationID: -1,
    allianceID: -1,
    maxVelocity: 0,
    velocity: { x: 0, y: 0, z: 0 },
    agility: 1,
    speedFraction: 0,
  };
  if (ball.mode !== MODE.RIGID) {
    ball.mass = r.f64();
    ball.isCloaked = r.i8();
    ball.harmonic = whole(r.i64());
    ball.corporationID = r.i32();
    ball.allianceID = r.i32();
  }
  if (ball.flags & FLAG.FREE) {
    ball.maxVelocity = r.f32();
    ball.velocity = r.vector();
    ball.agility = r.f32();
    ball.speedFraction = r.f32();
    // With dynamical orientation there would be 36 more bytes here. The retail
    // client runs with it off, and the emulator writes none (notes, 0.1).
  }
  ball.formationID = r.i8();

  // The per-mode tail (Thunkers.cpp 3023-3109).
  switch (ball.mode) {
    case MODE.FOLLOW:
    case MODE.ORBIT:
      ball.followId = whole(r.i64());
      ball.followRange = r.f32();
      break;
    case MODE.FORMATION:
      ball.followId = whole(r.i64());
      ball.followRange = r.f32();
      ball.effectStamp = r.i32();
      break;
    case MODE.MISSILE:
      ball.followId = whole(r.i64());
      ball.followRange = r.f32();
      ball.ownerId = whole(r.i64());
      ball.effectStamp = r.i32();
      ball.goto = r.vector();
      break;
    case MODE.GOTO:
      ball.goto = r.vector();
      break;
    case MODE.WARP:
      ball.goto = r.vector(); // where the warp ends
      ball.effectStamp = r.i32(); // the tick the warp began; negative while still aligning
      ball.totalWarpLength = r.f64(); // C++ keeps this in mLastCollision
      ball.minRange = r.f64(); // C++ reads these eight bytes into the integer mFollowId
      ball.warpFactor = whole(r.i64()); // C++ keeps this in mOwnerId
      break;
    case MODE.MUSHROOM:
      ball.followRange = r.f32();
      ball.span = r.f64(); // C++ keeps this in mGoto.x
      ball.effectStamp = r.i32();
      ball.ownerId = whole(r.i64());
      break;
    case MODE.TROLL:
      ball.effectStamp = r.i32();
      break;
    case MODE.STOP:
    case MODE.FIELD:
    case MODE.RIGID:
      break;
    default:
      // The C++ logs "Unknown ball mode" and stops reading balls there.
      throw new DestinyStateError(`Unknown ball mode ${ball.mode} for ball ${ball.id} at byte ${r.at}.`);
  }

  // Collision sub-shapes, each a count and then its items, offsets from the ball.
  ball.miniBalls = [];
  ball.miniCapsules = [];
  ball.miniBoxes = [];
  if (ball.flags & FLAG.HAS_MINI_BALLS) {
    for (let count = r.u16(); count > 0; count -= 1) ball.miniBalls.push({ center: r.vector(), radius: r.f32() });
  }
  if (ball.flags & FLAG.HAS_MINI_CAPSULES) {
    for (let count = r.u16(); count > 0; count -= 1) ball.miniCapsules.push({ a: r.vector(), b: r.vector(), radius: r.f32() });
  }
  if (ball.flags & FLAG.HAS_MINI_BOXES) {
    for (let count = r.u16(); count > 0; count -= 1) ball.miniBoxes.push({ corner: r.vector(), x: r.vector(), y: r.vector(), z: r.vector() });
  }
  return ball;
}

/**
 * A state blob: { packet, stamp, balls }.
 *
 * `stamp` is the tick the writer was at. The client's reader sets its own
 * clock to it on every read, an AddBalls as much as a SetState.
 */
function readState(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const r = reader(buffer);
  if (r.left === 0) return { packet: null, stamp: null, balls: [] };
  const packet = r.u8();
  if (packet !== PACKET.FULL_STATE && packet !== PACKET.BALLS) {
    throw new DestinyStateError(`Unknown packet type ${packet}.`);
  }
  const stamp = r.i32();
  const balls = [];
  while (r.left > 0) balls.push(readBall(r));
  return { packet, stamp, balls };
}

/** The flags of a record, by name. */
function flagsOf(ball) {
  return {
    isFree: Boolean(ball.flags & FLAG.FREE),
    isGlobal: Boolean(ball.flags & FLAG.GLOBAL),
    isMassive: Boolean(ball.flags & FLAG.MASSIVE),
    isInteractive: Boolean(ball.flags & FLAG.INTERACTIVE),
    isSpaceJunk: Boolean(ball.flags & FLAG.SPACE_JUNK),
  };
}

module.exports = { DestinyStateError, FLAG, MODE, MODE_NAME, PACKET, flagsOf, readState };
