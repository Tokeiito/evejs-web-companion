"use strict";

// What the web client is shown of space, read from the client's own park.
//
// On the gateway, `/space/snapshot` and `/session/flight-status` are
// projections of the server's scene. A pilot on the game port has no such
// window: it has what the retail client has, a ballpark it steps itself
// (destiny/park.js), the slim item the server sent with each ball, and the
// damage states. This turns those into the same JSON the gateway answers with,
// so the routes and the browser above do not change.
//
// Where the gateway reads something only the server knows, this says so and
// answers null rather than guess. The shape and each field's meaning are
// docs/bridge-wire-contract.md, "POST /_evejs-web/v1/space/snapshot".

const { MODE, MODE_NAME } = require("./destiny/state");

/** inventorycommon/const.py. */
const CATEGORY = { CELESTIAL: 2, STATION: 3, SHIP: 6, ENTITY: 11, DRONE: 18, ASTEROID: 25, ORBITAL: 46, STRUCTURE: 65, FIGHTER: 87 };
const GROUP = {
  SUN: 6, PLANET: 7, MOON: 8, ASTEROID_BELT: 9, STARGATE: 10, CARGO_CONTAINER: 12, SENTRY_GUN: 99, WRECK: 186,
  SECURE_CARGO_CONTAINER: 340, AUDIT_LOG_SECURE_CONTAINER: 448, FREIGHT_CONTAINER: 649,
};
/**
 * The shield's recharge constant, tau, is in milliseconds: the client divides
 * the difference of two readings of its clock (in 100 ns) by
 * dogmaConst.dgmTauConstant, 10000, and then by tau.
 */
const MS_PER_SECOND = 1000;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const positive = (value) => {
  const n = number(value);
  return n !== null && n > 0 ? n : null;
};
const vector = (v) => ({ x: v.x, y: v.y, z: v.z });

/**
 * The word the gateway's rows carry for what a thing is. There it is the
 * server's own name for the entity; here it is told from the slim item's
 * category and group, which is all the retail client has to go on.
 *
 * Seen to agree with the server on a live grid: station, sun, planet, moon,
 * stargate, sentryGun, orbital, ship. The rest follow the same constants and
 * have not been set beside the server's word yet. Two things cannot be told
 * this way and are not attempted: the server's "authoredSpaceProp" (scenery it
 * placed itself, an ordinary celestial to a client), and anything in a category
 * not listed, which answers null.
 */
function kindOf(categoryID, groupID) {
  switch (categoryID) {
    case CATEGORY.SHIP: return "ship";
    case CATEGORY.STATION: return "station";
    case CATEGORY.STRUCTURE: return "structure";
    case CATEGORY.DRONE: return "drone";
    case CATEGORY.FIGHTER: return "fighter";
    case CATEGORY.ASTEROID: return "asteroid";
    case CATEGORY.ORBITAL: return "orbital";
    case CATEGORY.ENTITY: return groupID === GROUP.SENTRY_GUN ? "sentryGun" : "ship";
    case CATEGORY.CELESTIAL:
      switch (groupID) {
        case GROUP.SUN: return "sun";
        case GROUP.PLANET: return "planet";
        case GROUP.MOON: return "moon";
        case GROUP.ASTEROID_BELT: return "asteroidBelt";
        case GROUP.STARGATE: return "stargate";
        case GROUP.WRECK: return "wreck";
        case GROUP.CARGO_CONTAINER:
        case GROUP.SECURE_CARGO_CONTAINER:
        case GROUP.AUDIT_LOG_SECURE_CONTAINER:
        case GROUP.FREIGHT_CONTAINER: return "container";
        default: return "celestial";
      }
    default: return null;
  }
}

/**
 * eveInflight.damageStateValue.CalculateCurrentDamageStateValues: what is left
 * of shield, armour and hull, each as a fraction. A damage state is
 * ((shield, tau, when), armour, hull); the shield recharges on its own, so its
 * fraction is brought forward from when the state arrived.
 */
function healthOf(damageState, secondsSince) {
  if (!Array.isArray(damageState) || damageState.length < 3) return { shieldRatio: null, armorRatio: null, hullRatio: null };
  const ratio = (value) => {
    const n = number(value);
    return n === null ? null : Math.min(1, Math.max(0, n));
  };
  let shield = null;
  const shieldValues = damageState[0];
  if (Array.isArray(shieldValues)) {
    shield = number(shieldValues[0]);
    const tau = number(shieldValues[1]);
    if (shield !== null && tau !== null && tau > 0) {
      const eToX = Math.exp((-secondsSince * MS_PER_SECOND) / tau);
      shield = (1.0 + (Math.sqrt(shield) - 1.0) * eToX) ** 2;
    }
  }
  return { shieldRatio: ratio(shield), armorRatio: ratio(damageState[damageState.length - 2]), hullRatio: ratio(damageState[damageState.length - 1]) };
}

