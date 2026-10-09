// A place's name as the retail client writes one for a mission: its system's security rating before it,
// and a warning after it where the way there is not safe.
//
// agentDialogueUtil.LocationWrapper (164 to 202) hands the label UI/Agents/LocationWrapper the rating
// (in the colour of that security), the place's name as a link, and a warning: "low security" where the
// system is low security or lower. Here it is plain text, so the colour and the link are not there.
//
// Not done: the second warning, for a pilot whose own security status is -5.0 or worse going anywhere
// that is not low security; the icon for a system whose security the server has changed.

import { formatTemplate, plainText } from "./clientWords.ts";
import type { MissionLocation, MissionObjectives } from "./missionObjectives.ts";
import { isLowSecOrLower, shownSecurity } from "./systemSecurity.ts";

export const LOCATION_LABELS = Object.freeze({
  /** Takes securityRating, locationName and securityWarning (and the tags and image this leaves empty). */
  wrapper: "UI/Agents/LocationWrapper",
  lowSecWarning: "UI/Agents/LowSecWarning",
});
export const LOCATION_WORD_LABELS: readonly string[] = Object.values(LOCATION_LABELS);

type Templates = Readonly<Record<string, string | null | undefined>>;

/**
 * A place's name wrapped as the client wraps it. The name alone when its system's security is not known
 * (`securityOf` answers null, or the place names no system), or the client's words for the wrapper are
 * not to hand.
 */
export function wrapLocation(name: string, solarSystemID: number | null, templates: Templates, securityOf: (solarSystemID: number) => number | null): string {
  const security = solarSystemID === null ? null : securityOf(solarSystemID);
  const wrapper = templates[LOCATION_LABELS.wrapper];
  if (security === null || typeof wrapper !== "string") {
    return name;
  }
  const lowSec = templates[LOCATION_LABELS.lowSecWarning];
  const warning = isLowSecOrLower(security) && typeof lowSec === "string" ? lowSec : "";
  const args = { startFontTag: "", endFontTag: "", image: "", securityRating: shownSecurity(security), locationName: name, securityWarning: warning };
  return plainText(formatTemplate(wrapper, args, { nameOf: () => "" })).trim();
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
