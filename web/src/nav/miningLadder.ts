// R44 — the mining ladder, as a list of rows a player can read.
//
// ⚠ THIS FILE IS INSTRUMENTATION AND NOTHING ELSE. It does not decide, it does
// not run, and nothing in `decideMiningAction` reads it. It is a NAME for each
// place that ladder can return from, so the panel can show the whole ladder and
// mark the one that fired this tick. Delete this file and the bot mines exactly
// as it does now.
//
// ─── WHAT THIS FILE IS AN EXPERIMENT ABOUT ───────────────────────────────────
//
// The open question behind R44 is whether a hand-written decide-loop can be
// expressed as a flat list of rows — "when THIS, do THAT" — because that is the
// vocabulary a player-authored bot editor would have to offer. So this catalogue
// was written by walking `decideMiningAction` return by return and asking, at
// each one, "is this a row?".
//
// FOUR ANSWERS CAME BACK "NO, OR NOT WITHOUT LOSING SOMETHING", and they are
// recorded here rather than smoothed over, because the whole value of doing this
// before building an editor is finding them:
//
//   1. THE LADDER IS NOT FLAT — AND R46 STOPPED PRETENDING IT WAS. A decision
//      now carries TWO names: the `rung` that fired and the `step` inside the
//      sub-ladder it called (`MiningStepID` below). The equipment sub-ladder's
//      three leaves and the belt arrival are rows here and light ALONGSIDE
//      their caller.
//
//      What is still not a row is the TRAVEL sub-ladder's warp / approach /
//      closing / dock steps: they are reached from FIVE different rungs, and
//      giving them rows would mean a caller × step cross-product of rows for
//      code written once. Those ticks report `step: null` and what the sub-
//      ladder chose shows in the action and the why — which the `travel-to-belt`
//      row says on itself, on screen.
//
//   2. `headingHome` IS A LATCHED SENTENCE, NOT A FLAG. `HEALTH_FLOOR` and
//      `NO_YIELD_HAUL` each set it to their OWN prose, and `HEADING_HOME` reads
//      it back on every later tick. So one row's condition is another row's
//      wording — and worse, the launch bound in the controller (`bound()`, the
//      MAX_LAUNCH_ATTEMPTS branch) sets it too, from OUTSIDE the ladder
//      entirely. A row list cannot enumerate the sources of the state its own
//      rows read.
//
//   3. THE ADOPT SHORTCUT DOES TWO THINGS — and R44's answer to it was WRONG.
//      `ROCK_ALREADY_LOCKED` returns an action AND a memory write in one tick,
//      and the action it returns is produced by the equipment sub-ladder. R44
//      let the shortcut SUBSTITUTE its row for the leaf's, and a decision held
//      exactly one row, so on a tick where the ship would not say which modules
//      were cycling the bot switched NOTHING on while the only lit row read
//      "…skip the lock and go straight to the equipment".
//
//      THE READOUT COULD STATE SOMETHING THAT DID NOT HAPPEN. That is not a
//      distortion, it is a false claim, and a panel whose whole purpose is "see
//      why it did that" must not be able to make one. R46 carries the caller and
//      the leaf together instead of choosing between them, which makes the lie
//      untellable rather than documented.
//
//   4. `noYieldCycles` IS NOT A CONDITION A ROW CAN HOLD. See NO_YIELD_HAUL.
//
// The docked group came out as row-shaped as anything gets. (R44 also found the
// release verb split into two rows — out-of-view vs mined-out. R49 removed the
// mined-out one: depletion is the server's, which deletes a mined-out rock from
// the grid, so the client never predicts it and there is one release verb left.)

/**
 * A rung's stable identifier.
 *
 * ⚠ R7d — THIS NEVER REACHES THE SCREEN. It is a key for code and tests; the
 * player reads `name`. A test sweeps the rendered panel for every one of these
 * strings, with a companion test proving the sweep's matcher actually matches.
 */
export type MiningRungID =
  // Docked
  | "reading-hold"
  | "docked-with-ore"
  | "run-over"
  | "docked-and-empty"
  // Not flying yet
  | "no-location"
  | "in-warp"
  // Danger
  | "health-floor"
  | "pirate-unknown-health"
  | "reading-drone-bay"
  | "launch-drones"
  // The hold
  | "heading-home"
  | "hold-full"
  | "no-yield-haul"
  | "no-yield-stop"
  // The rock
  | "reading-targets"
  | "rock-out-of-view"
  | "equipment-unknown"
  | "equipment-on"
  | "mining-running"
  | "lock-current-rock"
  | "travel-to-belt"
  | "belt-empty"
  | "no-rock"
  | "rock-is-locked"
  | "rock-already-locked"
  | "lock-nearest-rock";

