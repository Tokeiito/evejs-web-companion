"use strict";

// The pilot's standings as the retail client's standing service keeps them
// (eve/client/script/ui/services/standingsvc.py).
//
// The client asks when a character is chosen, and again when the session's
// corporation changes (__RefreshStandings):
//
//   standingMgr.GetNPCNPCStandings()   kept as it came
//   standingMgr.GetCharStandings()     kept by fromID
//   standingMgr.GetCorpStandings()     asked beside the character's, and only
//                                      for a pilot whose corporation is not an
//                                      NPC one: an NPC corporation's are none
//
// and from then on keeps them right from what the server tells it:
//
//   OnStandingSet(fromID, toID, standing)
//       for an NPC fromID, with the character or with its corporation: a
//       standing of nothing takes the row away, anything else sets it
//   OnStandingsModified([(fromID, toID, rawChange, minAbs, maxAbs), ...])
//       each raw change worked into the standing (standingUtil.py). One with
//       the corporation is worked from the CHARACTER's standing with that
//       owner, which is the client's own code; where the character has none
//       its handler fails there, and neither that change nor any after it in
//       the notice is made.
//
// Everything is kept as it came off the wire, so what is read back is in the
// form the server answers in: a Rowset of (fromID, standing), its lines in
// order of fromID as this server sends them.
//
// Not kept here: the client also gives the character a standing of 0.0 with its
// own race's faction where the server said none, and keeps a cache of each
// owner's transactions.

/** standingUtil.py */
const MAX_STANDING = 10.0;
const MIN_STANDING = -10.0;
/** idCheckers.IsNPC: maxSystemItem < ownerID < minPlayerOwner. */
const MAX_SYSTEM_ITEM = 10000;
const MIN_PLAYER_OWNER = 90000000;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
const isNPC = (ownerID) => ownerID > MAX_SYSTEM_ITEM && ownerID < MIN_PLAYER_OWNER;

/**
 * standingUtil.CalculateStandingsByRawChange: a standing moved by a raw change, as the client works it. The
 * client leaves a standing that is already at the end it is being moved towards as it is; the sums do the same.
 */
function standingByRawChange(currentStanding, rawChange) {
  return rawChange > 0.0
    ? Math.min(MAX_STANDING, 10.0 * (1.0 - (1.0 - currentStanding / 10.0) * (1.0 - rawChange)))
    : Math.max(MIN_STANDING, 10.0 * (currentStanding / 10.0 + (1.0 + currentStanding / 10.0) * rawChange));
}

/** standingUtil.CalculateNewStandings: the standing a raw change makes where there was none. */
const newStanding = (rawChange) => Math.max(Math.min(10.0 * rawChange, MAX_STANDING), MIN_STANDING);

/**
 * A standings answer read: { answer, at: [where fromID is in a line, where standing is], rows: fromID -> line },
 * or null where it is no Rowset of (fromID, standing).
 */
function read(answer) {
  const entries = answer && answer.type === "object" && answer.args && Array.isArray(answer.args.entries) ? answer.args.entries : null;
  if (!entries) return null;
  const part = (name) => (entries.find(([key]) => text(key) === name) ?? [])[1];
  const header = items(part("header")).map(text);
  const at = [header.indexOf("fromID"), header.indexOf("standing")];
  const lines = part("lines");
  if (at.includes(-1) || !lines || !Array.isArray(lines.items)) return null;
  return { answer, at, width: header.length, rows: new Map(lines.items.map((line) => [number(items(line)[at[0]]), line])) };
}

