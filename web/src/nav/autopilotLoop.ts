// Browser autopilot decide-loop (goal R5b, roadmap §7). A framework-agnostic
// port of the retail client's `autopilot.py` `AutoPilot.Update` tick loop: it
// SEQUENCES the R5a atomic calls (undock / warp / jump / dock) over a computed
// route, but never simulates or predicts position — each decision reads the
// authoritative `flight-status` and issues at most one atomic call, exactly as
// retail's client-side loop does.
//
// It runs in the BROWSER. Closing the tab is closing the client: the JS simply
// stops (no "stop" is sent), the ship completes whatever server-side command
// was last issued and then sits. The loop pauses (does not guess) on any
// unsafe/blocked condition, and after abort/pause it never calls the bridge.
//
// Truth model (no distances — flight-status has no range readout, so unlike
// retail we can't measure `bp.GetSurfaceDist`): we drive off ship MODE and the
// server's own refusals. Warp to a gate; while the ship is in warp, wait; when
// warp ends, jump. The verified docking behaviour — `CmdDock` out of range
// refuses `DockingApproach` and the ship enters a FOLLOW approach, then
// re-issuing `CmdDock` docks once in range — is replicated by re-issuing dock
// each cycle until the status shows docked (approach-then-redock). Retail's
// `ignoreTimerCycles` (settle a few ticks after a warp/jump so the transition
// starts before we re-decide) is mirrored by `settleTicks`.

import type { FlightStatus } from "../store/types.ts";
import type { RouteHop } from "./routeSolver.ts";

/** The loop's lifecycle status (mirrors the travel-panel states). */
export type AutopilotStatus =
  | "idle"
  | "running"
  | "paused"
  | "arrived"
  | "aborted"
  | "error";

/** A compiled travel plan the loop sequences. */
export interface RoutePlan {
  readonly destinationSystemID: number;
  /** The final dock target; null travels to the system only (no final dock). */
  readonly destinationStationID: number | null;
  readonly destinationName: string | null;
  readonly hops: readonly RouteHop[];
}

/** The single atomic decision a tick produces. */
export type AutopilotAction =
  | { readonly kind: "undock" }
  | { readonly kind: "warp"; readonly destinationID: number; readonly label: string }
  | { readonly kind: "jump"; readonly fromGateID: number; readonly toGateID: number; readonly label: string }
  | { readonly kind: "dock"; readonly stationID: number; readonly label: string }
  | { readonly kind: "wait"; readonly reason: string }
  | { readonly kind: "arrived" }
  | { readonly kind: "pause"; readonly reason: string }
  | { readonly kind: "aborted" };

/** The live readout the panel renders (pushed via `onProgress` each cycle). */
export interface AutopilotProgress {
  readonly status: AutopilotStatus;
  readonly action: string | null;
  readonly phase: string | null;
  readonly currentSystemID: number | null;
  readonly nextSystemID: number | null;
  readonly remainingJumps: number;
  readonly totalJumps: number;
  readonly failureReason: string | null;
}

