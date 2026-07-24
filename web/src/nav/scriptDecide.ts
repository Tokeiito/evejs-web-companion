// A4b — the tick orchestrator: given a script, a fresh observation, and the
// running memory, decide the ONE action this tick, and hand back the next
// memory. Pure and total — it always returns exactly one action (wait included)
// with a why, so bounds can dispatch on it and no tick is ever empty of a
// decision.
//
// ─── THE SHAPE OF A TICK ─────────────────────────────────────────────────────
//
//   1. If a "dock and stop" interrupt already fired, the ship is flying home;
//      keep flying it, then pause once docked.
//   2. Otherwise, interrupts first (A4a): a met one fires; a pirate with an
//      unreadable ship pauses; the safety floor's blindness feeds the streak.
//   3. Otherwise, the FORWARD SCAN runs the program: consult the active step's
//      macro, and if the step is finished (its `until` met while the macro is
//      armed, or the macro reports itself done) advance to the next node and
//      consult it IN THE SAME TICK — never backwards except a loop re-entering
//      its own body, counted against its repeat.
//
// ─── WHY IT CANNOT LIVELOCK ──────────────────────────────────────────────────
//
// The scan records every position it visits this tick. Coming back to one it
// already tried means the program made a full loop emitting nothing — the exact
// "a tick can legally emit no world call" primitive the phases model died of.
// That is not silently tolerated: it pauses with a plain reason. A step that
// runs too long (a macro-internal counter gap) trips MAX_STEP_TICKS. A read that
// stays unreadable trips the cannot-tell streak. Every way of doing nothing has
// a bound.

import type { BotScript, Condition, LoopBlock, MacroStep } from "../bots/botScript.ts";
import { conditionSentence } from "../bots/scriptText.ts";
import {
  SENTENCE as COND_SENTENCE,
  bumpCannotTellStreak,
  cannotTellStreakExhausted,
  evaluateCondition,
  resolveInterrupt,
  type ScriptObservation,
} from "./scriptConditions.ts";

// ─── The one action a tick emits ─────────────────────────────────────────────

export type ScriptAction =
  | { readonly kind: "wait" }
  | { readonly kind: "undock" }
  | { readonly kind: "dock"; readonly stationID: number }
  | { readonly kind: "warp"; readonly targetID: number }
  | { readonly kind: "approach"; readonly targetID: number }
  | { readonly kind: "align"; readonly targetID: number }
  | { readonly kind: "orbit"; readonly targetID: number; readonly range: number }
  | { readonly kind: "jump"; readonly fromGateID: number; readonly toGateID: number }
  | { readonly kind: "lock"; readonly targetID: number }
  | { readonly kind: "activate"; readonly moduleID: number; readonly targetID: number }
  | { readonly kind: "deactivate"; readonly moduleID: number }
  | { readonly kind: "launchDrones"; readonly droneItemIDs: readonly number[] }
  | { readonly kind: "engageDrones"; readonly droneIDs: readonly number[]; readonly targetID: number }
  | { readonly kind: "recallDrones"; readonly droneIDs: readonly number[] }
  | { readonly kind: "unloadOre"; readonly itemIDs: readonly number[] }
  // ── Mission actions (the distribution blocks). Each is one proven mission-bot
  //    operation: a labeled button press in the agent conversation, a handoff to
  //    the shared autopilot, or a package move confirmed by re-read next tick.
  | { readonly kind: "agentButton"; readonly agentID: number; readonly actionID: number; readonly label: string }
  | { readonly kind: "startRoute"; readonly stationID: number }
  | { readonly kind: "loadMissionCargo"; readonly typeID: number; readonly quantity: number }
  | { readonly kind: "unloadMissionCargo"; readonly itemIDs: readonly number[] }
  /** Order salvage drones onto a wreck; targetID 0 = the runtime auto-picks. */
  | { readonly kind: "salvageDrones"; readonly droneIDs: readonly number[]; readonly targetID: number }
  /** Take everything out of ONE wreck (an owned wreck — the decider guarantees it). */
  | { readonly kind: "lootWreck"; readonly wreckID: number }
  /** Run these hangar stacks through the station refinery (verified server-side). */
  | { readonly kind: "reprocessOre"; readonly itemIDs: readonly number[] }
  /** Warp to a scanned site by its scan-signature label ("QEE-288"). */
  | { readonly kind: "warpScan"; readonly target: string }
  /** Warp to a saved bookmark (the server resolves site/point + mission scope). */
  | { readonly kind: "warpBookmark"; readonly bookmarkID: number }
  /** Board a ship in the station hangar (it becomes the active ship). */
  | { readonly kind: "boardShip"; readonly shipID: number }
  /** Apply a saved fitting to the active ship (modules from this hangar). */
  | { readonly kind: "applyFitting"; readonly fittingID: number }
  /** Restart ONE expired extractor program (same resource it was pulling). */
  | { readonly kind: "restartExtractor"; readonly planetID: number; readonly pinID: number; readonly resourceTypeID: number }
  /** Pay the station repair shop to fix these items. */
  | { readonly kind: "repairItems"; readonly itemIDs: readonly number[] }
  /** Move stacks between docked places (hangar / cargo / ore hold), qty = split. */
  | {
      readonly kind: "moveItems";
      readonly itemIDs: readonly number[];
      readonly from: string;
      readonly to: string;
      readonly qty: number | null;
    };

