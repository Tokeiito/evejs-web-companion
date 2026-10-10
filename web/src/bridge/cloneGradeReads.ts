// The clone grade's read, made by the page itself (the plan's Phase 6b).
//
// Until 2026-10-10 the page asked one route of the BFF (GET /api/bridge/clone-grade),
// which made one call for a pilot on the game port and said it had none to give
// for one through the web gateway. A retail client has no such route: its clone
// grade service asks (omega/client/clone_grade_svc.py). This is that asking, by
// the generic call (ask.ts).
//
// THE CALL, as the client makes it:
//
//   subscriptionMgr.GetCloneGrade()   clone_grade_svc.py 125: by the service's name, with nothing. It answers
//                                     0 for an alpha clone and 1 for an omega (clonegrade/const.py).
//
// The client asks as the account comes onto the session and keeps the answer;
// from then on the grade is what OnSubscriptionChangedServer says. So does the
// transport on the game port, which asked at the pilot's login and answers this
// call from what it keeps (src/gamePort/pilots.js). The page reads it once as
// the pilot comes online, and takes the notice itself (app/flow.ts).
//
// THROUGH THE WEB GATEWAY the call is not carried: its list has nothing of the
// subscription manager's. Then there is no grade to be had, and this says none.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import { failureCode, type Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/**
 * The account's clone grade as the server answers it (read by bridge/cloneGrade.ts), or null where the pilot's
 * transport does not carry the call. Fails as the call fails otherwise.
 */
export async function readCloneGrade(ask: Ask): Promise<JsonValue> {
  try {
    return await ask("subscriptionMgr", "GetCloneGrade", []);
  } catch (error) {
    if (failureCode(error) === "CALL_NOT_ALLOWED") return null;
    throw error;
  }
}
