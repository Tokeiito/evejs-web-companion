import type { FlightStatus, SpaceSnapshot } from "../store/types.ts";
import type { BoundDogmaAllInfo } from "./boundDogma.ts";
import type { MemberBeacon } from "./movementWrites.ts";

/** FleetMemberChecker470-510; SessionChecker229-269; compiled client oracle cdx1040. */
export function fleetBeaconOffers(me: number | null, ownerID: number, flight: FlightStatus | null, snapshot: SpaceSnapshot | null,
  dogma: BoundDogmaAllInfo | null, beacon: MemberBeacon | null): { jump: boolean; bridge: boolean; group: boolean } {
  const inShip = Boolean(flight?.inSpace && flight.solarSystemID && flight.shipID && !flight.structureID);
  // SlimItemFromCharID tests the slim item, even when the own/other ball's geometry is unavailable.
  const visible = snapshot?.solarSystemID === flight?.solarSystemID && snapshot?.shipID === flight?.shipID
    && snapshot?.entities.some(entity => entity.characterID === ownerID);
  const shipID = flight?.shipID;
  const currentDogma = shipID !== null && shipID !== undefined && String(dogma?.activeShipID) === String(shipID);
  const ship = currentDogma ? dogma?.ships.find(item => String(item.itemID) === String(shipID)) : null;
  const truth = (value: unknown): boolean => value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
  const attribute = (id: number): unknown => ship?.attributes.find(each => each.attributeID === id)?.value;
  const system = flight?.solarSystemID ?? 0;
  const wormhole = system >= 31_000_000 && system < 32_000_000;
  const jump = ownerID !== me && inShip && !visible && beacon !== null && !wormhole && truth(attribute(861));
  const portal = currentDogma && dogma?.ships.some(item => item.categoryID === 7 && String(item.locationID) === String(shipID)
    && truth(item.attributes.find(each => each.attributeID === 3318)?.value));
  return { jump, bridge: jump && Boolean(portal), group: jump && truth(attribute(3321)) };
}
