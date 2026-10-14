// The pilot's changes of place that the page makes itself: the session going from a station into space, and on.
//
// UNDOCKED. The station's undock (ui/station/base.py, _DoUndockAttempt, 488 to 521):
//
//   onlineModules = clientDogmaIM.GetDogmaLocation().GetOnlineModules(shipID)
//   sm.GetService('sessionMgr').PerformSessionChange('undock', shipsvc.Undock, shipID, ignoreContraband,
//                                                    onlineModules=onlineModules)
//
// shipsvc is gameui.GetShipAccess(), the ship's object for the station; the ship is the session's own, the one the
// undocking service hands over (undockingSvc.py 121 to 135). First with ignoreContraband False: a ship carrying
// what the local law forbids is refused with ShipContrabandWarningUndock, the pilot is asked (OK / Cancel), and on
// OK the undock is made again with it True (506 to 511). The client's session manager makes the call only when no
// other session change is under way and the last one's timer has run, and the session is another one after it.
//
// THE SESSION CHANGE IS KEPT BY THE BFF, as the client's session manager keeps it: the change claimed, the call
// made, and the answer given once the ship is usable in space (src/server.js, the generic call's place changes;
// bridgeCallPolicy.js, PAGE_PLACE_CHANGE_CALLS). A refusal for contraband comes back as CONTRABAND_WARNING, in the
// words of the client's own dialog where the BFF has them.
//
// THE ONLINE MODULES ARE NOT THE PAGE'S TO NAME: godma's list is the client's, and the game port names it
// (src/gamePort/retailCalls.js, undocking). The page sends none, as its route sent none; the server leaves the
// modules as they are where none are named (shipService._syncRequestedOnlineModulesForUndock).

import type { Ask } from "./ask.ts";
import type { FlightNow } from "./movementWrites.ts";

/**
 * Undocks the pilot's ship from where it is docked. `ignoreContraband` is the client's second argument: false
 * first, true once the pilot has said to go on. Fails as the call fails, and before it for a ship already in space
 * or none known.
 *
 * ⚠ THE CALL COMING BACK IS THE SESSION IN SPACE: the BFF answers once the change is ready.
 */
export async function undock(act: Ask, flightNow: () => Promise<FlightNow>, ignoreContraband: boolean): Promise<void> {
  const now = await flightNow();
  if (now.inSpace) throw new Error("The ship is already in space.");
  if (now.shipID === null) throw new Error("There is no ship to undock in.");
  await act("ship", "Undock", [now.shipID, ignoreContraband], { onlineModules: [] });
}
