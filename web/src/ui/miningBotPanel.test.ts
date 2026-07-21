// R44 — the lit-up ladder, as it actually RENDERS.
//
// Screenshots have never worked for any worker on this repo and the browser
// pane does not flush async panel content, so the only honest way to say "this
// is on screen" is to render the component and read the output. That is what
// this file does, through Svelte's server generator.
//
// Four claims are load-bearing:
//
//   1. THE WHOLE LADDER IS ON SCREEN, IN ORDER. Every rung the bot can take is
//      rendered by NAME, in the order the loop tries them. The order is the
//      behaviour — danger above the hold, the hold above the rock — so a panel
//      that sorted these rows would misdescribe the bot without changing it.
//
//   2. RUNGS THAT DID NOT FIRE ARE VISIBLE, NOT HIDDEN. This is most of the
//      value: a player deciding whether to leave an unattended loop running
//      learns as much from the rules it did not reach as from the one it did.
//
//   3. EXACTLY ONE RUNG IS LIT, AND IT IS THE ONE THE LOOP REPORTED. Two lit
//      rows, or a row lit while the loop reported none, is a readout that lies
//      — which is worse than no readout, and is the R43 finding this goal was
//      told not to repeat.
//
//   4. R7d — NO RUNG IDENTIFIER REACHES THE PLAYER. The sweep at the bottom has
//      a COMPANION test proving its matcher really matches, because three
//      sweeps in this repo were once written as `\b${id}\b` inside a TEMPLATE
//      literal, where `\b` is BACKSPACE (charCode 8) and matched nothing at all.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { MINING_LADDER, MINING_RUNG_IDS } = await import("../nav/miningLadder.ts");
const MiningBot = (await import("./MiningBot.svelte")).default;

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(UI_DIR, "MiningBot.svelte"), "utf8");

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

/** Everything a player can see, with markup and comments stripped. */
function visibleText(body: string): string {
  return body
    .replace(/<img[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/** The bot running, with `rung` reporting whichever rung fired this tick. */
function scene(rung: string | null, status: "running" | "paused" = "running") {
  const store = createClientStore();
  store.apply({
    type: "bot/started",
    beltName: "Asteroid Belt I",
    stationName: "Home Station",
    startedAt: Date.now(),
  });
  store.apply({
    type: "bot/progress",
    status,
    phase: "Mining",
    action: "Switch the mining equipment on Veldspar",
    why: "Veldspar is locked, so the mining equipment goes on.",
    rung: rung as never,
    rockName: "Veldspar",
    cyclesCompleted: 1,
    oreUnitsMined: 400,
    holdUsed: 200,
    holdCapacity: 16_000,
    failureReason: null,
  });
  const output = render(MiningBot as never, {
    props: { store, flow: fakeFlow() },
  } as never);
  return { body: output.body, text: visibleText(output.body) };
}

/** The rendered rows, in document order, with whether each is lit. */
function renderedRungs(body: string): { name: string; lit: boolean }[] {
  return [...body.matchAll(/<li class="([^"]*\brung\b[^"]*)"[^>]*>([\s\S]*?)<\/li>/g)].map(
    (match) => ({
      name: visibleText(match[2] ?? "").trim(),
      lit: /\bfired\b/.test(match[1] ?? ""),
    }),
  );
}

// --- 1. The whole ladder, in the loop's own order ----------------------------

test("every rung the bot can take is on screen, by NAME", () => {
  const { text } = scene("equipment-on");
  for (const rung of MINING_LADDER) {
    assert.ok(text.includes(rung.name), `the ladder does not show: ${rung.name}`);
  }
});

test("the rows are in the ORDER THE LOOP TRIES THEM — danger, then the hold, then the rock", () => {
  // ⚠ THE ORDER IS THE BEHAVIOUR. The bot stops at the first rule that fits, so
  // a panel that re-sorted these would describe a different bot.
  const { body } = scene("equipment-on");
  const positions = MINING_LADDER.map((rung) => {
    const at = body.indexOf(rung.name);
    assert.notEqual(at, -1, `${rung.name} is not rendered at all`);
    return at;
  });
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index]! > positions[index - 1]!,
      `${MINING_LADDER[index]!.name} renders before the rung above it`,
    );
  }
});

// --- 2. What did NOT fire stays visible --------------------------------------

test("rungs that did not fire are shown NOT FIRED, never hidden", () => {
  const rows = renderedRungs(scene("hold-full").body);
  assert.equal(rows.length, MINING_LADDER.length, "some rungs were dropped from the page");
  const dark = rows.filter((row) => !row.lit);
  assert.equal(dark.length, MINING_LADDER.length - 1);
  // And each dark row SAYS it did not fire, rather than relying on styling —
  // a greyed row with no words is not readable to a screen reader.
  for (const row of dark) {
    assert.match(row.name, /not this time/, `a dark row does not say so: ${row.name}`);
  }
});

// --- 3. Exactly one lit row, and it is the reported one ----------------------

test("EXACTLY ONE rung is lit, and it is the one the loop reported", () => {
  for (const rung of MINING_LADDER) {
    const rows = renderedRungs(scene(rung.id).body);
    const lit = rows.filter((row) => row.lit);
    assert.equal(lit.length, 1, `${rung.id} lit ${lit.length} rows`);
    assert.ok(
      lit[0]!.name.includes(rung.name),
      `${rung.id} lit the wrong row: ${lit[0]!.name}`,
    );
    assert.match(lit[0]!.name, /running now/);
  }
});