export function isWorldCall(action: ScriptAction): boolean {
  return action.kind !== "wait";
}

const WAIT: ScriptAction = { kind: "wait" };

// ─── The macro contract (concrete macros land in A4c) ────────────────────────

/** Per-step scratch that persists across ticks while the step is active. */
export type MacroMemory = Readonly<Record<string, unknown>>;

/**
 * What a macro reports for one tick.
 *
 *   • outcome "acting"  — it wants to issue `action` (which may be a wait).
 *   • outcome "done"    — it has finished its own job (docked, hold empty); the
 *                         orchestrator advances to the next step this tick.
 *   • outcome "blocked" — it cannot proceed; the bot pauses with the reason.
 *
 * `armed` says whether the player's `until` is meaningful yet — mine-at-belt is
 * unarmed until it has arrived, which is what keeps "ore hold full" from reading
 * true against an empty hold while the ship is still in warp.
 */
export type MacroOutcome =
  | { readonly kind: "acting" }
  | { readonly kind: "done" }
  | { readonly kind: "blocked"; readonly reason: string };

/**
 * The run-scoped BOARD: facts one block publishes for the blocks after it (the
 * found agent, its station, the mission's pickup/dropoff). Unlike per-step
 * memory it SURVIVES step transitions and loop laps; it dies with the run.
 */
export type ScriptBoard = Readonly<Record<string, number | string | null>>;

export interface MacroTick {
  readonly action: ScriptAction;
  readonly why: string;
  readonly phase: string;
  readonly armed: boolean;
  readonly outcome: MacroOutcome;
  readonly nextMem: MacroMemory;
  /** Facts to publish onto the run's board this tick (merged over what's there). */
  readonly boardPatch?: ScriptBoard;
}

export type MacroDecider = (
  step: MacroStep,
  obs: ScriptObservation,
  mem: MacroMemory,
  board: ScriptBoard,
) => MacroTick;

/** Keyed by MacroID. A4c supplies the real four; tests supply fakes. */
export type MacroRegistry = Readonly<Record<string, MacroDecider>>;

/** Flies the ship to `home` for a latched dock-and-pause. `done` == docked home. */
export type HomeTravelDecider = (obs: ScriptObservation, mem: MacroMemory) => MacroTick;

// ─── Memory ──────────────────────────────────────────────────────────────────

export const MAX_STEP_TICKS = 1800; // ~1h at the 2s cadence — the R39 backstop

const HOME_MEM_KEY = "__home__";

type Position =
  | { readonly kind: "step"; readonly node: number }
  | { readonly kind: "loop"; readonly node: number; readonly body: number }
  | { readonly kind: "done" };

interface Latched {
  readonly interruptID: string;
  readonly reason: string;
}

export interface ScriptMemory {
  readonly position: Position;
  readonly loopPass: number;
  readonly stepTicks: number;
  readonly cannotTellStreak: number;
  readonly latched: Latched | null;
  readonly macroMem: Readonly<Record<string, MacroMemory>>;
  /** The run-scoped board — survives step transitions; dies with the run. */
  readonly board: ScriptBoard;
}

/** The memory a fresh run starts from — positioned at the first node. */
export function initialMemory(script: BotScript): ScriptMemory {
  return {
    position: startOfNode(script, 0),
    loopPass: 0,
    stepTicks: 0,
    cannotTellStreak: 0,
    latched: null,
    macroMem: {},
    board: {},
  };
}

