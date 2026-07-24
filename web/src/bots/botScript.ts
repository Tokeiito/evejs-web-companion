// The Bot Builder document — the shape a player-authored bot is SAVED, IMPORTED
// and EXPORTED in, plus the pure structural helpers that read it.
//
// ⚠ THIS FILE IS THE FORMAT AND NOTHING ELSE. It holds no player-facing strings
// (those live in scriptText.ts, one R9a register), issues no calls, and decides
// nothing (the runner's decide function does that). It is the single source of
// truth for what a valid document can CONTAIN — the codec validates against these
// types and these bounds, the editor builds them, the runner reads them.
//
// ─── WHY THE SHAPE IS WHAT IT IS ─────────────────────────────────────────────
//
// The design (docs/bot-builder-brainstorm.md) settled a Human-Resource-Machine
// program: an ordered list of INTERRUPTS checked every tick, above an ordered
// list of STEPS run top to bottom. Two safety properties are STRUCTURAL here —
// unrepresentable rather than validated — so no import can strip them:
//
//   • A CYCLE IS UNDRAWABLE. Order is an array index and a step has no outgoing
//     edge, so the only backward edge in the whole format is a loop block
//     re-entering its own body, counted against `repeat`. There is nowhere to
//     express "jump to step 2".
//   • TWO CALLS IN ONE TICK IS UNREPRESENTABLE. A step names exactly one macro;
//     a macro decides exactly one action. The format cannot ask for two.
//
// And the pieces the operator's decisions pinned (see the doc's "Operator
// decisions"): a loop repeats a bounded count OR forever (decision 1); a belt is
// a runtime "nearest" binding or a chosen one (decision 2); the safety floor is
// interrupt row 0, editable-threshold but not deletable (decision 3); a hostile
// interrupt lets the player pick drones-or-run (decision 5).

// ─── Format identity ─────────────────────────────────────────────────────────

/** The tag every document carries; the first thing the codec checks. */
export const SCRIPT_FORMAT = "evejs-bot-script" as const;

/**
 * The format version. A lone integer so a NEWER file is detectable and refused
 * before anything else is read (a document from a newer app may contain shapes
 * this one cannot validate). Older files migrate on read; saves re-write this.
 */
export const SCRIPT_VERSION = 1 as const;

// ─── Shared bounds ───────────────────────────────────────────────────────────
//
// ⚠ ONE SOURCE OF TRUTH FOR EVERY LIMIT. The codec clamps to these, the editor
// offers these, the runner trusts these. A range that lived in two places would
// let an import store a value the editor could never produce.

/** A loop's bounded count runs 1..500; above it a player wants "forever" instead. */
export const MIN_REPEAT_TIMES = 1;
export const MAX_REPEAT_TIMES = 500;

/**
 * The ore-hold "nearly full" ceiling. 0.9 is load-bearing: the mining bot never
 * asks "does one more unit fit" (mixed-hold average-volume trap), it hauls at a
 * fraction with headroom to spare — so a player cannot ask for 100% and reopen
 * that bug.
 */
export const MAX_ORE_HOLD_FRACTION = 0.9;

/** Health/shield thresholds run 0.05..0.95 — never 0 (an interrupt that can never fire). */
export const MIN_CONDITION_FRACTION = 0.05;
export const MAX_CONDITION_FRACTION = 0.95;

/** Structural size caps — the shape of the document, independent of byte length. */
export const MAX_PROGRAM_NODES = 32;
export const MAX_TOTAL_STEPS = 64;
export const MAX_INTERRUPTS = 8;
export const MAX_NAME_LEN = 60;
export const MAX_NOTES_LEN = 2000;

/**
 * Raw-byte ceiling, checked BEFORE JSON.parse so a hostile 10 MB file never
 * reaches the parser. One number under the BFF's 64 KB express.json limit.
 */
export const MAX_DOC_BYTES = 49152;

// ─── World references ────────────────────────────────────────────────────────

/** Which kind of world thing a slot points at. */
export type WorldEntity = "station" | "belt" | "agent" | "system";

/**
 * A reference to a place in the world.
 *
 * ⚠ THE ID IS A HINT, NEVER TRUSTED. It makes a same-world re-import exact, but
 * an imported document lands on another character's world where the same number
 * may name a different thing — so on import every ref is UNBOUND until the id
 * resolves to the stored `name` for this character's world. `name`/`systemName`
 * are display hints only; once bound the screen re-resolves through names.ts, so
 * a number never reaches a player (R7d). A null id is an unbound slot on purpose
 * (templates, cross-world imports) and blocks the start until the player picks.
 */
