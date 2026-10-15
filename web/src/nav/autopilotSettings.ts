// The autopilot's settings, as the retail client keeps them.
//
// The client keeps them with the character's own settings, on the player's machine (settings.char.ui), under
// these names (evePathfinder/stateinterface.py), each with what it is taken to be until the pilot sets it:
//
//   pfRouteType            "safe"
//   pfPenalty              50 (the route panel's slider goes from 1 to 100)
//   pfAvoidSystems         on: whether the systems on the list are avoided
//   autopilot_avoidance2   the list: Jita and Zarzakh
//   pfAvoidPodKill         off: whether the systems with pod kills in the last day are avoided
//   pfAvoidTriglavianTales off: whether the systems of the Triglavians' minor victories are avoided
//   pfAvoidEdencomSystems  off: whether EDENCOM's fortress and minor victory systems are avoided
//
// The last three are lists the server's map service gives (clientPathfinderService.py UpdatePodKillList, 238 to 249:
// GetHistory(mapHistoryStatKills, 24), each system with value3 above nothing; mapSvc.py 501 to 513), each added to
// what the pathfinder avoids while its tick is on (stateinterface.py GetAvoidanceList, 68 to 83). Each tick is drawn
// from its setting, off until set, and a click sets it to its opposite (infoPanelRoute.py 163 to 182).
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
// The list holds solar systems, constellations and regions of known space, each put on by the location's Avoid and
// taken off by its Do Not Avoid (menusvc.py 2030 to 2033; clientPathfinderService.py 258 to 268), and shown in the
// route window's second tab (autopilotSettings.py LoadAvoidance). A constellation or a region stands for its systems
// (mapSvc.ExpandItems). Taking one off also sets the tick back to not set (pathfinder.py RemoveAvoidanceItem:
// SetSystemAvoidance(None), which the settings read as never set), so avoiding is on again.
//
// Not done: jump gates. (Stopping at each waypoint is the user's, not the character's:
// app/autopilotStopAtEachWaypoint.ts.)

import { DEFAULT_AUTOPILOT_SETTINGS, isKnownSpaceSystem, type AutopilotRouteType, type AutopilotSettings } from "./autopilotRoute.ts";

/** The settings as they are kept: only what the pilot has set is there. */
export interface StoredAutopilotSettings {
  readonly pfRouteType?: AutopilotRouteType;
  readonly pfPenalty?: number;
  readonly pfAvoidSystems?: boolean;
  readonly autopilot_avoidance2?: readonly number[];
  readonly pfAvoidPodKill?: boolean;
  readonly pfAvoidTriglavianTales?: boolean;
  readonly pfAvoidEdencomSystems?: boolean;
}

/** The ticks for the server's lists, in the order the route panel has them (infoPanelRoute.py 109 to 111). */
export type AvoidanceTick = "pfAvoidPodKill" | "pfAvoidTriglavianTales" | "pfAvoidEdencomSystems";
export const AVOIDANCE_TICKS: readonly AvoidanceTick[] = Object.freeze(["pfAvoidPodKill", "pfAvoidTriglavianTales", "pfAvoidEdencomSystems"]);
/** The warning each avoiding tick puts up as it is turned on (infoPanelRoute.py 163 to 189). */
export const AVOIDING_DIALOGS: Readonly<Record<AvoidanceTick | "pfAvoidSystems", string>> = Object.freeze({
  pfAvoidPodKill: "MapAutoPilotAvoidPodkillZones",
  pfAvoidTriglavianTales: "MapAutoPilotAvoidTriglavianTales",
  pfAvoidEdencomSystems: "MapAutoPilotAvoidEdencomSystems",
  pfAvoidSystems: "MapAutoPilotAvoidSystems",
});
/** The server's lists, by the tick that adds each: the systems each names. */
export type AvoidedLists = Partial<Readonly<Record<AvoidanceTick, readonly number[]>>>;

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

/** Whether one of the ticks for the server's lists is on (IsPodkillAvoidanceEnabled and the others): off until set. */
export function avoidanceTickOn(stored: StoredAutopilotSettings, tick: AvoidanceTick): boolean {
  return stored[tick] ?? false;
}

/** One of those ticks clicked (OnCheckBoxAvoidPodKill and the others): the opposite of what it is. */
export function withAvoidanceTickClicked(stored: StoredAutopilotSettings, tick: AvoidanceTick): StoredAutopilotSettings {
  return { ...stored, [tick]: !avoidanceTickOn(stored, tick) };
}

/**
 * What the pathfinder is given (AutopilotPathfinderInterface.GetAvoidanceList): the list only while avoiding is on,
 * each constellation and region on it as its systems (`systemsIn`, mapSvc.ExpandItems); then each of the server's
 * lists whose tick is on (`lists`); known space only, in order.
 */
