// The fleet companion in a fight: rung 8, `flight auto` combat positioning, and
// the range gate rung 7 puts on its guns (docs/fleet-companion-combat-plan.md
// §5.1, §5.3-§5.5).
//
// WHY A FILE OF ITS OWN. fleetCompanionLoop.ts is upstream's file, and every
// line this fork adds to it is a line every later upstream edit can conflict
// with. So the ladder keeps only what has to live there -- the call site, the
// memory fields, the `orbit` action and the wrapper that clears latches -- and
// everything the rung DECIDES lives here.
//
// ⚠ NO RUNTIME IMPORT FROM fleetCompanionLoop.ts, AND THAT IS DELIBERATE. That
// file imports this one, so a value import back would be a module cycle whose
// failure is an uninitialised binding at load time. Types cross freely; the
// helpers the ladder owns (`decideFollow`, the commander lookup, the drone bay,
// the order limits) arrive as a `CombatPositionLadder`, built once over there.
//
// WHERE TO BE is combatPosition.ts's arithmetic (`wantedHold`) and is not
// re-derived here; this file reads the grid into its inputs, decides whether the
// answer is worth a call, and keeps the order's record (orderLatch.ts).

import { measureSpace, type SpaceMeasurement } from "./autopilotLoop.ts";
import {
  holdNeedsReissue,
  inReach,
  MAX_CLOSE_TICKS,
  ratReachM,
  REACH_HYSTERESIS_M,
  wantedHold,
  type HeldOrder,
  type Hold,
  type HoldInputs,
  type HoldReason,
  type WeaponReach,
} from "./combatPosition.ts";
import { RANGE_HYSTERESIS_M, type BandThreat } from "./kiteBand.ts";
import {
  isStanding,
  pendingLatch,
  settleLatch,
  stepLatch,
  type LatchWaitReason,
  type OrderLatch,
  type OrderLatchLimits,
  type OrderOutcome,
} from "./orderLatch.ts";
import { isHostile } from "../space/overview.ts";
import type { SpaceEntity, SpaceSnapshot } from "../store/types.ts";
import type {
  CompanionDecision,
  CompanionLadderMemory,
  FleetCompanionAction,
  FleetCompanionObservation,
  FleetCompanionRequest,
} from "./fleetCompanionLoop.ts";

/** How many refusals one positioning order may take before it backs off. As formation's. */
export const MAX_COMPANION_POSITION_REFUSALS = 3;

/** The positioning order rung 8 has sent (or is sending), with its outcome. */
export type CombatHoldRecord = HeldOrder & OrderLatch;

/**
 * What rung 8 remembers about the engaged target between ticks. Dropped when
 * the target changes and when the fight ends.
 */
export interface CombatTargetState {
  readonly targetID: number;
  /**
   * CONSECUTIVE ticks spent far from the hold. Reset to 0 the moment the ship is
   * in position, so the closing budget bounds one unbroken attempt, not the sum
   * of every drift across a long fight.
   */
  readonly farTicks: number;
  /**
   * The distance FROZEN when the closing budget ran out, handed to `wantedHold`
   * as `closingSpentAtM`; null while the budget is not spent.
   *
   * ⚠ FROZEN ONCE, NOT RE-READ. A hold that followed the live distance would
   * re-aim the ship every time the rat drifted past the hysteresis. Cleared on a
   * new target, at the end of the fight, and when the ship is back in position
   * for the hold it was originally after.
   */
  readonly spentAtM: number | null;
  /**
   * Last tick's answer: far from the hold, and still trying. Rung 3b reads it
   * (`closingOnTheHold`), a tick late because it runs first, to burn while
   * closing (plan §5.1).
   */
  readonly closing: boolean;
  /**
   * Past the leash: the target is further from the commander than this pilot can
   * lock. STICKY (see `pastTheLeash`), so a target wobbling across the edge does
   * not alternate an orbit with the formation order.
   */
  readonly leashed: boolean;
}

