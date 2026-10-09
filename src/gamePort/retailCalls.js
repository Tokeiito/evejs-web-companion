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
// A third the client asks on a moniker and never by name at all: the
// corporation registry (eveMoniker.GetCorpRegistry, Moniker('corpRegistry',
// session.corpid)). sm.RemoteSvc('corpRegistry') appears nowhere in the client.
// Its moniker is the corporation's, not the place's: the corp service binds it
// once and again when the pilot's corporation changes (base_corporation.py 137).
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
  corpRegistry: new Set(),
  // skillsvc.GetSkillHandler: the moniker skillMgr2.GetMySkillHandler answers, kept. On this server it names this service.
  skillHandler: new Set(),
  // crimewatchSvc: eveMoniker.CharGetCrimewatchLocation(), made at every use.
  crimewatch: new Set(),
});

/** shipConfigSvc.py 51: eveMoniker.GetShipAccess().GetShipConfiguration(shipID), a Moniker of its own each time. */
const OWN_SHIP_MONIKER = new Set(["GetShipConfiguration"]);
/**
 * Whether the client makes a new Moniker for this call, which binds carrying it and is not kept, or calls one it
 * keeps. All of crimewatch's are made anew (crimewatchSvc.py: CharGetCrimewatchLocation().Method(...) at each use).
 * The ship's go through gameui.GetShipAccess (gameui.py 228), which makes a new one each time while the session
 * has a station and keeps one otherwise for as long as the system, the ship and the character are the same; a
 * service that makes its own does so wherever the pilot is.
 */
const madeAfresh = (service, method, { dockedInStation = false } = {}) =>
  service === "crimewatch" || (service === "ship" && (dockedInStation || OWN_SHIP_MONIKER.has(method)));
/**
 * The services the client reaches with sm.ProxySvc(name): every one in the decompiled client, and none
 * of them is asked any other way. Such a call is addressed to the client's proxy node
 * (serviceManager.py 558: session.ConnectToRemoteService(name, machoNet.myProxyNodeID)); a
 * sm.RemoteSvc call names no node. The server's own log of a retail client shows the two apart
 * ("dst=node", "dst=any").
 */
const PROXY_SERVICES = Object.freeze(new Set([
  "XmppChatMgr", "alert", "bountyProxy", "calendarProxy", "clientStatLogger", "contractProxy", "corpRecProxy",
  "eventLog", "fleetProxy", "machoNet", "marketProxy", "pingService", "raffleProxy", "search",
]));

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
const FITTING_SVC = "eve/client/script/environment/fittingSvc.py";
const CC_SVC = "eve/client/script/ui/services/ccSvc.py";
const CC_STEPS = "eve/client/script/ui/login/charcreation/steps";
const ACCOUNT_SVC = "eve/client/script/ui/services/accountsvc.py";
const WALLET_SVC = "eve/client/script/ui/shared/neocom/wallet/walletSvc.py";
const CORP_SVC = "eve/client/script/ui/services/corporation";
const CONTRACTS_SVC = "eve/client/script/ui/shared/neocom/contracts/contracts.py";
const CONTRACT_SEARCH = "eve/client/script/ui/shared/neocom/contracts/contractsearch.py";
const MARKET_QUOTE = "eve/client/script/ui/services/marketsvc.py";
const CALENDAR_SVC = "eve/client/script/ui/services/eveCalendarsvc.py";
/** The keywords of the client's one contract search, in the order its call writes them (contractsearch.py 1367). */
const CONTRACT_SEARCH_KEYWORDS = Object.freeze([
  "itemTypes", "itemTypeName", "itemCategoryID", "itemGroupID", "contractType", "securityClasses", "locationID",
  "endLocationID", "issuerID", "minPrice", "maxPrice", "minReward", "maxReward", "minCollateral", "maxCollateral",
  "minVolume", "maxVolume", "excludeTrade", "excludeMultiple", "excludeNoBuyout", "availability", "description",
  "searchHint", "sortBy", "sortDir", "startNum",
]);
const INDUSTRY = "eve/client/script/industry";
const CORP_ASSETS = "eve/client/script/ui/shared/neocom/corporation/corp_ui_accounts.py";
const MAIL_SERVICES = "eve/client/script/ui/services/mail";
const FLEET_SVC = "eve/client/script/parklife/fleetSvc.py";
/** A read of one character, which the client always names: the pilot's own, when the route named none. */
const ofTheCharacter = (args, kwargs, context) => {
  if (args[0] !== null && args[0] !== undefined) return { args, kwargs };
  const characterID = context.characterID ?? null;
  return characterID === null
    ? { args, kwargs, status: "differs", note: "The client names the character it asks about. With no pilot known there is no one to name, and the call goes as it was given." }
    : { args: [characterID], kwargs, status: "reshaped" };
};
/** The calendar's two reads of one event: the client has the event's row to hand, so its ID and its owner's both. */
const ofAnOpenedEvent = (args) => (args[0] > 0 && args[1] !== null && args[1] !== undefined
  ? { status: "same" }
  : { status: "differs", note: "The client asks this of an event the pilot has opened, by the event's ID and its owner's (eventInfo.eventID, eventInfo.ownerID). It never asks of no event, nor without the owner." });
