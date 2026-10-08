"use strict";

// src/gamePort/destiny/ballpark.js is CCP's destiny ported to JavaScript. The
// expected numbers here are CCP's own, from the evolve tests that ship with its
// source (destiny/python/destiny/test/ballpark/evolve/test_goto.py, test_stop.py,
// test_follow.py and test_orbit.py), each a position or velocity after every tick. CCP's tests
// accept four decimal places. These require every digit: the point of the
// port is the same bits the retail client computes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Ballpark, DestinyNotPorted, divide, isWarping, normalize, scale, vec } = require("../src/gamePort/destiny/ballpark");
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

test("CCP test_follow_stopped_ball: ten ticks toward a ball that is standing still", () => {
  const park = new Ballpark();
  const follower = spaceBall(park, { id: 1 });
  const leader = spaceBall(park, { id: 2, x: 100, y: 200, z: 300 });
  park.followBall(follower.id, leader.id);
  assert.deepEqual(run(park, follower, 10, "newPos"), [
    [0.10547716886968704, 0.21095433773937408, 0.3164315066090625],
    [0.41030556327284373, 0.8206111265456875, 1.2309166898185306],
    [0.8981544513244621, 1.7963089026489243, 2.694463353973384],
    [1.5540309048233925, 3.108061809646785, 4.662092714470175],
    [2.364170207183283, 4.728340414366566, 7.092510621549848],
    [3.3159352390795633, 6.631870478159127, 9.94780571723868],
    [4.397724106363411, 8.795448212726821, 13.193172319090223],
    [5.59888533504116, 11.19777067008232, 16.796656005123477],
    [6.909640013429743, 13.819280026859486, 20.72892004028922],
    [8.321010312379672, 16.642020624759343, 24.963030937139006],
  ]);
});

test("CCP test_follow_moving_ball: ten ticks after a ball that is itself under way", () => {
  const park = new Ballpark();
  const follower = spaceBall(park, { id: 1 });
  const leader = spaceBall(park, { id: 2, x: 100, y: 0, z: 0 });
  park.followBall(follower.id, leader.id);
  park.gotoPoint(leader.id, 0, 100, 200);
  assert.deepEqual(run(park, follower, 10, "newPos"), [
    [0.3946594280372685, 0.0, 0.0],
    [1.5352202516956626, 0.0006394210607791958, 0.0012788421215583917],
    [3.360538351919784, 0.00437328037960026, 0.00874656075920052],
    [5.814319316187089, 0.01591817574944254, 0.03183635149888508],
    [8.844475669456193, 0.042139697272792834, 0.08427939454558567],
    [12.402376916827746, 0.09207177010911027, 0.18414354021822055],
    [16.441932909387862, 0.17705502464375017, 0.35411004928750034],
    [20.918410162782422, 0.31098291710272036, 0.6219658342054407],
    [25.786827618186656, 0.5106319284615736, 1.0212638569231471],
    [30.99971869544917, 0.796013087027414, 1.592026174054828],
  ]);
});

