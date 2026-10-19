// The members of a pilot's corporation, read by whoever wants them (the plan's Phase 6b).
//
// Until 2026-10-11 the page asked one route of the BFF (GET /api/bridge/corp-members, with a pilot named), which
// made five reads of the corporation's registry and of which the page took one: that pilot's member row, to
// know whether the pilot is of its own's corporation.
//
// THE CALL, as the client makes it (bco_members.__PrimeEveOwners, 134 to 143):
//
//   eveowners = self.GetCorpRegistry().GetEveOwners()
//
// on the corporation's moniker (eveMoniker.GetCorpRegistry: Moniker('corpRegistry', session.corpid)), nothing
// sent. Recorded on Tranquility so, seven times. It answers a row for each member of the session's own
// corporation: the member's number, name, type and gender. The client keeps the numbers (141).
//
// WHO IS A MEMBER. A client knows it by that list: `if charID not in self.GetMemberIDs(): return` (GetMember,
// 161), before anything is asked. It asks the registry for a member's own row (168) only for a pilot the list
// has. The route asked for the row of whatever pilot was named, a call no client makes for a stranger.
//
// WHAT IS KEPT. The client asks once for a corporation and keeps the numbers, adding and removing as the server
// says a member changed (OnCorporationMemberChanged, 229). This function decodes an explicit raw RPC. The page's
// AppFlow.corporationMemberIDs instead reads IDs retained from the native login prime, through the atomic API.
//
// THE SESSION'S CORPORATION, AND NO OTHER. The server answers for the corporation of the session that asks, and
// reads nothing of what is sent.
//
// AN ANSWER THAT IS NO LIST IS NOT "A CORPORATION OF NOBODY", and so not "that pilot is no member" either. The
// read fails as the call fails, and says so where the answer is no list: a caller acting on membership takes a
// failure for "could not tell", and never for yes.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";
import { decodeCorpEveOwners } from "./corpMembers.ts";
import { isListValue } from "./wire.ts";

/**
 * The numbers of the characters in the pilot's own corporation, as its registry lists them. Fails as the call
 * fails; and where the server's answer is no list, which is no list of members at all.
 */
export async function readCorporationMemberIDs(ask: Ask): Promise<readonly number[]> {
  const answered = await ask("corpRegistry", "GetEveOwners", []);
  if (!isListValue(answered)) {
    throw new Error("Your corporation's members could not be read (the server did not answer with a list).");
  }
  return decodeCorpEveOwners(answered).map((owner) => owner.ownerID);
}
