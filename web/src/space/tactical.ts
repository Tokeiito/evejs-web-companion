// The tactical view's PROJECTION MATHS (goal R70) — pure, framework-free, fully
// testable. Nothing here touches a canvas, a DOM node or a store.
//
// WHY THIS EXISTS AS ITS OWN MODULE. Until now nothing in this client drew
// space; the overview is a table and the only picture in the app is the fitting
// ring. A viewport is the single strongest "this is an EVE client" signal there
// is, and the server has been sending everything it needs — position, velocity,
// radius, health, hostility — on every snapshot since R11. What was missing was
// not data. It was the arithmetic that turns three metre-scale world coordinates
// into a point on a screen, and that arithmetic is exactly the kind of decision
// `space/overview.ts` and `space/rowActions.ts` already established belongs in a
// pure module: a projection written inline in a `<canvas>` draw loop can only be
// checked by rendering it and looking, and looking proves nothing.
//
// ---------------------------------------------------------------------------
// THE PROBLEM THIS SOLVES, AND WHY A LINEAR SCALE CANNOT
//
// One grid holds a rock 8 km away and a planet 4 AU away. That is a ratio of
// about 75,000:1. On a 600 px plot a linear scale puts the rock 0.008 px from
// the centre — i.e. the entire belt a miner is working collapses into the ship's
// own dot, while one planet owns the rim. Every naive space view fails this way.
//
// So the RADIUS is log-compressed and the BEARING is not. Direction is truthful:
// a rock to galactic north is drawn north, and two rocks 30° apart are drawn 30°
// apart. Distance is ORDERED and readable but not to scale — which is precisely
// the bargain retail's own tactical overlay strikes, and why it draws labelled
// range rings. The rings are not decoration: they are what makes a compressed
// radius legible, so `tacticalRings` is part of this module and not the view's
// idea of a nice touch.
//
// ---------------------------------------------------------------------------
// THE PLANE, THE TILT, AND THE DROP LINE
//
// EVE's world is y-up: x/z is the ecliptic-ish plane objects are strewn across
// and y is height above it. A pure top-down plot (x, z) is honest but reads flat
// and loses the third axis entirely — and height is the axis a pilot most often
// needs ("it is 40 km away, but 30 km of that is straight up").
//
// So the plot is that x/z disc seen at an ANGLE — squashed into an ellipse by
// `tilt` — and each object is lifted off its own place on the disc by its
// compressed height. `planeY` is where the object's shadow falls on the disc and
// `y` is where the object itself is drawn; the view joins the two with a drop
// line, exactly as the retail overlay does. That single line is what makes the
// picture read as three-dimensional, and it costs one `moveTo`/`lineTo`.
//
// ---------------------------------------------------------------------------
// R7d: nothing here produces text for display. It carries `itemID` so the caller
// can key a bracket and hit-test a click, and it emits NUMBERS in pixels and
// metres. The only strings it returns are the ring labels (units, never ids) and
// a `role` name, which is a styling key the caller maps to a colour.

import type { SpaceEntity, SpaceVector } from "../store/types.ts";
import { METRES_PER_AU, distanceMeters, isHostile } from "./overview.ts";

/** Everything the projection needs to know about the plot it is drawing into. */
export interface TacticalViewport {
  /** Plot box in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /**
   * Distance at the CENTRE of the plot. Anything nearer than this is drawn at
   * the centre rather than at a negative radius. 1 km by default: closer than
   * that and you are, for every purpose a pilot has, on top of the thing.
   */
  readonly minRangeMeters?: number;
  /** Distance at the RIM. Objects beyond it clamp to the rim and say so. */
  readonly maxRangeMeters: number;
  /**
   * How hard the disc is squashed: 1 is a true top-down circle, 0 would be an
   * edge-on line. 0.42 is the default and reads as a shallow overhead angle.
   */
  readonly tilt?: number;
  /**
   * How much of the plot radius an object at FULL RANGE straight overhead is
   * lifted by. Height runs through the same log compression as distance, so this
   * is the one knob that decides how dramatic the vertical axis looks. Kept well
   * under 1 on purpose: a tall plot is a confusing plot, and height that
   * competes with range for vertical screen space makes both unreadable.
   */
  readonly heightGain?: number;
  /** Pixels kept clear inside the box edge so a rim bracket is not clipped. */
  readonly marginPx?: number;
}

