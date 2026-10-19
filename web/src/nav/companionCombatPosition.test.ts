// Rung 8 on its own: `decideCombatPosition` called directly, with the ladder's
// helpers stubbed, so each test pins one thing the rung decides -- the hold it
// asks for, when it re-sends, the closing budget, the leash, and the way back to
// formation. The ladder's half (chat verbs, wrapper latches, the controller's
// settling, the burner) is end to end in fleetCompanionLoop.test.ts.

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPANION_RESEND_WAIT_TICKS,
  COMPANION_RETRY_BACKOFF_TICKS,
  freshLadderMemory,
  type CompanionDecision,
  type CompanionLadderMemory,
  type FleetCompanionObservation,
} from "./fleetCompanionLoop.ts";
import {
  MAX_COMPANION_POSITION_REFUSALS,
  closingOnTheHold,
  decideCombatPosition,
  gunsInReach,
  gunsInReachWords,
  settleCombatHold,
  withoutCombatHold,
  type CombatPositionLadder,
  type CombatPositionStep,
} from "./companionCombatPosition.ts";
import { MAX_CLOSE_TICKS } from "./combatPosition.ts";
import { measureSpace } from "./autopilotLoop.ts";
import {
  FIGHT_COMMANDER,
  FIGHT_FC_SHIP,
  FIGHT_FOLLOW_M,
  FIGHT_GUN_1,
  FIGHT_GUN_2,
  FIGHT_NO_THREAT,
  LONG_GUNS,
  LONG_RAT,
  RAT,
  RAT_2,
  SHORT_GUNS,
  TWO_GUNS,
  TYPE_LONG_RAT,
  TYPE_SHORT_RAT,
  TYPE_UNREAD_RAT,
  fightGrid,
  fightObs,
  flyingAuto,
  gun,
  ratAt,
} from "./fightFixtures.test-util.ts";
import type { SpaceEntity } from "../store/types.ts";

/** Rung 7's standing decision on `targetID`: locked, guns running or holding. */
function engagedOn(targetID: number = RAT): CompanionDecision {
  return {
    action: { kind: "wait" },
    phase: "Obeying fleet",
    why: "Shooting the called target.",
    memory: freshLadderMemory(),
    standing: true,
    engagedTargetID: targetID,
    followingOrderFrom: "tag",
    lastOrderHeard: "a target tag",
  };
}

/** The formation order rung 9 would send, stamped as it stamps it. */
function formationOrder(memory: CompanionLadderMemory, status: "pending" | "issued" = "pending"): CompanionDecision {
  return {
    action: { kind: "keepAtRange", targetID: FIGHT_FC_SHIP, range: FIGHT_FOLLOW_M },
    phase: "Following",
    why: "Holding station on the fleet commander.",
    memory: {
      ...memory, followAnchorID: FIGHT_FC_SHIP, followRangeIssuedM: FIGHT_FOLLOW_M,
      followOrder: { targetID: FIGHT_FC_SHIP, range: FIGHT_FOLLOW_M, status, refusals: 0, deferrals: 0, deferralWait: false },
    },
  };
}

/**
 * The ladder's helpers, stubbed. The commander is whichever ship on the grid
 * carries FIGHT_COMMANDER (so `fightGrid({ fcAt: null })` takes it away), and
 * rung 9 answers with `follow` -- by default "already holding station".
 */
function stubLadder(
  follow: (obs: FleetCompanionObservation, memory: CompanionLadderMemory) => CompanionDecision | null =
    (_obs, memory) => ({ action: { kind: "wait" }, phase: "Following", why: "Holding station.", memory }),
  hasCombatDrones = false,
): CombatPositionLadder & { readonly calls: () => number } {
  let calls = 0;
  return {
    follow: (obs, memory) => {
      calls += 1;
      return follow(obs, memory);
    },
    commanderShip: (obs): SpaceEntity | null =>
      obs.snapshot?.entities.find((entity) => entity.characterID === FIGHT_COMMANDER) ?? null,
    hasCombatDrones: () => hasCombatDrones,
    metresBetween: (a, b) => Math.hypot(
      (a.position?.x ?? 0) - (b.position?.x ?? 0),
      (a.position?.y ?? 0) - (b.position?.y ?? 0),
      (a.position?.z ?? 0) - (b.position?.z ?? 0),
    ),
    limits: {
      maxRefusals: MAX_COMPANION_POSITION_REFUSALS,
      maxDeferrals: 30,
      backoffTicks: COMPANION_RETRY_BACKOFF_TICKS,
      resendWaitTicks: COMPANION_RESEND_WAIT_TICKS,
    },
    calls: () => calls,
  };
}

function position(
  obs: FleetCompanionObservation,
  memory: CompanionLadderMemory,
  ladder: CombatPositionLadder = stubLadder(),
  engaged: CompanionDecision | null = engagedOn(),
): CombatPositionStep {
  return decideCombatPosition(TWO_GUNS, obs, engaged, memory, ladder);
}

/** The order a step sends, or null for a readout or a fall-through. */
function sent(step: CombatPositionStep): CompanionDecision["action"] | null {
  return step.decision === null || step.decision.standing === true ? null : step.decision.action;
}

