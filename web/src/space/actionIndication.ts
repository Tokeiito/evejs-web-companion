// What the ship is doing, as the retail client's HUD says it.
//
// The client's HUD carries a line about the ship's own manoeuvre, a header
// and a line beneath, made from the pilot's own ball and nothing else
// (eve/client/script/parklife/spaceMgr.py, GetHeaderAndSubtextForActionIndication):
//
//   mode ORBIT, following something    "orbiting", and whom, and at what range
//   mode FOLLOW, following something   the range it was told to keep decides:
//                                        50 m (the approach range) or none: "approaching", and whom
//                                        anything else: "keeping at range", whom, and the range
//
// The range is the one in the ORDER (the ball's followRange), worded by FmtDist
// with no decimals. It is not how far away the thing is now.
//
//   mode GOTO (GetBallApproachType)    by how far the point it is flying to is:
//                                        under 1 km: nothing
//                                        up to 10,000 km: "approaching a point in space"
//                                        farther: "aligning to a point in space", until its
//                                        course is within 0.26 radians of the point; then nothing
//
// Not here yet: what the pilot last aligned to, which the client remembers and
// names in place of "a point in space"; and a warp. For those, and whenever
// the range or the point is not known, the caller keeps its own words.

import { formatTemplate, plainText } from "../bridge/clientWords.ts";
import { fmtDist, type DistanceSay } from "./overview.ts";
import type { SpaceSnapshot, SpaceVector } from "../store/types.ts";

/** appConst.approachRange: the range an approach is ordered at. */
export const APPROACH_RANGE = 50;

/** appConst.maxApproachDistance: a point farther than this is aligned to, not approached. */
export const MAX_APPROACH_DISTANCE = 10_000_000;
/** spaceMgr.GetBallApproachType: a point nearer than this is not spoken of. */
export const CLOSE_DISTANCE = 1_000;
/** spaceMgr.DEGREES_15, as it is written there: a course within this of the point is lined up. */
export const ALIGNED_ANGLE = 0.26;

export type FollowKind = "orbit" | "approach" | "keepAtRange";
export type PointKind = "approachPoint" | "alignPoint";
export type ActionKind = FollowKind | PointKind;

export interface ActionIndication {
  readonly kind: FollowKind;
  /** The range in the order, in metres. */
  readonly range: number;
}

export interface PointIndication {
  readonly kind: PointKind;
}

/** The client's labels: a header with no parameters, and the line beneath it. */
export const INDICATION_LABELS: Readonly<Record<ActionKind, { readonly header: string; readonly sub: string }>> = {
  orbit: { header: "UI/Inflight/Messages/OrbitingHeader", sub: "UI/Inflight/Messages/OrbitingSubText" },
  approach: { header: "UI/Inflight/Messages/ApproachingHeader", sub: "UI/Inflight/Messages/ApproachingSubText" },
  keepAtRange: { header: "UI/Inflight/Messages/KeepingAtRangeHeader", sub: "UI/Inflight/Messages/KeepingAtRangeSubText" },
  approachPoint: { header: "UI/Inflight/Messages/ApproachingHeader", sub: "UI/Inflight/Messages/ApproachingPointSubText" },
  alignPoint: { header: "UI/Inflight/Messages/AligningHeader", sub: "UI/Inflight/Messages/AligningToPointSubText" },
};

/** Every label above, once each, to ask the BFF for. */
export const INDICATION_WORD_LABELS: readonly string[] = [...new Set(Object.values(INDICATION_LABELS).flatMap(({ header, sub }) => [header, sub]))];

/**
 * What a ship flying to a point is doing, by how far the point is and whether
 * its course is on it (spaceMgr.GetBallApproachType); null when the client
 * says nothing, or the ship is not flying to a point, or the point is not known.
 */
export function pointIndication(
  mode: string | null | undefined,
  position: SpaceVector | null | undefined,
  velocity: SpaceVector | null | undefined,
  gotoPoint: SpaceVector | null | undefined,
): PointIndication | null {
  if ((mode ?? "").trim().toUpperCase() !== "GOTO" || !position || !gotoPoint) {
    return null;
  }
  const to = { x: gotoPoint.x - position.x, y: gotoPoint.y - position.y, z: gotoPoint.z - position.z };
  const distance = Math.hypot(to.x, to.y, to.z);
  if (!Number.isFinite(distance) || distance < CLOSE_DISTANCE) {
    return null;
  }
  if (distance <= MAX_APPROACH_DISTANCE) {
    return { kind: "approachPoint" };
  }
  // The angle between where it is heading and where the point is. A ship that is not moving heads nowhere,
  // which counts as a right angle off.
  const speed = velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : 0;
  const dot = velocity && speed > 0 ? (velocity.x * to.x + velocity.y * to.y + velocity.z * to.z) / (speed * distance) : 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return angle < ALIGNED_ANGLE ? null : { kind: "alignPoint" };
}

