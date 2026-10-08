// A distance's unit in the retail client's own words.
//
// The client words a distance with one of three labels, each with a single
// parameter, {distance}: the figure it has already formatted
// (carbon/common/script/util/format.py FmtDist). The labels are read from the
// client's install by the BFF (/api/words) like any other of its words; until
// they are to hand, and on a BFF that has no client to read, the page's own
// words stand in.

import { formatTemplate, plainText } from "../bridge/clientWords.ts";
import { DISTANCE_LABELS, ownDistanceWords, type DistanceSay } from "./overview.ts";

/** The labels to ask the BFF for. */
export const DISTANCE_WORD_LABELS: readonly string[] = Object.values(DISTANCE_LABELS);

/** No names are looked up in a distance's words. */
const NO_NAMES = { nameOf: () => "" };

/**
 * How to put a figure with its unit, from the words the page holds:
 * the client's label for that unit when it is there, the page's own otherwise.
 */
export function distanceSay(templates: Readonly<Record<string, string | null | undefined>>): DistanceSay {
  return (unit, figure) => {
    const template = templates[DISTANCE_LABELS[unit]];
    return typeof template === "string" ? plainText(formatTemplate(template, { distance: figure }, NO_NAMES)) : ownDistanceWords(unit, figure);
  };
}