export interface CombatPositionMemory {
  /**
   * The positioning order on the engaged target, with its outcome.
   *
   * ⚠ IT IS A LATCH THAT SAYS "ALREADY IN POSITION", AND A STALE ONE IS THE BUG
   * IT HAS TO AVOID. The orbit is standing server-side, so the rung re-sends it
   * only when `holdNeedsReissue` says the hold moved. Any OTHER movement -- a
   * flee, an align, the formation order -- ends that orbit without telling this
   * record, so the ladder's wrapper drops it on every movement this rung did not
   * send, and on warp and dock (`withoutCombatHold`).
   */
  readonly hold: CombatHoldRecord | null;
  readonly target: CombatTargetState | null;
  /**
   * Our order was dropped and the pilot belongs back in formation, which is not
   * yet confirmed holding. While set, rung 9 is asked EVERY tick (its own
   * refusal, back-off and resend run), so one refused or unanswered formation
   * order cannot leave the pilot orbiting a rat for the rest of the fight.
   * Cleared when formation is confirmed (`formationHolding`), when positioning
   * resumes, by a `stop`, and when the fight ends.
   */
  readonly reform: boolean;
}

export const FRESH_COMBAT_POSITION: CombatPositionMemory = Object.freeze({ hold: null, target: null, reform: false });

/** Which guns the range gate last judged in and out of reach of `targetID`. */
export interface WeaponReachState {
  readonly targetID: number;
  readonly inReach: readonly number[];
  readonly outOfReach: readonly number[];
}

/**
 * What rung 8 needs from the ladder that owns it. See the header for why these
 * arrive as values rather than imports.
 */
export interface CombatPositionLadder {
  /** Rung 9, `decideFollow`: hold station on the fleet commander. */
  readonly follow: (obs: FleetCompanionObservation, memory: CompanionLadderMemory) => CompanionDecision | null;
  /** The first commander the roster names whose ship is on this grid -- rung 9's anchor. */
  readonly commanderShip: (obs: FleetCompanionObservation) => SpaceEntity | null;
  readonly hasCombatDrones: (obs: FleetCompanionObservation) => boolean;
  readonly metresBetween: (a: SpaceEntity, b: SpaceEntity) => number;
  readonly limits: OrderLatchLimits;
}

/** What rung 8 decided. `decision` null is a fall-through; a standing one is a readout. */
export interface CombatPositionStep {
  readonly decision: CompanionDecision | null;
  readonly memory: CompanionLadderMemory;
}

// ─── Memory helpers the ladder's wrapper uses ────────────────────────────────

function withPosition(memory: CompanionLadderMemory, patch: Partial<CombatPositionMemory>): CompanionLadderMemory {
  return { ...memory, combatPosition: { ...memory.combatPosition, ...patch } };
}

/**
 * The memory without rung 8's standing order and its closing budget: what any
 * movement this rung did not send leaves behind. The leash flag survives,
 * because it is about where the target is and not about what the ship was doing
 * -- dropping it on the formation order would undo its hysteresis.
 */
export function withoutCombatHold(memory: CompanionLadderMemory): CompanionLadderMemory {
  const { hold, target } = memory.combatPosition;
  const reset = target === null || (target.farTicks === 0 && target.spentAtM === null && !target.closing)
    ? target
    : { ...target, farTicks: 0, spentAtM: null, closing: false };
  return hold === null && reset === target ? memory : withPosition(memory, { hold: null, target: reset });
}

/** Is this action the positioning order rung 8 has just stamped as pending? */
export function isCombatHoldOrder(action: FleetCompanionAction, memory: CompanionLadderMemory): boolean {
  const hold = memory.combatPosition.hold;
  return hold !== null && hold.status === "pending" &&
    (action.kind === "orbit" || action.kind === "keepAtRange") &&
    action.kind === hold.order && action.targetID === hold.targetID && action.range === hold.rangeM;
}

/**
 * Rung 3b's question, answered from rung 8's last tick: closing on the hold in
 * `flight auto`. `propsHeld` is asked first by the caller and still wins.
 */
export function closingOnTheHold(memory: CompanionLadderMemory): boolean {
  return memory.flightMode === "auto" && memory.combatPosition.target?.closing === true;
}

/**
 * Rung 8's order, settled with what the controller learned, on `settleFollow`'s
 * terms: only its own pending record, and only while that exact record is still
 * the ladder's.
 */
