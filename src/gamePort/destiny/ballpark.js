"use strict";

// The ballpark: the simulation the retail client runs to know where things are.
//
// In space the server does not send positions. It sends each ball's state once
// and then the orders the ball is given; the client steps every ball itself,
// one tick a second, with CCP's simulation library, destiny. This is that
// library ported from CCP's open source (C:\...\destiny, MIT), so that the web
// client computes what the retail client computes.
//
//   destiny/src/Ballpark.cpp   Evolve (421), Integrate (751), EvolveBehaviorForBall (789),
//                              EvolveFollow (1066), EvolveOldStyleOrbit (1249),
//                              EvolveStop (1339), GotoThrust (1398), AddBall (3303),
//                              FollowBall (3879), Orbit (4007),
//                              the orders (4471-4650) and the setters (4652-5090)
//   destiny/src/Thunkers.cpp   reading a state into the park (2083, 2463, 2897) and
//                              writing the park out as one (2145, 2202, 3180)
//   destiny/src/Vector3d.h     the arithmetic, which is part of the result
//
// docs/game-port-destiny-notes.md is the map; this file is made from the source.
//
// EXACTNESS. The aim is the same bits. Three rules from the source decide them:
//
//   - radius, maxVelocity, agility, speedFraction and followRange are `float`
//     members. Every store rounds to float32 (Math.fround); every use promotes
//     back to double.
//   - A vector divided by a number is multiplied by its reciprocal.
//   - Integrate is evaluated as written. `p * k2 * ook2` is not `p`.
//
// CCP's own evolve tests give expected positions to the last digit, and
// test/destinyBallpark.test.js requires them exactly.
//
// PORTED SO FAR: the integrator, STOP, GOTO, FOLLOW and ORBIT (the old style,
// which is the library's default), adding and removing balls, the orders and
// setters those need, and reading and writing the state blob.
// NOT YET, and each stops here rather than be guessed at:
// WARP, MISSILE, FORMATION (evolve throws), collisions (counted
// in `unported.gradient`: a massive ball is stepped without them), orientation
// (yaw, pitch and roll do not move a ball), the spatial partition, moribund
// balls, trolls and mushrooms.

const { FLAG, MODE, MODE_NAME, PACKET, readState, writeState } = require("./state");

/** IDstConstants.h: ids below this are the client's own balls, and are not written into a state. */
const DSTLOCALBALLS = -1073741824;

// ── Vector3d.h ───────────────────────────────────────────────────────────────

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
/** v * c, and c * v, which the header defines as the same thing. */
const scale = (v, c) => ({ x: v.x * c, y: v.y * c, z: v.z * c });
/** v / c: `c = 1.0/c; return Vector3d(x*c, y*c, z*c)`. */
const divide = (v, c) => scale(v, 1.0 / c);
const lengthSq = (v) => v.x * v.x + v.y * v.y + v.z * v.z;
const length = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
/** Normalize(): a zero vector is returned as it is. */
function normalize(v) {
  let norm = length(v);
  if (norm === 0.0) return v;
  norm = 1.0 / norm;
  return { x: v.x * norm, y: v.y * norm, z: v.z * norm };
}
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** a x b, as Vector3d::Cross computes it. */
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

const f32 = Math.fround;

/** Ballpark.h 31. */
const AU = 0.1495978707e12;
/** Ballpark.cpp 70. */
const ORBITAL_PRECESSION = 0.001;
/** "(double)((int64_t)(x*10000000))/10000000": cut, not rounded, at seven decimals. */
const cutToSevenDecimals = (x) => Math.trunc(x * 10000000) / 10000000;
/** The low sixteen bits of a ball's id, which give each orbiter its own plane. */
const lowSixteenBits = (id) => Number(BigInt(id) & 0xffffn);

class DestinyNotPorted extends Error {
  constructor(what) {
    super(`${what} is not ported from destiny yet.`);
    this.name = "DestinyNotPorted";
  }
}

