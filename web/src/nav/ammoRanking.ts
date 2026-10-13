// Ammo by target — the ranking and the swap gate behind §3 and §5.2 of
// docs/fleet-companion-combat-plan.md.
//
// Today a gun is loaded with the largest compatible cargo stack, and only when
// it is empty. The operator agreed to rank charges against the target, with
// five rules, and this module is those rules and nothing else (it reads no
// store, no bridge and no clock; `nowMs` is passed in):
//
//   1. The pilot may not carry the right ammo. Then nothing changes: with one
//      type aboard, or with nothing better, the answer is "keep", and an empty
//      gun still gets the largest stack, which is today's rule.
//   2. Ammo changes RANGE as well as damage. A charge that takes the target out
//      of reach is worse than any that keeps it in reach, whatever its damage
//      type. Less damage applied beats none.
//   3. No flicker. A reload is seconds of zero damage per gun, so a rat
//      drifting x, x+1, x across a range edge must never toggle ammo.
//   4. Closing in beats reloading, whenever the ship can move (`canClose`).
//   5. Swap between targets, not mid-target: on the lock-ahead tick the ranking
//      is for the NEXT target and the gun can come up already loaded for it.
//
// ─── WHY EACH NUMBER IS THE NUMBER ───────────────────────────────────────────
//
// AMMO_RANGE_HYSTERESIS_M = 500 m, CAPPED AT A QUARTER OF THE CHARGE'S REACH.
// The same rule as the positioning rung's `REACH_HYSTERESIS_M`
// (combatPosition.ts), so the ammo and the positioning agree about where a
// gun's edge is. ⚠ NOT kiteBand's 2 km: that number is for re-aiming a
// keep-at-range, and as a reach margin it would mean a charge reaching 1.5 km
// (blaster ammo) could never be counted as entering reach at all.
//
// AMMO_SWAP_PERSIST_TICKS = 5. The tree runs on a ~2 s cadence, so five
// consecutive ticks of the same verdict is ~10 s: longer than any wobble a rat
// makes around an edge, shorter than a fight worth swapping for.
//
// AMMO_SWAP_COOLDOWN_MS = 60 000. Persistence stops a flicker inside one
// verdict; the cooldown stops a SLOW flicker, a rat that crosses the edge every
// twenty seconds and would otherwise cost a reload each time. A minute is
// several reloads' worth of firing time.
//
// AMMO_SWAP_MIN_GAIN = 0.25. A reload throws away its seconds of silence, so a
// loaded charge that is hitting is only replaced for a clearly better one. Ten
// per cent more damage never pays back a reload on a target that dies in a
// minute; a quarter more usually does.
//
// ─── THE NON-OBVIOUS CHOICES ─────────────────────────────────────────────────
//
// ⚠ THE REACH EDGE IS STICKY FOR THE LOADED CHARGE ONLY. The loaded charge
// counts as in reach until the target is hysteresis BEYOND its reach; any other
// charge must have the target hysteresis INSIDE its reach before it counts.
// The two thresholds sit 2 x hysteresis apart, so a distance wobbling across
// either one can never make the ranking and the swap gate disagree about who is
// in reach, in both directions: leaving the loaded charge needs a clear
// departure, and entering another needs a clear arrival. Applying the sticky
// test to every charge would let two charges each "keep" the target in reach.
//
// ⚠ UNKNOWN DAMAGE NEVER TRIGGERS A SWAP WHILE THE LOADED CHARGE IS HITTING.
// A swap costs seconds of zero damage and the gain is a guess; a guess on
// either side of the comparison is not a reason to throw away a charge that is
// working. Unknown damage still RANKS (below any known figure), because an
// empty gun must load something, and an out-of-reach loaded charge still
// swaps: that case is about reach, not damage.
//
// ⚠ nextTargetMoment IS EXEMPT FROM PERSISTENCE, THE COOLDOWN, THE ONE-PER-TARGET
// LIMIT AND THE REMAINING-HP CHECK, AND FROM NOTHING ELSE. On the lock-ahead
// tick the current target is nearly dead and the ranking is for a different
// one, so there is no wobble to wait out, no fight being interrupted, and the
// "remaining HP versus the reload's silence" test would be asking about a target
// that is about to die anyway. The gain and reach tests still apply: a swap that
// is not better is not made better by timing.
//
// ⚠ A SWAP IS NOT A LOAD. An empty gun is always loaded (nothing is thrown
// away), does not stamp the cooldown and does not count against the target.
//
// The caller should include the loaded charge among the options it ranks (with
// the quantity it would have), so the sticky test and the comparison both have
// something to compare. If it is missing, a better charge simply wins the
// ranking and the gain gate compares against `loaded` directly.
//
// `why` strings are shown to the player: plain ASCII, no names (the caller
// words the names in).