test("CCP TestOldOrbit.test_orbit_ball: ball 2 orbiting ball 1 from tick 0, its plane set by its id", () => {
  const park = new Ballpark();
  const orbitee = spaceBall(park, { id: 1 });
  const orbiter = spaceBall(park, { id: 2, x: 5.0 });
  assert.equal(park.currentTime, 0);
  park.orbit(orbiter.id, orbitee.id, 1.0);
  assert.deepEqual(run(park, orbiter, 10, "newPos"), [
    [5.0, 0.0, 0.3946594280372685],
    [4.968965087530276, -0.014060509698578017, 1.533749375235321],
    [4.7948197558341885, -0.09342506603769896, 3.3353413772468783],
    [4.303462228867957, -0.3182911817228117, 5.664861650309143],
    [3.341010762290748, -0.7601346870799338, 8.325917825178466],
    [1.826888038965309, -1.4570571575293851, 11.103680716692217],
    [-0.25072581197636695, -2.415534207332392, 13.808614450861453],
    [-2.860769892110699, -3.6221094985835713, 16.289471089613752],
    [-5.948838546575331, -5.052297043579673, 18.42935795458875],
    [-9.447930869309866, -6.675507070626672, 20.138672333159825],
  ]);
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
  for (const mode of [MODE.WARP, MODE.MISSILE, MODE.FORMATION]) {
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
// stepped, instead of all together. Every acceleration is found before any
// ball moves, and a step uses only the ball's own position, so nothing ported
// yet can tell the two apart. Collisions can: they are worked out during the
// stepping pass, from where the neighbours still are.
test("a ball's collisions are worked out from where its neighbours were, not where they have just been moved to", { todo: "needs collisions ported" }, () => {
  assert.fail("not yet testable");
});

// ── FOLLOW and ORBIT, beyond the fixtures ────────────────────────────────────

test("an order to follow or orbit is refused for what cannot be followed, and otherwise hooks the two together", () => {
  const park = new Ballpark();
  const a = spaceBall(park, { id: 1 });
  const b = spaceBall(park, { id: 2, x: 1000 });
  for (const refuse of [
    () => park.followBall(1, 1), // itself
    () => park.followBall(1, 99), // nothing there
    () => park.followBall(99, 2),
    () => park.followBall(1, 2, NaN),
    () => { b.isMoribund = true; park.orbit(1, 2); b.isMoribund = false; },
    () => { b.isCloaked = 1; park.followBall(1, 2); b.isCloaked = 0; },
  ]) {
    refuse();
    assert.deepEqual([a.mode, a.followId, a.followPtr, b.followers.size], [MODE.STOP, 0, null, 0]);
  }
  park.followBall(1, 2, 2500.4);
  assert.deepEqual([a.mode, a.followId, a.followPtr === b, a.followRange, [...b.followers]], [MODE.FOLLOW, 2, true, Math.fround(2500.4), [1]]);
  // A new order lets go of the old leader first.
  const c = spaceBall(park, { id: 3, y: 1000 });
  park.orbit(1, 3);
  assert.deepEqual([a.mode, a.followId, a.followRange, [...b.followers], [...c.followers]], [MODE.ORBIT, 3, 1, [], [1]]);
});

test("a follower keeps its range surface to surface, and steers out along x when it sits on its leader", () => {
  const park = new Ballpark();
  const follower = spaceBall(park, { id: 1 });
  const leader = spaceBall(park, { id: 2, x: 1000 });
  park.followBall(1, 2, 100);
  park.evolve();
  // The goto point: on the line between them, 100 + 2 + 2 metres short of the leader's centre.
  assert.deepEqual(follower.goto, { x: 1000 + -1000 * 104 * (1 / 1000), y: 0, z: 0 });
  park.setBallPosition(1, 1000, 0, 0);
  park.evolve();
  assert.deepEqual(follower.goto, { x: 1000 + 104, y: 0, z: 0 });
  assert.equal(leader.newPos.x, 1000);
});

test("an orbiter's plane turns with the tick counter and differs with its id", () => {
  const first = (id, tick) => {
    const park = new Ballpark();
    spaceBall(park, { id: 1 });
    // Off every axis, so that the plane is not decided by a sign alone.
    const orbiter = spaceBall(park, { id, x: 5000, y: 3000, z: 1000 });
    park.currentTime = tick;
    park.orbit(id, 1, 1000);
    park.evolve();
    return orbiter.newPos;
  };
  assert.notDeepEqual(first(2, 0), first(3, 0), "another id, another plane");
  assert.notDeepEqual(first(2, 0), first(2, 500), "a later tick, a turned plane");
  // Only the low sixteen bits of the id count.
  assert.deepEqual(first(2, 0), first(2 + 65536, 0));
  assert.deepEqual(first(2, 0), first(9988400103291 - (9988400103291 % 65536) + 2, 0));
});

test("inside its orbit a ball thrusts outward, outside it inward along the tangent", () => {
  const radial = (x) => {
    const park = new Ballpark();
    spaceBall(park, { id: 1 });
    const orbiter = spaceBall(park, { id: 2, x });
    park.orbit(2, 1, 1000); // the orbit is at 1004 m between centres
    park.evolve();
    return orbiter.lastG.x;
  };
  assert.ok(radial(5000) < 0, "outside: drawn in");
  assert.ok(radial(200) > 0, "inside: pushed out");
});

test("the follow point is (delta * r) * (1/dist), in that order", () => {
  const park = new Ballpark();
  const follower = spaceBall(park, { id: 1 });
  spaceBall(park, { id: 2, x: 1234.5 });
  park.followBall(1, 2, 2500);
  park.evolve();
  const r = 2500 + 2 + 2;
  assert.equal(follower.goto.x, 1234.5 + -1234.5 * r * (1 / 1234.5));
  assert.notEqual(follower.goto.x, 1234.5 + -1234.5 * (r / 1234.5), "the other grouping differs in the last place here");
});

test("one orbit step, set beside the source's lines written out again", () => {
  // Orbitee 1 at the origin, orbiter 2 at 5000 m on the x axis, tick 0, range 1000.
  const park = new Ballpark();
  spaceBall(park, { id: 1 });
  const orbiter = spaceBall(park, { id: 2, x: 5000 });
  park.orbit(2, 1, 1000);
  park.evolve();

  // EvolveOldStyleOrbit, line by line, for this case.
  const cut = (x) => Math.trunc(x * 10000000) / 10000000;
  const [sf, maxVel, mass, agility] = [Math.fround(0.95), 10, 13000000.0, Math.fround(0.9)];
  const maxThrust = (1000000.0 * (sf * maxVel)) / (mass * agility);
  const r = 1000 + 2 + 2;
  const dist = 5000;
  const toVector = [-1, 0, 0];
  // phi1 = 0, phi2 = 2: radial = (cos 2, sin 2, 0) cut, then crossed with toVector and made unit.
  const radialCut = [cut(Math.cos(0) * Math.cos(2)), cut(Math.sin(2)), cut(Math.sin(0) * Math.cos(2))];
  const crossed = [radialCut[1] * toVector[2] - radialCut[2] * toVector[1], radialCut[2] * toVector[0] - radialCut[0] * toVector[2], radialCut[0] * toVector[1] - radialCut[1] * toVector[0]];
  const crossedLength = 1.0 / Math.sqrt(crossed[0] * crossed[0] + crossed[1] * crossed[1] + crossed[2] * crossed[2]);
  const radial = crossed.map((c) => c * crossedLength);
  assert.deepEqual(radial, [0, 0, 1], "for this geometry the tangent is straight up the z axis");
  const toComp = dist * dist - r * r;
  const radComp = (r * Math.sqrt(toComp)) / dist;
  assert.notEqual(radComp, r * (Math.sqrt(toComp) / dist), "the other grouping differs in the last place here");
  const aim = toVector.map((c, i) => c * (toComp / dist) + radial[i] * radComp);
  const aimLength = 1.0 / Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1] + aim[2] * aim[2]);
  const to = aim.map((c) => c * aimLength);
  const radialFactor = cut(Math.exp((-(r - dist) * (r - dist)) / 40000.0));
  const phi = -(to[0] * radial[0] + to[1] * radial[1] + to[2] * radial[2]);
  let transverse = 1.0 + radialFactor * radialFactor * (phi * phi - 1.0);
  transverse = transverse > 0.0 ? radialFactor * phi + Math.sqrt(transverse) : radialFactor * phi;
  transverse *= dist - r >= 0.0 ? 1.0 : -1.0;
  const a = to.map((c, i) => (radial[i] * radialFactor + c * transverse) * maxThrust);

  assert.deepEqual(orbiter.lastG, { x: a[0], y: a[1], z: a[2] });
  // It also leaves a goto point ten AU along that acceleration, for whoever reads the ball's heading.
  assert.deepEqual(orbiter.goto, { x: 5000 + a[0] * (10.0 * 0.1495978707e12), y: 0 + a[1] * (10.0 * 0.1495978707e12), z: 0 + a[2] * (10.0 * 0.1495978707e12) });
  // Far outside the orbit almost none of the thrust goes sideways: it flies at the tangent point.
  assert.ok(radialFactor < 1e-6 && a[0] < 0 && a[2] > 0);
});

// ── a state read into the park, and written out of it ────────────────────────

const recording = require("./fixtures/destinyUndock.json");
const { stateBlobs } = require("./helpers/destinyRecording");
const { FLAG, PACKET, readState: readRecords, writeState: writeRecords } = require("../src/gamePort/destiny/state");
const { DSTLOCALBALLS } = require("../src/gamePort/destiny/ballpark");

/** A blob of records, for the cases the recording does not hold. */
const blobOf = (balls, { packet = PACKET.BALLS, stamp = 500 } = {}) => writeRecords({ packet, stamp, balls });
const record = (fields) => ({
  mode: MODE.STOP, radius: 10, position: vec(), flags: FLAG.FREE, mass: 1000, isCloaked: 0, harmonic: -1, corporationID: -1, allianceID: -1,
  maxVelocity: 100, velocity: vec(), agility: 1, speedFraction: 1, formationID: -1, ...fields,
});

test("the recorded states read into a park and come back out as the server's own bytes", () => {
  const [ship, grid, later] = stateBlobs(recording);
  const park = new Ballpark();

  // The ship alone, as an addition: the park's clock becomes the blob's stamp.
  park.readState(ship.blob, 2);
  assert.equal(park.currentTime, ship.stamp);
  assert.equal(park.balls.size, 1);
  assert.ok(park.writeState([recording.shipID]).equals(ship.blob));

  // The grid's state: the client clears the park, then reads.
  park.clearAll();
  park.readState(grid.blob, 0);
  assert.equal(park.currentTime, grid.stamp);
  assert.equal(park.balls.size, 76);
  assert.deepEqual([...park.freeBalls.keys()], [recording.shipID], "one ball is stepped: the ship");
  assert.ok(park.writeState().equals(grid.blob), "all 3,054 bytes");

  // What is added after joins it.
  const added = park.readState(later.blob, 2);
  assert.equal(park.currentTime, later.stamp);
  assert.equal(park.balls.size, 95);
  assert.equal(park.freeBalls.size, 17);
  assert.ok(park.writeState(added.map((ball) => ball.id)).equals(later.blob), "all 1,747 bytes");
});

test("the ship as the state gives it: flying at its goto point, ready to step", () => {
  const [, grid] = stateBlobs(recording);
  const park = new Ballpark();
  park.readState(grid.blob, 0);
  const ship = park.ball(recording.shipID);
  assert.deepEqual([ship.mode, ship.isFree, ship.isInteractive, ship.isMassive, ship.maxVelocity, ship.mass], [MODE.GOTO, true, true, false, 341, 1157000]);
  assert.equal(ship.timeFactor, Math.exp((-1000000.0 * 1.0) / (1157000 * Math.fround(4.35))));
  // Where it was a tick ago is worked out from its velocity, since the blob does not say.
  assert.deepEqual(ship.oldPos, { x: ship.newPos.x - 1.0 * ship.newVel.x, y: ship.newPos.y - 1.0 * ship.newVel.y, z: ship.newPos.z - 1.0 * ship.newVel.z });
  // A tick on, it has moved along its velocity at about its speed, and nothing else has moved at all.
  const before = { ...ship.newPos };
  const station = { ...park.ball(recording.stationID).newPos };
  park.evolve();
  const moved = Math.hypot(ship.newPos.x - before.x, ship.newPos.y - before.y, ship.newPos.z - before.z);
  // It left the station at its top speed, 341 m/s, and holds it. This far from the sun a
  // coordinate is only good to about a tenth of a millimetre, hence the margin.
  assert.ok(Math.abs(moved - 341) < 1e-3, `it moved ${moved} m`);
  assert.deepEqual(park.ball(recording.stationID).newPos, station);
  assert.equal(park.currentTime, grid.stamp + 1);
  assert.equal(park.unported.gradient, 0, "the ship is not massive while it leaves the station");
});

test("a follower read from a state is hooked to its leader once every ball is in, whatever the order", () => {
  const park = new Ballpark();
  park.readState(blobOf([
    record({ id: 2, mode: MODE.ORBIT, followId: 1, followRange: 5000 }),
    record({ id: 3, mode: MODE.FOLLOW, followId: 99, followRange: 100 }),
    record({ id: 1, mode: MODE.STOP }),
  ]));
  const [leader, orbiter, lost] = [park.ball(1), park.ball(2), park.ball(3)];
  assert.deepEqual([orbiter.mode, orbiter.followPtr === leader, orbiter.followRange, [...leader.followers]], [MODE.ORBIT, true, 5000, [2]]);
  // A leader that is not in the park: the follower is left flying at whatever point it had.
  assert.deepEqual([lost.mode, lost.followPtr, lost.goto], [MODE.GOTO, null, vec()]);
  park.evolve(); // and it can be stepped
});

test("a read sets fields without giving orders, and resets a ball it already knew", () => {
  const park = new Ballpark();
  const ball = spaceBall(park, { id: 7 });
  park.gotoPoint(7, 1, 2, 3);
  Object.assign(ball, { effectStamp: 55, ownerId: 9 });
  park.readState(blobOf([record({ id: 7, mode: MODE.TROLL, effectStamp: 600, isCloaked: 1, harmonic: 12, corporationID: 98000001, allianceID: 99000001, formationID: 2, position: vec(5, 6, 7), velocity: vec(1, 0, 0) })]), 2);
  assert.equal(park.ball(7), ball, "the same ball");
  assert.deepEqual(
    [ball.mode, ball.effectStamp, ball.ownerId, ball.isCloaked, ball.harmonic, ball.corporationID, ball.allianceID, ball.formationID, ball.newPos, ball.newVel],
    [MODE.TROLL, 600, 0, 1, 12, 98000001, 99000001, 2, vec(5, 6, 7), vec(1, 0, 0)],
  );
  assert.equal(park.currentTime, 500);
});

test("a warping ball keeps its warp across a read and a write", () => {
  const warp = record({ id: 4, mode: MODE.WARP, goto: vec(1e12, 2e12, 3e12), effectStamp: -1, totalWarpLength: 4.5e12, minRange: 15000, warpFactor: 3 });
  const park = new Ballpark();
  park.readState(blobOf([warp]), 2);
  const ball = park.ball(4);
  assert.deepEqual([ball.goto, ball.effectStamp, ball.lastCollision, ball.warpMinRange, ball.ownerId], [vec(1e12, 2e12, 3e12), -1, 4.5e12, 15000, 3]);
  assert.ok(park.writeState([4]).equals(blobOf([warp])));
});

test("a full read empties the list of balls that are stepped and removes nothing; an addition keeps the list", () => {
  const park = new Ballpark();
  const old = spaceBall(park, { id: 1 });
  park.readState(blobOf([record({ id: 2 })], { packet: PACKET.FULL_STATE }), 0);
  assert.equal(park.ball(1), old, "still in the park");
  assert.deepEqual([...park.freeBalls.keys()], [2], "but no longer stepped");
  park.readState(blobOf([record({ id: 3 })]), 2);
  assert.deepEqual([...park.freeBalls.keys()].sort(), [2, 3]);
  assert.deepEqual(park.readState(Buffer.alloc(0)), [], "no bytes, no change");
  assert.equal(park.currentTime, 500);
});

test("a fixed ball's collision shapes come from the record, except on a rewind, which leaves them", () => {
  const shapes = { miniBalls: [{ center: vec(1, 2, 3), radius: 4 }], miniCapsules: [], miniBoxes: [] };
  const fixed = (extra = {}) => record({ id: 1, mode: MODE.RIGID, flags: FLAG.GLOBAL, ...extra });
  const park = new Ballpark();
  park.readState(blobOf([fixed(shapes)]), 2);
  assert.deepEqual(park.ball(1).miniBalls, shapes.miniBalls);
  park.readState(blobOf([fixed()]), 1);
  assert.deepEqual(park.ball(1).miniBalls, shapes.miniBalls, "a rewind leaves them");
  park.readState(blobOf([fixed()]), 2);
  assert.deepEqual(park.ball(1).miniBalls, [], "an addition replaces them");
});

test("a state written by the park leaves out the dead and, when it is the whole park, the client's own balls", () => {
  const park = new Ballpark();
  spaceBall(park, { id: 1 });
  spaceBall(park, { id: 2 });
  spaceBall(park, { id: DSTLOCALBALLS - 1 });
  park.currentTime = 42;
  park.removeBall(2, 5);
  const ids = (bytes) => readRecords(bytes).balls.map((ball) => ball.id);
  const full = park.writeState();
  assert.deepEqual([full[0], full.readInt32LE(1), ids(full)], [PACKET.FULL_STATE, 42, [1]]);
  // Asked for by id, a local ball is written; a dead one still is not.
  const some = park.writeState([DSTLOCALBALLS - 1, 2, 999]);
  assert.deepEqual([some[0], ids(some)], [PACKET.BALLS, [DSTLOCALBALLS - 1]]);
});

// ── removing ─────────────────────────────────────────────────────────────────

test("a ball removed at once is gone; one removed with a delay stops taking part and goes when its time is up", () => {
  const park = new Ballpark();
  spaceBall(park, { id: 1 });
  const dying = spaceBall(park, { id: 2 });
  park.setBallVelocity(2, 5, 0, 0);
  park.currentTime = 100;
  park.removeBall(1);
  assert.deepEqual([park.ball(1), park.freeBalls.has(1)], [null, false]);
  park.removeBall(99); // nothing there

  park.removeBall(2, 5);
  assert.deepEqual([dying.isMoribund, dying.isMassive, dying.effectStamp, dying.mode, park.ball(2) === dying], [true, false, 105, MODE.STOP, true]);
  const where = { ...dying.newPos };
  park.evolve();
  assert.deepEqual(dying.newPos, where, "not stepped");
  // Not yet: more than two ticks to go.
  park.bringOutDeadBalls();
  assert.equal(park.ball(2), dying);
  // Two whole ticks to go is still too soon; within two, it may go early.
  park.currentTime = 103;
  park.bringOutDeadBalls();
  assert.equal(park.ball(2), dying);
  park.currentTime = 104;
  park.bringOutDeadBalls();
  assert.equal(park.ball(2), null);
  assert.equal(park.moribundBalls.size, 0);
});

test("only seven go early in one call; the rest wait for their time to pass", () => {
  const park = new Ballpark();
  for (let id = 1; id <= 10; id += 1) {
    spaceBall(park, { id });
    park.removeBall(id, 3);
  }
  park.currentTime = 2; // one tick to go: within the buffer of two
  park.bringOutDeadBalls();
  assert.equal(park.balls.size, 3);
  park.bringOutDeadBalls();
  assert.equal(park.balls.size, 0);
  // Past its time, a ball goes whatever the count.
  for (let id = 1; id <= 10; id += 1) {
    spaceBall(park, { id });
    park.removeBall(id, 1);
  }
  park.currentTime = 10;
  park.bringOutDeadBalls();
  assert.equal(park.balls.size, 0);
});

test("when a ball goes, its followers stop, except a missile or an interactive orbiter, which fly on", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  const follower = spaceBall(park, { id: 2, x: 100 });
  const orbiter = spaceBall(park, { id: 3, x: 200 });
  const dull = spaceBall(park, { id: 4, x: 300 });
  park.followBall(2, 1);
  park.orbit(3, 1);
  park.orbit(4, 1);
  orbiter.isInteractive = true;
  park.setBallVelocity(3, 0, 7, 0);
  // A follower the leader lists but that no longer follows it is only struck off.
  leader.followers.add(77);
  park.removeBall(1);
  assert.deepEqual([follower.mode, follower.followPtr, follower.followId], [MODE.STOP, null, 0]);
  assert.equal(dull.mode, MODE.STOP, "an orbiter that is not interactive stops");
  assert.equal(orbiter.mode, MODE.GOTO, "an interactive one flies on the way it was going");
  assert.deepEqual(orbiter.goto, { x: 200 + 0 * 1.0e17, y: 0 + 1 * 1.0e17, z: 0 + 0 * 1.0e17 });
  assert.equal(leader.followers.size, 0);
});

