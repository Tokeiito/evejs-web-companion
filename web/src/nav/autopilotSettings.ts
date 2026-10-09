// The autopilot's settings, as the retail client keeps them.
//
// The client keeps them with the character's own settings, on the player's machine (settings.char.ui), under
// these names (evePathfinder/stateinterface.py), each with what it is taken to be until the pilot sets it:
//
//   pfRouteType            "safe"
//   pfPenalty              50 (the route panel's slider goes from 1 to 100)
//   pfAvoidSystems         on: whether the systems on the list are avoided
//   autopilot_avoidance2   the list: Jita and Zarzakh
//
// and its route panel's menu changes them (infoPanelRoute.py GetSettingsMenu): three choices of route
// type, "prefer shorter" ("shortest"), "prefer safer" ("safe") and "prefer less secure" ("unsafe"); the
// slider; and a tick for avoiding the systems on the list.
//
// One thing the client does that looks like a slip and is kept: the tick is drawn from the setting taken as
// on until set, and a click sets it to the opposite of the setting taken as off until set
// (OnCheckBoxAvoidSystems). So the first click on a tick that has never been touched leaves avoiding on,
// and the second turns it off.
//
// Here they are kept the same way: by character, in this browser's own storage, under the client's names.
//
// Not done: the list's own window (adding and removing systems, constellations and regions), the other
// avoidance ticks (pod kills, Triglavian and EDENCOM systems), jump gates, and stopping at each waypoint.

import { DEFAULT_AUTOPILOT_SETTINGS, isKnownSpaceSystem, type AutopilotRouteType, type AutopilotSettings } from "./autopilotRoute.ts";

/** The settings as they are kept: only what the pilot has set is there. */
export interface StoredAutopilotSettings {
  readonly pfRouteType?: AutopilotRouteType;
  readonly pfPenalty?: number;
  readonly pfAvoidSystems?: boolean;
  readonly autopilot_avoidance2?: readonly number[];
}

/** The route types the client's route panel offers, in its order. */
export const OFFERED_ROUTE_TYPES: readonly AutopilotRouteType[] = Object.freeze(["shortest", "safe", "unsafe"]);
const ROUTE_TYPES: readonly string[] = ["safe", "unsafe", "unsafe + zerosec", "shortest"];
/** The slider's ends (infoPanelRoute.py 106). */
export const PENALTY_RANGE = Object.freeze({ least: 1, most: 100 });

/** AutopilotPathfinderInterface.GetRouteType. */
export function routeTypeOf(stored: StoredAutopilotSettings): AutopilotRouteType {
  return stored.pfRouteType ?? DEFAULT_AUTOPILOT_SETTINGS.routeType;
}

/** What the slider shows: settings.char.ui.Get('pfPenalty', 50.0). */
export function penaltyOf(stored: StoredAutopilotSettings): number {
  return stored.pfPenalty ?? DEFAULT_AUTOPILOT_SETTINGS.penalty;
}

/** AutopilotPathfinderInterface.IsAvoidanceEnabled, and what the tick shows: on until set. */
export function avoidingSystems(stored: StoredAutopilotSettings): boolean {
  return stored.pfAvoidSystems ?? true;
}

/** What the pathfinder is given (AutopilotPathfinderInterface): the list only while avoiding is on, known space only, in order. */
export function autopilotSettingsFrom(stored: StoredAutopilotSettings): AutopilotSettings {
  const listed = stored.autopilot_avoidance2 ?? DEFAULT_AUTOPILOT_SETTINGS.avoid;
  return {
    routeType: routeTypeOf(stored),
    penalty: penaltyOf(stored),
    avoid: avoidingSystems(stored) ? listed.filter(isKnownSpaceSystem).sort((a, b) => a - b) : [],
  };
}

export function withRouteType(stored: StoredAutopilotSettings, routeType: AutopilotRouteType): StoredAutopilotSettings {
  return { ...stored, pfRouteType: routeType };
}