export const AMMO_RANGE_HYSTERESIS_M = 500;
export const AMMO_SWAP_PERSIST_TICKS = 5;
export const AMMO_SWAP_COOLDOWN_MS = 60_000;
export const AMMO_SWAP_MIN_GAIN = 0.25;

export interface ChargeOption {
  /** Cargo stack item id (tie-break: lower wins). */
  readonly itemID: number;
  readonly typeID: number;
  readonly quantity: number;
  /** The reach THIS gun would have with this charge loaded; null when unknown. */
  readonly reachM: number | null;
  /** Raw per-shot damage split; null when unknown. */
  readonly damage: {
    readonly em: number;
    readonly thermal: number;
    readonly kinetic: number;
    readonly explosive: number;
  } | null;
}

/** Damage multipliers (resonances, 0..1, 1 = no resist) of the layer being hit. */
export interface Resonances {
  readonly em: number;
  readonly thermal: number;
  readonly kinetic: number;
  readonly explosive: number;
}

/**
 * Which layer is being hit: the first of shield / armor / hull whose ratio is
 * below 1. All 1, or unknown (null), is shield: an unreadable ratio is not a
 * damaged one.
 */
export function layerUnderFire(
  shieldRatio: number | null,
  armorRatio: number | null,
  hullRatio: number | null,
): "shield" | "armor" | "hull" {
  if (shieldRatio !== null && shieldRatio < 1) return "shield";
  if (armorRatio !== null && armorRatio < 1) return "armor";
  if (hullRatio !== null && hullRatio < 1) return "hull";
  return "shield";
}

/**
 * Sum of damage x resonance for one shot; null when the damage is unknown.
 * Unknown resonances (null) are treated as no resist at all (1 each), so the
 * ranking falls back to raw damage.
 */
export function appliedDamage(
  charge: ChargeOption,
  resonances: Resonances | null,
): number | null {
  const d = charge.damage;
  if (d === null) return null;
  const r = resonances ?? { em: 1, thermal: 1, kinetic: 1, explosive: 1 };
  return d.em * r.em + d.thermal * r.thermal + d.kinetic * r.kinetic + d.explosive * r.explosive;
}

/**
 * Is the target inside this charge's reach? Unknown reach or unknown distance
 * is "in reach": nothing is known to be wrong. `sticky` is the loaded charge's
 * test (reach + hysteresis); otherwise reach - hysteresis.
 */
function inReach(
  charge: ChargeOption,
  distanceM: number | null,
  sticky: boolean,
  hysteresisM: number,
): boolean {
  if (charge.reachM === null || distanceM === null) return true;
  const margin = Math.min(hysteresisM, charge.reachM / 4);
  return sticky
    ? distanceM <= charge.reachM + margin
    : distanceM <= charge.reachM - margin;
}

/**
 * Rank the options, best first: (1) in reach (sticky for the loaded type only),
 * (2) higher applied damage, unknown below known, (3) larger quantity,
 * (4) lower item id.
 */
export function rankCharges(
  options: readonly ChargeOption[],
  targetDistanceM: number | null,
  resonances: Resonances | null,
  loadedTypeID: number | null,
  hysteresisM: number = AMMO_RANGE_HYSTERESIS_M,
): readonly ChargeOption[] {
  const keyed = options.map((o) => ({
    o,
    reach: inReach(o, targetDistanceM, loadedTypeID !== null && o.typeID === loadedTypeID, hysteresisM),
    dmg: appliedDamage(o, resonances),
  }));
  keyed.sort((a, b) => {
    if (a.reach !== b.reach) return a.reach ? -1 : 1;
    if (a.dmg !== b.dmg) {
      if (a.dmg === null) return 1;
      if (b.dmg === null) return -1;
      return b.dmg - a.dmg;
    }
    if (a.o.quantity !== b.o.quantity) return b.o.quantity - a.o.quantity;
    return a.o.itemID - b.o.itemID;
  });
  return keyed.map((k) => k.o);
}

/** Per-gun memory the caller stores between ticks. */
export interface SwapMemory {
  readonly wantedTypeID: number | null;
  readonly wantedTicks: number;
  readonly lastSwapAtMs: number | null;
  readonly swappedForTargetID: number | null;
}

export const FRESH_SWAP_MEMORY: SwapMemory = {
  wantedTypeID: null,
  wantedTicks: 0,
  lastSwapAtMs: null,
  swappedForTargetID: null,
};

