"use strict";

// A game-port pilot in space: the ballpark it keeps (src/gamePort/pilotSpace.js)
// and what the web client is shown of it (src/gamePort/spaceProjection.js).
//
// The ballpark's own logic is tested in destinyPark.test.js and
// destinyBallpark.test.js. Here: that it is made, fed, stepped and let go as
// the retail client's michelle does those things, and that the projection says
// what the gateway's snapshot says wherever a client is in a position to know.

const test = require("node:test");
const assert = require("node:assert/strict");
const { BIND_TRIES, createPilotSpace } = require("../src/gamePort/pilotSpace");
const { CATEGORY, healthOf, kindOf, projectFlight, projectSpace } = require("../src/gamePort/spaceProjection");
const { Ballpark } = require("../src/gamePort/destiny/ballpark");
const { Park } = require("../src/gamePort/destiny/park");
const { MODE } = require("../src/gamePort/destiny/state");
const undock = require("./fixtures/destinyUndock.json");
const { destinyUpdates, notifications } = require("./helpers/destinyRecording");

const SYSTEM = 30000142;

/** A stand-in session that keeps what it was asked, in order. */
function fakeSession({ bindFailures = 0, formationsError = null } = {}) {
  const session = {
    asked: [],
    async call(service, method, args) {
      session.asked.push(`call ${service}.${method}`);
      if (formationsError) throw formationsError;
      return [service, method, args];
    },
    async bind(service, params) {
      session.asked.push(`bind ${service} ${params}`);
      if (bindFailures > 0) {
        bindFailures -= 1;
        throw new Error("not yet");
      }
      return { objectID: "N=1:7", nodeID: 1, result: null };
    },
    async callBound(objectID, method, args) {
      session.asked.push(`bound ${objectID} ${method}`);
      return [objectID, method, args];
    },
  };
  return session;
}

/** A pilot's space whose park ticks only when the test says so. */
function handTicked(sessionOptions = {}, options = {}) {
  const session = fakeSession(sessionOptions);
  const state = { tick: null, started: 0, stopped: 0, slept: [], errors: [] };
  const space = createPilotSpace({
    session,
    solarSystemID: SYSTEM,
    startTicking: (tick, ms) => { state.tick = tick; state.started += 1; state.tickMs = ms; session.asked.push("the park starts ticking"); return "timer"; },
    stopTicking: (timer) => { state.stopped += timer === "timer" ? 1 : 100; },
    sleep: async (ms) => { state.slept.push(ms); },
    onError: (error, what) => state.errors.push([what, error.message]),
    ...options,
  });
  return { session, space, state };
}

test("a ballpark is made as michelle makes one: formations asked for, the park ticking once a second, the system's ballpark bound", async () => {
  const { session, space, state } = handTicked();
  assert.deepEqual([state.started, space.remotePark, space.park.validState], [0, null, false]);
  assert.equal(await space.start(), "N=1:7");
  assert.deepEqual(session.asked, ["call beyonce.GetFormations", "the park starts ticking", `bind beyonce ${SYSTEM}`]);
  assert.deepEqual([state.started, state.tickMs, space.remotePark, space.solarSystemID], [1, 1000, "N=1:7", SYSTEM]);
  assert.deepEqual(space.formations, ["beyonce", "GetFormations", []]);
  // Asked again, by whoever wants the remote ballpark: the same one, not another.
  assert.equal(await space.remote(), "N=1:7");
  assert.equal(await space.start(), "N=1:7");
  assert.deepEqual([session.asked.length, state.started], [3, 1]);
});

test("the bind is tried again a second later, ten times at most", async () => {
  const late = handTicked({ bindFailures: 2 });
  assert.equal(await late.space.start(), "N=1:7");
  assert.deepEqual([late.state.slept, late.state.errors.map(([what]) => what)], [[1000, 1000], ["bind", "bind"]]);
  assert.equal(late.session.asked.filter((line) => line.startsWith("bind")).length, 3);

  const never = handTicked({ bindFailures: 99 });
  assert.equal(await never.space.start(), null);
  assert.equal(never.session.asked.filter((line) => line.startsWith("bind")).length, BIND_TRIES);
  assert.deepEqual([BIND_TRIES, never.state.slept.length, never.space.remotePark], [10, 9, null]);
  // The park ticks all the same: it is the server's state that has not come.
  assert.equal(never.state.started, 1);

  // Let go while still trying: it stops trying.
  const gone = handTicked({ bindFailures: 99 });
  gone.state.slept.push = function push(ms) {
    Array.prototype.push.call(this, ms);
    if (this.length === 2) gone.space.release();
    return this.length;
  };
  assert.equal(await gone.space.start(), null);
  assert.equal(gone.session.asked.filter((line) => line.startsWith("bind")).length, 2);
});

