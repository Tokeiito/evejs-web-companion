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
//   where it is on, is switched off: "waypoint reached" (the route panel's Disable Autopilot at Each Waypoint, ticked
//   until the pilot unticks it, which the page does not offer).
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

/**
 * _IsDestinationValid (2301 to 2318), as far as the page can tell by the number: a station, or a solar system of known
 * space. (The client also refuses a deprecated station and a Triglavian system from outside Pochven, and takes a
 * structure it knows; the page does neither yet.)
 */
export function isWaypointPlace(id: number): boolean {
  if (!Number.isSafeInteger(id)) return false;
  return (id >= 60_000_000 && id < 64_000_000) || (id >= 30_000_000 && id < 31_000_000);
}

/** SetWaypoint (2327 to 2349): the list with the place put on it, or the client's refusal. */
export function withWaypoint(
  waypoints: readonly number[],
  destinationID: number,
  how: { readonly clearOthers?: boolean; readonly first?: boolean },
  here: PilotPlace,
): { readonly waypoints: readonly number[] } | { readonly refused: WaypointRefusal } {
  if (!isWaypointPlace(destinationID)) return { refused: "CantSetWaypoint" };
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

/** The character's waypoints as this browser keeps them; none where nothing is kept, or it cannot be read. */
export function readWaypoints(characterID: number): readonly number[] {
  try {
    const raw = globalThis.localStorage?.getItem(`${KEPT}${characterID}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number" && isWaypointPlace(id)) : [];
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
