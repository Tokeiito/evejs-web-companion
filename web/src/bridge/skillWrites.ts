// The skill queue's writes, made by the page itself (the plan's Phase 6b).
//
// The first of the page's writes to leave its route. Until 2026-10-10 the pause
// of training was POST /api/bridge/skills/abort-training, which checked that
// the page had said `confirm` and made one call. A retail client has no such
// route: its queue panel's Pause makes the call
// (skillQueuePanelNew.PauseTraining, where a skill is in training:
// skills.AbortTrain(), which is the handler's AbortTraining()), with no asking
// of the pilot first, and then commits its queue unactivated, which with the
// queue unchanged sends nothing (skillQueueSvc.CommitTransaction 147).
//
// THE CALL, as the client makes it:
//
//   skillHandler.AbortTraining()   skillsvc.py 796: with nothing, on the skill handler's moniker.
//                                  Recorded on Tranquility; the server then says
//                                  OnServerSkillsChanged with the event OnSkillQueuePausedServer.
//
// HOW A WRITE IS MADE BY THE PAGE. By the generic call, as a read is, with two
// things said: that it is a pilot's (`pilot`), and that the page means it
// (`confirm`), which is what a route's confirmation was. The BFF makes it only
// for a write on its list of those the page makes itself
// (src/bridgeCallPolicy.js, PAGE_WRITE_PAIR_KEYS), under the checks every write
// of a held pilot's is under. `api.bridgeDo` is that asking.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

import type { Ask } from "./ask.ts";

/** The queue panel's Pause: the skill in training stops, and the queue stays as it is. Fails as the call fails. */
export async function pauseTraining(act: Ask): Promise<void> {
  await act("skillHandler", "AbortTraining", []);
}
