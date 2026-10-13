// Ammo ranking — guarding the swap gate of §5.2 of docs/fleet-companion-combat-plan.md.
//
// The tidy cases (rank by reach, then damage, then stack) are quick. The tests
// this file exists for are the ones where a swap would cost real damage:
//
//   * the FLICKER: a rat drifting x, x+1, x across a reach edge must produce
//     zero swaps over any number of ticks, from either side of the edge;
//   * a swap on a GUESS (unknown damage) while the loaded charge is hitting;
//   * a reload that outlasts the target, and a second swap a few seconds after
//     the first, or for the same target;
//   * reloading when the ship could simply have closed the range.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AMMO_RANGE_HYSTERESIS_M,
  AMMO_SWAP_COOLDOWN_MS,
  AMMO_SWAP_PERSIST_TICKS,
  FRESH_SWAP_MEMORY,
  appliedDamage,
  decideSwap,
  layerUnderFire,
  rankCharges,
  type ChargeOption,
  type Resonances,
  type SwapDecision,
  type SwapInputs,
  type SwapMemory,
} from "./ammoRanking.ts";

const NO_RESIST: Resonances = { em: 1, thermal: 1, kinetic: 1, explosive: 1 };
const H = AMMO_RANGE_HYSTERESIS_M;

/** A charge dealing `total` damage, all of it thermal unless told otherwise. */
function charge(
  typeID: number,
  over: Partial<ChargeOption> & { total?: number } = {},
): ChargeOption {
  const { total, ...rest } = over;
  return {
    itemID: typeID * 10,
    typeID,
    quantity: 100,
    reachM: 20_000,
    damage: { em: 0, thermal: total ?? 10, kinetic: 0, explosive: 0 },
    ...rest,
  };
}

/** One tick of decideSwap, ranking from `options` against the same distance. */
function tick(
  options: readonly ChargeOption[],
  loaded: ChargeOption | null,
  memory: SwapMemory,
  over: Partial<SwapInputs> & { distance?: number | null } = {},
): SwapDecision {
  const { distance, ...rest } = over;
  const d = distance === undefined ? 10_000 : distance;
  const resonances = rest.resonances === undefined ? NO_RESIST : rest.resonances;
  return decideSwap({
    ranked: rankCharges(options, d, resonances, loaded === null ? null : loaded.typeID),
    loaded,
    targetDistanceM: d,
    resonances,
    targetID: 1,
    targetRemainingHp: null,
    gunDpsWhileReloading: null,
    canClose: false,
    nextTargetMoment: false,
    nowMs: 1_000_000,
    memory,
    ...rest,
  });
}

/** Run the same situation for `n` ticks, 2 s apart; returns every decision. */
function run(
  n: number,
  options: readonly ChargeOption[],
  loaded: ChargeOption,
  over: Partial<SwapInputs> & { distance?: number | null } = {},
): SwapDecision[] {
  const out: SwapDecision[] = [];
  let memory = FRESH_SWAP_MEMORY;
  for (let i = 0; i < n; i += 1) {
    const d = tick(options, loaded, memory, { nowMs: 1_000_000 + i * 2000, ...over });
    out.push(d);
    memory = d.memory;
    if (d.kind === "swap") break;
  }
  return out;
}

// ── layerUnderFire ───────────────────────────────────────────────────────────

test("layerUnderFire: the first layer below 1, shield when all full or unknown", () => {
  assert.equal(layerUnderFire(0.5, 1, 1), "shield");
  assert.equal(layerUnderFire(0.5, 0.5, 0.5), "shield");
  assert.equal(layerUnderFire(1, 0.8, 1), "armor");
  assert.equal(layerUnderFire(1, 0.8, 0.9), "armor");
  assert.equal(layerUnderFire(1, 1, 0.9), "hull");
  assert.equal(layerUnderFire(1, 1, 1), "shield");
  assert.equal(layerUnderFire(null, null, null), "shield");
  assert.equal(layerUnderFire(null, 0.7, null), "armor");
  assert.equal(layerUnderFire(null, null, 0.7), "hull");
});

// ── appliedDamage ────────────────────────────────────────────────────────────