export interface WorldRef {
  readonly entity: WorldEntity;
  readonly id: number | null;
  readonly name: string | null;
  readonly systemName: string | null;
  /**
   * STATION ONLY. True means "wherever the ship started" — resolved at run time
   * to the station the bot began at, the same way a belt's "nearest" resolves.
   * It is the most portable choice: a saved script that unloads / docks at the
   * starting station stays valid on any character, in any system. When true, `id`
   * is null and no picking is needed; when absent/false, a null id is an unbound
   * slot the player must still fill. Omitted (not `false`) when not a starting ref.
   */
  readonly starting?: boolean;
}

/** True when a station ref means "wherever the ship started". */
export function isStartingStation(ref: WorldRef): boolean {
  return ref.starting === true;
}

/** A "return to where you started" station ref — the portable default. */
export function startingStation(): WorldRef {
  return { entity: "station", id: null, name: null, systemName: null, starting: true };
}

// ─── Macro arguments ─────────────────────────────────────────────────────────

/**
 * Where to mine. "nearest" is bound at RUNTIME from a fresh snapshot — it is the
 * operator's "warp to nearest asteroid belt", and it is what lets a script be
 * written while docked (no grid to read) and shared across worlds (no baked id).
 * "chosen" pins one belt for a player who is out in space and wants that one.
 */
export type BeltArg =
  | { readonly mode: "nearest" }
  | { readonly mode: "chosen"; readonly ref: WorldRef };

/**
 * Which fitted modules are the miners — identified by their type GROUP, never a
 * name regex (R47: 17482 → "Strip Miner"). `label` is the display hint.
 */
export interface EquipmentArg {
  readonly groupID: number;
  readonly label: string;
}

/**
 * One filled-in parameter of a macro step. A discriminated union so the codec can
 * validate each against the macro's declared parameter spec, and the editor can
 * pick the right widget, without the format growing a field per macro.
 */
/** Bounded small-integer argument (an agent level, a jump ceiling). */
export const MIN_COUNT_ARG = 1;
export const MAX_COUNT_ARG = 500;

/**
 * An ISK amount a player sets — a buy ceiling, a sell floor, a wallet threshold.
 * Capped at 100 billion: far above any sane per-unit price, far under the 2^53
 * point where a number stops being exact (so a comparison never lies).
 */
export const MIN_ISK_ARG = 1;
export const MAX_ISK_ARG = 100_000_000_000;

/** A market quantity (units to buy) — past the small-count cap, still exact. */
export const MIN_QTY_ARG = 1;
export const MAX_QTY_ARG = 10_000_000;

export type Arg =
  | { readonly kind: "belt"; readonly belt: BeltArg }
  | { readonly kind: "station"; readonly ref: WorldRef }
  | { readonly kind: "equipment"; readonly equipment: EquipmentArg }
  /** A specific agent (WorldRef entity "agent"). Optional on mission blocks — left
   * unset, the block uses the agent the find block published on the run's board. */
  | { readonly kind: "agent"; readonly ref: WorldRef }
  /** A bounded small integer: an agent LEVEL (1–5) or a max-jumps ceiling. */
  | { readonly kind: "count"; readonly value: number }
  /** A corporation filter for the agent finder; null id = any corporation. */
  | { readonly kind: "corp"; readonly id: number | null; readonly name: string | null }
  /** A saved fitting from the character's fitting library. The id is a same-world
   * hint; the NAME is what the block matches at run time, so an imported script
   * refits correctly wherever a fitting of that name exists. */
  | { readonly kind: "fitting"; readonly fittingID: number | null; readonly name: string | null }
  /** A kind of ITEM, by type. Type ids are static world data (portable); the name
   * is the display hint. null typeID = an unbound slot the player must fill. */
  | { readonly kind: "itemType"; readonly typeID: number | null; readonly name: string | null }
  /** A PLACE items can sit while docked: the station hangar, the ship's cargo
   * hold, or its ore hold. A closed vocabulary, validated by the codec. */
  | { readonly kind: "place"; readonly place: ItemPlace }
  /** A saved BOOKMARK. The id is a same-world hint; the NAME (its label) is what
   * the block matches at run time, so an imported script still finds "Safe spot". */
  | { readonly kind: "bookmark"; readonly bookmarkID: number | null; readonly name: string | null }
  /** An ISK amount the player sets — a buy ceiling or a sell floor (per unit). */
  | { readonly kind: "isk"; readonly value: number }
  /** A market quantity — how many units a buy order is for. */
  | { readonly kind: "qty"; readonly value: number }
  /** A character to act on (invite to a fleet). null charID = an unbound slot to pick. */
  | { readonly kind: "character"; readonly charID: number | null; readonly name: string | null };

