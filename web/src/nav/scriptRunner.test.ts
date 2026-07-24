// B2 — the runner controller, driven with fake deps so the lifecycle is tested
// without a live ship: settle ticks, pause/stop staleness, session-loss unwind,
// the read-failure give-up, and a clean finish.

import test from "node:test";
import assert from "node:assert/strict";

import type { BotScript, MacroStep, ProgramNode } from "../bots/botScript.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import type { HomeTravelDecider, MacroDecider, MacroTick, ScriptAction } from "./scriptDecide.ts";
import {
  MAX_READ_FAILURES,
  SETTLE_TICKS,
  createScriptRunner,
  type ScriptRunnerSnapshot,
} from "./scriptRunner.ts";

class SessionLost extends Error {}

function calm(over: Partial<ScriptObservation> = {}): ScriptObservation {
  return {
    inSpace: true, docked: false, inWarp: false,
    shieldRatio: 1, armorRatio: 1, hullRatio: 1, health: 1,
    oreHoldFraction: 0, holdEmpty: true, hostileOnGrid: false, dronesOut: false,
    ...over,
  };
}

function mt(action: ScriptAction, outcome: MacroTick["outcome"]): MacroTick {
  return { action, why: "why", phase: "phase", armed: true, outcome, nextMem: {} };
}

const undock: MacroDecider = (_s, o) =>
  o.inSpace ? mt({ kind: "wait" }, { kind: "done" }) : mt({ kind: "undock" }, { kind: "acting" });
const deliver: MacroDecider = (_s, o) =>
  o.holdEmpty ? mt({ kind: "wait" }, { kind: "done" }) : mt({ kind: "unloadOre", itemIDs: [1] }, { kind: "acting" });
const home: HomeTravelDecider = (o) =>
  o.docked ? mt({ kind: "wait" }, { kind: "done" }) : mt({ kind: "warp", targetID: 9 }, { kind: "acting" });

const registry = { undock, "deliver-ore": deliver };

function macroStep(id: string, macro: MacroStep["macro"]): MacroStep {
  return { id, kind: "macro", macro, args: {} };
}
function script(program: readonly ProgramNode[]): BotScript {
  return {
    format: "evejs-bot-script", version: 1, name: "t", notes: "",
    home: { entity: "station", id: 1, name: "Home", systemName: null },
    interrupts: [{ id: "floor", builtIn: "safety-floor", when: { kind: "health-below", fraction: 0.5 }, respond: "dock-and-pause" }],
    program,
  };
}

interface Harness {
  observeThrows?: () => never;
}

function harness(opts: Harness = {}) {
  const issued: ScriptAction[] = [];
  const progress: ScriptRunnerSnapshot[] = [];
  let obs = calm();
  const runner = createScriptRunner({
    observe: async () => {
      if (opts.observeThrows) {
        opts.observeThrows();
      }
      return obs;
    },
    issue: async (a) => {
      issued.push(a);
    },
    sleep: async () => {},
    onProgress: (s) => progress.push(s),
    isSessionLost: (e) => e instanceof SessionLost,
    registry,
    travelHome: home,
  });
  return { runner, issued, progress, setObs: (o: ScriptObservation) => { obs = o; } };
}

test("issues the first action, then settles before deciding again", async () => {
  const h = harness();
  h.setObs(calm({ inSpace: false, holdEmpty: false }));
  h.runner.start(script([macroStep("a", "undock"), macroStep("b", "deliver-ore")]));

  await h.runner.tick(); // undock
  assert.deepEqual(h.issued.map((a) => a.kind), ["undock"]);

  // The next SETTLE_TICKS ticks issue nothing.
  for (let i = 0; i < SETTLE_TICKS; i += 1) {
    await h.runner.tick();
  }
  assert.equal(h.issued.length, 1, "no world call during the settle window");

  // Undock has now landed; the next decision advances to deliver.
  h.setObs(calm({ inSpace: true, holdEmpty: false }));
  await h.runner.tick();
  assert.deepEqual(h.issued.map((a) => a.kind), ["undock", "unloadOre"]);
});

test("pause stops the loop and blocks further ticks", async () => {
  const h = harness();
  h.setObs(calm({ inSpace: false, holdEmpty: false }));
  h.runner.start(script([macroStep("a", "undock")]));
  await h.runner.tick();
  const before = h.issued.length;

  h.runner.pause();
  assert.equal(h.runner.getStatus(), "paused");
  await h.runner.tick(); // must do nothing
  assert.equal(h.issued.length, before);
});

test("a lost session ends the run in error", async () => {
  const h = harness({ observeThrows: () => { throw new SessionLost("gone"); } });
  h.runner.start(script([macroStep("a", "undock")]));
  await h.runner.tick();
  assert.equal(h.runner.getStatus(), "error");
  assert.equal(h.progress.at(-1)?.status, "error");
});

test("repeated read failures give up with a plain reason", async () => {
  let fail = true;
  const issued: ScriptAction[] = [];
  const progress: ScriptRunnerSnapshot[] = [];
  const runner = createScriptRunner({
    observe: async () => {
      if (fail) {
        throw new Error("read failed"); // not a session loss
      }
      return calm();
    },
    issue: async (a) => { issued.push(a); },
    sleep: async () => {},
    onProgress: (s) => progress.push(s),
    isSessionLost: (e) => e instanceof SessionLost,
    registry,
    travelHome: home,
  });
  runner.start(script([macroStep("a", "undock")]));
  for (let i = 0; i < MAX_READ_FAILURES; i += 1) {
    await runner.tick();
  }
  assert.equal(runner.getStatus(), "paused");
  assert.match(progress.at(-1)?.pauseReason ?? "", /several tries/i);
});

test("run() drives to a clean finish and stops", async () => {
  const h = harness();
  h.setObs(calm({ inSpace: true })); // undock already satisfied -> program done at once
  h.runner.start(script([macroStep("a", "undock")]));
  await h.runner.run();
  assert.equal(h.runner.getStatus(), "stopped");
  assert.equal(h.progress.at(-1)?.status, "stopped");
});