/**
 * The board as one R9a line for the readout — who the run is working with, by
 * NAME only (ids on the board never reach the screen, R7d). Null when the board
 * holds nothing a player would want to read.
 */
export function describeBoard(board: ScriptBoard): string | null {
  const agentName = typeof board["agentName"] === "string" ? (board["agentName"] as string) : null;
  const stationName =
    typeof board["agentStationName"] === "string" ? (board["agentStationName"] as string) : null;
  if (agentName === null) {
    return null;
  }
  return stationName !== null && stationName.length > 0
    ? `Working with ${agentName} (${stationName})`
    : `Working with ${agentName}`;
}

/**
 * Which macro the NEXT tick will consult — the runner's observe hint, so the
 * flow reads agent/journal/cargo only when a mission block is active. Null when
 * the program is done or heading home (only the ship reads are needed then).
 */
export function activeMacroID(script: BotScript, mem: ScriptMemory): string | null {
  if (mem.position.kind === "done" || mem.latched !== null) {
    return null;
  }
  const step = activeStep(script, mem.position);
  return step?.macro ?? null;
}

// ─── The decision returned each tick ─────────────────────────────────────────

export type RunStatus = "running" | "paused" | "done";

export interface ScriptTickResult {
  readonly action: ScriptAction;
  readonly why: string;
  readonly phase: string;
  readonly stepPath: string | null;
  readonly interruptID: string | null;
  readonly status: RunStatus;
  readonly pauseReason: string | null;
  readonly memory: ScriptMemory;
}

// ─── Local sentences (R9a) ───────────────────────────────────────────────────

const SAY = {
  programDone: "The program finished, so the bot stopped.",
  livelock: "This program has nothing it can do right now, so the bot stopped.",
  stepTooLong: "A step ran for a very long time without finishing, so the bot stopped.",
  unknownMacro: "This program uses an action the bot does not know, so it stopped.",
  headingHome: "A watched warning was hit, so the bot is heading home to stop.",
} as const;

function stoppedBecause(clause: string): string {
  return `Stopped because ${clause}.`;
}

// ─── The tick ────────────────────────────────────────────────────────────────

export function decideScriptAction(
  script: BotScript,
  obs: ScriptObservation,
  mem: ScriptMemory,
  registry: MacroRegistry,
  travelHome: HomeTravelDecider,
): ScriptTickResult {
  if (mem.position.kind === "done") {
    return done(mem);
  }

  // 1. A latched "dock and stop" is flying the ship home.
  if (mem.latched !== null) {
    return continueHeadingHome(obs, mem, travelHome);
  }

  // 2. Interrupts.
  const res = resolveInterrupt(script.interrupts, obs);
  if (res.kind === "safety-override") {
    return paused(res.reason, mem, safetyFloorID(script));
  }
  if (res.kind === "fire") {
    return fireInterrupt(script, res.row.id, obs, mem, travelHome, registry, false);
  }

  // 2.5 The repair thermostat's OFF half: a repair watch whose condition has
  // RECOVERED (not-met — cannot-tell keeps repairing, blind is when you want the
  // reps most) switches its still-running repairers back off, one per tick, so
  // they stop eating capacitor once the ship is whole.
  const shutdown = repairShutdown(script, obs);
  if (shutdown !== null) {
    return {
      action: { kind: "deactivate", moduleID: shutdown.moduleID },
      why: "Repaired — switching the repairer back off.",
      phase: "Repairing",
      stepPath: shutdown.rowID,
      interruptID: shutdown.rowID,
      status: "running",
      pauseReason: null,
      memory: mem,
    };
  }

  // 3. The program, with the forward scan. `res.safetyBlind` seeds the streak.
  return runProgram(script, obs, mem, registry, res.safetyBlind);
}

/** A running repairer whose repair watch has recovered, or null. */
function repairShutdown(
  script: BotScript,
  obs: ScriptObservation,
): { readonly rowID: string; readonly moduleID: number } | null {
  const active = new Set(obs.snapshot?.ship?.activeModuleIDs ?? []);
  if (active.size === 0) {
    return null;
  }
  for (const row of script.interrupts) {
    if (row.respond !== "repair") {
      continue;
    }
    if (evaluateCondition(row.when, obs) !== "not-met") {
      continue;
    }
    const running = repairersFor(row.when.kind, obs).find((id) => active.has(id));
    if (running !== undefined) {
      return { rowID: row.id, moduleID: running };
    }
  }
  return null;
}

