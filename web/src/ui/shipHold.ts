// A hold of the active ship asked to be opened from outside the inventory (the Fitting window's readouts' OnHoldClicked:
// uicore.cmd.OpenCargoHoldOfActiveShip, OpenDroneBayOfActiveShip, OpenFighterBayOfActiveShip): the inventory opened as
// the Neocom opens it (docked, the dock panel), on the ship's holds, that hold unfolded and brought into view.
//
// Watched by the workspace, which opens the inventory, and by the inventory panel, which takes the hold asked for (as
// it mounts, and while it is open). The workspace watches the request counter, as the market details' request is
// watched (marketDetails.ts).

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

/** The holds the readouts open, by the bays' keys. */
export type ShipHoldKey = "cargo" | "drone" | "fighter";

export interface ShipHoldTarget {
  /** How many times a hold has been asked for. */
  readonly requests: ReadableSignal<number>;
  ask(key: ShipHoldKey): void;
  /** The hold asked for and not yet taken by the inventory panel, which takes it; null where there is none. */
  take(): ShipHoldKey | null;
}

export function createShipHoldTarget(): ShipHoldTarget {
  const requests = createSignal(0);
  let pending: ShipHoldKey | null = null;
  return {
    requests: readonlySignal(requests),
    ask(key) {
      pending = key;
      requests.update((count) => count + 1);
    },
    take() {
      const taken = pending;
      pending = null;
      return taken;
    },
  };
}

export const shipHoldTarget: ShipHoldTarget = createShipHoldTarget();

/** OpenCargoHoldOfActiveShip, OpenDroneBayOfActiveShip, OpenFighterBayOfActiveShip. */
export function openShipHold(key: ShipHoldKey): void {
  shipHoldTarget.ask(key);
}
