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
// Two services the client asks ON A MONIKER: not by name, as the BFF's routes
// ask, but on the object bound for where the pilot is (eveMoniker.py:
// GetShipAccess for `ship`, CharGetDogmaLocation for `dogmaIM`). In the whole
// client only ship.GetShipFittingInfo, dogmaIM.CreateNewbieShip and
// dogmaIM.GetRequiredSkillLevels are asked of those two by the service's
// name. So every other pair of theirs is made on the moniker, read or not:
// the pilot binds that object as the client does and calls it there. An entry
// may say the pilot must have something first (`needs`).
//
// A shape may need what only the pilot's own client would know: which of its
// modules are online, what a module's effect is called. It is handed a
// `context` of such answers (pilots.js makes it); each may be absent, and a
// shape that cannot be completed says the call differs.
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
/** The same entry, with what the pilot must have before the call can be shaped: "dogma" is godma primed for the ship. */
const needing = (entry, needs) => Object.freeze({ ...entry, needs });

/** The services the client asks on a moniker, and the few methods of each it asks by the service's name all the same. */
const MONIKER_SERVICES = Object.freeze({
  ship: new Set(["GetShipFittingInfo"]),
  dogmaIM: new Set(["CreateNewbieShip", "GetRequiredSkillLevels"]),
});
/** Whether the retail client makes this call on the service's moniker for where the pilot is. */
const madeOnMoniker = (service, method) => Object.hasOwn(MONIKER_SERVICES, service) && !MONIKER_SERVICES[service].has(method) && method !== "MachoBindObject";

const INV_CACHE = "eve/client/script/environment/invCache.py";
const INV_CONTROLLERS = "eve/client/script/environment/invControllers.py";
const AGENT_WINDOW = "eve/client/script/ui/station/agents/agentDialogueWindow.py";
const AGENTS = "eve/client/script/ui/station/agents/agents.py";
const CHAR_SELECT = "eve/client/script/ui/login/charSelection/characterSelection.py";
const SCAN_SVC = "eve/client/script/parklife/scanSvc.py";
const STATION_SVC = "eve/client/script/ui/station/base.py";
const GODMA = "eve/client/script/environment/godma.py";
const MODULE_BUTTON = "eve/client/script/ui/inflight/shipModuleButton/shipmodulebutton.py";
const TARGET_MGR = "eve/client/script/parklife/targetMgr.py";
const CLIENT_DOGMA = "eve/client/script/dogma/clientDogmaLocation.py";
const EVE_MISC = "eve/client/script/util/eveMisc.py";
const DRONE_FUNCTIONS = "eve/client/script/ui/services/menuSvcExtras/droneFunctions.py";
const SHIP_CONFIG = "eve/client/script/ui/services/shipConfigSvc.py";
/** What the module button sends for a module left to repeat: settings.char.autorepeat unset, and an effect that can repeat. */
const REPEATS = 1000;

/** A Python dict, from [key, value] pairs. */
const dict = (entries) => ({ type: "dict", entries });
const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : "");

/**
 * shipmodulebutton.ActivateEffect: the module's default effect by name, the
 * target or None, and how often to repeat. The BFF's routes say -1 for "go on
 * repeating" and leave the name empty when they do not know it; the client
 * sends 1000 for a module left to repeat, 0 for an effect that cannot, and
 * always the name.
 */
function activation(args, kwargs, context) {
  const [itemID, effectName, target, repeat] = args;
  const named = text(effectName) || (context.effectName ? context.effectName(itemID) : null) || "";
  const canRepeat = named && context.effectRepeats ? context.effectRepeats(itemID, named) : null;
  const asked = Number(repeat);
  const repeats = asked >= 0 ? asked : canRepeat === null ? repeat : canRepeat ? REPEATS : 0;
  const shaped = { args: [itemID, named, target ?? null, repeats], kwargs };
  if (!named) return { ...shaped, status: "differs", note: "The client always names the module's default effect. This call names none, and what the module is was not known." };
  if (asked < 0 && canRepeat === null) return { ...shaped, status: "differs", note: "The client sends 1000 or 0 for the repeats. Whether this effect can repeat was not known, so the BFF's -1 went as it was." };
  return shaped;
}