export function autopilotSettingsFrom(
  stored: StoredAutopilotSettings,
  systemsIn: (id: number) => readonly number[] = (id) => [id],
  lists: AvoidedLists = {},
): AutopilotSettings {
  const items = avoidingSystems(stored) ? avoidanceItems(stored).flatMap((id) => systemsIn(id)) : [];
  for (const tick of AVOIDANCE_TICKS) {
    if (avoidanceTickOn(stored, tick)) items.push(...(lists[tick] ?? []));
  }
  return {
    routeType: routeTypeOf(stored),
    penalty: penaltyOf(stored),
    avoid: items.filter(isKnownSpaceSystem).sort((a, b) => a - b),
  };
}

/** The list as it is kept, its constellations and regions as they are (GetAvoidanceItems(expandSystems=False)): Jita and Zarzakh until set. */
export function avoidanceItems(stored: StoredAutopilotSettings): readonly number[] {
  return stored.autopilot_avoidance2 ?? DEFAULT_AUTOPILOT_SETTINGS.avoid;
}

/**
 * Whether a place can be put on the list or taken off it (celestialCheckers.py OfferAvoidLocation, 545 to 550, by
 * OfferShowLocationOnMap, 1439 to 1446): a solar system, a constellation or a region of known space.
 */
export function isAvoidablePlace(id: number): boolean {
  return (id >= 10_000_000 && id <= 10_999_999) || (id >= 20_000_000 && id <= 20_999_999) || isKnownSpaceSystem(id);
}

/** Avoid (AddAvoidanceItem): put at the end of the list. The client offers it only for a place not on it already. */
export function withAvoidanceItem(stored: StoredAutopilotSettings, id: number): StoredAutopilotSettings {
  return { ...stored, autopilot_avoidance2: [...avoidanceItems(stored), id] };
}

/** Do Not Avoid (RemoveAvoidanceItem): the first of it on the list taken off, and the tick set back to not set. */
export function withoutAvoidanceItem(stored: StoredAutopilotSettings, id: number): StoredAutopilotSettings {
  const items = [...avoidanceItems(stored)];
  const at = items.indexOf(id);
  if (at === -1) return stored;
  items.splice(at, 1);
  const { pfAvoidSystems: _unset, ...rest } = stored;
  return { ...rest, autopilot_avoidance2: items };
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
  pfAvoidPodKill: "UI/Map/MapPallet/cbAdvoidPodkill",
  pfAvoidTriglavianTales: "UI/Map/MapPallet/cbAvoidTriglavianTales",
  pfAvoidEdencomSystems: "UI/Map/MapPallet/cbAvoidEdencomSystems",
});
export const ROUTE_SETTING_WORD_LABELS: readonly string[] = Object.values(ROUTE_SETTING_LABELS);
/** This page's own words for them, for when the client's are not to hand. */
const OWN_WORDS: Readonly<Record<keyof typeof ROUTE_SETTING_LABELS, string>> = Object.freeze({
  shortest: "Prefer shorter",
  safe: "Prefer safer",
  unsafe: "Prefer less secure",
  penalty: "Security penalty",
  avoidSystems: "Avoid the systems on the list",
  pfAvoidPodKill: "Avoid where pods were killed",
  pfAvoidTriglavianTales: "Avoid the Triglavians' minor victories",
  pfAvoidEdencomSystems: "Avoid EDENCOM's systems",
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
  const { pfRouteType, pfPenalty, pfAvoidSystems, autopilot_avoidance2, pfAvoidPodKill, pfAvoidTriglavianTales, pfAvoidEdencomSystems } = kept as Record<string, unknown>;
  return {
    ...(typeof pfRouteType === "string" && ROUTE_TYPES.includes(pfRouteType) ? { pfRouteType: pfRouteType as AutopilotRouteType } : {}),
    ...(typeof pfPenalty === "number" && Number.isFinite(pfPenalty) ? { pfPenalty } : {}),
    ...(typeof pfAvoidSystems === "boolean" ? { pfAvoidSystems } : {}),
    ...(Array.isArray(autopilot_avoidance2) ? { autopilot_avoidance2: autopilot_avoidance2.filter((id): id is number => Number.isSafeInteger(id) && id > 0) } : {}),
    ...(typeof pfAvoidPodKill === "boolean" ? { pfAvoidPodKill } : {}),
    ...(typeof pfAvoidTriglavianTales === "boolean" ? { pfAvoidTriglavianTales } : {}),
    ...(typeof pfAvoidEdencomSystems === "boolean" ? { pfAvoidEdencomSystems } : {}),
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