/** Ball::IsWarping (Ball.cpp 1895): in warp proper, not still aligning for it. */
const isWarping = (ball) => ball.mode === MODE.WARP && !(ball.effectStamp < 0);

/** The modes whose ball follows another (Ballpark.cpp 68). */
const FOLLOW_MODES = new Set([MODE.FOLLOW, MODE.ORBIT, MODE.MISSILE, MODE.FORMATION]);

/** Ball ids in the order a std::map<int64> keeps them. */
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Ballpark {
  /**
   * `tickInterval` is in milliseconds. The client sets it to
   * const.simulationTimeStep, 1000; the library's own default is the same.
   */
  constructor({ tickInterval = 1000, friction = 1000000.0 } = {}) {
    this.tickInterval = tickInterval;
    this.friction = friction;
    /** dt = mTickInterval * 0.001: the step, in seconds. */
    this.dt = tickInterval * 0.001;
    /** mCurrentTime: the tick counter. */
    this.currentTime = 0;
    this.balls = new Map();
    this.freeBalls = new Map();
    /** moribundBalls: removed from play, kept until their time is up. */
    this.moribundBalls = new Set();
    /** What a step did without, because it is not ported: counted, never hidden. */
    this.unported = { gradient: 0 };
  }

  /** Ballpark::ClearAll (5896). */
  clearAll() {
    this.balls.clear();
    this.freeBalls.clear();
    this.moribundBalls.clear();
  }

  ball(id) {
    return this.balls.get(id) ?? null;
  }

  // ── adding ────────────────────────────────────────────────────────────────

  /** Ballpark::AddBall (3303). An id already in the park is updated in place. */
  addBall({
    id, mass = 1.0e34, radius = 0, maxVelocity = 0, isFree = false, isGlobal = false, isMassive = false,
    isInteractive = false, isSpaceJunk = false, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, agility = 1, speedFraction = 0,
  }) {
    let ball = this.balls.get(id);
    const created = !ball;
    if (created) {
      ball = {
        id,
        mode: MODE.STOP,
        formationID: -1,
        effectStamp: 0,
        ownerId: 0,
        followId: 0,
        followRange: 10.0,
        followPtr: null,
        followers: new Set(),
        corporationID: -1,
        allianceID: -1,
        harmonic: -1,
        isCloaked: 0,
        isMoribund: false,
        goto: vec(),
        lastG: vec(),
        lastC: vec(),
      };
      this.balls.set(id, ball);
    }
    [radius, maxVelocity, agility, speedFraction] = [f32(radius), f32(maxVelocity), f32(agility), f32(speedFraction)];
    ball.newPos = vec(x, y, z);
    ball.newVel = vec(vx, vy, vz);
    if (created) {
      // mOldPos = mNewPos - dt*mNewVel
      ball.oldPos = sub(ball.newPos, scale(ball.newVel, this.dt));
      ball.oldVel = vec(vx, vy, vz);
    } else {
      ball.formationID = -1;
      ball.effectStamp = 0;
      ball.ownerId = 0;
      ball.followId = 0;
      ball.followRange = 10.0;
      ball.corporationID = -1;
      ball.allianceID = -1;
      ball.harmonic = -1;
      ball.isMoribund = false;
    }
    ball.radius = radius < 0.0 ? 0.0 : radius;
    ball.mass = mass < 0.0 ? 0.0 : mass;
    ball.isFree = Boolean(isFree);
    ball.isGlobal = Boolean(isGlobal);
    ball.isMassive = Boolean(isMassive);
    ball.isInteractive = Boolean(isInteractive);
    ball.isSpaceJunk = Boolean(isSpaceJunk);
    ball.maxVelocity = maxVelocity < 0.0 ? 0.0 : maxVelocity;
    ball.agility = agility <= 0.0 ? 1.0 : agility;
    ball.speedFraction = speedFraction < 0.0 ? 0.0 : speedFraction;
    this._setTimeFactor(ball);
    if (!created && !ball.isFree) this.freeBalls.delete(id);
    else if (ball.isFree) this.freeBalls.set(id, ball);
    ball.mode = MODE.STOP;
    return ball;
  }

  /** Ballpark::SetBallTimeFactor (4968): exp(-k*dt/m), kept for whole-tick steps. */
  _setTimeFactor(ball) {
    const mass = ball.mass * ball.agility;
    ball.timeFactor = mass <= 0.0 ? 0.0 : Math.exp((-this.friction * this.dt) / mass);
  }

  // ── setters (4652-5090) ───────────────────────────────────────────────────

  setBallMass(id, mass) {
    if (mass <= 0.0) return;
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.mass = mass;
    this._setTimeFactor(ball);
  }

  setBallAgility(id, agility) {
    agility = f32(agility);
    const ball = this.balls.get(id);
    if (!ball || agility <= 0.0) return;
    ball.agility = agility;
    this._setTimeFactor(ball);
  }

  setMaxSpeed(id, speed) {
    speed = f32(speed);
    if (speed < 0.0) return;
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.maxVelocity = speed;
  }

  setSpeedFraction(id, fraction) {
    fraction = f32(fraction);
    if (!Number.isFinite(fraction)) return;
    const ball = this.balls.get(id);
    if (!ball) return;
    if (fraction < 0.0) fraction = 0.0;
    else if (fraction > 1.0) fraction = 1.0;
    ball.speedFraction = fraction;
  }

  setBallRadius(id, radius) {
    radius = f32(radius);
    const ball = this.balls.get(id);
    if (!ball || radius < 0.0) return;
    ball.radius = radius;
  }

  /** Sets where the ball is, and where it was: nothing is left to interpolate from. */
  setBallPosition(id, x, y, z) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.newPos = vec(x, y, z);
    ball.oldPos = vec(x, y, z);
  }

  setBallVelocity(id, vx, vy, vz) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.newVel = vec(vx, vy, vz);
    ball.oldVel = vec(vx, vy, vz);
  }

  setBallMassive(id, flag) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.isMassive = Boolean(flag);
  }

  setBallGlobal(id, flag) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.isGlobal = Boolean(flag);
  }

  setBallInteractive(id, flag) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.isInteractive = Boolean(flag);
  }

  /** Ballpark::SetBallHarmonic (4852): a ball made a field stops, and stays put as one. */
  setBallHarmonic(id, harmonic, corporationID, allianceID, field) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.harmonic = harmonic;
    ball.corporationID = corporationID;
    ball.allianceID = allianceID;
    if (field) {
      this.stop(id);
      ball.mode = MODE.FIELD;
    } else if (ball.mode === MODE.FIELD) {
      this.stop(id);
    }
  }

  /** Ballpark::SetBallRigid (6278). */
  setBallRigid(id) {
    const ball = this.balls.get(id);
    if (!ball) return;
    this.stop(id);
    ball.mode = MODE.RIGID;
  }

  /**
   * Ballpark::SetBallTroll (6290): free and coasting for `delay` ticks, after
   * which the step turns it to stone (a wreck drifting to a halt).
   */
  setBallTroll(id, delay) {
    const ball = this.balls.get(id);
    if (!ball) return;
    if (delay < 1) delay = 1;
    this.stop(id);
    this.setBallFree(id, true);
    this.setBallInteractive(id, true);
    ball.effectStamp = this.currentTime + delay;
    ball.mode = MODE.TROLL;
  }

  /** Ballpark::CloakBall (5223). */
  cloakBall(id, cloakMode) {
    const ball = this.balls.get(id);
    if (!ball) return;
    if (cloakMode <= 0) return;
    this.stopAllFollowers(ball);
    ball.isCloaked = cloakMode;
    ball.isMassive = false;
  }

  /** Ballpark::UncloakBall (5257): massive again, unless it is in warp proper. */
  uncloakBall(id) {
    const ball = this.balls.get(id);
    if (!ball) return;
    ball.isCloaked = 0;
    if (!isWarping(ball)) ball.isMassive = true;
  }

  /** Ballpark::SetBallFree (4887). A ball made unfree is stopped where it is. */
  setBallFree(id, flag) {
    const ball = this.balls.get(id);
    if (!ball) return;
    flag = Boolean(flag);
    if (flag === ball.isFree) return;
    ball.isFree = flag;
    if (ball.isFree) {
      this.freeBalls.set(id, ball);
    } else {
      this.stop(id);
      this.setBallVelocity(id, 0.0, 0.0, 0.0);
      this.freeBalls.delete(id);
      ball.lastG = vec();
    }
  }

  // ── removing (5416-5765) ──────────────────────────────────────────────────

  /**
   * Ballpark::StopAllFollowers (5416): whoever was following this ball is told
   * to stop, except a missile or an interactive orbiter, which flies on the way
   * it was going.
   */
  stopAllFollowers(ball) {
    if (!ball || ball.followers.size === 0) return;
    for (const id of [...ball.followers]) {
      const follower = this.balls.get(id);
      if (!follower || follower.followId !== ball.id || follower.followPtr !== ball) {
        ball.followers.delete(id);
        continue;
      }
      if (follower.mode === MODE.MISSILE || (follower.isInteractive && follower.mode === MODE.ORBIT)) {
        if (follower.mode === MODE.MISSILE) follower.isMassive = false;
        this.gotoDirection(id, follower.newVel.x, follower.newVel.y, follower.newVel.z);
      } else {
        this.stop(id);
      }
    }
  }

  /**
   * Ballpark::RemoveBall (5471). With a delay the ball is only marked: it stops
   * taking part at once, and is taken out of the park when its time is up
   * (bringOutDeadBalls).
   */
  removeBall(id, delay = 0) {
    const ball = this.balls.get(id);
    if (!ball) return;
    this.stop(id);
    this.stopAllFollowers(ball);
    ball.isMoribund = true;
    if (delay > 0) {
      ball.isMassive = false;
      ball.effectStamp = this.currentTime + delay;
      this.moribundBalls.add(ball);
      return;
    }
    this.moribundBalls.delete(ball);
    if (ball.isFree) this.freeBalls.delete(id);
    this.balls.delete(id);
  }

  /**
   * Ballpark::BringOutDeadBalls (5708), which the engine runs every frame: a
   * moribund ball goes once its time has passed, and up to seven a call go
   * early once they are within two ticks of it.
   */
  bringOutDeadBalls() {
    let killCounter = 0;
    const toDelete = [];
    for (const ball of this.moribundBalls) {
      if (!ball.isMoribund) toDelete.push(ball);
      else if (ball.effectStamp - this.currentTime < 0) toDelete.push(ball);
      else if (ball.effectStamp - this.currentTime - 2 < 0 && killCounter < 7) {
        toDelete.push(ball);
        killCounter += 1;
      }
    }
    for (const ball of toDelete) {
      if (ball.isMoribund) this.removeBall(ball.id);
      this.moribundBalls.delete(ball);
    }
  }

  // ── the state blob (Thunkers.cpp) ─────────────────────────────────────────

  /**
   * ReadFullStateFromStream. `partial` is what the client passes: 0 for a
   * SetState, 2 for an AddBalls, 1 for its own rewind. Whatever it is, the
   * park's tick counter becomes the blob's stamp.
   *
   * A read never removes a ball. A full read (0) only empties the list of balls
   * that are stepped; the caller clears the park first when it means to.
   */
  readState(bytes, partial = 0) {
    const state = readState(bytes);
    if (state.packet === null) return [];
    if (!partial) this.freeBalls.clear();
    this.currentTime = state.stamp;
    const read = [];
    for (const record of state.balls) {
      const ball = this.addBall({
        id: record.id,
        mass: record.mass,
        radius: record.radius,
        maxVelocity: record.maxVelocity,
        isFree: Boolean(record.flags & FLAG.FREE),
        isGlobal: Boolean(record.flags & FLAG.GLOBAL),
        isMassive: Boolean(record.flags & FLAG.MASSIVE),
        isInteractive: Boolean(record.flags & FLAG.INTERACTIVE),
        isSpaceJunk: Boolean(record.flags & FLAG.SPACE_JUNK),
        x: record.position.x,
        y: record.position.y,
        z: record.position.z,
        vx: record.velocity.x,
        vy: record.velocity.y,
        vz: record.velocity.z,
        agility: record.agility,
        speedFraction: record.speedFraction,
      });
      ball.formationID = record.formationID;
      // A fixed ball's collision shapes are replaced by the record's; a rewind leaves them as they are.
      if (partial !== 1 && !(record.flags & FLAG.FREE)) {
        ball.miniBalls = record.miniBalls;
        ball.miniCapsules = record.miniCapsules;
        ball.miniBoxes = record.miniBoxes;
      }
      ball.harmonic = record.harmonic;
      ball.corporationID = record.corporationID;
      ball.allianceID = record.allianceID;
      // The mode is written straight in: no order is given, and nothing is told.
      ball.mode = record.mode;
      ball.isCloaked = record.isCloaked;
      if (record.followId !== undefined) ball.followId = record.followId;
      if (record.followRange !== undefined) ball.followRange = record.followRange;
      if (record.ownerId !== undefined) ball.ownerId = record.ownerId;
      if (record.effectStamp !== undefined) ball.effectStamp = record.effectStamp;
      if (record.goto !== undefined) ball.goto = { ...record.goto };
      if (record.mode === MODE.WARP) {
        // The C++ keeps these three in members named for other things.
        ball.lastCollision = record.totalWarpLength;
        ball.warpMinRange = record.minRange;
        ball.ownerId = record.warpFactor;
      }
      if (record.mode === MODE.MUSHROOM) ball.goto = vec(record.span, ball.goto.y, ball.goto.z);
      read.push(ball);
    }
    // Once every ball is in: hook each follower to its leader. One whose leader
    // is not in the park is left flying at whatever point it had.
    for (const ball of read) {
      if (!FOLLOW_MODES.has(ball.mode)) continue;
      const leader = this.balls.get(ball.followId);
      if (!leader) {
        ball.mode = MODE.GOTO;
      } else {
        ball.followPtr = leader;
        leader.followers.add(ball.id);
      }
    }
    return read;
  }

  /** A ball as a record of the state blob (WriteBallToStream reads these members). */
  _record(ball) {
    return {
      id: ball.id,
      mode: ball.mode,
      radius: ball.radius,
      position: ball.newPos,
      flags: (ball.isFree ? FLAG.FREE : 0) | (ball.isGlobal ? FLAG.GLOBAL : 0) | (ball.isMassive ? FLAG.MASSIVE : 0) |
        (ball.isInteractive ? FLAG.INTERACTIVE : 0) | (ball.isSpaceJunk ? FLAG.SPACE_JUNK : 0),
      mass: ball.mass,
      isCloaked: ball.isCloaked,
      harmonic: ball.harmonic,
      corporationID: ball.corporationID,
      allianceID: ball.allianceID,
      maxVelocity: ball.maxVelocity,
      velocity: ball.newVel,
      agility: ball.agility,
      speedFraction: ball.speedFraction,
      formationID: ball.formationID,
      followId: ball.followId,
      followRange: ball.followRange,
      ownerId: ball.ownerId,
      effectStamp: ball.effectStamp,
      goto: ball.goto,
      totalWarpLength: ball.lastCollision ?? 0,
      minRange: ball.warpMinRange ?? 0,
      warpFactor: ball.ownerId,
      span: ball.goto.x,
      miniBalls: ball.miniBalls ?? [],
      miniCapsules: ball.miniCapsules ?? [],
      miniBoxes: ball.miniBoxes ?? [],
    };
  }

  /**
   * WriteFullStateToStream (every ball) or, given ids, WriteBallsToStream. A
   * moribund ball is left out, and so is a ball of the client's own.
   */
  writeState(ids = null) {
    const chosen = ids === null ? [...this.balls.values()] : ids.map((id) => this.balls.get(id)).filter(Boolean);
    return writeState({
      packet: ids === null ? PACKET.FULL_STATE : PACKET.BALLS,
      stamp: this.currentTime,
      balls: chosen.filter((ball) => !ball.isMoribund && !(ids === null && ball.id < DSTLOCALBALLS)).map((ball) => this._record(ball)),
    });
  }

  // ── orders (4471-4650) ────────────────────────────────────────────────────

  /** Ballpark::Stop(const ID&) (4556), which is what the Stop order reaches: nothing to do for a ball already stopped. */
  stopOrder(id) {
    const ball = this.balls.get(id);
    if (!ball) return;
    if (ball.mode === MODE.STOP) return;
    this.stop(id);
  }

  /** Ballpark::Stop(Ball*) (4578): leave whoever was being followed, and stop steering. */
  stop(id) {
    const ball = this.balls.get(id);
    if (!ball) return;
    if (FOLLOW_MODES.has(ball.mode)) {
      // A client (not master) looks the leader up by id and only unhooks itself
      // if that is still the ball it holds.
      const leader = this.balls.get(ball.followId);
      if (leader && ball.followPtr === leader) ball.followPtr.followers.delete(ball.id);
      ball.effectStamp = 0;
      ball.followPtr = null;
      ball.followId = 0;
      ball.ownerId = 0;
      ball.followRange = 0.0;
    }
    ball.mode = MODE.STOP;
  }

  /**
   * Ballpark::FollowBall (3879) and Ballpark::Orbit (4007): the same order but
   * for the mode. The Python entry points default the range to 1.0.
   */
  _follow(mode, id, targetId, range) {
    range = f32(range);
    if (!Number.isFinite(range)) return;
    const ball = this.balls.get(id);
    if (!ball) return;
    if (id === targetId) return;
    const target = this.balls.get(targetId);
    if (!target) return;
    if (target.isMoribund) return; // a dead ball cannot be followed
    if (target.isCloaked) return;
    this.stop(id);
    ball.followId = targetId;
    ball.followPtr = target;
    ball.followRange = range;
    ball.mode = mode;
    target.followers.add(id);
  }

  followBall(id, targetId, range = 1.0) {
    this._follow(MODE.FOLLOW, id, targetId, range);
  }

  orbit(id, targetId, range = 1.0) {
    this._follow(MODE.ORBIT, id, targetId, range);
  }

  /** Ballpark::GotoPoint (4529). */
  gotoPoint(id, x, y, z) {
    const ball = this.balls.get(id);
    if (!ball) return;
    const p = vec(x, y, z);
    if (!finite(p)) return;
    this.stop(id);
    ball.goto = p;
    if (ball.speedFraction === 0.0) ball.speedFraction = 1.0;
    ball.mode = MODE.GOTO;
  }

  /**
   * Ballpark::GotoDirection (4483): a point 1e17 m away along the direction,
   * from where the ball is now. The ball then steers at that point; it is not
   * told to hold a heading.
   */
  gotoDirection(id, x, y, z) {
    const ball = this.balls.get(id);
    if (!ball) return;
    let dir = vec(x, y, z);
    if (!finite(dir)) return;
    dir = normalize(dir);
    dir = add(ball.newPos, scale(dir, 1.0e17));
    this.gotoPoint(id, dir.x, dir.y, dir.z);
  }

  // ── the step ──────────────────────────────────────────────────────────────

  /**
   * Ballpark::Integrate (751): the closed-form step of m dv/dt = m a - k v over
   * time t, with a held constant. Returns the new { p, v }. Evaluated exactly
   * as the source writes it.
   */
  integrate(p, v, a, m, k, timeFactor, t) {
    if (t === 0.0) return { p, v };
    if (t !== this.dt) timeFactor = Math.exp((-k / m) * t);
    const k2 = k * k;
    const ook2 = 1.0 / k2;
    const ook = 1.0 / k;
    const ma = scale(a, m);
    let newP;
    if (k < 1e-10 * m * t) {
      // p = (m * (a * (-k * t) + k * (a * t + v * k / m * t)) + p * k2) * ook2;
      const inner = add(scale(a, t), scale(divide(scale(v, k), m), t));
      newP = scale(add(scale(add(scale(a, -k * t), scale(inner, k)), m), scale(p, k2)), ook2);
    } else {
      // p = (m * (m * a * (timeFactor - 1.0) + k * (a * t + v - timeFactor * v)) + p * k2) * ook2;
      const inner = sub(add(scale(a, t), v), scale(v, timeFactor));
      newP = scale(add(scale(add(scale(ma, timeFactor - 1.0), scale(inner, k)), m), scale(p, k2)), ook2);
    }
    // v = (m * a - (m * a - v * k) * timeFactor) * ook;
    const newV = scale(sub(ma, scale(sub(ma, scale(v, k)), timeFactor)), ook);
    return { p: newP, v: newV };
  }

  /**
   * Ballpark::GotoThrust (1398): full thrust straight at the target, eased off
   * by the fourth power of the distance once the target is within a tick's travel.
   */
  gotoThrust(ball, target, missile = false) {
    let a = sub(target, ball.newPos);
    const length2 = lengthSq(a);
    const dist = ball.speedFraction * ball.maxVelocity * this.dt;
    const maxThrust = (this.friction * ball.speedFraction * ball.maxVelocity) / (ball.mass * ball.agility);
    a = normalize(a);
    if (!missile && length2 < dist * dist) {
      const coff = length2 / (dist * dist);
      a = scale(a, maxThrust * coff * coff);
    } else {
      a = scale(a, maxThrust);
    }
    return a;
  }

  /**
   * Ballpark::EvolveFollow (1066): steer at the point on the line between the
   * two, at the range asked for measured surface to surface. Where the leader
   * is going plays no part.
   */
  _evolveFollow(ball) {
    const other = ball.followPtr;
    const otherPos = other.newPos;
    const delta = sub(ball.newPos, otherPos);
    const dist = length(delta);
    const r = ball.followRange + ball.radius + other.radius;
    // Right on top of it: go out along x.
    const target = dist === 0.0 ? add(otherPos, scale(vec(1.0, 0.0, 0.0), r)) : add(otherPos, divide(scale(delta, r), dist));
    ball.goto = target;
    return this.gotoThrust(ball, target, ball.mode === MODE.MISSILE);
  }

  /**
   * Ballpark::EvolveOldStyleOrbit (1249). The plane of the orbit comes from the
   * low sixteen bits of the orbiter's id and from the tick counter, so two
   * simulations agree only if they agree on what tick it is.
   */
  _evolveOrbit(ball, currentTime) {
    const cruiseVelocity = ball.speedFraction * ball.maxVelocity;
    const k = this.friction;
    const maxThrust = (k * cruiseVelocity) / (ball.mass * ball.agility);
    const other = ball.followPtr;
    const otherPos = other.newPos;
    const r = ball.followRange + ball.radius + other.radius;
    let toVector = sub(otherPos, ball.newPos);
    const dist = length(toVector);
    toVector = normalize(toVector);

    let phi1 = currentTime * ORBITAL_PRECESSION;
    const phi2 = lowSixteenBits(ball.id) + currentTime * ORBITAL_PRECESSION;
    let radialVector = vec(
      cutToSevenDecimals(Math.cos(phi1) * Math.cos(phi2)),
      cutToSevenDecimals(Math.sin(phi2)),
      cutToSevenDecimals(Math.sin(phi1) * Math.cos(phi2)),
    );
    // Despite its name, after this it is across the line to the other ball, not along it.
    radialVector = normalize(cross(radialVector, toVector));

    // Aim at the tangent of the orbit when outside it.
    const toComp = dist * dist - r * r;
    if (toComp >= 0.0) {
      const radComp = (r * Math.sqrt(toComp)) / dist;
      toVector = normalize(add(scale(toVector, toComp / dist), scale(radialVector, radComp)));
    }

    // How much of the thrust goes sideways. exp() is cut to seven decimals
    // because CCP found it differed between their own platforms.
    const radialFactor = cutToSevenDecimals(Math.exp((-(r - dist) * (r - dist)) / 40000.0));
    phi1 = -dot(toVector, radialVector);
    let transverseFactor = 1.0 + radialFactor * radialFactor * (phi1 * phi1 - 1.0);
    transverseFactor = transverseFactor > 0.0 ? radialFactor * phi1 + Math.sqrt(transverseFactor) : radialFactor * phi1;
    transverseFactor *= dist - r >= 0.0 ? 1.0 : -1.0;

    const a = scale(add(scale(radialVector, radialFactor), scale(toVector, transverseFactor)), maxThrust);
    ball.goto = add(ball.newPos, scale(a, 10.0 * AU));
    return a;
  }

  /** Ballpark::EvolveBehaviorForBall (789): this tick's acceleration, by mode. */
  _evolveBehavior(ball) {
    ball.lastG = vec();
    ball.lastC = vec();
    let a = vec();
    switch (ball.mode) {
      case MODE.GOTO:
        a = this.gotoThrust(ball, ball.goto);
        break;
      case MODE.STOP: {
        // EvolveStop (1339): the vertical speed is damped by more than friction alone.
        const v = ball.newVel;
        ball.newVel = vec(v.x, (v.y - 0.07 * v.y) * 0.9345794392523364485981308411215, v.z);
        break;
      }
      case MODE.FOLLOW:
        a = this._evolveFollow(ball);
        break;
      case MODE.ORBIT:
        a = this._evolveOrbit(ball, this.currentTime);
        break;
      case MODE.WARP:
      case MODE.MISSILE:
      case MODE.FORMATION:
        throw new DestinyNotPorted(`The ${MODE_NAME[ball.mode]} mode`);
      default:
        // MUSHROOM, BOID, TROLL, MINIBALL, FIELD, RIGID: no acceleration.
        break;
    }
    ball.lastG = a;
  }

  /**
   * Ballpark::Evolve (421): one tick. Every free ball's acceleration is found
   * first, then every ball is stepped from the same picture of the others, then
   * all of them move at once. Balls are taken in ascending id.
   */
  evolve() {
    const free = [...this.freeBalls.values()].filter((ball) => !ball.isMoribund).sort((a, b) => byId(a.id, b.id));
    for (const ball of free) this._evolveBehavior(ball);
    for (const ball of free) {
      // Gradient(ball): what a massive ball's neighbours do to it. Not ported.
      if (ball.isMassive) this.unported.gradient += 1;
      const stepped = this.integrate(ball.newPos, ball.newVel, add(ball.lastG, ball.lastC), ball.mass * ball.agility, this.friction, ball.timeFactor, this.dt);
      // Kept in the "old" pair until every ball is done: the others still see where this one was.
      ball.oldPos = stepped.p;
      ball.oldVel = stepped.v;
    }
    const trolls = [];
    for (const ball of free) {
      // TrollReady (6315): its time has come.
      if (ball.mode === MODE.TROLL && !(ball.effectStamp > this.currentTime)) trolls.push(ball);
      if (ball.mode === MODE.MUSHROOM) throw new DestinyNotPorted("The MUSHROOM mode");
      [ball.newPos, ball.oldPos] = [ball.oldPos, ball.newPos];
      [ball.newVel, ball.oldVel] = [ball.oldVel, ball.newVel];
    }
    // PetrifyTroll (6325): stopped dead, fixed, and no longer anyone's business.
    for (const ball of trolls) {
      if (ball.mode !== MODE.TROLL || ball.effectStamp > this.currentTime) continue;
      this.setBallFree(ball.id, false);
      this.setBallInteractive(ball.id, false);
      ball.mode = MODE.RIGID;
    }
    this.currentTime += 1;
  }
}

module.exports = { AU, Ballpark, DSTLOCALBALLS, DestinyNotPorted, FOLLOW_MODES, add, cross, divide, dot, isWarping, length, lengthSq, normalize, scale, sub, vec };