/** Where one object landed on the plot. */
export interface TacticalPoint {
  readonly itemID: number;
  /** Screen position of the OBJECT, in CSS pixels within the plot box. */
  readonly x: number;
  readonly y: number;
  /**
   * Screen y of the same object's place on the disc — the foot of its drop
   * line. Equal to `y` for anything sitting on the plane.
   */
  readonly planeY: number;
  /** True distance from the ship in metres (uncompressed — for the label). */
  readonly distance: number;
  /** 0-1 position between the centre and the rim, after compression. */
  readonly radial: number;
  /** True when the object is past `maxRangeMeters` and was pinned to the rim. */
  readonly clamped: boolean;
  /** Height above (+) or below (−) the ship's plane, in metres. */
  readonly heightMeters: number;
}

/** The styling family a bracket belongs to. A key, never a colour. */
export type TacticalRole =
  | "self"
  | "hostile"
  | "police"
  | "drone"
  | "station"
  | "gate"
  | "celestial"
  | "asteroid"
  | "wreck"
  | "ship";

/** One projected object, ready to draw. */
export interface TacticalBracket extends TacticalPoint {
  readonly role: TacticalRole;
  /** The object's own name, when it has one. Never an id (R7d). */
  readonly name: string | null;
  readonly typeID: number | null;
  /** Remaining fractions 0-1, or null where the object has no such layer. */
  readonly shieldRatio: number | null;
  readonly armorRatio: number | null;
  readonly hullRatio: number | null;
  /** True when the object is moving fast enough to be worth a vector line. */
  readonly moving: boolean;
  /** Where the velocity vector points, in screen pixels from (x, y). */
  readonly vectorX: number;
  readonly vectorY: number;
}

const DEFAULT_MIN_RANGE = 1_000;
const DEFAULT_TILT = 0.42;
const DEFAULT_HEIGHT_GAIN = 0.35;
const DEFAULT_MARGIN = 28;

/** Metres a thing must be doing before it earns a velocity vector. */
const MOVING_THRESHOLD_MPS = 1;

/**
 * How far a full-speed vector line reaches, as a fraction of the plot radius.
 * The line is a DIRECTION indicator, not a to-scale prediction — there is no
 * honest way to draw "where it will be in 10 s" on a log-compressed radius, and
 * pretending otherwise would put a ship's arrow through a rock it will never
 * reach.
 */
const VECTOR_LENGTH_FRACTION = 0.075;

/**
 * Squeeze a ratio into 0-1.
 *
 * ⚠ THE NON-FINITE BRANCH IS LOAD-BEARING, NOT DEFENSIVE PADDING. It is the ONLY
 * thing standing between a degenerate range and a ruined plot — see
 * `radialFraction` below, which relies on it rather than pre-checking its own
 * bounds. Deleting it does not throw and does not produce a visible NaN; it welds
 * every bracket to the rim. Mutating it is caught by the degenerate-range test in
 * `tactical.test.ts`, which is where that behaviour is pinned.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The log compression, in one place: where a distance falls between the centre
 * (`min`) and the rim (`max`), as 0-1.
 *
 * ⚠ A DEGENERATE RANGE IS REAL AND IS HANDLED BY `clamp01`, NOT BY A BOUNDS CHECK
 * HERE. `max <= min` happens whenever a grid's only object is nearer than the
 * centre distance — one rock 200 m away auto-ranges to a rim at or below the 1 km
 * floor. `Math.log(max/min)` is then `log(1) = 0` and the division yields
 * ±Infinity, which `clamp01` collapses to the centre. That is the truth in that
 * case: everything really is on top of you.
 *
 * An explicit `if (max <= min) return 0` was tried here and removed — it could
 * never change the result, so no test could tell whether it was present, which
 * makes it exactly the kind of guard that reads as protection while protecting
 * nothing.
 */
export function radialFraction(distance: number, min: number, max: number): number {
  if (!Number.isFinite(distance) || distance <= min) {
    return 0;
  }
  return clamp01(Math.log(distance / min) / Math.log(max / min));
}

