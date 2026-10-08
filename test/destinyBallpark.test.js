"use strict";

// src/gamePort/destiny/ballpark.js is CCP's destiny ported to JavaScript. The
// expected numbers here are CCP's own, from the evolve tests that ship with its
// source (destiny/python/destiny/test/ballpark/evolve/test_goto.py and
// test_stop.py), each a position or velocity after every tick. CCP's tests
// accept four decimal places. These require every digit: the point of the
// port is the same bits the retail client computes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Ballpark, DestinyNotPorted, divide, normalize, scale, vec } = require("../src/gamePort/destiny/ballpark");
const { MODE } = require("../src/gamePort/destiny/state");

/**
 * destiny.test.helpers.create_space_ball: a ball added still and unfree, then
 * set up through the same setters the Python attributes go through.
 */
function spaceBall(park, { id = 1, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, mass = 13000000.0, maxVelocity = 10.0 } = {}) {
  park.addBall({ id, x, y, z, vx, vy, vz });
  park.setBallFree(id, true);
  park.setMaxSpeed(id, maxVelocity);
  park.setBallAgility(id, 0.9);
  park.setBallMass(id, mass);
  park.setBallRadius(id, 2.0);
  park.setBallMassive(id, true);
  park.setSpeedFraction(id, 0.95);
  return park.ball(id);
}

/** Evolve `ticks` times, reading `what` after each. */
function run(park, ball, ticks, what) {
  const rows = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    park.evolve();
    const v = ball[what];
    rows.push([v.x, v.y, v.z]);
  }
  return rows;
}

// ── CCP's fixtures ───────────────────────────────────────────────────────────

test("CCP test_goto_direction: ten ticks toward (10, 20, 30), to the last digit", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  park.gotoDirection(ball.id, 10, 20, 30);
  assert.deepEqual(run(park, ball, 10, "newPos"), [
    [0.10547716886968704, 0.21095433773937408, 0.31643150660906116],
    [0.4103055632728434, 0.8206111265456868, 1.2309166898185293],
    [0.8981544513244618, 1.7963089026489236, 2.6944633539733838],
    [1.5540309048233936, 3.108061809646787, 4.662092714470173],
    [2.364170207183284, 4.728340414366568, 7.0925106215498435],
    [3.315935239079564, 6.631870478159128, 9.947805717238685],
    [4.397724106363411, 8.795448212726821, 13.19317231909023],
    [5.598885335041164, 11.197770670082328, 16.796656005123484],
    [6.909640013429747, 13.819280026859493, 20.728920040289236],
    [8.321010312379675, 16.64202062475935, 24.96303093713902],
  ]);
});

test("CCP test_goto_point: eighteen ticks to the point (10, 20, 30), homing in at the end", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  park.gotoPoint(ball.id, 10, 20, 30);
  assert.deepEqual(run(park, ball, 18, "newPos"), [
    [0.10547716886968671, 0.21095433773937342, 0.31643150660906116],
    [0.4103055632728427, 0.8206111265456854, 1.2309166898185306],
    [0.898154451324462, 1.796308902648924, 2.694463353973384],
    [1.5540309048233925, 3.108061809646785, 4.662092714470175],
    [2.364170207183283, 4.728340414366566, 7.092510621549848],
    [3.3159352390795633, 6.631870478159127, 9.947805717238683],
    [4.397724106363411, 8.795448212726821, 13.193172319090227],
    [5.598885335041161, 11.197770670082322, 16.79665600512348],
    [6.909640013429744, 13.819280026859488, 20.728920040289225],
    [8.321010312379672, 16.642020624759343, 24.96303093713901],
    [9.739446987259553, 19.478893974519107, 29.218340961778658],
    [11.061301666724546, 22.122603333449092, 33.18390500017364],
    [12.271662033494039, 24.543324066988077, 36.814986100482116],
    [13.312148751580072, 26.624297503160143, 39.93644625474022],
    [14.096228724360666, 28.19245744872133, 42.288686173082],
    [14.608085488313941, 29.216170976627883, 43.82425646494182],
    [14.870019404144168, 29.740038808288336, 44.610058212432506],
    [14.902504000487617, 29.805008000975235, 44.70751200146285],
  ]);
});

