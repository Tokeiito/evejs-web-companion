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
//   3. EXACTLY THE ROWS THE LOOP NAMED ARE LIT, AND NO OTHERS. R44 wrote this
//      claim as "exactly ONE row", and that was the bug R46 fixed: some rules
//      hand their work to a shared sub-ladder, and with one slot to report in,
//      the caller's row REPLACED the step's. On the tick where the ship would
//      not say which modules were cycling, the bot switched nothing on and the
//      single lit row read "…go straight to the equipment" — the page asserting
//      an action that had not happened, which is worse than no readout at all.
//      So: one lit row when the loop named only a rule, TWO when the rule called
//      a step, and never a row the loop did not name.
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
const { MINING_LADDER, MINING_RUNG_IDS, MINING_STEP_IDS } = await import("../nav/miningLadder.ts");
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

/**
 * The bot running, with `rung` reporting the rule that fired this tick and
 * `step` the leaf inside it (R46) — null when the rule answered on its own.
 */
function scene(
  rung: string | null,
  step: string | null = null,
  status: "running" | "paused" = "running",
) {
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
    step: step as never,
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

test("a rule reported on its own lights EXACTLY ONE row, and it is that rule", () => {
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

test("R46: a rule that CALLED A STEP lights BOTH rows — the caller and what it did", () => {
  // ⚠ THIS IS THE PAIR R44 COULD NOT SHOW. The adopt shortcut borrows its move
  // from the equipment steps, and R44 had one slot to report in, so the step
  // stayed dark on the very tick that ran it.
  const rows = renderedRungs(scene("rock-already-locked", "equipment-on").body);
  const lit = rows.filter((row) => row.lit);
  assert.equal(lit.length, 2, `expected the caller and the step, got ${lit.length} rows`);

  const caller = MINING_LADDER.find((row) => row.id === "rock-already-locked")!;
  const leaf = MINING_LADDER.find((row) => row.id === "equipment-on")!;
  assert.ok(
    lit.some((row) => row.name.includes(caller.name)),
    "the rule that fired is not lit",
  );
  assert.ok(
    lit.some((row) => row.name.includes(leaf.name)),
    "the step it took is not lit",
  );
  // Both say so in words, not only in styling (R8).
  for (const row of lit) {
    assert.match(row.name, /running now/);
  }
  // And the ladder did not shrink or light anything else.
  assert.equal(rows.length, MINING_LADDER.length);
});

test("R46: THE PAGE CANNOT CLAIM THE EQUIPMENT WENT ON WHEN IT DID NOT", () => {
  // ⚠ THE DEFECT, AS THE PLAYER WOULD HAVE READ IT. On an adopt tick where the
  // ship does not report its active modules, the bot switches NOTHING on. R44
  // lit only "…skip the lock and go straight to the equipment" — a page stating
  // an action that had not been taken. Now the step that actually answered is
  // lit beside it, and it says what really happened.
  const { body } = scene("rock-already-locked", "equipment-unknown");
  const lit = renderedRungs(body).filter((row) => row.lit);
  const litText = lit.map((row) => row.name).join(" · ");

  assert.equal(lit.length, 2, `expected two lit rows, got: ${litText}`);
  assert.match(
    litText,
    /nothing was switched on/i,
    `no lit row admits that nothing was switched on: ${litText}`,
  );
  // The row that would have been a lie on its own is still shown — the fix adds
  // the truth beside it rather than hiding the shortcut.
  assert.match(litText, /already locked/i);

  // A DIFFERENT tick — the equipment really going on — must NOT say that, or
  // the assertion above would pass on any page at all.
  const on = renderedRungs(scene("rock-already-locked", "equipment-on").body)
    .filter((row) => row.lit)
    .map((row) => row.name)
    .join(" · ");
  assert.doesNotMatch(on, /nothing was switched on this time.*running now/is);
});

test("R46: a step the loop did NOT name stays dark", () => {
  // The complement of the test above: lighting a whole sub-ladder because one
  // of its leaves ran would be the same lie in the other direction.
  const rows = renderedRungs(scene("rock-is-locked", "mining-running").body);
  const litNames = rows.filter((row) => row.lit).map((row) => row.name).join(" · ");
  for (const dark of ["equipment-unknown", "equipment-on"] as const) {
    const row = MINING_LADDER.find((entry) => entry.id === dark)!;
    assert.ok(!litNames.includes(row.name), `${dark} lit without being reported`);
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

test("R46: no STEP identifier reaches the player either, on a tick that lights two rows", () => {
  // R7d applies to the new field exactly as it does to the old one. Swept on
  // ticks where BOTH are set, because that is the only shape in which a `step`
  // id could reach the page at all.
  // Each step paired with a rule that really does call it, so these are ticks
  // the loop can actually produce rather than invented combinations.
  const callerOf: Record<string, string> = {
    "equipment-unknown": "rock-is-locked",
    "equipment-on": "rock-is-locked",
    "mining-running": "rock-is-locked",
    "belt-empty": "travel-to-belt",
  };
  for (const step of MINING_STEP_IDS) {
    const { body, text } = scene(callerOf[step]!, step);
    for (const id of MINING_RUNG_IDS) {
      assert.ok(!text.includes(id), `the identifier ${id} is on screen while step ${step} ran`);
    }
    // The subject is non-empty and the step really did light its own row, so
    // this is not a "does not contain" check passing on a blank page.
    assert.ok(text.length > 400, "the panel rendered almost nothing");
    const leaf = MINING_LADDER.find((row) => row.id === step)!;
    assert.ok(
      renderedRungs(body).some((row) => row.lit && row.name.includes(leaf.name)),
      `${step} did not light its own row, so the sweep proved nothing`,
    );
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
