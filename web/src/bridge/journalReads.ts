// The agents' journal's read, made by whoever shows it (the plan's Phase 6b).
//
// Until 2026-10-10 the page asked one route of the BFF (GET /api/bridge/journal),
// which answered the journal as the game-port transport keeps it, or asked for
// it through the web gateway. A retail client has no such route: every window
// of its that wants the journal reads its journal service
// (eve/client/script/ui/shared/neocom/journal.py, GetMyAgentJournalDetails), and
// that service asks the server. This is that asking, by the generic call
// (ask.ts), the same on either transport.
//
// THE CALL, as the client's journal service makes it:
//
//   agentMgr.GetMyJournalDetails()   journal.py 312: by the service's name, with nothing. It answers
//                                    (the missions, the research), each a list.
//
// WHAT IS KEPT. The client's service asks for the whole journal once and keeps
// it; a mission's change marks its agent (OnAgentMissionChange), and the next
// reading asks each marked agent for its own part on that agent's moniker (325)
// and puts it into what is kept. So does the transport on the game port, which
// answers this call from the journal it keeps, made right first
// (src/gamePort/pilots.js, pilotJournal.js). Through the web gateway the call is
// made each time it is asked for, as the route made it.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** The journal as the server answers it: the missions and the research (decoded in bridge/agents.ts). Fails as the call fails. */
export function readJournal(ask: Ask): Promise<JsonValue> {
  return ask("agentMgr", "GetMyJournalDetails", []);
}
