// C2 — the editor's draft validator. A complete draft has no problems; each way
// of being incomplete produces one plain sentence anchored to the right row.

import test from "node:test";
import assert from "node:assert/strict";

import type { BotScript, MacroStep, ProgramNode } from "./botScript.ts";
import { validateScript, type ScriptProblem } from "./validateScript.ts";

// A complete, ready-to-start draft: a loop of [mine until full, haul], with the
// safety floor and a bound home.
function ready(): BotScript {
  return {
    format: "evejs-bot-script", version: 1, name: "Belt runner", notes: "",
    home: { entity: "station", id: 60000004, name: "Home", systemName: "Aunia" },
    interrupts: [{ id: "floor", builtIn: "safety-floor", when: { kind: "health-below", fraction: 0.5 }, respond: "dock-and-pause" }],
    program: [
      {
        id: "L", kind: "loop", repeat: { kind: "times", count: 50 },
        body: [
          {
            id: "m", kind: "macro", macro: "mine-at-belt",
            args: {
              belt: { kind: "belt", belt: { mode: "nearest" } },
              equipment: { kind: "equipment", equipment: { groupID: 17482, label: "Strip Miners" } },
            },
            until: { kind: "ore-hold-at-least", fraction: 0.9 },
          },
          {
            id: "h", kind: "macro", macro: "deliver-ore",
            args: { station: { kind: "station", ref: { entity: "station", id: 60000004, name: "Home", systemName: "Aunia" } } },
          },
        ],
      },
    ],
  };
}

function paths(problems: readonly ScriptProblem[]): string[] {
  return problems.map((p) => p.path);
}

test("a complete draft has no problems", () => {
  assert.deepEqual(validateScript(ready()), []);
});

test("a blank name and unbound home are each flagged", () => {
  const draft = { ...ready(), name: "  ", home: { entity: "station" as const, id: null, name: null, systemName: null } };
  assert.deepEqual(paths(validateScript(draft)).sort(), ["home", "name"]);
});

test("an empty program is flagged", () => {
  const draft = { ...ready(), program: [] };
  assert.ok(validateScript(draft).some((p) => p.path === "program"));
});

test("a mining step without equipment is fine — the bot auto-uses fitted miners", () => {
  const draft = ready();
  const loop = draft.program[0];
  assert.ok(loop && loop.kind === "loop");
  const mine = loop.body[0] as MacroStep;
  const stripped = { ...mine, args: { belt: mine.args["belt"] } } as MacroStep;
  const withStripped: BotScript = {
    ...draft,
    program: [{ ...loop, body: [stripped, loop.body[1] as MacroStep] }],
  };
  assert.deepEqual(validateScript(withStripped), [], "equipment is optional now");
});

test("a mining step with no until is flagged", () => {
  const draft = ready();
  const loop = draft.program[0];
  assert.ok(loop && loop.kind === "loop");
  const mine = loop.body[0] as MacroStep;
  const noUntil: MacroStep = { id: mine.id, kind: "macro", macro: "mine-at-belt", args: mine.args };
  const draft2: BotScript = { ...draft, program: [{ ...loop, body: [noUntil, loop.body[1] as MacroStep] }] };
  assert.ok(validateScript(draft2).some((p) => p.path === "m" && /stop it/i.test(p.sentence)));
});

test("a chosen belt with no id asks the player to pick, but nearest does not", () => {
  const draft = ready();
  const loop = draft.program[0];
  assert.ok(loop && loop.kind === "loop");
  const mine = loop.body[0] as MacroStep;
  const unbound: MacroStep = {
    ...mine,
    args: { ...mine.args, belt: { kind: "belt", belt: { mode: "chosen", ref: { entity: "belt", id: null, name: null, systemName: null } } } },
  };
  const draft2: BotScript = { ...draft, program: [{ ...loop, body: [unbound, loop.body[1] as MacroStep] }] };
  assert.ok(validateScript(draft2).some((p) => p.path === "m" && /pick a belt/i.test(p.sentence)));
});

test("an out-of-range threshold is flagged", () => {
  const draft = ready();
  const loop = draft.program[0];
  assert.ok(loop && loop.kind === "loop");
  const mine = loop.body[0] as MacroStep;
  const tooFull: MacroStep = { ...mine, until: { kind: "ore-hold-at-least", fraction: 0.99 } };
  const draft2: BotScript = { ...draft, program: [{ ...loop, body: [tooFull, loop.body[1] as MacroStep] }] };
  assert.ok(validateScript(draft2).some((p) => p.path === "m" && /between/i.test(p.sentence)));
});

test("a deliver step with an unbound station is flagged", () => {
  const draft = ready();
  const loop = draft.program[0];
  assert.ok(loop && loop.kind === "loop");
  const haul = loop.body[1] as MacroStep;
  const unbound: MacroStep = { ...haul, args: { station: { kind: "station", ref: { entity: "station", id: null, name: null, systemName: null } } } };
  const draft2: BotScript = { ...draft, program: [{ ...loop, body: [loop.body[0] as MacroStep, unbound] }] };
  assert.ok(validateScript(draft2).some((p) => p.path === "h" && /pick the station/i.test(p.sentence)));
});