/** The slider let go at a value: kept within its ends. */
export function withPenalty(stored: StoredAutopilotSettings, penalty: number): StoredAutopilotSettings {
  if (!Number.isFinite(penalty)) {
    return stored;
  }
  return { ...stored, pfPenalty: Math.min(PENALTY_RANGE.most, Math.max(PENALTY_RANGE.least, penalty)) };
}

/** The tick clicked (OnCheckBoxAvoidSystems): the opposite of the setting taken as OFF until set. */
export function withAvoidSystemsClicked(stored: StoredAutopilotSettings): StoredAutopilotSettings {
  return { ...stored, pfAvoidSystems: !(stored.pfAvoidSystems ?? false) };
}

/** The client's labels for the route panel's settings (infoPanelRoute.py GetSettingsMenu). */
export const ROUTE_SETTING_LABELS = Object.freeze({
  shortest: "UI/Map/MapPallet/cbPreferShorter",
  safe: "UI/Map/MapPallet/cbPreferSafer",
  unsafe: "UI/Map/MapPallet/cbPreferRisky",
  penalty: "UI/Map/MapPallet/lblSecurityPenelity",
  avoidSystems: "UI/Map/MapPallet/cbAdvoidSystemsOnList",
});
export const ROUTE_SETTING_WORD_LABELS: readonly string[] = Object.values(ROUTE_SETTING_LABELS);
/** This page's own words for them, for when the client's are not to hand. */
const OWN_WORDS: Readonly<Record<keyof typeof ROUTE_SETTING_LABELS, string>> = Object.freeze({
  shortest: "Prefer shorter",
  safe: "Prefer safer",
  unsafe: "Prefer less secure",
  penalty: "Security penalty",
  avoidSystems: "Avoid the systems on the list",
});

/** The words for one of the settings: the client's where its text is to hand (given as plain text), this page's own where not. */
export function routeSettingWords(setting: keyof typeof ROUTE_SETTING_LABELS, clientText: (label: string) => string | null): string {
  return clientText(ROUTE_SETTING_LABELS[setting]) ?? OWN_WORDS[setting];
}

/** The slider's label as the client writes it: the words, then the value as a whole number ('%s %i'). */
export function penaltyWords(words: string, penalty: number): string {
  return `${words} ${Math.trunc(penalty)}`;
}

/** Where a character's settings are kept in this browser. */
export function autopilotSettingsKey(characterID: number): string {
  return `evejs.autopilot.settings.${characterID}`;
}

/** The storage this needs of a browser's. */
export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

/** What is kept for a character; nothing set where there is nothing kept, or it cannot be read. */
export function loadAutopilotSettings(storage: SettingsStorage | null, characterID: number): StoredAutopilotSettings {
  let kept: unknown = null;
  try {
    kept = JSON.parse(storage?.getItem(autopilotSettingsKey(characterID)) ?? "null");
  } catch {
    return {};
  }
  // Anything but nothing can be asked for the settings' names: what is no settings at all has none of them.
  if (kept === null) {
    return {};
  }
  const { pfRouteType, pfPenalty, pfAvoidSystems, autopilot_avoidance2 } = kept as Record<string, unknown>;
  return {
    ...(typeof pfRouteType === "string" && ROUTE_TYPES.includes(pfRouteType) ? { pfRouteType: pfRouteType as AutopilotRouteType } : {}),
    ...(typeof pfPenalty === "number" && Number.isFinite(pfPenalty) ? { pfPenalty } : {}),
    ...(typeof pfAvoidSystems === "boolean" ? { pfAvoidSystems } : {}),
    ...(Array.isArray(autopilot_avoidance2) ? { autopilot_avoidance2: autopilot_avoidance2.filter((id): id is number => Number.isSafeInteger(id) && id > 0) } : {}),
  };
}

/** Keep a character's settings. A browser that will not keep them is not an error: they last as long as the page does not. */
export function saveAutopilotSettings(storage: SettingsStorage | null, characterID: number, stored: StoredAutopilotSettings): void {
  try {
    storage?.setItem(autopilotSettingsKey(characterID), JSON.stringify(stored));
  } catch {
    // Storage full or refused.
  }
}
