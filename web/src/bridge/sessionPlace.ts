// Where the pilot's session is, as the retail client's session object has it.
//
// The client reads three things off its session when it marks a mission's objectives
// (evemissions/client/mission.py 249, agentinteraction/objectivesteps.py 150):
//
//   session.stationid       the station it is docked in, and nothing when it is in a structure or in space
//   session.solarsystemid2  the solar system it is in, docked or not
//   session.locationid      the station or structure it is docked in, and the solar system when it is in space
//
// The page keeps where the pilot was when it was selected (the station slice's `online`), and where it is
// now once its flight status has been read. The flight status is the one that follows an undock, a dock
// and a jump, so it is believed when it is there.

import type { FlightStatus, OnlineCharacterState } from "../store/types.ts";

export interface SessionPlace {
  readonly locationID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
}

type Flight = Pick<FlightStatus, "docked" | "stationID" | "structureID" | "solarSystemID">;
type Online = Pick<OnlineCharacterState, "stationID" | "structureID" | "solarSystemID">;

export function sessionPlace(flight: Flight | null, online: Online | null): SessionPlace {
  if (flight !== null) {
    // Flying, the pilot is in no station, whatever the last one it was in.
    const stationID = flight.docked ? flight.stationID : null;
    const structureID = flight.docked ? flight.structureID : null;
    return { locationID: stationID ?? structureID ?? flight.solarSystemID, stationID, solarSystemID: flight.solarSystemID };
  }
  if (online !== null) {
    return { locationID: online.stationID ?? online.structureID ?? online.solarSystemID, stationID: online.stationID, solarSystemID: online.solarSystemID };
  }
  return { locationID: null, stationID: null, solarSystemID: null };
}