/** The move block's place vocabulary. */
export type ItemPlace = "hangar" | "cargo" | "ore-hold";
export const ITEM_PLACES: readonly ItemPlace[] = Object.freeze<ItemPlace[]>(["hangar", "cargo", "ore-hold"]);

// ─── Conditions ──────────────────────────────────────────────────────────────

/**
 * A player-checkable test over the world. Evaluated tri-state at runtime
 * (met / not-met / cannot-tell) from that tick's FRESH reads — never the store —
 * with cannot-tell never passing. Here it is only the shape + its threshold.
 *
 * ⚠ `hostile-on-grid` IS A GRID READ. It is false-or-unknowable while the ship
 * is still in warp, so it belongs in an interrupt (always-armed, fails safe by
 * not firing), never in a step's `until` where "DO WHILE no hostiles" would be
 * trivially true mid-warp — the belt-empty-on-tick-one trap in another costume.
 * `conditionSites()` below is the machine-checkable statement of that rule.
 */
export type Condition =
  | { readonly kind: "ore-hold-at-least"; readonly fraction: number }
  | { readonly kind: "hold-empty" }
  | { readonly kind: "shield-below"; readonly fraction: number }
  | { readonly kind: "armor-below"; readonly fraction: number }
  | { readonly kind: "hull-below"; readonly fraction: number }
  | { readonly kind: "health-below"; readonly fraction: number }
  | { readonly kind: "capacitor-below"; readonly fraction: number }
  /** Wallet thresholds carry an absolute ISK amount, not a 0..1 fraction. */
  | { readonly kind: "wallet-below"; readonly isk: number }
  | { readonly kind: "wallet-above"; readonly isk: number }
  | { readonly kind: "hostile-on-grid" };

export type ConditionKind = Condition["kind"];

/** Every condition kind — for exhaustive iteration in menus and tests. */
export const CONDITION_KINDS: readonly ConditionKind[] = Object.freeze<ConditionKind[]>([
  "ore-hold-at-least",
  "hold-empty",
  "shield-below",
  "armor-below",
  "hull-below",
  "health-below",
  "capacitor-below",
  "wallet-below",
  "wallet-above",
  "hostile-on-grid",
]);

/** Where a condition may legally appear. */
export type ConditionSite = "until" | "interrupt";

/**
 * The legal sites for a condition kind — the structural guard on the belt-empty
 * class. A grid read (`hostile-on-grid`) is interrupt-only; every own-ship read
 * is fine in both places. The codec refuses a condition used off-site.
 */
export function conditionSites(kind: ConditionKind): readonly ConditionSite[] {
  return kind === "hostile-on-grid" ? ["interrupt"] : ["until", "interrupt"];
}

/** True when `kind` may be used at `site`. */
export function conditionAllowedAt(kind: ConditionKind, site: ConditionSite): boolean {
  return conditionSites(kind).includes(site);
}

// ─── Interrupts ("Always watching") ──────────────────────────────────────────

/**
 * What a fired interrupt does.
 *
 *   • "pause"          — stop where you are and say why.
 *   • "dock-and-pause" — break off, dock at home, pause (the safety-floor
 *                        response, and the hostile "run for the station" pick).
 *   • "launch-drones"  — put drones out and KEEP WORKING (the hostile "use
 *                        drones" pick). Bounded by the existing three-attempt
 *                        launch rule, which heads home if it cannot.
 */
/**
 *   • "repair"         — switch the matching repairers ON while the condition
 *                        holds and the capacitor allows, and back OFF when it
 *                        clears — the "keep the ship repaired" watch. The step
 *                        keeps working; repairs ride the watching layer.
 */
export type InterruptResponse = "pause" | "dock-and-pause" | "launch-drones" | "repair";

