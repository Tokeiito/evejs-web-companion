// An agent's two writes made by the page itself (the plan's Phase 6b): what is said to an agent, and an offer
// taken out of the journal.
//
// Until 2026-10-13 each was a route of the BFF (POST /api/bridge/agents/:agentID/action and .../remove-offer),
// which made the one call on the object it had bound for that agent and handed the answer on as it came.
//
// THE CALLS, as the client makes them, each on the agent's own object, GetAgentMoniker(agentID)
// (eve/client/script/ui/station/agents/agents.py 316 to 323: eveMoniker.GetAgent(agentID, stationID), kept by the
// agents service):
//
//   DoAction(actionID)         agentDialogueWindow.ExecuteAgentAction (427 to 428). The window opens on DoAction(None)
//                              and, where the first thing offered is to request a mission or to view one, asks
//                              that at once (_GetConversation, 402 to 411); a button of the window asks its own
//                              number, which the agent gave with what it said. One conversation with an agent
//                              at a time (InteractWithAgent, 183 to 197). The flow keeps those rules
//                              (app/flow.ts: talkToAgent, interactWithAgent).
//   RemoveOfferFromJournal()   agents.RemoveOfferFromJournal (782 to 784), from the journal's menu for a mission
//                              that is offered and not accepted (missionentry.py 66 to 67 and 74 to 76). No
//                              arguments: which offer is which agent's object is asked.
//
// Tranquility has DoAction in 23 recordings, as a call on the agent's object, and once inside the binding of
// that object: DoAction(None), the opening of a conversation. No recording has an offer removed.
//
// THE PAGE SAYS WHICH AGENT WITH `of`, as it does for a warp to a mission's spot (bridge/movementWrites.ts): the
// BFF makes the call on the object bound for that agent, and holds none for the page.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the agent, and the action's number. It answers for the session's own
// character's standing and mission with that agent. In the middle of a call it may ask its pilot a question (a
// mission quit or declined: agents.YesNo), which reaches the page on the pilot's stream and is answered on a
// route of its own; the call waits for the answer.
//
// ⚠ DoAction's ANSWER IS THE CONVERSATION, raw: ((what the agent says, the actions on offer), what the last
// action did). The caller decodes it (bridge/agents.ts, decodeConversation). An action's number is good for the
// conversation it came with: the agent gives new ones each time it speaks.

import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

function agentNumber(agentID: number): number {
  if (!Number.isSafeInteger(agentID) || agentID <= 0) throw new Error("That agent could not be identified.");
  return agentID;
}

/**
 * Says something to an agent: `actionID` null opens the conversation, and a number the agent offered presses that
 * button. Answers the conversation as it came. Fails as the call fails.
 */
export async function doAgentAction(act: Ask, agentID: number, actionID: number | null): Promise<JsonValue> {
  if (actionID !== null && !Number.isSafeInteger(actionID)) throw new Error("That is not something this agent offered.");
  return act("agentMgr", "DoAction", [actionID], undefined, agentNumber(agentID));
}

/** Takes an agent's offer out of the journal. Fails as the call fails. */
export async function removeOfferFromJournal(act: Ask, agentID: number): Promise<void> {
  await act("agentMgr", "RemoveOfferFromJournal", [], undefined, agentNumber(agentID));
}
