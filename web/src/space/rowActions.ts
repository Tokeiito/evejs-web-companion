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
  | "unlock";

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