export function settleCombatHold(
  decision: CompanionDecision,
  current: CompanionLadderMemory,
  outcome: OrderOutcome,
): CompanionLadderMemory {
  const pending = decision.memory.combatPosition.hold;
  if ((decision.action.kind !== "orbit" && decision.action.kind !== "keepAtRange") ||
    pending === null || pending.status !== "pending" || current.combatPosition.hold !== pending) {
    return current;
  }
  return withPosition(current, { hold: settleLatch(pending, outcome) });
}

// ─── Rung 7's range gate ─────────────────────────────────────────────────────

/**
 * The range gate (plan §5.3): which of this pilot's guns can reach `targetID`
 * with the charge they have LOADED, judged sticky per gun.
 *
 * ⚠ SURFACE DISTANCE, FROM THE TICK'S `measureSpace`, BECAUSE THAT IS WHAT REACH
 * IS MEASURED AGAINST. A weapon's optimal and falloff are surface-to-surface on
 * the server, so a centre-to-centre measure would call a battleship's own hull a
 * kilometre of range it has not got. The caller hands the measurement in; this
 * never measures the snapshot again.
 *
 * ⚠ EVERY UNKNOWN FAILS OPEN, and the gun fires as it did before this gate
 * existed: a gun missing from `combatWeapons` (the facts are throttled and may
 * be unread or stale), a gun whose reach was unreadable, and a target whose
 * distance cannot be measured. A gun that might hit beats a gun that certainly
 * does not; the failure being guarded against is a pilot firing nothing because
 * a module row was incomplete.
 *
 * ⚠ STICKY, PER GUN, PER TARGET (`inReach`, `weaponReach`). A rat drifting
 * across the edge must not toggle a gun on and off: every flip is a call and a
 * module cycle. A gun's state is only RECORDED from a real measurement, so an
 * unknown tick keeps the last answer rather than inventing one.
 *
 * ⚠ THIS GATES STARTING A GUN AND NOTHING ELSE. A gun already cycling on a
 * target that drifted out of reach is left running: no rung in this codebase
 * stops a weapon for range (the drone-boat ladder gates its activation the same
 * way and never deactivates), and a wasted cycle is cheaper than a stop and a
 * restart when the rat drifts back.
 */
export function gunsInReach(
  targetID: number,
  request: FleetCompanionRequest,
  obs: FleetCompanionObservation,
  memory: CompanionLadderMemory,
  measurement: SpaceMeasurement | null,
): { readonly inReach: readonly number[]; readonly memory: CompanionLadderMemory } {
  const weapons = request.weaponModuleIDs;
  if (weapons.length === 0) {
    return { inReach: [], memory };
  }
  const facts = obs.combatWeapons?.weapons ?? null;
  const distance = measurement?.distances.get(targetID) ?? null;
  const previous = memory.weaponReach?.targetID === targetID ? memory.weaponReach : null;
  const nowIn: number[] = [];
  const nowOut: number[] = [];
  const reaching: number[] = [];
  for (const moduleID of weapons) {
    const fact = facts?.find((weapon) => weapon.itemID === moduleID) ?? null;
    const was = previous === null ? null
      : previous.inReach.includes(moduleID) ? true
        : previous.outOfReach.includes(moduleID) ? false : null;
    const reachM = fact?.reachM ?? null;
    const ok = fact === null ? true : inReach(distance, reachM, was);
    if (ok) {
      reaching.push(moduleID);
    }
    // Recorded only from a measurement; otherwise the previous state stands.
    const measured = fact !== null && reachM !== null && distance !== null;
    const state = measured ? ok : was;
    if (state === true) nowIn.push(moduleID);
    if (state === false) nowOut.push(moduleID);
  }
  const same = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((id, index) => b[index] === id);
  if (previous === null ? nowIn.length === 0 && nowOut.length === 0
    : same(previous.inReach, nowIn) && same(previous.outOfReach, nowOut)) {
    return { inReach: reaching, memory };
  }
  return {
    inReach: reaching,
    memory: { ...memory, weaponReach: { targetID, inReach: nowIn, outOfReach: nowOut } },
  };
}

/**
 * The end of rung 7's "locked" sentence for a pilot with guns picked.
 *
 * ⚠ A RACK PARTLY OUT OF REACH SAYS SO. A pilot whose guns cannot reach the
 * called target is still engaged -- rung 8 is what fixes that, and the drones
 * fight meanwhile -- but "firing on it" would be false for the guns that are
 * holding. Plain ASCII: player-facing.
 */