test("a park is fed the session's ballpark updates and nothing else, and steps when ticked", async () => {
  const { space, state } = handTicked();
  await space.start();
  const all = notifications(undock);
  const fed = all.map((notification) => [notification.method, space.feed(notification)]);
  assert.ok(fed.some(([method]) => method !== "DoDestinyUpdate"), "the recording holds other notifications too");
  for (const [method, taken] of fed) assert.equal(taken, method === "DoDestinyUpdate", method);
  assert.equal(space.park.validState, false, "nothing is applied until the park ticks");
  state.tick();
  assert.deepEqual([space.park.validState, space.park.ego], [true, undock.shipID]);

  // Given only what had arrived by the first second of the flight, each tick is one step.
  const updates = destinyUpdates(undock);
  const first = handTicked();
  await first.space.start();
  for (const update of updates.slice(0, 5)) first.space.feed({ method: "DoDestinyUpdate", args: [{ type: "list", items: update.entries }, update.waitForBubble] });
  first.state.tick();
  const stamp = updates[2].entries[0][0];
  assert.deepEqual([first.space.park.currentTime, first.space.park.ballpark.balls.size], [stamp + 1, 76]);
  first.state.tick();
  assert.equal(first.space.park.currentTime, stamp + 2);
  // An update is handed over whole: its entries, whether more is to come for that tick, and the dogma messages riding with it.
  const whole = handTicked();
  await whole.space.start();
  const messages = [];
  whole.space.park.onMultiEvent = (list) => messages.push(list);
  whole.space.feed({ method: "DoDestinyUpdate", args: [{ type: "list", items: updates[0].entries }, true, { type: "list", items: [["OnModuleAttributeChanges", []]] }] });
  assert.deepEqual([whole.space.park.history.map(([, wait]) => wait), messages], [[true], [[["OnModuleAttributeChanges", []]]]]);
  // Several updates in one notification.
  const other = handTicked();
  await other.space.start();
  assert.equal(other.space.feed({ method: "DoDestinyUpdates", args: [{ type: "list", items: updates.slice(0, 5).map((update) => [update.entries, update.waitForBubble]) }] }), true);
  other.state.tick();
  assert.equal(other.space.park.ballpark.balls.size, 76);
  assert.deepEqual([state.errors, other.state.errors], [[], []]);
});

test("what goes wrong in the park's own time is reported and does not stop it", async () => {
  const { space, state } = handTicked();
  await space.start();
  assert.equal(space.feed({ method: "DoDestinyUpdate", args: [{ type: "list", items: [[7, null]] }, false] }), true);
  space.park.tick = () => { throw new Error("a step that cannot be taken"); };
  state.tick();
  assert.deepEqual(state.errors.map(([what]) => what), ["DoDestinyUpdate", "tick"]);
  assert.equal(state.errors[1][1], "a step that cannot be taken");
});

test("a park that has lost its place asks its remote ballpark for the whole state, as the client does", async () => {
  const { session, space, state } = handTicked();
  space.park.requestReset(); // before anything is bound there is nobody to ask
  assert.deepEqual(session.asked, []);
  await space.start();
  space.park.requestReset();
  assert.equal(session.asked.at(-1), "bound N=1:7 UpdateStateRequest");
  // If the asking fails, that is reported like anything else in the park's own time.
  session.callBound = async () => { throw new Error("gone"); };
  space.park.requestReset();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.errors, [["UpdateStateRequest", "gone"]]);
});

test("a park let go stops ticking, takes nothing more, and asks for nothing", async () => {
  const { session, space, state } = handTicked();
  await space.start();
  space.release();
  space.release();
  assert.deepEqual([state.stopped, space.released, space.remotePark], [1, true, null]);
  assert.equal(space.feed(notifications(undock).find((notification) => notification.method === "DoDestinyUpdate")), false);
  const asked = session.asked.length;
  space.park.requestReset();
  assert.equal(session.asked.length, asked);

  // Let go while the formations are still being asked for: it never starts.
  const early = handTicked();
  const starting = early.space.start();
  early.space.release();
  assert.equal(await starting, null);
  assert.deepEqual([early.state.started, early.session.asked], [0, ["call beyonce.GetFormations"]]);
});

