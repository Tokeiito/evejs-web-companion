// The ship's own movement orders that the page makes itself.
//
// SENT TO A POINT. movementFunctions._Ship_GoToPoint (320 to 324):
//
//   sm.GetService('autoPilot').CancelSystemNavigation()
//   bp.CmdGotoPoint(*position)
//
// bp is michelle.GetRemotePark(), the ballpark's own object, and the position's three are floats: the positional
// control's drag (positionalControl.py 199 to 213) adds where the pilot dragged to, to the ballpark's own position
// of the ship. It answers nothing. A pilot controlling a structure sends nothing (IsControllingStructure).
//
// In no Tranquility recording (CmdGotoDirection, the double click in space, is in six). The server flies the
// session's own ship (beyonceService.Handle_CmdGotoPoint): it trusts nothing of the caller but the point. Either
// transport carries it, asked of beyonce by its name; the game port makes it on the ballpark's object, with each
// of the three a float.
//
// ⚠ THE PAGE'S POINT IS A MEASURED ONE, AND THE CLIENT'S IS NOT. A client's point is where its pilot dragged to
// a moment ago. The page's askers (a mining support ship's positioning, a script bot's fleet-mine block) work a
// point out from a reading of the scene, and a point is another place in another system and nothing to another
// ship. So the order is held to the ship and the system the point was measured in, by the page's own read of the
// pilot's flight just before: what the route did with the BFF's read until 2026-10-10. On the game port that
// read is of what the BFF holds of the session, and asks the server nothing.
//
// ⚠ AND NO AUTOPILOT IS CANCELLED HERE. The client's is its own, in the same process. The page's askers are bots
// that hold the ship's movement for themselves, and refuse to run beside another controller.
//
// ALIGNED TO A THING. menusvc._AlignTo (2778 to 2793), the only place the client makes the call:
//
//   bp.CmdAlignTo(dstID=targetID, bookmarkID=bookmarkID)
//
// Nothing goes by position. Of the two by name one is an ID and the other None: a thing, or a bookmark. With no
// park, which is a pilot that is docked, the client sends nothing; and AlignTo (2770) sends nothing for the
// pilot's own ship. It answers nothing. Both of Tranquility's recordings have it so, on the ballpark's bound
// object, the thing a long. (Against this server a client holds a station's or a celestial's ID as the server
// sent it, a whole number within 32 bits, and sends that back: so does the game port.)
//
// The server aligns the session's own ship in the session's own system (beyonceService.Handle_CmdAlignTo): it
// trusts nothing of the caller but the thing, does nothing for a session with no ship in space, and refuses
// nothing. Either transport carries it, asked of beyonce by its name; the game port makes it on the ballpark's
// object.
//
// The page aligns to things only: it has no align to a bookmark. What the client keeps of an align for itself
// (StoreAlignTarget, for the HUD's words) the BFF keeps for a pilot on the game port (pilots.js,
// afterMovementCall).
//
// ⚠ AND NOTHING IS CANCELLED HERE EITHER. After the call the client forgets its own navigation in the system
// (autoPilot.CancelSystemNavigation, autopilot.py 494: a destination in the system it was flying to by steps of
// its own). The page's travel autopilot is not stopped by an align, as it was not when the route made it; the
// overview holds its own movement buttons while an order it began is still running, and no more than that.