// ─── Interrupts ──────────────────────────────────────────────────────────────

function fireInterrupt(
  script: BotScript,
  rowID: string,
  obs: ScriptObservation,
  mem: ScriptMemory,
  travelHome: HomeTravelDecider,
  registry: MacroRegistry,
  _reentry: boolean,
): ScriptTickResult {
  const row = script.interrupts.find((r) => r.id === rowID);
  if (row === undefined) {
    return runProgram(script, obs, mem, registry, false);
  }
  switch (row.respond) {
    case "pause":
      return paused(stoppedBecause(conditionSentence(row.when)), mem, row.id);
    case "dock-and-pause": {
      const latched: Latched = { interruptID: row.id, reason: stoppedBecause(conditionSentence(row.when)) };
      return continueHeadingHome(obs, { ...mem, latched }, travelHome);
    }
    case "launch-drones": {
      if (obs.dronesOut === true) {
        // Already defended — keep working the program.
        return runProgram(script, obs, mem, registry, false);
      }
      return {
        action: { kind: "launchDrones", droneItemIDs: obs.droneBayItemIDs ?? [] },
        why: "A pirate showed up, so the drones go out to defend the ship.",
        phase: "Defending",
        stepPath: row.id,
        interruptID: row.id,
        status: "running",
        pauseReason: null,
        memory: mem,
      };
    }
    case "repair": {
      // Switch ON one idle repairer for the watched layer — unless the capacitor
      // is too low to feed it, in which case switch one OFF instead (an empty cap
      // repairs nothing and locks the ship up). One action, then the program
      // continues; the watch re-fires next tick while the condition holds.
      const reps = repairersFor(row.when.kind, obs);
      const active = new Set(obs.snapshot?.ship?.activeModuleIDs ?? []);
      const cap = obs.capacitorRatio ?? null;
      if (cap !== null && cap < REPAIR_CAP_FLOOR) {
        const running = reps.find((id) => active.has(id));
        if (running !== undefined) {
          return {
            action: { kind: "deactivate", moduleID: running },
            why: "The capacitor is nearly empty, so the repairer is switched off to let it recover.",
            phase: "Repairing",
            stepPath: row.id,
            interruptID: row.id,
            status: "running",
            pauseReason: null,
            memory: mem,
          };
        }
        return runProgram(script, obs, mem, registry, false);
      }
      const idle = reps.find((id) => !active.has(id));
      if (idle === undefined) {
        // Nothing to switch on (all running, or none fitted) — keep working.
        return runProgram(script, obs, mem, registry, false);
      }
      return {
        action: { kind: "activate", moduleID: idle, targetID: 0 },
        why: "Running the repairers.",
        phase: "Repairing",
        stepPath: row.id,
        interruptID: row.id,
        status: "running",
        pauseReason: null,
        memory: mem,
      };
    }
  }
}

/** Don't run a repairer below this — an empty capacitor repairs nothing. */
export const REPAIR_CAP_FLOOR = 0.2;

/** Which fitted repairers answer a given watch: the matching layer, or ALL for a
 * whole-ship (health-below) watch. Non-health watches repair nothing. */
function repairersFor(kind: Condition["kind"], obs: ScriptObservation): readonly number[] {
  switch (kind) {
    case "shield-below":
      return obs.shieldRepairerIDs ?? [];
    case "armor-below":
      return obs.armorRepairerIDs ?? [];
    case "hull-below":
      return obs.hullRepairerIDs ?? [];
    case "health-below":
      return [
        ...(obs.shieldRepairerIDs ?? []),
        ...(obs.armorRepairerIDs ?? []),
        ...(obs.hullRepairerIDs ?? []),
      ];
    default:
      return [];
  }
}

