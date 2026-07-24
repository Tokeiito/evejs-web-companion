// A4b — the orchestrator. These drive the scan with FAKE macros so the safety
// properties are tested in isolation from real world calls: sequencing, loop
// counting with per-pass memory reset, the arming guard on `until` (the
// belt-empty class), the livelock guard, the cannot-tell streak, the step-tick
// cap, and every interrupt response.

import test from "node:test";
import assert from "node:assert/strict";

import type { BotScript, InterruptRow, MacroStep, ProgramNode } from "../bots/botScript.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import {
  MAX_STEP_TICKS,
  decideScriptAction,
  initialMemory,
  type HomeTravelDecider,
  type MacroDecider,
  type MacroMemory,
  type MacroTick,
  type ScriptMemory,
} from "./scriptDecide.ts";
import { MAX_CANNOT_TELL_STREAK } from "./scriptConditions.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function obs(over: Partial<ScriptObservation> = {}): ScriptObservation {
  return {
    inSpace: true, docked: false, inWarp: false,
    shieldRatio: 1, armorRatio: 1, hullRatio: 1, health: 1,
    oreHoldFraction: 0, holdEmpty: true, hostileOnGrid: false, dronesOut: false,
    ...over,
  };
}

const floor: InterruptRow = {
  id: "floor", builtIn: "safety-floor",
  when: { kind: "health-below", fraction: 0.5 }, respond: "dock-and-pause",
};

function tick(action: MacroTick["action"], outcome: MacroTick["outcome"], armed = true, nextMem: MacroMemory = {}): MacroTick {
  return { action, why: "why", phase: "phase", armed, outcome, nextMem };
}

// Undock: done once in space, else issues undock.
const undock: MacroDecider = (_s, o) =>
  o.inSpace ? tick({ kind: "wait" }, { kind: "done" }) : tick({ kind: "undock" }, { kind: "acting" });

// Deliver: done once the hold is empty, else unloads.
const deliver: MacroDecider = (_s, o) =>
  o.holdEmpty ? tick({ kind: "wait" }, { kind: "done" }) : tick({ kind: "unloadOre", itemIDs: [1] }, { kind: "acting" });

// Mine: always acting and armed; the step's `until` decides when it is finished.
const mine: MacroDecider = () => tick({ kind: "activate", moduleID: 1, targetID: 2 }, { kind: "acting" }, true);

// Home travel: docked at home => done, else warps.
const home: HomeTravelDecider = (o) =>
  o.docked ? tick({ kind: "wait" }, { kind: "done" }) : tick({ kind: "warp", targetID: 9 }, { kind: "acting" });

function macroStep(id: string, macro: MacroStep["macro"], until?: MacroStep["until"]): MacroStep {
  const base = {
    id, kind: "macro" as const, macro,
    args: {
      belt: { kind: "belt" as const, belt: { mode: "nearest" as const } },
      station: { kind: "station" as const, ref: { entity: "station" as const, id: 1, name: "H", systemName: null } },
      equipment: { kind: "equipment" as const, equipment: { groupID: 1, label: "x" } },
    },
  };
  return until === undefined ? base : { ...base, until };
}

function script(program: readonly ProgramNode[], interrupts: readonly InterruptRow[] = [floor]): BotScript {
  return {
    format: "evejs-bot-script", version: 1, name: "t", notes: "",
    home: { entity: "station", id: 1, name: "Home", systemName: null },
    interrupts, program,
  };
}

const registry = { undock, "deliver-ore": deliver, "mine-at-belt": mine, "travel-to-station": undock };

// Drive the runner across a sequence of observations, stopping when it leaves "running".
function run(s: BotScript, seq: readonly ScriptObservation[]): { results: ReturnType<typeof decideScriptAction>[]; mem: ScriptMemory } {
  let mem = initialMemory(s);
  const results: ReturnType<typeof decideScriptAction>[] = [];
  for (const o of seq) {
    const r = decideScriptAction(s, o, mem, registry, home);
    results.push(r);
    mem = r.memory;
    if (r.status !== "running") break;
  }
  return { results, mem };
}

// ─── Sequencing ──────────────────────────────────────────────────────────────

test("a two-step program runs in order and then finishes", () => {
  const s = script([macroStep("a", "undock"), macroStep("b", "deliver-ore")]);
  const { results } = run(s, [
    obs({ inSpace: false, holdEmpty: false }), // undock acts
    obs({ inSpace: true, holdEmpty: false }),  // undock done -> deliver acts
    obs({ inSpace: true, holdEmpty: true }),   // deliver done -> program done
  ]);
  assert.equal(results[0]?.action.kind, "undock");
  assert.equal(results[0]?.stepPath, "a");
  assert.equal(results[1]?.action.kind, "unloadOre");
  assert.equal(results[1]?.stepPath, "b");
  assert.equal(results[2]?.status, "done");
});

// ─── Loops ───────────────────────────────────────────────────────────────────

test("a times-2 loop runs its body twice and stops, memory resetting each pass", () => {
  // Body: mine (until ore full), then deliver (done when empty).
  const loop: ProgramNode = {
    id: "L", kind: "loop", repeat: { kind: "times", count: 2 },
    body: [macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 }), macroStep("h", "deliver-ore")],
  };
  const s = script([loop]);
  // A realistic fill/haul cycle, consistent obs (empty <=> fraction 0).
  const { results } = run(s, [
    obs({ oreHoldFraction: 0.4, holdEmpty: false }), // pass1 mine
    obs({ oreHoldFraction: 0.95, holdEmpty: false }),// pass1 mine done -> haul acts
    obs({ oreHoldFraction: 0, holdEmpty: true }),    // pass1 haul done -> wrap -> pass2 mine acts
    obs({ oreHoldFraction: 0.95, holdEmpty: false }),// pass2 mine done -> haul acts
    obs({ oreHoldFraction: 0, holdEmpty: true }),    // pass2 haul done -> count reached -> program done
  ]);
  assert.equal(results[0]?.stepPath, "m");
  assert.equal(results[2]?.stepPath, "m", "pass 2 mines again after the wrap");
  assert.equal(results.at(-1)?.status, "done");
});

