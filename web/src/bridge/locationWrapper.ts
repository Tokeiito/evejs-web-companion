// A place's name as the retail client writes one for a mission: its system's security rating before it,
// and a warning after it where the way there is not safe.
//
// agentDialogueUtil.LocationWrapper (164 to 202) hands the label UI/Agents/LocationWrapper the rating
// (in the colour of that security), the place's name as a link, and a warning: "low security" where the
// system is low security or lower; and, anywhere else, the high-security one where the pilot's own security
// status is -5.0 or worse (crimewatchSvc.GetMySecurityStatus, which the client asks only then, and keeps).
// wrapLocation writes it as plain text; wrapLocationRuns as runs, for a page that draws them: the rating in the
// colour of that security (get_security_status_color), the name as a link to the place's own information
// (showinfo:typeID//locationID), and the warning in the client's red (#E3170D).
//
// Not done: the icon for a system whose security the server has changed, and the class that change makes.

import { formatTemplate, plainText } from "./clientWords.ts";
import type { MissionLocation, MissionObjectives } from "./missionObjectives.ts";
import { isLowSecOrLower, securityStatusColor, shownSecurity } from "./systemSecurity.ts";

export const LOCATION_LABELS = Object.freeze({
  /** Takes securityRating, locationName and securityWarning (and the tags and image this leaves empty). */
  wrapper: "UI/Agents/LocationWrapper",
  lowSecWarning: "UI/Agents/LowSecWarning",
  highSecWarning: "UI/Agents/HighSecWarning",
});

/** The pilot's own security status at which the client warns of a place that is not low security. */
const OUTLAW_SECURITY_STATUS = -5;
export const LOCATION_WORD_LABELS: readonly string[] = Object.values(LOCATION_LABELS);

type Templates = Readonly<Record<string, string | null | undefined>>;

/**
 * A place's name wrapped as the client wraps it. The name alone when its system's security is not known
 * (`securityOf` answers null, or the place names no system), or the client's words for the wrapper are
 * not to hand. `ownSecurityStatus` is asked only for a place that is not low security, as the client asks
 * its crimewatch service; null (not yet known) gives no warning.
 */
export function wrapLocation(name: string, solarSystemID: number | null, templates: Templates, securityOf: (solarSystemID: number) => number | null,
  ownSecurityStatus: () => number | null = () => null): string {
  const runs = wrapLocationRuns(name, solarSystemID, templates, securityOf, ownSecurityStatus, null);
  return runs === null ? name : runs.map((run) => run.text).join("").trim();
}

/** A run of a wrapped place: its text, the colour it is drawn in, and the thing it links to. */
export interface PlaceRun {
  readonly text: string;
  readonly color?: string;
  readonly link?: { readonly typeID: number; readonly itemID: number };
}

/** The client's red for a place's warning (LocationWrapper: '<font color=#E3170D>'). */
const WARNING_COLOR = "#E3170D";
// Marks around what the label's tags put in, found again once the label is written: private-use characters, which no
// label holds.
const [RATING_ON, RATING_OFF, NAME_ON, NAME_OFF, WARNING_ON, WARNING_OFF] = ["\uE000", "\uE001", "\uE002", "\uE003", "\uE004", "\uE005"];

/**
 * The same place in runs, or null where the name alone is all that can be said (as wrapLocation). `link` is the
 * thing the name links to (LocationWrapper's linkdata: the place's type and its own ID), or null for none.
 */
export function wrapLocationRuns(name: string, solarSystemID: number | null, templates: Templates, securityOf: (solarSystemID: number) => number | null,
  ownSecurityStatus: () => number | null = () => null, link: { readonly typeID: number; readonly itemID: number } | null = null): readonly PlaceRun[] | null {
  const security = solarSystemID === null ? null : securityOf(solarSystemID);
  const wrapper = templates[LOCATION_LABELS.wrapper];
  if (security === null || typeof wrapper !== "string") {
    return null;
  }
  let warning = "";
  if (isLowSecOrLower(security)) {
    const lowSec = templates[LOCATION_LABELS.lowSecWarning];
    warning = typeof lowSec === "string" ? lowSec : "";
  } else {
    const own = ownSecurityStatus();
    const highSec = templates[LOCATION_LABELS.highSecWarning];
    warning = own !== null && own <= OUTLAW_SECURITY_STATUS && typeof highSec === "string" ? highSec : "";
  }
  const args = {
    startFontTag: RATING_ON,
    endFontTag: RATING_OFF,
    image: "",
    securityRating: shownSecurity(security),
    locationName: `${NAME_ON}${name}${NAME_OFF}`,
    securityWarning: warning === "" ? "" : `${WARNING_ON}${warning}${WARNING_OFF}`,
  };
  const written = plainText(formatTemplate(wrapper, args, { nameOf: () => "" }));
  const ratingColor = securityStatusColor(security);
  const runs: PlaceRun[] = [];
  let style: Omit<PlaceRun, "text"> = {};
  let text = "";
  const close = (): void => {
    if (text !== "") runs.push({ text, ...style });
    text = "";
  };
  for (const character of written) {
    if (character === RATING_ON || character === NAME_ON || character === WARNING_ON) {
      close();
      style = character === RATING_ON ? { color: ratingColor } : character === WARNING_ON ? { color: WARNING_COLOR } : link === null ? {} : { link };
    } else if (character === RATING_OFF || character === NAME_OFF || character === WARNING_OFF) {
      close();
      style = {};
    } else {
      text += character;
    }
  }
  close();
  // The line as the client trims it: no space before the first run, nor after the last.
  if (runs.length > 0) {
    runs[0] = { ...runs[0]!, text: runs[0]!.text.trimStart() };
    runs[runs.length - 1] = { ...runs[runs.length - 1]!, text: runs[runs.length - 1]!.text.trimEnd() };
  }
  return runs.filter((run) => run.text !== "");
}

/** The solar systems a mission's places are in, for asking their security. */
export function objectiveSystemIDs(objectives: MissionObjectives): number[] {
  const places: Array<MissionLocation | null> = [];
  for (const objective of objectives.objectives) {
    if (objective.kind === "agent") {
      places.push(objective.location);
    } else if (objective.kind === "transport") {
      places.push(objective.pickup, objective.dropoff);
    } else {
      places.push(objective.dropoff);
    }
  }
  for (const dungeon of objectives.dungeons) {
    places.push(dungeon.location);
  }
  return [...new Set(places.map((place) => place?.solarsystemID ?? null).filter((id): id is number => id !== null && id > 0))];
}