/**
 * What the ship is doing to the thing it follows, or null when the client's
 * rule has nothing to say: it follows nothing, its mode is neither of the two,
 * or the range is not known.
 */
export function actionIndication(mode: string | null | undefined, followID: number | null | undefined, followRange: number | null | undefined): ActionIndication | null {
  if (followID === null || followID === undefined || followID === 0) {
    return null;
  }
  if (typeof followRange !== "number" || !Number.isFinite(followRange)) {
    return null;
  }
  const key = (mode ?? "").trim().toUpperCase();
  if (key === "ORBIT") {
    return { kind: "orbit", range: followRange };
  }
  if (key === "FOLLOW") {
    return { kind: followRange === APPROACH_RANGE || followRange === 0 ? "approach" : "keepAtRange", range: followRange };
  }
  return null;
}

/**
 * The indication for the snapshot's own ship: what it is doing to the thing it
 * follows (and whom: its mode and the range in its order from the ship, whom
 * from the ship's own row), or failing that what it is doing about the point
 * it is flying to.
 */
export function shipIndication(snapshot: SpaceSnapshot | null | undefined): (ActionIndication & { readonly followID: number }) | PointIndication | null {
  const ship = snapshot?.ship ?? null;
  if (!snapshot || !ship) {
    return null;
  }
  const followID = snapshot.entities.find((entity) => entity.itemID === ship.itemID)?.targetEntityID ?? null;
  const indication = actionIndication(ship.mode, followID, ship.followRange);
  if (indication !== null && followID !== null) {
    return { ...indication, followID };
  }
  return pointIndication(ship.mode, ship.position, ship.velocity, ship.gotoPoint);
}

/** This page's own words, for when the client's are not to hand. */
const OWN_HEADER: Readonly<Record<ActionKind, string>> = {
  orbit: "Orbiting",
  approach: "Approaching",
  keepAtRange: "Holding range on",
  approachPoint: "Approaching",
  alignPoint: "Aligning",
};
const OWN_POINT: Readonly<Record<PointKind, string>> = { approachPoint: "Heading for a point in space", alignPoint: "Turning towards a point in space" };

/**
 * The line beneath the header for a ship flying to a point. The client's says
 * the whole of it ("approaching a point in space"), so where there is room for
 * one line this is the one.
 */
export function pointText(kind: PointKind, templates: Readonly<Record<string, string | null | undefined>>): string {
  const template = templates[INDICATION_LABELS[kind].sub];
  return typeof template === "string" ? plainText(template).trim() : OWN_POINT[kind];
}

export interface IndicationText {
  readonly header: string;
  readonly sub: string;
}

/** The header alone, for where there is room for a word and no more. */
export function indicationHeader(kind: ActionKind, templates: Readonly<Record<string, string | null | undefined>>): string {
  const template = templates[INDICATION_LABELS[kind].header];
  return typeof template === "string" ? plainText(template).trim() : OWN_HEADER[kind];
}

/**
 * The header and the line beneath it, in the client's own words when the page
 * holds them. `targetName` is what the caller calls the thing followed.
 */
export function indicationText(
  indication: ActionIndication,
  targetName: string,
  templates: Readonly<Record<string, string | null | undefined>>,
  say?: DistanceSay,
): IndicationText {
  const labels = INDICATION_LABELS[indication.kind];
  const rangeText = fmtDist(indication.range, 0, say);
  const worded = (label: string, own: string): string => {
    const template = templates[label];
    if (typeof template !== "string") {
      return own;
    }
    return plainText(formatTemplate(template, { targetName, rangeText }, { nameOf: () => "" })).trim();
  };
  return {
    header: worded(labels.header, OWN_HEADER[indication.kind]),
    sub: worded(labels.sub, indication.kind === "approach" ? targetName : `${targetName}, at ${rangeText}`),
  };
}
