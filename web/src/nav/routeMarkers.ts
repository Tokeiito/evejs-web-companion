// The route as the client's route panel shows it (infoPanelRoute.py UpdateRoute, 251 to 366, and _GetNumJumps, 424
// to 440): a marker for each place on the way, from the system the pilot is in through every waypoint, and the
// number of jumps in the header.
//
//   The route is the star map's (GetRouteFromWaypoints, starMapSvc.py 2414 to 2427): the pilot's system, then the
//   path to each waypoint in turn, a station or a structure after the system it is in.
//
//   A system just before a station or a structure is not a marker of its own (the station is), nor is a system
//   just after one that is the station's own. A marker is a station's where it is a station or a structure, a
//   waypoint's where it is the next waypoint still to come, and otherwise a plain one. Each marker carries how many
//   systems the route has come through to reach it, from the pilot's own.
//
//   The jumps are the route's systems, one for each run of the same, less the pilot's own where the route starts
//   there.

/** A marker of the route: the place, its system, its kind, and the jumps to it. */
export interface RouteMarker {
  readonly destinationID: number;
  readonly solarSystemID: number;
  readonly kind: "normal" | "waypoint" | "station";
  readonly numJumps: number;
}

const isSolarSystem = (id: number): boolean => id >= 30_000_000 && id < 33_000_000;

/**
 * The route's places (GetRouteFromWaypoints): `start`, then for each waypoint the path from where the last one left
 * off to its system, and the waypoint after it where it is no system. Null where a waypoint's system is not known or
 * no path reaches it.
 */
export function routeData(
  start: number,
  waypoints: readonly number[],
  systemOf: (id: number) => number | null,
  path: (fromID: number, toID: number) => readonly number[] | null,
): number[] | null {
  const out = [start];
  let at = start;
  for (const waypoint of waypoints) {
    const system = isSolarSystem(waypoint) ? waypoint : systemOf(waypoint);
    if (system === null) return null;
    const way = path(at, system);
    if (way === null) return null;
    out.push(...way.slice(1));
    if (!isSolarSystem(waypoint)) out.push(waypoint);
    at = system;
  }
  return out;
}

/** UpdateRoute's markers (284 to 344), from the route's places, the waypoints still to come and the pilot's system. */
export function routeMarkers(
  data: readonly number[],
  waypoints: readonly number[],
  currentSystemID: number,
  systemOf: (id: number) => number | null,
): RouteMarker[] {
  const placed: number[] = [];
  let lastStationSystemID: number | null = null;
  data.forEach((id, i) => {
    const isLast = i === data.length - 1;
    if (isSolarSystem(id) && !isLast && !isSolarSystem(data[i + 1]!)) return;
    if (isSolarSystem(id) && lastStationSystemID === id) return;
    lastStationSystemID = isSolarSystem(id) ? null : systemOf(id);
    placed.push(id);
  });
  const toCome = [...waypoints];
  let nextWaypoint = toCome.shift() ?? null;
  let lastSystemID = currentSystemID;
  let jumps = 0;
  const markers: RouteMarker[] = [];
  for (const id of placed) {
    const isWaypoint = id === nextWaypoint;
    if (isWaypoint) nextWaypoint = toCome.shift() ?? null;
    const solarSystemID = isSolarSystem(id) ? id : systemOf(id);
    if (solarSystemID === null) continue;
    if (solarSystemID !== lastSystemID) {
      jumps += 1;
      lastSystemID = solarSystemID;
    }
    markers.push({ destinationID: id, solarSystemID, kind: !isSolarSystem(id) ? "station" : isWaypoint ? "waypoint" : "normal", numJumps: jumps });
  }
  return markers;
}

/**
 * _GetNumJumps (424 to 440): the route's systems, a run of the same counted once, less the pilot's own first. A
 * station stands for its system; a structure stands for nothing (it is no station, nor a system).
 */
export function routeJumps(data: readonly number[], currentSystemID: number, systemOf: (id: number) => number | null): number {
  const ids: number[] = [];
  let lastID: number | null = null;
  for (const raw of data) {
    const id = raw >= 60_000_000 && raw < 64_000_000 ? systemOf(raw) : raw;
    if (id !== null && id !== lastID && isSolarSystem(id)) ids.push(id);
    lastID = id;
  }
  return ids.length > 0 && ids[0] === currentSystemID ? ids.length - 1 : ids.length;
}
