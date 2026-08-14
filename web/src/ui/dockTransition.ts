// THE DOCK / UNDOCK TRANSITION (goal R75) — when to play it, and what it says.
//
// WHY IT EXISTS. Docking and undocking are the biggest state changes in the
// client: half the panels appear or vanish, the viewport turns on or off, the
// HUD bar arrives or leaves. Until now that happened between two frames, with no
// acknowledgement at all, which reads as the page having been swapped rather
// than as a ship moving through a station door. A short fade is the whole fix,
// and it is the one piece of "feel" the retail client gets from a cutscene we
// have no way to reproduce.
//
// The decision lives here rather than in the component for one reason that is
// easy to get wrong and hard to notice: THE FIRST OBSERVATION IS NOT A CHANGE.

/** How long the whole fade lasts, in milliseconds. */
export const DOCK_WIPE_MS = 620;

/** The docked flag as this module sees it — `null` before the first reading. */
export type DockedReading = boolean | null;

/**
 * Should the transition play?
 *
 * ⚠ NOT ON THE FIRST READING, EVER. A pilot who signs in while docked, or whose
 * session is restored on a page refresh, produces a first `isDocked` of `true`
 * out of nowhere — and a naive "it changed, so animate" would black the screen
 * on every single login and every refresh, for a docking that did not happen.
 * `previous === null` means "we have never looked", which is why the reading is
 * three-valued rather than a boolean with a false default. A `false` default
 * would make "signed in while in space" indistinguishable from "just undocked".
 */
export function shouldPlayDockWipe(previous: DockedReading, next: boolean): boolean {
  return previous !== null && previous !== next;
}

/**
 * What the transition says while it plays.
 *
 * Announced through an aria-live region, so the change is reported to a screen
 * reader rather than being a purely visual event — and shown as text, because a
 * black screen with no words is indistinguishable from a client that has hung.
 */
export function dockWipeLabel(nowDocked: boolean): string {
  return nowDocked ? "Docking" : "Undocking";
}