/**
 * The rim distance to use for a set of distances: the farthest one, rounded UP
 * to the next decade so the outermost object sits inside the rim rather than on
 * it, and floored so an empty or very tight grid still gets a sane plot.
 *
 * Auto-ranging rather than a fixed zoom is deliberate. A player who warps from a
 * belt (tens of km) to a planet (AU) would otherwise have to reach for a zoom
 * control on every arrival, and the one thing a viewport must never do is need
 * fiddling before it can be read.
 */
export function autoRangeMeters(
  distances: readonly number[],
  floorMeters = 50_000,
): number {
  let farthest = 0;
  for (const distance of distances) {
    if (Number.isFinite(distance) && distance > farthest) {
      farthest = distance;
    }
  }
  if (farthest <= 0) {
    return floorMeters;
  }
  // Next power of ten, with a little air so the farthest bracket is not welded
  // to the rim.
  const decade = Math.pow(10, Math.ceil(Math.log10(farthest * 1.15)));
  return Math.max(floorMeters, decade);
}

/** The plot's centre and usable radius, derived from the box. */
export function plotGeometry(view: TacticalViewport): {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
} {
  const margin = view.marginPx ?? DEFAULT_MARGIN;
  const cx = view.width / 2;
  const cy = view.height / 2;
  // The tilt squashes the disc vertically, so the vertical half-box constrains
  // the radius LESS than the horizontal one does. Taking the plain minimum would
  // waste the width the squashed disc no longer needs.
  const tilt = view.tilt ?? DEFAULT_TILT;
  const byWidth = view.width / 2 - margin;
  const byHeight = tilt > 0 ? (view.height / 2 - margin) / tilt : byWidth;
  return { cx, cy, radius: Math.max(0, Math.min(byWidth, byHeight)) };
}

/**
 * Project one world position, relative to the ship, onto the plot.
 *
 * The bearing is taken in the x/z plane; `y` becomes height. That mapping is the
 * server's, not a choice made here — EveJS positions are y-up.
 */
export function projectPoint(
  position: SpaceVector,
  origin: SpaceVector,
  view: TacticalViewport,
): Omit<TacticalPoint, "itemID"> {
  const { cx, cy, radius } = plotGeometry(view);
  const min = view.minRangeMeters ?? DEFAULT_MIN_RANGE;
  const tilt = view.tilt ?? DEFAULT_TILT;
  const heightGain = view.heightGain ?? DEFAULT_HEIGHT_GAIN;

  const dx = position.x - origin.x;
  const dy = position.y - origin.y;
  const dz = position.z - origin.z;

  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const radial = radialFraction(distance, min, view.maxRangeMeters);
  const clamped = distance > view.maxRangeMeters;

  // Bearing on the ground plane. An object DIRECTLY above the ship has no
  // bearing at all (dx and dz both ~0); atan2(0,0) is 0, which parks it at the
  // three-o'clock rim rather than over the ship — so the flat radius, not the
  // 3D one, drives how far out it is drawn.
  const groundDistance = Math.sqrt(dx * dx + dz * dz);
  const bearing = Math.atan2(dz, dx);
  const groundRadial =
    distance > 0 ? radial * clamp01(groundDistance / distance) : 0;
  const r = groundRadial * radius;

  const planeY = cy + Math.sin(bearing) * r * tilt;
  // Height uses the SAME log compression as range, so a 10× taller object is one
  // "decade" higher on screen rather than 10× further up the box.
  const heightSign = dy < 0 ? -1 : 1;
  const heightRadial = radialFraction(Math.abs(dy), min, view.maxRangeMeters);
  const heightPx = heightSign * heightRadial * radius * heightGain;

  return {
    x: cx + Math.cos(bearing) * r,
    // Screen y grows downward; positive world height must go UP.
    y: planeY - heightPx,
    planeY,
    distance,
    radial,
    clamped,
    heightMeters: dy,
  };
}

/**
 * Which styling family an object belongs to.
 *
 * ⚠ THE HOSTILITY TEST IS `isHostile`, NOT A KIND CHECK, and that is the whole
 * of R25's finding restated: a belt rat is `kind: "ship"` and is otherwise
 * indistinguishable from the player parked next to you. Anything that decides
 * "draw this one red" must go through the same predicate the threat panel uses,
 * or the viewport will quietly disagree with the warning list about who is
 * shooting.
 */
