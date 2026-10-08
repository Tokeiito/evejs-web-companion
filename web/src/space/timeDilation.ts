// Time dilation, as the retail client shows it.
//
// The client's indicator (tidiIndicator.py, TiDiIndicator.Animate) reads the pace its clock is meant to
// hold, blue.os.desiredSimDilation, every frame. It is on show while that is under 0.98, and gone at 0.98
// and above. Its hint is the client's own label, with the pace as a whole percentage, cut and not rounded
// (int(curFactor * 100)). The client draws a pie; here it is the percentage, with the hint behind it.
//
// The label's text is the client's and is read from its install at run time (the words store); what is
// written here is only what is said when that cannot be had.

import { formatTemplate, plainText } from "../bridge/clientWords.ts";

/** The indicator's hint. Its one argument is tidiAmount. */
export const TIDI_TOOLTIP_LABEL = "UI/Neocom/TidiTooltip";
export const TIDI_WORD_LABELS: readonly string[] = [TIDI_TOOLTIP_LABEL];
/** At this pace and above the indicator is not shown. */
export const TIDI_SHOWN_BELOW = 0.98;

/** The percentage the indicator shows for a clock at `pace`, or null when it shows nothing. */
export function tidiPercent(pace: number | null | undefined): number | null {
  if (typeof pace !== "number" || !Number.isFinite(pace) || pace <= 0 || pace >= TIDI_SHOWN_BELOW) {
    return null;
  }
  return Math.trunc(pace * 100);
}

/** The indicator's hint for that percentage, in the client's words when they are to hand. */
export function tidiHint(percent: number, templates: Readonly<Record<string, string | null | undefined>>): string {
  const template = templates[TIDI_TOOLTIP_LABEL];
  if (typeof template !== "string") {
    return `Time is running at ${percent}% of its usual pace here.`;
  }
  return plainText(formatTemplate(template, { tidiAmount: String(percent) }, { nameOf: () => "" })).trim();
}