test("CCP test_stop_ball_in_goto_mode: a stopping ball's velocity, the vertical part falling fastest", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  park.setBallVelocity(ball.id, 10.0, 20.0, 30.0);
  park.stop(ball.id);
  assert.deepEqual(run(park, ball, 10, "newVel"), [
    [9.180806045144438, 15.959158171933325, 27.542418135433316],
    [8.428719963856068, 12.73473647783931, 25.286159891568197],
    [7.738244319699939, 10.161783686386327, 23.21473295909981],
    [7.104332022910581, 8.108675658000553, 21.312996068731735],
    [6.522349438265067, 6.470381869546817, 19.567048314795194],
    [5.9880425151368355, 5.163092384445365, 17.9641275454105],
    [5.497505692155016, 4.119930400983397, 16.49251707646504],
    [5.047153349175273, 3.2875310463325356, 15.141460047525813],
    [4.633693597887935, 2.6233113981781195, 13.901080793663798],
    [4.254104219483663, 2.0932920768880083, 12.762312658450982],
  ]);
});

test("CCP test_stopped_ball_is_stopped: a ball at rest at the origin stays exactly there", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  for (const [x, y, z] of run(park, ball, 10, "newPos")) assert.deepEqual([x, y, z], [0, 0, 0]);
  assert.equal(park.currentTime, 10);
});

// ── what the source says, beyond the fixtures ────────────────────────────────

test("the arithmetic is destiny's: division is by the reciprocal, and a zero vector normalises to itself", () => {
  // 1/3 is not exact, so x * (1/3) and x / 3 can differ in the last place.
  const third = divide(vec(5, 7, 0.1), 3);
  assert.deepEqual(third, { x: 5 * (1 / 3), y: 7 * (1 / 3), z: 0.1 * (1 / 3) });
  assert.notEqual(third.x, 5 / 3);
  const zero = vec(0, 0, 0);
  assert.equal(normalize(zero), zero);
  const unit = normalize(vec(3, 4, 0));
  assert.deepEqual(unit, { x: 3 * (1 / 5), y: 4 * (1 / 5), z: 0 });
  assert.deepEqual(scale(vec(1, 2, 3), 2), { x: 2, y: 4, z: 6 });
});

test("the float fields are stored as float32, and the time factor is made from them", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  assert.equal(ball.agility, Math.fround(0.9));
  assert.notEqual(ball.agility, 0.9);
  assert.equal(ball.speedFraction, Math.fround(0.95));
  assert.equal(ball.maxVelocity, 10);
  assert.equal(ball.radius, 2);
  // exp(-k*dt/m) with m = mass * agility, agility already rounded.
  assert.equal(ball.timeFactor, Math.exp((-1000000.0 * 1.0) / (13000000.0 * Math.fround(0.9))));
  // Mass and agility each remake it; nothing else does.
  const before = ball.timeFactor;
  park.setMaxSpeed(ball.id, 400);
  park.setSpeedFraction(ball.id, 0.5);
  assert.equal(ball.timeFactor, before);
  park.setBallMass(ball.id, 1157000);
  assert.equal(ball.timeFactor, Math.exp((-1000000.0 * 1.0) / (1157000 * Math.fround(0.9))));
  park.setBallAgility(ball.id, 4.35);
  assert.equal(ball.timeFactor, Math.exp((-1000000.0 * 1.0) / (1157000 * Math.fround(4.35))));
});

test("the setters refuse what destiny's refuse", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  const before = { ...ball };
  park.setBallMass(ball.id, 0);
  park.setBallMass(ball.id, -5);
  park.setBallAgility(ball.id, 0);
  park.setBallAgility(ball.id, -1);
  park.setMaxSpeed(ball.id, -1);
  park.setSpeedFraction(ball.id, NaN);
  park.setSpeedFraction(ball.id, Infinity);
  assert.deepEqual([ball.mass, ball.agility, ball.maxVelocity, ball.speedFraction], [before.mass, before.agility, before.maxVelocity, before.speedFraction]);
  // A fraction is held to [0, 1].
  park.setSpeedFraction(ball.id, 1.5);
  assert.equal(ball.speedFraction, 1);
  park.setSpeedFraction(ball.id, -0.5);
  assert.equal(ball.speedFraction, 0);
  // A ball that is not there is left alone, quietly.
  for (const call of [() => park.setBallMass(99, 1), () => park.stop(99), () => park.gotoPoint(99, 1, 2, 3), () => park.setBallFree(99, true), () => park.setBallPosition(99, 1, 2, 3)]) call();
  assert.equal(park.ball(99), null);
});