export function bracketRole(entity: SpaceEntity): TacticalRole {
  if (entity.isSelf) {
    return "self";
  }
  if (isHostile(entity)) {
    return "hostile";
  }
  if (entity.isNpc && entity.npcEntityType === "concord") {
    return "police";
  }
  if (entity.kind === "drone") {
    return "drone";
  }
  if (entity.kind === "structure" || entity.kind === "station") {
    return "station";
  }
  if (entity.kind === "wreck") {
    return "wreck";
  }
  // A rock is a celestial to the runtime; what separates it is that the server
  // stamped it with an ore yield / remaining quantity (R23 slice B).
  if (entity.miningYieldTypeID !== null || entity.remainingQuantity !== null) {
    return "asteroid";
  }
  if (entity.kind === "celestial") {
    // Stargates are celestials the router knows about. Group 10 is the stargate
    // group; anything else stays a plain celestial.
    return entity.groupID === 10 ? "gate" : "celestial";
  }
  return "ship";
}

/**
 * Project a whole snapshot's entities into brackets, nearest last so the
 * painter's algorithm draws close things over distant ones.
 *
 * The player's own ship is dropped — it is always at the centre and the view
 * draws its own marker there, exactly as `buildOverviewRows` drops it from the
 * list.
 */
export function projectBrackets(
  entities: readonly SpaceEntity[],
  origin: SpaceVector,
  view: TacticalViewport,
): readonly TacticalBracket[] {
  const { radius } = plotGeometry(view);
  const out: TacticalBracket[] = [];
  for (const entity of entities) {
    if (entity.isSelf) {
      continue;
    }
    const point = projectPoint(entity.position, origin, view);
    const speed = Math.sqrt(
      entity.velocity.x * entity.velocity.x +
        entity.velocity.y * entity.velocity.y +
        entity.velocity.z * entity.velocity.z,
    );
    const moving = Number.isFinite(speed) && speed >= MOVING_THRESHOLD_MPS;
    // The vector is drawn in the same squashed ground plane the disc uses, so an
    // arrow reads as movement ACROSS the disc rather than up the screen.
    const tilt = view.tilt ?? DEFAULT_TILT;
    const vectorLength = radius * VECTOR_LENGTH_FRACTION;
    const vectorX = moving ? (entity.velocity.x / speed) * vectorLength : 0;
    const vectorY = moving ? (entity.velocity.z / speed) * vectorLength * tilt : 0;
    out.push({
      itemID: entity.itemID,
      ...point,
      role: bracketRole(entity),
      name: entity.name,
      typeID: entity.typeID,
      shieldRatio: entity.shieldRatio,
      armorRatio: entity.armorRatio,
      hullRatio: entity.hullRatio,
      moving,
      vectorX,
      vectorY,
    });
  }
  // Farthest first — so the nearest bracket ends up on top when drawn in order.
  out.sort((left, right) => right.distance - left.distance);
  return out;
}

/** One labelled range ring. */
export interface TacticalRing {
  /** The distance the ring stands for, in metres. */
  readonly meters: number;
  /** 0-1 from the centre — multiply by the plot radius. */
  readonly radial: number;
  /** What the ring says: "10 km", "1 AU". Units, never an id (R7d). */
  readonly label: string;
}

/**
 * The distances worth drawing a ring at. A fixed ladder rather than an even
 * subdivision of the range, because a ring is only useful if it stands for a
 * number a pilot already thinks in — 10 km is a scram, 150 km is a warp-in,
 * 1 AU is a warp. "2.7 km" is a ring nobody reads.
 */
const RING_LADDER: readonly number[] = [
  1_000,
  5_000,
  10_000,
  50_000,
  100_000,
  500_000,
  1_000_000,
  10_000_000,
  METRES_PER_AU / 10,
  METRES_PER_AU / 2,
  METRES_PER_AU,
  METRES_PER_AU * 5,
  METRES_PER_AU * 20,
  METRES_PER_AU * 100,
];

function ringLabel(meters: number): string {
  if (meters >= METRES_PER_AU / 10) {
    const au = meters / METRES_PER_AU;
    return `${au >= 1 ? Math.round(au) : au.toFixed(1)} AU`;
  }
  return `${Math.round(meters / 1_000)} km`;
}

/**
 * The rings for a viewport, outermost last. Capped so a wide range does not
 * produce a bullseye — beyond about five rings the plot reads as texture rather
 * than as a scale.
 */
