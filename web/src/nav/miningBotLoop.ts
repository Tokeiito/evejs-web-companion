// The mining bot (goal R26) — automated play you can walk away from.
//
// THIS IS THE FOURTH INSTANCE OF ONE PATTERN, not a new one. R5b's autopilot,
// R13's measured distance ladder and R24's Dock are all the same shape, and so
// is this: a browser-side decide-loop that reads AUTHORITATIVE state each tick,
// issues AT MOST ONE atomic call, never simulates or predicts, bounds every
// branch, and PAUSES WITH A REASON rather than guessing. The rungs are new; the
// discipline is inherited, and the closing-on-a-target rungs are literally the
// autopilot's own (`decideCloseIn`), imported rather than re-derived.
//
// It runs in the BROWSER. Closing the tab is closing the client: this JS stops,
// the ship completes whatever server-side command was last issued, and sits.
// The BFF never drives a mining loop with no client attached — that is the
// honest boundary and it is deliberate.
//
// ─── THE HARDEST RULE: A 200 IS NOT PROOF ────────────────────────────────────
//
// This server has six confirmed cases of answering success without acting,
// including R25's live finding that a drone LAUNCH returns 200 while refusing
// two of three drones inline. So NOTHING here believes a call's own answer.
// Every action is confirmed by re-reading the authority that owns the fact:
//
//     locked a rock          -> dogmaIM.GetTargets              (`lockedTargetIDs`)
//     switched a laser on    -> the snapshot's ship block       (`activeModuleIDs`)
//     launched drones        -> the snapshot's drone rows       (`isMyDrone`)
//     mined ore              -> the ship's mining hold          (`used` / items)
//     unloaded              -> the ship's mining hold           (items gone)
//     undocked / docked      -> flight status                   (`docked`)
//     closed on something    -> the snapshot's measured distance
//
// And because the decision only ever CHOOSES an action while the authority
// still says it has not happened, counting consecutive identical decisions is
// exactly the bound this needs: a call that lands resets its own counter, and a
// call that keeps answering 200 while changing nothing runs out. That is the
// same construction R24 slice A/B used for warp and dock, applied to every
// branch this ladder has.

import {
  MAX_SILENT_DOCK_ATTEMPTS,
  MAX_WARP_ATTEMPTS,
  STATION_DOCKING_RADIUS_M,
  decideCloseIn,
  measureSpace,
  type SpaceMeasurement,
} from "./autopilotLoop.ts";
import { formatDistance, hostileRows, isMyDrone } from "../space/overview.ts";
import type {
  FlightStatus,
  MiningHold,
  SpaceEntity,
  SpaceSnapshot,
} from "../store/types.ts";

// --- Thresholds and bounds ---------------------------------------------------

/** How often the loop re-decides. The autopilot's cadence, for the same reason. */
export const MINING_BOT_CADENCE_MS = 2000;

/**
 * The bot's own "the warp has landed" test for a belt, in SURFACE metres.
 *
 * ⚠ THIS IS THE ONE NUMBER HERE THAT IS NOT THE SERVER'S. A belt has no
 * interaction radius to borrow — you do not dock with a belt — so the bot needs
 * its own answer to "am I there yet", and it is used for exactly one thing:
 * deciding whether "no rocks in the snapshot" means "still flying" or "this
 * belt is finished". A warp lands the ship inside a few kilometres of its
 * target, so anything inside this is arrival. It is never used as a mining
 * range, a lock range or a yield rule — the SERVER owns all three, and the bot
 * finds them out by being refused.
 */
export const BELT_ARRIVAL_RADIUS_M = 20_000;

/** Settle windows — retail's `ignoreTimerCycles`, per action kind. */
const SETTLE_UNDOCK = 2;
const SETTLE_DOCK = 2;
const SETTLE_WARP = 2;
const SETTLE_APPROACH = 2;
const SETTLE_LOCK = 2;
const SETTLE_ACTIVATE = 2;
const SETTLE_LAUNCH = 3;
const SETTLE_UNLOAD = 2;

/**
 * Consecutive lock decisions for the SAME rock with GetTargets still not
 * showing it. A lock is not instant, and SETTLE_LOCK covers the acquisition
 * ticks, so three tries with the authority unchanged is already past "the last
 * one did not take". Exceeding it gives up on that ROCK, not on the run.
 */
export const MAX_LOCK_ATTEMPTS = 3;
/**
 * How many rocks in a row may be given up on without a single lock ever
 * landing. One rock that will not lock is that rock's problem; three in a row
 * is the ship's, and wandering the belt trying every rock is the unbounded
 * repeat this project has been bitten by twice.
 */
export const MAX_CONSECUTIVE_LOCK_FAILURES = 3;
/**
 * Consecutive activate decisions for the same module with `activeModuleIDs`
 * still not listing it. Exceeding it PAUSES rather than skipping quietly: a
 * laser that will not run is the one thing this bot exists to do, and "I asked
 * three times and the ship still says it is off" is precisely the case the
 * "say so and pause" rule was written for.
 */
export const MAX_ACTIVATE_ATTEMPTS = 3;
/**
 * Consecutive launch decisions with no drone of ours appearing in the snapshot.
 * Exceeding it does NOT pause — pausing a defenceless ship next to a pirate is
 * the worst of the available outcomes — it HEADS HOME, which is bounded, safe,
 * and readable.
 */
export const MAX_LAUNCH_ATTEMPTS = 3;
/** Consecutive unload decisions with the ore still sitting in the hold. */
export const MAX_UNLOAD_ATTEMPTS = 3;
/** Consecutive undock decisions with flight status still saying docked. */
export const MAX_UNDOCK_ATTEMPTS = 3;
/** Consecutive ticks spent waiting on an approach that is already running. */
export const MAX_CLOSE_IN_CYCLES = 300;
/** Transient read failures tolerated before the loop stops trusting the read. */
export const MAX_READ_FAILURES = 5;
/**
 * Ticks the lasers may run, on a rock that still has ore, without the hold
 * growing by a single unit. At the 2 s cadence this is three minutes — longer
 * than any mining cycle — so reaching it means the cycle is not producing and
 * the bot must stop claiming it is mining.
 */
export const MAX_NO_YIELD_CYCLES = 90;

// --- Reading the world -------------------------------------------------------

/** Everything one tick looked at. Pure input to the decision. */
export interface MiningObservation {
  readonly status: FlightStatus;
  readonly snapshot: SpaceSnapshot | null;
  readonly measurement: SpaceMeasurement | null;
  /** dogmaIM.GetTargets — THE authority on locks. null = the read failed. */
  readonly lockedTargetIDs: readonly number[] | null;
  /** The ship's holds — THE authority on ore. null = the read failed. */
  readonly holds: readonly MiningHold[] | null;
  /** The drone bay's stacks. null = not read this tick (or the read failed). */
  readonly droneBayItemIDs: readonly number[] | null;
}