/** One overview row: a ball with its slim item. */
function projectEntity(park, ball, slim, ego) {
  const itemID = number(ball.id);
  const categoryID = positive(slim.get("categoryID"));
  const groupID = positive(slim.get("groupID"));
  const kind = kindOf(categoryID, groupID);
  const seen = park.damageSeen ? park.damageSeen.get(ball.id) : undefined;
  const row = {
    kind,
    itemID,
    typeID: positive(slim.get("typeID")),
    groupID,
    categoryID,
    name: text(slim.get("name")) || null,
    ownerID: positive(slim.get("ownerID")),
    radius: ball.radius,
    position: vector(ball.newPos),
    velocity: vector(ball.newVel),
    isSelf: ego !== null && ball.id === ego,
    ...healthOf(park.damageState.get(ball.id), seen === undefined ? 0 : park.currentTime - seen),
  };
  if (kind === "ship" || kind === "structure") {
    const security = number(slim.get("securityStatus"));
    row.characterID = positive(slim.get("charID"));
    row.corporationID = positive(slim.get("corpID"));
    row.allianceID = positive(slim.get("allianceID"));
    row.securityStatus = security;
    row.maxVelocity = ball.maxVelocity > 0 ? ball.maxVelocity : null;
    row.mode = MODE_NAME[ball.mode] ?? null;
    // Who it is following or orbiting. The gateway reports the server's target for the ship, which a client is not sent.
    row.targetEntityID = (ball.mode === MODE.FOLLOW || ball.mode === MODE.ORBIT) && ball.followId > 0 ? number(ball.followId) : null;
    // Another ship's capacitor is not sent to a client; the pilot's own comes from dogma (projectSpace's `readings`).
    row.capacitorRatio = null;
    // A ship of the Entity category is one nobody is flying.
    row.isNpc = categoryID === CATEGORY.ENTITY;
    row.npcEntityType = null;
    row.compressionFacility = null;
  }
  return row;
}

/**
 * The gateway's `space` for a pilot in space, from its park. `solarSystemID`
 * and `shipID` are where the session says the pilot is and what it flies.
 * `readings` is what dogma says of the pilot's own ship (pilotDogma.js), which
 * the ballpark does not know; without it those fields are null.
 */
function projectSpace(park, { solarSystemID, shipID, readings = null }) {
  const ego = park.ego;
  const entities = [];
  for (const ball of park.ballpark.balls.values()) {
    if (ball.isMoribund) continue;
    const slim = park.slimItems.get(ball.id);
    if (!slim) continue; // a ball of the client's own, or one whose slim item has not come
    entities.push(projectEntity(park, ball, slim, ego));
  }
  const own = ego === null ? null : entities.find((row) => row.itemID === number(ego)) ?? null;
  if (own && readings) own.capacitorRatio = readings.capacitorRatio;
  return {
    inSpace: true,
    solarSystemID,
    shipID,
    // The park's tick, as the server's clock in milliseconds: a tick is a whole second of that clock.
    sampledAtMs: park.currentTime * 1000,
    entities,
    ship: own ? {
      itemID: own.itemID,
      typeID: own.typeID,
      name: own.name,
      mode: own.mode,
      maxVelocity: own.maxVelocity,
      radius: own.radius,
      position: own.position,
      velocity: own.velocity,
      shieldRatio: own.shieldRatio,
      armorRatio: own.armorRatio,
      hullRatio: own.hullRatio,
      // From dogma on the retail client, not from the ballpark.
      capacitorRatio: readings ? readings.capacitorRatio : null,
      shieldCapacity: readings ? readings.shieldCapacity : null,
      armorCapacity: readings ? readings.armorCapacity : null,
      hullCapacity: readings ? readings.hullCapacity : null,
      // Which modules are running or overloaded: godma's effects.
      activeModuleIDs: readings && Array.isArray(readings.activeModuleIDs) ? readings.activeModuleIDs : [],
      overloadedModuleIDs: readings && Array.isArray(readings.overloadedModuleIDs) ? readings.overloadedModuleIDs : [],
      // How damaged each module is, and which weapons are grouped: dogma's as well, not read yet.
      moduleDamage: {},
      weaponBanks: {},
    } : null,
  };
}

/** The two movement fields of the gateway's flight status, from the pilot's own ball. */
function projectFlight(park) {
  const ball = park.ego === null ? null : park.ballpark.ball(park.ego);
  if (!ball) return { shipMode: null, shipSpeedFraction: null };
  return { shipMode: MODE_NAME[ball.mode] ?? null, shipSpeedFraction: ball.speedFraction };
}

module.exports = { CATEGORY, GROUP, healthOf, kindOf, projectEntity, projectFlight, projectSpace };
