// Overview view logic (goal R11) — pure, framework-free, fully testable.
//
// The server hands the browser positions; everything a player actually reads in
// an overview — how far away a thing is, what order the list is in, what is
// filtered out — is computed HERE, in the client. That is not a shortcut: it is
// how the retail client works. The server pushes ball state and the client
// re-derives distance and re-renders on its own cadence.
//
// Nothing in this module renders a numeric game ID (goal R7d). It carries IDs so
// the caller can key rows, resolve names, and issue a move; the strings it
// produces (`formatDistance`) are units, never identifiers.

import type { SpaceEntity, SpaceSnapshot, SpaceVector } from "../store/types.ts";

/** One astronomical unit in metres — the unit EVE distances read in at range. */
export const METRES_PER_AU = 149_597_870_700;

/** Straight-line distance between two points, in metres. */
export function distanceMeters(from: SpaceVector, to: SpaceVector): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * SURFACE distance between two objects, in metres: the gap between their hulls,
 * not between their centres.
 *
 *     max(0, centreToCentre - radiusA - radiusB)
 *
 * This is the measure the SERVER uses everywhere it asks "how far is that?"
 * (services/drone/droneRuntime.js computes it identically), and it is the
 * measure retail's autopilot decides jump / dock / approach / warp from. It
 * matters: a station's radius is kilometres, so centre-to-centre would have the
 * client believe it is far outside docking range while the server considers it
 * docked-close.
 */
export function surfaceDistanceMeters(
  from: SpaceVector,
  fromRadius: number,
  to: SpaceVector,
  toRadius: number,
): number {
  const centres = distanceMeters(from, to);
  const radii = (Number.isFinite(fromRadius) ? fromRadius : 0) + (Number.isFinite(toRadius) ? toRadius : 0);
  return Math.max(0, centres - radii);
}

/**
 * A distance as a player reads it: metres up close, kilometres in between,
 * AU once it is a warp away. Mirrors the retail overview's own thresholds.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return "—";
  }
  if (meters >= METRES_PER_AU / 10) {
    return `${(meters / METRES_PER_AU).toFixed(1)} AU`;
  }
  if (meters >= 1_000) {
    const km = meters / 1_000;
    // ⚠ GROUPED once it is whole kilometres. A moon 12 million km out rendered
    // as `12040310 km` — eight unbroken digits, in the one column a pilot reads
    // by comparing figures down a list. Under 100 km the decimal is the
    // information and there is nothing to group.
    return `${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * The client's labels for a distance in each unit. Each has one parameter,
 * {distance}, the figure (carbon/common/script/util/format.py FmtDist;
 * overviewScrollEntry.get_distance_in_meters and its two neighbours).
 */
export const DISTANCE_LABELS = {
  m: "/Carbon/UI/Common/FormatDistance/fmtDistInMeters",
  km: "/Carbon/UI/Common/FormatDistance/fmtDistInKiloMeters",
  au: "/Carbon/UI/Common/FormatDistance/fmtDistInAU",
} as const;

export type DistanceUnit = keyof typeof DISTANCE_LABELS;

/** Puts a figure with its unit. `distanceSay` (distanceWords.ts) makes one from the client's words. */
export type DistanceSay = (unit: DistanceUnit, figure: string) => string;

const OWN_UNITS: Readonly<Record<DistanceUnit, string>> = { m: "m", km: "km", au: "AU" };

/** This page's own words for a distance, for when the client's are not to hand. */
export const ownDistanceWords: DistanceSay = (unit, figure) => `${figure} ${OWN_UNITS[unit]}`;

/** A number grouped, with exactly `places` decimals. */
function figure(value: number, places = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });
}

/**
 * A distance as the retail overview's own column words it
 * (overviewScrollEntry._GetColumnValueDistance): whole metres under 10 km,
 * whole kilometres under 10,000,000 km, and AU to one decimal beyond that.
 * The figures are grouped, as the client groups them.
 */
export function formatOverviewDistance(meters: number, say: DistanceSay = ownDistanceWords): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return "—";
  }
  if (meters < 10_000) {
    return say("m", figure(Math.round(meters)));
  }
  if (meters < 10_000_000_000) {
    return say("km", figure(Math.round(meters / 1_000)));
  }
  return say("au", figure(Math.round((meters / METRES_PER_AU) * 10) / 10, 1));
}

