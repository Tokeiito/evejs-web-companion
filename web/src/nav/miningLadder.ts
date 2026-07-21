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
//   1. THE LADDER IS NOT FLAT. `travelDecision` is a five-step sub-ladder
//      (warp → approach → closing → arrive) reached from FIVE different rungs,
//      and `runTheLasers` is a three-step one reached from two. A flat row list
//      has no notion of "call", so those steps are not rows here: the rung that
//      fired is the CALLER, and which step it took shows only in the action and
//      the why. Rendering them as rows would mean 5 callers × 5 steps = 25 rows
//      for something the code writes once. See `travel-*` notes below.
//
//   2. `headingHome` IS A LATCHED SENTENCE, NOT A FLAG. `HEALTH_FLOOR` and
//      `NO_YIELD_HAUL` each set it to their OWN prose, and `HEADING_HOME` reads
//      it back on every later tick. So one row's condition is another row's
//      wording — and worse, the launch bound in the controller (`bound()`, the
//      MAX_LAUNCH_ATTEMPTS branch) sets it too, from OUTSIDE the ladder
//      entirely. A row list cannot enumerate the sources of the state its own
//      rows read.
//
//   3. THE ADOPT SHORTCUT DOES TWO THINGS. `ROCK_ALREADY_LOCKED` returns an
//      action AND a memory write in one tick, and the action it returns is
//      produced by the equipment sub-ladder — so naming the shortcut hides what
//      the tick actually did, and naming what it did hides the shortcut. This
//      catalogue chose to name the shortcut; the cost is recorded on the row.
//
//   4. `noYieldCycles` IS NOT A CONDITION A ROW CAN HOLD. See NO_YIELD_HAUL.
//
// Two things DID come out clean and are worth saying so: the two release rungs
// (`ROCK_OUT_OF_VIEW` vs `ROCK_MINED_OUT`) are genuinely two rows with two
// different meanings, and the docked group is as row-shaped as anything gets.

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
  | "rock-mined-out"
  | "equipment-unknown"
  | "equipment-on"
  | "mining-running"
  | "lock-current-rock"
  | "travel-to-belt"
  | "belt-empty"
  | "no-rock"
  | "rock-already-locked"
  | "lock-nearest-rock";

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
    name: "The rock it was working is out of view, so let it go and pick another",
    group: "The rock",
    fit: "distorted",
    caveat:
      "Letting a rock go is NOT the same as finishing with it — a rock is out of view for the whole trip to the station and back. The difference decides whether the belt slowly empties by bookkeeping, and it is not something this row says.",
  },
  {
    id: "rock-mined-out",
    name: "The rock it was working is mined out, so it is finished with for good",
    group: "The rock",
    fit: "distorted",
    caveat:
      "This one really does finish with the rock, unlike the row above. Two rows that look alike and must never be merged.",
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
    name: "At the belt with no rocks left that have ore, so stop — do not wander",
    group: "The rock",
    fit: "distorted",
    caveat:
      "This is reached through the row above rather than being tried in its own right: it is what heading for the belt turns into once the ship has arrived.",
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
    name: "The nearest rock with ore is already locked, so skip the lock and go straight to the equipment",
    group: "The rock",
    fit: "distorted",
    caveat:
      "Two things in one tick: it starts the equipment AND remembers this rock as the one being worked. It also borrows its move from the equipment rows below, so none of those light up while this one does.",
  },
  {
    id: "lock-nearest-rock",
    name: "The nearest rock with ore is not locked, so lock it",
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

/** The rung with this id, or null. Never throws — a readout must not crash. */
export function findRung(id: string | null): MiningRung | null {
  if (id === null) {
    return null;
  }
  return MINING_LADDER.find((rung) => rung.id === id) ?? null;
}