// SENT AFTER A THING: THE APPROACH AND KEEP AT RANGE. One call for both, and for the autopilot's approach:
//
//   bp.CmdFollowBall(targetID, range)
//
// movementFunctions.ShipApproach (302) sends const.approachRange, fifty metres; _Ship_KeepAtRange (229) the
// distance the pilot chose, no nearer than that; the autopilot (autopilot.py 451 to 454) opens the throttle,
// park.CmdSetSpeedFraction(1.0), and then follows with a range of 0.0. None is sent for the pilot's own ship
// (_IsInvalidMovementTarget). It answers nothing. Tranquility's recordings have 168 follows: 138 at 50, 22 at
// 5000 and 6 at 7500, each a whole number, and the autopilot's twice, its range a float of nought; and ten
// throttles, every fraction a float. The game port sends the same forms (retailCalls.js).
//
// The server flies the session's own ship (beyonceService.Handle_CmdFollowBall): it trusts nothing of the caller
// but the thing and the range, does nothing for a session with no ship in space, and refuses the same follow
// sent again within a second (ThrottleGeneric, which the page has words for).
//
// ⚠ TWO THINGS THE CLIENT DOES HERE ARE THE BFF'S, NOT THE PAGE'S (src/server.js, followCall). The client's menu
// sends nothing where the ship already follows that thing at that range (_IsAlreadyFollowingBallAtRange): it
// goes by its own ballpark, and a game-port pilot's ballpark is the BFF's, so the BFF holds the order back and
// answers it as taken. And through the gateway the BFF opens the throttle before the menu's follow, as its
// routes always did there. Neither is done for the autopilot's.
//
// What the routes did until 2026-10-11 the page does: a default range, keep at range's floor, a range that is a
// distance of a million metres at most, and the refusal of a pilot that is not in space.
//
// SET TO ORBIT A THING. movementFunctions.Orbit (243) and _Ship_Orbit (260), the only place the client makes the
// call:
//
//   bp.CmdOrbit(targetID, followRange)
//
// The range is made float(range) under ten metres and int(range) from there, before the call. Nothing is sent
// for the pilot's own ship, nor where the ship already orbits that thing at that range. It answers nothing.
// Tranquility's 79 recordings are of whole numbers (1000, 5000, 7500, 10000), none under ten metres. The server
// flies the session's own ship, and refuses the same orbit sent again within a second (ThrottleGeneric).
//
// The hold-back and the gateway's throttle are the BFF's here too (followCall), for an orbit of nought as for
// any other. The route rounded a range of ten metres or more to the nearest whole number; the page cuts it, as
// int() does.
//
// STOPPED. eveCommands.CmdStopShip (1097 to 1110), and menusvc.Activate (2432) for a double click on the pilot's
// own capsule:
//
//   bp.CmdStop()
//
// With nothing. The command does nothing unless the pilot is in a ship in space. Tranquility's 24 recordings have
// it so, on the ballpark's bound object. It answers nothing. The server stops the session's own ship
// (beyonceService.Handle_CmdStop), tells a ship stopped in warp that it is in warp (OnRemoteMessage, ShipInWarp),
// and refuses a second stop within a second (ThrottleGeneric). The route held nothing back and opened no
// throttle: nor does the BFF for the page's call.
//
// ⚠ WHAT THE CLIENT DOES OF ITS AUTOPILOT AROUND A STOP IS THE CALLER'S HERE. The command forgets the autopilot's
// navigation in the system before the call and switches the autopilot off after it. The page's panel gives its
// autopilot up before it asks (flow.stopShip), and so does the fleet companion's stop; a script bot's and a
// support ship's stop is one step of a program that carries on, and gives nothing up.

import type { Ask } from "./ask.ts";

/** A point in a solar system, in metres. */
export interface MovementPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The ship and the system a point was measured in. */
export interface MeasuredIn {
  readonly shipID: number;
  readonly solarSystemID: number;
}

/** The pilot's flight now: in space or not, and in which ship and system where that is known. */
export interface FlightNow {
  readonly inSpace: boolean;
  readonly shipID: number | null;
  readonly solarSystemID: number | null;
}

const isAnID = (id: number): boolean => Number.isSafeInteger(id) && id > 0;

/** const.approachRange: how far short of a thing the client's own approach stops, in metres. */
export const APPROACH_RANGE_M = 50;
/** The range a thing is kept at where none is said, in metres. */
export const KEEP_AT_RANGE_DEFAULT_M = 1000;
/** The range a thing is orbited at where none is said, in metres. */
export const ORBIT_DEFAULT_M = 1000;
/** The farthest a follow's range goes, in metres. */
const MAX_FOLLOW_RANGE_M = 1_000_000;
/** Whether this is a distance a follow can be told: a number of metres, not below nought and not beyond the farthest. */
const isARange = (range: number): boolean => range >= 0 && range <= MAX_FOLLOW_RANGE_M;

/**
 * What the client's menu looks to before it orders the ship about a thing: that there is a thing, that the pilot
 * is in space, and that the thing is not the pilot's own ship. Fails where the client sends nothing.
 */
async function aThingToOrderAbout(flightNow: () => Promise<FlightNow>, targetID: number, itself: string): Promise<void> {
  if (!isAnID(targetID)) {
    throw new Error("That target could not be identified.");
  }
  const now = await flightNow();
  if (!now.inSpace) {
    throw new Error("The ship is not in space; undock first.");
  }
  if (now.shipID === targetID) {
    throw new Error(itself);
  }
}

/**
 * Sends the pilot's ship toward a point. Fails as the call fails, and before it where the point is no point, the
 * pilot is not in space, or its ship or system is not the one the point was measured in.
 *
 * ⚠ THE CALL COMING BACK IS AN ORDER TAKEN, NEVER AN ARRIVAL. A caller sees the ship move in a later reading.
 */