export function gunsInReachWords(inReach: number, picked: number): string {
  return inReach === 0
    ? " Locked, but none of my guns reach it from here."
    : inReach < picked
      ? ` Locked, and firing on it: ${inReach} of ${picked} guns in reach.`
      : " Locked, and firing on it.";
}

// ─── Rung 8 ──────────────────────────────────────────────────────────────────

/** A distance for a player: "12 km", "2.5 km". */
function kmWords(metres: number): string {
  return `${Math.round(metres / 100) / 10} km`;
}

/** The sentence that says why the pilot holds where it holds. Plain ASCII. */
function holdSentence(hold: Hold): string {
  const at = kmWords(hold.rangeM);
  const reason: HoldReason = hold.reason;
  switch (reason) {
    case "kite":
      return `Holding ${at} off the target: my guns out-range everything here.`;
    case "orbit-optimal":
      return `Orbiting the target at ${at}: my shortest guns reach there.`;
    case "drone-band":
      return `Keeping ${at} off the target while my drones fight it.`;
    case "empty-band":
      return `No room to kite here, fighting at ${at}.`;
    case "unreachable":
      return "The target is faster than me; fighting from where it is.";
    case "closing-spent":
      return `Could not close in, so fighting from ${at}.`;
  }
  // A new reason added to `HoldReason` fails to compile here until it has words.
  const unhandled: never = reason;
  return unhandled;
}

/** The order record's waits, as the readout says them. Exhaustive by type. */
const LATCH_WORDS: Readonly<Record<LatchWaitReason, string>> = Object.freeze({
  cooldown: "Waiting a moment before sending the positioning order again.",
  "session-change-cap": "A session change kept blocking the positioning order. Trying again shortly.",
  "session-change": "Waiting for the session change to clear before positioning.",
  unanswered: "The positioning order got no answer. Sending it again in a moment.",
  refused: "The positioning order was refused repeatedly. Trying again shortly.",
});

/** The engaged decision's authority, carried onto whatever this rung returns. */
function authorityOf(engaged: CompanionDecision): Pick<CompanionDecision, "followingOrderFrom" | "lastOrderHeard"> {
  return {
    ...(engaged.followingOrderFrom === undefined ? {} : { followingOrderFrom: engaged.followingOrderFrom }),
    ...(engaged.lastOrderHeard === undefined ? {} : { lastOrderHeard: engaged.lastOrderHeard }),
  };
}

/** Formation confirmed holding: rung 9's anchor set, and its order taken by the server. */
function formationHolding(memory: CompanionLadderMemory): boolean {
  const order = memory.followOrder;
  return memory.followAnchorID !== null && order !== null && order.status === "issued" &&
    order.targetID === memory.followAnchorID;
}

/**
 * Past the leash, stickily: leave when the commander-to-target distance passes
 * the lock range, come back only once it is inside the lock range by
 * `RANGE_HYSTERESIS_M`. No commander on grid, or an unknown lock range, is no
 * leash -- the same fail-open the free-fire pick makes with it.
 */
function pastTheLeash(
  commander: SpaceEntity | null,
  target: SpaceEntity,
  lockRangeM: number | null,
  wasLeashed: boolean,
  ladder: CombatPositionLadder,
): boolean {
  if (commander === null || lockRangeM === null) {
    return false;
  }
  const apart = ladder.metresBetween(commander, target);
  return wasLeashed ? apart >= lockRangeM - RANGE_HYSTERESIS_M : apart > lockRangeM;
}

/**
 * The grid, read into `wantedHold`'s inputs (less the closing budget, which the
 * caller adds).
 *
 * ⚠ `gridRatReachM` IS NULL WHEN ANY HOSTILE ON GRID IS UNREAD, and `threats` is
 * built as the drone-boat ladder's `bandThreats` builds it -- one row per hostile
 * ON GRID, a scram reach only for a type that actually scrams -- so kiteBand
 * derives the floor for both hull types from one rule. See combatPosition.ts.
 */