// ─── Where to hold ───────────────────────────────────────────────────────────

test("gun boat in reach of the rats: orbit the target at the shortest gun's optimal", () => {
  const step = position(fightObs(SHORT_GUNS), flyingAuto());
  assert.deepEqual(sent(step), { kind: "orbit", targetID: RAT, range: 8_000 });
  assert.match(step.decision!.why, /orbiting the target at 8 km/i);
  assert.equal(step.decision!.holdsNavigation, true);
  assert.equal(step.decision!.followingOrderFrom, "tag", "the readout keeps rung 7's authority");
});

test("gun boat out-ranging every rat: keep at range outside their guns (kiting)", () => {
  const step = position(fightObs(LONG_GUNS, ratAt(50_000, TYPE_SHORT_RAT)), flyingAuto());
  // The rats reach 10 km, plus the 5 km buffer.
  assert.deepEqual(sent(step), { kind: "keepAtRange", targetID: RAT, range: 15_000 });
  assert.match(step.decision!.why, /out-range everything/i);
});

test("one unread hostile on grid makes the grid unknown: orbit, never kite", () => {
  const grid = fightGrid({ rats: [
    { itemID: RAT, typeID: TYPE_SHORT_RAT, x: 50_000 }, { itemID: RAT_2, typeID: TYPE_UNREAD_RAT, x: 60_000 },
  ] });
  const step = position(fightObs(LONG_GUNS, grid), flyingAuto());
  assert.deepEqual(sent(step), { kind: "orbit", targetID: RAT, range: 30_000 });
});

test("a scrammer on grid raises the floor through kiteBand's threat rows", () => {
  const observation = fightObs(SHORT_GUNS, fightGrid(), RAT, {
    threatByTypeID: { [TYPE_LONG_RAT]: { ...FIGHT_NO_THREAT, scram: true, scramRangeM: 10_000 } },
  });
  // The 8 km optimal is inside the 10 km scram plus the 5 km buffer.
  assert.deepEqual(sent(position(observation, flyingAuto())), { kind: "orbit", targetID: RAT, range: 15_000 });
});

test("drone boat: keep at range on the target at the drone band's hold", () => {
  const observation = fightObs(null, fightGrid(), RAT, { droneControlRangeM: 40_000 });
  const step = decideCombatPosition(
    { ...TWO_GUNS, weaponModuleIDs: [] }, observation, engagedOn(), flyingAuto(), stubLadder(undefined, true),
  );
  // Nothing scrams, so the band holds at its ceiling: min(40 km drone leash, 60 km lock) - 3 km.
  assert.deepEqual(sent(step), { kind: "keepAtRange", targetID: RAT, range: 37_000 });
});

test("a gun boat with no known reach is not positioned; if our orbit stood, formation is owed", () => {
  const blind = [gun(FIGHT_GUN_1, null, null), gun(FIGHT_GUN_2, null, null)];
  const fresh = position(fightObs(blind), flyingAuto());
  assert.equal(fresh.decision, null);
  assert.equal(fresh.memory.combatPosition.reform, false, "nothing of ours to undo");

  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const ladder = stubLadder((_obs, memory) => formationOrder(memory));
  const blinded = position(fightObs(blind), orbiting.memory, ladder);
  assert.deepEqual(sent(blinded), { kind: "keepAtRange", targetID: FIGHT_FC_SHIP, range: FIGHT_FOLLOW_M });
  assert.equal(blinded.memory.combatPosition.hold, null);
  assert.equal(blinded.memory.combatPosition.reform, true);
});

// ─── When to send ────────────────────────────────────────────────────────────

test("the order is not re-sent inside the hysteresis, and is when the hold moves or the target changes", () => {
  const first = position(fightObs(SHORT_GUNS), flyingAuto());
  assert.deepEqual(sent(first), { kind: "orbit", targetID: RAT, range: 8_000 });

  // The shortest gun's optimal moves 1.5 km: inside the 2 km hysteresis, so no re-aim.
  const wobble = position(fightObs([SHORT_GUNS[0]!, gun(FIGHT_GUN_2, 10_000, 9_500)]), first.memory);
  assert.equal(sent(wobble), null);
  assert.equal(wobble.decision?.standing, true);
  assert.equal(wobble.decision?.holdsNavigation, true);

  // 2.5 km: a real move.
  const moved = position(fightObs([SHORT_GUNS[0]!, gun(FIGHT_GUN_2, 12_000, 10_500)]), wobble.memory);
  assert.deepEqual(sent(moved), { kind: "orbit", targetID: RAT, range: 10_500 });

  // A new target is a new anchor, whatever the range.
  const grid = fightGrid({ rats: [
    { itemID: RAT, typeID: TYPE_LONG_RAT, x: 30_000 }, { itemID: RAT_2, typeID: TYPE_LONG_RAT, x: 31_000 },
  ] });
  const retarget = position(
    fightObs([SHORT_GUNS[0]!, gun(FIGHT_GUN_2, 12_000, 10_500)], grid, RAT_2), moved.memory, stubLadder(), engagedOn(RAT_2),
  );
  assert.deepEqual(sent(retarget), { kind: "orbit", targetID: RAT_2, range: 10_500 });
});