test("a ball that goes lets go of its own leader first", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  const follower = spaceBall(park, { id: 2, x: 100 });
  park.followBall(2, 1);
  park.removeBall(2, 5);
  assert.deepEqual([[...leader.followers], follower.mode, follower.followPtr, follower.followId], [[], MODE.STOP, null, 0]);
});

test("a missile whose target goes flies on, and stops being massive", () => {
  const park = new Ballpark();
  spaceBall(park, { id: 1 });
  const missile = spaceBall(park, { id: 2, x: 100 });
  Object.assign(missile, { mode: MODE.MISSILE, followId: 1, followPtr: park.ball(1), isMassive: true });
  park.ball(1).followers.add(2);
  park.setBallVelocity(2, -3, 0, 0);
  park.removeBall(1);
  assert.deepEqual([missile.mode, missile.isMassive, missile.goto.x < -1e16], [MODE.GOTO, false, true]);
});

test("clearing the park leaves nothing", () => {
  const park = new Ballpark();
  spaceBall(park, { id: 1 });
  spaceBall(park, { id: 2 });
  park.removeBall(2, 9);
  park.clearAll();
  assert.deepEqual([park.balls.size, park.freeBalls.size, park.moribundBalls.size], [0, 0, 0]);
});

// ── the small setters, and the balls that are not ships ──────────────────────

