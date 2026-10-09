"use strict";

// The pilot's agents' journal as the retail client's journal service keeps it
// (eve/client/script/ui/shared/neocom/journal.py, JournalSvc).
//
// The service asks for the whole journal once, when something first wants it
// (_UpdateMissionDataFull):
//
//   agentMgr.GetMyJournalDetails()   (missions, research), each a list
//
// and keeps it. From then on a mission's change marks its agent, and the next
// reading asks each marked agent for its own part (_UpdateMissionDataPartial):
//
//   OnAgentMissionChange(missionState, agentID)
//       with no agent the whole journal is forgotten; with one, the agent is
//       marked, once
//   Moniker('agentMgr', agentID).GetMyJournalDetails()
//       for each marked agent, at once. The first mission kept for that agent
//       is taken out, and what the agent answered is put at the end of each of
//       the two lists.
//
// Two things of the client's that follow from that, kept: only the first
// mission of an agent is taken out, and nothing is taken out of the second
// list, so an agent that answers something there again has it there twice.
//
// A mission is a tuple whose fifth part is its agent: (missionState,
// importantMission, missionTypeLabel, missionNameID, agentID, expirationTime,
// bookmarks, remoteOfferable, remoteCompletable, contentID). Everything is kept
// as it came off the wire.

const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const isList = (value) => Boolean(value && Array.isArray(value.items));
/** What GetMyJournalDetails answers, read: its two lists' items, or null where it is no such answer. */
const twoLists = (answer) => (Array.isArray(answer) && isList(answer[0]) && isList(answer[1]) ? [[...answer[0].items], [...answer[1].items]] : null);
const agentOf = (mission) => (Array.isArray(mission) ? number(mission[4]) : null);

function createPilotJournal() {
  /** self.agentjournal: [missions, research], or null where not read or forgotten. */
  let journal = null;
  /** self.outdatedAgentJournals */
  let outdated = [];

  return {
    /** Whether a journal is kept. */
    get kept() { return journal !== null; },
    /** _UpdateMissionDataFull: what agentMgr.GetMyJournalDetails answered. False where it is no journal: what was kept is then as it was. */
    full(answer) {
      const read = twoLists(answer);
      if (!read) return false;
      journal = read;
      return true;
    },
    /** The marked agents, in the order they were marked, which are then marked no longer (the first lines of _UpdateMissionDataPartial). */
    takeOutdated() {
      const taken = outdated;
      outdated = [];
      return taken;
    },
    /**
     * The rest of _UpdateMissionDataPartial: `answers[i]` is what `agentIDs[i]` answered for its own journal. An
     * answer that is no journal stops it there, as it stops the client's (the agents before it are done).
     */
    partial(agentIDs, answers) {
      if (!journal) return;
      for (const agentID of agentIDs) {
        const at = journal[0].findIndex((mission) => agentOf(mission) === agentID);
        if (at !== -1) journal[0].splice(at, 1);
      }
      for (const answer of answers) {
        const read = twoLists(answer);
        if (!read) return;
        journal[0].push(...read[0]);
        journal[1].push(...read[1]);
      }
    },
    /** The server pushes a notification. True where the journal is now to be read again. */
    feed(notification) {
      if (notification.method !== "OnAgentMissionChange") return false;
      const agentID = Array.isArray(notification.args) ? notification.args[1] : undefined;
      if (agentID === null || agentID === undefined) journal = null;
      else if (!outdated.includes(number(agentID))) outdated.push(number(agentID));
      return true;
    },
    /** self.agentjournal, as GetMyJournalDetails would be read now. Null with none kept. */
    read: () => (journal ? [{ type: "list", items: [...journal[0]] }, { type: "list", items: [...journal[1]] }] : null),
  };
}

module.exports = { createPilotJournal };
