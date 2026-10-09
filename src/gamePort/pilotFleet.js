"use strict";

// The pilot's fleet as the retail client's fleet service keeps it
// (eve/client/script/parklife/fleetSvc.py).
//
// The client asks a fleet for its state once, when it forms or joins one
// (InitFleet: GetInitState), and from then on keeps it right from what the
// server tells it as things happen:
//
//   OnFleetJoin(member)        another pilot's: members[charID] = member.
//                              The pilot's own: InitFleet again.
//   OnFleetLeave(charID)       that member is gone. The pilot's own leaving
//                              clears everything (Clear).
//   OnFleetDisbanded(charIDs)  each of them has left
//   OnFleetMemberChanged(charID, fleetID, five old things, newWingID,
//       newSquadID, newRole, newJob, newMemberOptOuts, isOnlyMember)
//                              members[charID] is a new record of charID and
//                              those five, and nothing else
//   OnFleetOptionsChanged(old, options)   options
//   OnFleetMotdChanged(motd, reload)      motd
//   OnFleetWingAdded, OnFleetWingDeleted, OnFleetWingNameChanged,
//   OnFleetSquadAdded, OnFleetSquadDeleted, OnFleetSquadNameChanged
//                              the wings are asked for again
//                              (self.wings = self.fleet.GetWings())
//
// A session whose fleet changes has no members until the state is read again
// (ProcessSessionChange). Several of these can come in one notification,
// "__MultiEvent": a list of (name, args), each scattered as its own
// (BroadcastStuffGPCS.py).
//
// Everything is kept as it came off the wire, so what is read back is in the
// form the server answers GetInitState in. Only what the client keeps is kept
// right: a member's ship and place are as they were when it joined, which is
// why the client's own window for those asks GetFleetComposition.

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
const isKeyVal = (value) => Boolean(value && value.type === "object" && value.args && value.args.type === "dict" && Array.isArray(value.args.entries));
const isDict = (value) => Boolean(value && value.type === "dict" && Array.isArray(value.entries));
/** A util.KeyVal's field, by name: undefined where it has none. */
const field = (keyVal, name) => {
  const entry = isKeyVal(keyVal) ? keyVal.args.entries.find(([key]) => text(key) === name) : undefined;
  return entry ? entry[1] : undefined;
};

const WINGS_ASKED_AGAIN = new Set([
  "OnFleetWingAdded", "OnFleetWingDeleted", "OnFleetWingNameChanged",
  "OnFleetSquadAdded", "OnFleetSquadDeleted", "OnFleetSquadNameChanged",
]);
/** What a member's record is made of after OnFleetMemberChanged, with where each comes in the notice. */
const CHANGED_FIELDS = Object.freeze([["wingID", 7], ["squadID", 8], ["role", 9], ["job", 10], ["memberOptOuts", 11]]);

function createPilotFleet({ characterID }) {
  /** What GetInitState answered, whole; null until it has. */
  let state = null;
  /** charID -> [the key it came under, the member's record]. */
  let members = new Map();
  let wings = null;
  let options = null;
  let motd = null;

  /** fleetSvc.Clear, as far as this goes. */
  function clear() {
    state = null;
    members = new Map();
    wings = null;
    options = null;
    motd = null;
  }

  /** InitFleet: what GetInitState answered. False where it was not a fleet's state: what was kept is as it was. */
  function init(answer) {
    const roster = field(answer, "members");
    if (!isDict(roster)) return false;
    state = answer;
    members = new Map(roster.entries.map(([key, member]) => [number(key), [key, member]]));
    wings = field(answer, "wings") ?? null;
    options = field(answer, "options") ?? null;
    motd = field(answer, "motd") ?? null;
    return true;
  }

  function left(charID) {
    if (charID === characterID) {
      clear();
      return true;
    }
    members.delete(charID);
    return false;
  }

  /** One of the server's notices, by name. Answers what the client does next of its own accord, if anything. */
  function apply(method, args) {
    if (method === "OnFleetJoin") {
      const charID = number(field(args[0], "charID"));
      if (charID === characterID) return "init";
      if (charID !== null) members.set(charID, [(members.get(charID) ?? [charID])[0], args[0]]);
    } else if (method === "OnFleetLeave") {
      if (left(number(args[0]))) return "left";
    } else if (method === "OnFleetDisbanded") {
      // Each of them has left; with the pilot's own among them nothing is kept, so the rest need no taking out.
      if (items(args[0]).some((charID) => left(number(charID)))) return "left";
    } else if (method === "OnFleetMemberChanged") {
      const charID = number(args[0]);
      if (charID !== null && args.length > 11) {
        const [key, was] = members.get(charID) ?? [charID, null];
        const record = { type: "object", name: (isKeyVal(was) ? was : state ?? {}).name ?? "util.KeyVal", args: { type: "dict", entries: [["charID", args[0]], ...CHANGED_FIELDS.map(([name, index]) => [name, args[index]])] } };
        members.set(charID, [key, record]);
      }
    } else if (method === "OnFleetOptionsChanged") {
      options = args[1] ?? null;
    } else if (method === "OnFleetMotdChanged") {
      motd = args[0] ?? null;
    } else if (WINGS_ASKED_AGAIN.has(method)) {
      return "wings";
    }
    return null;
  }

  /**
   * The server pushes a notification. Answers what the client's fleet service then does of its own accord, in
   * order and each once: "init" (InitFleet), "wings" (GetWings asked again), "left" (the pilot is out of the
   * fleet, and nothing is kept).
   */
  function feed(notification) {
    const args = Array.isArray(notification.args) ? notification.args : [];
    const events = notification.method === "__MultiEvent"
      ? args.map((event) => [text(items(event)[0]), items(items(event)[1])])
      : [[notification.method, args]];
    return [...new Set(events.map(([method, given]) => apply(method, given)).filter((next) => next !== null))];
  }

  return {
    clear,
    init,
    feed,
    /** ProcessSessionChange, for a session whose fleet changed: there are no members until the state is read again. */
    sessionChanged() { members = new Map(); },
    /** Whether a fleet's state is kept. */
    get inited() { return state !== null; },
    /** The fleet's state as it is kept now, in the form GetInitState answered it in. Null with none kept. */
    read() {
      if (state === null) return null;
      const kept = new Map([["members", { type: "dict", entries: [...members.values()] }], ["wings", wings], ["options", options], ["motd", motd]]);
      return { ...state, args: { ...state.args, entries: state.args.entries.map(([name, value]) => [name, kept.has(text(name)) ? kept.get(text(name)) : value]) } };
    },
    /** self.wings, and what GetWings answered where it was asked again. */
    wings: () => wings,
    setWings(answer) { wings = answer ?? null; },
    /** self.motd: None until the server has said one. */
    motd: () => motd,
    setMotd(answer) { motd = answer ?? null; },
  };
}

module.exports = { createPilotFleet };