/**
 * A distance as the client words one everywhere but the overview's column:
 * its FmtDist (carbon/common/script/util/format.py 192). The target bar and
 * the brackets call it as it is; the selected item asks for one decimal.
 *
 * The same three steps as the overview's column. Under 10 km, whole metres,
 * except that a distance under one metre and not nothing keeps its decimals.
 * Under 10,000,000 km, whole kilometres. Beyond, AU to `maxDecimals`. Less
 * than nothing is nothing.
 *
 * ⚠ The decimals are written out in full ("2.80 AU"), which is how this page
 * reads the client's number formatter being handed a count of places. That
 * formatter is native code and was not run; see the log.
 */
export function fmtDist(meters: number, maxDecimals = 2, say: DistanceSay = ownDistanceWords): string {
  if (!Number.isFinite(meters)) {
    return "—";
  }
  const dist = Math.max(0, meters);
  if (dist < 10_000) {
    // Under a metre the decimals are kept; asked for none, the client cuts it to a whole number, which is nothing.
    return say("m", dist === 0 || dist >= 1 ? figure(Math.round(dist)) : figure(maxDecimals === 0 ? Math.trunc(dist) : dist, maxDecimals));
  }
  if (dist < 10_000_000_000) {
    return say("km", figure(Math.round(dist / 1_000)));
  }
  const scale = 10 ** maxDecimals;
  return say("au", figure(Math.round((dist / METRES_PER_AU) * scale) / scale, maxDecimals));
}

/** The radius of the player's own ship, as the snapshot gives it; 0 when it gives none. */
export function ownRadius(snapshot: SpaceSnapshot | null): number {
  const radius = snapshot?.ship?.radius ?? snapshot?.entities.find((entity) => entity.isSelf)?.radius;
  return typeof radius === "number" && Number.isFinite(radius) ? radius : 0;
}

/** An overview row: a visible object plus the distances the client computed. */
export interface OverviewRow extends SpaceEntity {
  /** Distance from the player's ship, centre to centre, in metres. */
  readonly distance: number;
  /**
   * Distance from the ship's surface to the object's, in metres, and never
   * below 0: the centres' distance less both radii. It is what the retail
   * overview shows and sorts by (overviewScrollEntry._GetSurfaceDistance,
   * overviewNodeUtil). A station's radius is kilometres, so the two are far apart.
   */
  readonly surfaceDistance: number;
  /**
   * The thing's own speed in metres a second (overviewNodeUtil.UpdateVelocityData: the length of the ball's
   * velocity, a vector of single-precision numbers), what the overview's Velocity column, one of its default columns
   * (overviewConst.DEFAULT_COLUMNS), shows and sorts by; null where the snapshot gives no motion for it.
   */
  readonly speed: number | null;
  /**
   * The rest of UpdateVelocityData, of the thing beside the pilot's ship, null where either has no motion: its
   * closing speed along the line between them (radial: the velocities' difference on the line's unit vector, a
   * positive one moving away), the rest of that difference (transversal), and that over the surface distance, a
   * metre at least (angular, radians a second).
   */
  readonly radialVelocity: number | null;
  readonly transversalVelocity: number | null;
  readonly angularVelocity: number | null;
}

/** The columns a list is sorted by (overviewConst's, those the page draws). */
export type OverviewSort = "distance" | "name" | "type" | "velocity" | "radialVelocity" | "transversalVelocity" | "angularVelocity";

/**
 * A velocity's length as the client takes it: of the vector in single precision, in single precision (as
 * shipSpeed.ts singleLength; kept here so the overview's own module stays clear of the words modules).
 */
function speedOf(entity: SpaceEntity): number | null {
  if (entity.motionAvailable === false) return null;
  const { x, y, z } = entity.velocity;
  if (![x, y, z].every(Number.isFinite)) return null;
  const f = Math.fround;
  const [vx, vy, vz] = [f(x), f(y), f(z)];
  return f(Math.sqrt(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz))));
}

/**
 * The Velocity column's figure (overviewScrollEntry._GetColumnValueVelocity: FormatNumeric(int(velocity),
 * useGrouping=True)): whole metres a second, cut, grouped; "-" where there is none. The radial and transversal
 * columns' the same (_GetColumnValueRadialVelocity, _GetColumnValueTransversalVelocity).
 */