test("when the loop reports NO rung, nothing is lit and the panel says why", () => {
  // A settle window, a read it is waiting on, or a paused bot: the ladder was
  // never reached. Lighting the last rung there would claim a rule ran on a
  // tick where the loop never got as far as asking one.
  const { body, text } = scene(null);
  assert.equal(renderedRungs(body).filter((row) => row.lit).length, 0);
  assert.match(text, /none of them is running/i);
  // The rows are still all there — the ladder does not vanish.
  assert.equal(renderedRungs(body).length, MINING_LADDER.length);
});

// --- The four rungs the row model could not hold cleanly ----------------------

test("a rung the row model CANNOT express says so on screen, whether or not it fired", () => {
  // ⚠ THE R44 EXPERIMENT, ON SCREEN. `noYieldCycles` counts ticks on which the
  // equipment ran AND the hold did not grow — a rule about something NOT
  // happening, over time. No single condition states it, and the panel is not
  // allowed to imply otherwise by rendering it as just another row.
  const stall = MINING_LADDER.filter((rung) => rung.fit === "unexpressible");
  assert.ok(stall.length >= 2, "the unexpressible rungs have gone missing");
  // Shown even on a tick where a completely different rung fired.
  const { text } = scene("docked-and-empty");
  for (const rung of stall) {
    assert.match(text, /more than one line can say/i);
    assert.ok(text.includes(rung.caveat!.slice(0, 40)), `${rung.id}'s caveat is not shown`);
  }
});

test("a DISTORTED rung explains its distortion when it is the one that fired", () => {
  const adopt = MINING_LADDER.find((rung) => rung.id === "rock-already-locked")!;
  const { text } = scene("rock-already-locked");
  assert.ok(text.includes(adopt.caveat!.slice(0, 40)), "the adopt shortcut's caveat is not shown");
  // And it is NOT shouted on every tick — only the rung that fired explains
  // itself, or the page becomes a wall of hedging nobody reads.
  const elsewhere = scene("docked-and-empty").text;
  assert.ok(!elsewhere.includes(adopt.caveat!.slice(0, 40)));
});

// --- 4. R7d: no identifier reaches the player --------------------------------

test("COMPANION: the id sweep's matcher really does match a string containing an id", () => {
  // ⚠ THIS TEST EXISTS BECAUSE THE SWEEP BELOW CANNOT PROVE ITSELF. Ten tests
  // in this repo have been caught passing while asserting nothing, three of
  // them id sweeps whose `\b` was a BACKSPACE character.
  for (const id of MINING_RUNG_IDS) {
    assert.ok(
      ` the rung is ${id} here `.includes(id),
      `the sweep's containment check is broken for ${id}`,
    );
  }
  // A string WITHOUT the id must not match — otherwise the sweep passes on
  // anything at all.
  assert.ok(!" the hold is full, so head home ".includes("hold-full"));
  assert.ok(!" nothing here ".includes("rock-already-locked"));
  // And the sweep's own subject is non-empty: a blank page passes every
  // "does not contain" check ever written.
  assert.ok(scene("hold-full").text.length > 400, "the panel rendered almost nothing");
});

test("no rung identifier is ever visible to the player", () => {
  for (const rung of MINING_LADDER) {
    const { text } = scene(rung.id);
    for (const id of MINING_RUNG_IDS) {
      assert.ok(!text.includes(id), `the identifier ${id} is on screen while ${rung.id} fired`);
    }
  }
});

test("no numeric id reaches the player through the readout (R7d)", () => {
  const { text } = scene("equipment-on");
  // The belt, station, rock and module are all named; nothing renders an id.
  assert.doesNotMatch(text, /\b\d{5,}\b/, "a long number reached the page");
});

// --- R8 / R9a on the new markup ----------------------------------------------

test("R8: the ladder rows are touch-sized and wrap rather than scrolling sideways", () => {
  assert.match(SOURCE, /\.rung\s*\{[^}]*min-height:\s*40px/);
  assert.match(SOURCE, /overflow-wrap:\s*anywhere/);
});

test("R8: the lit row is marked by more than colour", () => {
  // Weight, an edge, and words — a row that relied on background colour alone
  // is invisible to a colour-blind player and to a screen reader both.
  assert.match(SOURCE, /\.rung\.fired\s*\{[^}]*font-weight/);
  assert.match(SOURCE, /aria-current/);
  const lit = renderedRungs(scene("docked-and-empty").body).find((row) => row.lit)!;
  assert.match(lit.name, /running now/);
});

test("R9a: the ladder speaks player language — no code, no jargon, no line numbers", () => {
  const { text } = scene("equipment-on");
  const ladderText = text.slice(text.indexOf("The rules it follows"));
  assert.ok(ladderText.length > 200, "the ladder section did not render");
  for (const jargon of [
    "rung",
    "decideMiningAction",
    "boolean",
    "memory.",
    "null",
    "noYieldCycles",
    "OUT_OF_VIEW",
    "miningBotLoop",
  ]) {
    assert.ok(!ladderText.includes(jargon), `the ladder says "${jargon}" to a player`);
  }
});