test("global and interactive are plain flags", () => {
  const park = new Ballpark();
  const ball = spaceBall(park, { id: 1 });
  park.setBallGlobal(1, 1);
  park.setBallInteractive(1, 1);
  assert.deepEqual([ball.isGlobal, ball.isInteractive], [true, true]);
  park.setBallGlobal(1, 0);
  park.setBallInteractive(1, 0);
  assert.deepEqual([ball.isGlobal, ball.isInteractive], [false, false]);
  park.setBallGlobal(404, 1); // a ball that is not there is nothing
  park.setBallInteractive(404, 1);
});

test("a ball made a field lets go of what it followed and stays put as one; unmade, it is stopped", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  const tower = spaceBall(park, { id: 2, x: 5000 });
  park.orbit(2, 1, 1000);
  park.setBallHarmonic(2, 77, 98000001, 99000001, 1);
  assert.deepEqual([tower.mode, tower.harmonic, tower.corporationID, tower.allianceID, tower.followId, [...leader.followers]], [MODE.FIELD, 77, 98000001, 99000001, 0, []]);
  // Only the numbers change while it stays a field.
  park.setBallHarmonic(2, 78, 98000002, 99000002, 1);
  assert.deepEqual([tower.mode, tower.harmonic, tower.corporationID, tower.allianceID], [MODE.FIELD, 78, 98000002, 99000002]);
  park.setBallHarmonic(2, -1, -1, -1, 0);
  assert.deepEqual([tower.mode, tower.harmonic], [MODE.STOP, -1]);
  // A ball that was never a field keeps doing what it was doing.
  park.orbit(2, 1, 1000);
  park.setBallHarmonic(2, 5, 1, 2, 0);
  assert.deepEqual([tower.mode, tower.harmonic, tower.followId], [MODE.ORBIT, 5, 1]);
});