/** What the player set the bot to do. */
export interface MiningPlan {
  /** The belt to work. */
  readonly beltID: number;
  readonly beltName: string | null;
  /** Where a full hold goes. */
  readonly stationID: number;
  readonly stationName: string | null;
  /**
   * The equipment the bot runs on the rock — the PLAYER's pick, by name, from
   * the ship's own online modules. The browser never decides which of your
   * modules is a mining laser and never guesses which effect one runs: the
   * server resolves the module's default activation effect from its type.
   */
  readonly miningModuleIDs: readonly number[];
  /**
   * The safety floor, as a remaining fraction (0-1) of any health layer.
   * Dropping below it on shield, armour OR hull abandons the belt and docks.
   * Unattended play means nobody is watching the shield bar.
   */
  readonly healthFloor: number;
  /** Launch drones when a pirate turns up (they auto-engage — R25). */
  readonly useDrones: boolean;
  /** So a drone row can be recognised as one of ours. */
  readonly myCharacterID: number | null;
}

// --- The one atomic action a tick produces -----------------------------------

export type MiningBotAction =
  | { readonly kind: "undock" }
  | { readonly kind: "warp"; readonly destinationID: number; readonly label: string }
  | { readonly kind: "approach"; readonly destinationID: number; readonly label: string }
  | { readonly kind: "dock"; readonly stationID: number; readonly label: string }
  | { readonly kind: "unload"; readonly itemIDs: readonly number[] }
  | { readonly kind: "lock"; readonly targetID: number; readonly label: string }
  | {
      readonly kind: "activate";
      readonly moduleID: number;
      readonly targetID: number;
      readonly label: string;
    }
  | { readonly kind: "launch"; readonly droneItemIDs: readonly number[] }
  | { readonly kind: "wait"; readonly reason: string }
  | { readonly kind: "pause"; readonly reason: string }
  | { readonly kind: "stopped" };

/**
 * One decision: the action, and the plain-language WHY that goes on screen.
 *
 * The `why` is not decoration. A bot you cannot interrogate is one you cannot
 * trust, so every branch of the ladder states its own reason in the words a
 * player uses, and the panel shows the reason for the LAST thing it did at all
 * times — not only when something goes wrong.
 */
export interface MiningDecision {
  readonly action: MiningBotAction;
  readonly why: string;
  /** This tick found a reason to abandon the belt and dock (sticky). */
  readonly headHome?: string;
  /** This tick concluded the current rock is finished with, and why. */
  readonly dropRock?: string;
  /** This tick chose a rock to work. */
  readonly takeRock?: number;
}

export type MiningBotStatus = "idle" | "running" | "paused" | "stopped" | "error";

/** The live readout the panel renders (pushed every cycle). */
export interface MiningBotProgress {
  readonly status: MiningBotStatus;
  /** Where in the loop it is, in a couple of words ("Mining", "Hauling"). */
  readonly phase: string | null;
  /** What it just did. */
  readonly action: string | null;
  /** WHY it did that. Always present while running. */
  readonly why: string | null;
  /** The rock it is working, by NAME (R7d: never an id). */
  readonly rockName: string | null;
  /** Hauls completed: loads actually unloaded into the hangar. */
  readonly cyclesCompleted: number;
  /** Ore units this run, counted from the HOLD growing — never from a yield sum. */
  readonly oreUnitsMined: number;
  readonly holdUsed: number | null;
  readonly holdCapacity: number | null;
  /** Set when it stopped. Always a sentence a player can act on. */
  readonly failureReason: string | null;
}

// --- Reading the authorities -------------------------------------------------

/**
 * The hold mining actually fills: the first specialised hold the hull has, else
 * cargo. That is the runtime's OWN fallback order (the BFF reads ore, gas, ice,
 * asteroid, then cargo), so the bot watches the hold the server will fill
 * rather than picking the fullest one and calling a full cargo bay a full ship.
 */
export function destinationHold(holds: readonly MiningHold[] | null): MiningHold | null {
  if (!holds) {
    return null;
  }
  const present = holds.filter((hold) => hold.present);
  return present.find((hold) => hold.key !== "cargo") ?? present.find((hold) => hold.key === "cargo") ?? null;
}

/**
 * Is the destination hold full? `null` is UNKNOWN — the ship did not report a
 * capacity — and unknown never reads as full or as room to spare.
 *
 * ⚠ THE SECOND TEST IS FROM A LIVE RUN, AND WITHOUT IT THE BOT NEVER HAULS.
 *
 * A Retriever's ore hold stopped at **15999.95 of 16000 m³**. Veldspar is
 * 0.1 m³ a unit, so the server had filled it to within half a unit and then
 * STOPPED THE LASERS — there was no room for another whole unit. But
 * `used >= capacity` is false at 15999.95, so the bot read "not full", switched
 * the lasers back on, watched the server short-cycle them, and did it again.
 *
 * The fix is not a fudge factor and not a yield prediction — the browser still
 * computes nothing about mining. It is arithmetic on two numbers the SERVER
 * gave us: `used` cubic metres divided by the units actually sitting in the
 * hold is the volume of one unit of what is in there, and if the remaining
 * space is smaller than that, not one more unit fits. That is "the hold cannot
 * take another cycle", observed rather than guessed.
 *
 * When the items cannot be read, this falls back to the plain `used >=
 * capacity` test rather than inventing a unit size.
 */
export function holdIsFull(hold: MiningHold | null): boolean | null {
  const capacity = hold?.capacity;
  if (!capacity || capacity.capacity === null || capacity.used === null || !(capacity.capacity > 0)) {
    return null;
  }
  if (capacity.used >= capacity.capacity) {
    return true;
  }
  const units = holdUnits(hold ? [hold] : null);
  if (units !== null && units > 0 && capacity.used > 0) {
    const cubicMetresPerUnit = capacity.used / units;
    if (cubicMetresPerUnit > 0 && capacity.capacity - capacity.used < cubicMetresPerUnit) {
      return true;
    }
  }
  return false;
}

/** Every stack sitting in any readable hold — what an unload would move. */
export function holdItemIDs(holds: readonly MiningHold[] | null): readonly number[] {
  if (!holds) {
    return [];
  }
  return holds.flatMap((hold) => (hold.items ?? []).map((item) => item.itemID));
}

/** Total units across the holds, or null when nothing could be read. */
export function holdUnits(holds: readonly MiningHold[] | null): number | null {
  if (!holds) {
    return null;
  }
  let total = 0;
  let sawOne = false;
  for (const hold of holds) {
    if (hold.items === null) {
      continue;
    }
    sawOne = true;
    for (const item of hold.items) {
      total += item.quantity;
    }
  }
  return sawOne ? total : null;
}

/**
 * Is this row a rock a laser can work?
 *
 * Read off the mining fields the gateway projects onto ASTEROID ROWS ONLY
 * (R23 slice B): which ore it yields and which belt it belongs to. Nothing else
 * in the snapshot carries them, so this never mistakes a wreck, a can or a
 * planet for something to mine — and it does not need a category number to say
 * so.
 */