/** godma's Deactivate(itemID, effectName): the effect is the one the client holds as running, by name. */
function deactivation(args, kwargs, context) {
  const [itemID, effectName] = args;
  const named = text(effectName) || (context.effectName ? context.effectName(itemID) : null) || "";
  const shaped = { args: [itemID, named], kwargs };
  return named ? shaped : { ...shaped, status: "differs", note: "The client always names the effect it is stopping. This call names none, and what the module is was not known." };
}

/**
 * clientDogmaLocation.UnloadAmmoFromModules and UnloadAmmoToContainer. With no
 * quantity the client sends the modules as a list; with one it names a single
 * module, the one the charge is in.
 */
function unloading(args, kwargs) {
  const [shipID, modules, destination, quantity] = args;
  if (quantity === undefined || quantity === null) return { args: [shipID, list(modules), destination], kwargs };
  const several = Array.isArray(modules) ? modules : modules && Array.isArray(modules.items) ? modules.items : null;
  if (several === null) return { args: [shipID, modules, destination, quantity], kwargs };
  if (several.length === 1) return { args: [shipID, several[0], destination, quantity], kwargs };
  return { args: [shipID, modules, destination, quantity], kwargs, status: "differs", note: "With a quantity the client unloads one module, the one the charge is in. This call names several." };
}

/**
 * eveMisc.LaunchFromShip: LaunchDrones([(itemID, quantity), ...],
 * whoseBehalfID, ignoreWarning). The stacks are a list; on whose behalf is
 * None unless it is someone other than the pilot. The BFF's route sends the
 * pilot's own character there.
 */
function launching(args, kwargs, context) {
  const [stacks, whose, ignoreWarning] = args;
  const own = whose === 0 || (context.characterID !== undefined && context.characterID !== null && Number(whose) === Number(context.characterID));
  return { args: [list(stacks), whose === undefined || own ? null : whose, ignoreWarning === true], kwargs };
}

/** shipConfigSvc.GetShipConfig: GetShipConfiguration(shipID). The BFF's route sends nothing; the ship is the pilot's own. */
function configuration(args, kwargs, context) {
  if (args.length > 0) return { args, kwargs };
  if (context.shipID !== undefined && context.shipID !== null) return { args: [context.shipID], kwargs };
  return { args, kwargs, status: "differs", note: "The client names the ship. This call names none, and the pilot's ship was not known." };
}

/**
 * station.UndockAttempt: Undock(shipID, ignoreContraband, onlineModules=...),
 * where onlineModules is the ship's online modules by the slot each is in,
 * {flagID: moduleID}, from the client's own dogma. The BFF's route sends an
 * empty list.
 */
function undocking(args, kwargs, context) {
  const online = context.onlineModules ? context.onlineModules() : null;
  const shaped = { args: [args[0], args[1] === true], kwargs: { ...kwargs, onlineModules: online ? dict(online) : dict([]) } };
  return online ? shaped : { ...shaped, status: "differs", note: "The client sends its online modules by slot. Dogma could not be asked, so none were sent." };
}

/** A util.KeyVal with these fields, in this order. */
const keyVal = (entries) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });
/** The clock's 100 ns ticks, however a route spelt them: a long. */
const filetime = (value) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === "object" && value.type === "long" && /^-?\d+$/.test(String(value.value))) return BigInt(value.value);
  return typeof value === "number" && Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
};
const point = (value) => (Array.isArray(value) ? value.slice(0, 3).map(Number) : value && Array.isArray(value.items) ? value.items.slice(0, 3).map(Number) : [0, 0, 0]);

/**
 * scanSvc.RequestScans: the client's idle probes, {probeID: probe}, each the
 * util.KeyVal the server sent with what the client has since changed on it;
 * or None when there are no probes at all. A route gives them as a plain
 * object keyed by the ID.
 */