test("a ball made rigid lets go of what it followed", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  const ball = spaceBall(park, { id: 2, x: 5000 });
  park.followBall(2, 1, 100);
  park.setBallRigid(2);
  assert.deepEqual([ball.mode, ball.followId, [...leader.followers]], [MODE.RIGID, 0, []]);
});

test("a troll is made free and interactive, given at least a tick, and petrified when its stamp is no longer ahead", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  park.addBall({ id: 2, x: 5000 }); // fixed, as a wreck's ball arrives
  park.addBall({ id: 3, x: 9000 });
  const wreck = park.ball(2);
  park.currentTime = 40;
  park.setBallTroll(2, 0);
  assert.deepEqual([wreck.mode, wreck.effectStamp, wreck.isFree, wreck.isInteractive, park.freeBalls.has(2)], [MODE.TROLL, 41, true, true, true], "no delay is one tick");
  park.setBallTroll(3, 2);
  assert.equal(park.ball(3).effectStamp, 42);
  park.evolve(); // the step taken at 40: 41 is still ahead
  assert.deepEqual([wreck.mode, park.ball(3).mode], [MODE.TROLL, MODE.TROLL]);
  park.evolve(); // at 41: no longer ahead
  assert.deepEqual([wreck.mode, wreck.isFree, wreck.isInteractive, park.freeBalls.has(2), park.ball(3).mode], [MODE.RIGID, false, false, false, MODE.TROLL]);
  park.evolve();
  assert.equal(park.ball(3).mode, MODE.RIGID);
  // A ball that was following something lets go when it is made a troll.
  const drone = spaceBall(park, { id: 4, x: 100 });
  park.followBall(4, 1, 50);
  park.setBallTroll(4, 5);
  assert.deepEqual([drone.mode, drone.followId, [...leader.followers]], [MODE.TROLL, 0, []]);
});

