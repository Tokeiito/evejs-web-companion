// What you can do to the thing you picked (goal R30 slice D) — pure,
// framework-free, fully testable.
//
// WHY THIS EXISTS. Every verb in the overview used to live in a `.row-actions`
// block rendered once per row: up to nine buttons times up to 200 rows,
// re-rendered every poll. That is where the operator's complaint actually bites
// — the grid was so wide with controls that the names and distances a player is
// reading got squeezed, and on a phone each row became a stack of nine
// full-width buttons you had to scroll past to reach the next row.
//
// So the row went back to being a row, and the verbs moved to ONE bar that acts
// on the thing you selected. The set of verbs is decided HERE rather than in
// markup, for the reason `space/overview.ts` and `space/gateLinks.ts` already
// established: a decision written as an `{#if}` in a template can only be
// checked by a regex over that template, and a regex over markup proves nothing
// about the decision. This returns DATA, so the claim "a station offers Dock and
// a rock does not" is a thing a test can read directly.
//
// Three rules it does not bend:
//   - Nothing here produces a numeric game ID for display (R7d).
//   - An action that cannot be used right now is still RETURNED, carrying the
//     sentence that says why (R9a). The bar renders it disabled with that
//     sentence on it. Dropping it silently would leave a player wondering where
//     a button went; leaving it enabled would promise something we cannot do.
//   - It is GENERIC by construction. There is no branch on "is this a rock" for
//     the flight verbs — a rock, a wreck, a station and another player's ship
//     all get Warp to / Approach / Orbit / Keep at range / Align to / Lock,
//     because the server treats them the same way and so should this.

import type { GateLink } from "./gateLinks.ts";
import { jumpBlockedReason, jumpLabel } from "./gateLinks.ts";

/**
 * The per-concern busy channel an action belongs to.
 *
 * ⚠ This is the type the panel's busy SET is keyed on, and it is a set for one
 * reason: a single shared busy flag greys out Stop in the middle of a fight
 * because a lock request happened to be pending. An action may only ever be
 * disabled by its OWN concern being in flight.
 */
export type ActionConcern = "move" | "lock" | "module" | "drone" | "hold" | "route";

export type RowActionID =
  | "warp"
  | "approach"
  | "orbit"
  | "keepAtRange"
  | "align"
  | "dock"
  | "jump"
  | "lock"
  | "unlock"
  | "mine"
  | "haul";

/** One verb offered for the selected thing. */
export interface RowAction {
  readonly id: RowActionID;
  /** What the button says. Never contains an id (R7d). */
  readonly label: string;
  readonly concern: ActionConcern;
  /**
   * null = usable. A sentence = the honest reason it is not, rendered ON the
   * disabled control rather than left as a silent grey rectangle.
   */
  readonly unavailable: string | null;
}

/** Everything the decision needs, and nothing it does not. */
export interface RowActionContext {
  /** The server's own runtime kind for the ball ("asteroid", "station", …). */
  readonly kind: string | null;
  readonly locked: boolean;
  readonly acquiring: boolean;
  /** The gate link for this row, or null when it is not a stargate. */
  readonly gateLink: GateLink | null;
  /**
   * R30 slice E — how many switched-on modules the player's own equipment list
   * reads as mining gear. 0 does not remove "Mine this"; it gives it a reason.
   */
  readonly minerCount?: number;
  /**
   * R33 — how much ore this rock has left, MERGED from the snapshot and the
   * survey scanner (`remainingOre` in Overview.svelte). Undefined or null is
   * "not known" and must leave the verb alone; a real 0 is a rock the server
   * will refuse to mine.
   */
  readonly remainingQuantity?: number | null;
}

/**
 * Is this something you can dock at?
 *
 * Decided from the server's own runtime kind for the ball — never guessed from
 * its name, its distance or its category number.
 */
export function isDockableKind(kind: string | null): boolean {
  return kind === "station" || kind === "structure";
}

/**
 * The verbs for the selected row, in the order they are drawn.
 *
 * Movement first (it is what a player reaches for most), then the verbs that
 * are specific to what the thing IS, then locking. A gate's Jump and a
 * station's Dock sit next to each other because from the player's side they are
 * the same idea: leave here, using that.
 */