function scanProbes(given) {
  if (given === null || given === undefined) return null;
  if (given.type === "dict") return given;
  if (typeof given !== "object" || Array.isArray(given)) return given;
  const entries = [];
  for (const [probeID, probe] of Object.entries(given)) {
    const id = Number(probeID);
    if (!Number.isSafeInteger(id) || id <= 0 || !probe || typeof probe !== "object") continue;
    entries.push([id, keyVal([
      ["probeID", id],
      ["typeID", Number(probe.typeID) || null],
      ["pos", point(probe.pos)],
      ["destination", point(probe.destination ?? probe.pos)],
      ["scanRange", Number(probe.scanRange) || 0],
      ["rangeStep", Number(probe.rangeStep) || 0],
      ["state", Number(probe.state) || 0],
      ["expiry", filetime(probe.expiry)],
    ])]);
  }
  return entries.length > 0 ? { type: "dict", entries } : null;
}

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

  // ── the scanner (the scan manager a service call answers with, and the dogma location) ─────────────
  "scanMgr.GetSystemScanMgr": same(`${SCAN_SVC}:115`, "no arguments"),
  "scanMgr.RequestScans": reshaped(
    `${SCAN_SVC}:195`,
    (args, kwargs) => ({ args: [scanProbes(args[0])], kwargs }),
    "RequestScans({probeID: probe}), each probe a util.KeyVal, or RequestScans(None). The client's probes also carry the scanBonuses the server sent; a route's do not.",
  ),
  "scanMgr.RecoverProbes": reshaped(
    `${SCAN_SVC}:341`,
    (args, kwargs) => ({ args: [list(args[0]), ...args.slice(1)], kwargs }),
    "RecoverProbes([probeID, ...]): a list",
  ),
  "scanMgr.DestroyProbe": same(`${SCAN_SVC}:266`, "DestroyProbe(probeID)"),
  "scanMgr.ReconnectToLostProbes": same(`${SCAN_SVC}:279`, "no arguments"),
  "scanMgr.SetActivityState": reshaped(
    `${SCAN_SVC}:426`,
    (args, kwargs) => ({ args: [list(args[0]), ...args.slice(1)], kwargs }),
    "SetActivityState([probeID, ...], True or False): a list",
  ),
  "scanMgr.SetProbeDestination": webOnly(`${SCAN_SVC}:169`, "The client keeps a probe's destination itself and sends it with the next RequestScans."),
  "scanMgr.SetProbeRangeStep": webOnly(`${SCAN_SVC}:173`, "The client keeps a probe's range step itself and sends it with the next RequestScans."),
  "scanMgr.ConeScan": same("eve/client/script/parklife/directionalScanSvc.py:47", "ConeScan(scanAngle, scanRange, x, y, z)"),
  "dogmaIM.LaunchProbes": same(`${SCAN_SVC}:494`, "LaunchProbes(moduleID, numProbes)"),
  "ship.Undock": needing(reshaped(`${STATION_SVC}:498`, undocking, "GetShipAccess().Undock(shipID, ignoreContraband, onlineModules={flagID: moduleID}), on the ship object bound for the station"), "dogma"),
  "dogmaIM.Activate": needing(reshaped(`${MODULE_BUTTON}:1348`, activation, "godma's GetDogmaLM().Activate(itemID, effectName, target, repeats) (godma.py 2062), on the dogma location bound for where the pilot is"), "dogma"),
  "dogmaIM.Deactivate": needing(reshaped(`${GODMA}:2101`, deactivation, "GetDogmaLM().Deactivate(itemID, effectName), on the dogma location bound for where the pilot is"), "dogma"),
  "dogmaIM.GetTargets": same(`${GODMA}:2361`, "GetDogmaLM().GetTargets(), no arguments"),
  "dogmaIM.AddTarget": same(`${TARGET_MGR}:1366`, "GetDogmaLM().AddTarget(targetID)"),
  "dogmaIM.CancelAddTarget": same(`${TARGET_MGR}:1303`, "GetDogmaLM().CancelAddTarget(targetID)"),
  "dogmaIM.RemoveTarget": same(`${TARGET_MGR}:1385`, "GetDogmaLM().RemoveTarget(targetID)"),
  "dogmaIM.SetModuleOnline": same(`${CLIENT_DOGMA}:702`, "SetModuleOnline(the ship the module is in, moduleID)"),
  "dogmaIM.TakeModuleOffline": same(`${CLIENT_DOGMA}:718`, "TakeModuleOffline(the ship the module is in, moduleID)"),
  "dogmaIM.LoadAmmo": reshaped(`${CLIENT_DOGMA}:996`, ([shipID, modules, charges, ...rest], kwargs) => ({ args: [shipID, list(modules), list(charges), ...rest], kwargs }), "LoadAmmo(shipID, [moduleID, ...], [chargeItemID, ...], ammoLocationID): the modules and the charges are lists"),
  "dogmaIM.UnloadAmmo": reshaped(`${CLIENT_DOGMA}:1140`, unloading, "UnloadAmmo(shipID, [moduleID, ...], destination), or UnloadAmmo(shipID, moduleID, destination, quantity) for one module (1127)"),
  "dogmaIM.ShipGetInfo": webOnly(`${GODMA}:2409`, "The client never asks this. What it knows of its ship is in GetAllInfo, which godma is primed from."),
  "dogmaIM.ShipOnlineModules": webOnly(`${GODMA}:697`, "godma has a wrapper for this that nothing in the client calls, and throws its answer away. Which modules are online the client reads from the effects GetAllInfo lists. eve.js answers with the online modules, and the BFF reads that."),
  "ship.LaunchDrones": reshaped(`${EVE_MISC}:29`, launching, "GetShipAccess().LaunchDrones([(itemID, quantity), ...], whoseBehalfID, ignoreWarning): a list of pairs, and None for whose behalf when it is the pilot's own"),
  "ship.ScoopDrone": same(`${DRONE_FUNCTIONS}:195`, "GetShipAccess().ScoopDrone(droneIDs)"),
  "ship.LeaveShip": same(`${STATION_SVC}:248`, "GetShipAccess().LeaveShip(shipID)"),
  "ship.GetShipConfiguration": reshaped(`${SHIP_CONFIG}:51`, configuration, "GetShipAccess().GetShipConfiguration(shipID)"),
});

