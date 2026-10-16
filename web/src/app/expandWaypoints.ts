// The route window's Waypoints Expanded (autopilotSettings.py 45 and OnCheckboxWaypoints, 99 to 102): the user's
// setting expandwaypoints (settings.user.ui), 1 until changed. Ticked, the window lists the systems the route goes
// through between the waypoints (LoadWaypoints, 131 to 140); a click sets it to the tick's new state.
//
// The client keeps it for its user on that machine; the page keeps it in this browser, for every pilot in it.

import { createSignal, type ReadableSignal } from "../store/signals.ts";

const KEPT = "evejs-web-user-ui:expandwaypoints";

function readKept(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEPT) !== "0";
  } catch {
    return true;
  }
}

const setting = createSignal(readKept());

/** Whether the route window lists the systems between the waypoints: on (the client's 1) until changed. */
export const expandWaypoints: ReadableSignal<boolean> = {
  get: () => setting.get(),
  subscribe: (listener) => setting.subscribe(listener),
};

/** The tick clicked (OnCheckboxWaypoints): the setting the tick's new state, and kept. */
export function setExpandWaypoints(checked: boolean): void {
  setting.set(checked);
  try {
    globalThis.localStorage?.setItem(KEPT, checked ? "1" : "0");
  } catch {
    // Not kept: it holds for this page's life.
  }
}