test("appliedDamage: damage times resonance, null when unknown", () => {
  const c: ChargeOption = {
    ...charge(1),
    damage: { em: 10, thermal: 20, kinetic: 30, explosive: 40 },
  };
  assert.equal(appliedDamage(c, NO_RESIST), 100);
  assert.equal(appliedDamage(c, { em: 0, thermal: 0.5, kinetic: 1, explosive: 0.25 }), 0 + 10 + 30 + 10);
  assert.equal(appliedDamage(c, null), 100);
  assert.equal(appliedDamage({ ...c, damage: null }, NO_RESIST), null);
});

// ── rankCharges ──────────────────────────────────────────────────────────────

test("rankCharges: in reach outranks damage, whatever the damage type", () => {
  const strongShort = charge(1, { total: 100, reachM: 5_000 });
  const weakLong = charge(2, { total: 1, reachM: 30_000 });
  const ranked = rankCharges([strongShort, weakLong], 15_000, NO_RESIST, null);
  assert.deepEqual(ranked.map((c) => c.typeID), [2, 1]);
});

test("rankCharges: among in-reach charges, higher applied damage through resists wins", () => {
  const em: ChargeOption = { ...charge(1), damage: { em: 10, thermal: 0, kinetic: 0, explosive: 0 } };
  const th: ChargeOption = { ...charge(2), damage: { em: 0, thermal: 10, kinetic: 0, explosive: 0 } };
  const emResistant: Resonances = { em: 0.2, thermal: 1, kinetic: 1, explosive: 1 };
  assert.deepEqual(rankCharges([em, th], 5_000, emResistant, null).map((c) => c.typeID), [2, 1]);
  const thResistant: Resonances = { em: 1, thermal: 0.2, kinetic: 1, explosive: 1 };
  assert.deepEqual(rankCharges([em, th], 5_000, thResistant, null).map((c) => c.typeID), [1, 2]);
});

test("rankCharges: unknown damage ranks below known; then stack size; then lower item id", () => {
  const unknown = charge(1, { damage: null, quantity: 9_999 });
  const known = charge(2, { total: 1, quantity: 1 });
  assert.deepEqual(rankCharges([unknown, known], 5_000, NO_RESIST, null).map((c) => c.typeID), [2, 1]);

  const small = charge(3, { quantity: 10 });
  const big = charge(4, { quantity: 500 });
  assert.deepEqual(rankCharges([small, big], 5_000, NO_RESIST, null).map((c) => c.typeID), [4, 3]);

  const hiId = charge(5, { itemID: 900, quantity: 50 });
  const loId = charge(6, { itemID: 100, quantity: 50 });
  assert.deepEqual(rankCharges([hiId, loId], 5_000, NO_RESIST, null).map((c) => c.itemID), [100, 900]);
});

test("rankCharges: unknown damage everywhere falls back to stack, then item id", () => {
  const a = charge(1, { damage: null, quantity: 10, itemID: 5 });
  const b = charge(2, { damage: null, quantity: 10, itemID: 3 });
  const c = charge(3, { damage: null, quantity: 20, itemID: 9 });
  assert.deepEqual(rankCharges([a, b, c], 5_000, null, null).map((x) => x.typeID), [3, 2, 1]);
});

test("rankCharges: null reach or null distance counts as in reach", () => {
  const unknownReach = charge(1, { reachM: null, total: 1 });
  const shortReach = charge(2, { reachM: 1_000, total: 100 });
  assert.deepEqual(rankCharges([shortReach, unknownReach], 50_000, NO_RESIST, null).map((c) => c.typeID), [1, 2]);
  assert.deepEqual(rankCharges([unknownReach, shortReach], null, NO_RESIST, null).map((c) => c.typeID), [2, 1]);
});

test("rankCharges: the loaded charge is sticky past its reach, another is not", () => {
  // reach 10 km, margin H (500 m; the reach/4 cap is 2.5 km and does not bite):
  // the loaded one holds to 10_000 + H, a candidate is only in reach up to 10_000 - H.
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 10_000, total: 10 });
  // Loaded A just inside its sticky edge: still in reach. Not loaded: out, so damage decides.
  assert.equal(rankCharges([b, a], 10_000 + H - 1, NO_RESIST, 1)[0]!.typeID, 1);
  assert.equal(rankCharges([b, a], 10_000 + H - 1, NO_RESIST, null).map((c) => c.typeID).join(), "1,2");
  // Loaded B inside the sticky band but past the candidate's edge: B first.
  assert.equal(rankCharges([a, b], 10_000 - H + 1, NO_RESIST, 2)[0]!.typeID, 2);
  // At the candidate's edge A is in reach too, and its damage wins.
  assert.equal(rankCharges([a, b], 10_000 - H, NO_RESIST, 2)[0]!.typeID, 1);
  // Past the sticky edge the loaded one gives way to a charge that reaches.
  const longer = charge(3, { reachM: 30_000, total: 1 });
  assert.equal(rankCharges([b, longer], 10_000 + H + 1, NO_RESIST, 2)[0]!.typeID, 3);
  assert.equal(rankCharges([b, longer], 10_000 + H, NO_RESIST, 2)[0]!.typeID, 2);
});

