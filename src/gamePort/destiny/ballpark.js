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
//                              EvolveStop (1339), GotoThrust (1398), AddBall (3303),
//                              the orders (4471-4650) and the setters (4652-5090)
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
// PORTED SO FAR: the integrator, STOP and GOTO, adding balls and the orders and
// setters those need. NOT YET, and each stops here rather than be guessed at:
// FOLLOW, ORBIT, WARP, MISSILE, FORMATION (evolve throws), collisions (counted
// in `unported.gradient`: a massive ball is stepped without them), orientation
// (yaw, pitch and roll do not move a ball), the spatial partition, moribund
// balls, trolls and mushrooms.

const { MODE, MODE_NAME } = require("./state");

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

const f32 = Math.fround;

class DestinyNotPorted extends Error {
  constructor(what) {
    super(`${what} is not ported from destiny yet.`);
    this.name = "DestinyNotPorted";
  }
}

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
    /** What a step did without, because it is not ported: counted, never hidden. */
    this.unported = { gradient: 0 };
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

  // ── orders (4471-4650) ────────────────────────────────────────────────────

  /** Ballpark::Stop (4578): leave whoever was being followed, and stop steering. */
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
      case MODE.WARP:
      case MODE.MISSILE:
      case MODE.FORMATION:
      case MODE.FOLLOW:
      case MODE.ORBIT:
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
    for (const ball of free) {
      [ball.newPos, ball.oldPos] = [ball.oldPos, ball.newPos];
      [ball.newVel, ball.oldVel] = [ball.oldVel, ball.newVel];
    }
    this.currentTime += 1;
  }
}

module.exports = { Ballpark, DestinyNotPorted, FOLLOW_MODES, add, divide, length, lengthSq, normalize, scale, sub, vec };
