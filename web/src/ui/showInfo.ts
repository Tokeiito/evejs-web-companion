// SHOW INFO (goal R76) — what the info window is currently looking at.
//
// EVE's Show Info is the client's connective tissue: every name and every icon
// in the game opens one, and from there you can reach everything that thing is
// related to. This client had no such window at all — a name in the overview was
// a dead string, and the only way to learn anything about a module was to have
// it fitted and click its socket.
//
// ---------------------------------------------------------------------------
// WHY A SIGNAL AND NOT A PROP
//
// A Show Info opener has to work from anywhere: an overview row, a bracket on
// the tactical view, a fitting socket, an inventory tile, a target card. Those
// live in different subtrees — some in floating windows, some in fixed chrome —
// and threading an `onShowInfo` callback down every one of them would touch a
// dozen components to add a button to one. So the subject is a shared signal
// (the same shape `space/selection.ts` uses, and for the same reason), and the
// workspace watches it and raises the window.
//
// ---------------------------------------------------------------------------
// ⚠ THE SUBJECT KINDS ARE SHAPED BY WHAT CAN ACTUALLY BE SOURCED
//
// They are NOT a tidy taxonomy of game entities. Each kind exists because the
// client can answer a DIFFERENT set of questions about it from data it already
// holds:
//
//   • `type`      — a typeID and nothing else. Name, group, category, picture.
//                   Everything the name cache and the icon cache can give.
//   • `spaceObject` — something on the current grid. Adds distance, speed,
//                   condition and hostility, read from the live snapshot.
//   • `module`    — something in the active ship's fit. Adds the SERVER's
//                   post-dogma effective attributes (skills and hull bonuses
//                   already applied) — the only place real numbers exist.
//   • `character` — a pilot. Adds the standing we hold toward them, when we
//                   have one.
//
// There is deliberately no `station`, `corporation` or `blueprint` kind: nothing
// in this client can currently say anything about those beyond a name, and a
// window that opens to a name and the word "unknown" is worse than no window.
// Add a kind when there is a read to fill it.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

/** What the info window is looking at. */
export type InfoSubject =
  | { readonly kind: "type"; readonly typeID: number }
  | { readonly kind: "spaceObject"; readonly itemID: number; readonly typeID: number | null }
  | { readonly kind: "module"; readonly itemID: number; readonly typeID: number }
  | { readonly kind: "character"; readonly characterID: number };

/** The window's subject, and the one way to change it. */
export interface ShowInfoTarget {
  readonly subject: ReadableSignal<InfoSubject | null>;
  /**
   * A counter that rises on every `show()`, including a repeat of the SAME
   * subject.
   *
   * ⚠ THIS IS WHAT MAKES "SHOW INFO" WORK TWICE. The workspace raises the window
   * by watching this signal; if it watched the subject alone, asking for info on
   * the thing already displayed would change nothing, so a window the player had
   * since closed or buried would not come back. Clicking Show Info must always
   * put the window in front, whatever it is already showing.
   */
  readonly requests: ReadableSignal<number>;
  show(subject: InfoSubject): void;
  clear(): void;
}

export function createShowInfoTarget(): ShowInfoTarget {
  const subject = createSignal<InfoSubject | null>(null);
  const requests = createSignal(0);
  return {
    subject: readonlySignal(subject),
    requests: readonlySignal(requests),
    show: (next: InfoSubject): void => {
      subject.set(next);
      requests.update((count) => count + 1);
    },
    clear: (): void => {
      subject.set(null);
    },
  };
}

/** The app's one info window subject. */
export const showInfoTarget: ShowInfoTarget = createShowInfoTarget();

/** Convenience: open Show Info on a subject. */
export function showInfo(subject: InfoSubject): void {
  showInfoTarget.show(subject);
}

/**
 * Are two subjects the same thing?
 *
 * Used to avoid pointless re-reads, never to suppress a request — see the note
 * on `requests` above.
 */
export function sameSubject(a: InfoSubject | null, b: InfoSubject | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "type":
      return a.typeID === (b as typeof a).typeID;
    case "spaceObject":
      return a.itemID === (b as typeof a).itemID;
    case "module":
      return a.itemID === (b as typeof a).itemID;
    case "character":
      return a.characterID === (b as typeof a).characterID;
  }
}

/**
 * The typeID a subject can be pictured and named by, when it has one.
 *
 * A space object may genuinely have none — the snapshot carries `typeID: null`
 * for rows the runtime did not stamp — and that has to stay `null` rather than
 * becoming a 0 that the icon cache would then try to fetch.
 */
export function subjectTypeID(subject: InfoSubject | null): number | null {
  if (subject === null) {
    return null;
  }
  switch (subject.kind) {
    case "type":
    case "module":
      return subject.typeID;
    case "spaceObject":
      return subject.typeID;
    case "character":
      return null;
  }
}
