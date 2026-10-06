import type { BotScript, MacroStep, ProgramNode } from "./botScript.ts";
import type { ScriptAction, ScriptMemory } from "../nav/scriptDecide.ts";
import type { ScriptObservation } from "../nav/scriptConditions.ts";
import { isRigFlag, isSlotFlag } from "../bridge/fitting.ts";

export type StartupState = "NEEDED" | "PENDING" | "COMPLETE" | "BLOCKED";
export interface StartupCheckpoint {
  readonly logicalRunID: string;
  observe(step: MacroStep, observation: ScriptObservation): Promise<StartupState>;
  beforeIssue(step: MacroStep, action: ScriptAction, invocation: number): Promise<void>;
  restoreMemory?(): ScriptMemory | null;
  checkpoint?(memory: ScriptMemory): Promise<void>;
}

/** Only the unambiguous prefix + final loop shape gets Startup semantics. */
export function startupPrefix(doc: BotScript): readonly ProgramNode[] {
  const last = doc.program.at(-1);
  return last?.kind === "loop" && doc.program.slice(0, -1).every(node => node.kind !== "loop")
    ? doc.program.slice(0, -1) : [];
}

export function startupSteps(doc: BotScript): readonly MacroStep[] {
  return startupPrefix(doc).flatMap(node => node.kind === "macro" ? [node] :
    node.kind === "branch" ? [...node.then, ...node.else] : []);
}

// Deliberately small initial adapter set. The interface supports later verified
// inventory actions; putting a macro here never changes its grant/risk policy.
export function startupPostcondition(step: MacroStep, obs: ScriptObservation, startingLocation: number | null): boolean | null {
  const flight = obs.flightStatus;
  if (!flight || typeof flight.docked !== "boolean" || !flight.shipID) return null;
  if (step.macro === "undock") return flight.docked === false;
  if (step.macro === "dock-at-nearest") return flight.docked === true;
  if (step.macro === "refit-ship") return refitLanded(step, obs);
  if (step.macro === "travel-to-station") {
    const station = step.args.station;
    if (station?.kind !== "station") return null;
    const target = station.ref.starting ? startingLocation : station.ref.id;
    if (!target || station.ref.slot) return null;
    return flight.docked && (flight.stationID === target || flight.structureID === target);
  }
  return null;
}

export function startupActionSupported(step: MacroStep, action: ScriptAction): boolean {
  return (step.macro === "undock" && action.kind === "undock") ||
    (["dock-at-nearest", "travel-to-station"].includes(step.macro) && action.kind === "dock") ||
    (step.macro === "refit-ship" && (action.kind === "boardShip" || action.kind === "applyFitting"));
}

/**
 * Steps that take more than one action (refit: board the hull, then apply the
 * fit). After a dispatched action, true means THAT action is seen to have
 * landed, so the step may issue its next one while the step's own
 * postcondition still decides completion; null means not provable.
 */
export function startupActionLanded(step: MacroStep, action: ScriptAction, obs: ScriptObservation): boolean | null {
  if (step.macro !== "refit-ship") return null;
  if (action.kind === "boardShip") {
    const shipID = obs.flightStatus?.shipID;
    return typeof shipID === "number" && shipID > 0 ? shipID === action.shipID : null;
  }
  if (action.kind === "applyFitting") return refitLanded(step, obs);
  return null;
}

/** Steps whose job is to change the ship, so the run's ship moves with them. */
export function startupChangesShip(step: MacroStep): boolean {
  return step.macro === "refit-ship";
}

/**
 * The refit is in place: docked, in a hull of the fitting's ship type, with
 * every module the fitting puts in a high, mid, low or subsystem slot fitted
 * there. Extra modules do not fail it; rigs (a refit never touches them),
 * charges, drones and cargo in the fitting are not checked. The fitting is
 * found the way the refit step finds it: by name, then by id. Shared with the
 * refit step itself, which uses it to confirm its apply landed.
 */
export function refitLanded(step: MacroStep, obs: ScriptObservation): boolean | null {
  const flight = obs.flightStatus;
  if (flight?.docked !== true || !flight.shipID) return null;
  const arg = step.args["fitting"];
  const library = obs.savedFittings ?? null;
  const fitted = obs.activeFitting ?? null;
  if (arg?.kind !== "fitting" || library === null || fitted === null) return null;
  const fitting = library.find((f) => arg.name !== null && f.name === arg.name) ??
    library.find((f) => arg.fittingID !== null && f.fittingID === arg.fittingID) ?? null;
  if (fitting === null) return null;
  // A read from another hull (taken across a swap) proves nothing about this one.
  if (fitted.shipID !== flight.shipID) return null;
  const hull = obs.stationHangar?.find((row) => row.itemID === flight.shipID)?.typeID ?? flight.shipTypeID ?? null;
  if (hull === null) return null;
  if (hull !== fitting.shipTypeID) return false;
  return fitting.modules.every((module) => !isSlotFlag(module.flagID) || isRigFlag(module.flagID) ||
    fitted.modules.some((m) => m.flagID === module.flagID && m.typeID === module.typeID));
}