test("rankCharges: the margin is capped at a quarter of the reach (1500 m charge, 375 m)", () => {
  // Uncapped, a 500 m margin would put a candidate's edge at 1000 m; capped at
  // reach/4 = 375 m it is 1125 m. The loaded charge sticks to 1500 + 375 = 1875 m.
  // (Not 1200 m: that is 75 m outside the candidate edge.)
  const short = charge(1, { reachM: 1_500, total: 50 });
  const far = charge(2, { reachM: 30_000, total: 10 });
  const first = (d: number, loaded: number | null) =>
    rankCharges([far, short], d, NO_RESIST, loaded)[0]!.typeID;
  assert.equal(first(1_125, null), 1); // enters reach exactly at reach - 375
  assert.equal(first(1_126, null), 2);
  assert.equal(first(1_200, null), 2);
  assert.equal(first(1_000, null), 1);
  assert.equal(first(1_875, 1), 1); // sticky when loaded
  assert.equal(first(1_876, 1), 2);
});

test("rankCharges: a custom hysteresis is honoured", () => {
  const a = charge(1, { reachM: 10_000 });
  const b = charge(2, { reachM: 10_000, total: 50 });
  // hysteresis 0: loaded a at 10.5 km is out; b (not loaded) also out.
  assert.equal(rankCharges([a, b], 9_500, NO_RESIST, 1, 0)[0]!.typeID, 2);
  assert.equal(rankCharges([a, b], 9_500, NO_RESIST, 1, 1_000)[0]!.typeID, 1);
});

// ── decideSwap: the empty gun ────────────────────────────────────────────────

test("empty gun loads the top-ranked charge and does not stamp a swap", () => {
  const a = charge(1, { total: 5 });
  const b = charge(2, { total: 50 });
  const d = tick([a, b], null, { ...FRESH_SWAP_MEMORY, lastSwapAtMs: 123, swappedForTargetID: 9 });
  assert.equal(d.kind, "load");
  assert.equal(d.kind === "load" && d.charge.typeID, 2);
  assert.equal(d.memory.lastSwapAtMs, 123);
  assert.equal(d.memory.swappedForTargetID, 9);
  assert.equal(d.memory.wantedTicks, 0);
});

test("empty gun loads immediately even inside the cooldown and on the same target", () => {
  const a = charge(1);
  const d = tick([a], null, { wantedTypeID: null, wantedTicks: 0, lastSwapAtMs: 999_999, swappedForTargetID: 1 });
  assert.equal(d.kind, "load");
});

test("empty gun with nothing compatible keeps, and says so", () => {
  const d = tick([], null, FRESH_SWAP_MEMORY);
  assert.equal(d.kind, "keep");
  assert.equal(d.why, "nothing compatible aboard");
});

// ── decideSwap: nothing to change ────────────────────────────────────────────

test("a single ammo type never swaps, however long it runs", () => {
  const a = charge(1);
  const results = run(40, [a], a);
  assert.equal(results.length, 40);
  assert.ok(results.every((d) => d.kind === "keep"));
  assert.equal(results[0]!.why, "only one ammo type aboard");
});

test("ranked top is the loaded type: keep, and the persistence count restarts", () => {
  const a = charge(1, { total: 50 });
  const b = charge(2, { total: 10 });
  const d = tick([a, b], a, { wantedTypeID: 2, wantedTicks: 4, lastSwapAtMs: null, swappedForTargetID: null });
  assert.equal(d.kind, "keep");
  assert.equal(d.memory.wantedTypeID, null);
  assert.equal(d.memory.wantedTicks, 0);
});