function holdInputs(
  request: FleetCompanionRequest,
  obs: FleetCompanionObservation,
  snapshot: SpaceSnapshot,
  target: SpaceEntity,
  measurement: SpaceMeasurement | null,
  lockRangeM: number | null,
  ladder: CombatPositionLadder,
): Omit<HoldInputs, "closingSpentAtM"> {
  const facts = obs.combatWeapons?.weapons ?? null;
  const weapons: WeaponReach[] = request.weaponModuleIDs.map((moduleID) => {
    const fact = facts?.find((weapon) => weapon.itemID === moduleID) ?? null;
    return { moduleID, reachM: fact?.reachM ?? null, optimalM: fact?.optimalM ?? null };
  });
  const ratFacts = obs.ratCombatByTypeID ?? null;
  const threatByType = obs.threatByTypeID ?? null;
  let gridRatReachM: number | null = 0;
  const threats: BandThreat[] = [];
  for (const rat of snapshot.entities.filter(isHostile)) {
    const typeID = rat.typeID ?? null;
    const known = typeID === null ? null : (ratFacts?.[typeID] ?? null);
    gridRatReachM = known === null || gridRatReachM === null ? null : Math.max(gridRatReachM, ratReachM(known));
    const threat = typeID === null ? null : (threatByType?.[typeID] ?? null);
    threats.push({
      itemID: rat.itemID,
      // Only the floor is read from these, and it does not depend on distance.
      distanceM: measurement?.distances.get(rat.itemID) ?? Number.POSITIVE_INFINITY,
      scramRangeM: threat !== null && threat.scram ? threat.scramRangeM : null,
      webs: threat?.web === true,
    });
  }
  const targetType = target.typeID ?? null;
  return {
    weapons,
    hasCombatDrones: ladder.hasCombatDrones(obs),
    droneControlRangeM: obs.droneControlRangeM ?? null,
    lockRangeM,
    gridRatReachM,
    threats,
    targetDistanceM: measurement?.distances.get(target.itemID) ?? null,
    target: targetType === null ? null : (ratFacts?.[targetType] ?? null),
    ownMaxVelocity: snapshot.ship?.maxVelocity ?? null,
  };
}

/** Far from a hold: further from its range than the reach hysteresis. Unknown is not far. */
function farFrom(distanceM: number | null, hold: Hold): boolean {
  return distanceM !== null && Math.abs(distanceM - Math.round(hold.rangeM)) > REACH_HYSTERESIS_M;
}

/**
 * Back to formation: rung 9, asked from here because the fight stands, so the
 * standing readout would end the ladder before rung 9 ran.
 *
 * ⚠ ASKED EVERY TICK WHILE `reform` IS PENDING, not once. A refused or
 * unanswered formation order, or a tick on which rung 9 had nothing to say,
 * would otherwise leave the pilot on our orbit until the fight ended. Rung 9's
 * own refusal, back-off and resend run each time; its waits are not returned
 * (the fight's readout stands) but its memory is kept, so they count down.
 *
 * ⚠ NO COMMANDER ON GRID: ONE `stopShip`. A pilot told to follow with nobody to
 * follow must at least stop orbiting the rat; then the flag clears, because
 * there is no formation to confirm.
 *
 * `askAnyway` is the leash: a target past it is never chased, so rung 9 is asked
 * whether or not an order of ours was standing -- a pilot already in formation
 * gets rung 9's "already holding" wait, which is ignored.
 */
function backToFormation(
  engaged: CompanionDecision,
  obs: FleetCompanionObservation,
  memory: CompanionLadderMemory,
  askAnyway: boolean,
  ladder: CombatPositionLadder,
): CombatPositionStep {
  const pending = memory.combatPosition.reform;
  if (!pending && !askAnyway) {
    return { decision: null, memory };
  }
  if (ladder.commanderShip(obs) === null) {
    if (!pending) {
      return { decision: null, memory };
    }
    const next = withPosition(memory, { reform: false });
    return {
      decision: {
        action: { kind: "stopShip" },
        phase: engaged.phase,
        why: "Not chasing the target, and no fleet commander here to hold station on. Stopping the ship.",
        memory: next,
        ...authorityOf(engaged),
      },
      memory: next,
    };
  }
  const reforming = ladder.follow(obs, memory);
  if (reforming === null) {
    return { decision: null, memory };
  }
  if (reforming.action.kind !== "wait") {
    return {
      decision: {
        ...reforming,
        why: "Not chasing the target: holding station on the fleet commander and fighting from there.",
        ...authorityOf(engaged),
      },
      memory: reforming.memory,
    };
  }
  const after = reforming.memory;
  return { decision: null, memory: withPosition(after, { reform: pending && !formationHolding(after) }) };
}

