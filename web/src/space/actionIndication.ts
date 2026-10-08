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
// Not here yet: a ship going to a point or aligning (mode GOTO, which needs
// the point), and a warp. For those, and whenever the range is not known, the
// caller keeps its own words.

import { formatTemplate, plainText } from "../bridge/clientWords.ts";
import { fmtDist, type DistanceSay } from "./overview.ts";
import type { SpaceSnapshot } from "../store/types.ts";

/** appConst.approachRange: the range an approach is ordered at. */
export const APPROACH_RANGE = 50;

export type ActionKind = "orbit" | "approach" | "keepAtRange";

export interface ActionIndication {
  readonly kind: ActionKind;
  /** The range in the order, in metres. */
  readonly range: number;
}

/** The client's labels: a header with no parameters, and the line beneath it. */
export const INDICATION_LABELS: Readonly<Record<ActionKind, { readonly header: string; readonly sub: string }>> = {
  orbit: { header: "UI/Inflight/Messages/OrbitingHeader", sub: "UI/Inflight/Messages/OrbitingSubText" },
  approach: { header: "UI/Inflight/Messages/ApproachingHeader", sub: "UI/Inflight/Messages/ApproachingSubText" },
  keepAtRange: { header: "UI/Inflight/Messages/KeepingAtRangeHeader", sub: "UI/Inflight/Messages/KeepingAtRangeSubText" },
};

/** Every label above, to ask the BFF for. */
export const INDICATION_WORD_LABELS: readonly string[] = Object.values(INDICATION_LABELS).flatMap(({ header, sub }) => [header, sub]);

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
 * The indication for the snapshot's own ship, and whom it follows: its mode
 * and the range in its order from the ship, whom from the ship's own row.
 */
export function shipIndication(snapshot: SpaceSnapshot | null | undefined): (ActionIndication & { readonly followID: number }) | null {
  const ship = snapshot?.ship ?? null;
  if (!snapshot || !ship) {
    return null;
  }
  const followID = snapshot.entities.find((entity) => entity.itemID === ship.itemID)?.targetEntityID ?? null;
  const indication = actionIndication(ship.mode, followID, ship.followRange);
  return indication === null || followID === null ? null : { ...indication, followID };
}

/** This page's own words, for when the client's are not to hand. */
const OWN_HEADER: Readonly<Record<ActionKind, string>> = { orbit: "Orbiting", approach: "Approaching", keepAtRange: "Holding range on" };

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
