// Crimewatch's read, made by whoever shows the pilot's timers (the plan's Phase 6b).
//
// Until 2026-10-10 the page asked one route of the BFF (GET /api/bridge/crimewatch),
// which made one call and put its own clock beside the answer. A retail client
// has no such route: its crimewatch service asks
// (eve/client/script/ui/services/crimewatchSvc.py), and its timers count against
// the client's own clock. This is that asking, by the generic call (ask.ts), the
// same on either transport.
//
// THE CALL, as the client makes it:
//
//   crimewatch.GetClientStates()   crimewatchSvc.py 89: with nothing, on the moniker for where the pilot is,
//                                  made for the call. It answers the timers, the engagements, the two sets
//                                  of flagged characters, and the ship's safety level.
//
// On Tranquility the call is in 36 of the recordings' files, as the call a bind
// of crimewatch carried.
//
// WHAT IS KEPT. The client's service has the states from the choosing of the
// character and changes them at the server's notices, asking nothing. So does
// the transport on the game port, which answers this call from the states it
// keeps (src/gamePort/pilots.js, crimewatchStates.js). The page reads them at
// the choosing and at each notice (app/flow.ts).
//
// THE CLOCK the timers are counted against is the server's as the page has it:
// what the answers of its pilot's calls say (wire.ts, serverNowMs).
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** The pilot's crimewatch states as the server answers them (decoded by space/crimewatch.ts). Fails as the call fails. */
export function readClientStates(ask: Ask): Promise<JsonValue> {
  return ask("crimewatch", "GetClientStates", []);
}