function createPilotStandings({ characterID, corporationID }) {
  let npcNpc = null;
  /** The character's, and the corporation's: each as `read` gives it, or null. */
  let char = null;
  let corp = null;

  function clear() {
    npcNpc = null;
    char = null;
    corp = null;
  }

  /** The standing a kept row says, or undefined with no row. */
  const standingIn = (kept, fromID) => (kept.rows.has(fromID) ? number(items(kept.rows.get(fromID))[kept.at[1]]) : undefined);
  /** blue.DBRow(self.fromStandingHeader, [fromID, standing]), in the form the answer's lines are in. */
  function put(kept, fromID, standing) {
    const line = Array(kept.width).fill(null);
    line[kept.at[0]] = fromID;
    line[kept.at[1]] = standing;
    kept.rows.set(number(fromID), { type: "list", items: line });
  }
  /** The corporation's rows, which begin as none where they were never asked for: kept in the form the character's are in. */
  const corpRows = () => {
    corp ??= { answer: char.answer, at: char.at, width: char.width, rows: new Map() };
    return corp;
  };

  /** OnStandingSet(fromID, toID, standing). */
  function standingSet([fromID, toID, standing]) {
    const from = number(fromID);
    if (!isNPC(from)) return;
    const kept = number(toID) === characterID ? char : number(toID) === corporationID() ? corpRows() : null;
    if (!kept) return;
    if (!number(standing)) kept.rows.delete(from);
    else put(kept, fromID, standing);
  }

  /** OnStandingsModified(modifications): each (fromID, toID, rawChange, minAbs, maxAbs), until one the client's handler fails at. */
  function standingsModified([modifications]) {
    for (const modification of items(modifications)) {
      const [fromID, toID, rawChange] = items(modification);
      const from = number(fromID);
      const change = number(rawChange);
      if (from === null || change === null) continue;
      if (number(toID) === characterID) {
        const current = standingIn(char, from);
        put(char, fromID, current === undefined ? newStanding(change) : standingByRawChange(current, change));
      } else if (number(toID) === corporationID()) {
        const kept = corpRows();
        if (!kept.rows.has(from)) {
          put(kept, fromID, newStanding(change));
        } else {
          // currentStanding=self.npccharstandings[fromID].standing: a KeyError where the character has none.
          const characters = standingIn(char, from);
          if (characters === undefined) return;
          put(kept, fromID, standingByRawChange(characters, change));
        }
      }
    }
  }

  /** What is kept, in the form it was answered in: the answer's own lines where they stand, in order of fromID. */
  const asAnswered = (kept) => ({
    ...kept.answer,
    args: {
      ...kept.answer.args,
      entries: kept.answer.args.entries.map(([name, value]) => (text(name) === "lines"
        ? [name, { ...value, items: [...kept.rows].sort(([a], [b]) => a - b).map(([, line]) => line) }]
        : [name, value])),
    },
  });

  return {
    clear,
    /**
     * __RefreshStandings: what the three reads answered. `corp` is left out where it was not asked (an NPC
     * corporation). False where the character's is no standings answer: what was kept is then as it was.
     */
    refreshed({ npcNpc: all, char: characters, corp: corporations }) {
      const kept = read(characters);
      if (!kept) return false;
      npcNpc = all ?? null;
      char = kept;
      corp = read(corporations);
      return true;
    },
    /** The server pushes a notification. */
    feed(notification) {
      if (!char || !Array.isArray(notification.args)) return;
      if (notification.method === "OnStandingSet") standingSet(notification.args);
      else if (notification.method === "OnStandingsModified") standingsModified(notification.args);
    },
    /**
     * standingSvc.GetStanding(fromID, session.charid), for an NPC: the standing it has to the character, or the
     * neutral nought where it has none (standingsvc.py 154). Null where no standings are kept.
     */
    toCharacter(fromID) {
      if (!char) return null;
      const from = number(fromID);
      return from !== null && isNPC(from) ? standingIn(char, from) ?? 0.0 : 0.0;
    },
    /** Whether a character's standings are kept. */
    get loaded() { return char !== null; },
    /** self.npccharstandings, as GetCharStandings would be read now. Null with none kept. */
    char: () => (char ? asAnswered(char) : null),
    /** self.npccorpstandings, as GetCorpStandings would be read now. Null where the corporation has none kept. */
    corp: () => (corp ? asAnswered(corp) : null),
    /** What GetNPCNPCStandings answered, as it came. */
    npcNpc: () => npcNpc,
  };
}

module.exports = { createPilotStandings, newStanding, standingByRawChange };