function continueHeadingHome(
  obs: ScriptObservation,
  mem: ScriptMemory,
  travelHome: HomeTravelDecider,
): ScriptTickResult {
  const latched = mem.latched;
  if (latched === null) {
    // Should not happen; nothing to fly. Treat as a plain pause.
    return paused(SAY.headingHome, mem, null);
  }
  const homeMem = mem.macroMem[HOME_MEM_KEY] ?? {};
  const tick = travelHome(obs, homeMem);
  const macroMem = { ...mem.macroMem, [HOME_MEM_KEY]: tick.nextMem };

  if (tick.outcome.kind === "done") {
    // Docked at home — now stop with the reason that sent us here.
    return paused(latched.reason, { ...mem, macroMem, latched: null }, latched.interruptID);
  }
  if (tick.outcome.kind === "blocked") {
    return paused(tick.outcome.reason, { ...mem, macroMem, latched: null }, latched.interruptID);
  }
  return {
    action: tick.action,
    why: tick.why,
    phase: tick.phase,
    stepPath: latched.interruptID,
    interruptID: latched.interruptID,
    status: "running",
    pauseReason: null,
    memory: { ...mem, macroMem },
  };
}

// ─── The forward scan ────────────────────────────────────────────────────────

function runProgram(
  script: BotScript,
  obs: ScriptObservation,
  mem: ScriptMemory,
  registry: MacroRegistry,
  safetyBlind: boolean,
): ScriptTickResult {
  let position = mem.position;
  let loopPass = mem.loopPass;
  let macroMem = mem.macroMem;
  let board = mem.board;
  let blindThisTick = safetyBlind;

  // A loop RE-ENTERING its own body is the only backward edge, and a single one
  // per tick is normal (the last body step finished, so we wrap to the first). A
  // SECOND wrap in one tick means a whole pass completed issuing no world call —
  // a hollow pass, the livelock. `maxHops` is a belt-and-suspenders ceiling.
  let wraps = 0;
  const maxHops = 2 * totalSteps(script) + script.program.length + 4;

  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (position.kind === "done") {
      return done({ ...mem, position, loopPass, macroMem, board });
    }

    // At the top of a loop pass, a loop-level `until` can end the loop early.
    if (position.kind === "loop" && position.body === 0) {
      const loop = script.program[position.node] as LoopBlock;
      if (loop.until !== undefined && evaluateCondition(loop.until, obs) === "met") {
        position = startOfNode(script, position.node + 1);
        loopPass = 0;
        continue;
      }
    }

    const step = activeStep(script, position);
    const decider = registry[step.macro];
    if (decider === undefined) {
      return paused(SAY.unknownMacro, { ...mem, position, loopPass, macroMem, board }, step.id);
    }

    const stepMem = macroMem[step.id] ?? {};
    const tick = decider(step, obs, stepMem, board);
    macroMem = { ...macroMem, [step.id]: tick.nextMem };
    if (tick.boardPatch !== undefined) {
      board = { ...board, ...tick.boardPatch };
    }

    if (tick.outcome.kind === "blocked") {
      return paused(tick.outcome.reason, { ...mem, position, loopPass, macroMem, board }, step.id);
    }

    if (tick.outcome.kind === "done") {
      macroMem = omit(macroMem, step.id); // leaving the step — its memory resets
      const next = advance(script, position, loopPass);
      position = next.position;
      loopPass = next.loopPass;
      if (next.wrapped) {
        wraps += 1;
        if (wraps >= 2) {
          return paused(SAY.livelock, { ...mem, position, loopPass, macroMem, board }, null);
        }
      }
      continue;
    }

    // outcome "acting" — the player's `until` can finish the step, but only once
    // the macro is ARMED (so a grid-dependent until cannot read true mid-warp).
    if (step.until !== undefined) {
      const verdict = evaluateCondition(step.until, obs);
      if (verdict === "met" && tick.armed) {
        macroMem = omit(macroMem, step.id); // leaving the step — its memory resets
        const next = advance(script, position, loopPass);
        position = next.position;
        loopPass = next.loopPass;
        if (next.wrapped) {
          wraps += 1;
          if (wraps >= 2) {
            return paused(SAY.livelock, { ...mem, position, loopPass, macroMem, board }, null);
          }
        }
        continue;
      }
      if (verdict === "cannot-tell" && tick.armed) {
        blindThisTick = true;
      }
    }

    // Issue the macro's action — the single action of this tick.
    const samePlace = positionKey(position) === positionKey(mem.position);
    const stepTicks = (samePlace ? mem.stepTicks : 0) + 1;
    if (stepTicks > MAX_STEP_TICKS) {
      return paused(SAY.stepTooLong, { ...mem, position, loopPass, macroMem, board }, step.id);
    }
    const streak = bumpCannotTellStreak(mem.cannotTellStreak, blindThisTick);
    if (cannotTellStreakExhausted(streak)) {
      return paused(COND_SENTENCE.cannotTellStreak, { ...mem, position, loopPass, macroMem, board }, step.id);
    }

    return {
      action: tick.action,
      why: tick.why,
      phase: tick.phase,
      stepPath: step.id,
      interruptID: null,
      status: "running",
      pauseReason: null,
      memory: {
        position,
        loopPass,
        stepTicks,
        cannotTellStreak: streak,
        latched: null,
        macroMem,
        board,
      },
    };
  }

  // The scan is bounded by construction; reaching here means it could not make
  // progress, which is the livelock case under another name.
  return paused(SAY.livelock, { ...mem, position, loopPass, macroMem, board }, null);
}

