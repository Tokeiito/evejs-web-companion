// A window opened or, where it is open, closed, asked from outside the workspace: the HUD's utility buttons (the
// cargo button's Inventory.OpenOrShow(cargo of the active ship, toggle=True), the scanner menu's ToggleProbeScanner).
// Watched by the workspace by its request counter, as shipHold.ts's requests are: asking twice must still act.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import type { TabID } from "./tabs.ts";

export interface WindowToggleTarget {
  /** How many times a window has been asked to be toggled. */
  readonly requests: ReadableSignal<number>;
  ask(id: TabID): void;
  /** The window asked for and not yet taken by the workspace, which takes it; null where there is none. */
  take(): TabID | null;
}

export function createWindowToggleTarget(): WindowToggleTarget {
  const requests = createSignal(0);
  let pending: TabID | null = null;
  return {
    requests: readonlySignal(requests),
    ask(id) {
      pending = id;
      requests.update((count) => count + 1);
    },
    take() {
      const taken = pending;
      pending = null;
      return taken;
    },
  };
}

export const windowToggleTarget: WindowToggleTarget = createWindowToggleTarget();

/** Opens the window, or closes it where it is open. */
export function toggleWindow(id: TabID): void {
  windowToggleTarget.ask(id);
}