export function actionsForRow(ctx: RowActionContext): readonly RowAction[] {
  const actions: RowAction[] = [
    { id: "warp", label: "Warp to", concern: "move", unavailable: null },
    { id: "approach", label: "Approach", concern: "move", unavailable: null },
    { id: "orbit", label: "Orbit", concern: "move", unavailable: null },
    { id: "keepAtRange", label: "Keep at range", concern: "move", unavailable: null },
    { id: "align", label: "Align to", concern: "move", unavailable: null },
  ];

  // R24 slice B — Dock, and mean it: the ladder that closes the distance itself
  // rather than the raw single command that fails unless you are already there.
  if (isDockableKind(ctx.kind)) {
    actions.push({ id: "dock", label: "Dock", concern: "move", unavailable: null });
  }

  // R30 slice A — Jump, on the gate, naming where it goes. Offered from ANY
  // distance on purpose: the server owns the range rule and states its own
  // refusal, and inventing a distance test here would put a guessed rule on
  // screen beside the real one. The one case genuinely blocked is a graph edge
  // with no gate on the far side — there is nothing honest to send.
  if (ctx.gateLink) {
    actions.push({
      id: "jump",
      label: jumpLabel(ctx.gateLink),
      concern: "move",
      unavailable: jumpBlockedReason(ctx.gateLink),
    });
  }

  // R30 slice E — "Mine this", the verb that made the Mining tab's own
  // instructions to go somewhere else untrue.
  //
  // Deliberately NOT restricted to `kind === "asteroid"`. What can be mined is
  // the server's call, and a browser that pre-filtered on the runtime kind
  // would refuse ice and gas it has never been told about. Both reasons it can
  // be unusable are the SERVER'S OWN rules restated, not invented ones: a
  // module needs a lock before it will run on something, and there has to be
  // mining equipment switched on for there to be anything to run.
  //
  // R33 — AND THE ROCK ITSELF GETS A SAY. The panel already prints "Mined out"
  // in the Ore left column for a rock the server reads as empty, and until now
  // it printed that beside a live "Mine this" button. eve.js refuses both the
  // module (`miningRuntime.js` — `remainingQuantity <= 0` answers
  // TARGET_NOT_FOUND) and the drones (`droneRuntime.js` — a rock is mineable
  // only while `remainingQuantity > 0`), so that button could never have worked.
  //
  // ⚠ IT IS CHECKED AGAINST A HARD 0, NEVER AGAINST FALSINESS. `null` is "we
  // were not told", which is a completely different fact and must leave the
  // verb enabled — the decoder keeps the two apart precisely so this line can.
  // ⚠ AND IT IS FIRST, because it is the reason no other reason can fix: powering
  // up a laser and locking the rock will not put ore back into it.
  actions.push({
    id: "mine",
    label: "Mine this",
    concern: "module",
    unavailable:
      ctx.remainingQuantity === 0
        ? "There is no ore left in it"
        : (ctx.minerCount ?? 0) <= 0
          ? "No mining equipment is switched on — power some up under Your equipment"
          : !ctx.locked
            ? "Lock it first — your equipment needs a fix on it before it will run"
            : null,
  });

  // R23 — lock / release. GENERIC: the same button a combat goal uses, for the
  // same reason. Locking is not instant, so the middle state is shown honestly
  // rather than pretending the lock has landed.
  if (ctx.locked) {
    actions.push({ id: "unlock", label: "Release lock", concern: "lock", unavailable: null });
  } else if (ctx.acquiring) {
    actions.push({ id: "unlock", label: "Locking… stop", concern: "lock", unavailable: null });
  } else {
    actions.push({ id: "lock", label: "Lock", concern: "lock", unavailable: null });
  }

  return actions;
}

/**
 * What the bar says it is acting on, or why it is not acting on anything.
 *
 * ⚠ SELECTION NEVER SILENTLY RETARGETS. When the thing you picked leaves the
 * snapshot — it was mined out, it warped off, you jumped — the bar must not
 * quietly slide its verbs onto whatever row happens to be first now. The player
 * would press Warp to expecting one destination and get another. So a selection
 * that is no longer in the snapshot is CLEARED, and the bar says so in words.
 */
export const SELECTION_GONE = "That is no longer around your ship.";

// --- R30 slice E: the ship's own verbs ---------------------------------------

/** What "Haul now" needs to know, and nothing more. */
export interface ShipActionContext {
  /** The nearest station or structure on this grid, by NAME, or null. */
  readonly nearestStationName: string | null;
  /** Docked? Then hauling is just the unload, with nowhere to fly first. */
  readonly docked: boolean;
  /** Is there anything in the holds to move? */
  readonly hasCargo: boolean;
}

/**
 * "Haul now": take what you have mined to a station and unload it.
 *
 * ⚠ IT IS ALWAYS RETURNED, and every reason it cannot run right now is a
 * SENTENCE on the disabled control — never a missing button and never a silent
 * grey rectangle. A player who has just filled a hold and cannot find the haul
 * verb has no way to tell whether the app forgot it or decided against it, and
 * "there is no station on this grid" and "your holds are empty" are different
 * facts that a player acts on differently.
 *
 * It names the station it would fly to, so pressing it is never a surprise.
 */
export function shipActions(ctx: ShipActionContext): readonly RowAction[] {
  let label = "Haul now";
  let unavailable: string | null = null;
  if (!ctx.hasCargo) {
    unavailable = "There is nothing in your holds to take anywhere";
  } else if (ctx.docked) {
    label = "Unload the hold here";
  } else if (ctx.nearestStationName === null) {
    unavailable = "There is no station on this grid to take it to";
  } else {
    label = `Haul to ${ctx.nearestStationName}`;
  }
  return [{ id: "haul", label, concern: "hold", unavailable }];
}

/**
 * Does this equipment's NAME read like mining gear?
 *
 * ⚠ THIS IS A GUESS ABOUT A NAME, and it is never the last word — it decides
 * what "Mine this" reaches for, and the panel reports what each module actually
 * did afterwards, so a wrong guess is visible rather than silent. The browser
 * must never *decide* which of your modules is a mining laser, because a wrong
 * decision fires a turret at a rock.
 *
 * ⚠ THE EXCLUSION IS FROM A LIVE RUN. On a real Retriever the positive half
 * alone matched "Ice Harvester Upgrade II" — a low-slot passive upgrade, not
 * something you switch on — alongside the two Strip Miner Is that actually
 * mine. "Upgrade", "Rig" and "Processor" name the passives in every case this
 * client has seen.
 */
export function looksLikeMiningEquipment(label: string): boolean {
  return /miner|mining|strip|harvest|deep core/i.test(label) && !/upgrade|rig|processor/i.test(label);
}
