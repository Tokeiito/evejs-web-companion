// The autopilot's and the star map's notify messages, in the page's flash as the client shows a notify dialog: its
// body. They are the client's own (autopilot.py SetOn, 84 to 116, and SetOff, 125 to 143; starMapSvc.py SetWaypoint,
// 2327 to 2344), said by the flow's waypoints and autopilot (app/flow.ts, autopilotSaid).
//
// Watched for as long as the pilot's workspace is on screen (NotificationPopups.svelte): what was said before is not
// said again when the workspace comes back.

import { notify } from "./notices.ts";
import { plainText } from "../bridge/clientWords.ts";
import type { AppFlow } from "../app/flow.ts";
import type { ClientStore } from "../store/clientStore.ts";

/** The page's own words for each message, where the install's are not read. */
const OWN: Readonly<Record<string, string>> = {
  AutoPilotEnabled: "Autopilot on",
  AutoPilotDisabled: "Autopilot off",
  AutoPilotWaypointReached: "Autopilot off at a waypoint",
  AutoPilotDisabledNoPathSet: "Autopilot off: nowhere to go",
  WaypointAlreadySet: "That place is on the route already",
  WaypointAlreadyInConstellation: "You are in that constellation",
  WaypointAlreadyInRegion: "You are in that region",
  CantSetWaypoint: "That place cannot be on the route",
};

/** A place that is no destination is the client's Command message, its words this label's (starMapSvc.py 2330). */
const CANT_SET_WAYPOINT = "UI/Map/StarMap/CantSetWaypoint";

const labelOf = (dialog: string): string => (dialog === "CantSetWaypoint" ? CANT_SET_WAYPOINT : `dialog:${dialog}/body`);

/** Show each message the flow says from now on. Returns the unsubscriber. */
export function watchAutopilotNotices(store: ClientStore, flow: AppFlow): () => void {
  flow.requestWords(Object.keys(OWN).map(labelOf));
  let first = true;
  return flow.autopilotSaid.subscribe((said) => {
    // The value at subscribing is what was said before: not said again.
    if (first) {
      first = false;
      return;
    }
    if (said === null) return;
    const template = store.words.get().templates[labelOf(said.dialog)];
    const text = typeof template === "string" ? plainText(template) : OWN[said.dialog] ?? said.dialog;
    notify({ kind: "info", title: text, key: `autopilot:${said.n}` });
  });
}
