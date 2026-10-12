// Docked station-panel reads on the persistent browser-backed session
// (goal R2). Retail fires these when the docked UI loads
// (docs/retail-call-inventory.md Step 1):
//
//  - stationSvc.GetStationItemBits() -> (ownerID, itemID, operationID,
//    stationTypeID), the Row the docked station-services panel builds
//    (eve/client/script/ui/station/base.py:575).
//  - station.GetGuests() -> [(charID, corp, alliance, warFaction), ...]
//    for the guest panel (station/base.py:103).
//  - map.GetStationInfo() -> the all-station table. EveJS answers with the
//    retail CachedMethodCallResult envelope whose rowset rides the retail
//    object cache (a cached-object reference), so the browser cannot decode
//    the rows themselves; the page issues the call faithfully and records
//    that the cached envelope answered. Station identity/naming comes from
//    client-local static data (exactly as retail resolves names from its
//    static DB) via the BFF select response.

// IN A STRUCTURE the lobby asks for none of the three. Its guests panel asks the client's structure guests
// service (dockedUI/guests.py 98 to 101), which asks once and keeps:
//
//  - structureGuests.GetGuests(session.structureid) -> {charID: (corp, alliance, faction), ...}
//    (services/structure/structureGuests.py 25).
//
// The web gateway's list has a station's guests and nothing of a structure's: through it the call is refused,
// and there are no guests to be had.

import { failureCode } from "./ask.ts";
import { callMethod, type CallMethodOptions } from "./callMethod.ts";
import { isListValue, type JsonValue } from "./wire.ts";
import type { StationGuest, StationServiceBits } from "../store/types.ts";

function readPositiveNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/** Decode the GetStationItemBits 4-tuple; malformed values become nulls. */
export function decodeStationItemBits(result: JsonValue): StationServiceBits {
  const tuple = Array.isArray(result) ? result : [];
  return {
    ownerID: readPositiveNumber(tuple[0]),
    stationID: readPositiveNumber(tuple[1]),
    operationID: readPositiveNumber(tuple[2]),
    stationTypeID: readPositiveNumber(tuple[3]),
  };
}

/** Decode the GetGuests list; rows without a positive charID are dropped. */
export function decodeStationGuests(result: JsonValue): StationGuest[] {
  if (!isListValue(result)) {
    return [];
  }
  const guests: StationGuest[] = [];
  for (const item of result.items) {
    if (!Array.isArray(item)) {
      continue;
    }
    const characterID = readPositiveNumber(item[0]);
    if (characterID === null) {
      continue;
    }
    guests.push({
      characterID,
      corporationID: readPositiveNumber(item[1]),
      allianceID: readPositiveNumber(item[2]),
      warFactionID: readPositiveNumber(item[3]),
    });
  }
  return guests;
}

/**
 * Decode structureGuests.GetGuests: a dict of each guest's (corporationID, allianceID, factionID) by its
 * character. Entries without a positive charID are dropped; a guest whose three are not there is a guest still.
 */
export function decodeStructureGuests(result: JsonValue): StationGuest[] {
  const dict = result as { readonly type?: unknown; readonly entries?: unknown } | null;
  if (typeof dict !== "object" || dict === null || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return [];
  }
  const guests: StationGuest[] = [];
  for (const entry of dict.entries as readonly JsonValue[]) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const characterID = readPositiveNumber(entry[0]);
    if (characterID === null) {
      continue;
    }
    const three: readonly JsonValue[] = Array.isArray(entry[1]) ? entry[1] : [];
    guests.push({
      characterID,
      corporationID: readPositiveNumber(three[0]),
      allianceID: readPositiveNumber(three[1]),
      warFactionID: readPositiveNumber(three[2]),
    });
  }
  return guests;
}

/** Recognize the retail CachedMethodCallResult envelope GetStationInfo returns. */
export function isCachedMethodCallResult(result: JsonValue): boolean {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return false;
  }
  const candidate = result as { type?: unknown; name?: unknown };
  if (candidate.type !== "object") {
    return false;
  }
  const name = candidate.name as { value?: unknown } | string | null | undefined;
  const nameText =
    typeof name === "string"
      ? name
      : typeof name === "object" && name !== null && typeof name.value === "string"
        ? name.value
        : "";
  return nameText.endsWith("objectCaching.CachedMethodCallResult");
}

export async function getStationItemBits(
  options: CallMethodOptions = {},
): Promise<StationServiceBits> {
  const outcome = await callMethod("stationSvc", "GetStationItemBits", [], null, options);
  return decodeStationItemBits(outcome.result);
}

export async function getStationGuests(
  options: CallMethodOptions = {},
): Promise<StationGuest[]> {
  const outcome = await callMethod("station", "GetGuests", [], null, options);
  return decodeStationGuests(outcome.result);
}

/**
 * The guests of the structure the pilot is docked in, asked as the client's structure guests service asks: by the
 * structure. Null where the pilot's connection does not carry the call. Fails as the call fails otherwise.
 */
export async function getStructureGuests(
  structureID: number,
  options: CallMethodOptions = {},
): Promise<StationGuest[] | null> {
  try {
    const outcome = await callMethod("structureGuests", "GetGuests", [structureID], null, options);
    return decodeStructureGuests(outcome.result);
  } catch (error) {
    if (failureCode(error) === "CALL_NOT_ALLOWED") {
      return null;
    }
    throw error;
  }
}

export async function getStationInfoCached(
  options: CallMethodOptions = {},
): Promise<boolean> {
  const outcome = await callMethod("map", "GetStationInfo", [], null, options);
  return isCachedMethodCallResult(outcome.result);
}