// ─── Position arithmetic ─────────────────────────────────────────────────────

function startOfNode(script: BotScript, node: number): Position {
  if (node >= script.program.length) {
    return { kind: "done" };
  }
  const target = script.program[node];
  return target !== undefined && target.kind === "loop"
    ? { kind: "loop", node, body: 0 }
    : { kind: "step", node };
}

interface Advance {
  readonly position: Position;
  readonly loopPass: number;
  /** True when this move was a loop re-entering its own body (the backward edge). */
  readonly wrapped: boolean;
}

/** Move forward one step, wrapping a loop body against its repeat. */
function advance(script: BotScript, position: Position, loopPass: number): Advance {
  if (position.kind === "step") {
    return { position: startOfNode(script, position.node + 1), loopPass: 0, wrapped: false };
  }
  if (position.kind === "loop") {
    const loop = script.program[position.node] as LoopBlock;
    if (position.body + 1 < loop.body.length) {
      return { position: { kind: "loop", node: position.node, body: position.body + 1 }, loopPass, wrapped: false };
    }
    // Body finished — one pass done.
    const donePasses = loopPass + 1;
    const another = loop.repeat.kind === "forever" || donePasses < loop.repeat.count;
    if (another) {
      return { position: { kind: "loop", node: position.node, body: 0 }, loopPass: donePasses, wrapped: true };
    }
    return { position: startOfNode(script, position.node + 1), loopPass: 0, wrapped: false };
  }
  return { position: { kind: "done" }, loopPass: 0, wrapped: false };
}

function activeStep(script: BotScript, position: Position): MacroStep {
  if (position.kind === "loop") {
    const loop = script.program[position.node] as LoopBlock;
    return loop.body[position.body] as MacroStep;
  }
  // position.kind === "step"
  return script.program[(position as { node: number }).node] as MacroStep;
}

function positionKey(position: Position): string {
  if (position.kind === "loop") {
    return `loop:${position.node}:${position.body}`;
  }
  if (position.kind === "step") {
    return `step:${position.node}`;
  }
  return "done";
}

function omit(
  map: Readonly<Record<string, MacroMemory>>,
  key: string,
): Readonly<Record<string, MacroMemory>> {
  if (!(key in map)) {
    return map;
  }
  const next: Record<string, MacroMemory> = {};
  for (const k of Object.keys(map)) {
    if (k !== key) {
      const value = map[k];
      if (value !== undefined) {
        next[k] = value;
      }
    }
  }
  return next;
}

function totalSteps(script: BotScript): number {
  let total = 0;
  for (const node of script.program) {
    total += node.kind === "loop" ? node.body.length : 1;
  }
  return total;
}

function safetyFloorID(script: BotScript): string | null {
  return script.interrupts.find((r) => r.builtIn === "safety-floor")?.id ?? null;
}

// ─── Result builders ─────────────────────────────────────────────────────────

function done(mem: ScriptMemory): ScriptTickResult {
  return {
    action: WAIT,
    why: SAY.programDone,
    phase: "Finished",
    stepPath: null,
    interruptID: null,
    status: "done",
    pauseReason: null,
    memory: { ...mem, position: { kind: "done" }, latched: null },
  };
}

function paused(reason: string, mem: ScriptMemory, litID: string | null): ScriptTickResult {
  return {
    action: WAIT,
    why: reason,
    phase: "Stopped",
    stepPath: litID,
    interruptID: litID,
    status: "paused",
    pauseReason: reason,
    memory: { ...mem, latched: null },
  };
}