export function isMineableRock(entity: SpaceEntity): boolean {
  return !entity.isSelf && (entity.miningYieldTypeID !== null || entity.beltID !== null);
}

/**
 * Does it still have ore?
 *
 * `remainingQuantity` null is UNKNOWN — the server had no mining record for
 * that rock — and unknown is treated as "worth trying", because the alternative
 * is a client that decides a full belt is mined out. If it really is empty the
 * SERVER refuses the laser and the bot's own bounds move it on. Zero is a real
 * answer and means finished.
 */
export function rockHasOre(entity: SpaceEntity): boolean {
  return entity.remainingQuantity === null || entity.remainingQuantity > 0;
}

/**
 * The lowest health layer the ship reported, or null when it reported none.
 * Unknown is never reassuring and never alarming — it is unknown, and the
 * caller decides what that means where it matters (next to a pirate, it means
 * stop).
 */
export function lowestHealth(snapshot: SpaceSnapshot | null): number | null {
  const ship = snapshot?.ship;
  if (!ship) {
    return null;
  }
  const layers = [ship.shieldRatio, ship.armorRatio, ship.hullRatio].filter(
    (ratio): ratio is number => ratio !== null && Number.isFinite(ratio),
  );
  return layers.length === 0 ? null : Math.min(...layers);
}

function isWarping(shipMode: string | null): boolean {
  return shipMode !== null && /warp/i.test(shipMode);
}

/**
 * The one  reason that must NOT exhaust the rock. A rock is off the
 * grid for the entire trip to the station and back, so treating "not here"
 * as "finished with" empties a belt by bookkeeping alone.
 */
export const OUT_OF_VIEW = "it went out of view";

/** What to CALL a row on screen. Never an id (R7d). */
function rowLabel(entity: SpaceEntity | null): string {
  return entity?.name ?? "that rock";
}

// --- The decision ------------------------------------------------------------

/** Memory the decision reads. It never mutates it — the controller does. */
export interface MiningDecisionMemory {
  readonly currentRockID: number | null;
  readonly exhaustedRockIDs: ReadonlySet<number>;
  readonly approachingTargetID: number | null;
  /** Sticky: once heading home, shields regenerating does not send it back. */
  readonly headingHome: string | null;
  /** Set once the launch bound is spent, so the launch rung stops re-deciding. */
  readonly launchGaveUp: boolean;
  /** Ticks the lasers have run on this rock with the hold not growing. */
  readonly noYieldCycles: number;
}

/**
 * The pure decision. Given one tick's reading of the world, choose ONE action
 * and say why.
 *
 * The ladder, in order — danger, then the hold, then the rock:
 *
 *   1. danger      health floor -> abandon the belt; pirate -> get the drones out
 *   2. docked+ore  unload
 *   3. docked+empty undock
 *   4. hold full   dock at the chosen station (R24's ladder, imported)
 *   5. no rock     pick the nearest one with ore and lock it
 *   6. rock locked switch the mining equipment on
 *   7. depleted    drop it and take the next
 *   8. none left   pause with a plain reason — do NOT wander
 *   9. otherwise   wait
 */