/** Every interrupt response — for exhaustive iteration in menus and tests. */
export const INTERRUPT_RESPONSES: readonly InterruptResponse[] = Object.freeze<InterruptResponse[]>([
  "pause",
  "dock-and-pause",
  "launch-drones",
  "repair",
]);

/**
 * One "always watching" row. `builtIn: "safety-floor"` marks the ship-health
 * cut-off (decision 3): its threshold is editable, the row is NOT deletable, and
 * its response is fixed to dock-and-pause. Every other interrupt is player-made.
 */
export interface InterruptRow {
  readonly id: string;
  readonly when: Condition;
  readonly respond: InterruptResponse;
  readonly builtIn?: "safety-floor";
}

// ─── Program nodes ───────────────────────────────────────────────────────────

/**
 * Which macros the format knows. The first five are the mining set; the seven
 * `*-mission` / agent blocks are the DISTRIBUTION-MISSION set — each one step of
 * the courier loop the proven mission bot already runs (find the agent, ask for
 * work, accept, load the package, fly the delivery, turn it in, fly back), cut
 * into blocks a player wires up — usually inside a Repeat loop.
 */
export type MacroID =
  | "undock"
  | "travel-to-station"
  | "mine-at-belt"
  | "deliver-ore"
  | "defend-with-drones"
  | "find-distribution-agent"
  | "request-mission"
  | "accept-mission"
  | "load-mission-cargo"
  | "travel-to-dropoff"
  | "turn-in-mission"
  | "return-to-agent"
  | "wait"
  | "unload-cargo"
  | "salvage-wrecks"
  | "loot-wrecks"
  | "refine-ore"
  | "hardeners-on"
  | "fight-the-rats"
  | "warp-to-anomaly"
  | "refit-ship"
  | "move-items"
  | "warp-to-bookmark"
  | "find-combat-agent"
  | "fly-to-mission-site"
  | "restart-extractors"
  | "repair-ship"
  // ── The market set. Place orders at the station's market (server confirm-gated).
  | "buy-item"
  | "sell-item"
  // ── The fleet-support set. Remote-repair friendly ships on grid (logistics).
  | "remote-rep"
  | "orbit-and-boost"
  // ── The fleet-management set. Form up / invite / join (multibox alt-fleeting).
  | "create-fleet"
  | "invite-to-fleet"
  | "join-fleet";

/** Every macro id — for exhaustive iteration in menus and tests. */
export const MACRO_IDS: readonly MacroID[] = Object.freeze<MacroID[]>([
  "undock",
  "travel-to-station",
  "mine-at-belt",
  "deliver-ore",
  "defend-with-drones",
  "find-distribution-agent",
  "request-mission",
  "accept-mission",
  "load-mission-cargo",
  "travel-to-dropoff",
  "turn-in-mission",
  "return-to-agent",
  "wait",
  "unload-cargo",
  "salvage-wrecks",
  "loot-wrecks",
  "refine-ore",
  "hardeners-on",
  "fight-the-rats",
  "warp-to-anomaly",
  "refit-ship",
  "move-items",
  "warp-to-bookmark",
  "find-combat-agent",
  "fly-to-mission-site",
  "restart-extractors",
  "repair-ship",
  "buy-item",
  "sell-item",
  "remote-rep",
  "orbit-and-boost",
  "create-fleet",
  "invite-to-fleet",
  "join-fleet",
]);

/**
 * One macro step. `until` is the player's DO-UNTIL — the step runs until the
 * condition is met (DO-WHILE is the same wearing the negated condition; the UI
 * offers both words, the file stores `until`). A macro with no natural end of
 * its own (mine-at-belt) requires an `until`; the codec enforces that.
 */
export interface MacroStep {
  readonly id: string;
  readonly kind: "macro";
  readonly macro: MacroID;
  readonly args: Readonly<Record<string, Arg>>;
  readonly until?: Condition;
}

/**
 * A loop block: repeat its body a set number of times OR forever (decision 1),
 * with an optional `until` of its own. Forever is safe because every ACTION
 * inside a lap is bounded (macro counters, the per-step tick cap); only the lap
 * count is open, and it is shown on the row. One nesting level: the body holds
 * macro steps only, so a loop can never contain a loop.
 */
export type Repeat =
  | { readonly kind: "forever" }
  | { readonly kind: "times"; readonly count: number };

export interface LoopBlock {
  readonly id: string;
  readonly kind: "loop";
  readonly repeat: Repeat;
  readonly until?: Condition;
  readonly body: readonly MacroStep[];
}

