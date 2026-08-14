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
// So the RADIUS is compressed and the BEARING is not. Direction is truthful: a
// rock to galactic north is drawn north, and two rocks 30° apart are drawn 30°
// apart. Distance is ORDERED and readable but not to scale — which is precisely
// the bargain retail's own tactical overlay strikes, and why it draws labelled
// range rings. The rings are not decoration: they are what makes a compressed
// radius legible.
//
// R86 went further and made the rings the DEFINITION of the compression rather
// than markings on top of it — see RANGE_ANCHORS. A plain logarithm gave the
// inner fifth of the plot to everything out to 100 km, which is every range at
// which a pilot actually decides anything.
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
 * ⚠ THE NON-FINITE BRANCH IS LOAD-BEARING, NOT DEFENSIVE PADDING. A degenerate
 * interpolation hands back NaN or Infinity, and a canvas silently declines to
 * draw either — so a bracket would simply not appear rather than appear wrongly.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** One point where a distance is pinned to a fraction of the plot radius. */
export interface RangeAnchor {
  readonly meters: number;
  /** 0 at the ship, 1 at the rim. */
  readonly radial: number;
}

/**
 * THE SCALE, DEFINED BY THE RINGS THAT MATTER (goal R86).
 *
 * ⚠ WHY THIS IS A TABLE AND NOT A FORMULA. The first version was a plain
 * logarithm from 1 km to whatever the farthest object happened to be, and it was
 * measurably wrong for the way the picture is actually used: at a 20 AU rim it
 * put 10 km at 11% of the radius, 50 km at 18% and 100 km at 21%. The ENTIRE
 * combat and mining envelope — every range at which a pilot makes a decision —
 * lived in the inner fifth of the plot, while four fifths were spent on empty
 * space between 100 km and the horizon.
 *
 * So the ranges a pilot thinks in are pinned to where they should APPEAR, and
 * the curve is fitted to them rather than the other way round. 0-100 km now owns
 * 68% of the radius. Everything past it still spreads (500 km at 71%, 1 AU at
 * 94%), because the outer band is interpolated logarithmically — it is
 * compressed, not collapsed.
 *
 * The scale is also FIXED rather than auto-ranged to what is on grid. That is a
 * deliberate trade: a plot whose meaning changes as objects come and go can be
 * read but not learnt, and these four rings are worth learning. The cost is that
 * a grid holding nothing past 20 km uses only the inner 40% — visible, spread,
 * and honest about how close everything is.
 */
export const RANGE_ANCHORS: readonly RangeAnchor[] = [
  { meters: 0, radial: 0 },
  { meters: 10_000, radial: 0.3 },
  { meters: 50_000, radial: 0.52 },
  { meters: 100_000, radial: 0.68 },
  { meters: 20 * METRES_PER_AU, radial: 1 },
];

/** The farthest distance the plot can express; beyond it, brackets pin to the rim. */
export const MAX_RANGE_METERS: number =
  RANGE_ANCHORS[RANGE_ANCHORS.length - 1]?.meters ?? 20 * METRES_PER_AU;

/**
 * Where a distance falls between the ship and the rim, 0-1.
 *
 * Interpolates between the anchors above: LINEARLY inside the innermost band and
 * LOGARITHMICALLY beyond it.
 *
 * ⚠ THE TWO INTERPOLATIONS ARE DIFFERENT ON PURPOSE. The innermost band contains
 * zero, which has no logarithm — but more than that, at scram range a pilot wants
 * TRUE relative spacing: 2 km and 8 km should look four times apart, because that
 * is what they are, and a log there would flatten exactly the distances being
 * judged most finely. Past 10 km the bands span decades and only a log keeps them
 * readable.
 */
export function radialFraction(distance: number): number {
  // ⚠ THESE TWO EARLY RETURNS ARE BELT-AND-BRACES, NOT THE ENFORCEMENT.
  // Deleting either leaves the behaviour correct — `clamp01` already floors a
  // negative distance at 0, and the loop below already falls through to 1 for
  // anything past the outermost anchor. A mutation run proved exactly that: both
  // deletions survived a full test pass.
  //
  // They stay because they state the contract where a reader will look for it
  // and cost nothing. But do not assume a test will catch you removing one —
  // what the tests pin is the RESULT (0 at or below the ship, 1 past the rim,
  // never NaN), which is the thing that actually matters.
  if (!Number.isFinite(distance) || distance <= 0) {
    return 0;
  }
  if (distance >= MAX_RANGE_METERS) {
    return 1;
  }
  for (let index = 1; index < RANGE_ANCHORS.length; index += 1) {
    const low = RANGE_ANCHORS[index - 1] as RangeAnchor;
    const high = RANGE_ANCHORS[index] as RangeAnchor;
    if (distance > high.meters) {
      continue;
    }
    const span = high.radial - low.radial;
    if (low.meters <= 0) {
      // The innermost band: linear, so near distances keep their true ratios.
      return clamp01(low.radial + span * (distance / high.meters));
    }
    return clamp01(
      low.radial + span * (Math.log(distance / low.meters) / Math.log(high.meters / low.meters)),
    );
  }
  return 1;
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
  const tilt = view.tilt ?? DEFAULT_TILT;
  const heightGain = view.heightGain ?? DEFAULT_HEIGHT_GAIN;

  const dx = position.x - origin.x;
  const dy = position.y - origin.y;
  const dz = position.z - origin.z;

  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const radial = radialFraction(distance);
  const clamped = distance > MAX_RANGE_METERS;

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
  const heightRadial = radialFraction(Math.abs(dy));
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
  /** What the ring says: "10 km", "20 AU". Units, never an id (R7d). */
  readonly label: string;
}

function ringLabel(meters: number): string {
  if (meters >= METRES_PER_AU) {
    const au = meters / METRES_PER_AU;
    return `${Number.isInteger(au) ? au : au.toFixed(1)} AU`;
  }
  return `${Math.round(meters / 1_000)} km`;
}

/**
 * The rings.
 *
 * ⚠ THEY ARE THE SCALE'S OWN ANCHORS, not a ladder chosen to fit a range. That
 * is the whole point of R86: a ring is where it is because the scale was BUILT
 * to put it there, so the picture cannot drift out of step with its own labels.
 * Adding a ring means adding an anchor, which means deciding what it costs the
 * bands either side of it — which is the decision that should be deliberate.
 *
 * The ship's own position (anchor 0) is not a ring; there is nothing to label.
 */
export function tacticalRings(): readonly TacticalRing[] {
  return RANGE_ANCHORS.filter((anchor) => anchor.meters > 0).map((anchor) => ({
    meters: anchor.meters,
    radial: anchor.radial,
    label: ringLabel(anchor.meters),
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