export function formatOverviewVelocity(speed: number | null): string {
  // int() of a small negative is 0, never a "-0".
  return speed === null || !Number.isFinite(speed) ? "-" : (Math.trunc(speed) || 0).toLocaleString("en-US");
}

/**
 * The angular column's figure (_GetColumnValueAngularVelocity: round(value, 7) in degrees a second,
 * FormatNumeric(value, useGrouping=True)). How the client's native formatter places a fraction it is given no places
 * for is not read; this writes three at most.
 */
export function formatOverviewAngular(radiansPerSecond: number | null): string {
  if (radiansPerSecond === null || !Number.isFinite(radiansPerSecond)) return "-";
  const degrees = (Math.round(radiansPerSecond * 1e7) / 1e7) * 180 / Math.PI;
  return degrees.toLocaleString("en-US");
}

type Vec = readonly [number, number, number];
const f32 = Math.fround;
/** geo2's vectors are single precision: each step of these is taken in it. */
const length32 = (v: Vec): number => f32(Math.sqrt(f32(f32(f32(f32(v[0]) * f32(v[0])) + f32(f32(v[1]) * f32(v[1]))) + f32(f32(v[2]) * f32(v[2])))));
const dot32 = (a: Vec, b: Vec): number => f32(f32(f32(f32(a[0]) * f32(b[0])) + f32(f32(a[1]) * f32(b[1]))) + f32(f32(a[2]) * f32(b[2])));

/**
 * overviewNodeUtil.UpdateVelocityData's radial, transversal and angular velocities of a thing beside the pilot's ship.
 */
function relativeMotion(entity: SpaceEntity, self: SpaceEntity | null, surfaceDistance: number): Pick<OverviewRow, "radialVelocity" | "transversalVelocity" | "angularVelocity"> {
  const none = { radialVelocity: null, transversalVelocity: null, angularVelocity: null };
  if (self === null || entity.motionAvailable === false || self.motionAvailable === false) return none;
  const combined: Vec = [entity.velocity.x - self.velocity.x, entity.velocity.y - self.velocity.y, entity.velocity.z - self.velocity.z];
  const apart: Vec = [entity.position.x - self.position.x, entity.position.y - self.position.y, entity.position.z - self.position.z];
  if (![...combined, ...apart].every(Number.isFinite)) return none;
  const size = length32(apart);
  const normal: Vec = size > 0 ? [f32(f32(apart[0]) / size), f32(f32(apart[1]) / size), f32(f32(apart[2]) / size)] : [0, 0, 0];
  const radial = dot32(combined, normal);
  const across: Vec = [
    f32(f32(combined[0]) - f32(normal[0] * radial)),
    f32(f32(combined[1]) - f32(normal[1] * radial)),
    f32(f32(combined[2]) - f32(normal[2] * radial)),
  ];
  const transversal = length32(across);
  return { radialVelocity: radial, transversalVelocity: transversal, angularVelocity: transversal / Math.max(1, Math.max(surfaceDistance, 0)) };
}

export interface OverviewFilter {
  /** Free-text match over the row's name / type name / group name. */
  readonly text?: string;
  /** Restrict to one category, or null for all. */
  readonly categoryID?: number | null;
  /** Restrict to one group, or null for all. */
  readonly groupID?: number | null;
}

/**
 * Names the caller has already resolved for a row, so text search can match what
 * the player actually SEES (a type or group name) rather than an id.
 */
export interface OverviewRowNames {
  readonly typeName?: string | null;
  readonly groupName?: string | null;
}

/** Look up the resolved names for one row (supplied by the component). */
export type OverviewNameLookup = (entity: SpaceEntity) => OverviewRowNames;

const NO_NAMES: OverviewRowNames = {};