test("an order to go somewhere stops what the ball was doing first, and wakes a ball whose throttle was at zero", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  park.setSpeedFraction(ball.id, 0);
  park.gotoPoint(ball.id, 100, 0, 0);
  assert.deepEqual([ball.mode, ball.speedFraction, ball.goto], [MODE.GOTO, 1, { x: 100, y: 0, z: 0 }]);
  // A point that is not a point is ignored: the ball keeps its order.
  park.gotoPoint(ball.id, NaN, 0, 0);
  park.gotoDirection(ball.id, Infinity, 0, 0);
  assert.deepEqual(ball.goto, { x: 100, y: 0, z: 0 });
  // A direction becomes a point 1e17 m away from where the ball is now.
  park.setBallPosition(ball.id, 1000, 2000, 3000);
  park.gotoDirection(ball.id, 0, 0, -2);
  assert.deepEqual(ball.goto, { x: 1000, y: 2000, z: 3000 + -1 * 1.0e17 });
  park.stop(ball.id);
  assert.equal(ball.mode, MODE.STOP);
});

test("adding a ball: where it was a tick ago is worked out, and a ball added again is the same ball reset", () => {
  const park = new Ballpark();
  const ball = park.addBall({ id: 7, x: 100, y: 200, z: 300, vx: 1, vy: 2, vz: 3, isFree: true, mass: 5, agility: -1, radius: -3, maxVelocity: -1, speedFraction: -1 });
  assert.deepEqual(ball.oldPos, { x: 99, y: 198, z: 297 });
  assert.deepEqual(ball.oldVel, { x: 1, y: 2, z: 3 });
  assert.deepEqual([ball.mode, ball.agility, ball.radius, ball.maxVelocity, ball.speedFraction], [MODE.STOP, 1, 0, 0, 0], "bad values fall to destiny's floors");
  assert.equal(park.freeBalls.has(7), true);

  park.gotoPoint(7, 1, 1, 1);
  ball.followRange = 99;
  const again = park.addBall({ id: 7, x: 5, y: 5, z: 5 });
  assert.equal(again, ball, "the same ball");
  assert.deepEqual(again.oldPos, { x: 99, y: 198, z: 297 }, "its past is left as it was");
  assert.deepEqual([again.mode, again.followRange, again.isFree], [MODE.STOP, 10, false]);
  assert.equal(park.freeBalls.has(7), false, "no longer free, no longer stepped");
  park.evolve();
  assert.deepEqual(again.newPos, { x: 5, y: 5, z: 5 });
});

test("a ball made unfree is stopped dead and no longer stepped; made free again it moves", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  park.gotoDirection(ball.id, 1, 0, 0);
  park.evolve();
  assert.ok(ball.newPos.x > 0);
  park.setBallFree(ball.id, false);
  assert.deepEqual([ball.mode, ball.newVel, ball.oldVel, ball.lastG], [MODE.STOP, vec(), vec(), vec()]);
  const where = { ...ball.newPos };
  park.evolve();
  assert.deepEqual(ball.newPos, where);
  park.setBallFree(ball.id, false); // again: nothing to do
  park.setBallFree(ball.id, true);
  park.gotoDirection(ball.id, 1, 0, 0);
  park.evolve();
  assert.ok(ball.newPos.x > where.x);
});

