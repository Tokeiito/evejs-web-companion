// The client's waypoints, as its star map keeps them (starMapSvc.py SetWaypoint, SetWaypoints, GetWaypoints,
// ClearWaypoints, RemoveWaypointIfFirst and the first lines of UpdateRoute, 2301 to 2448):
//
//   a list of places kept for the character (the char UI setting autopilot_waypoints), the destination its last, the
//   route going through them in order. Set Destination is SetWaypoint with the others cleared; Add Waypoint puts one
//   at the end; Remove Waypoint takes one out (ClearWaypoints(locationID)); Clear All Waypoints takes them all.
//
//   SetWaypoint refuses a place that is no destination (the Command message with UI/Map/StarMap/CantSetWaypoint), a
//   place already on the list (WaypointAlreadySet), and the pilot's own constellation or region
//   (WaypointAlreadyInConstellation, WaypointAlreadyInRegion).
//
//   Whenever the pilot's place changes (UpdateRoute, from the autopilot's OnSessionChanged), a first waypoint that is
//   where the pilot is now (its structure, station, system, constellation or region) is taken off, and the autopilot,
//   where it is on, is switched off: "waypoint reached", where the route panel's Disable Autopilot at Each Waypoint is
//   ticked, as it is until the pilot unticks it (app/autopilotStopAtEachWaypoint.ts); unticked, it flies on.
//
// The page keeps the list in this browser, for the character, as the client keeps it in its own settings.

/** The client's notify messages for a waypoint it would not set. */
export type WaypointRefusal = "CantSetWaypoint" | "WaypointAlreadySet" | "WaypointAlreadyInConstellation" | "WaypointAlreadyInRegion";

/** Where the pilot is: the client's session's structureid, stationid, solarsystemid2, constellationid and regionid. */
export interface PilotPlace {
  readonly structureID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  readonly constellationID?: number | null;
  readonly regionID?: number | null;
}

/** idCheckers.IsPlayerItem (69 to 70): minPlayerItem (inventorycommon/const.py 83) and up, the number a structure has. */
export function isPlayerItemID(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 100_000_000;
}

/**
 * _IsDestinationValid (2301 to 2318), as far as the page can tell: a station or a solar system of known space by the
 * number, and a structure where the structure directory knows it (`knownStructure`: its GetStructureInfo answered,
 * structureDirectory.py 33 to 39). (The client also refuses a deprecated station and a Triglavian system from outside
 * Pochven; the page does not yet.)
 */
export function isWaypointPlace(id: number, knownStructure = false): boolean {
  if (!Number.isSafeInteger(id)) return false;
  if (knownStructure && isPlayerItemID(id)) return true;
  return (id >= 60_000_000 && id < 64_000_000) || (id >= 30_000_000 && id < 31_000_000);
}

/** The name kind a waypoint is named by: a structure's, a station's or a solar system's. */
export function waypointNameKind(id: number): "structure" | "station" | "system" {
  return isPlayerItemID(id) ? "structure" : id >= 60_000_000 ? "station" : "system";
}

/** SetWaypoint (2327 to 2349): the list with the place put on it, or the client's refusal. */
export function withWaypoint(
  waypoints: readonly number[],
  destinationID: number,
  how: { readonly clearOthers?: boolean; readonly first?: boolean },
  here: PilotPlace,
  knownStructure = false,
): { readonly waypoints: readonly number[] } | { readonly refused: WaypointRefusal } {
  if (!isWaypointPlace(destinationID, knownStructure)) return { refused: "CantSetWaypoint" };
  const list = how.clearOthers === true ? [] : [...waypoints];
  if (list.includes(destinationID)) return { refused: "WaypointAlreadySet" };
  if (here.constellationID != null && destinationID === here.constellationID) return { refused: "WaypointAlreadyInConstellation" };
  if (here.regionID != null && destinationID === here.regionID) return { refused: "WaypointAlreadyInRegion" };
  if (how.first === true) list.unshift(destinationID);
  else list.push(destinationID);
  return { waypoints: list };
}

/** ClearWaypoints (2379 to 2405): one place taken off, where it is on the list, or every one. */
export function withoutWaypoint(waypoints: readonly number[], locationID: number | null): readonly number[] {
  if (locationID === null) return [];
  return waypoints.includes(locationID) ? waypoints.filter((id) => id !== locationID) : waypoints;
}

/**
 * UpdateRoute (2441 to 2448): the list with its first place taken off where the pilot is there now; null where the
 * first place is not where the pilot is.
 */
export function afterArriving(waypoints: readonly number[], here: PilotPlace): readonly number[] | null {
  if (waypoints.length === 0) return null;
  const places = [here.structureID, here.stationID, here.solarSystemID, here.constellationID ?? null, here.regionID ?? null];
  return places.some((place) => place !== null && place === waypoints[0]) ? waypoints.slice(1) : null;
}

const KEPT = "evejs.autopilot_waypoints.";

/**
 * The character's waypoints as this browser keeps them; none where nothing is kept, or it cannot be read. A structure
 * kept is taken as it was set. (The client asks its directory again for each on every GetWaypoints, 2370 to 2376, and
 * drops the whole list where one is gone; the page does not ask again.)
 */
export function readWaypoints(characterID: number): readonly number[] {
  try {
    const raw = globalThis.localStorage?.getItem(`${KEPT}${characterID}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number" && (isWaypointPlace(id) || isPlayerItemID(id))) : [];
  } catch {
    return [];
  }
}

/** The character's waypoints kept in this browser (SetCharUiSetting('autopilot_waypoints', ...)). */
export function keepWaypoints(characterID: number, waypoints: readonly number[]): void {
  try {
    globalThis.localStorage?.setItem(`${KEPT}${characterID}`, JSON.stringify(waypoints));
  } catch {
    // Not kept: the list holds for this page's life.
  }
}