test("formations that cannot be had do not keep the pilot blind: the park still starts", async () => {
  // The retail client would be left without a ballpark here. A web pilot with no view of space is worse than one without formations.
  const { session, space, state } = handTicked({ formationsError: new Error("no formations") });
  assert.equal(await space.start(), "N=1:7");
  assert.deepEqual([state.errors, state.started, session.asked.at(-1)], [[["GetFormations", "no formations"]], 1, `bind beyonce ${SYSTEM}`]);
});

// ── what the web client is shown ─────────────────────────────────────────────

test("what a thing is, told from its slim item's category and group", () => {
  assert.deepEqual(
    [[6, 237], [3, 15], [65, 1657], [18, 100], [87, 1652], [25, 462], [46, 1025], [11, 99], [11, 550], [2, 6], [2, 7], [2, 8], [2, 9], [2, 10], [2, 186], [2, 12], [2, 340], [2, 448], [2, 649], [2, 226], [7, 53], [null, null]]
      .map(([category, group]) => kindOf(category, group)),
    ["ship", "station", "structure", "drone", "fighter", "asteroid", "orbital", "sentryGun", "ship", "sun", "planet", "moon", "asteroidBelt", "stargate", "wreck", "container", "container", "container", "container", "celestial", null, null],
  );
  assert.equal(CATEGORY.ENTITY, 11);
});

test("health is what the damage state says, with the shield brought forward by its own recharge", () => {
  // ((shield, tau in ms, when), armour, hull). One second on, a quarter shield with tau 1000 ms has recharged to (1 - 0.5/e)^2.
  const state = [[0.25, 1000, 134359116934190000n], 0.5, 0.75];
  assert.deepEqual(healthOf(state, 0), { shieldRatio: 0.25, armorRatio: 0.5, hullRatio: 0.75 });
  const later = healthOf(state, 1);
  assert.ok(Math.abs(later.shieldRatio - (1 - 0.5 / Math.E) ** 2) < 1e-15);
  assert.deepEqual([later.armorRatio, later.hullRatio], [0.5, 0.75]);
  assert.ok(healthOf(state, 3600).shieldRatio > 0.999999, "given long enough it is full");
  // No recharge time: the shield is as stated. Fractions are kept within 0 and 1.
  assert.equal(healthOf([[0.25, 0, 0], 1, 1], 99).shieldRatio, 0.25);
  assert.deepEqual(healthOf([[1.5, 0, 0], -0.1, 2], 0), { shieldRatio: 1, armorRatio: 0, hullRatio: 1 });
  // A shield given as nothing, and no damage state at all.
  assert.deepEqual(healthOf([null, 0.5, 0.75], 5), { shieldRatio: null, armorRatio: 0.5, hullRatio: 0.75 });
  for (const nothing of [null, undefined, [], [1, 2]]) assert.deepEqual(healthOf(nothing, 0), { shieldRatio: null, armorRatio: null, hullRatio: null });
});

/** A park fed the first updates of the undock recording and ticked until the grid is whole. */
function undockedPark() {
  const park = new Park();
  const updates = destinyUpdates(undock);
  for (const update of updates.slice(0, 5)) park.doDestinyUpdate(update.entries, update.waitForBubble);
  for (let i = 0; i < 4; i += 1) park.tick();
  return park;
}

