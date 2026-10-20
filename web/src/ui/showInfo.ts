// Shared Show Info openers dispatch commands to App's active pilot.
// The flow's infoWindows controller owns each window's subject/history/lifetime,
// following native infosvc rather than a single global subject.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import { CHARACTER_TYPES, OWNER_AND_PLACE_TYPES, parseShowInfoUrl } from "../bridge/showInfoLink.ts";
import type { InfoSubject, InfoOpenOptions } from "../bridge/infoWindow.ts";
export type { InfoSubject, InfoOpenOptions } from "../bridge/infoWindow.ts";

/** inventorycommon/const.py: typeCorporation and typeAlliance. */
const TYPE_CORPORATION = 2;
const TYPE_ALLIANCE = 16159;

/** A synchronous command bus, not a window's subject. App dispatches each
 * request to the pilot in front; each flow owns independent native windows. */
export interface ShowInfoRequest { readonly n: number; readonly subject: InfoSubject; readonly options: InfoOpenOptions }
const request = createSignal<ShowInfoRequest | null>(null);
export const showInfoRequests: ReadableSignal<ShowInfoRequest | null> = readonlySignal(request);
let serial = 0;
let shiftPressed = false;
export function setInfoShiftPressed(value: boolean): void { shiftPressed = value; }
export function infoShiftPressed(): boolean { return shiftPressed; }

/** typeRegion, typeConstellation, typeSolarSystem. */
const MAP_LOCATION_TYPES: ReadonlySet<number> = new Set([3, 4, 5]);
/** inventorycommon/const.py typeFaction. */
const TYPE_FACTION = 30;

/**
 * A "showinfo:" link's subject (handle_show_info_link: ShowInfo(type, item)), where the page has one: a pilot's link a
 * character, a corporation's (typeCorporation) a corporation, an alliance's (typeAlliance) an alliance, a faction's
 * (typeFaction) a faction and a region's, constellation's or solar system's the place; any other a type (an item's own
 * state the page does not read, so its type). None for a link of those with no item, nor for a link the client's own
 * parse refuses.
 */
export function subjectOfShowInfoLink(url: string): InfoSubject | null {
  const parsed = parseShowInfoUrl(url);
  if (parsed === null) return null;
  if (CHARACTER_TYPES.has(parsed.typeID)) return parsed.itemID === null ? null : { kind: "character", characterID: parsed.itemID };
  if (parsed.typeID === TYPE_CORPORATION) return parsed.itemID === null ? null : { kind: "corporation", corporationID: parsed.itemID };
  if (parsed.typeID === TYPE_ALLIANCE) return parsed.itemID === null ? null : { kind: "alliance", allianceID: parsed.itemID };
  // A region's, constellation's or solar system's link: its info window (infosvc.UpdateDataCelestial).
  if (MAP_LOCATION_TYPES.has(parsed.typeID)) return parsed.itemID === null ? null : { kind: "mapLocation", typeID: parsed.typeID, itemID: parsed.itemID };
  // A faction's link: its info window (infosvc.UpdateDataFaction).
  if (parsed.typeID === TYPE_FACTION) return parsed.itemID === null ? null : { kind: "faction", factionID: parsed.itemID };
  if (OWNER_AND_PLACE_TYPES.has(parsed.typeID)) return null;
  return { kind: "type", typeID: parsed.typeID };
}

/** Convenience: open Show Info on a subject. */
export function showInfo(subject: InfoSubject, options: InfoOpenOptions = {}): void {
  request.set({ n: ++serial, subject, options: { ...options, shift: options.shift ?? shiftPressed } });
}

/**
 * The typeID a subject can be pictured and named by, when it has one.
 *
 * A space object may genuinely have none — the snapshot carries `typeID: null`
 * for rows the runtime did not stamp — and that has to stay `null` rather than
 * becoming a 0 that the icon cache would then try to fetch.
 */
export function subjectTypeID(subject: InfoSubject | null): number | null {
  if (subject === null) {
    return null;
  }
  switch (subject.kind) {
    case "type":
    case "module":
    case "medal":
      return subject.typeID;
    case "spaceObject":
      return subject.typeID;
    case "character":
    case "corporation":
    case "alliance":
    case "faction":
      return null;
    case "mapLocation":
      return subject.typeID;
  }
}