/**
 * A call as the retail client sends it.
 *
 * Answers { args, kwargs, status, source, note }. `kwargs` is null when there
 * are none, as the BFF passes it. An unchecked pair comes back untouched.
 */
function retailForm(service, method, args, kwargs, context = {}) {
  const given = { args: Array.isArray(args) ? args : [], kwargs: kwargs && Object.keys(kwargs).length > 0 ? kwargs : null };
  const entry = RETAIL_CALLS[`${service}.${method}`];
  const moniker = madeOnMoniker(service, method);
  if (!entry) return { ...given, status: "unchecked", source: null, note: null, moniker };
  if (typeof entry.shape !== "function") return { ...given, status: entry.status, source: entry.source, note: entry.note ?? null, moniker };
  const shaped = entry.shape(given.args, given.kwargs ?? {}, context ?? {});
  const keywords = shaped.kwargs && Object.keys(shaped.kwargs).length > 0 ? shaped.kwargs : null;
  return {
    args: shaped.args,
    kwargs: keywords,
    status: shaped.status ?? entry.status,
    source: entry.source,
    note: shaped.note ?? entry.note ?? null,
    moniker,
  };
}

/** What the pilot must have before this call can be shaped as the client's: "dogma", or null. */
const retailNeeds = (service, method) => RETAIL_CALLS[`${service}.${method}`]?.needs ?? null;

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

module.exports = { MONIKER_SERVICES, REPEATS, RETAIL_CALLS, createCallLedger, list, madeOnMoniker, retailForm, retailNeeds };
