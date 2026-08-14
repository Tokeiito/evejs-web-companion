// WHAT YOU HAVE PICKED IN SPACE (goal R70) — one selection, shared by every
// surface that can show it.
//
// WHY THIS LEFT THE PANEL. R30 slice D put the overview's verbs on a single
// selection bar, and the picked id lived in `Overview.svelte` as component
// `$state` — which was right while the overview was the only thing that could
// show you an object. The tactical viewport makes that false: clicking a bracket
// in the picture and clicking Select in the list are the SAME act, and a player
// who picks a rock on the viewport and then looks at the list must find it
// picked there too. Two copies of "what is selected" is two things to keep in
// sync, and the first poll that disagreed would put a verb bar and a highlighted
// bracket on two different objects.
//
// It is also not merely a parent/child prop. `Overview` is a WINDOW tab — it is
// mounted by `PanelHost` inside a floating desktop window, not always as a child
// of the shell that draws the viewport — so there is no common ancestor to hold
// the state and pass it down.
//
// So it is a signal, on the same framework-agnostic primitive the client store
// is built on (`store/signals.ts`). A signal satisfies the Svelte store contract,
// so a component reads it as `$spaceSelection` with no adapter.
//
// ⚠ THIS IS VIEW STATE AND IT DOES NOT BELONG IN THE CLIENT STORE. The store
// holds what the SERVER reports; a selection is a thing the player is doing with
// their eyes. Keeping it out means a snapshot poll can never clobber it and a
// selection can never be mistaken for something the ship said.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
// The sentence a vanished selection is announced with already exists, beside the
// verbs it explains the absence of. Re-exported rather than restated: two copies
// of a player-facing sentence drift, and the drift is invisible until someone
// notices the picture and the list saying different things about the same event.
export { SELECTION_GONE } from "./rowActions.ts";

/**
 * The sentinel id for the overview's "Somewhere else…" row — a destination that
 * is not a ball on this grid (R30 slice F).
 *
 * Negative on purpose: every real itemID the server issues is positive, so this
 * can never collide with one, and the "did my selection leave the snapshot?"
 * check can recognise and skip it rather than announcing it as vanished on every
 * poll. It lives here, beside the selection it is a possible value of, so the
 * viewport can recognise it too — a bracket must never be drawn for it.
 */
export const SOMEWHERE_ELSE = -1;

/** What the player has picked, and the handful of ways it can change. */
export interface SpaceSelection {
  /** The picked itemID, `SOMEWHERE_ELSE`, or null when nothing is picked. */
  readonly selected: ReadableSignal<number | null>;
  /**
   * Why the selection was dropped, when it was dropped FOR the player rather
   * than BY them. Empty when there is nothing to say.
   *
   * ⚠ A selection that vanishes is always SAID. A bar that silently emptied
   * itself leaves a player who clicked a rock two seconds ago wondering what
   * they did wrong; worse, one that silently retargeted would point Warp to at
   * something they never picked.
   */
  readonly notice: ReadableSignal<string>;
  /** Pick this object, or unpick it if it was already picked. */
  toggle(itemID: number): void;
  /** Pick this object outright (a viewport click on a fresh bracket). */
  select(itemID: number | null): void;
  /** Drop the selection because the player asked. Says nothing. */
  clear(): void;
  /** Drop it because it stopped existing, and say so. */
  dropWithNotice(message: string): void;
  /** Clear the notice without touching the selection. */
  clearNotice(): void;
}

/**
 * Build an independent selection. Exported so a test can hold one that no other
 * test can reach; the app uses the shared `spaceSelection` below.
 */
export function createSpaceSelection(): SpaceSelection {
  const selected = createSignal<number | null>(null);
  const notice = createSignal<string>("");

  const select = (itemID: number | null): void => {
    selected.set(itemID);
    // A fresh pick starts with a clean slate: the reason the LAST selection went
    // away is not a fact about this one.
    notice.set("");
  };

  return {
    selected: readonlySignal(selected),
    notice: readonlySignal(notice),
    select,
    toggle: (itemID: number): void => {
      select(selected.get() === itemID ? null : itemID);
    },
    clear: (): void => {
      select(null);
    },
    dropWithNotice: (message: string): void => {
      selected.set(null);
      notice.set(message);
    },
    clearNotice: (): void => {
      notice.set("");
    },
  };
}

/**
 * The app's one selection. A module singleton because there is one ship, one
 * grid and one thing the player is looking at — and because the surfaces that
 * share it (the viewport in the shell, the overview in a floating window) have
 * no common ancestor to hand it down from.
 */
export const spaceSelection: SpaceSelection = createSpaceSelection();

/**
 * Has the picked object left the grid?
 *
 * Pure and caller-driven, so it can be tested without a snapshot poll, and so
 * the panel keeps ownership of WHEN to ask. It answers false for
 * `SOMEWHERE_ELSE` — that is not a ball in space, so it can never leave one, and
 * asking would announce it as vanished on every single poll.
 */
export function selectionHasVanished(
  selectedID: number | null,
  entityIDs: ReadonlySet<number>,
): boolean {
  if (selectedID === null || selectedID === SOMEWHERE_ELSE) {
    return false;
  }
  return !entityIDs.has(selectedID);
}