test("a loop whose body can never do anything pauses on the livelock guard", () => {
  // Body is a single undock, but the ship is already in space, so every pass
  // completes instantly issuing no world call.
  const loop: ProgramNode = { id: "L", kind: "loop", repeat: { kind: "forever" }, body: [macroStep("u", "undock")] };
  const s = script([loop]);
  const r = decideScriptAction(s, obs({ inSpace: true }), initialMemory(s), registry, home);
  assert.equal(r.status, "paused");
  assert.match(r.pauseReason ?? "", /nothing it can do/i);
});

// ─── Arming (the belt-empty guard) ───────────────────────────────────────────

test("an until does not advance the step while the macro is unarmed", () => {
  // mineUnarmed reports armed=false (as if still in warp); even with the ore
  // hold reading full, the step must not be treated as finished.
  const mineUnarmed: MacroDecider = () => tick({ kind: "activate", moduleID: 1, targetID: 2 }, { kind: "acting" }, false);
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 }), macroStep("b", "deliver-ore")]);
  const r = decideScriptAction(s, obs({ oreHoldFraction: 0.99 }), initialMemory(s), { ...registry, "mine-at-belt": mineUnarmed }, home);
  assert.equal(r.stepPath, "m", "still on the mine step");
  assert.equal(r.action.kind, "activate");
});

// ─── Interrupts ──────────────────────────────────────────────────────────────

test("a plain-pause interrupt stops with the condition as its reason", () => {
  const shields: InterruptRow = { id: "s", when: { kind: "shield-below", fraction: 0.3 }, respond: "pause" };
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 })], [floor, shields]);
  const r = decideScriptAction(s, obs({ shieldRatio: 0.2 }), initialMemory(s), registry, home);
  assert.equal(r.status, "paused");
  assert.equal(r.interruptID, "s");
  assert.match(r.pauseReason ?? "", /shields/i);
});

test("a dock-and-pause interrupt flies home and then stops", () => {
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 })]);
  // Health below the floor fires the safety floor (dock-and-pause).
  const start = initialMemory(s);
  const flying = decideScriptAction(s, obs({ health: 0.2, docked: false }), start, registry, home);
  assert.equal(flying.status, "running");
  assert.equal(flying.action.kind, "warp", "heading home");
  assert.equal(flying.interruptID, "floor");
  // Next tick, now docked at home: it stops.
  const stopped = decideScriptAction(s, obs({ health: 0.2, docked: true }), flying.memory, registry, home);
  assert.equal(stopped.status, "paused");
});

test("a launch-drones interrupt launches once, then yields to the step when drones are out", () => {
  const drones: InterruptRow = { id: "d", when: { kind: "hostile-on-grid" }, respond: "launch-drones" };
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 })], [floor, drones]);
  const launching = decideScriptAction(s, obs({ hostileOnGrid: true, dronesOut: false }), initialMemory(s), registry, home);
  assert.equal(launching.action.kind, "launchDrones");
  assert.equal(launching.interruptID, "d");
  // Drones now out: the interrupt is satisfied and the step keeps working.
  const working = decideScriptAction(s, obs({ hostileOnGrid: true, dronesOut: true }), launching.memory, registry, home);
  assert.equal(working.action.kind, "activate");
  assert.equal(working.stepPath, "m");
});

// ─── Bounds: cannot-tell streak and the step-tick cap ────────────────────────

test("an unreadable until pauses after the cannot-tell streak runs out", () => {
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 })]);
  let mem = initialMemory(s);
  let last = decideScriptAction(s, obs({ oreHoldFraction: null }), mem, registry, home);
  for (let i = 0; i < MAX_CANNOT_TELL_STREAK + 2 && last.status === "running"; i += 1) {
    mem = last.memory;
    last = decideScriptAction(s, obs({ oreHoldFraction: null }), mem, registry, home);
  }
  assert.equal(last.status, "paused");
  assert.match(last.pauseReason ?? "", /could not read/i);
});

test("a step that never finishes trips the step-tick cap", () => {
  // mine always acts, its until never met: it should eventually pause on the cap.
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 })]);
  let mem = initialMemory(s);
  let last = decideScriptAction(s, obs({ oreHoldFraction: 0 }), mem, registry, home);
  for (let i = 0; i < MAX_STEP_TICKS + 5 && last.status === "running"; i += 1) {
    mem = last.memory;
    last = decideScriptAction(s, obs({ oreHoldFraction: 0 }), mem, registry, home);
  }
  assert.equal(last.status, "paused");
  assert.match(last.pauseReason ?? "", /very long time/i);
});

// ─── A blocked macro ─────────────────────────────────────────────────────────

test("a blocked macro pauses with the macro's own reason", () => {
  const stuck: MacroDecider = () => tick({ kind: "wait" }, { kind: "blocked", reason: "There are no rocks left here." });
  const s = script([macroStep("m", "mine-at-belt", { kind: "ore-hold-at-least", fraction: 0.9 })]);
  const r = decideScriptAction(s, obs(), initialMemory(s), { ...registry, "mine-at-belt": stuck }, home);
  assert.equal(r.status, "paused");
  assert.match(r.pauseReason ?? "", /no rocks left/i);
});
