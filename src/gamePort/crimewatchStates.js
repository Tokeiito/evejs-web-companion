"use strict";

/**
 * Crimewatch's client states, changed as the retail client's crimewatch service changes what it keeps
 * (eve/client/script/ui/services/crimewatchSvc.py).
 *
 * The service asks GetClientStates at a change of place (94) and keeps what it answers: five combat timers, the
 * pilot's engagements, and who in the system is flagged. From then on each of the server's notices changes one of
 * those, and the server is asked nothing (222 to 288):
 *
 *   OnWeaponsTimerUpdate, OnPvpTimerUpdate, OnNpcTimerUpdate, OnCriminalTimerUpdate, OnDisapprovalTimerUpdate
 *       (state, expiryTime): that timer is in that state, until that time
 *   OnSystemCriminalFlagUpdates (newIdles, newSuspects, newCriminals): the idle are flagged no more, then the
 *       criminals are criminals, then the suspects are suspects (UpdateSuspectsAndCriminals, 195)
 *   OnCrimewatchEngagementCreated, OnCrimewatchEngagementStartTimeout (otherCharID, timeout): the engagement
 *       with that pilot runs out then
 *   OnCrimewatchEngagementStopTimeout (otherCharID): it goes on, with no end set
 *   OnCrimewatchEngagementEnded (otherCharID): it is over
 *   OnSystemDisapprovalFlagUpdates: who is disapproved of, which is no part of the states
 *
 * The states are the server's answer as it came off the wire: ((weapons, pvp, npc, criminal, disapproval),
 * engagements, (criminals, suspects), safetyLevel), each timer (state, expiry), the engagements a dict by the
 * other pilot, and the flagged two sets. `statesAfter` answers the states a notice leaves, in the same form. It
 * answers `undefined` where it cannot say: states, or a notice, in a form it does not read. Who keeps the states
 * lets them go then, and asks the server again.
 */

/** Each timer's notice and its place among the five (crimewatchSvc.ProcessSessionChange, 98). */
const TIMER_PLACES = Object.freeze({ OnWeaponsTimerUpdate: 0, OnPvpTimerUpdate: 1, OnNpcTimerUpdate: 2, OnCriminalTimerUpdate: 3, OnDisapprovalTimerUpdate: 4 });
const CRIMINAL_FLAGS = "OnSystemCriminalFlagUpdates";
const DISAPPROVAL_FLAGS = "OnSystemDisapprovalFlagUpdates";
/** The engagements' notices, each with how many arguments the client's handler takes. */
const ENGAGEMENTS = Object.freeze({ OnCrimewatchEngagementCreated: 2, OnCrimewatchEngagementStartTimeout: 2, OnCrimewatchEngagementStopTimeout: 1, OnCrimewatchEngagementEnded: 1 });
/** crimewatch/const.py crimewatchEngagementTimeoutOngoing: an engagement with no end set. */
const ENGAGEMENT_ONGOING = -1;

/** The server's notices that change what the client's crimewatch service keeps. */
const CLIENT_STATE_NOTICES = new Set([...Object.keys(TIMER_PLACES), CRIMINAL_FLAGS, DISAPPROVAL_FLAGS, ...Object.keys(ENGAGEMENTS)]);

const isSet = (value) => Boolean(value) && value.type === "objectex1" && Array.isArray(value.header) && String(value.header[0]?.value) === "__builtin__.set"
  && Array.isArray(value.header[1]) && Array.isArray(value.header[1][0]?.items);

/** What a set, a list or a tuple off the wire holds; null for anything else. Tranquility sends sets, this server tuples. */
function membersOf(value) {
  if (Array.isArray(value)) return value;
  if (isSet(value)) return value.header[1][0].items;
  return value && value.type === "list" && Array.isArray(value.items) ? value.items : null;
}

/** A pilot's ID off the wire as one whole number, whichever way it was sent; null for what is no ID. */
function idOf(value) {
  if (typeof value === "bigint") return value;
  return typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : null;
}
const among = (ids, id) => ids.some((each) => each === id);