/**
 * A branch block: evaluate `when` ONCE on entry, then run the `then` steps if it
 * holds or the `else` steps if it does not, and carry on past the branch. The one
 * place the program forks — and it stays cycle-free: both sides are forward-only
 * `MacroStep` lists (no loops, no nested branches — one level, like a loop body),
 * so the only backward edge in the whole format is still a loop re-entering its
 * body. `when` is an own-ship test (the `until` site), never a grid read that
 * would be unreadable at an arbitrary point; a cannot-tell `when` waits rather
 * than pick a side blind. A side may be empty ("do nothing on that branch").
 */
export interface BranchBlock {
  readonly id: string;
  readonly kind: "branch";
  readonly when: Condition;
  readonly then: readonly MacroStep[];
  readonly else: readonly MacroStep[];
}

export type ProgramNode = MacroStep | LoopBlock | BranchBlock;

// ─── The document ────────────────────────────────────────────────────────────

/**
 * A whole player bot, as saved / imported / exported.
 *
 * `home` is required — every bot names the station it docks at when a
 * dock-and-pause response fires, so the safety floor always has somewhere to go.
 * `interrupts` is ordered and first-match-wins each tick, before any step. The
 * program runs once top to bottom; "go again" is an explicit outer loop block.
 */
export interface BotScript {
  readonly format: typeof SCRIPT_FORMAT;
  readonly version: typeof SCRIPT_VERSION;
  readonly name: string;
  readonly notes: string;
  readonly home: WorldRef;
  readonly interrupts: readonly InterruptRow[];
  readonly program: readonly ProgramNode[];
}

// ─── Structural helpers ──────────────────────────────────────────────────────
//
// Pure reads over a document. They never throw — a readout or validator must not
// crash on a shape it does not like; it reports.

/** Narrow a node to a loop block. */
export function isLoop(node: ProgramNode): node is LoopBlock {
  return node.kind === "loop";
}

/** Narrow a node to a macro step. */
export function isMacroStep(node: ProgramNode): node is MacroStep {
  return node.kind === "macro";
}

/** Narrow a node to a branch block. */
export function isBranch(node: ProgramNode): node is BranchBlock {
  return node.kind === "branch";
}

/** Both sides of a branch as one list — the steps it can run. */
export function branchSteps(branch: BranchBlock): readonly MacroStep[] {
  return [...branch.then, ...branch.else];
}

/**
 * Total macro steps in a program, counting loop bodies and BOTH sides of a
 * branch. This is the count the `MAX_TOTAL_STEPS` cap bounds — a loop of 3 steps
 * is 3, and a branch of 2-then + 1-else is 3, not 1.
 */
export function countSteps(program: readonly ProgramNode[]): number {
  let total = 0;
  for (const node of program) {
    total += node.kind === "loop" ? node.body.length : node.kind === "branch" ? node.then.length + node.else.length : 1;
  }
  return total;
}

/**
 * The macro step with this id, wherever it sits — top level or inside a loop
 * body — or null. Ids are unique within a document (the codec enforces it), so
 * the first match is the only match.
 */
export function findStep(script: BotScript, id: string): MacroStep | null {
  for (const node of script.program) {
    if (node.kind === "macro") {
      if (node.id === id) {
        return node;
      }
    } else if (node.kind === "loop") {
      for (const step of node.body) {
        if (step.id === id) {
          return step;
        }
      }
    } else {
      for (const step of branchSteps(node)) {
        if (step.id === id) {
          return step;
        }
      }
    }
  }
  return null;
}

/** The safety-floor interrupt row, or null when a document is missing it. */
export function safetyFloorRow(script: BotScript): InterruptRow | null {
  return script.interrupts.find((row) => row.builtIn === "safety-floor") ?? null;
}

/** True when the document carries its non-deletable safety floor. */
export function hasSafetyFloor(script: BotScript): boolean {
  return safetyFloorRow(script) !== null;
}

/** True when a bounded `times` count is inside the allowed range. Forever is always valid. */
export function repeatCountInRange(repeat: Repeat): boolean {
  if (repeat.kind === "forever") {
    return true;
  }
  return (
    Number.isInteger(repeat.count) &&
    repeat.count >= MIN_REPEAT_TIMES &&
    repeat.count <= MAX_REPEAT_TIMES
  );
}