test("a refused order counts, and three refusals back off before it is sent again", () => {
  let memory = flyingAuto();
  const orders: number[] = [];
  for (let tick = 0; tick < 3 + COMPANION_RETRY_BACKOFF_TICKS + 1; tick += 1) {
    const step = position(fightObs(SHORT_GUNS), memory);
    memory = step.memory;
    if (sent(step) !== null) {
      orders.push(tick);
      memory = settleCombatHold(step.decision!, memory, "refused");
    }
  }
  assert.deepEqual(orders, [0, 1, 2, 3 + COMPANION_RETRY_BACKOFF_TICKS]);
});

test("settling touches only rung 8's own pending record", () => {
  const step = position(fightObs(SHORT_GUNS), flyingAuto());
  const issued = settleCombatHold(step.decision!, step.memory, "issued");
  assert.equal(issued.combatPosition.hold?.status, "issued");
  // A record replaced since (the wrapper dropped it, or a newer order) is not settled.
  const replaced = withoutCombatHold(step.memory);
  assert.equal(settleCombatHold(step.decision!, replaced, "issued"), replaced);
});

// ─── The closing budget ──────────────────────────────────────────────────────

test("closing budget: after MAX_CLOSE_TICKS far ticks in a row, the hold becomes the distance then", () => {
  let memory = flyingAuto();
  const moves: { readonly tick: number; readonly action: unknown; readonly why: string }[] = [];
  let lastWhy = "";
  for (let tick = 0; tick <= MAX_CLOSE_TICKS + 1; tick += 1) {
    // The ship never gets closer: the rat holds 30 km whatever we do.
    const step = position(fightObs(SHORT_GUNS), memory);
    memory = step.memory;
    lastWhy = step.decision?.why ?? "";
    if (sent(step) !== null) moves.push({ tick, action: sent(step), why: step.decision!.why });
  }
  assert.equal(moves.length, 2, JSON.stringify(moves));
  assert.deepEqual(moves[0]!.action, { kind: "orbit", targetID: RAT, range: 8_000 });
  assert.equal(moves[1]!.tick, MAX_CLOSE_TICKS);
  assert.deepEqual(moves[1]!.action, { kind: "orbit", targetID: RAT, range: 30_000 });
  assert.match(moves[1]!.why, /could not close in/i);
  assert.match(lastWhy, /in position/i);
});

test("closing budget counts CONSECUTIVE far ticks: a tick in position starts it again", () => {
  let memory = flyingAuto();
  const tick = (x: number): CombatPositionStep => {
    const step = position(fightObs(SHORT_GUNS, ratAt(x)), memory);
    memory = step.memory;
    return step;
  };
  for (let n = 0; n < MAX_CLOSE_TICKS - 5; n += 1) tick(30_000);
  assert.equal(tick(8_000).memory.combatPosition.target?.farTicks, 0, "in position resets it");
  for (let n = 0; n < MAX_CLOSE_TICKS - 5; n += 1) {
    assert.equal(sent(tick(30_000)), null, `far tick ${n} after the reset`);
  }
  assert.equal(memory.combatPosition.target?.spentAtM, null, "never spent: no run was long enough");
});

test("a frozen hold does not follow the rat's drift, and goes when the ship is back in position", () => {
  let memory = flyingAuto();
  const tick = (x: number): CombatPositionStep => {
    const step = position(fightObs(SHORT_GUNS, ratAt(x)), memory);
    memory = step.memory;
    return step;
  };
  for (let n = 0; n <= MAX_CLOSE_TICKS; n += 1) tick(30_000);
  assert.equal(memory.combatPosition.target?.spentAtM, 30_000);
  // Drifts past the 2 km re-aim hysteresis either way: the hold is the frozen 30 km.
  for (const x of [33_000, 27_000, 33_500]) {
    assert.equal(sent(tick(x)), null, `at ${x}`);
    assert.equal(memory.combatPosition.hold?.rangeM, 30_000);
  }
  // The rat comes in to the 8 km the guns wanted: the frozen hold is dropped.
  assert.deepEqual(sent(tick(8_000)), { kind: "orbit", targetID: RAT, range: 8_000 });
  assert.equal(memory.combatPosition.target?.spentAtM, null);
});

test("the closing flag: set while far from the hold, clear in position, and only in flight auto", () => {
  const far = position(fightObs(SHORT_GUNS), flyingAuto());
  assert.equal(far.memory.combatPosition.target?.closing, true);
  assert.equal(closingOnTheHold(far.memory), true);
  const there = position(fightObs(SHORT_GUNS, ratAt(8_000)), far.memory);
  assert.equal(there.memory.combatPosition.target?.closing, false);
  assert.equal(closingOnTheHold(there.memory), false);
  assert.equal(closingOnTheHold({ ...far.memory, flightMode: "follow" }), false);
  // Any movement rung 8 did not send ends the attempt, and the burner's reason with it.
  assert.equal(closingOnTheHold(withoutCombatHold(far.memory)), false);
});