export function tacticalRings(view: TacticalViewport, maxRings = 5): readonly TacticalRing[] {
  const min = view.minRangeMeters ?? DEFAULT_MIN_RANGE;
  const inRange = RING_LADDER.filter(
    (meters) => meters > min && meters <= view.maxRangeMeters,
  );
  if (inRange.length === 0) {
    return [];
  }
  // Keep the outermost, then thin inwards by an even stride — so the rim always
  // carries a ring (it is the one the rest are read against).
  const stride = Math.ceil(inRange.length / maxRings);
  const kept: number[] = [];
  for (let index = inRange.length - 1; index >= 0; index -= stride) {
    kept.push(inRange[index] as number);
  }
  kept.reverse();
  return kept.map((meters) => ({
    meters,
    radial: radialFraction(meters, min, view.maxRangeMeters),
    label: ringLabel(meters),
  }));
}

/**
 * Which bracket a click at (x, y) landed on — the nearest one within
 * `tolerancePx`, or null.
 *
 * ⚠ NEAREST BY SCREEN DISTANCE, NOT FIRST MATCH. Brackets overlap constantly
 * (a belt is a cluster), and a first-match hit test hands the player whichever
 * one happens to be earliest in the array — which, because `projectBrackets`
 * sorts farthest-first, is reliably the one they can see LEAST of. Ties go to
 * the nearer object in space, which is the one drawn on top.
 */
export function hitTestBrackets(
  brackets: readonly TacticalBracket[],
  x: number,
  y: number,
  tolerancePx = 18,
): TacticalBracket | null {
  let best: TacticalBracket | null = null;
  let bestScore = Infinity;
  for (const bracket of brackets) {
    const dx = bracket.x - x;
    const dy = bracket.y - y;
    const screen = Math.sqrt(dx * dx + dy * dy);
    if (screen > tolerancePx) {
      continue;
    }
    if (screen < bestScore || (screen === bestScore && best !== null && bracket.distance < best.distance)) {
      best = bracket;
      bestScore = screen;
    }
  }
  return best;
}

/**
 * Which brackets earn a TEXT LABEL.
 *
 * ⚠ THE PROBLEM THIS SOLVES IS THAT LABELLING EVERYTHING LABELS NOTHING. A belt
 * is a cluster of two dozen rocks inside a few hundred metres of each other on a
 * log-compressed plot; drawing every name turns the middle of the viewport into
 * an unreadable mat of overlapping text, and the one bracket the player is
 * actually looking for is the one they can no longer find.
 *
 * So three things earn a name, in this order of priority:
 *   1. the SELECTED object — always, because the player is looking at it;
 *   2. every HOSTILE — always, because "which one is shooting me" is the
 *      question a label most needs to answer, and a threat you cannot name is a
 *      threat you cannot report;
 *   3. the nearest few of everything else, up to `cap`.
 *
 * Returns a Set of itemIDs rather than a filtered list so the draw loop keeps
 * painting every bracket and only consults this for the text.
 */
export function labelledBracketIDs(
  brackets: readonly TacticalBracket[],
  selectedID: number | null,
  cap = 8,
): ReadonlySet<number> {
  const ids = new Set<number>();
  if (selectedID !== null) {
    ids.add(selectedID);
  }
  for (const bracket of brackets) {
    if (bracket.role === "hostile") {
      ids.add(bracket.itemID);
    }
  }
  // `brackets` arrives farthest-first (painter's order), so walk it backwards to
  // take the NEAREST of the remainder.
  let taken = 0;
  for (let index = brackets.length - 1; index >= 0 && taken < cap; index -= 1) {
    const bracket = brackets[index];
    if (!bracket || ids.has(bracket.itemID)) {
      continue;
    }
    ids.add(bracket.itemID);
    taken += 1;
  }
  return ids;
}

/**
 * Distance from the ship to each entity — the input `autoRangeMeters` wants.
 * Here rather than at the call site so the viewport and the overview measure the
 * same way (centre to centre, as `distanceMeters` does).
 */
export function entityDistances(
  entities: readonly SpaceEntity[],
  origin: SpaceVector,
): readonly number[] {
  const out: number[] = [];
  for (const entity of entities) {
    if (entity.isSelf) {
      continue;
    }
    out.push(distanceMeters(origin, entity.position));
  }
  return out;
}