test("every ball is stepped from the same picture, in id order, and all move together", () => {
  const park = new Ballpark();
  const far = spaceBall(park, { id: 20, x: 1e6 });
  const near = spaceBall(park, { id: 3 });
  park.gotoDirection(20, 1, 0, 0);
  park.gotoDirection(3, 0, 1, 0);
  park.evolve();
  // Each is where it would be alone: neither's step saw the other's new position.
  const alone = new Ballpark();
  const single = spaceBall(alone, { id: 3 });
  alone.gotoDirection(3, 0, 1, 0);
  alone.evolve();
  assert.deepEqual(near.newPos, single.newPos);
  assert.deepEqual(near.oldPos, vec(0, 0, 0), "and where it was is kept");
  assert.ok(far.newPos.x > 1e6);
  assert.equal(park.currentTime, 1);
});

test("a partial step uses its own time factor, and no time at all changes nothing", () => {
  const park = new Ballpark();
  const p = vec(1, 2, 3);
  const v = vec(4, 5, 6);
  const still = park.integrate(p, v, vec(1, 1, 1), 1e7, 1e6, 0.5, 0.0);
  assert.equal(still.p, p);
  assert.equal(still.v, v);
  // Half a tick: the cached factor is ignored and exp(-k/m*t) used.
  const half = park.integrate(p, v, vec(), 1e7, 1e6, 123, 0.5);
  const factor = Math.exp((-1e6 / 1e7) * 0.5);
  assert.equal(half.v.x, (0 - (0 - 4 * 1e6) * factor) * (1 / 1e6));
  // A whole tick uses the factor it is given.
  const whole = park.integrate(p, v, vec(), 1e7, 1e6, 0.25, 1.0);
  assert.equal(whole.v.x, (0 - (0 - 4 * 1e6) * 0.25) * (1 / 1e6));
});

test("a ball with no friction to speak of takes the series form of the step", () => {
  const park = new Ballpark({ friction: 1e-9 });
  // k < 1e-10 * m * t
  const { p, v } = park.integrate(vec(0, 0, 0), vec(10, 0, 0), vec(), 1e6, 1e-9, 1.0, 1.0);
  assert.ok(Math.abs(p.x - 10) < 1e-6, `it coasts: ${p.x}`);
  assert.ok(Math.abs(v.x - 10) < 1e-9);
});

test("what is not ported yet stops the step by name instead of being guessed at", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  for (const mode of [MODE.WARP, MODE.FOLLOW, MODE.ORBIT, MODE.MISSILE, MODE.FORMATION]) {
    ball.mode = mode;
    assert.throws(() => park.evolve(), (error) => error instanceof DestinyNotPorted && /mode is not ported/.test(error.message));
  }
  // Modes that have no thrust coast like any other ball.
  ball.mode = MODE.TROLL;
  park.setBallVelocity(ball.id, 5, 0, 0);
  park.evolve();
  assert.ok(ball.newPos.x > 0 && ball.newVel.x < 5);
  // A massive ball is stepped without its collisions for now, and that is counted.
  assert.equal(park.unported.gradient, 1);
  park.setBallMassive(ball.id, false);
  park.evolve();
  assert.equal(park.unported.gradient, 1);
});

test("a moribund ball is not stepped", () => {
  const park = new Ballpark();
  const ball = spaceBall(park);
  park.setBallVelocity(ball.id, 5, 0, 0);
  ball.isMoribund = true;
  park.evolve();
  assert.deepEqual(ball.newPos, vec(0, 0, 0));
});

// ── found by breaking the code: each of these let a wrong version through ────

test("a ball added with float fields has them rounded to float32, as AddBall's float parameters do", () => {
  const park = new Ballpark();
  const ball = park.addBall({ id: 1, isFree: true, mass: 1157000, agility: 4.35, radius: 38.4, maxVelocity: 341.7, speedFraction: 0.95 });
  assert.deepEqual([ball.agility, ball.radius, ball.maxVelocity, ball.speedFraction], [Math.fround(4.35), Math.fround(38.4), Math.fround(341.7), Math.fround(0.95)]);
  assert.equal(ball.timeFactor, Math.exp((-1000000.0 * 1.0) / (1157000 * Math.fround(4.35))));
});

