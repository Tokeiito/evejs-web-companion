import type { FlightStatus, SpaceSnapshot } from "../store/types.ts";

/** FleetMemberChecker.GetDistanceToActiveShip585-598; destiny ClientBall::GetSurfaceDistance2102. */
export function fleetMemberSurfaceDistance(snapshot: SpaceSnapshot | null, characterID: number): number | null {
  const ship = snapshot?.ship;
  if (!snapshot?.inSpace || !ship || ship.itemID === null || ship.geometryAvailable === false) return null;
  const target = snapshot.entities.find(entity => entity.characterID === characterID && !entity.isSelf);
  if (!target || target.geometryAvailable === false) return null;
  const values = [ship.position.x, ship.position.y, ship.position.z, ship.radius, target.position.x, target.position.y, target.position.z, target.radius];
  if (!values.every(Number.isFinite)) return null;
  return Math.max(0, Math.hypot(target.position.x - ship.position.x, target.position.y - ship.position.y, target.position.z - ship.position.z) - ship.radius - target.radius);
}

/** Original .pyc oracle cdx974: zero, like None, uses sys.maxint; boss job does not grant a group warp. */
export function fleetWarpOffers(me: number | null, target: number, role: number | null, flight: FlightStatus | null, snapshot: SpaceSnapshot | null): {
  readonly warp: boolean; readonly group: "fleet" | "wing" | "squad" | null;
} {
  const inShip = Boolean(flight?.inSpace && flight.solarSystemID && flight.shipID && !flight.structureID);
  const samePark = snapshot?.solarSystemID === flight?.solarSystemID && snapshot?.shipID === flight?.shipID;
  const distance = samePark ? fleetMemberSurfaceDistance(snapshot, target) : null;
  const warp = target !== me && inShip && (!distance || distance > 150_000);
  return { warp, group: !warp ? null : role === 1 ? "fleet" : role === 2 ? "wing" : role === 3 ? "squad" : null };
}