function matchesText(
  entity: SpaceEntity,
  names: OverviewRowNames,
  needle: string,
): boolean {
  const haystack = [entity.name, names.typeName, names.groupName]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Whether any overview can list a thing. The client's overview is made of a
 * table of groups (parklife/tacticalConst.py, construct_groups, 112 to 127),
 * and every preset's groups are cut down to that table before anything is
 * listed (overview/presetservice.py, GetValidGroups, 315 to 321). A group is in
 * the table where:
 *
 *   • its category is one of thirteen (validCategories, 72 to 85): stations,
 *     ships, entities, celestials, asteroids, drones, deployables, starbases,
 *     structures, charges, sovereignty structures, orbitals and fighters;
 *   • it is not one of sixty-four set aside (filterGroups, 7 to 71): what is
 *     no thing in space to a pilot (a solar system, a region, a ring, a cloud,
 *     a comet, a signature, a planet's pins), and what is in space and is not
 *     for clicking (a force field, a locator, a moon's chunk, the
 *     non-interactable kinds, the old drone and starbase groups);
 *   • and, of the Charge category, it is one of seven (bombGroups, 86 to 93):
 *     the three bombs', the scanner's, the interdiction's and the burst's
 *     probes, and a structure's guided bomb. So a missile in flight is on
 *     nobody's overview, whatever its settings; the client shows one in space
 *     and nowhere else.
 *
 * The numbers are the client's own: the module's compiled collections, each
 * name given inventorycommon/const's compiled number, read through the client's
 * python27.dll (scripts/py27-oracle.py). One of the sixty-four is a bare 11 in
 * the module itself.
 *
 * It is the category and the group that say so, never the row's word for its
 * kind. A charge whose group is not known is not listed. A row whose category
 * is not known at all is listed: the rule cannot be read of it, and a thing in
 * space is not hidden for that.
 */
const CATEGORY_CHARGE = 8;
const CHARGE_GROUPS_AN_OVERVIEW_LISTS: ReadonlySet<number> = new Set([90, 863, 864, 479, 548, 4088, 1548]);
const CATEGORIES_AN_OVERVIEW_LISTS: ReadonlySet<number> = new Set([3, 6, 11, 2, 25, 18, 22, 23, 65, 8, 40, 46, 87]);
const GROUPS_NO_OVERVIEW_LISTS: ReadonlySet<number> = new Set([
  16, 995, 335, 5, 13, 4, 3, 227, 305, 885, 502, 368, 312, 1027, 1026, 1036,
  1028, 1030, 1029, 1071, 1165, 1198, 1149, 1274, 1297, 1312, 549, 1023, 1073, 1409, 1410, 1405,
  1407, 11, 1063, 1004, 903, 519, 382, 97, 299, 470, 545, 934, 445, 710, 414, 418,
  364, 480, 840, 877, 1940, 1983, 1882, 1973, 1975, 4579, 1980, 1971, 1005, 4055, 4430, 4714,
]);

export function overviewCanList(entity: Pick<SpaceEntity, "categoryID" | "groupID">): boolean {
  const { categoryID, groupID } = entity;
  if (categoryID === CATEGORY_CHARGE) {
    return groupID !== null && CHARGE_GROUPS_AN_OVERVIEW_LISTS.has(groupID);
  }
  if (categoryID !== null && !CATEGORIES_AN_OVERVIEW_LISTS.has(categoryID)) {
    return false;
  }
  return groupID === null || !GROUPS_NO_OVERVIEW_LISTS.has(groupID);
}

/**
 * Build the overview list: drop the player's own ship and what no overview
 * lists, apply the filters, compute each remaining row's distance from the
 * ship, and sort.
 *
 * `cap` bounds how many rows the caller renders — a busy grid can hold hundreds
 * of balls and the panel must stay responsive at a 1s cadence. The cap is
 * applied AFTER sorting, so capping always keeps the nearest objects.
 */
export function buildOverviewRows(
  snapshot: SpaceSnapshot | null,
  origin: SpaceVector,
  options: {
    readonly filter?: OverviewFilter;
    readonly sort?: OverviewSort;
    /**
     * Fastest first where -1, for the Velocity sort only: its order is applied before the cap, so a reversed speed
     * keeps the fastest things rather than the far end of the slowest (distance and name keep the nearest rows).
     */
    readonly direction?: 1 | -1;
    readonly cap?: number;
    readonly names?: OverviewNameLookup;
  } = {},
): { readonly rows: readonly OverviewRow[]; readonly matched: number } {
  if (!snapshot) {
    return { rows: [], matched: 0 };
  }
  const filter = options.filter ?? {};
  const lookup = options.names ?? (() => NO_NAMES);
  const needle = (filter.text ?? "").trim().toLowerCase();

  const radius = ownRadius(snapshot);
  const self = snapshot.entities.find((entity) => entity.isSelf) ?? null;
  const matched: OverviewRow[] = [];
  for (const entity of snapshot.entities) {
    if (entity.isSelf || !overviewCanList(entity)) {
      continue;
    }
    if (
      filter.categoryID !== null &&
      filter.categoryID !== undefined &&
      entity.categoryID !== filter.categoryID
    ) {
      continue;
    }
    if (
      filter.groupID !== null &&
      filter.groupID !== undefined &&
      entity.groupID !== filter.groupID
    ) {
      continue;
    }
    if (needle.length > 0 && !matchesText(entity, lookup(entity), needle)) {
      continue;
    }
    const surfaceDistance = surfaceDistanceMeters(origin, radius, entity.position, entity.radius);
    matched.push({
      ...entity,
      distance: distanceMeters(origin, entity.position),
      surfaceDistance,
      speed: speedOf(entity),
      ...relativeMotion(entity, self, surfaceDistance),
    });
  }

  const sort = options.sort ?? "distance";
  matched.sort((left, right) => {
    if (sort === "name") {
      const byName = (left.name ?? "").localeCompare(right.name ?? "");
      if (byName !== 0) {
        return byName;
      }
    }
    if (sort === "type") {
      const typeOf = (row: OverviewRow) => lookup(row).typeName ?? "";
      const byType = typeOf(left).localeCompare(typeOf(right));
      if (byType !== 0) {
        return byType;
      }
    }
    if (sort === "velocity" || sort === "radialVelocity" || sort === "transversalVelocity" || sort === "angularVelocity") {
      // Slowest first; one with no figure before any (Python 2 orders None below every number).
      const figure = (row: OverviewRow) => (sort === "velocity" ? row.speed : row[sort]);
      const a = figure(left);
      const b = figure(right);
      const byFigure = (a === null ? (b === null ? 0 : -1) : b === null ? 1 : a - b) * (options.direction ?? 1);
      if (byFigure !== 0) {
        return byFigure;
      }
    }
    // Distance is the tiebreaker for name sort and the primary key otherwise —
    // nearest first, as an overview always reads. Nearest by SURFACE, which is
    // what the client sorts its overview by; things the ship is inside of are
    // all at 0, and among those the nearer centre comes first.
    return left.surfaceDistance - right.surfaceDistance || left.distance - right.distance;
  });

  const cap = options.cap;
  const rows =
    typeof cap === "number" && cap > 0 && matched.length > cap
      ? matched.slice(0, cap)
      : matched;
  return { rows, matched: matched.length };
}

/**
 * The distinct category / group ids present in a snapshot, so the panel can
 * offer only filters that would actually match something. Ids only — the
 * component resolves each to a NAME before rendering it (R7d).
 */
export function overviewFilterIDs(snapshot: SpaceSnapshot | null): {
  readonly categoryIDs: readonly number[];
  readonly groupIDs: readonly number[];
} {
  if (!snapshot) {
    return { categoryIDs: [], groupIDs: [] };
  }
  const categories = new Set<number>();
  const groups = new Set<number>();
  for (const entity of snapshot.entities) {
    if (entity.isSelf || !overviewCanList(entity)) {
      continue;
    }
    if (entity.categoryID !== null) {
      categories.add(entity.categoryID);
    }
    if (entity.groupID !== null) {
      groups.add(entity.groupID);
    }
  }
  return {
    categoryIDs: [...categories],
    groupIDs: [...groups],
  };
}

// --- R25 slice B: telling a pirate from a person -----------------------------
//
// ⚠ THE FINDING THIS SECTION EXISTS FOR: a belt rat is `kind: "ship"`. It is
// built through the same server-side entity path as the player parked next to
// you and carries the same name, position, health and velocity. `kind` cannot
// separate them, and neither could anything else the snapshot carried before
// R25 — which is why the gateway projects exactly two new fields, `isNpc` and
// `npcEntityType`, and why the whole of this client's threat logic reads them
// and nothing else.
//
// ⚠ AND THE TRAP THAT LOOKS LIKE A SHORTCUT: `characterID === 0` would ALMOST
// work. Structures and corp-owned balls also carry characterID 0, so a panel
// built on it flags harmless furniture as a threat — and a threat warning that
// cries wolf gets ignored, which is worse than not having one.

/**
 * Is this row something that will SHOOT AT YOU?
 *
 * True only for a ship the runtime says nobody is flying, of a kind that
 * attacks: "npc" (pirates, and the belt rats a miner actually meets) and
 * "drifter". Deliberately NOT "concord" — law enforcement is an NPC that does
 * not attack a miner, and painting it red would make the colour meaningless.
 *
 * An NPC ship whose kind we could not read is treated as hostile: for a warning
 * whose job is to keep a miner alive, an unknown NPC is the case you want to be
 * wrong about in the loud direction.
 */
export function isHostile(entity: SpaceEntity): boolean {
  if (!entity.isNpc || entity.isSelf) {
    return false;
  }
  return entity.npcEntityType !== "concord";
}

/**
 * What a player should CALL this row (R9a: plain player language, never
 * "NPC entity kind"). Returns null for anything that is not an NPC, so a
 * caller renders no badge at all rather than an empty one.
 */
export function hostileLabel(entity: SpaceEntity): string | null {
  if (!entity.isNpc) {
    return null;
  }
  switch (entity.npcEntityType) {
    case "concord":
      return "Police";
    case "drifter":
      return "Drifter";
    default:
      return "Pirate";
  }
}

/** Is this drone row one of MINE — owned by me, or flown by my hull? */
export function isMyDrone(
  entity: SpaceEntity,
  myCharacterID: number | null,
  myShipID: number | null,
): boolean {
  if (entity.kind !== "drone") {
    return false;
  }
  if (myCharacterID !== null && entity.ownerID === myCharacterID) {
    return true;
  }
  return myShipID !== null && entity.controllerID === myShipID;
}

/**
 * Can my ship give this drone ORDERS? (goal R33)
 *
 * ⚠ DELIBERATELY NARROWER THAN `isMyDrone`, AND THE GAP BETWEEN THE TWO IS THE
 * WHOLE OF R33. `isMyDrone` is the LISTING rule — owner OR controller — and the
 * BFF's `readDronesInSpace` uses the same disjunction to decide what appears in
 * the Drones panel. This is the CONTROL rule, and eve.js applies exactly one
 * test for it: `droneRuntime.js` refuses every drone order
 * (`commandReturnDrones`, `commandEngage`, `commandMineRepeatedly`,
 * `commandSalvage`, `commandAbandonDrone`) unless
 * `droneEntity.controllerID === shipRecord.itemID`.
 *
 * So a drone you OWN but no longer CONTROL is listed and cannot be ordered.
 * That is not hypothetical: an abandoned `Ice Harvesting Drone II`
 * (`controllerID: null`) in Perimeter II - Asteroid Belt 1 was recalled live,
 * answered 200, and did not move for 20 s. The server's reason was sitting in
 * the call RESULT dict, which the BFF drops — so nothing ever reached the
 * player. This predicate is what lets the control say so up front.
 *
 * ⚠ NOTE IT COMPARES AGAINST THE HULL, NOT AGAINST NULL. "Abandoned" is only
 * the commonest way to fail this; a drone under ANOTHER ship's control fails it
 * too, and a `controllerID !== null` test would wave that one through.
 *
 * `null` means WE CANNOT TELL — the snapshot carries no row for this drone, or
 * we do not know our own hull's id. A null must leave the control ENABLED, so
 * the server can give the real answer; guessing here would be the exact failure
 * this function exists to fix, pointed the other way.
 */
export function canMyShipOrderDrone(
  entity: SpaceEntity | null | undefined,
  myShipID: number | null,
): boolean | null {
  if (!entity || entity.kind !== "drone" || myShipID === null) {
    return null;
  }
  return entity.controllerID === myShipID;
}

/**
 * The hostiles in a snapshot, nearest first.
 *
 * Separate from `buildOverviewRows` on purpose: the overview is a filtered,
 * capped, sortable list, and a threat must NOT be something a player can filter
 * away or push off the bottom of a hundred-row cap. This reads the whole
 * snapshot every time, ignores every filter, and is never capped.
 */
export function hostileRows(
  snapshot: SpaceSnapshot | null,
  origin: SpaceVector,
): readonly OverviewRow[] {
  if (!snapshot) {
    return [];
  }
  const radius = ownRadius(snapshot);
  const self = snapshot.entities.find((entity) => entity.isSelf) ?? null;
  return snapshot.entities
    .filter((entity) => isHostile(entity))
    .map((entity) => {
      const surfaceDistance = surfaceDistanceMeters(origin, radius, entity.position, entity.radius);
      return {
        ...entity,
        distance: distanceMeters(origin, entity.position),
        surfaceDistance,
        speed: speedOf(entity),
        ...relativeMotion(entity, self, surfaceDistance),
      };
    })
    .sort((left, right) => left.distance - right.distance);
}

/**
 * Is a PLAYER holding a lock on this hull right now?
 *
 * ⚠ THE ONLY EVIDENCE OF A PURE PvP ENGAGEMENT THIS CLIENT HAS.
 * `isHostile` just above answers NPC-or-not, so `hostileRows` counts rats and
 * nothing else: a fleet fight against players is invisible to it. A player ship
 * whose own lock points at this hull has classified itself, and no other read
 * agrees with it.
 *
 * Free — it reads the space snapshot already in hand and makes no call of its
 * own, which is why every loop that has a snapshot can afford to ask every tick.
 *
 * `null` is WE COULD NOT LOOK (no snapshot), never "nobody is". A `false`
 * means the whole grid was read and no player lock pointed here. Not knowing
 * our own hull's id is a `false` rather than a `null` on purpose: there is a
 * grid to compare against, and every row on it failed to match.
 */
export function isTargetedByPlayer(
  snapshot: SpaceSnapshot | null,
  myShipID: number | null,
): boolean | null {
  if (!snapshot) {
    return null;
  }
  return snapshot.entities.some(
    (entity) =>
      entity.kind === "ship" &&
      entity.isNpc === false &&
      entity.isSelf === false &&
      entity.characterID !== null &&
      myShipID !== null &&
      entity.targetEntityID === myShipID,
  );
}

/**
 * Which hostiles are NEW since the last look — the ones worth interrupting the
 * player for ("A pirate has arrived").
 *
 * Pure and caller-driven: the caller owns the "seen" set, so this never holds
 * state across a dock, a session change, or a panel remount. `seen` being EMPTY
 * on the very first poll would otherwise announce every rat already in the belt
 * as an arrival, so the caller is expected to prime it from the first snapshot;
 * that is documented at the call site rather than guessed at here.
 */
export function newlyArrivedHostiles(
  hostiles: readonly OverviewRow[],
  seen: ReadonlySet<number>,
): readonly OverviewRow[] {
  return hostiles.filter((row) => !seen.has(row.itemID));
}

/**
 * Is the ship's shield/armor/hull dropping fast enough to be worth shouting
 * about?
 *
 * The honest, sourceable version of "you are under attack", and still the one
 * this function computes: what two consecutive HUD readings show, a health
 * layer that went down. `null` for either reading means unknown, and unknown is
 * never reported as damage.
 *
 * ⚠ CORRECTED IN R29. This comment used to claim the client has no damage log
 * to read and that no such server read exists. The second half is still true —
 * there is no CALL that returns a damage history — but the first half was
 * wrong: `OnDamageMessage` is PUSHED, in both directions, and R29 measured it
 * live (16 frames from a rat shooting an idle ship, plus our own hits on the
 * way back). The store keeps a bounded tail of it in `targeting.damageLog`.
 *
 * That log does NOT replace this function, and this function is not built on
 * it. The push channel is lossy by design, so a quiet log is not evidence of a
 * quiet fight; two health readings are. The log says what we were TOLD about,
 * this says what the ship's own numbers DID. Keep them independent.
 */
export function healthIsDropping(
  previous: { readonly shieldRatio: number | null; readonly armorRatio: number | null; readonly hullRatio: number | null } | null,
  current: { readonly shieldRatio: number | null; readonly armorRatio: number | null; readonly hullRatio: number | null } | null,
): boolean {
  if (!previous || !current) {
    return false;
  }
  const dropped = (before: number | null, after: number | null): boolean =>
    before !== null && after !== null && after < before;
  return (
    dropped(previous.shieldRatio, current.shieldRatio) ||
    dropped(previous.armorRatio, current.armorRatio) ||
    dropped(previous.hullRatio, current.hullRatio)
  );
}

/**
 * A health/capacitor ratio as a whole percentage for a labelled bar, or null
 * when the ship has no such layer to report.
 */
export function ratioPercent(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return null;
  }
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}