// ─── The leash ───────────────────────────────────────────────────────────────

test("leash: a target wobbling across the edge does not alternate orbit and formation", () => {
  // The FC at -5 km, lock range 60 km: the leash edge is the rat at 55 km, and it
  // comes back only inside 58 km apart, the rat at 53 km.
  const ladder = stubLadder();
  let memory = flyingAuto();
  const orders: unknown[] = [];
  for (const x of [56_000, 54_000, 55_500, 54_000, 56_000, 54_500]) {
    const step = position(fightObs(LONG_GUNS, ratAt(x)), memory, ladder);
    memory = step.memory;
    if (sent(step) !== null) orders.push(sent(step));
  }
  assert.deepEqual(orders, []);
  assert.equal(memory.combatPosition.target?.leashed, true);
  assert.ok(ladder.calls() > 0, "past the leash rung 9 is asked, so formation holds");
  const back = position(fightObs(LONG_GUNS, ratAt(52_000)), memory, ladder);
  assert.deepEqual(sent(back), { kind: "keepAtRange", targetID: RAT, range: 35_000 });
  assert.equal(back.memory.combatPosition.target?.leashed, false);
});

test("the leash survives a movement rung 8 did not send; the budget does not", () => {
  const leashed = position(fightObs(LONG_GUNS, ratAt(56_000)), flyingAuto());
  assert.equal(withoutCombatHold(leashed.memory).combatPosition.target?.leashed, true);
});

// ─── Back to formation ───────────────────────────────────────────────────────

test("`flight follow` with our orbit standing: rung 9 is asked every tick until formation is confirmed", () => {
  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  let answer: "send" | "pending" | "confirmed" | "nothing" = "send";
  const ladder = stubLadder((_obs, memory) =>
    answer === "nothing" ? null
      : answer === "send" ? formationOrder(memory)
        : { ...formationOrder(memory, answer === "confirmed" ? "issued" : "pending"), action: { kind: "wait" } });
  let memory: CompanionLadderMemory = { ...orbiting.memory, flightMode: "follow" };
  const tick = (): CombatPositionStep => {
    const step = position(fightObs(SHORT_GUNS), memory, ladder);
    memory = step.memory;
    return step;
  };

  const first = tick();
  assert.deepEqual(sent(first), { kind: "keepAtRange", targetID: FIGHT_FC_SHIP, range: FIGHT_FOLLOW_M });
  assert.match(first.decision!.why, /flight follow: holding station on the commander/i);
  assert.equal(first.trace.outcome, "reform");
  assert.equal(memory.combatPosition.hold, null);
  assert.equal(memory.combatPosition.reform, true);
  // Refused: rung 9's own retry sends it again, and it is asked again.
  assert.equal(sent(tick())?.kind, "keepAtRange");
  // A tick on which rung 9 has nothing to say does not drop the debt.
  answer = "nothing";
  assert.equal(tick().decision, null);
  assert.equal(memory.combatPosition.reform, true);
  // Sent but not yet taken: still owed.
  answer = "pending";
  assert.equal(tick().decision, null);
  assert.equal(memory.combatPosition.reform, true);
  // Taken: confirmed, and rung 9 is not asked again.
  answer = "confirmed";
  tick();
  assert.equal(memory.combatPosition.reform, false);
  const asked = ladder.calls();
  tick();
  assert.equal(ladder.calls(), asked, "follow mode with nothing owed leaves formation to rung 9");
});

test("formation owed with no commander on grid: one stopShip, then the debt is dropped", () => {
  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const ladder = stubLadder();
  const noCommander = fightObs(SHORT_GUNS, fightGrid({ fcAt: null }));
  const stopped = position(noCommander, { ...orbiting.memory, flightMode: "follow" }, ladder);
  assert.deepEqual(sent(stopped), { kind: "stopShip" });
  assert.equal(stopped.decision?.followingOrderFrom, "tag");
  assert.equal(stopped.memory.combatPosition.reform, false);
  const after = position(noCommander, stopped.memory, ladder);
  assert.equal(after.decision, null);
  assert.equal(ladder.calls(), 0);
});

test("a `stop` holds the rung: nothing is positioned and no formation is owed", () => {
  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const ladder = stubLadder((_obs, memory) => formationOrder(memory));
  const held = position(fightObs(SHORT_GUNS, ratAt(40_000)), { ...orbiting.memory, followHeld: true }, ladder);
  assert.equal(held.decision, null);
  assert.equal(held.memory.combatPosition.reform, false);
  assert.equal(held.memory.combatPosition.target?.closing, false, "and the burner's reason goes");
  assert.equal(ladder.calls(), 0);
});

test("the fight ending drops everything rung 8 remembers", () => {
  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const owed = { ...orbiting.memory, combatPosition: { ...orbiting.memory.combatPosition, reform: true } };
  const ended = position(fightObs(SHORT_GUNS), owed, stubLadder(), null);
  assert.equal(ended.decision, null);
  assert.deepEqual(ended.memory.combatPosition, { hold: null, target: null, reform: false });
});