test("the snapshot of a real grid: every ball that has a slim item, in the gateway's shape", () => {
  const park = undockedPark();
  const space = projectSpace(park, { solarSystemID: SYSTEM, shipID: undock.shipID });
  assert.deepEqual([space.inSpace, space.solarSystemID, space.shipID, space.sampledAtMs, space.entities.length], [true, SYSTEM, undock.shipID, park.currentTime * 1000, 95]);
  const kinds = new Map();
  for (const row of space.entities) kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
  assert.deepEqual([...kinds].sort(), [["celestial", 3], ["moon", 33], ["orbital", 8], ["planet", 8], ["sentryGun", 16], ["ship", 1], ["stargate", 7], ["station", 18], ["sun", 1]]);
  const row = (id) => space.entities.find((entity) => entity.itemID === id);
  const ball = park.ballpark.ball(undock.shipID);

  // The pilot's own ship.
  assert.deepEqual(row(undock.shipID), {
    kind: "ship", itemID: undock.shipID, typeID: 588, groupID: 237, categoryID: 6, name: "Reaper", ownerID: undock.characterID,
    radius: ball.radius, position: { ...ball.newPos }, velocity: { ...ball.newVel }, isSelf: true,
    shieldRatio: 1, armorRatio: 1, hullRatio: 1,
    characterID: undock.characterID, corporationID: 1000044, allianceID: null, securityStatus: 0, maxVelocity: 341, mode: "GOTO",
    targetEntityID: null, capacitorRatio: null, isNpc: false, npcEntityType: null, compressionFacility: null,
  });
  assert.deepEqual(space.ship, {
    itemID: undock.shipID, typeID: 588, name: "Reaper", mode: "GOTO", maxVelocity: 341, radius: ball.radius,
    position: { ...ball.newPos }, velocity: { ...ball.newVel }, shieldRatio: 1, armorRatio: 1, hullRatio: 1,
    capacitorRatio: null, shieldCapacity: null, armorCapacity: null, hullCapacity: null,
    activeModuleIDs: [], overloadedModuleIDs: [], moduleDamage: {}, weaponBanks: {},
  });
  // A station: no ship's fields, and the health the server sent for it.
  const station = row(60003760);
  assert.deepEqual(Object.keys(station), ["kind", "itemID", "typeID", "groupID", "categoryID", "name", "ownerID", "radius", "position", "velocity", "isSelf", "shieldRatio", "armorRatio", "hullRatio"]);
  assert.deepEqual([station.kind, station.name, station.typeID, station.ownerID, station.isSelf, station.velocity], ["station", "Jita IV - Moon 4 - Caldari Navy Assembly Plant", 52678, 1000035, false, { x: 0, y: 0, z: 0 }]);
  // A moon has no health; a sentry gun's slim item has no name.
  const moon = row(40009081);
  assert.deepEqual([moon.kind, moon.name, moon.radius, moon.shieldRatio, moon.armorRatio, moon.hullRatio], ["moon", "Jita III - Moon 1", 560000, null, null, null]);
  const gun = space.entities.find((entity) => entity.kind === "sentryGun");
  assert.deepEqual([gun.name, gun.categoryID, gun.groupID, gun.typeID > 0], [null, 11, 99, true]);
});

test("what dogma says of the pilot's own ship goes where the ballpark has nothing to say", () => {
  const park = undockedPark();
  const readings = { capacitorRatio: 0.625, shieldCapacity: 175, armorCapacity: 150, hullCapacity: 151 };
  const space = projectSpace(park, { solarSystemID: SYSTEM, shipID: undock.shipID, readings });
  assert.deepEqual([space.ship.capacitorRatio, space.ship.shieldCapacity, space.ship.armorCapacity, space.ship.hullCapacity], [0.625, 175, 150, 151]);
  assert.equal(space.entities.find((row) => row.isSelf).capacitorRatio, 0.625);
  // Nobody else's capacitor is known, and health is still the ballpark's.
  assert.ok(space.entities.filter((row) => !row.isSelf).every((row) => row.capacitorRatio === undefined || row.capacitorRatio === null));
  assert.deepEqual([space.ship.shieldRatio, space.ship.armorRatio, space.ship.hullRatio], [1, 1, 1]);
});

test("a ball with no slim item, and one on its way out, are not rows", () => {
  const park = undockedPark();
  park.ballpark.addBall({ id: -2000000001, x: 5 }); // a ball of the client's own
  park.ballpark.addBall({ id: 777, x: 9 }); // added, slim item not come
  park.ballpark.removeBall(60003466, 30); // exploding for 30 ticks
  const space = projectSpace(park, { solarSystemID: SYSTEM, shipID: undock.shipID });
  assert.equal(space.entities.length, 94);
  assert.deepEqual([-2000000001, 777, 60003466].map((id) => space.entities.some((row) => row.itemID === id)), [false, false, false]);
});