export async function goToPoint(act: Ask, flightNow: () => Promise<FlightNow>, point: MovementPoint, measured: MeasuredIn): Promise<void> {
  if (![point.x, point.y, point.z].every(Number.isFinite) || !isAnID(measured.shipID) || !isAnID(measured.solarSystemID)) {
    throw new Error("Unknown movement geometry or scope.");
  }
  const now = await flightNow();
  if (!now.inSpace) {
    throw new Error("The ship is not in space; undock first.");
  }
  if (now.shipID !== measured.shipID) {
    throw new Error("The observed movement ship changed.");
  }
  if (now.solarSystemID !== measured.solarSystemID) {
    throw new Error("The measured movement system changed.");
  }
  await act("beyonce", "CmdGotoPoint", [point.x, point.y, point.z]);
}

/**
 * Aligns the pilot's ship to a thing in space. Fails as the call fails, and before it where the client sends
 * nothing: for what is no thing, for a pilot that is not in space, and for the pilot's own ship.
 *
 * ⚠ THE CALL COMING BACK IS AN ORDER TAKEN, NEVER A SHIP ALIGNED. The server answers nothing whether it turned the
 * ship or not: it does not for a ship in warp or docking, nor for a thing that is not in the pilot's system.
 */
export async function alignTo(act: Ask, flightNow: () => Promise<FlightNow>, targetID: number): Promise<void> {
  await aThingToOrderAbout(flightNow, targetID, "A ship cannot align to itself.");
  await act("beyonce", "CmdAlignTo", [], { dstID: targetID, bookmarkID: null });
}

/**
 * Sends the pilot's ship to a thing, to stop `range` metres short of it: the client's own fifty where none is
 * said. A range of nought is the autopilot's approach, which opens the throttle first. Fails as a call fails, and
 * before any where the range is no distance or the client sends nothing.
 *
 * ⚠ THE CALL COMING BACK IS AN ORDER TAKEN OR HELD BACK, NEVER AN ARRIVAL. The BFF answers the same for a follow
 * the ship was already flying, which it does not send again.
 */
export async function approach(act: Ask, flightNow: () => Promise<FlightNow>, targetID: number, range: number | null = null): Promise<void> {
  const stopAt = range ?? APPROACH_RANGE_M;
  if (!isARange(stopAt)) {
    throw new Error("The approach range must be a distance in metres.");
  }
  await aThingToOrderAbout(flightNow, targetID, "A ship cannot approach itself.");
  if (stopAt === 0) {
    await act("beyonce", "CmdSetSpeedFraction", [1]);
  }
  await act("beyonce", "CmdFollowBall", [targetID, stopAt]);
}

/**
 * Has the pilot's ship keep `range` metres from a thing: a thousand where none is said, and never nearer than
 * the client's approach stops. Fails as the call fails, and before it where the range is no distance or the
 * client sends nothing.
 */
export async function keepAtRange(act: Ask, flightNow: () => Promise<FlightNow>, targetID: number, range: number | null = null): Promise<void> {
  const held = range ?? KEEP_AT_RANGE_DEFAULT_M;
  if (!isARange(held)) {
    throw new Error("The range to hold must be a distance in metres.");
  }
  await aThingToOrderAbout(flightNow, targetID, "A ship cannot keep at range of itself.");
  await act("beyonce", "CmdFollowBall", [targetID, Math.max(APPROACH_RANGE_M, held)]);
}

/**
 * Has the pilot's ship orbit a thing at `range` metres: a thousand where none is said. From ten metres the range
 * goes as a whole number, cut as the client cuts it; under that it goes as it is. Fails as the call fails, and
 * before it where the range is no distance or the client sends nothing.
 */
export async function orbit(act: Ask, flightNow: () => Promise<FlightNow>, targetID: number, range: number | null = null): Promise<void> {
  const around = range ?? ORBIT_DEFAULT_M;
  if (!isARange(around)) {
    throw new Error("The orbit range must be a distance in metres.");
  }
  await aThingToOrderAbout(flightNow, targetID, "A ship cannot orbit itself.");
  await act("beyonce", "CmdOrbit", [targetID, around < 10 ? around : Math.trunc(around)]);
}

/**
 * Stops the pilot's ship. Fails as the call fails, and before it for a pilot that is not in space, where the
 * client's command does nothing.
 *
 * ⚠ THE CALL COMING BACK IS AN ORDER TAKEN, NEVER A SHIP AT REST. A ship takes its time to stop, and one in warp
 * does not stop at all.
 */
export async function stopShip(act: Ask, flightNow: () => Promise<FlightNow>): Promise<void> {
  const now = await flightNow();
  if (!now.inSpace) {
    throw new Error("The ship is not in space; undock first.");
  }
  await act("beyonce", "CmdStop", []);
}