// ─── Rung 7's range gate ─────────────────────────────────────────────────────

test("the range gate reads the measurement it is handed, never the snapshot again", () => {
  const observation = fightObs(SHORT_GUNS, ratAt(15_000));
  const measured = measureSpace(observation.snapshot ?? null);
  const gate = gunsInReach(RAT, TWO_GUNS, observation, freshLadderMemory(), measured);
  assert.deepEqual(gate.inReach, [FIGHT_GUN_1]);
  // The same snapshot with a measurement that puts the rat at 5 km: both reach.
  const closer = { ...measured!, distances: new Map([[RAT, 5_000]]) };
  assert.deepEqual(gunsInReach(RAT, TWO_GUNS, observation, freshLadderMemory(), closer).inReach,
    [FIGHT_GUN_1, FIGHT_GUN_2]);
  // No measurement: unknown distance, which fails open.
  assert.deepEqual(gunsInReach(RAT, TWO_GUNS, observation, freshLadderMemory(), null).inReach,
    [FIGHT_GUN_1, FIGHT_GUN_2]);
});

test("the gate's words say how much of the rack reaches", () => {
  assert.equal(gunsInReachWords(0, 2), " Locked, but none of my guns reach it from here.");
  assert.equal(gunsInReachWords(1, 2), " Locked, and firing on it: 1 of 2 guns in reach.");
  assert.equal(gunsInReachWords(2, 2), " Locked, and firing on it.");
});

// ─── The decision trace: one outcome code per return path ────────────────────

/** The step's memory, with the order it sent (if any) settled as issued. */
function settle(step: CombatPositionStep): CompanionLadderMemory {
  return step.decision !== null && step.decision.standing !== true
    ? settleCombatHold(step.decision, step.memory, "issued")
    : step.memory;
}

test("trace: no target engaged is `no-target`, with nothing read", () => {
  const step = position(fightObs(SHORT_GUNS), flyingAuto(), stubLadder(), null);
  assert.equal(step.trace.outcome, "no-target");
  assert.equal(step.trace.mode, "auto");
  assert.equal(step.trace.targetID, null);
  assert.equal(step.trace.distanceM, null);
  assert.equal(step.trace.latch, null);
});

test("trace: a chat `stop` is `stopped`, and a fleet order that holds navigation is `holds-navigation`", () => {
  const stopped = position(fightObs(SHORT_GUNS), flyingAuto({ followHeld: true }));
  assert.equal(stopped.trace.outcome, "stopped");
  assert.equal(stopped.trace.targetID, RAT);
  const held = position(fightObs(SHORT_GUNS), flyingAuto(), stubLadder(), { ...engagedOn(), holdsNavigation: true });
  assert.equal(held.trace.outcome, "holds-navigation");
  assert.equal(held.decision, null);
});

test("trace: `flight follow` with nothing owed is `mode-follow`; owing our orbit's undoing is `reform`", () => {
  const idle = position(fightObs(SHORT_GUNS), freshLadderMemory());
  assert.equal(idle.decision, null);
  assert.equal(idle.trace.outcome, "mode-follow");
  assert.equal(idle.trace.mode, "follow");

  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const ladder = stubLadder((_obs, memory) => formationOrder(memory));
  const undone = position(fightObs(SHORT_GUNS), { ...orbiting.memory, flightMode: "follow" }, ladder);
  assert.equal(undone.trace.outcome, "reform");
  assert.equal(undone.trace.mode, "follow");
  assert.equal(undone.trace.standingRangeM, 8_000, "the order being undone: a pending one counts as standing");
  assert.equal(undone.trace.latch?.status, "pending");
});

test("trace: docked, in warp or with no snapshot is `not-in-space`; a target not on grid is `target-off-grid`", () => {
  assert.equal(position(fightObs(SHORT_GUNS, fightGrid(), RAT, { inSpace: false }), flyingAuto()).trace.outcome, "not-in-space");
  assert.equal(position(fightObs(SHORT_GUNS, fightGrid(), RAT, { inWarp: true }), flyingAuto()).trace.outcome, "not-in-space");
  assert.equal(position(fightObs(SHORT_GUNS, fightGrid(), RAT, { snapshot: null }), flyingAuto()).trace.outcome, "not-in-space");
  const away = fightGrid({ rats: [{ itemID: RAT_2, typeID: TYPE_LONG_RAT, x: 30_000 }] });
  const off = position(fightObs(SHORT_GUNS, away), flyingAuto());
  assert.equal(off.trace.outcome, "target-off-grid");
  assert.equal(off.trace.targetID, RAT);
});

test("trace: past the leash is `leashed` with the commander-to-target distance; an order to the commander is `reform`", () => {
  const ladder = stubLadder();
  const leashed = position(fightObs(LONG_GUNS, ratAt(56_000)), flyingAuto(), ladder);
  assert.equal(leashed.trace.outcome, "leashed");
  assert.equal(leashed.trace.leashed, true);
  assert.equal(leashed.trace.leashApartM, 61_000, "the FC is 5 km behind this ship");
  assert.equal(leashed.trace.holdOrder, null, "no hold was wanted");

  const sending = stubLadder((_obs, memory) => formationOrder(memory));
  const sent9 = position(fightObs(LONG_GUNS, ratAt(56_000)), flyingAuto(), sending);
  assert.equal(sent9.trace.outcome, "reform");
  assert.equal(sent9.trace.leashed, true);
  assert.match(sent9.decision!.why, /past my leash from the commander: holding station/i);
});

