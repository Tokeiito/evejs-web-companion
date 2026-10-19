// A search of the pilot's things asked for from outside the assets window (invItemFunctions.FindInPersonalAssets, 652
// to 661: the assets window opened, or brought up, on its Search tab with the type's exact name to search by).
//
// Watched as the market's details are (marketDetails.ts): by the workspace, which opens the assets window, and by the
// assets window, which takes the text (as it mounts, and while it is open) and searches. The workspace watches the
// request counter, so that asking twice for the same text still brings the window back to the front.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

export interface AssetsSearchTarget {
  /** How many times a search has been asked for. */
  readonly requests: ReadableSignal<number>;
  ask(text: string): void;
  /** The text asked for and not yet taken by the assets window, which takes it; null where there is none. */
  take(): string | null;
}

export function createAssetsSearchTarget(): AssetsSearchTarget {
  const requests = createSignal(0);
  let pending: string | null = null;
  return {
    requests: readonlySignal(requests),
    ask(text) {
      pending = text;
      requests.update((count) => count + 1);
    },
    take() {
      const taken = pending;
      pending = null;
      return taken;
    },
  };
}

export const assetsSearchTarget: AssetsSearchTarget = createAssetsSearchTarget();

/** FindInPersonalAssets: the assets window on its Search tab, searching the text given (GetSearchTextForTypeID's). */
export function findInPersonalAssets(text: string): void {
  assetsSearchTarget.ask(text);
}
