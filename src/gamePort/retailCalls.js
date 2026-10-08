"use strict";

// What the retail client sends for each call, and how what the BFF asks for
// compares with it.
//
// The BFF's routes were written against the web gateway, which hands a call's
// arguments straight to the handler. A handler reads a flag from the first
// position or from a keyword alike, a list or a tuple alike, so the routes
// were free to spell a call any way that worked. The retail client spells each
// call one way. On the game port the goal is to send what that client sends.
//
// Each entry below is one "service.method" pair, checked against the
// decompiled client (eve.js/tools/ClientCodeGrabber/Latest), with the file and
// line it was checked against. An entry says one of:
//
//   same       the BFF's call is the retail client's, as it stands
//   reshaped   `shape` turns the BFF's arguments into the retail client's
//   differs    a known difference this cannot repair from the arguments alone
//              (the note says what; the route has to change)
//   web-only   the retail client does not make this call at all (the note says
//              what it does instead). The call is still sent: the web client
//              needs its answer until that feature is rebuilt the client's way
//
// A pair with no entry is "unchecked": sent as the BFF spelt it, and counted,
// so the list of what still needs reading is measured rather than guessed.
// `shape` may also decide the status from the arguments it is given.

/** A Python list, from a JS array (which would go out as a tuple) or from one already wrapped. */
const list = (value) => (Array.isArray(value) ? { type: "list", items: value } : value);

const same = (source, note) => Object.freeze({ status: "same", source, note });
const reshaped = (source, shape, note) => Object.freeze({ status: "reshaped", source, shape, note });
const differs = (source, note) => Object.freeze({ status: "differs", source, note });
/** Same or differs, depending on what the call carries: `judge` answers { status, note }. */
const judged = (source, judge, note) => Object.freeze({
  status: "same",
  source,
  note,
  shape: (args, kwargs) => ({ args, kwargs, ...judge(args, kwargs) }),
});
const webOnly = (source, note) => Object.freeze({ status: "web-only", source, note });

const INV_CACHE = "eve/client/script/environment/invCache.py";
const INV_CONTROLLERS = "eve/client/script/environment/invControllers.py";
const AGENT_WINDOW = "eve/client/script/ui/station/agents/agentDialogueWindow.py";
const AGENTS = "eve/client/script/ui/station/agents/agents.py";
const CHAR_SELECT = "eve/client/script/ui/login/charSelection/characterSelection.py";

const RETAIL_CALLS = Object.freeze({
  // ── character selection (made by the transport itself) ────────────────────
  "charUnboundMgr.GetCharacterSelectionData": same(`${CHAR_SELECT}`, "no arguments"),
  "charUnboundMgr.GetCharacterLockType": same(`${CHAR_SELECT}:695`, "GetCharacterLockType(charID)"),
  "charUnboundMgr.SelectCharacterID": same(`${CHAR_SELECT}:713`, "SelectCharacterID(charID, secondChoiceID, skipTutorial)"),

  // ── an inventory (a bound invbroker object) ───────────────────────────────
  "invbroker.List": reshaped(
    `${INV_CACHE}:1138`,
    // self.moniker.List(flag=flag): the flag is always a keyword, None when there is none.
    (args, kwargs) => ({ args: [], kwargs: { ...kwargs, flag: kwargs.flag !== undefined ? kwargs.flag : args[0] ?? null } }),
    "List(flag=flag)",
  ),
  "invbroker.ListByFlags": reshaped(
    `${INV_CACHE}:1174`,
    // self.moniker.ListByFlags(flags=uncachedFlags): a keyword, and a list.
    (args, kwargs) => ({ args: [], kwargs: { ...kwargs, flags: list(kwargs.flags !== undefined ? kwargs.flags : args[0] ?? []) } }),
    "ListByFlags(flags=[...])",
  ),
  "invbroker.GetCapacity": webOnly(
    `${INV_CACHE}:1224`,
    "The client works a capacity out itself: the attribute from dogma or the type, and the volume of what List returned. It never asks the server.",
  ),
  "invbroker.Add": judged(
    `${INV_CONTROLLERS}:213`,
    // Add(itemID, sourceLocationID, qty=quantity, flag=self.locationFlag): both keywords, always.
    (args, kwargs) => (kwargs.qty === undefined || kwargs.qty === null
      ? { status: "differs", note: "The client always sends qty, the stack's size when the whole stack moves. This call has none." }
      : { status: "same" }),
    "Add(itemID, sourceLocationID, qty=, flag=)",
  ),
  "invbroker.MultiAdd": reshaped(
    `${INV_CACHE}:1058`,
    // self.moniker.MultiAdd(list(nonCharges), sourceID, **kw): the item IDs are a list.
    (args, kwargs) => ({ args: [list(args[0]), ...args.slice(1)], kwargs }),
    "MultiAdd([itemIDs], sourceID, flag=)",
  ),
  "invbroker.StackAll": same(`${INV_CONTROLLERS}:387`, "StackAll(locationFlag), or StackAll()"),

  // ── an agent (a bound agentMgr object) ────────────────────────────────────
  "agentMgr.DoAction": same(`${AGENT_WINDOW}:428`, "DoAction(actionID)"),
  "agentMgr.GetMissionBriefingInfo": same(`${AGENTS}:750`, "no arguments"),
  "agentMgr.GetMissionObjectiveInfo": same(`${AGENT_WINDOW}:222`, "no arguments when the dialogue opens"),
  "agentMgr.GetAgentLocationWrap": same(`${AGENT_WINDOW}:276`, "no arguments"),
  "agentMgr.GetMissionJournalInfo": differs(`${AGENTS}:747`, "The client sends (charID, contentID). The BFF sends nothing."),
});

/**
 * A call as the retail client sends it.
 *
 * Answers { args, kwargs, status, source, note }. `kwargs` is null when there
 * are none, as the BFF passes it. An unchecked pair comes back untouched.
 */
function retailForm(service, method, args, kwargs) {
  const given = { args: Array.isArray(args) ? args : [], kwargs: kwargs && Object.keys(kwargs).length > 0 ? kwargs : null };
  const entry = RETAIL_CALLS[`${service}.${method}`];
  if (!entry) return { ...given, status: "unchecked", source: null, note: null };
  if (typeof entry.shape !== "function") return { ...given, status: entry.status, source: entry.source, note: entry.note ?? null };
  const shaped = entry.shape(given.args, given.kwargs ?? {});
  const keywords = shaped.kwargs && Object.keys(shaped.kwargs).length > 0 ? shaped.kwargs : null;
  return {
    args: shaped.args,
    kwargs: keywords,
    status: shaped.status ?? entry.status,
    source: entry.source,
    note: shaped.note ?? entry.note ?? null,
  };
}

/**
 * A tally of the calls a process has made, by pair and by how each compared
 * with the retail client: the measured list of what is left to check.
 */
function createCallLedger() {
  const pairs = new Map();
  return {
    note(service, method, form) {
      const key = `${service}.${method}`;
      const row = pairs.get(key) ?? { pair: key, calls: 0, statuses: {}, source: form.source, note: form.note };
      row.calls += 1;
      row.statuses[form.status] = (row.statuses[form.status] ?? 0) + 1;
      if (form.status !== "same" && form.note) row.note = form.note;
      pairs.set(key, row);
    },
    /** Every pair called, most called first. */
    rows() {
      return [...pairs.values()].sort((a, b) => b.calls - a.calls || a.pair.localeCompare(b.pair)).map((row) => ({ ...row, statuses: { ...row.statuses } }));
    },
  };
}

module.exports = { RETAIL_CALLS, createCallLedger, list, retailForm };
