// Activate Gate, as the client offers and makes it.
//
// OFFERED (menusvc.py 1767 to 1780; menucheckers/celestialCheckers.py OfferActivateGate, 313 to 318, and IsWarpGate,
// 2079 and 2080): for an acceleration gate (inventory group 366, groupWarpGate) or an Abyssal trace
// (typeAbyssEntranceGate); while the pilot warps it is shown disabled, "You are in warp" (AddDisabledEntryForWarp).
//
// MADE through GetCloseAndTryCommand (menusvc.py 3698 to 3700): the client's system navigation flies the ship to
// within 2,500 m of the gate (autoPilot.NavigateSystemTo with maxStargateJumpingDistance), then the gate's own call,
// by its type (GetAbyssalGateFunction, 3724 to 3736; movementFunctions.py 542 to 590):
//
//   47685 typeAbyssEncounterGate, a pocket's Transfer Conduit   RealActivateAbyssalGate:
//         PerformSessionChange('abyssToAbyssJump', RemoteSvc('abyssalMgr').AbyssalGateActivation, itemID,
//         violateSafetyTimer=True)
//   47686 typeAbyssExitGate, its last room's conduit out        RealActivateAbyssalEndGate:
//         PerformSessionChange('abyssToKnownJump', RemoteSvc('abyssalMgr').AbyssalEndGateActivation, itemID)
//   48964 typeAbyssEntranceGate, a fleet's trace                the Abyssal jump window: not made yet
//   49563 typeAbyssPvPGate, 80944 typeVoidSpaceExitGate         the PvP filament's and void space's: not made yet
//   any other acceleration gate                                 RealActivateAccelerationGate: the crimewatch safety
//         check (crimewatchSvc.GetRequiredSafetyLevelForActivatingAccelerationGate, 369 to 389: full safety for any
//         gate but a faction warfare or insurgency gate and a suspect's soft-locked one, whose slim fields the page
//         does not have yet), then PerformSessionChange(..., RemoteSvc('keeper').ActivateAccelerationGate, itemID,
//         violateSafetyTimer=1)
//
// The constants are the compiled modules' own (inventorycommon/const.pyc, eve/common/lib/appConst.pyc), read
// through the client's Python.

import type { Ask } from "./ask.ts";

export const GROUP_WARP_GATE = 366;
export const TYPE_ABYSS_ENCOUNTER_GATE = 47685;
export const TYPE_ABYSS_EXIT_GATE = 47686;
export const TYPE_ABYSS_ENTRANCE_GATE = 48964;
export const TYPE_ABYSS_PVP_GATE = 49563;
export const TYPE_VOID_SPACE_EXIT_GATE = 80944;
/** appConst.maxStargateJumpingDistance: the range a gate is activated within. */
export const GATE_ACTIVATION_RANGE_M = 2_500;

/** The menu's words for it, and the hint while in warp (menusvc.py 1776 and 3712). */
export const ACTIVATE_GATE_LABEL = "UI/Inflight/ActivateGate";
export const IN_WARP_HINT_LABEL = "UI/Menusvc/MenuHints/YouAreInWarp";

/** IsWarpGate: an acceleration gate, or an Abyssal trace. */
export function isWarpGate(groupID: number | null, typeID: number | null): boolean {
  return groupID === GROUP_WARP_GATE || typeID === TYPE_ABYSS_ENTRANCE_GATE;
}

/** The gate's call, by its type; null for a gate whose activation the page does not make yet. */
export function gateCallFor(typeID: number | null, itemID: number): {
  readonly service: string;
  readonly method: string;
  readonly args: readonly number[];
  readonly kwargs: Readonly<Record<string, boolean | number>> | null;
} | null {
  switch (typeID) {
    case TYPE_ABYSS_ENCOUNTER_GATE:
      return { service: "abyssalMgr", method: "AbyssalGateActivation", args: [itemID], kwargs: { violateSafetyTimer: true } };
    case TYPE_ABYSS_EXIT_GATE:
      return { service: "abyssalMgr", method: "AbyssalEndGateActivation", args: [itemID], kwargs: null };
    case TYPE_ABYSS_ENTRANCE_GATE:
    case TYPE_ABYSS_PVP_GATE:
    case TYPE_VOID_SPACE_EXIT_GATE:
      return null;
    default:
      return { service: "keeper", method: "ActivateAccelerationGate", args: [itemID], kwargs: { violateSafetyTimer: 1 } };
  }
}

/**
 * The gate's call (gateCallFor), made by the page's own asking. Fails as the call fails, and before it for what is no
 * gate's number or a gate the page does not activate yet.
 */
export async function activateGate(act: Ask, itemID: number, typeID: number | null): Promise<void> {
  if (!Number.isSafeInteger(itemID) || itemID <= 0) throw new Error("That gate could not be identified.");
  const call = gateCallFor(typeID, itemID);
  if (call === null) throw new Error("This gate is not activated from here yet.");
  await act(call.service, call.method, [...call.args], call.kwargs ?? undefined);
}