test("a ship's row says what it is doing, who it follows, and whether anyone is flying it", () => {
  const park = undockedPark();
  const slim = (fields) => new Map(Object.entries(fields));
  // A rat: a ship of the Entity category, orbiting the pilot.
  park.ballpark.addBall({ id: 9000000000001, isFree: true, mass: 1e6, x: 1e3, maxVelocity: 250 });
  park.slimItems.set(9000000000001, slim({ itemID: 9000000000001, typeID: 23707, groupID: 550, categoryID: 11, ownerID: 500010 }));
  park.ballpark.orbit(9000000000001, undock.shipID, 7500);
  // Another pilot, stopped, damaged, with a shield that recharges.
  park.ballpark.addBall({ id: 9000000000002, isFree: true, mass: 1e6, x: 2e3, maxVelocity: 0 });
  park.slimItems.set(9000000000002, slim({ itemID: 9000000000002n, typeID: 587, groupID: 25, categoryID: 6, ownerID: 140000009, charID: 140000009, corpID: 98000001, allianceID: 99000001, securityStatus: -2.5, name: Buffer.from("Rifter") }));
  park._damage(9000000000002, [[0.25, 1000, 0n], 0.5, 0.75]);
  park.tick();
  const space = projectSpace(park, { solarSystemID: SYSTEM, shipID: undock.shipID });
  const rat = space.entities.find((row) => row.itemID === 9000000000001);
  assert.deepEqual([rat.kind, rat.isNpc, rat.mode, rat.targetEntityID, rat.maxVelocity, rat.characterID, rat.name], ["ship", true, "ORBIT", undock.shipID, 250, null, null]);
  const pilot = space.entities.find((row) => row.itemID === 9000000000002);
  assert.deepEqual([pilot.kind, pilot.isNpc, pilot.mode, pilot.targetEntityID, pilot.maxVelocity, pilot.characterID, pilot.corporationID, pilot.allianceID, pilot.securityStatus, pilot.name],
    ["ship", false, "STOP", null, null, 140000009, 98000001, 99000001, -2.5, "Rifter"]);
  assert.ok(Math.abs(pilot.shieldRatio - (1 - 0.5 / Math.E) ** 2) < 1e-15, "one tick of recharge since the state came");
  assert.deepEqual([pilot.armorRatio, pilot.hullRatio], [0.5, 0.75]);

  // A structure carries the same fields a ship does. An empty name is no name.
  park.ballpark.addBall({ id: 1030000000001, x: 9e5, radius: 5000 });
  park.slimItems.set(1030000000001, slim({ itemID: 1030000000001n, typeID: 35832, groupID: 1657, categoryID: 65, ownerID: 98000001, corpID: 98000001, allianceID: 0, name: Buffer.alloc(0) }));
  // A ball that once followed something and is now only flying keeps no target.
  Object.assign(park.ballpark.ball(9000000000002), { followId: undock.shipID });
  const again = projectSpace(park, { solarSystemID: SYSTEM, shipID: undock.shipID });
  const structure = again.entities.find((row) => row.itemID === 1030000000001);
  assert.deepEqual([structure.kind, structure.name, structure.corporationID, structure.allianceID, structure.mode, structure.isNpc, structure.maxVelocity], ["structure", null, 98000001, null, "STOP", false, null]);
  assert.equal(again.entities.find((row) => row.itemID === 9000000000002).targetEntityID, null);
});

test("the flight status's movement is the pilot's own ball; with no ball there is nothing to say", () => {
  const park = undockedPark();
  assert.deepEqual(projectFlight(park), { shipMode: "GOTO", shipSpeedFraction: 1 });
  park.ballpark.setSpeedFraction(undock.shipID, 0.5);
  park.ballpark.stop(undock.shipID);
  assert.deepEqual(projectFlight(park), { shipMode: "STOP", shipSpeedFraction: 0.5 });
  park.ballpark.ball(undock.shipID).mode = MODE.WARP;
  assert.equal(projectFlight(park).shipMode, "WARP");
  assert.deepEqual(projectFlight(new Park({ ballpark: new Ballpark() })), { shipMode: null, shipSpeedFraction: null });
  park.ballpark.removeBall(undock.shipID);
  assert.deepEqual(projectFlight(park), { shipMode: null, shipSpeedFraction: null });
  assert.equal(projectSpace(park, { solarSystemID: SYSTEM, shipID: undock.shipID }).ship, null);
});