const CONTRACT_PANELS = "eve/client/script/ui/shared/neocom/contracts/contractPanels.py";
const CRIMEWATCH_SVC = "eve/client/script/ui/services/crimewatchSvc.py";
/** contractPanels.py RESULTS_PER_PAGE. */
const CONTRACTS_PER_PAGE = 100;
/**
 * MyContractsPanel._GetContractsToShow: whose, in what state, of what type and issued to or by, then by name how
 * many to a page and the contract the page starts at. None is "all" for a filter and "the first" for the page.
 */
function ownersContracts(args, kwargs) {
  const [ownerID, status, contractType, issuedBy] = args;
  if (ownerID === null || ownerID === undefined || status === null || status === undefined) {
    return { args, kwargs, status: "differs", note: "The client always names an owner and a status. This call leaves one of them out, and goes as it was given." };
  }
  const sent = { args: [ownerID, status, contractType ?? null, issuedBy ?? null], kwargs: { num: CONTRACTS_PER_PAGE, startContractID: kwargs.startContractID ?? null } };
  const whole = args.length === 4 && Object.keys(kwargs).length === 2 && kwargs.num === CONTRACTS_PER_PAGE && "startContractID" in kwargs;
  return whole ? sent : { ...sent, status: "reshaped" };
}
/** contractscommon.py: auctions and item exchanges searched together, and the sorts by date created and by price. */
const CONTYPE_AUCTION_AND_ITEM_EXCHANGE = 10;
const CONTRACT_SORT_ID = 0;
const CONTRACT_SORT_PRICE = 1;
const DRONE_DAMAGE = "eveDrones/droneDamageTracker.py";
const SKILL_SVC = "eve/client/script/ui/services/skillsvc.py";
const STANDING_SVC = "eve/client/script/ui/services/standingsvc.py";
const JOURNAL_WINDOW = "eve/client/script/ui/shared/neocom/journal.py";
const DEV_TOOLS = "eve/devtools/script";
const CLIENT_OWN_DOGMA = "eve/common/script/dogma/baseDogmaLocation.py";
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
/**
 * fittingSvc.PrimeFittings (430): GetFittingMgr(ownerID).GetFittings(ownerID), where the owner
 * is the session's own character, corporation or alliance, and says which manager is asked.
 * The BFF often leaves the owner out and lets the server take it from the session.
 */