/**
 * Rung 8, `flight auto`: be where the engaged target can be shot (plan §5.4).
 * `engaged` is rung 7's decision (null when it had none); the step's `memory`
 * is what the rungs beneath carry, whatever it decides.
 *
 * ⚠ IT ACTS ONLY IN `flight auto`. In "follow", the default, the fleet
 * commander leads and this rung never positions anything: today's behaviour is
 * the default and positioning is a mode the commander switches on (operator,
 * 2026-10-13). It only undoes an order of its own making (`backToFormation`).
 * The range gate on the guns is rung 7's and applies either way.
 *
 * ⚠ NOT WHILE `stop` HOLDS. `stop` suspends the standing follow
 * (`followHeld`), and a rung that re-orbited the rat on the next tick would undo
 * it. `follow N km` or `flight auto` lifts it.
 *
 * ⚠ IT SITS BELOW THE FLEET ORDERS AND THE LOCK-AHEAD AND ABOVE SALVAGE AND
 * LOOT. Everything a human ordered (align, travel, warp) is above it, so an
 * order is never fought by the autopilot; a fleet-order decision that holds
 * navigation is a fall-through here for the same reason. And it is the one
 * self-move that may act while a target call stands, which is why its every
 * decision HOLDS NAVIGATION: salvage and loot must not drag the ship off its
 * hold mid-fight.
 *
 * ⚠ THE LEASH IS THE LOCK RANGE, AND PAST IT THIS RUNG DOES NOT CHASE. When a
 * commander is on grid and the target is further from the commander's ship than
 * this pilot can lock, the pilot stays in formation (rung 9) and fights with
 * whatever reaches from there. Sticky: see `pastTheLeash`.
 *
 * ⚠ A GUN BOAT WITH NO KNOWN REACH IS NOT POSITIONED (`wantedHold` null): it
 * stays in formation until a reach is readable.
 *
 * ⚠ THE ORDER IS RE-SENT ONLY WHEN `holdNeedsReissue` SAYS THE HOLD MOVED, and
 * its outcomes are tracked as the formation order's are (orderLatch.ts): every
 * wait is bounded and standing, so a positioning back-off never starves the
 * rungs beneath of a non-moving job.
 *
 * ⚠ THE CLOSING BUDGET BOUNDS THE ONE WAIT THAT COULD OTHERWISE BE ENDLESS. A
 * hold the ship cannot reach (a rat that keeps its own orbit) would read
 * "Closing" for ever; after `MAX_CLOSE_TICKS` CONSECUTIVE far ticks the current
 * distance is frozen as the hold, and the readout says so. See
 * `CombatTargetState`.
 */