test("loaded charge missing from the ranked list: a clearly better one still has to earn it", () => {
  const loaded = charge(1, { total: 10 });
  const better = charge(2, { total: 50 });
  const d = tick([better], loaded, FRESH_SWAP_MEMORY);
  assert.equal(d.kind, "keep");
  assert.equal(d.memory.wantedTicks, 1);
});

// ── decideSwap: the flicker ──────────────────────────────────────────────────

test("FLICKER: a distance wobbling across the loaded charge's edge produces zero swaps over 20 ticks", () => {
  // Loaded A (strong, short): reach 10 km, sticky to 10 km + H. B reaches far.
  // The distance goes edge, edge+1, edge, edge+1 ... the ranking flips every
  // tick (A in reach, then not), and a naive ranker would reload each time.
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  let memory = FRESH_SWAP_MEMORY;
  let swaps = 0;
  const edge = 10_000 + H;
  for (let i = 0; i < 20; i += 1) {
    const d = tick([a, b], a, memory, { distance: edge + (i % 2), nowMs: 1_000_000 + i * 2000 });
    if (d.kind === "swap") swaps += 1;
    memory = d.memory;
  }
  assert.equal(swaps, 0);
  assert.equal(memory.lastSwapAtMs, null);
});

test("FLICKER: the same wobble with the ship unable to close and a hot loop of 200 ticks", () => {
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  let memory = FRESH_SWAP_MEMORY;
  for (let i = 0; i < 200; i += 1) {
    const d = tick([a, b], a, memory, { distance: 10_000 + H + (i % 2), canClose: false, nowMs: 1_000_000 + i * 2000 });
    assert.notEqual(d.kind, "swap");
    memory = d.memory;
  }
});

test("FLICKER: a wobble across the CANDIDATE's entry edge never swaps either", () => {
  // Loaded B (weak, long). Candidate A (strong, 10 km reach) is only "in
  // reach" up to 10 km - H as a candidate. Distance flips either side of that, so A enters
  // and leaves the in-reach set every tick; it is a big gain when it is in.
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  let memory = FRESH_SWAP_MEMORY;
  let swaps = 0;
  for (let i = 0; i < 20; i += 1) {
    const d = tick([a, b], b, memory, { distance: 10_000 - H + (i % 2), nowMs: 1_000_000 + i * 2000 });
    if (d.kind === "swap") swaps += 1;
    memory = d.memory;
  }
  assert.equal(swaps, 0);
});

test("persistence resets when the verdict flips back to the loaded charge", () => {
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  let memory = FRESH_SWAP_MEMORY;
  // four ticks out of the sticky range, then one back inside: the count restarts.
  const out = 10_000 + H + 1_000;
  const inside = 10_000 + H - 100;
  for (let i = 0; i < 4; i += 1) {
    const d = tick([a, b], a, memory, { distance: out });
    assert.equal(d.kind, "keep");
    memory = d.memory;
  }
  assert.equal(memory.wantedTicks, 4);
  const back = tick([a, b], a, memory, { distance: inside });
  assert.equal(back.kind, "keep");
  assert.equal(back.memory.wantedTicks, 0);
  const again = tick([a, b], a, back.memory, { distance: out });
  assert.equal(again.kind, "keep");
  assert.equal(again.memory.wantedTicks, 1);
});

test("persistence resets when the wanted charge changes between two candidates", () => {
  const loaded = charge(1, { reachM: 5_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  const c = charge(3, { reachM: 30_000, total: 20 });
  const first = tick([loaded, b], loaded, FRESH_SWAP_MEMORY, { distance: 20_000 });
  assert.equal(first.memory.wantedTypeID, 2);
  const second = tick([loaded, b, c], loaded, first.memory, { distance: 20_000 });
  assert.equal(second.memory.wantedTypeID, 3);
  assert.equal(second.memory.wantedTicks, 1);
});

// ── decideSwap: out of reach ─────────────────────────────────────────────────

test("out of reach and the ship can close: keep, closing instead of reloading", () => {
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  const results = run(30, [a, b], a, { distance: 20_000, canClose: true });
  assert.equal(results.length, 30);
  assert.ok(results.every((d) => d.kind === "keep"));
  assert.equal(results[29]!.why, "closing in instead of reloading");
});

test("out of reach and the ship cannot close: swap on the fifth tick, not before", () => {
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 10 });
  const results = run(20, [a, b], a, { distance: 20_000, canClose: false });
  assert.equal(results.length, AMMO_SWAP_PERSIST_TICKS);
  assert.ok(results.slice(0, -1).every((d) => d.kind === "keep"));
  const last = results[results.length - 1]!;
  assert.equal(last.kind, "swap");
  assert.equal(last.kind === "swap" && last.charge.typeID, 2);
  assert.equal(last.memory.lastSwapAtMs, 1_000_000 + (AMMO_SWAP_PERSIST_TICKS - 1) * 2000);
  assert.equal(last.memory.swappedForTargetID, 1);
  assert.equal(last.memory.wantedTicks, 0);
});

