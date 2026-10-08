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
  SUN: 6, PLANET: 7, MOON: 8, ASTEROID_BELT: 9, STARGATE: 10, CARGO_CONTAINER: 12, SENTRY_GUN: 99, WRECK: 186, BILLBOARD: 323,
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
 * Seen to agree with the server on live grids (a station's, and a gate's on
 * each side of a jump): station, structure, sun, planet, moon, asteroidBelt,
 * stargate, sentryGun, billboard, orbital, ship. The rest follow the same
 * constants and have not been set beside the server's word yet. Two things cannot be told
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
    // Everything nobody flies is in one category: the guns and the billboards at a gate as well as the ships.
    case CATEGORY.ENTITY: return groupID === GROUP.SENTRY_GUN ? "sentryGun" : groupID === GROUP.BILLBOARD ? "billboard" : "ship";
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
/**
 * spaceMgr.CheckWarpDestination: does the thing the pilot asked to warp to lie where the server's warp is
 * pointed? It does if, from the ship, the two are within `angularTolerance` of the same direction, or if they
 * are within `distanceTolerance` of each other.
 */
function checkWarpDestination(warpPoint, destinationPoint, egoPoint, angularTolerance, distanceTolerance) {
  const offset = Math.hypot(destinationPoint.x - warpPoint.x, destinationPoint.y - warpPoint.y, destinationPoint.z - warpPoint.z);
  const toPoint = { x: warpPoint.x - egoPoint.x, y: warpPoint.y - egoPoint.y, z: warpPoint.z - egoPoint.z };
  const toThing = { x: destinationPoint.x - egoPoint.x, y: destinationPoint.y - egoPoint.y, z: destinationPoint.z - egoPoint.z };
  const cosine = (toPoint.x * toThing.x + toPoint.y * toThing.y + toPoint.z * toThing.z) / (Math.hypot(toPoint.x, toPoint.y, toPoint.z) * Math.hypot(toThing.x, toThing.y, toThing.z));
  const angle = Math.acos(Math.min(Math.max(-1.0, cosine), 1.0));
  return Math.abs(angle) < angularTolerance || offset < distanceTolerance;
}

/**
 * What the client's HUD words a warp from (spaceMgr.StartWarpIndication, IndicateWarp): whether the ship is
 * still lining up (the ball's effect stamp is negative until the warp proper begins), the point in the
 * server's WarpTo, and the thing the pilot asked to warp to, if it is in the park and lies where the warp
 * points (within pi/32 of the direction, or 20,000 km). The client makes that check once, as the warp is
 * ordered; here it is made on each reading, from where the ship then is.
 */
function warpOf(park, egoBall, destinationID) {
  const point = park.warpPoint ?? null;
  const id = destinationID === null || destinationID === undefined ? null : number(destinationID);
  const thing = id === null ? null : park.ballpark.ball(id);
  const lies = point && thing && checkWarpDestination(point, thing.newPos, egoBall.newPos, Math.PI / 32, 20000000);
  return { preparing: egoBall.effectStamp < 0, point: point ? { ...point } : null, destinationID: lies ? id : null };
}

function projectSpace(park, { solarSystemID, shipID, readings = null, warpDestination = null, alignTarget = null }) {
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
  const egoBall = ego === null ? null : park.ballpark.ball(ego) ?? null;
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
      // The range the ship was told to follow or orbit at: with its mode and whom it follows, what the
      // client's HUD says the ship is doing from (spaceMgr.GetHeaderAndSubtextForActionIndication). Null
      // when it follows nothing.
      followRange: own.targetEntityID !== null && egoBall ? egoBall.followRange : null,
      // The point the ship is flying to, when that is what it is doing (the ball's GOTO): with where it is
      // and how it is moving, what the client's HUD tells an approach to a point from a turn towards one.
      gotoPoint: own.mode === "GOTO" && egoBall ? { x: egoBall.goto.x, y: egoBall.goto.y, z: egoBall.goto.z } : null,
      // What the pilot last aligned to, a thing or a bookmark, while the ship flies that course: the client
      // remembers it from its own order (menusvc.StoreAlignTarget) and its HUD names it.
      alignTarget: own.mode === "GOTO" && alignTarget ? { itemID: alignTarget.itemID ?? null, bookmark: Boolean(alignTarget.bookmark) } : null,
      // In warp, or lining up for one: what the client's HUD says of it is made from this. `warpDestination`
      // is the thing the pilot asked to warp to, which the client remembers from its own order.
      warp: own.mode === "WARP" && egoBall ? warpOf(park, egoBall, warpDestination) : null,
      maxVelocity: own.maxVelocity,
      radius: own.radius,
      position: own.position,
      velocity: own.velocity,
      // The ship's panel reads its own health from godma (activeShipController.py); the ballpark's damage state
      // is what everyone else is shown of it, and stands in until dogma has been asked.
      shieldRatio: readings && readings.shieldRatio !== null && readings.shieldRatio !== undefined ? readings.shieldRatio : own.shieldRatio,
      armorRatio: readings && readings.armorRatio !== null && readings.armorRatio !== undefined ? readings.armorRatio : own.armorRatio,
      hullRatio: readings && readings.hullRatio !== null && readings.hullRatio !== undefined ? readings.hullRatio : own.hullRatio,
      // From dogma on the retail client, not from the ballpark.
      capacitorRatio: readings ? readings.capacitorRatio : null,
      shieldCapacity: readings ? readings.shieldCapacity : null,
      armorCapacity: readings ? readings.armorCapacity : null,
      hullCapacity: readings ? readings.hullCapacity : null,
      // Which modules are running or overloaded: godma's effects.
      activeModuleIDs: readings && Array.isArray(readings.activeModuleIDs) ? readings.activeModuleIDs : [],
      overloadedModuleIDs: readings && Array.isArray(readings.overloadedModuleIDs) ? readings.overloadedModuleIDs : [],
      // How damaged each module is, {itemID: 0..1}, and which weapons are grouped, {masterID: [slaveID, ...]}:
      // dogma's as well. Null, not empty, when dogma could not be asked: empty means "none".
      moduleDamage: readings && readings.moduleDamage ? readings.moduleDamage : null,
      weaponBanks: readings && readings.weaponBanks ? readings.weaponBanks : null,
      // How hot each rack is running, { high, mid, low } as fractions of its capacity: the dogma location's own
      // reckoning (pilotDogma.js). Null when dogma could not be asked.
      rackHeat: readings && readings.rackHeat ? readings.rackHeat : null,
    } : null,
  };
}

/** The two movement fields of the gateway's flight status, from the pilot's own ball. */
function projectFlight(park) {
  const ball = park.ego === null ? null : park.ballpark.ball(park.ego);
  if (!ball) return { shipMode: null, shipSpeedFraction: null };
  return { shipMode: MODE_NAME[ball.mode] ?? null, shipSpeedFraction: ball.speedFraction };
}

module.exports = { CATEGORY, GROUP, checkWarpDestination, healthOf, kindOf, projectEntity, projectFlight, projectSpace };
