// R102 Phase-4 BOUND WRITE acks — WB-ENTITY: the 4 drone-command writes
// (CmdReturnHome / CmdSalvage / CmdAbandonDrone / CmdReconnectToDrones) that hang
// off the R72 entity.MachoBindObject bind. PLUMBING ONLY — no UI.
//
// Each write dispatches as a BOUND Cmd* method off entityBindSpec() (the same
// bound two-step the dogma writes use — the BFF holds the OID handle, the browser
// never sees it), NOT the top-level /call seam. Every BFF route is confirm-gated
// (refuses without `confirm:true`) and folds the server return into the uniform
// ack `{ok, applied, result, notifications}` (dispatchBoundEntityWrite in
// server.js). ⚠ CmdAbandonDrone PERMANENTLY DISOWNS the drones — its route carries
// an extra-explicit confirm message.
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS;
// no server restart), so this decoder was written from the droneRuntime handler
// code, not captured bytes. Every command returns a per-drone MULTI-RESULT dict
// (buildMultiDroneResult — a map of droneID → outcome/error), and `result` carries
// it through UNTOUCHED for a future drone UI to decode. `applied` is the confirm-
// gate's did-not-throw signal; a panel re-reads the space snapshot to prove it.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readPlainJsonField, type JsonValue } from "./wire.ts";
import type { Ask } from "./ask.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R102 bound entity drone-command write returns. */
export interface EntityDroneWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return — a per-drone multi-result dict — carried through untouched. */
  readonly result: JsonValue | null;
}

/**
 * Decode an R102 bound entity drone-command write ack. `applied` is the confirm-
 * gate's did-not-throw signal; `result` passes the per-drone multi-result dict
 * through. FAST-MODE: never fired live, so this is an educated guess from the
 * droneRuntime handler code.
 */
export function decodeEntityDroneWriteAck(response: JsonValue): EntityDroneWriteAck {
  const result = readPlainJsonField(response, "result");
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}

// ── Drones sent to salvage ───────────────────────────────────────────────────
//
// Until 2026-10-10 this was one route of the BFF (POST /api/bridge/entity/drones/salvage), which checked `confirm`
// and made the call on an entity handle of its own. A retail client makes it (droneFunctions.py 156 to 161), from a
// salvage drone's menu and from the drones' primary action:
//
//   eveMoniker.GetEntityAccess().CmdSalvage(droneIDs, targetID)
//       The drones as a list; the target the pilot's active one, or None where it has nothing targeted, and the
//       server then finds each drone a wreck. The Moniker is made for the order and binds carrying it. It answers
//       the drones that could not, each with why, and the client raises the first of those.
//
// In no Tranquility recording; CmdEngage and CmdReturnBay are, 61 times, each riding its own bind. The server acts
// for the session's own ship and on drones that ship controls. Either transport carries it, asked of entity by its
// name; the game port makes it on a Moniker of its own for the system the pilot is in.

/**
 * Sends these drones to salvage `targetID`, or any wreck they may where it is `null` (nought is taken for none).
 * With no drones nothing is asked. Answers what the server says of the drones that could not, as it came. Fails as
 * the call fails.
 */
export async function salvageWithDrones(act: Ask, droneIDs: readonly number[], targetID: number | null): Promise<JsonValue> {
  if (droneIDs.length === 0) return null;
  return act("entity", "CmdSalvage", [[...droneIDs], targetID === 0 ? null : targetID]);
}