export interface SwapInputs {
  /** From rankCharges. */
  readonly ranked: readonly ChargeOption[];
  /** What is in the gun now; null = empty (a load is always allowed, not a swap). */
  readonly loaded: ChargeOption | null;
  readonly targetDistanceM: number | null;
  readonly resonances: Resonances | null;
  readonly targetID: number | null;
  /** Effective HP left on the target; null unknown. */
  readonly targetRemainingHp: number | null;
  /** Damage the gun would deal during the reload's silence if it kept firing; null unknown. */
  readonly gunDpsWhileReloading: number | null;
  /** The ship can still close the range instead (positioning rung not exhausted). */
  readonly canClose: boolean;
  /** Lock-ahead tick: the ranking is for the NEXT target; the current one is nearly dead. */
  readonly nextTargetMoment: boolean;
  readonly nowMs: number;
  readonly memory: SwapMemory;
}

export type SwapDecision =
  | { readonly kind: "load"; readonly charge: ChargeOption; readonly memory: SwapMemory; readonly why: string }
  | { readonly kind: "swap"; readonly charge: ChargeOption; readonly memory: SwapMemory; readonly why: string }
  | { readonly kind: "keep"; readonly memory: SwapMemory; readonly why: string };

export function decideSwap(inputs: SwapInputs): SwapDecision {
  const { ranked, loaded, memory, nowMs, nextTargetMoment } = inputs;
  const cleared: SwapMemory = { ...memory, wantedTypeID: null, wantedTicks: 0 };

  // Empty gun: a load, not a swap. Nothing is thrown away, nothing is stamped.
  if (loaded === null) {
    const best = ranked[0];
    if (best === undefined) {
      return { kind: "keep", memory: cleared, why: "nothing compatible aboard" };
    }
    return { kind: "load", charge: best, memory: cleared, why: "loading the best charge aboard into the empty gun" };
  }

  const best = ranked[0];
  if (best === undefined || best.typeID === loaded.typeID) {
    const onlyOne = ranked.every((c) => c.typeID === loaded.typeID);
    return {
      kind: "keep",
      memory: cleared,
      why: onlyOne ? "only one ammo type aboard" : "keeping the loaded charge: it is still the best choice",
    };
  }

  // The verdict differs from what is loaded: count how long it has held.
  const ticks = best.typeID === memory.wantedTypeID ? memory.wantedTicks + 1 : 1;
  const counting: SwapMemory = { ...memory, wantedTypeID: best.typeID, wantedTicks: ticks };
  const keep = (why: string): SwapDecision => ({ kind: "keep", memory: counting, why });

  const loadedApplies = inReach(loaded, inputs.targetDistanceM, true, AMMO_RANGE_HYSTERESIS_M);
  const bestReaches = inReach(best, inputs.targetDistanceM, false, AMMO_RANGE_HYSTERESIS_M);
  const bestDamage = appliedDamage(best, inputs.resonances);
  const loadedDamage = appliedDamage(loaded, inputs.resonances);

  // Is the swap worth making at all? (reach and damage, before any timing.)
  let reason: string;
  if (!loadedApplies) {
    if (inputs.canClose) return keep("closing in instead of reloading");
    if (!bestReaches) return keep("no charge aboard reaches the target");
    reason = "loading the longer-range charge: the target is out of reach and the ship cannot close";
  } else {
    if (bestDamage === null || loadedDamage === null) {
      return keep("keeping the loaded charge: it still reaches and the damage of the other is unknown");
    }
    if (!(bestDamage > 0 && bestDamage >= loadedDamage * (1 + AMMO_SWAP_MIN_GAIN))) {
      return keep("keeping the loaded charge: it still reaches and the other is not enough better");
    }
    if (!bestReaches) return keep("keeping the loaded charge: the better one would not reach");
    if (
      !nextTargetMoment &&
      inputs.targetRemainingHp !== null &&
      inputs.gunDpsWhileReloading !== null &&
      !(inputs.targetRemainingHp > inputs.gunDpsWhileReloading)
    ) {
      return keep("keeping the loaded charge: the target will die before a reload pays off");
    }
    reason = nextTargetMoment
      ? "loading the better charge for the next target"
      : "loading the charge that does clearly more damage to this target";
  }

  // Timing: persistence, cooldown, one swap per target. The lock-ahead tick is exempt.
  if (!nextTargetMoment) {
    if (ticks < AMMO_SWAP_PERSIST_TICKS) {
      return keep("waiting to be sure the other charge stays the better one");
    }
    if (memory.lastSwapAtMs !== null && nowMs - memory.lastSwapAtMs < AMMO_SWAP_COOLDOWN_MS) {
      return keep("not swapping again so soon after the last swap");
    }
    if (inputs.targetID !== null && memory.swappedForTargetID === inputs.targetID) {
      return keep("already swapped once for this target");
    }
  }

  return {
    kind: "swap",
    charge: best,
    memory: {
      wantedTypeID: null,
      wantedTicks: 0,
      lastSwapAtMs: nowMs,
      swappedForTargetID: inputs.targetID,
    },
    why: reason,
  };
}
