// The Fitting window asked for from outside it: the fitting display window's Simulate (fittingMgmtCont.SimulateFitting,
// 405 to 413: FittingWindow.Maximize where it is open, else uicore.cmd.OpenFitting, then the fitting simulated).
//
// Watched as the compare tool's requests are (typeCompare.ts): by the workspace, which opens the window or raises it.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

export interface FittingWindowTarget {
  /** How many times the window has been asked for. */
  readonly requests: ReadableSignal<number>;
  ask(): void;
}

export function createFittingWindowTarget(): FittingWindowTarget {
  const requests = createSignal(0);
  return {
    requests: readonlySignal(requests),
    ask() {
      requests.update((count) => count + 1);
    },
  };
}

export const fittingWindowTarget: FittingWindowTarget = createFittingWindowTarget();

/** The Fitting window opened, or raised where it is open. */
export function openFittingWindow(): void {
  fittingWindowTarget.ask();
}