// --- A drone scooped (the plan's Phase 6b) ------------------------------------
//
// Until 2026-10-11 it was one route of the BFF (POST /api/bridge/drones/scoop).
//
// THE CALL, as the client makes it (droneFunctions.RealScoopToDroneBay, 192 to 197), from a drone's menu
// (menusvc.ScoopToDroneBay, 3624):
//
//   ship = sm.StartService('gameui').GetShipAccess()
//   ret = ship.ScoopDrone(objectIDs)
//
// the drones as one list, on the ship's own object; and what it answers of each drone that could not be scooped
// is told to the pilot (HandleMultipleCallError). For one drone the client flies to within reach of it first
// (GetCloseAndTryCommand), which the page does not: the server says where a drone is too far. No Tranquility
// recording has a scoop.
//
// THE PAGE ASKS IT OF THE SHIP'S SERVICE BY ITS NAME; the game port makes it on the ship's Moniker for where the
// pilot is.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the drones. The ship is the session's own. Of each drone it says why
// where it will not: not in local space, under somebody's control, too far away, no room in the bay.
//
// ⚠ THE ANSWER IS NOT WHAT THE PAGE GOES BY. It is empty where every drone was scooped; the caller reads the
// drones in space after, as it does for every order to drones.

/**
 * Scoops these drones into the ship's drone bay. With no drones nothing is asked. Answers what the server says
 * of the drones that could not be scooped, as it came. Fails as the call fails.
 */
export async function scoopDrones(act: Ask, droneIDs: readonly number[]): Promise<JsonValue> {
  if (droneIDs.length === 0) return null;
  if (!droneIDs.every((droneID) => Number.isSafeInteger(droneID) && droneID > 0)) {
    throw new Error("That drone could not be identified.");
  }
  return act("ship", "ScoopDrone", [[...droneIDs]]);
}

// --- Lost drones reconnected to (the plan's Phase 6b) -------------------------
//
// Until 2026-10-13 it was one route of the BFF (POST /api/bridge/entity/drones/reconnect), which made the call and
// read the drones in space after.
//
// THE CALL, as the client makes it (droneFunctions.ReconnectToDrones, 217 to 241, and _ReconnectToDroneCandidates,
// 244 to 259), from the ship's own menu ("Reconnect to Lost Drones", menusvc.py 1647 to 1648, offered for the
// pilot's own ship where it can carry drones, is in no structure and is not warping:
// celestialCheckers.OfferReconnectToLostDrones, 1187 to 1198) and from its shortcut (eveCommands.py 1315 to 1316):
//
//   entity = eveMoniker.GetEntityAccess()
//   ret = entity.CmdReconnectToDrones(droneCandidates)
//
// the candidates as one list: every ball in the pilot's park that is of the Drone category, is the pilot's own
// character's, and is not among the drones the client holds to be its own (michelle.GetDrones), twenty-five at
// most (MAX_DRONE_RECONNECTS, appConst.py 2069; the compiled module has 25). With no candidate nothing is asked,
// and the pilot is told none was found. What the server answers of the drones it would not take is told to the
// pilot, one refusal at a time. No Tranquility recording has it.
//
// THE PAGE'S WINDOW has a button for each loose drone where the client has one command for all of them: the
// drones are the caller's to name, and this sends what it is given, the first twenty-five.
//
// THE PAGE ASKS IT OF THE ENTITY SERVICE BY ITS NAME; the game port makes it on a Moniker of its own for the
// system the pilot is in.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the drones. Each must be a drone in the session's own scene, the
// session's own character's, and under nobody's control (droneRuntime.commandReconnectToDrones); one of another's
// is passed over. It refuses, for all that are left, where the ship has as many drones out as it may or too
// little bandwidth for the next.
//
// ⚠ THE ANSWER IS NOT WHAT THE PAGE GOES BY. The caller reads the drones in space after: a drone reconnected to
// is one the ship controls.

/** appConst.py 2069: the most drones one reconnection asks for. */
export const MAX_DRONE_RECONNECTS = 25;

/**
 * Asks the ship to take control of these drones again. With no drones nothing is asked. Answers what the server
 * says of the drones it would not take, as it came. Fails as the call fails.
 */
export async function reconnectToDrones(act: Ask, droneIDs: readonly number[]): Promise<JsonValue> {
  if (droneIDs.length === 0) return null;
  if (!droneIDs.every((droneID) => Number.isSafeInteger(droneID) && droneID > 0)) {
    throw new Error("That drone could not be identified.");
  }
  return act("entity", "CmdReconnectToDrones", [droneIDs.slice(0, MAX_DRONE_RECONNECTS)]);
}
