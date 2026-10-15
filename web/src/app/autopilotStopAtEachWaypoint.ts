// The route panel's Disable Autopilot at Each Waypoint (infoPanelRoute.py GetSettingsMenu, 115, and
// OnCheckBoxDisableAtEachWaypoint, 191 to 194): the user's setting autopilot_stop_at_each_waypoint (settings.user.ui),
// 0 until changed. The tick is drawn ticked where the setting is 0, and a click sets the setting to the opposite of
// what it is. With it at 0, UpdateRoute switches the autopilot off at each waypoint reached ("waypoint reached",
// starMapSvc.py 2448 to 2450); otherwise the autopilot is left on, and flies on along the route.
//
// The client keeps it for its user on that machine; the page keeps it in this browser, for every pilot in it.

import { createSignal, type ReadableSignal } from "../store/signals.ts";

const KEPT = "evejs-web-user-ui:autopilot_stop_at_each_waypoint";

function readKept(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEPT) === "1";
  } catch {
    return false;
  }
}

/** The setting as the client keeps it: false (its 0) until changed. */
const setting = createSignal(readKept());

/** Whether the route panel's Disable Autopilot at Each Waypoint is ticked: the setting at 0. */
export const disableAutopilotAtEachWaypoint: ReadableSignal<boolean> = {
  get: () => !setting.get(),
  subscribe: (listener) => setting.subscribe((value) => listener(!value)),
};

/** The tick clicked (OnCheckBoxDisableAtEachWaypoint): the setting the opposite of what it is, and kept. */
export function clickDisableAutopilotAtEachWaypoint(): void {
  const next = !setting.get();
  setting.set(next);
  try {
    globalThis.localStorage?.setItem(KEPT, next ? "1" : "0");
  } catch {
    // Not kept: it holds for this page's life.
  }
}
