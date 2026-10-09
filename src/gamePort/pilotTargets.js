"use strict";

// What the pilot's ship has locked, and what has it locked, as the retail
// client's target service keeps them (eve/client/script/parklife/targetMgr.py).
//
// The client asks the server for neither while it flies. It asks once, on
// undocking or on logging in in space (ProcessSessionChange 495, which starts
// godma's RefreshTargets, godma.py 2360):
//
//   GetDogmaLM().GetTargets()     each answered scattered as OnTarget('add', id)
//   GetDogmaLM().GetTargeters()   each answered scattered as OnTarget('otheradd', id)
//
// and from then on keeps both right from what the server tells it:
//
//   OnTarget(what, targetID, reason)                       (586)
//       'add'        the ship has it locked       (targetsByID)
//       'lost'       it has not any more
//       'clear'      it has none locked
//       'otheradd'   that one has the ship locked (targetedBy)
//       'otherlost'  it has not any more
//   OnTargets([(time, what, targetID, reason), ...])       (580)
//       each as an OnTarget, without its time
//
// Two things it does without being told:
//
//   AddTarget(targetID) answering (flag, targets) with a flag that is not set:
//       the lock is made already, and it adds the target itself (_LockTarget 1366)
//   a ball going from the ballpark (DoBallRemove 564): no target any more
//
// Docked, or with its ballpark let go, it has none of either (CleanUp 504,
// DoBallsRemove 543).
//
// Each list is kept as the server would answer it: a list of item IDs, each as
// it came off the wire. A list is unknown until it has been answered or
// emptied, and what the server says of one that is unknown is not kept: there
// is nothing to work it into.
//
// Not kept here: a target the server names before its ball has come is held by
// the client until the ball does (pendingTargets); here it is a target at once.
// A ship that blew up is kept by the client until its explosion is over; here
// it goes when the server says it is lost. The client empties both lists when
// its ballpark is given a whole new state (DoBallClear); here they stand.

const TARGETS = "targets";
const TARGETERS = "targeters";

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
/** An item's ID as a key, whichever way it came off the wire. Null for what is no ID. */
function keyOf(value) {
  const id = value && typeof value === "object" && !Buffer.isBuffer(value) ? value.value : value;
  if (typeof id === "bigint") return id > 0n ? String(id) : null;
  const number = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? String(number) : null;
}

function createPilotTargets() {
  /** Each list by its name: a Map of key to the ID as it came, in the order they came; null while it is unknown. */
  const kept = { [TARGETS]: null, [TARGETERS]: null };
  /** Counts everything that could have changed a list, so that an answer asked for before it is not kept after it. */
  let changes = 0;

  const add = (which, id) => {
    const key = keyOf(id);
    // Kept as it came off the wire, a number or a long. One named by the BFF may come as its JSON, and is kept as the number it is.
    if (kept[which] && key !== null) kept[which].set(key, typeof id === "number" || typeof id === "bigint" ? id : Number(key));
  };
  const drop = (which, id) => {
    const key = keyOf(id);
    if (kept[which] && key !== null) kept[which].delete(key);
  };

  /** targetMgr.OnTarget. */
  function onTarget(what, id) {
    changes += 1;
    if (what === "add") add(TARGETS, id);
    else if (what === "lost") drop(TARGETS, id);
    else if (what === "clear") kept[TARGETS] &&= new Map();
    else if (what === "otheradd") add(TARGETERS, id);
    else if (what === "otherlost") drop(TARGETERS, id);
  }

  return {
    /** A notification from the session. True when it was the target service's. */
    feed(notification) {
      if (!Array.isArray(notification.args)) return false;
      if (notification.method === "OnTarget") {
        onTarget(text(notification.args[0]), notification.args[1]);
        return true;
      }
      if (notification.method === "OnTargets") {
        for (const each of items(notification.args[0]).map(items)) onTarget(text(each[1]), each[2]);
        return true;
      }
      return false;
    },
    /** A list as the server would answer it now: { type: "list", items }. Undefined while it is unknown. */
    read(which) {
      return kept[which] ? { type: "list", items: [...kept[which].values()] } : undefined;
    },
    /** What to hand `keep` with the answer of a list that is about to be asked for. */
    asking: () => changes,
    /** The server's answer for a list, asked for at `asked`. Not kept if anything has changed since: it may be from before the change. */
    keep(which, answer, asked) {
      if (asked !== changes || !answer || !Array.isArray(answer.items)) return false;
      kept[which] = new Map();
      for (const id of answer.items) add(which, id);
      return true;
    },
    /** AddTarget answered that the lock is made: the client adds the target itself. */
    added(id) {
      changes += 1;
      add(TARGETS, id);
    },
    /** Balls gone from the ballpark, by their IDs: none of them is a target any more. */
    ballsRemoved(ids) {
      changes += 1;
      for (const id of ids) drop(TARGETS, id);
    },
    /** Docked, or the ballpark let go: nothing locked, and locked by nothing. */
    emptied() {
      changes += 1;
      kept[TARGETS] = new Map();
      kept[TARGETERS] = new Map();
    },
    /** Neither list is known any more: each is asked for when it is next wanted. */
    forget() {
      changes += 1;
      kept[TARGETS] = null;
      kept[TARGETERS] = null;
    },
  };
}

module.exports = { createPilotTargets, TARGETS, TARGETERS };