export function decideMiningAction(
  observation: MiningObservation,
  plan: MiningPlan,
  memory: MiningDecisionMemory,
): MiningDecision {
  const { status, snapshot, measurement, lockedTargetIDs, holds } = observation;

  // ── Docked ────────────────────────────────────────────────────────────────
  if (status.docked) {
    // The hold is the authority on whether there is anything to unload. Without
    // it we do not undock: heading back out with a full hold would mine nothing
    // and burn the trip.
    if (holds === null) {
      return { action: { kind: "wait", reason: "reading holds" }, why: "Looking in the hold." };
    }
    const items = holdItemIDs(holds);
    if (items.length > 0) {
      return {
        action: { kind: "unload", itemIDs: items },
        why: "Docked with ore aboard, so it goes into the hangar first.",
      };
    }
    // The hold is empty and confirmed empty. If we came back for a reason
    // other than a full hold, this is where the run ends — going straight back
    // out to the thing that drove us off would be the opposite of safe.
    if (memory.headingHome) {
      return {
        action: { kind: "pause", reason: memory.headingHome },
        why: memory.headingHome,
      };
    }
    return {
      action: { kind: "undock" },
      why: `The hold is empty, so it is time to head back${plan.beltName ? ` to ${plan.beltName}` : " to the belt"}.`,
    };
  }

  if (!status.inSpace) {
    return {
      action: { kind: "wait", reason: "no location" },
      why: "Waiting for the ship to say where it is.",
    };
  }

  // Never act mid-warp: retail returns immediately on DSTBALL_WARP, and so does
  // every loop in this client.
  if (isWarping(status.shipMode) || isWarping(measurement?.shipMode ?? null)) {
    return { action: { kind: "wait", reason: "in warp" }, why: "In warp." };
  }

  // ── 1. Danger first ───────────────────────────────────────────────────────
  //
  // The floor is checked BEFORE the drones on purpose. The goal lists drones
  // first, but once the ship is already under the floor no launch saves it —
  // survival outranks yield, and it outranks defence too.
  const origin = snapshot?.ship?.position ?? { x: 0, y: 0, z: 0 };
  const hostiles = snapshot ? hostileRows(snapshot, origin) : [];
  const health = lowestHealth(snapshot);

  if (health !== null && health < plan.healthFloor) {
    const percent = Math.round(health * 100);
    const reason = `Your ship is down to ${percent}%, so the bot broke off and is heading for ${plan.stationName ?? "the station"}.`;
    const home = travelDecision(plan.stationID, plan.stationName, STATION_DOCKING_RADIUS_M, "dock", observation, memory, reason);
    return { ...home, headHome: reason };
  }

  if (hostiles.length > 0 && health === null) {
    // A pirate is here and we cannot see the shield bar. That is exactly the
    // "cannot tell what is happening" case: say so and stop.
    return {
      action: {
        kind: "pause",
        reason: "There is a pirate here and your ship's condition could not be read, so the bot stopped rather than guess.",
      },
      why: "A pirate is here and the ship's condition could not be read.",
    };
  }

  const nearestHostile = hostiles[0] ?? null;
  if (nearestHostile && plan.useDrones && !memory.launchGaveUp) {
    const shipID = status.shipID ?? snapshot?.shipID ?? null;
    const mine = (snapshot?.entities ?? []).filter((entity) =>
      isMyDrone(entity, plan.myCharacterID, shipID),
    );
    if (mine.length === 0) {
      const bay = observation.droneBayItemIDs;
      if (bay === null) {
        return {
          action: { kind: "wait", reason: "reading drone bay" },
          why: `${nearestHostile.name ?? "A pirate"} is here — looking in the drone bay.`,
        };
      }
      if (bay.length > 0) {
        return {
          action: { kind: "launch", droneItemIDs: bay },
          why: `${nearestHostile.name ?? "A pirate"} is here, so the drones go out — they defend the ship on their own.`,
        };
      }
      // No drones to send. Not an error and not a reason to stop: the health
      // floor above is still armed and is the real protection.
    }
  }

  // ── 2/4. The hold ─────────────────────────────────────────────────────────
  if (memory.headingHome) {
    return travelDecision(
      plan.stationID,
      plan.stationName,
      STATION_DOCKING_RADIUS_M,
      "dock",
      observation,
      memory,
      memory.headingHome,
    );
  }

  const hold = destinationHold(holds);
  const full = holdIsFull(hold);
  if (full === true) {
    return travelDecision(
      plan.stationID,
      plan.stationName,
      STATION_DOCKING_RADIUS_M,
      "dock",
      observation,
      memory,
      `The ${hold?.label.toLowerCase() ?? "hold"} is full, so the load is going to ${plan.stationName ?? "the station"}.`,
    );
  }
  // The lasers have run for minutes on a rock that still has ore and not one
  // unit has arrived. We cannot tell why, so we do not pretend to: if there is
  // ore aboard, take it home; if there is not, stop and say so.
  if (memory.noYieldCycles > MAX_NO_YIELD_CYCLES) {
    const aboard = holdUnits(holds) ?? 0;
    if (aboard > 0) {
      const reason = "The mining equipment has been running for minutes without the hold growing, so the bot is taking what it has back to the station.";
      return {
        ...travelDecision(plan.stationID, plan.stationName, STATION_DOCKING_RADIUS_M, "dock", observation, memory, reason),
        headHome: reason,
      };
    }
    return {
      action: {
        kind: "pause",
        reason: "Your mining equipment says it is running but nothing is arriving in the hold, so the bot stopped rather than claim it is mining.",
      },
      why: "The equipment is running and the hold is not growing.",
    };
  }

  // ── The rock ──────────────────────────────────────────────────────────────
  //
  // GetTargets is the ONLY authority on what is locked. Without it, nothing
  // that depends on a lock may be decided at all.
  if (lockedTargetIDs === null) {
    return {
      action: { kind: "wait", reason: "reading targets" },
      why: "Checking what your ship has locked.",
    };
  }

  const byID = new Map<number, SpaceEntity>();
  for (const entity of snapshot?.entities ?? []) {
    byID.set(entity.itemID, entity);
  }

  // ── 7. Is the rock we are on still worth mining? ──────────────────────────
  const currentRock = memory.currentRockID;
  if (currentRock !== null) {
    const entity = byID.get(currentRock) ?? null;
    if (!entity) {
      return {
        action: { kind: "wait", reason: "rock gone" },
        why: "That rock is no longer in view, so the bot is picking another.",
        dropRock: OUT_OF_VIEW,
      };
    }
    if (!rockHasOre(entity)) {
      return {
        action: { kind: "wait", reason: "rock empty" },
        why: `${rowLabel(entity)} is mined out, so the bot is moving to the next rock.`,
        dropRock: "it was mined out",
      };
    }

    // ── 6. Locked: run the equipment ────────────────────────────────────────
    if (lockedTargetIDs.includes(currentRock)) {
      return runTheLasers(entity, snapshot, plan);
    }

    // ── 5. Ours, but not locked yet: lock it ────────────────────────────────
    return {
      action: {
        kind: "lock",
        targetID: currentRock,
        label: `Lock ${rowLabel(entity)}`,
      },
      why: `Locking ${rowLabel(entity)} — your equipment acts on what you lock.`,
    };
  }

  // ── 5. Pick a rock ────────────────────────────────────────────────────────
  const candidates = (snapshot?.entities ?? [])
    .filter(
      (entity) =>
        isMineableRock(entity) && rockHasOre(entity) && !memory.exhaustedRockIDs.has(entity.itemID),
    )
    .map((entity) => ({
      entity,
      distance: measurement?.distances.get(entity.itemID) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.distance - right.distance);

  if (candidates.length === 0) {
    // ── 8. Nothing to mine. Are we even there yet? ──────────────────────────
    return travelDecision(
      plan.beltID,
      plan.beltName,
      BELT_ARRIVAL_RADIUS_M,
      "belt",
      observation,
      memory,
      `Heading for ${plan.beltName ?? "the belt"}.`,
    );
  }

  const pick = candidates[0];
  if (!pick) {
    return { action: { kind: "wait", reason: "no rock" }, why: "Looking for a rock to mine." };
  }
  const where = Number.isFinite(pick.distance) ? `, ${formatDistance(pick.distance)} away` : "";

  // ALREADY LOCKED? Then adopt it rather than asking for a lock the ship has.
  // The authority says the ball is held — most often because the player locked
  // it themselves before pressing Start — and re-issuing AddTarget for it would
  // spend a whole tick to change nothing. Adopting is a pure memory change, so
  // it costs no tick at all: the same decision goes straight to the lasers.
  if (lockedTargetIDs.includes(pick.entity.itemID)) {
    return { ...runTheLasers(pick.entity, snapshot, plan), takeRock: pick.entity.itemID };
  }

  return {
    action: {
      kind: "lock",
      targetID: pick.entity.itemID,
      label: `Lock ${rowLabel(pick.entity)}`,
    },
    why: `${rowLabel(pick.entity)} is the nearest rock with ore left${where}, so the bot is locking it.`,
    takeRock: pick.entity.itemID,
  };
}

/**
 * RUNG 6 — the rock is locked, so put the equipment on it.
 *
 * One module per tick (at most one atomic call), chosen against
 * `activeModuleIDs`: the SERVER's own answer to what is cycling, never what the
 * loop remembers switching on. A NULL there is "we could not tell", and this
 * never treats that as "off" — switching a laser on twice because the ship
 * would not say is exactly the fabricated progress the loop refuses to make.
 */
function runTheLasers(
  entity: SpaceEntity,
  snapshot: SpaceSnapshot | null,
  plan: MiningPlan,
): MiningDecision {
  const active = snapshot?.ship?.activeModuleIDs ?? null;
  if (active === null) {
    return {
      action: { kind: "wait", reason: "unknown module state" },
      why: "Your ship did not say which equipment is running, so nothing was switched on this time.",
    };
  }
  const nextModule = plan.miningModuleIDs.filter((moduleID) => !active.includes(moduleID))[0];
  if (nextModule !== undefined) {
    return {
      action: {
        kind: "activate",
        moduleID: nextModule,
        targetID: entity.itemID,
        label: `Switch the mining equipment on ${rowLabel(entity)}`,
      },
      why: `${rowLabel(entity)} is locked, so the mining equipment goes on.`,
    };
  }
  const remaining =
    entity.remainingQuantity === null
      ? ""
      : ` (${entity.remainingQuantity.toLocaleString()} units left)`;
  return {
    action: { kind: "wait", reason: "mining" },
    why: `Mining ${rowLabel(entity)}${remaining}.`,
  };
}

/**
 * Close on something and then do the thing — the autopilot's own three rungs
 * (`decideCloseIn`), with the arrival step supplied by the caller.
 *
 * `arrival: "dock"` is R24 slice B's Dock, including its 2,500 m SURFACE gate;
 * `arrival: "belt"` arrives by simply being there, and then reports that the
 * belt has nothing left — which is rung 8, and the reason it does not wander.
 */
function travelDecision(
  targetID: number,
  targetName: string | null,
  interactionRadiusM: number,
  arrival: "dock" | "belt",
  observation: MiningObservation,
  memory: MiningDecisionMemory,
  why: string,
): MiningDecision {
  const name = targetName ?? (arrival === "dock" ? "the station" : "the belt");
  const step = decideCloseIn(
    targetID,
    interactionRadiusM,
    observation.measurement,
    memory.approachingTargetID,
  );

  // Not measurable this tick — the belt or station is not on the snapshot's
  // grid, which is the normal case for somewhere you have not flown to yet.
  // Warp is the right call and the warp bound catches one that never starts.
  if (step === null) {
    return { action: { kind: "warp", destinationID: targetID, label: `Warp to ${name}` }, why };
  }

  switch (step.kind) {
    case "warp":
      return { action: { kind: "warp", destinationID: targetID, label: `Warp to ${name}` }, why };
    case "approach":
      return {
        action: { kind: "approach", destinationID: targetID, label: `Approach ${name}` },
        why,
      };
    case "closing":
      return { action: { kind: "wait", reason: "closing in" }, why: `Closing in on ${name}.` };
    case "arrive":
      if (arrival === "dock") {
        return { action: { kind: "dock", stationID: targetID, label: `Dock at ${name}` }, why };
      }
      // ── 8. At the belt with nothing left to mine. Stop; do not wander. ────
      return {
        action: {
          kind: "pause",
          reason: `There are no rocks with ore left at ${name}. Pick another belt and start the bot again.`,
        },
        why: `${name} has nothing left to mine.`,
      };
  }
}

// --- The controller ----------------------------------------------------------

/** Everything the loop needs from the outside — all injectable for tests. */
export interface MiningBotDeps {
  getStatus(): Promise<FlightStatus>;
  getSpaceSnapshot(): Promise<SpaceSnapshot | null>;
  /** dogmaIM.GetTargets. Return null when the read failed — never []. */
  getLockedTargetIDs(): Promise<readonly number[] | null>;
  /** The ship's mining holds. Return null when the read failed — never []. */
  getHolds(): Promise<readonly MiningHold[] | null>;
  /** The drone bay's stacks. Only read when a launch is being considered. */
  getDroneBayItemIDs(): Promise<readonly number[] | null>;
  undock(): Promise<void>;
  warp(destinationID: number): Promise<void>;
  approach(destinationID: number): Promise<void>;
  dock(stationID: number): Promise<void>;
  lockTarget(targetID: number): Promise<void>;
  activateModule(moduleID: number, targetID: number): Promise<void>;
  launchDrones(itemIDs: readonly number[]): Promise<void>;
  unloadHolds(itemIDs: readonly number[]): Promise<void>;
  sleep(ms: number): Promise<void>;
  onProgress(progress: MiningBotProgress): void;
  isSessionLost(error: unknown): boolean;
  refusalReason(error: unknown): string;
}

export interface MiningBotController {
  start(plan: MiningPlan): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** One decision cycle: read, decide, issue at most one atomic call. */
  tick(): Promise<MiningBotAction>;
  /** Drive until the loop leaves the running state (production driver). */
  run(): Promise<void>;
  snapshot(): MiningBotProgress;
}

interface BotMemory {
  status: MiningBotStatus;
  phase: string | null;
  action: string | null;
  why: string | null;
  rockName: string | null;
  failureReason: string | null;
  settleTicks: number;
  currentRockID: number | null;
  exhaustedRockIDs: Set<number>;
  approachingTargetID: number | null;
  headingHome: string | null;
  launchGaveUp: boolean;
  noYieldCycles: number;
  // Every one of these counts CONSECUTIVE decisions of one kind whose authority
  // has not changed. A landed action resets its own counter by construction,
  // because the decision stops choosing it.
  lockTargetID: number | null;
  lockAttempts: number;
  consecutiveLockFailures: number;
  activateModuleID: number | null;
  activateAttempts: number;
  launchAttempts: number;
  unloadAttempts: number;
  undockAttempts: number;
  warpTargetID: number | null;
  warpAttempts: number;
  silentDockAttempts: number;
  closeInCycles: number;
  statusReadFailures: number;
  cyclesCompleted: number;
  oreUnitsMined: number;
  lastHoldUnits: number | null;
  holdUsed: number | null;
  holdCapacity: number | null;
}

function freshMemory(): BotMemory {
  return {
    status: "idle",
    phase: null,
    action: null,
    why: null,
    rockName: null,
    failureReason: null,
    settleTicks: 0,
    currentRockID: null,
    exhaustedRockIDs: new Set<number>(),
    approachingTargetID: null,
    headingHome: null,
    launchGaveUp: false,
    noYieldCycles: 0,
    lockTargetID: null,
    lockAttempts: 0,
    consecutiveLockFailures: 0,
    activateModuleID: null,
    activateAttempts: 0,
    launchAttempts: 0,
    unloadAttempts: 0,
    undockAttempts: 0,
    warpTargetID: null,
    warpAttempts: 0,
    silentDockAttempts: 0,
    closeInCycles: 0,
    statusReadFailures: 0,
    cyclesCompleted: 0,
    oreUnitsMined: 0,
    lastHoldUnits: null,
    holdUsed: null,
    holdCapacity: null,
  };
}

/**
 * The phase label, decided from WHERE the move is aimed rather than from the
 * heading-home flag.
 *
 * ⚠ FROM THE LIVE RUN: a full hold sets no flag — it does not need one, the hold
 * says it every tick — so keying the label off `headingHome` had the readout
 * announce "Flying to the belt" while the ship warped to the station with a full
 * load. The reason line was right and the phase contradicted it, which is worse
 * than no phase at all in a panel whose whole job is being interrogable.
 */
function phaseFor(action: MiningBotAction, plan: MiningPlan): string {
  switch (action.kind) {
    case "undock":
      return "Leaving the station";
    case "warp":
      return action.destinationID === plan.stationID ? "Hauling" : "Flying to the belt";
    case "approach":
      return action.destinationID === plan.stationID ? "Hauling" : "Flying to the belt";
    case "dock":
      return "Docking";
    case "unload":
      return "Unloading";
    case "lock":
      return "Locking a rock";
    case "activate":
      return "Starting the equipment";
    case "launch":
      return "Defending";
    case "pause":
      return "Stopped";
    case "stopped":
      return "Stopped";
    case "wait":
      return action.reason === "mining" ? "Mining" : "Working";
  }
}

function actionText(action: MiningBotAction): string {
  switch (action.kind) {
    case "undock":
      return "Undocking";
    case "warp":
    case "approach":
    case "dock":
    case "lock":
    case "activate":
      return action.label;
    case "unload":
      return `Unloading ${action.itemIDs.length} ${action.itemIDs.length === 1 ? "stack" : "stacks"}`;
    case "launch":
      return "Launching drones";
    case "wait":
      return "Working";
    case "pause":
      return "Stopped";
    case "stopped":
      return "Stopped";
  }
}

export function createMiningBot(deps: MiningBotDeps): MiningBotController {
  let memory = freshMemory();
  let plan: MiningPlan | null = null;
  // Bumped on pause/stop/start so a stale in-flight run() loop stops driving.
  let runToken = 0;

  function snapshot(): MiningBotProgress {
    return {
      status: memory.status,
      phase: memory.phase,
      action: memory.action,
      why: memory.why,
      rockName: memory.rockName,
      cyclesCompleted: memory.cyclesCompleted,
      oreUnitsMined: memory.oreUnitsMined,
      holdUsed: memory.holdUsed,
      holdCapacity: memory.holdCapacity,
      failureReason: memory.failureReason,
    };
  }

  function emit(): void {
    deps.onProgress(snapshot());
  }

  function setPause(reason: string): void {
    memory.status = "paused";
    memory.failureReason = reason;
    memory.phase = "Stopped";
    memory.action = null;
    memory.why = reason;
    runToken += 1;
  }

  function setError(reason: string): void {
    memory.status = "error";
    memory.failureReason = reason;
    memory.phase = "Stopped";
    memory.action = null;
    memory.why = reason;
    runToken += 1;
  }

  /**
   * Let go of the rock we were on and take the next one.
   *
   * `exhaust` is the difference between "this rock is finished with" and "this
   * rock is not here right now", and conflating them is a real bug this loop
   * had: a rock is off the grid for the whole haul home, so forgetting it as
   * EXHAUSTED meant the bot came back to a belt it had emptied by bookkeeping
   * and stopped. Only a rock that is mined out, or one the ship demonstrably
   * cannot work, is exhausted. Out of view is just out of view.
   */
  function dropRock(exhaust: boolean): void {
    if (exhaust && memory.currentRockID !== null) {
      memory.exhaustedRockIDs.add(memory.currentRockID);
    }
    memory.currentRockID = null;
    memory.rockName = null;
    memory.lockTargetID = null;
    memory.lockAttempts = 0;
    memory.activateModuleID = null;
    memory.activateAttempts = 0;
    memory.noYieldCycles = 0;
  }

  /**
   * ORE, counted from the authority. The hold growing is the only evidence this
   * loop accepts that mining happened — never a cycle count, never a yield sum,
   * never a module that answered 200.
   */
  function countOre(holds: readonly MiningHold[] | null): void {
    const hold = destinationHold(holds);
    memory.holdUsed = hold?.capacity?.used ?? null;
    memory.holdCapacity = hold?.capacity?.capacity ?? null;

    const units = holdUnits(holds);
    if (units === null) {
      return;
    }
    if (memory.lastHoldUnits !== null && units > memory.lastHoldUnits) {
      memory.oreUnitsMined += units - memory.lastHoldUnits;
      // Ore arrived, so the lasers are producing: the stall clock restarts.
      memory.noYieldCycles = 0;
    }
    memory.lastHoldUnits = units;
  }

  /** Read what this tick needs. Each read is independent and may fail alone. */
  async function observe(status: FlightStatus, current: MiningPlan): Promise<MiningObservation> {
    if (status.docked) {
      // Docked, nothing in space to read: the hold is the whole world.
      return {
        status,
        snapshot: null,
        measurement: null,
        lockedTargetIDs: null,
        holds: await safely(() => deps.getHolds()),
        droneBayItemIDs: null,
      };
    }
    const [space, locked, holds] = await Promise.all([
      safely(() => deps.getSpaceSnapshot()),
      safely(() => deps.getLockedTargetIDs()),
      safely(() => deps.getHolds()),
    ]);
    // The bay is only read when a launch is actually on the table — it is a
    // real call, and polling it every tick for a belt with no pirates in it
    // would be load for nothing.
    let bay: readonly number[] | null = null;
    if (current.useDrones && !memory.launchGaveUp && space) {
      const origin = space.ship?.position ?? { x: 0, y: 0, z: 0 };
      const shipID = status.shipID ?? space.shipID ?? null;
      const mine = space.entities.filter((entity) =>
        isMyDrone(entity, current.myCharacterID, shipID),
      );
      if (hostileRows(space, origin).length > 0 && mine.length === 0) {
        bay = await safely(() => deps.getDroneBayItemIDs());
      }
    }
    return {
      status,
      snapshot: space,
      measurement: measureSpace(space),
      lockedTargetIDs: locked,
      holds,
      droneBayItemIDs: bay,
    };
  }

  /**
   * A read that failed is a read that failed — null, never a confident empty.
   * A LOST SESSION is different and is allowed to propagate: the run is over.
   */
  async function safely<T>(read: () => Promise<T | null>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (deps.isSessionLost(error)) {
        throw error;
      }
      return null;
    }
  }

  /**
   * BOUND THE BRANCH. Each counter tracks consecutive decisions of one kind
   * whose authority still says the thing has not happened. Anything else resets
   * it. Returns false when the bound is spent and the loop has already stopped
   * or moved on.
   */
  function bound(action: MiningBotAction): boolean {
    // Lock — bounded per ROCK. Spending it gives up on the rock, not the run,
    // unless nothing at all will lock (MAX_CONSECUTIVE_LOCK_FAILURES).
    if (action.kind === "lock") {
      if (memory.lockTargetID === action.targetID) {
        memory.lockAttempts += 1;
      } else {
        memory.lockTargetID = action.targetID;
        memory.lockAttempts = 1;
      }
      if (memory.lockAttempts > MAX_LOCK_ATTEMPTS) {
        memory.consecutiveLockFailures += 1;
        const name = memory.rockName ?? "that rock";
        if (memory.consecutiveLockFailures >= MAX_CONSECUTIVE_LOCK_FAILURES) {
          setPause(
            `Your ship would not lock anything here after trying ${MAX_CONSECUTIVE_LOCK_FAILURES} rocks, so the bot stopped.`,
          );
          return false;
        }
        memory.why = `${name} would not lock, so the bot is trying a different rock.`;
        // This one IS exhausted: the ship has been asked to lock it and will not.
        dropRock(true);
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.lockTargetID = null;
      memory.lockAttempts = 0;
    }

    // Activate — bounded per MODULE. Spending it PAUSES: a laser the ship keeps
    // reporting as off after three tries is the "we cannot tell what happened"
    // case, and this loop says so rather than carrying on as if it were mining.
    if (action.kind === "activate") {
      if (memory.activateModuleID === action.moduleID) {
        memory.activateAttempts += 1;
      } else {
        memory.activateModuleID = action.moduleID;
        memory.activateAttempts = 1;
      }
      if (memory.activateAttempts > MAX_ACTIVATE_ATTEMPTS) {
        setPause(
          "Your mining equipment was switched on three times and your ship still reports it as off, so the bot stopped rather than pretend it is mining.",
        );
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.activateModuleID = null;
      memory.activateAttempts = 0;
    }

    // Launch — bounded, and spending it HEADS HOME rather than pausing. A ship
    // that cannot get its drones out next to a pirate should leave, not sit.
    if (action.kind === "launch") {
      memory.launchAttempts += 1;
      if (memory.launchAttempts > MAX_LAUNCH_ATTEMPTS) {
        memory.launchGaveUp = true;
        memory.headingHome =
          "Your drones would not launch and there is a pirate here, so the bot is heading back to the station.";
        memory.why = memory.headingHome;
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.launchAttempts = 0;
    }

    // Unload — bounded. The hold still holding the ore after three tries is a
    // stop: the alternative is undocking with a full hold, over and over.
    if (action.kind === "unload") {
      memory.unloadAttempts += 1;
      if (memory.unloadAttempts > MAX_UNLOAD_ATTEMPTS) {
        setPause("The ore would not move into the hangar, so the bot stopped with it still aboard.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.unloadAttempts = 0;
    }

    // Undock — bounded, against flight status still saying docked.
    if (action.kind === "undock") {
      memory.undockAttempts += 1;
      if (memory.undockAttempts > MAX_UNDOCK_ATTEMPTS) {
        setPause("The ship would not undock, so the bot stopped.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.undockAttempts = 0;
    }

    // Warp — R24 slice A's bound, unchanged: this server answers 200 to a warp
    // it silently refuses, so a warp that changes nothing must not repeat.
    if (action.kind === "warp") {
      if (memory.warpTargetID === action.destinationID) {
        memory.warpAttempts += 1;
      } else {
        memory.warpTargetID = action.destinationID;
        memory.warpAttempts = 1;
      }
      if (memory.warpAttempts > MAX_WARP_ATTEMPTS) {
        setPause("The warp did not start and the ship has not moved, so the bot stopped.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.warpTargetID = null;
      memory.warpAttempts = 0;
    }

    // Dock — R24 slice B's bound, unchanged: `Handle_CmdDock` can answer 200
    // and seat nobody, and docked-ness is read back out of FLIGHT STATUS.
    if (action.kind === "dock") {
      memory.silentDockAttempts += 1;
      if (memory.silentDockAttempts > MAX_SILENT_DOCK_ATTEMPTS) {
        setPause("The station accepted the request but has not taken the ship, so the bot stopped.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.silentDockAttempts = 0;
    }

    // A running approach is waited on, not restarted — and the wait is bounded,
    // so a ship that can never close still stops rather than waiting forever.
    if (action.kind === "wait" && action.reason === "closing in") {
      memory.closeInCycles += 1;
      if (memory.closeInCycles > MAX_CLOSE_IN_CYCLES) {
        setPause("The ship is not getting any closer, so the bot stopped.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.closeInCycles = 0;
    }

    return true;
  }

  /** Issue AT MOST ONE atomic call and record what it means for memory. */
  async function issue(action: MiningBotAction): Promise<void> {
    if (memory.status !== "running") {
      return;
    }
    try {
      switch (action.kind) {
        case "undock":
          await deps.undock();
          memory.settleTicks = SETTLE_UNDOCK;
          return;
        case "warp":
          await deps.warp(action.destinationID);
          memory.approachingTargetID = null;
          memory.settleTicks = SETTLE_WARP;
          return;
        case "approach":
          await deps.approach(action.destinationID);
          memory.approachingTargetID = action.destinationID;
          memory.closeInCycles = 0;
          memory.settleTicks = SETTLE_APPROACH;
          return;
        case "dock":
          await deps.dock(action.stationID);
          memory.approachingTargetID = null;
          memory.settleTicks = SETTLE_DOCK;
          return;
        case "unload":
          await deps.unloadHolds(action.itemIDs);
          memory.settleTicks = SETTLE_UNLOAD;
          return;
        case "lock":
          await deps.lockTarget(action.targetID);
          memory.settleTicks = SETTLE_LOCK;
          return;
        case "activate":
          await deps.activateModule(action.moduleID, action.targetID);
          memory.settleTicks = SETTLE_ACTIVATE;
          return;
        case "launch":
          await deps.launchDrones(action.droneItemIDs);
          memory.settleTicks = SETTLE_LAUNCH;
          return;
        default:
          return;
      }
    } catch (error) {
      await handleActionError(action, error);
    }
  }

  /** True when a refusal is the server saying "you are too far away". */
  function isRangeRefusal(reason: string): boolean {
    return /range|too far|not close|distance|closer/i.test(reason);
  }

  async function handleActionError(action: MiningBotAction, error: unknown): Promise<void> {
    if (deps.isSessionLost(error)) {
      setError("The live session ended (idle timeout or another client took over).");
      return;
    }
    const reason = deps.refusalReason(error);

    if (action.kind === "undock" && /already in space|already_in_space/i.test(reason)) {
      // Benign: we wanted to be in space and we are.
      memory.settleTicks = SETTLE_UNDOCK;
      return;
    }

    // THE SERVER OWNS THE RULES. A lock or a laser refused for RANGE is the
    // server telling us to close in — which is a real answer, not a failure, so
    // we close in and try again rather than reimplementing a range check the
    // server already has. Bounded by the close-in cycle counter.
    if ((action.kind === "lock" || action.kind === "activate") && isRangeRefusal(reason)) {
      memory.why = `${memory.rockName ?? "That rock"} is out of range, so the ship is closing in.`;
      memory.closeInCycles += 1;
      if (memory.closeInCycles > MAX_CLOSE_IN_CYCLES) {
        setPause("The ship could not get close enough to mine, so the bot stopped.");
        return;
      }
      memory.approachingTargetID = action.targetID;
      await issueApproach(action.targetID);
      return;
    }

    if (action.kind === "dock") {
      // The server REFUSED and said why, so this is not the silent-decline
      // case; it is R24's DockingApproach and the loop re-issues.
      if (isRangeRefusal(reason) || /dockingapproach|docking approach|approach/i.test(reason)) {
        memory.silentDockAttempts = 0;
        memory.settleTicks = SETTLE_DOCK;
        return;
      }
      setPause(`The station refused to take the ship: ${reason}`);
      return;
    }

    if (action.kind === "warp" && /already within warp|within warp distance|too close to warp/i.test(reason)) {
      memory.settleTicks = SETTLE_APPROACH;
      return;
    }

    // Anything else: do not guess. Stop and show the server's own words.
    setPause(`${actionText(action)} was refused: ${reason}`);
  }

  /** The one place an approach is issued outside the ladder (a range refusal). */
  async function issueApproach(targetID: number): Promise<void> {
    if (memory.status !== "running") {
      return;
    }
    try {
      await deps.approach(targetID);
      memory.settleTicks = SETTLE_APPROACH;
    } catch (error) {
      if (deps.isSessionLost(error)) {
        setError("The live session ended (idle timeout or another client took over).");
        return;
      }
      setPause(`The ship could not close in: ${deps.refusalReason(error)}`);
    }
  }

  async function tick(): Promise<MiningBotAction> {
    if (memory.status !== "running" || !plan) {
      return memory.status === "stopped"
        ? { kind: "stopped" }
        : { kind: "wait", reason: memory.failureReason ?? "not running" };
    }
    const current = plan;

    let status: FlightStatus;
    try {
      status = await deps.getStatus();
      memory.statusReadFailures = 0;
    } catch (error) {
      if (deps.isSessionLost(error)) {
        setError("The live session ended (idle timeout or another client took over).");
        emit();
        return { kind: "pause", reason: memory.failureReason ?? "session lost" };
      }
      memory.statusReadFailures += 1;
      if (memory.statusReadFailures > MAX_READ_FAILURES) {
        setPause(
          `Your ship's status could not be read after ${memory.statusReadFailures} tries, so the bot stopped: ${deps.refusalReason(error)}`,
        );
        emit();
        return { kind: "pause", reason: memory.failureReason ?? "status read failed" };
      }
      memory.phase = "Reconnecting";
      memory.why = "Waiting for your ship to answer.";
      emit();
      return { kind: "wait", reason: "status read retry" };
    }

    if (memory.status !== "running") {
      emit();
      return { kind: memory.status === "stopped" ? "stopped" : "wait", reason: "stopped" };
    }

    // Settle window: let the last move begin before re-deciding.
    if (memory.settleTicks > 0) {
      memory.settleTicks -= 1;
      memory.phase = "Working";
      memory.action = "Waiting for the last move to take effect";
      emit();
      return { kind: "wait", reason: "settling" };
    }

    let observation: MiningObservation;
    try {
      observation = await observe(status, current);
    } catch (error) {
      if (deps.isSessionLost(error)) {
        setError("The live session ended (idle timeout or another client took over).");
        emit();
        return { kind: "pause", reason: memory.failureReason ?? "session lost" };
      }
      emit();
      return { kind: "wait", reason: "read failed" };
    }
    if (memory.status !== "running") {
      emit();
      return { kind: memory.status === "stopped" ? "stopped" : "wait", reason: "stopped" };
    }

    // Ore is counted from the hold BEFORE the decision, so the readout and the
    // "is it actually producing" clock are both looking at this tick's truth.
    countOre(observation.holds);

    const decision = decideMiningAction(observation, current, {
      currentRockID: memory.currentRockID,
      exhaustedRockIDs: memory.exhaustedRockIDs,
      approachingTargetID: memory.approachingTargetID,
      headingHome: memory.headingHome,
      launchGaveUp: memory.launchGaveUp,
      noYieldCycles: memory.noYieldCycles,
    });

    // Record what the decision discovered.
    if (decision.headHome && !memory.headingHome) {
      memory.headingHome = decision.headHome;
    }
    if (decision.takeRock !== undefined) {
      memory.currentRockID = decision.takeRock;
      memory.rockName =
        observation.snapshot?.entities.find((entity) => entity.itemID === decision.takeRock)?.name ??
        null;
      memory.noYieldCycles = 0;
    }
    if (decision.dropRock) {
      // A mined-out rock is finished with for good; one that has merely left
      // the grid (the whole haul home, every time) is not.
      dropRock(decision.dropRock !== OUT_OF_VIEW);
    }
    // The stall clock only runs while the loop believes it is mining.
    if (decision.action.kind === "wait" && decision.action.reason === "mining") {
      memory.noYieldCycles += 1;
    }

    memory.why = decision.why;
    memory.action = actionText(decision.action);
    memory.phase = phaseFor(decision.action, current);

    if (decision.action.kind === "pause") {
      setPause(decision.action.reason);
      emit();
      return decision.action;
    }
    if (decision.action.kind === "wait") {
      if (!bound(decision.action)) {
        emit();
        return { kind: "wait", reason: "bounded" };
      }
      emit();
      return decision.action;
    }

    if (!bound(decision.action)) {
      emit();
      return { kind: "wait", reason: "bounded" };
    }

    emit();
    await issue(decision.action);
    // Docking is the only thing that completes a haul, and it is only complete
    // once the HOLD says the ore left — which the docked branch confirms next
    // tick. Count the haul when an unload is issued against a hold that then
    // reads empty; see the docked branch and MAX_UNLOAD_ATTEMPTS.
    if (decision.action.kind === "unload") {
      const after = await safely(() => deps.getHolds()).catch(() => null);
      if (after !== null && holdItemIDs(after).length === 0) {
        memory.cyclesCompleted += 1;
        memory.lastHoldUnits = 0;
        // A completed haul is real progress, so rocks that merely would not
        // lock get another chance on the next trip. Depleted ones re-exhaust
        // immediately from `remainingQuantity`, so this cannot loop.
        memory.exhaustedRockIDs.clear();
        memory.consecutiveLockFailures = 0;
      }
    }
    emit();
    return decision.action;
  }

  async function run(): Promise<void> {
    const token = runToken;
    while (token === runToken && memory.status === "running") {
      await tick();
      if (token !== runToken || memory.status !== "running") {
        break;
      }
      await deps.sleep(MINING_BOT_CADENCE_MS);
    }
  }

  return {
    start(nextPlan: MiningPlan): void {
      plan = nextPlan;
      memory = freshMemory();
      memory.status = "running";
      memory.phase = "Starting";
      memory.why = `Starting at ${nextPlan.beltName ?? "the belt"}, hauling to ${nextPlan.stationName ?? "the station"}.`;
      runToken += 1;
      emit();
    },
    pause(): void {
      if (memory.status === "running") {
        memory.status = "paused";
        memory.phase = "Paused";
        memory.action = null;
        memory.why = "You paused the bot. Your ship keeps doing whatever it was last told to.";
        runToken += 1;
        emit();
      }
    },
    resume(): void {
      if (memory.status === "paused") {
        memory.status = "running";
        memory.failureReason = null;
        memory.phase = "Resuming";
        memory.why = "Picking up where it left off.";
        runToken += 1;
        emit();
      }
    },
    stop(): void {
      if (memory.status === "running" || memory.status === "paused") {
        memory.status = "stopped";
        memory.phase = "Stopped";
        memory.action = null;
        memory.why = "You stopped the bot. It will not send your ship any more orders.";
        runToken += 1;
        emit();
      }
    },
    tick,
    run,
    snapshot,
  };
}