/** Everything the loop needs from the outside — all injectable for tests. */
export interface AutopilotDeps {
  getStatus(): Promise<FlightStatus>;
  undock(): Promise<void>;
  warp(destinationID: number): Promise<void>;
  jump(fromGateID: number, toGateID: number): Promise<void>;
  dock(stationID: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  onProgress(progress: AutopilotProgress): void;
  /** True when an error means the live session is gone (unwind to offline). */
  isSessionLost(error: unknown): boolean;
  /** The handler's own user-facing refusal text (for pause/failure reasons). */
  refusalReason(error: unknown): string;
}

export interface AutopilotController {
  /**
   * Initialise the plan + memory into the running state (does not drive the
   * loop itself — the caller drives with `run()`; keeps `tick()` unit-testable
   * without a background driver racing it).
   */
  start(plan: RoutePlan): void;
  pause(): void;
  resume(): void;
  abort(): void;
  /** One decision cycle: poll status, decide, issue at most one atomic call. */
  tick(): Promise<AutopilotAction>;
  /**
   * Drive the loop until it leaves the running state (production driver). Safe
   * to call after start()/resume(); a stale driver from a prior run exits via
   * the run-token guard.
   */
  run(): Promise<void>;
  snapshot(): AutopilotProgress;
}

export const AUTOPILOT_CADENCE_MS = 2000;
const SETTLE_UNDOCK = 2;
const SETTLE_WARP = 2;
const SETTLE_JUMP = 5;
const SETTLE_DOCK = 2;
const MAX_DOCK_ATTEMPTS = 30;
const MAX_JUMP_ATTEMPTS = 6;

interface CompiledPlan extends RoutePlan {
  readonly hopsByFromSystem: ReadonlyMap<number, RouteHop>;
  readonly totalJumps: number;
}

interface LoopMemory {
  status: AutopilotStatus;
  warpedInSystem: number | null;
  jumpedFromSystem: number | null;
  completedHops: number;
  dockAttempts: number;
  jumpAttempts: number;
  settleTicks: number;
  action: string | null;
  phase: string | null;
  currentSystemID: number | null;
  nextSystemID: number | null;
  failureReason: string | null;
}

function freshMemory(): LoopMemory {
  return {
    status: "idle",
    warpedInSystem: null,
    jumpedFromSystem: null,
    completedHops: 0,
    dockAttempts: 0,
    jumpAttempts: 0,
    settleTicks: 0,
    action: null,
    phase: null,
    currentSystemID: null,
    nextSystemID: null,
    failureReason: null,
  };
}

function compilePlan(plan: RoutePlan): CompiledPlan {
  const hopsByFromSystem = new Map<number, RouteHop>();
  for (const hop of plan.hops) {
    hopsByFromSystem.set(hop.fromSystemID, hop);
  }
  return { ...plan, hopsByFromSystem, totalJumps: plan.hops.length };
}

function isWarping(shipMode: string | null): boolean {
  return shipMode !== null && /warp/i.test(shipMode);
}

function isAtDestination(status: FlightStatus, plan: CompiledPlan): boolean {
  if (!status.docked || status.solarSystemID !== plan.destinationSystemID) {
    return false;
  }
  return plan.destinationStationID === null || status.stationID === plan.destinationStationID;
}

/**
 * The pure decision: given the current flight status, the plan, and the loop
 * memory, choose the next atomic action. Reads memory but does not mutate it
 * (the controller reconciles memory against observed transitions and records
 * what it issues). Exported for direct unit assertions.
 */
export function decideAutopilotAction(
  status: FlightStatus,
  plan: CompiledPlan,
  memory: Pick<LoopMemory, "warpedInSystem" | "jumpedFromSystem">,
): AutopilotAction {
  // Docked: arrival check, else leave the station.
  if (status.docked) {
    if (isAtDestination(status, plan)) {
      return { kind: "arrived" };
    }
    return { kind: "undock" };
  }

  // In space and warping: never act mid-warp (retail returns on DSTBALL_WARP).
  if (isWarping(status.shipMode)) {
    return { kind: "wait", reason: "In warp" };
  }

  const sys = status.solarSystemID;
  if (sys === null) {
    return { kind: "pause", reason: "No solar system in flight status." };
  }

  // Jump handoff: while the status still shows the system we jumped FROM, the
  // session hasn't handed off yet — wait (the controller clears this once the
  // system changes).
  if (memory.jumpedFromSystem !== null && sys === memory.jumpedFromSystem) {
    return { kind: "wait", reason: "Jump handoff" };
  }

  // At the destination system: warp to the station, then dock (re-issuing dock
  // through the FOLLOW approach until the status shows docked).
  if (sys === plan.destinationSystemID) {
    if (plan.destinationStationID === null) {
      return { kind: "arrived" };
    }
    if (memory.warpedInSystem === sys) {
      return {
        kind: "dock",
        stationID: plan.destinationStationID,
        label: `Dock at station ${plan.destinationStationID}`,
      };
    }
    return {
      kind: "warp",
      destinationID: plan.destinationStationID,
      label: `Warp to station ${plan.destinationStationID}`,
    };
  }

  // A routed system: warp to its outbound gate, then jump through it.
  const hop = plan.hopsByFromSystem.get(sys);
  if (!hop) {
    return { kind: "pause", reason: `Off route: no planned hop from system ${sys}.` };
  }
  if (memory.warpedInSystem === sys) {
    return {
      kind: "jump",
      fromGateID: hop.gateToWarpID,
      toGateID: hop.jumpToGateID,
      label: `Jump to system ${hop.toSystemID}`,
    };
  }
  return {
    kind: "warp",
    destinationID: hop.gateToWarpID,
    label: `Warp to gate ${hop.gateToWarpID}`,
  };
}

/** Classify a jump refusal into a recovery path. */
function classifyJumpRefusal(reason: string): "approach" | "pause" {
  // "NotCloseEnoughToJump" (retail): we thought we were at the gate but aren't
  // — re-approach by re-warping to the gate. Everything else the retail
  // `_HandleJumpUserErrors` treats as fatal (Stuck, StandingsTooLow, gate
  // restricted, no link, too heavy, no charge) → pause and show why.
  return /close enough|not close|notcloseenough/i.test(reason) ? "approach" : "pause";
}

/** True when a dock refusal is the normal out-of-range docking-approach. */
function isDockingApproach(reason: string): boolean {
  return /dockingapproach|docking approach|approach|not in range|too far|range/i.test(reason);
}

export function createAutopilot(deps: AutopilotDeps): AutopilotController {
  let memory = freshMemory();
  let plan: CompiledPlan | null = null;
  // Bumped on pause/abort/start so a stale in-flight run() loop stops driving.
  let runToken = 0;

  function remainingJumps(): number {
    if (!plan) {
      return 0;
    }
    return Math.max(0, plan.totalJumps - memory.completedHops);
  }

  function snapshot(): AutopilotProgress {
    return {
      status: memory.status,
      action: memory.action,
      phase: memory.phase,
      currentSystemID: memory.currentSystemID,
      nextSystemID: memory.nextSystemID,
      remainingJumps: remainingJumps(),
      totalJumps: plan ? plan.totalJumps : 0,
      failureReason: memory.failureReason,
    };
  }

  function emit(): void {
    deps.onProgress(snapshot());
  }

  function setPause(reason: string): void {
    memory.status = "paused";
    memory.failureReason = reason;
    memory.phase = "Paused";
    memory.action = null;
    runToken += 1;
  }

  function setError(reason: string): void {
    memory.status = "error";
    memory.failureReason = reason;
    memory.phase = "Stopped";
    memory.action = null;
    runToken += 1;
  }

  // Update memory from the observed status BEFORE deciding: detect the jump
  // handoff completing (system changed) and refresh the readout fields.
  function reconcile(status: FlightStatus): void {
    memory.currentSystemID = status.solarSystemID;
    if (
      memory.jumpedFromSystem !== null &&
      status.solarSystemID !== null &&
      status.solarSystemID !== memory.jumpedFromSystem
    ) {
      // Handed off into the next system: one hop done, reset per-system memory.
      memory.completedHops += 1;
      memory.jumpedFromSystem = null;
      memory.warpedInSystem = null;
      memory.jumpAttempts = 0;
    }
    if (plan) {
      const hop =
        status.solarSystemID !== null ? plan.hopsByFromSystem.get(status.solarSystemID) : undefined;
      memory.nextSystemID = hop
        ? hop.toSystemID
        : status.solarSystemID === plan.destinationSystemID
          ? null
          : memory.nextSystemID;
    }
  }

  // Issue at most one atomic call and record its effect on memory. Every bridge
  // call is preceded by a running-state guard so nothing is issued after
  // pause/abort. Refusals are classified: recoverable ones adjust memory and
  // retry; unsafe ones pause with the handler's reason.
  async function issue(action: AutopilotAction, sys: number): Promise<void> {
    if (memory.status !== "running") {
      return;
    }
    try {
      switch (action.kind) {
        case "undock":
          await deps.undock();
          memory.settleTicks = SETTLE_UNDOCK;
          return;
        case "warp":
          await deps.warp(action.destinationID);
          memory.warpedInSystem = sys;
          memory.settleTicks = SETTLE_WARP;
          return;
        case "jump":
          await deps.jump(action.fromGateID, action.toGateID);
          memory.jumpedFromSystem = sys;
          memory.settleTicks = SETTLE_JUMP;
          return;
        case "dock":
          await deps.dock(action.stationID);
          memory.settleTicks = SETTLE_DOCK;
          return;
        default:
          return;
      }
    } catch (error) {
      handleActionError(action, error);
    }
  }

  function handleActionError(action: AutopilotAction, error: unknown): void {
    if (deps.isSessionLost(error)) {
      setError("The live session ended (idle timeout or another client took over).");
      return;
    }
    const reason = deps.refusalReason(error);

    if (action.kind === "undock" && /already in space|already_in_space/i.test(reason)) {
      // Benign: we wanted to be in space and we are. Continue.
      memory.settleTicks = SETTLE_UNDOCK;
      return;
    }

    if (action.kind === "jump") {
      memory.jumpAttempts += 1;
      if (memory.jumpAttempts > MAX_JUMP_ATTEMPTS) {
        setPause(`Could not jump after ${memory.jumpAttempts} attempts: ${reason}`);
        return;
      }
      if (classifyJumpRefusal(reason) === "approach") {
        // Not at the gate yet: re-approach by re-warping to it next cycle.
        memory.warpedInSystem = null;
        memory.settleTicks = SETTLE_WARP;
        return;
      }
      setPause(`Jump refused: ${reason}`);
      return;
    }

    if (action.kind === "dock") {
      if (isDockingApproach(reason)) {
        memory.dockAttempts += 1;
        if (memory.dockAttempts > MAX_DOCK_ATTEMPTS) {
          setPause(`Could not reach docking range after ${memory.dockAttempts} attempts.`);
          return;
        }
        // Approach-then-redock: the ship is now approaching; re-issue dock.
        memory.settleTicks = SETTLE_DOCK;
        return;
      }
      setPause(`Dock refused: ${reason}`);
      return;
    }

    // Warp (or any other) refusal — scrambled/disrupted/invalid target/lost
    // control: pause and show the handler's own reason. Don't guess.
    setPause(`${labelFor(action)} refused: ${reason}`);
  }

  function labelFor(action: AutopilotAction): string {
    switch (action.kind) {
      case "warp":
        return "Warp";
      case "jump":
        return "Jump";
      case "dock":
        return "Dock";
      case "undock":
        return "Undock";
      default:
        return "Action";
    }
  }

  async function tick(): Promise<AutopilotAction> {
    if (memory.status !== "running" || !plan) {
      const kind: AutopilotAction =
        memory.status === "arrived"
          ? { kind: "arrived" }
          : memory.status === "aborted"
            ? { kind: "aborted" }
            : { kind: "wait", reason: memory.failureReason ?? "Not running" };
      return kind;
    }

    let status: FlightStatus;
    try {
      status = await deps.getStatus();
    } catch (error) {
      if (deps.isSessionLost(error)) {
        setError("The live session ended (idle timeout or another client took over).");
      } else {
        setPause(`Could not read flight status: ${deps.refusalReason(error)}`);
      }
      emit();
      return { kind: "pause", reason: memory.failureReason ?? "status read failed" };
    }

    // Abort/pause may have fired during the status await: never issue after it.
    if (memory.status !== "running") {
      emit();
      return { kind: memory.status === "aborted" ? "aborted" : "wait", reason: "stopped" };
    }

    reconcile(status);

    // Settle window after a warp/jump/dock: let the transition begin before we
    // re-decide (retail's ignoreTimerCycles). Still polls status for the
    // readout, just suppresses a new decision.
    if (memory.settleTicks > 0) {
      memory.settleTicks -= 1;
      memory.phase = "Settling";
      memory.action = "Waiting for the last move to take effect";
      emit();
      return { kind: "wait", reason: "settling" };
    }

    const action = decideAutopilotAction(status, plan, memory);
    memory.action = actionText(action);
    memory.phase = phaseText(action, status);

    switch (action.kind) {
      case "arrived":
        memory.status = "arrived";
        memory.failureReason = null;
        runToken += 1;
        emit();
        return action;
      case "pause":
        setPause(action.reason);
        emit();
        return action;
      case "wait":
        emit();
        return action;
      default:
        break;
    }

    emit();
    await issue(action, status.solarSystemID as number);
    emit();
    return action;
  }

  function actionText(action: AutopilotAction): string {
    switch (action.kind) {
      case "undock":
        return "Undocking";
      case "warp":
        return action.label;
      case "jump":
        return action.label;
      case "dock":
        return action.label;
      case "wait":
        return `Waiting (${action.reason})`;
      case "arrived":
        return "Arrived";
      case "pause":
        return "Paused";
      case "aborted":
        return "Aborted";
    }
  }

  function phaseText(action: AutopilotAction, status: FlightStatus): string {
    if (action.kind === "undock") {
      return "Undocking";
    }
    if (action.kind === "warp") {
      return "Warping";
    }
    if (action.kind === "jump") {
      return "Jumping";
    }
    if (action.kind === "dock") {
      return "Docking";
    }
    if (action.kind === "wait") {
      return isWarping(status.shipMode) ? "In warp" : "Working";
    }
    return status.docked ? "Docked" : "In space";
  }

  async function run(): Promise<void> {
    const token = runToken;
    while (token === runToken && memory.status === "running") {
      await tick();
      if (token !== runToken || memory.status !== "running") {
        break;
      }
      await deps.sleep(AUTOPILOT_CADENCE_MS);
    }
  }

  return {
    start(nextPlan: RoutePlan): void {
      plan = compilePlan(nextPlan);
      memory = freshMemory();
      memory.status = "running";
      memory.phase = "Starting";
      runToken += 1;
      emit();
    },
    pause(): void {
      if (memory.status === "running") {
        memory.status = "paused";
        memory.phase = "Paused";
        memory.action = null;
        runToken += 1;
        emit();
      }
    },
    resume(): void {
      if (memory.status === "paused") {
        memory.status = "running";
        memory.failureReason = null;
        memory.phase = "Resuming";
        runToken += 1;
        emit();
      }
    },
    abort(): void {
      if (memory.status === "running" || memory.status === "paused") {
        memory.status = "aborted";
        memory.phase = "Aborted";
        memory.action = null;
        runToken += 1;
        emit();
      }
    },
    tick,
    run,
    snapshot,
  };
}