test("out of reach but nothing aboard reaches either: keep", () => {
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 12_000, total: 10 });
  const results = run(20, [a, b], a, { distance: 30_000, canClose: false });
  assert.equal(results.length, 20);
  assert.ok(results.every((d) => d.kind === "keep"));
});

test("out of reach swap ignores damage gain and remaining HP", () => {
  // The longer charge does LESS damage, and the target has little HP left:
  // neither matters, because the loaded charge applies nothing at all.
  const a = charge(1, { reachM: 10_000, total: 50 });
  const b = charge(2, { reachM: 30_000, total: 1 });
  const results = run(10, [a, b], a, {
    distance: 20_000,
    canClose: false,
    targetRemainingHp: 10,
    gunDpsWhileReloading: 1_000,
  });
  assert.equal(results[results.length - 1]!.kind, "swap");
});

test("out of reach with unknown damage on both sides still swaps (it is about reach)", () => {
  const a = charge(1, { reachM: 10_000, damage: null });
  const b = charge(2, { reachM: 30_000, damage: null });
  const results = run(10, [a, b], a, { distance: 20_000, canClose: false });
  assert.equal(results[results.length - 1]!.kind, "swap");
});

// ── decideSwap: loaded charge applying ───────────────────────────────────────

test("a small damage gain (under 25 percent) never swaps", () => {
  const a = charge(1, { total: 100 });
  const b = charge(2, { total: 120 });
  const results = run(40, [a, b], a);
  assert.equal(results.length, 40);
  assert.ok(results.every((d) => d.kind === "keep"));
});

test("exactly 25 percent more applied damage is enough, after persistence", () => {
  const a = charge(1, { total: 100 });
  const b = charge(2, { total: 125 });
  const results = run(10, [a, b], a);
  assert.equal(results.length, AMMO_SWAP_PERSIST_TICKS);
  assert.equal(results[results.length - 1]!.kind, "swap");
});

test("a big gain swaps on the fifth tick and no earlier", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const results = run(20, [a, b], a);
  assert.equal(results.length, 5);
  assert.deepEqual(results.map((d) => d.kind), ["keep", "keep", "keep", "keep", "swap"]);
  assert.deepEqual(results.map((d) => d.memory.wantedTicks).slice(0, 4), [1, 2, 3, 4]);
});

test("the gain is judged through resists, not raw damage", () => {
  const em: ChargeOption = { ...charge(1), damage: { em: 100, thermal: 0, kinetic: 0, explosive: 0 } };
  const th: ChargeOption = { ...charge(2), damage: { em: 0, thermal: 60, kinetic: 0, explosive: 0 } };
  // Raw: em is better. Against an em-hard layer thermal is far better.
  const hard: Resonances = { em: 0.1, thermal: 1, kinetic: 1, explosive: 1 };
  assert.equal(run(10, [em, th], em, { resonances: NO_RESIST }).length, 10);
  const results = run(10, [em, th], em, { resonances: hard });
  assert.equal(results[results.length - 1]!.kind, "swap");
});

test("a better charge that would not itself reach the target is not swapped to", () => {
  // Loaded A reaches (sticky), B is stronger but only in reach as a
  // non-sticky candidate up to 10_000 - H; just past that B is not a valid destination.
  const a = charge(1, { reachM: 10_000, total: 10 });
  const b = charge(2, { reachM: 10_000, total: 100 });
  const results = run(20, [a, b], a, { distance: 10_000 - H + 100 });
  assert.equal(results.length, 20);
  assert.ok(results.every((d) => d.kind === "keep"));
});

