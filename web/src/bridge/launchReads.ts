// A pilot's planetary launches, read by whoever wants them (the plan's Phase 6b).
//
// Until 2026-10-11 the page asked one route of the BFF (GET /api/bridge/pi-colonies), which made two calls (the
// pilot's colonies and its launches) and of which the page read the launches alone.
//
// THE CALL, as the client makes it (planetUISvc.GetLaunches, 170 to 173):
//
//   self.launchsRowSet = sm.RemoteSvc('planetMgr').GetMyLaunchesDetails()
//
// of the planet manager by its name, nothing sent. Recorded on Tranquility so. It answers a rowset of the
// launches of the session's own character: each launch's number, its solar system, its container's item, its
// owner, its planet, its status, when it was launched, and where it is.
//
// WHAT IS KEPT. The client asks once and keeps the rowset until the server says the launches changed
// (OnPILaunchesChange, 175). So does the transport on the game port, which answers this from what it keeps
// (src/gamePort/pilots.js); through the web gateway it is asked each time.
//
// AN ANSWER OF NOTHING IS NOT "NO LAUNCHES". The list is a rowset even when it is empty. A server that could not
// put its answer on the wire answers the call with nothing at all, and a haul told "no launches" for that would
// fly past a container it was never told about. The read says so.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";
import { decodeLaunchDetails, type LaunchDetail } from "./piColonies.ts";

/**
 * The pilot's launches, as the server lists them. Fails as the call fails; and where the server answered with
 * nothing, which is no list at all.
 */
export async function readMyLaunches(ask: Ask): Promise<readonly LaunchDetail[]> {
  const answered = await ask("planetMgr", "GetMyLaunchesDetails", []);
  if (answered === null || answered === undefined) {
    throw new Error("Your planet launches could not be read (the server answered with nothing).");
  }
  return decodeLaunchDetails(answered);
}