test("a free mushroom is not stepped: the park says so rather than leave it standing", () => {
  const park = new Ballpark();
  const ball = spaceBall(park, { id: 1 });
  ball.mode = MODE.MUSHROOM;
  assert.throws(() => park.evolve(), DestinyNotPorted);
});

test("a ball that cloaks shakes off its followers and stops being massive; uncloaked, it is massive again", () => {
  const park = new Ballpark();
  const ship = spaceBall(park, { id: 1 });
  const hunter = spaceBall(park, { id: 2, x: 3000 });
  park.followBall(2, 1, 500);
  park.cloakBall(1, 0); // a cloak mode of nothing is no cloak
  assert.deepEqual([ship.isCloaked, ship.isMassive, hunter.mode], [0, true, MODE.FOLLOW]);
  park.cloakBall(1, 2);
  assert.deepEqual([ship.isCloaked, ship.isMassive, hunter.mode, hunter.followId, [...ship.followers]], [2, false, MODE.STOP, 0, []]);
  park.uncloakBall(1);
  assert.deepEqual([ship.isCloaked, ship.isMassive], [0, true]);
});

test("a ball uncloaked in warp proper stays unmassive; one still lining up for it does not", () => {
  const park = new Ballpark();
  const ship = spaceBall(park, { id: 1 });
  park.cloakBall(1, 1);
  Object.assign(ship, { mode: MODE.WARP, effectStamp: 12 });
  assert.equal(isWarping(ship), true);
  park.uncloakBall(1);
  assert.deepEqual([ship.isCloaked, ship.isMassive], [0, false]);
  // effectStamp below zero: the warp has been ordered but the ship is still turning to it.
  Object.assign(ship, { effectStamp: -1 });
  assert.equal(isWarping(ship), false);
  park.uncloakBall(1);
  assert.equal(ship.isMassive, true);
  assert.equal(isWarping({ mode: MODE.GOTO, effectStamp: 12 }), false);
  assert.equal(isWarping({ mode: MODE.WARP, effectStamp: 0 }), true);
});

test("the Stop order leaves a stopped ball alone and stops any other", () => {
  const park = new Ballpark();
  const leader = spaceBall(park, { id: 1 });
  const ball = spaceBall(park, { id: 2, x: 100 });
  park.followBall(2, 1, 50);
  park.stopOrder(2);
  assert.deepEqual([ball.mode, ball.followId, [...leader.followers]], [MODE.STOP, 0, []]);
  park.stopOrder(2);
  park.stopOrder(404);
  assert.equal(ball.mode, MODE.STOP);
  park.setBallRigid(2);
  park.stopOrder(2);
  assert.equal(ball.mode, MODE.STOP, "a rigid ball told to stop is a stopped ball");
});