test("unknown damage on either side never swaps while the loaded charge is hitting", () => {
  const known = charge(1, { total: 1 });
  const unknown = charge(2, { damage: null });
  // Loaded known, candidate unknown: the unknown ranks last, nothing to swap to.
  assert.ok(run(30, [known, unknown], known).every((d) => d.kind === "keep"));
  // Loaded unknown, candidate known and strong: still a guess about the loaded one.
  const results = run(30, [known, unknown], unknown);
  assert.equal(results.length, 30);
  assert.ok(results.every((d) => d.kind === "keep"));
  // Both unknown.
  const u1 = charge(3, { damage: null, quantity: 5 });
  const u2 = charge(4, { damage: null, quantity: 500 });
  assert.ok(run(30, [u1, u2], u1).every((d) => d.kind === "keep"));
});

test("remaining HP below the reload's lost damage keeps the loaded charge", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const dying = run(20, [a, b], a, { targetRemainingHp: 500, gunDpsWhileReloading: 800 });
  assert.equal(dying.length, 20);
  assert.ok(dying.every((d) => d.kind === "keep"));
  const equal = run(20, [a, b], a, { targetRemainingHp: 800, gunDpsWhileReloading: 800 });
  assert.ok(equal.every((d) => d.kind === "keep"));
  // Lots of HP left: swap.
  const healthy = run(20, [a, b], a, { targetRemainingHp: 5_000, gunDpsWhileReloading: 800 });
  assert.equal(healthy[healthy.length - 1]!.kind, "swap");
});

test("unknown remaining HP or unknown reload loss does not block a swap", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const noHp = run(20, [a, b], a, { targetRemainingHp: null, gunDpsWhileReloading: 800 });
  assert.equal(noHp[noHp.length - 1]!.kind, "swap");
  const noDps = run(20, [a, b], a, { targetRemainingHp: 1, gunDpsWhileReloading: null });
  assert.equal(noDps[noDps.length - 1]!.kind, "swap");
});

// ── decideSwap: cooldown and one-per-target ──────────────────────────────────

test("cooldown blocks a second swap within 60 s, and allows it afterwards (new target)", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const justSwapped: SwapMemory = {
    wantedTypeID: null,
    wantedTicks: 0,
    lastSwapAtMs: 1_000_000,
    swappedForTargetID: 7,
  };
  let memory = justSwapped;
  // ten more ticks, all within the cooldown, for a different target.
  for (let i = 0; i < 10; i += 1) {
    const d = tick([a, b], a, memory, { targetID: 8, nowMs: 1_000_000 + 2000 * (i + 1) });
    assert.equal(d.kind, "keep", `tick ${i}`);
    memory = d.memory;
  }
  assert.ok(memory.wantedTicks >= AMMO_SWAP_PERSIST_TICKS);
  const early = tick([a, b], a, memory, { targetID: 8, nowMs: 1_000_000 + AMMO_SWAP_COOLDOWN_MS - 1 });
  assert.equal(early.kind, "keep");
  const later = tick([a, b], a, early.memory, { targetID: 8, nowMs: 1_000_000 + AMMO_SWAP_COOLDOWN_MS });
  assert.equal(later.kind, "swap");
});

test("at most one swap per target, even after the cooldown", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  let memory: SwapMemory = {
    wantedTypeID: 2,
    wantedTicks: 50,
    lastSwapAtMs: 0,
    swappedForTargetID: 5,
  };
  const same = tick([a, b], a, memory, { targetID: 5, nowMs: 10 * AMMO_SWAP_COOLDOWN_MS });
  assert.equal(same.kind, "keep");
  memory = same.memory;
  const other = tick([a, b], a, memory, { targetID: 6, nowMs: 10 * AMMO_SWAP_COOLDOWN_MS });
  assert.equal(other.kind, "swap");
  assert.equal(other.memory.swappedForTargetID, 6);
});

// ── decideSwap: the lock-ahead moment ────────────────────────────────────────

test("nextTargetMoment swaps on the first tick: no persistence", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const d = tick([a, b], a, FRESH_SWAP_MEMORY, { nextTargetMoment: true, targetID: 2 });
  assert.equal(d.kind, "swap");
  assert.equal(d.memory.swappedForTargetID, 2);
});