/**
 * A row that is reached THROUGH another row rather than tried in its own right
 * — a leaf of one of the sub-ladders (R46).
 *
 * These never appear as a decision's `rung`, only as its `step`, and the
 * compiler enforces that: `MiningDecision.rung` is `MiningCallerRungID`, which
 * excludes every id below.
 *
 * ⚠ WHY THESE FOUR AND NOT THE TRAVEL STEPS. A leaf earns a row when it can be
 * named without a cross-product. The equipment sub-ladder is called from two
 * rungs and its three answers are genuinely different outcomes ("nothing was
 * switched on" is not "it is mining"), so they are rows. The belt arrival is the
 * ladder's own rung 8 and always reached from one caller, so it is a row too.
 * Travel's warp / approach / closing / dock steps are reached from five rungs
 * and would need 5 × 4 rows for code written once — those report `step: null`,
 * and `travel-to-belt` says so on itself.
 */
export type MiningStepID =
  | "equipment-unknown"
  | "equipment-on"
  | "mining-running"
  | "belt-empty";

/**
 * A row the ladder tries IN ITS OWN RIGHT — everything that is not a sub-ladder
 * leaf. This is the type of a decision's `rung`, so it is the compiler, not a
 * reviewer, that stops a leaf being reported as though the loop had tried it.
 */
export type MiningCallerRungID = Exclude<MiningRungID, MiningStepID>;

/**
 * How well this rung survived being turned into a row — the R44 experiment's
 * finding, carried on the rung itself so the panel can be honest on screen
 * rather than only in a report.
 *
 * `unexpressible` does NOT mean the rung is broken or that it cannot be shown.
 * It means the ROW MODEL cannot state this rung's condition, so the row you see
 * is a label over something looser than the code.
 */
export type RowModelFit = "clean" | "distorted" | "unexpressible";

export interface MiningRung {
  readonly id: MiningRungID;
  /** What a player reads. Plain language, no ids, no line numbers (R9a/R7d). */
  readonly name: string;
  /** Which group of the ladder it sits in — the doc comment's own ordering. */
  readonly group: "Docked" | "Before it can act" | "Danger" | "The hold" | "The rock";
  readonly fit: RowModelFit;
  /**
   * Shown on screen for any rung that is NOT clean. This is the "say so" half
   * of rendering a distortion honestly — a player who is told a row fired
   * deserves to know when the row is a looser statement than the rule.
   */
  readonly caveat?: string;
}

/**
 * THE LADDER, IN THE ORDER IT IS ACTUALLY TRIED. First match wins, top to
 * bottom, exactly as `decideMiningAction` reads.
 *
 * ⚠ THE ORDER IS THE BEHAVIOUR. Danger is above the hold because a ship under
 * its safety floor must leave whether or not it is full; the hold is above the
 * rock because a full ship must not start another cycle. Re-ordering these rows
 * on screen would misrepresent the loop even though it changed no code.
 */
