// Sub-bot expansion: the composition step. These pin the two properties that
// keep it safe — a cycle can never make expansion run forever, and two copies of
// the same bot can never end up sharing step ids (ids key per-step memory).

import test from "node:test";
import assert from "node:assert/strict";

import type { BotScript, ProgramNode } from "./botScript.ts";
import { countSteps } from "./botScript.ts";
import { expandSubBots, hasSubBots, subBotNames } from "./subBots.ts";

const FORMAT = { format: "evejs-bot-script", version: 1 } as const;

function bot(name: string, program: readonly ProgramNode[]): BotScript {
  return {
    ...FORMAT,
    name,
    notes: "",
    home: { entity: "station", id: null, name: null, systemName: null, starting: true },
    interrupts: [],
    program,
  };
}

const step = (id: string, macro: "undock" | "refine-ore" | "unload-cargo" = "undock"): ProgramNode => ({
  id,
  kind: "macro",
  macro,
  args: {},
});

const call = (id: string, name: string | null): ProgramNode => ({ id, kind: "sub-bot", scriptID: null, name });

function library(...bots: BotScript[]): (name: string) => BotScript | null {
  const map = new Map(bots.map((b) => [b.name.toLowerCase(), b]));
  return (name) => map.get(name.trim().toLowerCase()) ?? null;
}

test("a sub-bot's steps are spliced in where it sat, in order", () => {
  const inner = bot("Belt loop", [step("a"), step("b", "refine-ore")]);
  const outer = bot("Day", [step("first"), call("c1", "Belt loop"), step("last", "unload-cargo")]);

  const { doc, problems, expanded } = expandSubBots(outer, library(inner));
  assert.deepEqual(problems, []);
  assert.equal(expanded, true);
  assert.deepEqual(
    doc.program.map((n) => n.kind),
    ["macro", "macro", "macro", "macro"],
    "the sub-bot node is gone, replaced by its two steps",
  );
  assert.equal(countSteps(doc.program), 4);
});

test("two copies of the same bot get DIFFERENT step ids (memory is keyed by id)", () => {
  const inner = bot("Twice", [step("x")]);
  const outer = bot("Day", [call("c1", "Twice"), call("c2", "Twice")]);

  const { doc } = expandSubBots(outer, library(inner));
  const ids = doc.program.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `ids must be unique, got ${ids.join(",")}`);
});

test("a bot that includes ITSELF is refused, not expanded forever", () => {
  const selfish: BotScript = bot("Loopy", [step("a"), call("c", "Loopy")]);
  const { doc, problems } = expandSubBots(selfish, library(selfish));
  assert.equal(doc.program.length, 1, "only the real step survives");
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /including itself/i);
});

test("an INDIRECT cycle (A includes B includes A) is refused too", () => {
  const a = bot("A", [call("ca", "B")]);
  const b = bot("B", [step("s"), call("cb", "A")]);
  const { doc, problems } = expandSubBots(a, library(a, b));
  // B's own step survives; the loop back into A is cut.
  assert.equal(countSteps(doc.program), 1);
  assert.ok(problems.some((p) => /including itself/i.test(p)));
});

test("nesting deeper than the cap is refused, but everything up to it is kept", () => {
  // A -> B -> C -> D -> E. The cap is 3 INCLUSIONS, so B, C and D come in and
  // the chain is cut at E.
  const e = bot("E", [step("e")]);
  const d = bot("D", [step("d"), call("cd", "E")]);
  const c = bot("C", [step("c"), call("cc", "D")]);
  const b = bot("B", [step("b"), call("cb", "C")]);
  const a = bot("A", [step("a"), call("ca", "B")]);
  const { doc, problems } = expandSubBots(a, library(a, b, c, d, e));
  assert.ok(problems.some((p) => /nested too many/i.test(p)), problems.join(" | "));
  // a + b + c + d survive; e is cut.
  assert.equal(countSteps(doc.program), 4);
});

test("an unknown or unpicked bot is skipped with a plain reason, not a crash", () => {
  const outer = bot("Day", [step("keep"), call("c1", "Nope"), call("c2", null)]);
  const { doc, problems } = expandSubBots(outer, library());
  assert.equal(doc.program.length, 1, "the real step still runs");
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => /no saved bot called/i.test(p)));
  assert.ok(problems.some((p) => /none was picked/i.test(p)));
});

test("a bot with no sub-bots is returned untouched", () => {
  const plain = bot("Plain", [step("a"), step("b")]);
  const { doc, expanded, problems } = expandSubBots(plain, library());
  assert.equal(expanded, false);
  assert.deepEqual(problems, []);
  assert.deepStrictEqual(doc, plain, "byte-identical when there is nothing to expand");
});

test("an included bot's loops and branches come through intact, re-idded", () => {
  const inner = bot("Fancy", [
    {
      id: "L",
      kind: "loop",
      repeat: { kind: "times", count: 2 },
      body: [
        step("s") as never,
        {
          id: "br",
          kind: "branch",
          when: { kind: "hold-empty" },
          then: [step("t") as never],
          else: [step("e") as never],
        },
      ],
    },
  ]);
  const outer = bot("Day", [call("c1", "Fancy")]);
  const { doc } = expandSubBots(outer, library(inner));
  const loop = doc.program[0];
  assert.ok(loop && loop.kind === "loop");
  assert.notEqual(loop.id, "L", "the inlined loop is re-idded");
  assert.equal(loop.body[1]?.kind, "branch", "the branch inside it survives");
  assert.equal(countSteps(doc.program), 3);
});

test("hasSubBots / subBotNames report what a doc asks for", () => {
  const outer = bot("Day", [step("a"), call("c1", "Belt loop"), call("c2", "belt LOOP"), call("c3", "Other")]);
  assert.equal(hasSubBots(outer), true);
  assert.deepEqual(subBotNames(outer), ["Belt loop", "Other"], "de-duplicated, case-insensitively");
  assert.equal(hasSubBots(bot("Plain", [step("a")])), false);
});