test("nextTargetMoment ignores the cooldown and the one-swap-per-target limit", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const d = tick([a, b], a, { wantedTypeID: null, wantedTicks: 0, lastSwapAtMs: 999_000, swappedForTargetID: 2 }, {
    nextTargetMoment: true,
    targetID: 2,
    nowMs: 1_000_000,
  });
  assert.equal(d.kind, "swap");
});

test("nextTargetMoment ignores the remaining-HP test (the current target is dying anyway)", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  const d = tick([a, b], a, FRESH_SWAP_MEMORY, {
    nextTargetMoment: true,
    targetRemainingHp: 5,
    gunDpsWhileReloading: 800,
  });
  assert.equal(d.kind, "swap");
});

test("nextTargetMoment still needs a real gain, and still respects closing in", () => {
  const a = charge(1, { total: 100 });
  const b = charge(2, { total: 110 });
  assert.equal(tick([a, b], a, FRESH_SWAP_MEMORY, { nextTargetMoment: true }).kind, "keep");
  const far = charge(3, { reachM: 30_000, total: 1 });
  const near = charge(4, { reachM: 10_000, total: 50 });
  assert.equal(
    tick([near, far], near, FRESH_SWAP_MEMORY, { nextTargetMoment: true, distance: 20_000, canClose: true }).kind,
    "keep",
  );
  assert.equal(
    tick([near, far], near, FRESH_SWAP_MEMORY, { nextTargetMoment: true, distance: 20_000, canClose: false }).kind,
    "swap",
  );
});

test("nextTargetMoment with unknown damage still never swaps while the loaded charge reaches", () => {
  const a = charge(1, { damage: null });
  const b = charge(2, { total: 100 });
  assert.equal(tick([a, b], a, FRESH_SWAP_MEMORY, { nextTargetMoment: true }).kind, "keep");
});

// ── why strings and memory hygiene ───────────────────────────────────────────

test("every decision carries a non-empty, plain-ASCII why", () => {
  const a = charge(1, { reachM: 10_000, total: 10 });
  const b = charge(2, { reachM: 30_000, total: 100 });
  const decisions: SwapDecision[] = [
    tick([], null, FRESH_SWAP_MEMORY),
    tick([a], null, FRESH_SWAP_MEMORY),
    tick([a], a, FRESH_SWAP_MEMORY),
    tick([a, b], a, FRESH_SWAP_MEMORY, { distance: 5_000 }),
    tick([a, b], b, FRESH_SWAP_MEMORY, { distance: 5_000 }),
    tick([a, b], a, FRESH_SWAP_MEMORY, { distance: 20_000, canClose: true }),
    tick([a, b], a, FRESH_SWAP_MEMORY, { distance: 20_000, canClose: false }),
    tick([a, b], a, { ...FRESH_SWAP_MEMORY, wantedTypeID: 2, wantedTicks: 9 }, { distance: 20_000 }),
    tick([a, b], a, FRESH_SWAP_MEMORY, { nextTargetMoment: true, distance: 5_000 }),
    tick([a, b], a, { wantedTypeID: 2, wantedTicks: 9, lastSwapAtMs: 999_999, swappedForTargetID: null }, { distance: 20_000 }),
    tick([a, b], a, { wantedTypeID: 2, wantedTicks: 9, lastSwapAtMs: null, swappedForTargetID: 1 }, { distance: 20_000 }),
    tick([a, b], a, { wantedTypeID: 2, wantedTicks: 9, lastSwapAtMs: null, swappedForTargetID: null }, { distance: 5_000, targetRemainingHp: 1, gunDpsWhileReloading: 9 }),
  ];
  for (const d of decisions) {
    assert.ok(d.why.length > 0);
    assert.match(d.why, /^[\x20-\x7e]+$/);
  }
  assert.ok(decisions.some((d) => d.kind === "swap"));
  assert.ok(decisions.some((d) => d.kind === "load"));
});

test("memory survives a JSON round trip", () => {
  const a = charge(1, { total: 10 });
  const b = charge(2, { total: 100 });
  let memory = FRESH_SWAP_MEMORY;
  for (let i = 0; i < 3; i += 1) {
    const d = tick([a, b], a, memory);
    memory = JSON.parse(JSON.stringify(d.memory)) as SwapMemory;
  }
  assert.equal(memory.wantedTicks, 3);
  assert.equal(tick([a, b], a, memory).memory.wantedTicks, 4);
});
