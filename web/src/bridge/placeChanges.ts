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
//
// DOCKED AT A STATION. The menu's dock (menusvc.DockStation, 2991 to 2997, through GetCloseAndTryCommand, which flies
// the ship close first) and the flight's dock-or-jump (movementFunctions.DockOrJumpOrActivateGate, 346 on, for a
// thing of the station group) both come to movementFunctions.RealDock (503 to 518):
//
//   sm.GetService('sessionMgr').PerformSessionChange('dock', bp.CmdDock, itemID, session.shipid)
//
// bp the ballpark's own object. The same keeping as the undock's, the BFF's; but a dock the server takes and does
// not carry out (the ship not yet close enough, still landing from a warp) answers nothing all the same, so the BFF
// waits only a short while for the ship to be docked, and answers either way: the page reads the flight after, and
// the autopilot docks again where the ship is still in space.
//
// ⚠ A STRUCTURE IS DOCKED AT ANOTHER WAY: structureDocking.Dock(structureID, session.shipid), asked of the service
// by its name once the ship is close (structureDocking.py 64 to 80). The page does not make that call yet, and
// docks at a structure by its route (src/server.js, POST /api/bridge/flight/dock), as before.

/** idCheckers.IsStation (eve/common/script/sys/idCheckers.py 29 to 30): minStation to maxStation, inventorycommon/const.py 59 and 62. */
export function isStation(itemID: number): boolean {
  return Number.isSafeInteger(itemID) && itemID >= 60_000_000 && itemID <= 63_999_999;
}

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

/**
 * Docks the pilot's ship at a station. Fails as the call fails, and before it for what is no station, and for a
 * ship not in space or none known.
 *
 * ⚠ THE CALL COMING BACK IS NOT ALWAYS A DOCK: the BFF answers a dock the server took and did not carry out once its
 * short wait is over, and the flight read after says which it was.
 */
export async function dock(act: Ask, flightNow: () => Promise<FlightNow>, stationID: number): Promise<void> {
  if (!isStation(stationID)) throw new Error("That is no station.");
  const now = await flightNow();
  if (!now.inSpace) throw new Error("The ship is not in space; undock first.");
  if (now.shipID === null) throw new Error("There is no ship to dock.");
  await act("beyonce", "CmdDock", [stationID, now.shipID]);
}