test("trace: a gun boat that cannot read its reach is `no-reach`; with our orbit to undo it is `reform`, and with no commander `reform-stop`", () => {
  const blind = [gun(FIGHT_GUN_1, null, null), gun(FIGHT_GUN_2, null, null)];
  const fresh = position(fightObs(blind), flyingAuto());
  assert.equal(fresh.trace.outcome, "no-reach");
  assert.equal(fresh.trace.distanceM, 30_000, "the rung had measured the target");
  assert.equal(fresh.trace.holdOrder, null);

  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const sending = stubLadder((_obs, memory) => formationOrder(memory));
  const undone = position(fightObs(blind), orbiting.memory, sending);
  assert.equal(undone.trace.outcome, "reform");
  assert.match(undone.decision!.why, /cannot read my guns' reach: holding station on the commander/i);

  const noCommander = position(fightObs(blind, fightGrid({ fcAt: null })), orbiting.memory, stubLadder());
  assert.equal(noCommander.trace.outcome, "reform-stop");
  assert.deepEqual(sent(noCommander), { kind: "stopShip" });
  assert.equal(noCommander.trace.leashApartM, null, "no commander on grid");
});

test("trace: `flight follow` with no commander on grid is `reform-stop`", () => {
  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const stopped = position(
    fightObs(SHORT_GUNS, fightGrid({ fcAt: null })), { ...orbiting.memory, flightMode: "follow" }, stubLadder(),
  );
  assert.equal(stopped.trace.outcome, "reform-stop");
  assert.equal(stopped.trace.mode, "follow");
});

test("trace: orbit-optimal carries the numbers it was decided on", () => {
  const step = position(fightObs(SHORT_GUNS), flyingAuto());
  const t = step.trace;
  assert.equal(t.outcome, "orbit-optimal");
  assert.equal(t.mode, "auto");
  assert.equal(t.targetID, RAT);
  assert.equal(t.distanceM, 30_000);
  assert.equal(t.holdOrder, "orbit");
  assert.equal(t.holdRangeM, 8_000);
  assert.equal(t.standingRangeM, null, "nothing stood yet");
  assert.equal(t.floorM, 0);
  assert.equal(t.ceilingM, 17_000, "the longest gun's 20 km, less the 3 km leash buffer");
  assert.equal(t.far, true);
  assert.equal(t.farTicks, 1);
  assert.equal(t.spentAtM, null);
  assert.equal(t.leashed, false);
  assert.equal(t.leashApartM, 35_000);
  assert.equal(t.ratFactsMissing, false);
  assert.equal(t.reissueSuppressed, false);
  assert.deepEqual(t.latch, { status: "pending", refusals: 0, deferrals: 0, cooldown: null, wait: null });
});

test("trace: kite is `kite`, a drone boat's band is `drone-band`", () => {
  const kite = position(fightObs(LONG_GUNS, ratAt(50_000, TYPE_SHORT_RAT)), flyingAuto());
  assert.equal(kite.trace.outcome, "kite");
  assert.equal(kite.trace.holdOrder, "keepAtRange");
  assert.equal(kite.trace.holdRangeM, 15_000);

  const drones = decideCombatPosition(
    { ...TWO_GUNS, weaponModuleIDs: [] }, fightObs(null, fightGrid(), RAT, { droneControlRangeM: 40_000 }),
    engagedOn(), flyingAuto(), stubLadder(undefined, true),
  );
  assert.equal(drones.trace.outcome, "drone-band");
  assert.equal(drones.trace.holdRangeM, 37_000);
  assert.equal(drones.trace.ceilingM, 37_000);
});

test("trace: a band with no room is `empty-band`", () => {
  const observation = fightObs(
    [gun(FIGHT_GUN_1, 12_000, 10_000), gun(FIGHT_GUN_2, 12_000, 10_000)], fightGrid(), RAT,
    { threatByTypeID: { [TYPE_LONG_RAT]: { ...FIGHT_NO_THREAT, scram: true, scramRangeM: 10_000 } } },
  );
  const step = position(observation, flyingAuto());
  assert.equal(step.trace.outcome, "empty-band");
  assert.equal(step.trace.floorM, 15_000);
  assert.equal(step.trace.ceilingM, 9_000);
  assert.match(step.decision!.why, /no room to kite here/i);
});

test("trace: a target faster than the ship is `unreachable`", () => {
  const fast = { ...LONG_RAT, maxVelocity: 500, orbitRangeM: 2_000 };
  const step = position(fightObs(SHORT_GUNS, fightGrid(), RAT, {
    ratCombatByTypeID: { [TYPE_LONG_RAT]: fast, [TYPE_SHORT_RAT]: fast },
  }), flyingAuto());
  assert.equal(step.trace.outcome, "unreachable");
  assert.equal(step.trace.holdRangeM, 2_000);
});

test("trace: the closing budget spent is `closing-spent`, with the frozen distance", () => {
  let memory = flyingAuto();
  let last: CombatPositionStep | null = null;
  for (let tick = 0; tick <= MAX_CLOSE_TICKS; tick += 1) {
    last = position(fightObs(SHORT_GUNS), memory);
    memory = last.memory;
  }
  assert.equal(last!.trace.outcome, "closing-spent");
  assert.equal(last!.trace.spentAtM, 30_000);
  assert.equal(last!.trace.holdRangeM, 30_000);
  assert.equal(last!.trace.farTicks, 0, "the budget starts again from the frozen hold");
});

test("trace: a refused order's latch, its wait and its cooldown are in the trace", () => {
  let memory = flyingAuto();
  for (let tick = 0; tick < 3; tick += 1) {
    const step = position(fightObs(SHORT_GUNS), memory);
    memory = settleCombatHold(step.decision!, step.memory, "refused");
  }
  const waiting = position(fightObs(SHORT_GUNS), memory);
  assert.equal(sent(waiting), null);
  assert.equal(waiting.trace.outcome, "orbit-optimal", "the hold is still wanted");
  assert.deepEqual(waiting.trace.latch, {
    status: "refused", refusals: 3, deferrals: 0, cooldown: COMPANION_RETRY_BACKOFF_TICKS, wait: "refused",
  });
  assert.equal(waiting.trace.standingRangeM, null, "a refused order is not standing");
});

test("trace: a suppressed re-issue is flagged, and the standing order's range is the one named", () => {
  const first = position(fightObs(SHORT_GUNS), flyingAuto());
  const standing = settle(first);
  // The shortest gun's optimal moves 1.5 km: inside the 2 km margin, so no re-aim.
  const wobble = position(fightObs([SHORT_GUNS[0]!, gun(FIGHT_GUN_2, 10_000, 9_500)]), standing);
  assert.equal(sent(wobble), null);
  assert.equal(wobble.trace.reissueSuppressed, true);
  assert.equal(wobble.trace.holdRangeM, 9_500);
  assert.equal(wobble.trace.standingRangeM, 8_000);
  assert.equal(wobble.trace.latch?.status, "issued");
  assert.match(wobble.decision!.why, /orbiting the target at 8 km/i, "the order on the server, not the wobble");
  assert.doesNotMatch(wobble.decision!.why, /9\.5 km/);
  assert.match(wobble.decision!.why, /closing in/i);
  // A re-issue that is sent is not a suppressed one.
  assert.equal(position(fightObs(SHORT_GUNS), flyingAuto()).trace.reissueSuppressed, false);
});

test("trace: an unread hostile on grid is flagged, and the readout says so instead of implying a read grid", () => {
  const grid = fightGrid({ rats: [
    { itemID: RAT, typeID: TYPE_SHORT_RAT, x: 50_000 }, { itemID: RAT_2, typeID: TYPE_UNREAD_RAT, x: 60_000 },
  ] });
  const unread = position(fightObs(LONG_GUNS, grid), flyingAuto());
  assert.equal(unread.trace.ratFactsMissing, true);
  assert.equal(unread.trace.outcome, "orbit-optimal");
  assert.match(unread.decision!.why, /some rats here are not identified yet: orbiting at 30 km rather than kiting/i);
  assert.doesNotMatch(unread.decision!.why, /my shortest guns reach there/i);
  // The grid read: no flag, the old sentence.
  const read = position(fightObs(SHORT_GUNS), flyingAuto());
  assert.equal(read.trace.ratFactsMissing, false);
  assert.match(read.decision!.why, /my shortest guns reach there/i);
});

test("an orbit held to the floor or the ceiling says what held it, not that the guns reach there", () => {
  const scram = fightObs(SHORT_GUNS, fightGrid(), RAT, {
    threatByTypeID: { [TYPE_LONG_RAT]: { ...FIGHT_NO_THREAT, scram: true, scramRangeM: 10_000 } },
  });
  const floor = position(scram, flyingAuto());
  assert.equal(floor.trace.outcome, "orbit-optimal");
  assert.equal(floor.trace.holdRangeM, 15_000);
  assert.equal(floor.trace.floorM, 15_000);
  assert.match(floor.decision!.why, /orbiting the target at 15 km: as close as i dare with the rats' tackle/i);
  assert.doesNotMatch(floor.decision!.why, /shortest guns reach there/i);

  const far = [gun(FIGHT_GUN_1, 20_000, 19_500), gun(FIGHT_GUN_2, 20_000, 19_500)];
  const ceiling = position(fightObs(far), flyingAuto());
  assert.equal(ceiling.trace.holdRangeM, 17_000);
  assert.equal(ceiling.trace.ceilingM, 17_000);
  assert.match(ceiling.decision!.why, /orbiting the target at 17 km: as far out as my lock range and gun reach allow/i);

  // Unread rats AND a clamp: both are said.
  const grid = fightGrid({ rats: [
    { itemID: RAT, typeID: TYPE_SHORT_RAT, x: 50_000 }, { itemID: RAT_2, typeID: TYPE_UNREAD_RAT, x: 60_000 },
  ] });
  const both = position(fightObs(far, grid), flyingAuto());
  assert.match(both.decision!.why, /not identified yet: orbiting at 17 km rather than kiting\. Held at my lock range and gun reach\./i);
});

test("each way back to formation has its own sentence", () => {
  const orbiting = position(fightObs(SHORT_GUNS), flyingAuto());
  const sending = stubLadder((_obs, memory) => formationOrder(memory));
  const follow = position(fightObs(SHORT_GUNS), { ...orbiting.memory, flightMode: "follow" }, sending);
  const leash = position(fightObs(LONG_GUNS, ratAt(56_000)), flyingAuto(), sending);
  const blind = [gun(FIGHT_GUN_1, null, null), gun(FIGHT_GUN_2, null, null)];
  const noReach = position(fightObs(blind), orbiting.memory, sending);
  const sentences = [follow, leash, noReach].map((step) => step.decision!.why);
  assert.equal(sentences[0], "Flight follow: holding station on the commander.");
  assert.equal(sentences[1], "Target is past my leash from the commander: holding station.");
  assert.equal(sentences[2], "Cannot read my guns' reach: holding station on the commander.");
  assert.equal(new Set(sentences).size, 3);
});

// ─── The range gate's trace ──────────────────────────────────────────────────

test("gate trace: measured in reach, assumed and out of reach are three disjoint lists", () => {
  // The rat at 15 km: gun 1 (20 km reach) reaches, gun 2 (10 km) does not.
  const observation = fightObs(SHORT_GUNS, ratAt(15_000));
  const measured = measureSpace(observation.snapshot ?? null);
  const gate = gunsInReach(RAT, TWO_GUNS, observation, freshLadderMemory(), measured);
  assert.deepEqual(gate.trace, {
    targetID: RAT, distanceM: 15_000, inReach: [FIGHT_GUN_1], assumed: [], outOfReach: [FIGHT_GUN_2],
  });
  assert.deepEqual(gate.inReach, [FIGHT_GUN_1], "the gate itself is unchanged");
  assert.deepEqual(gate.assumed, []);

  // Gun 2's reach is unreadable: let through, and said to be assumed.
  const blind = fightObs([SHORT_GUNS[0]!, gun(FIGHT_GUN_2, null, null)], ratAt(15_000));
  const mixed = gunsInReach(RAT, TWO_GUNS, blind, freshLadderMemory(), measured);
  assert.deepEqual(mixed.trace.inReach, [FIGHT_GUN_1]);
  assert.deepEqual(mixed.trace.assumed, [FIGHT_GUN_2]);
  assert.deepEqual(mixed.trace.outOfReach, []);
  assert.deepEqual(mixed.inReach, [FIGHT_GUN_1, FIGHT_GUN_2]);

  // No measurement at all: every gun is assumed, none measured.
  const unmeasured = gunsInReach(RAT, TWO_GUNS, observation, freshLadderMemory(), null);
  assert.deepEqual(unmeasured.trace, {
    targetID: RAT, distanceM: null, inReach: [], assumed: [FIGHT_GUN_1, FIGHT_GUN_2], outOfReach: [],
  });

  // No facts for the rack (throttled or unread): assumed too.
  const unread = gunsInReach(RAT, TWO_GUNS, fightObs(null, ratAt(15_000)), freshLadderMemory(), measured);
  assert.deepEqual(unread.trace.assumed, [FIGHT_GUN_1, FIGHT_GUN_2]);

  // A gun judged out of reach stays held when the distance goes unknown: not assumed.
  const held = gunsInReach(RAT, TWO_GUNS, observation, gate.memory, null);
  assert.deepEqual(held.trace.inReach, []);
  assert.deepEqual(held.trace.assumed, [FIGHT_GUN_1]);
  assert.deepEqual(held.trace.outOfReach, [FIGHT_GUN_2]);

  // No guns picked: empty lists.
  const none = gunsInReach(RAT, { ...TWO_GUNS, weaponModuleIDs: [] }, observation, freshLadderMemory(), measured);
  assert.deepEqual(none.trace, { targetID: RAT, distanceM: 15_000, inReach: [], assumed: [], outOfReach: [] });
});

test("the gate's words count measured guns and say how many more were assumed", () => {
  assert.equal(gunsInReachWords(1, 2, 1), " Locked, and firing on it: 1 of 2 guns in reach (1 assumed).");
  assert.equal(gunsInReachWords(0, 2, 2), " Locked, and firing on it: 0 of 2 guns in reach (2 assumed).");
  assert.equal(gunsInReachWords(1, 3, 1), " Locked, and firing on it: 1 of 3 guns in reach (1 assumed).");
  assert.equal(gunsInReachWords(0, 2, 0), " Locked, but none of my guns reach it from here.");
  assert.equal(gunsInReachWords(2, 2, 0), " Locked, and firing on it.");
});