/** A set like `like`, of these members. */
const setLike = (like, items) => ({ ...like, header: [like.header[0], [{ ...like.header[1][0], items }, ...like.header[1].slice(1)], ...like.header.slice(2)] });

/** The five timers with one of them changed; undefined where they are not five or the notice is not (state, expiry). */
function timersAfter(timers, place, args) {
  if (!Array.isArray(timers) || timers.length !== 5 || args.length !== 2) return undefined;
  return timers.map((timer, index) => (index === place ? [args[0], args[1]] : timer));
}

/**
 * Who is flagged after (newIdles, newSuspects, newCriminals). The client keeps one flag for a pilot: the idle are
 * forgotten first, then each criminal is a criminal, then each suspect a suspect, so that a pilot named twice is
 * what it was named last. Those who stay flagged keep their places; the new come after them, in the notice's order.
 */
function flaggedAfter(flagged, args) {
  if (!Array.isArray(flagged) || flagged.length !== 2 || !isSet(flagged[0]) || !isSet(flagged[1]) || args.length !== 3) return undefined;
  const told = args.map(membersOf);
  if (told.some((each) => each === null)) return undefined;
  const [idles, suspects, criminals] = told.map((members) => members.map(idOf));
  const [wereCriminals, wereSuspects] = flagged.map((each) => membersOf(each));
  if ([idles, suspects, criminals, wereCriminals.map(idOf), wereSuspects.map(idOf)].some((ids) => among(ids, null))) return undefined;
  const without = (members, gone) => members.filter((member) => !among(gone, idOf(member)));
  const joined = (members, more) => more.reduce((all, member) => (among(all.map(idOf), idOf(member)) ? all : [...all, member]), members);
  return [
    setLike(flagged[0], without(joined(without(wereCriminals, idles), told[2]), suspects)),
    setLike(flagged[1], joined(without(without(wereSuspects, idles), criminals), told[1])),
  ];
}

/** The engagements after one of their notices: an entry of the dict set, or taken out. Another pilot's entry is left where it is. */
function engagementsAfter(engagements, method, args) {
  if (!engagements || engagements.type !== "dict" || !Array.isArray(engagements.entries) || args.length !== ENGAGEMENTS[method]) return undefined;
  const other = idOf(args[0]);
  if (other === null) return undefined;
  const others = engagements.entries.filter(([pilot]) => idOf(pilot) !== other);
  if (method === "OnCrimewatchEngagementEnded") return { ...engagements, entries: others };
  const timeout = method === "OnCrimewatchEngagementStopTimeout" ? ENGAGEMENT_ONGOING : args[1];
  const had = engagements.entries.some(([pilot]) => idOf(pilot) === other);
  return { ...engagements, entries: had ? engagements.entries.map((entry) => (idOf(entry[0]) === other ? [entry[0], timeout] : entry)) : [...others, [args[0], timeout]] };
}

/**
 * The states after one of the server's notices. A notice that is none of crimewatch's, and the one of who is
 * disapproved of, leave them as they are.
 */
function statesAfter(states, method, args) {
  if (!CLIENT_STATE_NOTICES.has(method) || method === DISAPPROVAL_FLAGS) return states;
  if (!Array.isArray(states) || states.length !== 4 || !Array.isArray(args)) return undefined;
  const [timers, engagements, flagged, safetyLevel] = states;
  const changed = (place, value) => (value === undefined ? undefined : [timers, engagements, flagged, safetyLevel].map((each, index) => (index === place ? value : each)));
  if (method in TIMER_PLACES) return changed(0, timersAfter(timers, TIMER_PLACES[method], args));
  if (method === CRIMINAL_FLAGS) return changed(2, flaggedAfter(flagged, args));
  return changed(1, engagementsAfter(engagements, method, args));
}

module.exports = { CLIENT_STATE_NOTICES, ENGAGEMENT_ONGOING, statesAfter };