export const MINING_LADDER: readonly MiningRung[] = Object.freeze([
  // ── Docked ─────────────────────────────────────────────────────────────────
  {
    id: "reading-hold",
    name: "Docked, and looking in the hold to see what came back",
    group: "Docked",
    fit: "clean",
  },
  {
    id: "docked-with-ore",
    name: "Docked with ore aboard, so it goes into the hangar",
    group: "Docked",
    fit: "clean",
  },
  {
    id: "run-over",
    name: "Back at the station, empty, and there was a reason for coming home — so the run ends",
    group: "Docked",
    fit: "distorted",
    caveat:
      "The reason this stops on is a sentence written earlier by whichever rule sent the ship home — it is not part of this rule.",
  },
  {
    id: "docked-and-empty",
    name: "The hold is empty, so head back out to the belt",
    group: "Docked",
    fit: "clean",
  },

  // ── Before it can act ──────────────────────────────────────────────────────
  {
    id: "no-location",
    name: "The ship has not said where it is, so wait",
    group: "Before it can act",
    fit: "clean",
  },
  {
    id: "in-warp",
    name: "In warp — nothing is decided mid-warp",
    group: "Before it can act",
    fit: "clean",
  },

  // ── Danger ─────────────────────────────────────────────────────────────────
  {
    id: "health-floor",
    name: "The ship is below your safety floor, so break off and head for the station",
    group: "Danger",
    fit: "distorted",
    caveat:
      "As well as choosing a move, this writes the sentence that keeps the ship going home on every tick after this one.",
  },
  {
    id: "pirate-unknown-health",
    name: "A pirate is here and the ship's condition could not be read, so stop rather than guess",
    group: "Danger",
    fit: "clean",
  },
  {
    id: "reading-drone-bay",
    name: "A pirate is here — looking in the drone bay",
    group: "Danger",
    fit: "clean",
  },
  {
    id: "launch-drones",
    name: "A pirate is here, so the drones go out — they defend the ship on their own",
    group: "Danger",
    fit: "clean",
  },

  // ── The hold ───────────────────────────────────────────────────────────────
  {
    id: "heading-home",
    name: "Already heading home for a reason, so keep going to the station",
    group: "The hold",
    fit: "distorted",
    caveat:
      "This rule has no reason of its own. It repeats whatever sentence sent the ship home — and one of those sentences is written by the drone-launch limit, which is not on this list at all.",
  },
  {
    id: "hold-full",
    name: "The hold has reached the level it hauls at, so the load goes to the station",
    group: "The hold",
    fit: "clean",
  },
  {
    id: "no-yield-haul",
    name: "The equipment has run for minutes with nothing arriving, and there is ore aboard — take it home",
    group: "The hold",
    fit: "unexpressible",
    caveat:
      "This one cannot be written as a row. It counts ticks on which the equipment was running AND the hold did not grow between one tick and the next — a rule about something NOT happening, across time. Every way of saying that as a single condition is looser than what the bot actually does.",
  },
  {
    id: "no-yield-stop",
    name: "The equipment has run for minutes with nothing arriving and nothing aboard — stop",
    group: "The hold",
    fit: "unexpressible",
    caveat:
      "Same counter as above, and the same problem: it is a rule about the hold NOT changing while the equipment ran, which a single condition cannot state.",
  },

  // ── The rock ───────────────────────────────────────────────────────────────
  {
    id: "reading-targets",
    name: "Checking what your ship has locked",
    group: "The rock",
    fit: "clean",
  },
  {
    id: "rock-out-of-view",
    name: "The rock it was working is gone from the grid, so let it go and pick another",
    group: "The rock",
    // R49 — the SOLE release verb, and now unambiguous. The server removes a
    // mined-out rock, so "gone from the grid" is the only reason the bot lets a
    // rock go, and it always means the same thing: forget it, pick another, do
    // not blacklist it. There is no depletion sibling left to be confused with.
    fit: "clean",
  },
  {
    id: "rock-is-locked",
    name: "The rock it is working is locked, so it goes on to the equipment",
    group: "The rock",
    fit: "clean",
  },
  {
    id: "equipment-unknown",
    name: "Your ship did not say which equipment is running, so nothing was switched on this time",
    group: "The rock",
    fit: "clean",
  },
  {
    id: "equipment-on",
    name: "The rock is locked, so the mining equipment goes on",
    group: "The rock",
    fit: "clean",
  },
  {
    id: "mining-running",
    name: "All the chosen equipment is running — it is mining",
    group: "The rock",
    fit: "clean",
  },
  {
    id: "lock-current-rock",
    name: "The rock it picked is not locked yet, so lock it",
    group: "The rock",
    fit: "clean",
  },
  {
    id: "travel-to-belt",
    name: "Nothing to mine in view, so head for the belt",
    group: "The rock",
    fit: "distorted",
    caveat:
      "Whether this warps, approaches or waits is decided by a shared set of steps this list does not show — the same steps every trip to the station uses. What it chose is in the line above.",
  },
  {
    id: "belt-empty",
    name: "At the belt with no rocks left on the grid, so stop — do not wander",
    group: "The rock",
    fit: "distorted",
    caveat:
      "This is reached through the row above rather than being tried in its own right, so the two light together: it is what heading for the belt turns into once the ship has arrived.",
  },
  {
    id: "no-rock",
    name: "Nothing to lock on to, so wait",
    group: "The rock",
    fit: "distorted",
    caveat:
      "A safety net rather than a rule — with rocks in view and none pickable, the row above has already fired. It is here because the list must account for every way the bot can answer, including one that never happens.",
  },
  {
    id: "rock-already-locked",
    name: "The nearest rock on the grid is already locked, so skip the lock and go straight to the equipment",
    group: "The rock",
    fit: "distorted",
    caveat:
      "Two things in one tick: it goes on to the equipment AND remembers this rock as the one being worked. The equipment row that lights with this one is what actually happened — read them together.",
  },
  {
    id: "lock-nearest-rock",
    name: "The nearest rock on the grid is not locked, so lock it",
    group: "The rock",
    fit: "distorted",
    caveat:
      "As well as asking for the lock, this remembers the rock — the same bookkeeping tail as the row above.",
  },
]);

/** Every id, for exhaustiveness checks. */
export const MINING_RUNG_IDS: readonly MiningRungID[] = Object.freeze(
  MINING_LADDER.map((rung) => rung.id),
);

/**
 * Every SUB-LADDER LEAF id (R46) — the rows that are reached through another row
 * rather than tried in their own right.
 *
 * ⚠ EVERY ONE OF THESE IS ALSO A ROW IN THE LADDER ABOVE. That is what lets the
 * panel light a step exactly the way it lights a rung, and a test pins it: a
 * step id with no row would be a leaf the loop reports and the page cannot show.
 */
export const MINING_STEP_IDS: readonly MiningStepID[] = Object.freeze([
  "equipment-unknown",
  "equipment-on",
  "mining-running",
  "belt-empty",
]);

/** The rung with this id, or null. Never throws — a readout must not crash. */
export function findRung(id: string | null): MiningRung | null {
  if (id === null) {
    return null;
  }
  return MINING_LADDER.find((rung) => rung.id === id) ?? null;
}