const fittingsOf = (owner, whose) => ([ownerID, ...rest], kwargs, context) => {
  const known = ownerID ?? context[owner] ?? null;
  if (known === null) return { args: [], kwargs, status: "differs", note: `The client asks only for an owner it has: this pilot has no ${whose}.` };
  // With the owner named already, the call is the client's as it stands.
  return { args: [known, ...rest], kwargs, status: ownerID === known ? "same" : "reshaped" };
};

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

  // ── character creation (the account's own calls, with no character chosen) ──
  "charUnboundMgr.GetCharCreationInfo": webOnly(`${CC_STEPS}/bloodLineStep.py:107`, "The client never asks this. The races and bloodlines on its creation screens are in its own static data (characterdata)."),
  "charUnboundMgr.ValidateNameEx": reshaped(
    `${CC_STEPS}/sections/chooseNameSection.py:201`,
    ([name, checked, ...rest], kwargs) => ({ args: [name, checked ?? 0, ...rest], kwargs }),
    "ValidateNameEx(charName, how many names the screen has checked before this one). The BFF keeps no such screen and checks the one name it is about to create, so it sends 0, as the client does with its first.",
  ),
  "charUnboundMgr.CreateCharacterWithDoll": differs(
    `${CC_SVC}:97`,
    "The client sends ten: (name, raceID, bloodlineID, genderID, ancestryID, charInfo, portraitInfo, schoolID, None, qaStarterSystemID), with the doll and the portrait it drew. The web client draws neither, and the BFF sends the server's older seven: (name, bloodlineID, genderID, ancestryID, None, None, 0).",
  ),

  // ── saved fittings ─────────────────────────────────────────────────────────
  "charFittingMgr.GetFittings": reshaped(`${FITTING_SVC}:430`, fittingsOf("characterID", "character"), "GetFittingMgr(session.charid).GetFittings(session.charid)"),
  "corpFittingMgr.GetFittings": reshaped(`${FITTING_SVC}:430`, fittingsOf("corporationID", "corporation"), "GetFittingMgr(session.corpid).GetFittings(session.corpid)"),
  "allianceFittingMgr.GetFittings": reshaped(`${FITTING_SVC}:430`, fittingsOf("allianceID", "alliance"), "GetFittingMgr(session.allianceid).GetFittings(session.allianceid), and only for a pilot in an alliance"),

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
  "agentMgr.GetMissionObjectiveInfo": same(`${AGENT_WINDOW}:222`, "no arguments when the dialogue opens; the job board's page of a mission adds ignoreLocateCheck=True (jobboard/client/features/agent_missions/job.py:413)"),
  "agentMgr.GetAgentLocationWrap": same(`${AGENT_WINDOW}:276`, "no arguments"),
  "agentMgr.RemoveOfferFromJournal": same(`${AGENTS}:783`, "GetAgentMoniker(agentID).RemoveOfferFromJournal(), no arguments, on the agent's bound object"),
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
  "dogmaIM.GetAllInfo": Object.freeze({
    status: "same",
    source: `${GODMA}:2409`,
    note: "GetDogmaLM().GetAllInfo(primeCharacter, primeShip, primeStructure): three positional, each saying whether that one is to be primed. Asked with fewer, it goes out as godma's first priming does: (True, True, None)",
    shape: (args, kwargs) => (args.length === 3 ? { args, kwargs } : { args: [true, true, null], kwargs, status: "reshaped" }),
  }),
  "dogmaIM.ItemGetInfo": judged(
    `${GODMA}:1649`,
    (args) => (args.length === 1 && args[0] !== null && args[0] !== undefined ? { status: "same" } : { status: "differs", note: "The client always names the item: ItemGetInfo(itemID). Asked with none, the server answers for the ship; the client never asks so." }),
    "GetDogmaLM().ItemGetInfo(itemID)",
  ),
  "dogmaIM.GetTargeters": same(`${GODMA}:2364`, "GetDogmaLM().GetTargeters(), no arguments"),
  "dogmaIM.GetLayerDamageValuesByItems": differs(`${DRONE_DAMAGE}:38`, "The client sends a set of the drones in the bay whose damage it does not know, and does not ask at all when there are none. The BFF sends a list, and sends it empty."),
  "dogmaIM.GetDroneSettingAttributes": webOnly(`${GODMA}:2357`, "The client never asks this: godma keeps the drone settings that GetAllInfo brought, and answers from those."),
  "dogmaIM.GetCharacterAttributes": webOnly(`${SKILL_SVC}:224`, "The client never asks dogma for these: its skills service asks the skill handler (GetSkillHandler().GetAttributes())."),
  "dogmaIM.GetRequiredSkillLevels": webOnly(`${DEV_TOOLS}/dna.py:584`, "Only a developer's tool in the client asks this (RemoteSvc('dogmaIM').GetRequiredSkillLevels(typeID), by the service's name). The client proper has a type's required skills in its own static data."),
  "dogmaIM.QueryAllAttributesForItem": webOnly(`${DEV_TOOLS}/svc_dgmattr.py:220`, "Only a developer's tool in the client asks this (GetServerDogmaLM().QueryAllAttributesForItem(itemID))."),
  "dogmaIM.QueryAttributeValue": webOnly(`${CLIENT_OWN_DOGMA}:1722`, "The client never asks the server this. Its own dogma location works an attribute's value out, from what GetAllInfo and the server's notices brought."),
  "dogmaIM.GetLocationInfo": webOnly("dogma/items/baseDogmaItem.py:58", "The client never asks the server this. Its own dogma items know their owner, place and flag."),
  "agentMgr.GetAgents": same(`${AGENTS}:92`, "RemoteSvc('agentMgr').GetAgents(), no arguments: the whole table, kept for the session"),
  "agentMgr.GetMyJournalDetails": same(`${JOURNAL_WINDOW}:312`, "RemoteSvc('agentMgr').GetMyJournalDetails(), no arguments"),
  "standingMgr.GetCharStandings": same(`${STANDING_SVC}:119`, "RemoteSvc('standingMgr').GetCharStandings(), no arguments"),
  "standingMgr.GetCorpStandings": same(`${STANDING_SVC}:126`, "RemoteSvc('standingMgr').GetCorpStandings(), no arguments, and only for a pilot whose corporation is not an NPC one (118)"),
  // ── a station, its guests, the map's stations, a structure ────────────────
  "stationSvc.GetStationItemBits": same("eve/client/script/ui/station/base.py:575", "RemoteSvc('stationSvc').GetStationItemBits(), no arguments, when the station's own item is not known"),
  "station.GetGuests": same("eve/client/script/ui/station/base.py:103", "RemoteSvc('station').GetGuests(), no arguments, once for a station and kept"),
  "map.GetStationInfo": same("eve/client/script/ui/services/uisvc.py:246", "RemoteSvc('map').GetStationInfo(), no arguments"),
  "structureDirectory.GetStructureInfo": same("eve/client/script/ui/services/structure/structureDirectory.py:38", "RemoteSvc('structureDirectory').GetStructureInfo(structureID), kept by structure"),

  // ── an agent's place and a mission's keywords ─────────────────────────────
  "agentMgr.GetSolarSystemOfAgent": same(`${AGENTS}:801`, "RemoteSvc('agentMgr').GetSolarSystemOfAgent(agentID), kept by agent"),
  "agentMgr.GetMissionKeywords": same(`${AGENTS}:633`, "GetAgentMoniker(agentID).GetMissionKeywords(contentID), on the agent's own object"),

  // ── a corporation's assets ────────────────────────────────────────────────
  "corpmgr.GetAssetInventory": same(`${CORP_ASSETS}:100`, "RemoteSvc('corpmgr').GetAssetInventory(session.corpid, which)"),
  "corpmgr.GetAssetInventoryForLocation": same(`${CORP_ASSETS}:423`, "RemoteSvc('corpmgr').GetAssetInventoryForLocation(session.corpid, locationID, which)"),
  "corpmgr.SearchAssets": Object.freeze({
    status: "same",
    source: `${CORP_ASSETS}:752`,
    note: "RemoteSvc('corpmgr').SearchAssets(which, itemCategoryID, itemGroupID, itemTypeID, qty): five positional, and a filter that is not set is None, never nought. Asked when the pilot presses Search.",
    shape: (args, kwargs) => {
      const set = (value) => (typeof value === "number" && value > 0 ? value : null);
      const sent = [args[0] || null, set(args[1]), set(args[2]), set(args[3]), set(args[4])];
      return args.length === sent.length && sent.every((value, index) => value === args[index]) ? { args, kwargs } : { args: sent, kwargs, status: "reshaped" };
    },
  }),

  // ── a character: its sheet, its stations ──────────────────────────────────
  "charMgr.GetPublicInfo3": Object.freeze({
    status: "same",
    source: "eve/client/script/ui/shared/info/characterInfoWindow.py:194",
    note: "RemoteSvc('charMgr').GetPublicInfo3(itemID): the character named, by the window that shows one. Asked with none, the pilot's own.",
    shape: ofTheCharacter,
  }),
  "charMgr.GetCharacterDescription": Object.freeze({
    status: "same",
    source: "eve/client/script/ui/shared/neocom/charsheet/bioPanel.py:28",
    note: "RemoteSvc('charMgr').GetCharacterDescription(session.charid): the character named. Asked with none, the pilot's own.",
    shape: ofTheCharacter,
  }),
  "charMgr.GetHomeStationRow": same("eve/client/script/ui/shared/neocom/charactersheet.py:59", "RemoteSvc('charMgr').GetHomeStationRow(), no arguments, asked once and kept until the session is reset"),
  "charMgr.GetHomeStation": webOnly("eve/client/script/ui/shared/neocom/charactersheet.py:59", "The client never asks this of charMgr: its character sheet's service asks GetHomeStationRow()."),
  "charMgr.GetCloneInfo": webOnly("eve/client/script/ui/services/clonejumpsvc.py:76", "The client never asks this. Its jump clones, their implants and the time of the last jump come from GetCloneState() on the jumpCloneSvc moniker for where the pilot is; the implants in the pilot's head are what its skill handler answers GetImplants() with (skillsvc.py 967), which godma's 'implants' of the character hands on."),
  "charMgr.ListStations": same(`${INV_CACHE}:833`, "invCache's global container: self.moniker.ListStations(), no arguments, kept for five minutes"),

  // ── industry ──────────────────────────────────────────────────────────────
  "blueprintManager.GetBlueprintDataByOwner": same(`${INDUSTRY}/blueprintSvc.py:150`, "RemoteSvc('blueprintManager').GetBlueprintDataByOwner(ownerID, None), or with a facility's ID for the blueprints at one (137)"),
  "industryManager.GetJobsByOwner": same(`${INDUSTRY}/industrySvc.py:73`, "RemoteSvc('industryManager').GetJobsByOwner(ownerID, includeCompleted)"),
  "industryManager.GetJobCounts": same(`${INDUSTRY}/industrySvc.py:243`, "RemoteSvc('industryManager').GetJobCounts(session.charid)"),
  "facilityManager.GetFacilities": same(`${INDUSTRY}/facilitySvc.py:133`, "RemoteSvc('facilityManager').GetFacilities(), no arguments"),
  "facilityManager.GetMaxActivityModifiers": same(`${INDUSTRY}/facilitySvc.py:87`, "RemoteSvc('facilityManager').GetMaxActivityModifiers(), no arguments"),

  // ── mail and notifications ────────────────────────────────────────────────
  "mailMgr.SyncMail": same(`${MAIL_SERVICES}/mailSvc.py:157`, "RemoteSvc('mailMgr').SyncMail(firstID, lastID): the lowest and highest message IDs the client holds, (None, 0) when it holds none"),
  "notificationMgr.GetByGroupID": same(`${MAIL_SERVICES}/notificationSvc.py:64`, "RemoteSvc('notificationMgr').GetByGroupID(groupID)"),
  "notificationMgr.GetUnprocessed": same(`${MAIL_SERVICES}/notificationSvc.py:107`, "RemoteSvc('notificationMgr').GetUnprocessed(), no arguments"),
  "notificationMgr.GetAllNotifications": Object.freeze({
    status: "same",
    source: `${MAIL_SERVICES}/notificationSvc.py:93`,
    note: "RemoteSvc('notificationMgr').GetAllNotifications(fromID=fromID): a keyword, nought for all of them",
    shape: (args, kwargs) => (args.length === 0 && "fromID" in kwargs
      ? { args, kwargs }
      : { args: [], kwargs: { ...kwargs, fromID: kwargs.fromID ?? args[0] ?? 0 }, status: "reshaped" }),
  }),

  // ── a fleet's own object: asked only by a pilot who is in the fleet ───────
  "fleetObjectHandler.GetInitState": same(`${FLEET_SVC}:259`, "self.fleet.GetInitState(), no arguments, on the fleet's object"),
  "fleetObjectHandler.GetWings": same(`${FLEET_SVC}:1165`, "self.fleet.GetWings(), no arguments"),
  "fleetObjectHandler.GetMotd": same(`${FLEET_SVC}:1967`, "self.fleet.GetMotd(), no arguments"),
  "fleetObjectHandler.GetJoinRequests": same(`${FLEET_SVC}:461`, "self.fleet.GetJoinRequests(), no arguments"),
  "fleetObjectHandler.GetFleetComposition": same(`${FLEET_SVC}:900`, "self.fleet.GetFleetComposition(), no arguments"),

  // ── contracts, the market and the calendar: the proxy's services ──────────
  "contractProxy.SearchContracts": Object.freeze({
    status: "same",
    source: `${CONTRACT_SEARCH}:1367`,
    note: "ProxySvc('contractProxy').SearchContracts(itemTypes=..., ..., startNum=...): twenty-six keywords, every one every time, None for a filter not set, and no positional arguments. The sort is the choice of the panel's list, which starts on date created, oldest first (on price, lowest first, for auctions and exchanges together). The client's panel starts on the current region; a search with no locationID is its All Regions. For a search that is not for couriers the client sends the 'exclude multiple' tick as a bool: nothing here searches those yet.",
    shape: (args, kwargs) => {
      // PopulateSortCombo (267): the saved choice, or the list's first; (SORT_PRICE, 0) for auctions and exchanges together.
      const startsOn = kwargs.contractType === CONTYPE_AUCTION_AND_ITEM_EXCHANGE ? CONTRACT_SORT_PRICE : CONTRACT_SORT_ID;
      const unset = { sortBy: startsOn, sortDir: 0, startNum: 0 };
      const sent = {};
      for (const name of CONTRACT_SEARCH_KEYWORDS) sent[name] = kwargs[name] ?? unset[name] ?? null;
      const whole = args.length === 0 && Object.keys(kwargs).length === CONTRACT_SEARCH_KEYWORDS.length && CONTRACT_SEARCH_KEYWORDS.every((name) => kwargs[name] === sent[name]);
      return whole ? { args: [], kwargs: sent } : { args: [], kwargs: sent, status: "reshaped" };
    },
  }),
  "contractProxy.GetLoginInfo": same(`${CONTRACTS_SVC}:191`, "GetContractProxySvc().GetLoginInfo(), no arguments. The client asks once, when its notifications are ready, for the Neocom's blink; the page asks with every opening of its panel."),
  "contractProxy.GetMyExpiredContractList": same(`${CONTRACTS_SVC}:748`, "ProxySvc('contractProxy').GetMyExpiredContractList(False), and (True) for the corporation's straight after: the client asks the two together and keeps them."),
  "contractProxy.GetContractListForOwner": Object.freeze({
    status: "same",
    source: `${CONTRACT_PANELS}:419`,
    note: "ProxySvc('contractProxy').GetContractListForOwner(ownerID, status, contractType, issuedBy, num=100, startContractID=...): the My Contracts panel's list, asked when the panel opens and when its button is pressed, for the status its filter is on. Recorded on Tranquility as (charID, 0, None, None), num=100, startContractID=None.",
    shape: ownersContracts,
  }),
  "crimewatch.GetClientStates": same(`${CRIMEWATCH_SVC}:89`, "CharGetCrimewatchLocation().GetClientStates(), no arguments, on a moniker made for the call. Recorded on Tranquility as the call a bind of crimewatch carried."),
  "crimewatch.SetSafetyLevel": same(`${CRIMEWATCH_SVC}:343`, "CharGetCrimewatchLocation().SetSafetyLevel(safetyLevel)"),
  "crimewatch.GetMySecurityStatus": same(`${CRIMEWATCH_SVC}:592`, "CharGetCrimewatchLocation().GetMySecurityStatus(), no arguments: asked once and kept. Recorded on Tranquility as the call a bind of crimewatch carried."),
  "crimewatch.GetCharacterSecurityStatus": same(`${CRIMEWATCH_SVC}:596`, "CharGetCrimewatchLocation().GetCharacterSecurityStatus(charID)"),
  "crimewatch.GetSecurityStatusTransactions": same(`${CRIMEWATCH_SVC}:603`, "CharGetCrimewatchLocation().GetSecurityStatusTransactions(), no arguments"),
  "skillMgr2.GetMySkillHandler": same(`${SKILL_SVC}:130`, "session.ConnectToRemoteService('skillMgr2').GetMySkillHandler(), no arguments: asked once and the moniker it answers kept."),
  "skillHandler.GetSkills": same(`${SKILL_SVC}:136`, "GetSkillHandler().GetSkills(), no arguments"),
  "skillHandler.GetAllSkills": same(`${SKILL_SVC}:142`, "GetSkillHandler().GetAllSkills(), no arguments"),
  "skillHandler.GetAttributes": same(`${SKILL_SVC}:224`, "GetSkillHandler().GetAttributes(), no arguments"),
  "skillHandler.GetSkillChangesForISIS": same(`${SKILL_SVC}:379`, "GetSkillHandler().GetSkillChangesForISIS(), no arguments"),
  "skillHandler.GetRespecInfo": same(`${SKILL_SVC}:802`, "GetSkillHandler().GetRespecInfo(), no arguments"),
  "skillHandler.GetFreeSkillPoints": same(`${SKILL_SVC}:852`, "GetSkillHandler().GetFreeSkillPoints(), no arguments"),
  "skillHandler.GetBoosters": same(`${SKILL_SVC}:962`, "GetSkillHandler().GetBoosters(), no arguments: asked once and kept. Recorded on Tranquility as the call the handler's bind carried."),
  "skillHandler.GetImplants": same(`${SKILL_SVC}:967`, "GetSkillHandler().GetImplants(), no arguments: the implants in the pilot's head, asked once and kept (godma's 'implants' of the character is this). Recorded on Tranquility at login."),
  "skillHandler.GetSkillPoints": same(`${SKILL_SVC}:989`, "GetSkillHandler().GetSkillPoints(), no arguments"),
  "contractProxy.GetContract": judged(
    `${CONTRACTS_SVC}:336`,
    (args) => (args.length === 1 && args[0] > 0 ? { status: "same" } : { status: "differs", note: "The client names the one contract and nothing else: GetContract(contractID)." }),
    "GetContractProxySvc().GetContract(contractID): one contract in full, which the client keeps for five minutes. Recorded on Tranquility with the ID alone.",
  ),
  "contractProxy.GetMyCurrentContractList": webOnly(`${CONTRACTS_SVC}:784`, "The client's contracts service has a wrapper for this that nothing in the client calls. Its My Contracts panel lists with GetContractListForOwner(ownerID, status, contractType, issuedBy, num=100, startContractID=...) (contractPanels.py 419)."),
  "marketProxy.GetCharOrders": same(`${MARKET_QUOTE}:389`, "GetMarketProxy().GetCharOrders(), no arguments"),
  "marketProxy.GetMarketOrderHistory": same(`${MARKET_QUOTE}:395`, "GetMarketProxy().GetMarketOrderHistory(), no arguments"),
  "marketProxy.GetCharEscrow": same(`${MARKET_QUOTE}:401`, "GetMarketProxy().GetCharEscrow(), no arguments"),
  "marketProxy.CharGetTransactions": Object.freeze({
    status: "same",
    source: "eve/client/script/ui/shared/marketSvc.py:23",
    note: "GetMarketProxy().CharGetTransactions(fromDate), and the date is None wherever the client asks (marketTransactionsPanel.py 161, transactionOverviewController.py 99): all of them. Nought or nothing goes out as None.",
    shape: (args, kwargs) => {
      if (args.length === 1 && args[0] === null) return { args, kwargs };
      if (args.length === 0 || args[0] === 0) return { args: [null], kwargs, status: "reshaped" };
      return { args, kwargs, status: "differs", note: "The client asks for all of the market's transactions, with None for the date. A date is the web client's own." };
    },
  }),
  "calendarProxy.GetEventList": same(`${CALENDAR_SVC}:239`, "GetCalendarProxy().GetEventList(month, year), kept by month for the session"),
  "calendarProxy.GetEventDetails": judged(`${CALENDAR_SVC}:261`, ofAnOpenedEvent, "GetCalendarProxy().GetEventDetails(eventID, ownerID), kept by event"),
  "calendarMgr.GetResponsesForCharacter": same(`${CALENDAR_SVC}:252`, "RemoteSvc('calendarMgr').GetResponsesForCharacter(), no arguments, asked once and kept"),
  "calendarMgr.GetResponsesToEvent": judged(`${CALENDAR_SVC}:415`, ofAnOpenedEvent, "RemoteSvc('calendarMgr').GetResponsesToEvent(eventID, ownerID)"),
  "account.GetCashBalance": same(`${WALLET_SVC}:41`, "RemoteSvc('account').GetCashBalance(0): nought for the pilot's own wallet"),
  "account.GetEntryTypes": same(`${ACCOUNT_SVC}:101`, "GetAccountMgr().GetEntryTypes(), no arguments, once for the session"),
  "account.GetWalletDivisionsInfo": same(`${ACCOUNT_SVC}:135`, "GetAccountMgr().GetWalletDivisionsInfo(), no arguments, kept five minutes"),
  "account.GetTransactions": Object.freeze({
    status: "same",
    source: `${ACCOUNT_SVC}:116`,
    note: "GetAccountMgr().GetTransactions(accountKey, year, month, isCorp): four positional, the last a bool (False for the pilot's own, with accountingKeyCash)",
    // Whether it is the corporation's is a bool to the client; the BFF's routes have said it with a number.
    shape: ([accountKey, year = null, month = null, isCorp = false], kwargs) => (typeof isCorp === "boolean"
      ? { args: [accountKey, year, month, isCorp], kwargs }
      : { args: [accountKey, year, month, Boolean(isCorp)], kwargs, status: "reshaped" }),
  }),
  "corpRegistry.GetCorporation": same(`${CORP_SVC}/bco_corporations.py:49`, "GetCorpRegistry().GetCorporation(), no arguments, on the corporation's moniker"),
  "officeManager.GetMyCorporationsOffices": same(`${CORP_SVC}/officeManager.py:41`, "RemoteSvc('officeManager').GetMyCorporationsOffices(), no arguments"),
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
  const proxy = PROXY_SERVICES.has(service);
  if (!entry) return { ...given, status: "unchecked", source: null, note: null, moniker, proxy };
  if (typeof entry.shape !== "function") return { ...given, status: entry.status, source: entry.source, note: entry.note ?? null, moniker, proxy };
  const shaped = entry.shape(given.args, given.kwargs ?? {}, context ?? {});
  const keywords = shaped.kwargs && Object.keys(shaped.kwargs).length > 0 ? shaped.kwargs : null;
  return {
    args: shaped.args,
    kwargs: keywords,
    status: shaped.status ?? entry.status,
    source: entry.source,
    note: shaped.note ?? entry.note ?? null,
    moniker,
    proxy,
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

module.exports = { CONTRACT_SEARCH_KEYWORDS, MONIKER_SERVICES, PROXY_SERVICES, REPEATS, RETAIL_CALLS, createCallLedger, list, madeAfresh, madeOnMoniker, retailForm, retailNeeds };
