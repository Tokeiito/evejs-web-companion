// What the station picker says when a search fails.
//
// /api/map/find reads only the static map, but it is login-gated, and in this
// app the login IS a pilot coming online: a tab with no pilot online rides the
// shared cookie, which expires after config.sessionTtlMs. The search then
// answers 401, and "try again" is advice that can never work. Saying what does
// work is the whole fix.

import { BridgeCallError } from "../bridge/callMethod.ts";

export const SEARCH_NEEDS_PILOT =
  "Searching stations needs a pilot online in this tab. Bring one online and search again.";

export const SEARCH_FAILED = "Could not search just now — try again.";

export function stationSearchFailure(error: unknown): string {
  return error instanceof BridgeCallError && error.status === 401 ? SEARCH_NEEDS_PILOT : SEARCH_FAILED;
}