export function decideCombatPosition(
  request: FleetCompanionRequest,
  obs: FleetCompanionObservation,
  engaged: CompanionDecision | null,
  memory: CompanionLadderMemory,
  ladder: CombatPositionLadder,
): CombatPositionStep {
  const targetID = engaged?.engagedTargetID;
  if (engaged === null || targetID === undefined) {
    // ⚠ THE FIGHT HAS ENDED (or never began): nothing of it is kept, so nothing
    // believes the ship is still "in position", still closing (the burner), or
    // still owed a formation order on a later fight. Rung 9 brings it home.
    return { decision: null, memory: withPosition(memory, FRESH_COMBAT_POSITION) };
  }
  const position = memory.combatPosition;
  const ours = position.hold !== null;
  const state = position.target?.targetID === targetID ? position.target : null;
  // Not positioning this tick: whatever is remembered of the target stays, but
  // the burner's question is answered "not closing".
  const idle = (next: CombatTargetState | null): CompanionLadderMemory =>
    withPosition(memory, { target: next === null || !next.closing ? next : { ...next, closing: false } });
  // Our order goes, and formation is owed if it was ours.
  const standDown = (next: CombatTargetState | null): CompanionLadderMemory =>
    withPosition(memory, { hold: null, target: next, reform: position.reform || ours });

  if (memory.followHeld) {
    return { decision: null, memory: withPosition(idle(state), { reform: false }) };
  }
  if (memory.flightMode !== "auto") {
    // The FC leads. Only an order of OUR making needs undoing.
    return backToFormation(engaged, obs, standDown(null), false, ladder);
  }
  const snapshot = obs.snapshot ?? null;
  if (engaged.holdsNavigation === true || obs.inSpace !== true || obs.inWarp === true || snapshot === null) {
    return { decision: null, memory: idle(state) };
  }
  const target = snapshot.entities.find((entity) => entity.itemID === targetID) ?? null;
  if (target === null) {
    return { decision: null, memory: idle(state) };
  }
  const lockRangeM = obs.maxTargetRangeM ?? null;
  if (pastTheLeash(ladder.commanderShip(obs), target, lockRangeM, state?.leashed === true, ladder)) {
    const leashed: CombatTargetState = { targetID, farTicks: 0, spentAtM: null, closing: false, leashed: true };
    return backToFormation(engaged, obs, standDown(leashed), true, ladder);
  }

  // ─── Where to be ──────────────────────────────────────────────────────────
  // ⚠ THE ONE MEASUREMENT THIS RUNG MAKES. Everything below reads it.
  const measurement = measureSpace(snapshot);
  const inputs = holdInputs(request, obs, snapshot, target, measurement, lockRangeM, ladder);
  const natural = wantedHold({ ...inputs, closingSpentAtM: null });
  if (natural === null) {
    // Nothing this fit can position for: formation, if we had broken it.
    return backToFormation(engaged, obs, standDown(null), false, ladder);
  }
  const distanceM = inputs.targetDistanceM;
  const holdAt = (spentAtM: number | null): Hold =>
    spentAtM === null ? natural : (wantedHold({ ...inputs, closingSpentAtM: spentAtM }) ?? natural);
  // Back in position for the hold it was originally after: the frozen one goes.
  let spentAtM = state?.spentAtM ?? null;
  if (spentAtM !== null && !farFrom(distanceM, natural)) {
    spentAtM = null;
  }
  let hold = holdAt(spentAtM);
  let far = farFrom(distanceM, hold);
  const farBefore = state?.farTicks ?? 0;
  let farTicks = far ? farBefore + 1 : 0;
  if (far && farBefore >= MAX_CLOSE_TICKS && distanceM !== null) {
    // The budget is spent: freeze where the ship is, once.
    spentAtM = distanceM;
    hold = holdAt(spentAtM);
    far = farFrom(distanceM, hold);
    farTicks = 0;
  }
  memory = withPosition(memory, {
    target: { targetID, farTicks, spentAtM, closing: far, leashed: false },
    reform: false,
  });

  const rangeM = Math.round(hold.rangeM);
  const wanted: HeldOrder = { order: hold.order, targetID, rangeM };
  const sentence = holdSentence(hold);
  const readout = (why: string, next: CompanionLadderMemory): CombatPositionStep => ({
    decision: { ...engaged, action: { kind: "wait" }, standing: true, holdsNavigation: true, why, memory: next },
    memory: next,
  });

  // ─── Whether it is worth a call ───────────────────────────────────────────
  const current = memory.combatPosition.hold;
  const step = stepLatch(current?.targetID === targetID ? current : null, ladder.limits);
  if (step.kind === "wait") {
    return readout(`${engaged.why} ${LATCH_WORDS[step.reason]}`, withPosition(memory, { hold: step.latch }));
  }
  const previous = step.latch;
  if (previous !== null && isStanding(previous) && !holdNeedsReissue(previous, wanted)) {
    return readout(`${engaged.why} ${far ? "Closing in." : "In position."} ${sentence}`, memory);
  }
  const next = withPosition(memory, { hold: { ...wanted, ...pendingLatch(previous) } });
  return {
    decision: {
      action: { kind: hold.order, targetID, range: rangeM },
      phase: engaged.phase,
      why: sentence,
      memory: next,
      holdsNavigation: true,
      ...authorityOf(engaged),
    },
    memory: next,
  };
}