test("the time factor is exp((-k*dt)/m), in that order, which shows when a tick is not one second", () => {
  const park = new Ballpark({ tickInterval: 300 });
  const ball = park.addBall({ id: 1, isFree: true, mass: 1200000, agility: 3.1 });
  const m = 1200000 * Math.fround(3.1);
  assert.equal(park.dt, 300 * 0.001);
  assert.equal(ball.timeFactor, Math.exp((-1000000.0 * park.dt) / m));
  assert.notEqual(ball.timeFactor, Math.exp(-1000000.0 * (park.dt / m)), "the other grouping differs in the last place here");
});

test("thrust is ((k*sf)*maxVel)/(mass*agility), in that order", () => {
  const park = new Ballpark();
  const ball = park.addBall({ id: 1, isFree: true, mass: 1157000, agility: 0.9, maxVelocity: 341, speedFraction: 1 });
  const thrust = park.gotoThrust(ball, { x: 1e9, y: 0, z: 0 });
  const expected = (1000000.0 * 1 * 341) / (1157000 * Math.fround(0.9));
  assert.deepEqual(thrust, { x: 1 * expected, y: 0 * expected, z: 0 * expected });
  assert.notEqual(expected, 1000000.0 * 1 * (341 / (1157000 * Math.fround(0.9))), "the other grouping differs in the last place here");
  // A missile never eases off, however close.
  ball.newPos = { x: 0, y: 0, z: 0 };
  const close = { x: 1, y: 0, z: 0 };
  assert.equal(park.gotoThrust(ball, close, true).x, expected);
  assert.ok(park.gotoThrust(ball, close, false).x < expected * 1e-6);
});

test("putting a ball somewhere, or giving it a velocity, rewrites its past as well", () => {
  const park = new Ballpark();
  const ball = spaceBall(park, { x: 5, y: 5, z: 5, vx: 1 });
  park.setBallPosition(ball.id, 100, 200, 300);
  assert.deepEqual([ball.newPos, ball.oldPos], [vec(100, 200, 300), vec(100, 200, 300)]);
  park.setBallVelocity(ball.id, 7, 8, 9);
  assert.deepEqual([ball.newVel, ball.oldVel], [vec(7, 8, 9), vec(7, 8, 9)]);
});

test("telling a ball it is what it already is changes nothing", () => {
  const park = new Ballpark();
  const fixed = park.addBall({ id: 1, vx: 3 });
  park.setBallFree(1, false);
  assert.deepEqual(fixed.newVel, vec(3, 0, 0), "an unfree ball told to be unfree is not stopped again");
  const free = spaceBall(park, { id: 2 });
  park.gotoDirection(2, 1, 0, 0);
  park.setBallFree(2, true);
  assert.equal(free.mode, MODE.GOTO);
});

test("an order to go somewhere lets go of the ball that was being followed", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  const follower = spaceBall(park, { id: 2 });
  // Following is not ported; set the state a follow leaves, as the reader of a state blob does.
  Object.assign(follower, { mode: MODE.FOLLOW, followId: 1, followPtr: leader, followRange: 500, effectStamp: 9, ownerId: 4 });
  leader.followers.add(2);
  park.gotoPoint(2, 10, 0, 0);
  assert.equal(leader.followers.has(2), false);
  assert.deepEqual([follower.mode, follower.followId, follower.followPtr, follower.followRange, follower.effectStamp, follower.ownerId], [MODE.GOTO, 0, null, 0, 0, 0]);
  // A follower whose leader is no longer the ball it holds does not touch that ball's list.
  const other = spaceBall(park, { id: 3 });
  Object.assign(follower, { mode: MODE.ORBIT, followId: 3, followPtr: leader });
  leader.followers.add(2);
  other.followers.add(2);
  park.stop(2);
  assert.deepEqual([leader.followers.has(2), other.followers.has(2), follower.mode], [true, true, MODE.STOP]);
});

// One deliberate breakage still gets through: committing each ball as it is
// stepped, instead of all together. Nothing ported yet reads another ball's
// position, so the two cannot be told apart. FOLLOW can, and CCP's test_follow
// fixture (a follower behind a moving leader) will decide it.
test("a follower is stepped from where its leader was, not where the leader has just been moved to", { todo: "needs FOLLOW ported" }, () => {
  assert.fail("not yet testable");
});
