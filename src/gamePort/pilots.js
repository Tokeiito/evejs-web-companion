"use strict";

// The game-port transport for a selected pilot.
//
// src/pilotTransport.js sends a pilot's nine functions either to the web
// gateway or here. This implements them on a GamePortSession: the retail
// protocol on TCP 26000, one connection per pilot, logged in and kept alive as
// the retail client's is.
//
// The contract is the gateway client's (src/eveGatewayClient.js): the same
// arguments, the same answers, the same error codes. What the gateway does
// for each function was read from eve.js
// (server/src/_secondary/express/evejsWebGatewayRuntime.js) and is matched
// here, because everything above this module was written against it:
//
//   - A call's arguments are JSON in the marshaller's own tree, and its
//     answer is that tree as JSON (bridgeJson.js maps ours onto it).
//   - A session keeps a backlog of what the server pushed. Every answer
//     drains it; the event stream carries the same notifications as they
//     arrive. The stream is liveness, the drain is correctness.
//   - A refusal by the game is CALL_REFUSED with the handler's own words. A
//     session that is gone is SESSION_NOT_FOUND, which is what tells the BFF
//     to send the browser back to character selection.
//
// What is the game port's own:
//
//   - Selecting is what the retail client's character selection does: log in,
//     GetCharacterSelectionData, GetCharacterLockType, SelectCharacterID.
//   - The account is the one the BFF authenticated. The game port takes any
//     password on a development server, so the login name comes from the
//     BFF's signed session and the server's answer is checked against the
//     BFF's account ID before anything else is asked of it.
//   - The connection closing is the session ending. There is no time-to-live.
//
//   - A bound object is bound as the retail client binds it. The gateway's
//     "bind" calls a method as though it were a service's and keeps whatever
//     bound object comes back; the retail client first binds a service's
//     object for where the pilot is (eveMoniker.py) and then asks that for
//     the inventory (invCache.py). bindRetail() below is that translation,
//     one case per shape the BFF asks for.
//
//   - A pilot in space has a ballpark of its own, kept as the retail client
//     keeps one (pilotSpace.js): made when the session enters a solar system,
//     fed by the session, stepped once a second, and let go on docking. The
//     space snapshot and the movement half of the flight status are read from
//     it (spaceProjection.js), where the gateway reads the server's scene.
//   - The ship's own readings that the ballpark does not hold (capacitor, the
//     three capacities) are dogma's, loaded and kept as the retail client's
//     godma keeps them (pilotDogma.js).
//
// Not here yet (docs/game-port-transport-plan.md, Phase 4): the scanner in
// space, how damaged each module is, and which weapons are grouped.

const crypto = require("node:crypto");
const { GamePortSession } = require("./session");
const { connectTcp, gameEndpoint } = require("./tcp");
const { longKeptToBridgeJson, notificationToBridgeJson, sessionChangeToBridgeJson, wireToBridgeJson } = require("./bridgeJson");
const { GAME_PORT_HANDLE_PREFIX } = require("../pilotTransport");
const { GAME_PORT_ONLY_CALLS, ON_AN_ANSWERED_OBJECT, ON_THE_PARK, couldBeAPilot, createCallLedger, madeAfresh, retailForm, retailNeeds } = require("./retailCalls");
const { createPilotSpace } = require("./pilotSpace");
const { createPilotClock } = require("./pilotClock");
const { EFFECT_CATEGORY, EFFECT_ONLINE, createPilotDogma, rowFields } = require("./pilotDogma");
const { MAX_PROBES, createPilotScanner } = require("./pilotScanner");
const { createPilotFleet } = require("./pilotFleet");
const { createPilotStandings } = require("./pilotStandings");
const { createPilotSkills } = require("./pilotSkills");
const { createPilotJournal } = require("./pilotJournal");
const { createKeptReads } = require("./keptReads");
const { createPilotStation } = require("./pilotStation");
const { createPilotStructureGuests } = require("./pilotStructureGuests");
const { CLIENT_STATE_NOTICES, statesAfter } = require("./crimewatchStates");
const { GOOD_FOR_MS: WARS_GOOD_FOR_MS, createPilotWars } = require("./pilotWars");
const { isBridgeWritePair } = require("../bridgeCallPolicy");
const { namedAfterCall, namedOnNotice, namedOnSessionChange } = require("./cachedCallsNamed");
const { brokersFeeRate, brokersFeeRateInStructure } = require("./brokerFee");
const { averagePrice, historyRows } = require("./priceHistory");
const { TARGETS, TARGETERS, createPilotTargets } = require("./pilotTargets");
const { buildSkillSheet } = require("./skillSheet");
const { projectFlight, projectSpace } = require("./spaceProjection");
const { MODE: BALL_MODE } = require("./destiny/state");
const contract = require("../../contracts/evejs-web-bridge-contract.json");

/** The gateway's own codes and statuses (WEB_CALL_ERROR_STATUS_CODES), plus the gateway client's two. */
const STATUS = Object.freeze({
  CALL_INVALID: 400,
  CALL_NOT_ALLOWED: 403,
  CALL_FAILED: 502,
  CALL_REFUSED: 409,
  QUESTION_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  SESSION_SELECT_FAILED: 502,
  BOUND_HANDLE_NOT_FOUND: 404,
  BOUND_NO_OBJECT: 502,
  EVE_GATEWAY_TIMEOUT: 502,
  EVE_GATEWAY_UNREACHABLE: 502,
  PILOT_TRANSPORT_UNAVAILABLE: 501,
});

/** An error with the `code` and `statusCode` the BFF reads off a gateway error. */
class GamePortPilotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GamePortPilotError";
    this.code = code;
    this.statusCode = STATUS[code] || 502;
  }
}

const fail = (code, message) => new GamePortPilotError(code, message);

const SESSION_GONE = "Unknown, expired, or released bridge session.";
/** The gateway's event-stream envelope. The browser checks `source`, so it is the contract, not a label. */
const STREAM_SOURCE = "evejs-web-gateway";
const STREAM_HISTORY_LIMIT = 256;
/** A backlog nobody drains must not grow for ever; the stream and the next read still tell the story. */
const BACKLOG_LIMIT = 4096;
/** The gateway drops these on purpose: nothing above reads them, and they arrive ten times a second. */
const SUPPRESSED_NOTIFICATIONS = new Set(["DoDestinyUpdate"]);
/** appConst.charLockInTransferQueue, charLockOnSale: what characterSelection.py refuses with. */
const LOCK_REFUSALS = new Map([[1, "CharacterTransferring"], [2, "CharacterOnSale"]]);
const GROUP_CAPSULE = 29;
/** const.categoryShip (idCheckers.IsShip). */
const CATEGORY_SHIP = 6;
const GROUP_SCANNER_PROBE = 479;
const GROUP_SCAN_PROBE_LAUNCHER = 481;
/** inventorycommon/const.py */
const GROUP_SOLAR_SYSTEM = 5;
const GROUP_STATION = 15;
const CONTAINER_HANGAR = 10004;
/** evefleet/const.py fleetCmdrRoles: a fleet's commander, a wing's, a squad's. */
const FLEET_COMMANDER_ROLES = new Set([1, 2, 3]);
/** idCheckers.IsNPC: maxSystemItem < ownerID < minPlayerOwner. */
const MAX_SYSTEM_ITEM = 10000;
const MIN_PLAYER_OWNER = 90000000;
/**
 * Services whose object is bound for where the pilot is. The retail client's
 * moniker for one carries a session check, and is bound afresh when the pilot
 * moves; here the handle is dropped, and the BFF binds again.
 */
const LOCATION_SERVICES = new Set(["invbroker", "ship", "dogmaIM", "crimewatch", "reprocessingSvc", "entity", "beyonce", "scanMgr"]);
const LOCATION_ATTRIBUTES = ["stationid", "structureid", "solarsystemid", "locationid"];
/**
 * Services whose moniker is for the pilot's corporation, not for where the
 * pilot is (eveMoniker.GetCorpRegistry: its session check is on corpid). It is
 * kept through a move and bound afresh when the corporation changes.
 */
const CORPORATION_SERVICES = new Set(["corpRegistry"]);
const CORP_REGISTRY = "corpRegistry";
/**
 * The service whose moniker is for the pilot's alliance (eveMoniker.GetAlliance: its session check is on
 * allianceid). Kept through a move, and made again when the alliance changes.
 */
const ALLIANCE_REGISTRY = "allianceRegistry";
/**
 * The service whose moniker is for the pilot's alliance, or for its corporation where it is in none
 * (eveMoniker.GetWar, 184 to 192: Moniker('warRegistry', (session.allianceid or session.corpid, 1)), its session
 * check on that owner). The war service keeps it through a move, and makes another when that owner is another's
 * (war_cso.GetMoniker, 57 to 67).
 */
const WAR_REGISTRY = "warRegistry";
/** The war registry's read whose answer the war service keeps: an owner's wars, for twelve hours (war_cso.GetWars, 98 to 106). */
const WARS_READ = "GetWars";
/** Whether a call is the war service's read of an owner's wars, asked as the client asks it: with the owner alone. */
const keptWars = (service, method, args, kwargs) => service === WAR_REGISTRY && method === WARS_READ && args.length === 1 && kwargs === null && positive(args[0]) !== null;
/**
 * war_cso.CheckForStartOrEndOfWar (172 to 182): the war service's thread reads its owner's wars every ten seconds,
 * which asks for them again once they are more than twelve hours old (GetWars, 100). So: twelve hours after an
 * asking, by the thread's next round, which is ten seconds on at the latest.
 */
const WARS_AGAIN_AFTER_MS = WARS_GOOD_FOR_MS + 10 * 1000;
/**
 * The registry's read whose answer is kept as the client keeps it: the corporation's aggression settings
 * (crimewatchSvc.corpAggressionSettings). Asked when the client asks, and from then on answered from what is kept.
 */
const AGGRESSION_SETTINGS = "GetAggressionSettings";
/**
 * Monikers the client binds for their own sake before it calls anything on them: base_corporation.GetCorpRegistry
 * makes the corporation's and calls Bind() on it, which sends MachoBindObject(params, None), and all_cso.GetMoniker
 * does the same with the alliance's, and war_cso.GetMoniker with the war registry's (Tranquility's recordings
 * of a login have it so: MachoBindObject((owner, 1), None), and GetWars on the object). Any other binds when it
 * is first called, with that call riding along (moniker.py).
 */
const BOUND_BEFORE_USE = new Set(["corpRegistry", "allianceRegistry", "warRegistry"]);
const NOTIFICATION_MGR = "notificationMgr";
const CALENDAR_PROXY = "calendarProxy";
/**
 * What a read of the notification manager's is kept as, for the three the client's notification service keeps:
 * all of them from the first (allNotifications: GetAllNotifications(fromID=0), as its notification window asks
 * when a character is chosen), the unread ones (unreadNotifications: GetUnprocessed()), and those of a group
 * (notifications[groupID]: GetByGroupID(groupID)). Null for any other read: all of them from a later one is asked
 * each time.
 */
function notificationKeptAs(method, form) {
  if (method === "GetAllNotifications") return form.kwargs && form.kwargs.fromID === 0 ? "all" : null;
  if (method === "GetUnprocessed") return "unread";
  return method === "GetByGroupID" ? `group:${form.args[0]}` : null;
}
/**
 * The two reads the client's station service answers from what it keeps, for a pilot docked in a station
 * (pilotStation.js): the station's guests, and its own item.
 */
const STATION_KEPT = new Set(["station.GetGuests", "stationSvc.GetStationItemBits"]);
/** A list or a tuple off the wire. */
const isAList = (value) => Array.isArray(value) || Boolean(value && value.type === "list" && Array.isArray(value.items));
const PLANET_MGR = "planetMgr";
const PLANET_INFO = "GetPlanetInfo";
/**
 * The two reads of a planet's own object that are kept by the planet (planetRead): its colony, which
 * clientPlanet.PreparePlanet asks for when the planet is first wanted (clientPlanet.py 83), and what the planet
 * carries (clientPlanet.py 644).
 */
const PLANET_READS = new Set([PLANET_INFO, "GetPlanetResourceInfo"]);
/**
 * How long a colony is kept as it was answered. The client keeps a planet's colony for as long as it has the
 * planet, and reckons what the colony makes by itself (the colony's own simulation); it asks again only when the
 * server says the planet's state changed. Nothing here reckons a colony, so what is kept is let go after a
 * minute, and asked for when it is next wanted: more often than the client asks, and never more than a minute
 * behind what a colony has made.
 */
const PLANET_INFO_KEPT_MS = 60_000;
/** The server's word that a colony is not as it was: planetSvc.OnMajorPlanetStateUpdate, and the pins it says to look at again. */
const COLONY_NOTICES = new Set(["OnMajorPlanetStateUpdate", "OnRefreshPins"]);
/** The pilot's own calls on a planet's object that change its colony or what a pin holds. */
const COLONY_WRITES = new Set(["UserUpdateNetwork", "UserLaunchCommodities", "UserTransferCommodities", "UserAbandonPlanet"]);
/** Whether one of the pilot's own calls on an object may have changed a colony: those, and goods sent between a launchpad and a customs office. */
const changesAColony = (service, method) => (service === PLANET_MGR && COLONY_WRITES.has(method)) || (service === "invbroker" && method === "ImportExportWithPlanet");
/**
 * What a read of the planet manager's is kept as: the pilot's colonies (planetSvc.colonizationData:
 * GetPlanetsForChar(), planetSvc.py 65) and its launches (planetUISvc.launchsRowSet: GetMyLaunchesDetails(),
 * planetUISvc.py 170), each asked with nothing. Null for any other read, and for one with something sent beside
 * it, which is no call of the client's and is asked as it came.
 */
const planetKeptAs = (method, form) => (form.args.length > 0 ? null : method === "GetPlanetsForChar" ? "colonies" : method === "GetMyLaunchesDetails" ? "launches" : null);
const CRIMEWATCH = "crimewatch";
/** crimewatchSvc's two reads that it keeps: its client states (the timers, the engagements, who is flagged, the safety level), and the pilot's own security status. */
const CLIENT_STATES = "GetClientStates";
const OWN_SECURITY_STATUS = "GetMySecurityStatus";
/** Whether a call is one of crimewatchSvc's two kept reads, asked as the client asks it: with nothing. */
const SET_SAFETY_LEVEL = "SetSafetyLevel";
/** The account's clone grade, which the client's clone grade service asks once and keeps (omega/client/clone_grade_svc.py 125). */
const SUBSCRIPTION_MGR = "subscriptionMgr";
const CLONE_GRADE = "GetCloneGrade";
const keptCloneGrade = (service, method, form) => service === SUBSCRIPTION_MGR && method === CLONE_GRADE && form.args.length === 0 && form.kwargs === null;
const keptOfCrimewatch = (service, method, form) => service === CRIMEWATCH && (method === CLIENT_STATES || method === OWN_SECURITY_STATUS) && form.args.length === 0 && form.kwargs === null;
/** The pilot's jump timers, which crimewatchSvc asks once of the service by its name and keeps (crimewatchSvc.py 605 to 608). */
const JUMP_TIMERS = "jumpTimers";
const JUMP_TIMERS_READ = "GetTimers";
/** Whether a call is crimewatchSvc's read of the jump timers, asked as the client asks it: with the pilot's own character alone. */
const keptJumpTimers = (service, method, form, characterID) => service === JUMP_TIMERS && method === JUMP_TIMERS_READ && form.args.length === 1 && form.kwargs === null && positive(form.args[0]) === characterID;
/** The warzone service's read of the system the session is in, which it keeps for as long as the session is there (fwWarzoneSvc.py 47 to 60). */
const FW_WARZONE = "fwWarzoneSolarsystem";
const LOCAL_OCCUPATION = "GetLocalOccupationState";
/** Whether a call is the warzone service's read of the local occupation state, asked as the client asks it: with nothing. */
const keptLocalOccupation = (service, method, form) => service === FW_WARZONE && method === LOCAL_OCCUPATION && form.args.length === 0 && form.kwargs === null;
/** idCheckers.IsKnownSpaceSystem and IsWormholeSystem (inventorycommon/const.py 42 to 45): a solar system of known space, or of a wormhole's. */
const inKnownOrWormholeSpace = (solarSystemID) => solarSystemID !== null && solarSystemID >= 30000000 && solarSystemID <= 31999999;
/** The dynamic resource service's read of the bounty output of the system the session is in (dynamicResourceSvc.py 58 to 65). */
const BOUNTY_MGR = "dynamicBountyMgr";
const BOUNTY_OUTPUT = "GetOutputForClientSolarSystem";
/** Whether a call is the dynamic resource service's read of the system's bounty output, asked as the client asks it: with nothing. */
const keptBountyOutput = (service, method, form) => service === BOUNTY_MGR && method === BOUNTY_OUTPUT && form.args.length === 0 && form.kwargs === null;
/** @expiring_memoize(5400) on that read (dynamicResourceSvc.py 58): what is kept is good for ninety minutes from its keeping. */
const BOUNTY_OUTPUT_GOOD_FOR_MS = 5400 * 1000;
/** The security service's read of the solar systems whose security is other than the map's (security/client/securitySvc.py 39 to 43). */
const SECURITY_MGR = "securityMgr";
const MODIFIED_SYSTEMS = "get_modified_systems";
/** securitySvc.calculate_pseudo_security (18 to 21): a level above nought and under 0.05 is 0.05. */
const pseudoSecurity = (security) => (security > 0 && security < 0.05 ? 0.05 : security);
/** The character settings service's one read, which it keeps for the session (eve/client/script/ui/services/characterSettingsSvc.py 31 to 34). */
const CHARACTER_SETTINGS = "GetCharacterSettings";
/** Whether a call is the character settings service's read, asked as the client asks it: with nothing. */
const keptCharacterSettings = (service, method, form) => service === "charMgr" && method === CHARACTER_SETTINGS && form.args.length === 0 && form.kwargs === null;
const OFFICE_MANAGER = "officeManager";
/**
 * What the client hands back to the server as it was answered, and so with the Python type it came with:
 * officeManager.py 114 to 117, cost = GetPriceQuote(session.corpid) and then RentOffice(cost). Tranquility's
 * station answered the long 100113 and was sent that long. The page is handed such an answer with its long kept,
 * and hands it back as it got it (web/src/bridge/officeWrites.ts).
 */
const HANDED_BACK_AS_ANSWERED = new Set([`${OFFICE_MANAGER}.GetPriceQuote`]);
/**
 * The read of the station's own office object that the client's office manager keeps (officeManager.offices,
 * officeManager.py 34): the corporations with an office where the session is docked.
 */
const STATION_OFFICES = "GetCorporationsWithOffices";
/**
 * The call the client makes once for a station's Moniker, where its corporation has an office there
 * (officeManager.GetCorpOfficeAtLocation, 106: the Moniker's isPrimed).
 */
const PRIME_OFFICE = "PrimeOfficeItem";
const STANDING_MGR = "standingMgr";
/**
 * What the client's standings service asks for when the character is chosen and keeps right from the server's
 * notices (standingsvc.py 111): the character's standings and its corporation's. Asked for again by name, as the
 * page asks when it shows them, they are answered from what is kept (refreshStandings): the client's panel reads
 * its service, and its service does not ask twice.
 */
const STANDINGS_KEPT = Object.freeze({ GetCharStandings: "char", GetCorpStandings: "corp" });
const ACCOUNT = "account";
/**
 * What the client's account service asks for once and keeps (svc.account GetStaticData, accountsvc.py 86: kept in
 * `self.data` until the character changes): the names of a wallet entry's kinds. On Tranquility it was asked once
 * while the wallet's transactions were asked three times (Archive/Open Wallet - Plex - Corp Wallet - Corp Transfers).
 */
const ACCOUNT_STATIC = new Set(["GetEntryTypes"]);
/**
 * What a read of the office manager's is kept as: the offices the pilot's corporation rents, wherever they are
 * (officeManager.corp_offices: GetMyCorporationsOffices(), officeManager.py 41), asked with nothing. Null for any
 * other read, and for one with something sent beside it, which is no call of the client's and is asked as it came.
 */
const officesKeptAs = (method, form) => (method === "GetMyCorporationsOffices" && form.args.length === 0 && form.kwargs === null ? "corporation" : null);
/** Whether a notice of an office (corporationID, officeID) is of the corporation the session is in (officeManager.py 72). */
const ofOwnCorporation = (args, attributes) => wholeOf(Array.isArray(args) ? args[0] : null) === wholeOf(attributes.corpid);
const STRUCTURE_SETTINGS = "structureSettings";
/** The client's structure guests service, and its one read (structureGuests.GetGuests, 25). */
const STRUCTURE_GUESTS = "structureGuests";
const STRUCTURE_GUESTS_READ = "GetGuests";
/** Whether an answer is a dict off the wire. */
const isADict = (value) => Boolean(value && value.type === "dict" && Array.isArray(value.entries));
/** The read the client's structure services service keeps (structureServices.onlineServices, structureServices.py 56). */
const STRUCTURE_SERVICES = "CharacterGetServices";
/** The read the client's market service asks a structure's market tax with (marketsvc.GetMarketTaxAtStructure, 239), and structures.SERVICE_MARKET. */
const STRUCTURE_SERVICE_VALUE = "CharacterGetService";
const STRUCTURE_SERVICE_MARKET = 5;
/**
 * How long a structure's market tax is kept as it was answered, by the structure: marketsvc.GetMarketTaxAtStructure
 * is @Memoize(2) (237), and what it kept is let go once more than two minutes have gone by since it was answered
 * (caching/memoize.py 100).
 */
const MARKET_TAX_KEPT_MS = 120_000;
/** Whether a structure's ID is that of the structure the session is docked in. */
const theStructureDockedIn = (structureID, attributes) => wholeOf(structureID) !== null && wholeOf(structureID) === wholeOf(attributes.structureid);
/**
 * What a read of the structure settings' is kept as: the services of the structure the pilot is docked in
 * (structureServices.CharacterGetServices, 29 to 35). Null for another structure's, which the client asks for each
 * time, and for any other read.
 */
const servicesKeptAs = (method, form, attributes) => (method === STRUCTURE_SERVICES && form.args.length === 1 && form.kwargs === null && theStructureDockedIn(form.args[0], attributes) ? "docked" : null);
/** Whether a notice of a structure's services (structureID) is of the structure the session is docked in (structureServices.py 49). */
const ofTheStructureDockedIn = (args, attributes) => theStructureDockedIn(Array.isArray(args) ? args[0] : null, attributes);
/** What a read of the calendar's is kept as: a month's events, by the month (calendar.events[(month, year)]: GetEventList(month, year)). */
const calendarKeptAs = (method, form) => (method === "GetEventList" ? `${form.args[1]}-${form.args[0]}` : null);
const BOOKMARK_MGR = "accessGroupBookmarkMgr";
/**
 * The bookmark manager's one read the client's bookmark service keeps (bookmarkSvc.ACLPrimeBookmarks, 157 to 177):
 * the folders the pilot knows, active or not, and the bookmarks and the subfolders of the active ones.
 */
const ACTIVE_BOOKMARKS = "GetMyActiveBookmarks";
/**
 * What a read of the bookmark manager's is kept as: its three lists, asked with nothing. Null for any other read,
 * and for one with something sent beside it, which is no call of the client's and is asked as it came.
 */
const bookmarksKeptAs = (method, form) => (method === ACTIVE_BOOKMARKS && form.args.length === 0 && form.kwargs === null ? "active" : null);
/** bookmarkSvc.ACLBookmarkLocation (617): the park's call that bookmarks a place in space, which the client works into what it keeps. */
const BOOKMARK_LOCATION = "BookmarkLocation";
const FACILITY_MANAGER = "facilityManager";
const INDUSTRY_MONITOR = "industryMonitor";
/**
 * How long a facility's places are kept as they were answered, by the facility and the owner they were asked for:
 * facilitySvc.GetFacilityLocations is @Memoize(1) (113), and what it kept is let go once more than a minute has
 * gone by since it was answered (caching/memoize.py 100).
 */
const FACILITY_PLACES_KEPT_MS = 60_000;
/**
 * The window's job once it was installed. The window then has the job the server made of it
 * (industryWnd.OnIndustryJobClient, 449 to 451), which is not the one monitored: the monitor is left as it is, and
 * the window's close lets nothing go (industrySvc.DisconnectJob, 311).
 */
const A_JOB_INSTALLED = Object.freeze({ installed: true });
/**
 * industrySvc.OnIndustryMaterials(jobID, materials) (324 to 327): what the monitored job's place has is what the
 * server says (job.available = materials), where the job's monitor is the notice's number. The monitor's answer
 * is kept and answered again (ConnectJob, below), so the kept answer is where the notice's word goes. A job once
 * installed is not the one monitored (it has no monitor's number), and a notice that says no materials is none.
 */
function monitoredJobHas(entry, args) {
  const job = entry.windowJob;
  if (!job || !Array.isArray(args) || args.length < 2 || job.monitorID !== positive(args[0])) return;
  job.answer = [itemsOf(job.answer)[0], args[1]];
}
/**
 * The two reads of the facility manager's the client's facility service keeps (facilitySvc.py): the region's
 * facilities (GetFacilities(), 133) and the largest system index of each activity (GetMaxActivityModifiers(), 87),
 * each asked with nothing. Null for any other read, and for one with something sent beside it, which is no call of
 * the client's and is asked as it came.
 */
const FACILITIES_KEPT_AS = Object.freeze({ GetFacilities: "region", GetMaxActivityModifiers: "largest" });
const facilitiesKeptAs = (method, form) => (Object.hasOwn(FACILITIES_KEPT_AS, method) && form.args.length === 0 && form.kwargs === null ? FACILITIES_KEPT_AS[method] : null);
/**
 * The answers a service of the client's keeps until something changes them, by the service they are asked of
 * (keptReads.js). `keptAs` says what a read is kept as, or null for one that is not kept. What changes them is
 * the server's word (`notices`; where there is a `concerns`, only a notice it says yes to, by the notice's
 * arguments and the session's attributes) and the pilot's own writes, by the service each is made on (`writes`). The
 * client works each change into what it keeps (notificationSvc.py, eveCalendarsvc.py). Here everything kept of
 * the service is forgotten at any of them, and asked for when it is next wanted.
 */
const KEPT_UNTIL_CHANGED = Object.freeze({
  // notificationSvc: one received, deleted or brought back, and the pilot's own marking and deleting.
  [NOTIFICATION_MGR]: Object.freeze({
    keptAs: notificationKeptAs,
    notices: new Set(["OnNotificationReceived", "OnNotificationDeleted", "OnNotificationUndeleted"]),
    writes: Object.freeze({ notificationMgr: new Set(["MarkGroupAsProcessed", "MarkAllAsProcessed", "MarkAsProcessed", "DeleteGroupNotifications", "DeleteAllNotifications", "DeleteNotifications"]) }),
  }),
  // calendar: an event made, changed or taken away, by anyone or by the pilot. Another corporation or alliance
  // forgets them too (calendar.OnSessionChanged), which the session's change sees to.
  [CALENDAR_PROXY]: Object.freeze({
    keptAs: calendarKeptAs,
    notices: new Set(["OnNewCalendarEvent", "OnEditCalendarEvent", "OnRemoveCalendarEvent"]),
    writes: Object.freeze({ calendarMgr: new Set(["CreatePersonalEvent", "CreateCorporationEvent", "CreateAllianceEvent", "EditPersonalEvent", "EditCorporationEvent", "EditAllianceEvent", "DeleteEvent"]) }),
  }),
  // planetSvc and planetUISvc: the launches changed (OnPILaunchesChange, at which the client forgets them), a
  // planet's state changed (OnMajorPlanetStateUpdate, at which the client changes its own list of colonies), the
  // pilot removed a launch (journal.py 465: the launches asked afresh), or changed a colony's network, which is
  // done on the planet's own object and at which the client changes its own count of the colony's pins.
  [PLANET_MGR]: Object.freeze({
    keptAs: planetKeptAs,
    notices: new Set(["OnPILaunchesChange", "OnMajorPlanetStateUpdate"]),
    writes: Object.freeze({ planetMgr: new Set(["DeleteLaunch", "UserUpdateNetwork"]) }),
  }),
  // officeManager: an office rented or given up by the pilot's own corporation (OnOfficeRentalChange, 69; the
  // corporation's offices are let go only where the corporation is the session's, 72). The client lets nothing go
  // at its own renting: the server's word of it does that. Another corporation forgets them too
  // (officeManager.OnSessionChanged, 62), which the session's change sees to.
  [OFFICE_MANAGER]: Object.freeze({
    keptAs: officesKeptAs,
    notices: new Set(["OnOfficeRentalChange"]),
    concerns: ofOwnCorporation,
    writes: Object.freeze({}),
  }),
  // bookmarkSvc: a shared folder changed, was deleted, is the pilot's to see no more, or is its to do other things
  // in (232, 322, 332, 343); and the pilot's own making, changing and deleting of a bookmark, a folder or a
  // subfolder, on the manager (every such call of the service's) or on the ballpark's own object (a scan result's
  // place, 629). The client works each into what it keeps, and asks nothing. A place bookmarked on the park (617)
  // is worked in here too, as the client works it, and is not among these (afterBookmarkCall).
  [BOOKMARK_MGR]: Object.freeze({
    keptAs: bookmarksKeptAs,
    notices: new Set(["OnSharedBookmarksFolderUpdated", "OnSharedBookmarksFolderDeleted", "OnSharedBookmarksFoldersAccessLost", "OnSharedBookmarksFoldersAccessChanged"]),
    writes: Object.freeze({
      accessGroupBookmarkMgr: new Set(["AddFolder", "UpdateFolder", "DeleteFolder", "AddToKnownFolders", "RemoveFromKnownFolders", "UpdateKnownFolderState", "BookmarkStaticLocation",
        "UpdateBookmark", "DeleteBookmarks", "MoveBookmarksToFolderAndSubfolder", "CopyBookmarksToFolderAndSubfolder", "CreateSubfolder", "UpdateSubfolder", "DeleteSubfolder"]),
      beyonce: new Set(["BookmarkScanResult"]),
    }),
  }),
  // facilitySvc: the server says the system's activity changed (OnSystemActivityUpdated, 37), and the largest
  // indices and every facility are let go. In another region the facilities alone are (29), which the session's
  // change sees to. A facility the server names (42), one a job was refused at and one a job is given are asked
  // for by themselves and worked into what is kept, where each happens (facilitiesAskedAfresh, freshFacility, and
  // jobsGivenTheirFacilities for the jobs the server answers).
  [FACILITY_MANAGER]: Object.freeze({
    keptAs: facilitiesKeptAs,
    notices: new Set(["OnSystemActivityUpdated"]),
    writes: Object.freeze({}),
  }),
  // structureServices: the services the structure the pilot is docked in has for it, asked as the pilot docks
  // (OnSessionChanged, 21 to 24) and kept; let go when the server says that structure's changed
  // (OnStructureServiceChanged, 48 to 52, at which the client asks at once). Out of the structure, or in another,
  // what is kept is not its (31), which the session's change sees to.
  [STRUCTURE_SETTINGS]: Object.freeze({
    keptAs: servicesKeptAs,
    notices: new Set(["OnStructureServiceChanged"]),
    concerns: ofTheStructureDockedIn,
    writes: Object.freeze({}),
  }),
});
/**
 * A container's two listings, which the client's inventory cache keeps (invCacheContainer.List, ListByFlags, in
 * invCache.py): a flag's items are asked for once, and from then on the cache goes by the server's word of each
 * item that changes. Here a listing is kept as the server answered it, by the handle it was asked on and what
 * was asked, and every listing is forgotten when anything may have changed one: at either of the server's two
 * notices of an item, in another place or ship, and at any write of the pilot's own, done or refused. What is
 * forgotten is asked for when it is next wanted. (The client works each change into what it holds, and asks
 * again for nothing.)
 */
const INVENTORY_LISTINGS = new Set(["List", "ListByFlags"]);
const ITEM_NOTICES = new Set(["OnItemChange", "OnItemsChanged"]);
const MARKET_PROXY = "marketProxy";
/** The clock's 100 ns ticks at the start of Unix time. */
const FILETIME_OF_UNIX_EPOCH = 116444736000000000n;
/** invconst.typeBrokerRelations. */
const TYPE_BROKER_RELATIONS = 3446;
const OWN_ORDERS = "GetCharOrders";

/** A whole number as a BigInt, a number or a long off the wire; null for anything else. */
function wholeOf(value) {
  if (typeof value === "bigint") return value;
  return typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : null;
}

/** Whether an answer is the bookmark manager's three lists: the folders, the bookmarks, the subfolders. */
const isTheThreeLists = (answered) => Array.isArray(answered) && answered.length === 3 && answered.every(isAList);

/**
 * bookmarkSvc.NewBookmarkCreated (634 to 640): the bookmark the client makes of a place it has just bookmarked, of
 * what the park answered and of what was sent, and keeps beside the server's own. Its fifteen names are a
 * bookmark's as this server answers one, in the same order; its making is the clock's, and its maker the pilot.
 */
function bookmarkMade({ bookmarkID, folderID, itemID, typeID, name, comment, created, expiry, x, y, z, locationID, subfolderID, creatorID }) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [
    ["bookmarkID", bookmarkID], ["folderID", folderID], ["itemID", itemID], ["typeID", typeID], ["flag", null], ["memo", name],
    ["created", created], ["expiry", expiry], ["x", x], ["y", y], ["z", z], ["locationID", locationID], ["note", comment],
    ["subfolderID", subfolderID], ["creatorID", creatorID],
  ] } };
}

/**
 * The three lists with a bookmark among the bookmarks, in the place of any that has its ID: the client keeps its
 * bookmarks by their IDs (bookmarkCache[bookmarkID] = bm, 636). The lists kept are left as they were.
 */
function withBookmark(lists, made, bookmarkID) {
  const [folders, bookmarks, subfolders] = lists;
  const id = wholeOf(bookmarkID);
  const others = itemsOf(bookmarks).filter((row) => id === null || wholeOf(row && row.type === "object" && row.args ? dictValue(row.args, "bookmarkID") : undefined) !== id);
  const all = [...others, made];
  return [folders, Array.isArray(bookmarks) ? all : { ...bookmarks, items: all }, subfolders];
}

/** eveCfg.GetAveragePricesThread (523): blue.pyos.synchro.SleepWallclock(2000), before the cfg's one asking for its prices. */
const AVERAGE_PRICES_AFTER_MS = 2000;
/** inventorycommon.typeHelpers.GetAveragePrice (103): the one type whose average price is the client's own to say, and what it says. */
const TYPE_WITH_ITS_OWN_AVERAGE = 79785;
const ITS_OWN_AVERAGE = 1000;
/**
 * The price table as it is kept: each type's average price and its adjusted price, by the type, out of
 * config.GetAverageMarketPrices' answer ({typeID: KeyVal(averagePrice, adjustedPrice)}). Null for an answer that
 * is no such dict. A price that is no number is none.
 */
function pricesByType(answered) {
  if (!answered || answered.type !== "dict" || !Array.isArray(answered.entries)) return null;
  const amount = (value) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "bigint" ? Number(value) : null);
  const prices = new Map();
  for (const [typeID, row] of answered.entries) {
    const type = positive(typeID);
    if (type === null || !row) continue;
    prices.set(type, [amount(dictValue(row.args, "averagePrice")), amount(dictValue(row.args, "adjustedPrice"))]);
  }
  return prices;
}

/** A facility's own ID off its row (the facility manager's KeyVal), or null. */
const facilityIDOf = (row) => wholeOf(row && row.type === "object" && row.args ? dictValue(row.args, "facilityID") : undefined);
/** The facility of an ID among the region's as they are kept, or null. */
function facilityAmong(facilities, facilityID) {
  const id = wholeOf(facilityID);
  return id === null ? null : itemsOf(facilities).find((row) => facilityIDOf(row) === id) ?? null;
}
/** facilitySvc.GetFreshFacility (109): `self.facilities[facilityID].rigModifiers`, which is so where the facility's row lists any. */
function hasRigModifiers(row) {
  const rigs = row && row.type === "object" && row.args ? dictValue(row.args, "rigModifiers") : null;
  return Boolean(rigs) && (itemsOf(rigs).length > 0 || (Array.isArray(rigs.entries) && rigs.entries.length > 0));
}
/**
 * The region's facilities with the facility of an ID taken out and `row`, where there is one, put among them by
 * its own ID: the client keeps its facilities by their IDs (facilities.pop, 44 and 102; _PrimeFacility, 141). The
 * list kept is left as it was.
 */
function withFacility(facilities, facilityID, row = null) {
  const out = new Set([wholeOf(facilityID), row ? facilityIDOf(row) : null].filter((id) => id !== null));
  const others = itemsOf(facilities).filter((each) => !out.has(facilityIDOf(each)));
  const all = row ? [...others, row] : others;
  return Array.isArray(facilities) ? all : { ...facilities, items: all };
}
/**
 * By what a job is the one a window made: its blueprint, its work and its facility (industryWnd._OnBlueprintSelected
 * makes another for another blueprint or other work, 139 to 152). Null where one of them is not said.
 */
const jobMadeAs = (blueprintID, activityID, facilityID) => {
  const ids = [positive(blueprintID), positive(activityID), positive(facilityID)];
  return ids.includes(null) ? null : ids.join(":");
};
/**
 * By what a job is the one monitored: what it was made as, and the place it takes from (the monitor is opened
 * when the job is given one, and again when it is given another: on_input_location, industrySvc.CreateJob 106).
 * `job` is a job as a route holds it; null for anything else.
 */
const jobMonitoredAs = (job) => {
  if (!job || typeof job !== "object" || Array.isArray(job) || job.type !== undefined) return null;
  const made = jobMadeAs(job.blueprintID, job.activityID, job.facilityID);
  const place = job.inputLocation;
  return made === null ? null : `${made}:${place ? `${positive(place.itemID)}:${positive(place.flagID)}` : "nowhere"}`;
};
/** The facility a job's row names, as the server answers a job (industryCommon.JobData reads data.facilityID), or null. */
const rowsFacility = (row) => positive(row && row.type === "object" && row.args ? dictValue(row.args, "facilityID") : null);
/** The blueprint a job names, as a route holds the job (a plain object) or as the client's dict has it. */
const jobsBlueprint = (job) => (job && job.type === "dict" ? dictValue(job, "blueprintID") : job && job.blueprintID);
/** The facility a job names, as a route holds the job (a plain object) or as the client's dict has it. */
const jobsFacility = (job) => positive(job && job.type === "dict" ? dictValue(job, "facilityID") : job && job.facilityID);

/**
 * bookmarkSvc.RemoveExpiredBookmarks (186 to 192): the three lists less the bookmarks whose time has run out by the
 * clock (`if bookmark.expiry and bookmark.expiry < now`). A row whose time cannot be read is left. The lists
 * themselves are left as they were answered: where a bookmark is taken out, what is handed on is another three.
 */
function withoutExpiredBookmarks(answered, nowMs) {
  const now = BigInt(Math.trunc(nowMs)) * 10000n + FILETIME_OF_UNIX_EPOCH;
  const [folders, bookmarks, subfolders] = answered;
  const rows = itemsOf(bookmarks);
  const live = rows.filter((row) => {
    const expiry = wholeOf(row && row.type === "object" && row.args ? dictValue(row.args, "expiry") : undefined);
    return expiry === null || expiry === 0n || expiry >= now;
  });
  return live.length === rows.length ? answered : [folders, Array.isArray(bookmarks) ? live : { ...bookmarks, items: live }, subfolders];
}

/**
 * One line of a Rowset off the wire (header, lines), by the whole number one column has: its values by the
 * columns' names, each as it came. Null where it is no Rowset with that column, or no line has that number.
 */
function rowsetLine(rowset, column, wanted) {
  const entries = rowset && rowset.type === "object" && rowset.args && Array.isArray(rowset.args.entries) ? rowset.args.entries : [];
  const part = (name) => (entries.find((entry) => Array.isArray(entry) && textOf(entry[0]) === name) ?? [])[1];
  const header = itemsOf(part("header")).map(textOf);
  const at = header.indexOf(column);
  const number = wholeOf(wanted);
  if (at === -1 || number === null) return null;
  const line = itemsOf(part("lines")).map(itemsOf).find((values) => wholeOf(values[at]) === number);
  return line ? Object.fromEntries(header.map((name, index) => [name, line[index]])) : null;
}
/** The dogma location's calls that lock and unlock: a write each, and no container's contents are changed by one. */
const TARGETING = new Set(["AddTarget", "CancelAddTarget", "RemoveTarget", "RemoveTargets", "ClearTargets"]);
/**
 * Whether one of the pilot's own calls may have changed what a container holds: any the BFF counts as a write
 * (bridgeCallPolicy.js), but for an order to the ship's engines and a lock, which move no item.
 */
const mayChangeContents = (service, method) => isBridgeWritePair(service, method) && service !== "beyonce" && !(service === "dogmaIM" && TARGETING.has(method));
/** What a listing is kept as: the handle, and what was asked as it is sent, which says which of the two it is (flag=, or flags=). */
const listingKeptAs = (boundHandle, form) => `${boundHandle}|${JSON.stringify([form.args, form.kwargs], (key, value) => (typeof value === "bigint" ? String(value) : value))}`;
/** The dogma location's two reads the client's target service keeps the answers of, by what each is kept as (pilotTargets.js). */
const TARGETS_KEPT = Object.freeze({ GetTargets: TARGETS, GetTargeters: TARGETERS });
/** calendar.FetchNextEvents: the month of a time and the month after it, each as [month, year], December's next being January's (GetBrowsedMonth). */
function monthAndNext(ms) {
  const now = new Date(ms);
  const [month, year] = [now.getUTCMonth() + 1, now.getUTCFullYear()];
  return [[month, year], month === 12 ? [1, year + 1] : [month + 1, year]];
}
/** The name the BFF asks the skill handler's reads by. What they are bound by is what the handler's own moniker says. */
const SKILL_HANDLER = "skillHandler";
/**
 * The handler's reads the client's skill services keep the answers of, by what each is kept as (pilotSkills.js):
 * asked for when first wanted, and from then on answered from what is kept (skillsvc.GetSkills,
 * GetSkillsIncludingLapsed, GetBoosters, GetImplants, GetCharacterAttributes, GetSkillHistory, GetFreeSkillPoints,
 * GetRespecInfo).
 */
const SKILL_KEPT = Object.freeze({
  GetSkills: "skills",
  GetAllSkills: "allSkills",
  GetBoosters: "boosters",
  GetImplants: "implants",
  GetAttributes: "attributes",
  GetSkillHistory: "history",
  GetFreeSkillPoints: "freeSkillPoints",
  GetRespecInfo: "respecInfo",
});
/**
 * What a real client asked of its skill handler when its character was chosen, in the order it asked this server
 * (the server's log of 2026-10-06, where the first went with the bind): the skill service's own list, the boosters,
 * the queue (skillQueueSvc.PrimeSkillQueue), the list with the lapsed, and the notifications' two
 * (skillHistoryProvider.py: CheckAndSendNotifications(), then GetSkillHistory(10), which is what the skill service
 * then has kept as the history). Tranquility's recording of a login has the same six, the boosters with the bind,
 * and after them the boosters again, the implants and the attributes (GetCharacterAttributes), which neither log
 * of a real client on this server has at login: here those three are asked when something first wants them.
 */
const SKILL_LOGIN_READS = Object.freeze([
  ["GetSkills", []],
  ["GetBoosters", []],
  ["GetSkillQueueAndFreePoints", []],
  ["GetAllSkills", []],
  ["CheckAndSendNotifications", []],
  ["GetSkillHistory", [10]],
]);
/**
 * The client's home station service (homestation/client/service.py): it asks the server's for the home station
 * once and keeps it, until one of its notices says otherwise or the pilot's corporation changes.
 */
const HOME_STATION = "home_station";
const GET_HOME_STATION = "get_home_station";
/** OnHomeStationChanged(newHomeStationID) and OnHomeStationMovedFromStructure(): the station kept is not the home any more. */
const HOME_STATION_NOTICES = new Set(["OnHomeStationChanged", "OnHomeStationMovedFromStructure"]);
/** skillQueueSvc.PrimeSkillQueue's read: (the queue, the free points). The queue service keeps the queue. */
const SKILL_QUEUE_READ = "GetSkillQueueAndFreePoints";
/** Whether a call of the handler's is the queue service's own read, as it asks it: with nothing. */
const isSkillQueueRead = (method, args, kwargs) => method === SKILL_QUEUE_READ && args.length === 0 && kwargs === null;
const MONIKER_CLASS = "carbon.common.script.net.moniker.Moniker";

/**
 * A Moniker as it arrives in an answer: its state is (service, nodeID, bindParams, sessionCheck) (moniker.py
 * __getstate__). Null for anything else, or for one with no service or nothing to bind by.
 */
function monikerOf(value) {
  if (!value || textOf(value.name) !== MONIKER_CLASS || !Array.isArray(value.args)) return null;
  const [service, nodeID, params] = value.args;
  if (!textOf(service) || params === null || params === undefined) return null;
  return { service: textOf(service), nodeID: positive(nodeID), params };
}

/**
 * How long a call waits once the server has said its answer will be late. The
 * client waits a day for the player; the browser's request behind this call
 * does not, so past this the call fails as one the server never answered.
 */
const PROVISIONAL_WAIT_LIMIT_MS = 120_000;

/**
 * How long a question waits for the user. Shorter than the wait above, so
 * that a question nobody answers is closed, and the call behind it finished,
 * before whoever made that call gives up on it.
 */
const QUESTION_WAIT_MS = 110_000;
/** An account's own connection, with no character chosen, is closed this long after the last call on it. */
const ACCOUNT_IDLE_MS = 5_000;

/** A localisation label as the server sends one, (labelID, {parameters}), or plain text. */
function words(value) {
  if (Array.isArray(value)) {
    return { label: textOf(value[0]), parameters: wireToBridgeJson(value[1] ?? null), text: null };
  }
  return { label: null, parameters: null, text: textOf(value) };
}

const textOf = (value) => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value && typeof value === "object" && typeof value.value === "string") return value.value;
  return null;
};

/**
 * What this client's own services answer when the server calls them, or
 * undefined for a call it has no answer to. The server makes these calls and
 * waits; on the retail client most of them put a window in front of the player.
 *
 *   agents.YesNo(title, body, agentID, contentID, suppressID)
 *       ui/station/agents/agents.py 404: a Yes/No window, answered with whether
 *       Yes was pressed. The server asks it before a mission is quit or
 *       declined and before research is cancelled. The question goes to the
 *       user (`askUser`), and anything but Yes is No, as closing the window is.
 *       With nobody to ask it is answered Yes: a hosted bot pressed the button,
 *       and the client answers the same way at once, with no window, when the
 *       player has ticked "do not show this again" (prompt_player's suppress_id).
 *   agents.SingleChoiceBox(title, body, choices, agentID, contentID, suppressID)
 *       agents.py 437: a box of radio buttons with OK and Cancel, which a
 *       research agent raises to ask what to research. Answers (OK pressed,
 *       the selected button's name), the name being "radioboxOption<n>Selected"
 *       counted from 1 (radioButtonMessageBox.py 48), on Cancel too. Dismissed
 *       when there is nobody to ask: the first button, and not OK.
 *   agents.GetQuantity(**keywords)
 *       agents.py 469: uix.QtyPopup(maxvalue, minvalue, setvalue, hint, caption,
 *       label, digits), a number box with OK and Cancel, raised to ask how many
 *       datacores to buy. Answers the number, or None on Cancel.
 *   XmppChat.AskYesNoQuestion(question, props, defaultChoice=1)
 *       xmppchatsvc.py 1745: a Yes/No dialog by message ID, which customs
 *       raises over contraband. Answers whether Yes was pressed. The server
 *       gives it a short time and then decides for itself, which is what it
 *       does when a player is not there; so with nobody to ask, and when the
 *       user does not answer in time, this is left unanswered.
 *   objectCaching.InvalidateCachedMethodCall(service, method, *args)
 *       carbon/common/script/net/objectCaching.py 222: forget a method's cached
 *       answer, so the next call asks the server. Nothing is kept here to
 *       forget (every call is sent), and the method returns None.
 *
 * `askUser(question)` puts a question to whoever is watching this pilot and
 * resolves with {asked, answer}: asked is false when nobody is watching, and
 * answer is undefined when the question was shown and not answered in time.
 */
function defaultClientCallAnswer({ service, method, args, kwargs }, characterID, askUser = async () => ({ asked: false })) {
  const list = itemsOf(args);
  switch (`${service}.${method}`) {
    case "agents.YesNo":
      return askUser({
        kind: "yesNo",
        title: words(list[0]),
        body: words(list[1]),
        agentID: positive(list[2]),
        contentID: positive(list[3]),
        suppressID: textOf(list[4]),
      }).then((reply) => (reply.asked ? reply.answer === true : true));
    case "agents.SingleChoiceBox":
      return askUser({
        kind: "choice",
        title: words(list[0]),
        body: words(list[1]),
        choices: itemsOf(list[2]).map(words),
        agentID: positive(list[3]),
        contentID: positive(list[4]),
        suppressID: textOf(list[5]),
      }).then((reply) => {
        const given = reply.asked && reply.answer ? reply.answer : { confirmed: false, index: 0 };
        return [given.confirmed === true, `radioboxOption${given.index + 1}Selected`];
      });
    case "agents.GetQuantity": {
      const keyword = (name) => dictValue(kwargs, name);
      return askUser({
        kind: "quantity",
        title: words(keyword("caption") ?? null),
        body: words(keyword("label") ?? null),
        agentID: null,
        contentID: null,
        suppressID: null,
        quantity: {
          min: finite(keyword("minvalue")) ?? 0,
          max: finite(keyword("maxvalue")),
          initial: finite(keyword("setvalue")),
          digits: finite(keyword("digits")) ?? 0,
        },
      }).then((reply) => (reply.asked && typeof reply.answer === "number" ? reply.answer : null));
    }
    case "XmppChat.AskYesNoQuestion": {
      // A dialog by its name with its parameters, where an agent's question has a label with its. The
      // dialog's title and body are both the client's (its dialog table, by that name), filled from the same
      // parameters. The name stays as the body's label for a page with no client's words to go by.
      const dialog = textOf(list[0]);
      const parameters = wireToBridgeJson(list[1] ?? null);
      return askUser({
        kind: "yesNo",
        title: { label: null, dialog, part: "title", parameters, text: null },
        body: { label: dialog, dialog, part: "body", parameters, text: null },
        agentID: null,
        contentID: null,
        suppressID: null,
      }).then((reply) => (reply.asked && typeof reply.answer === "boolean" ? reply.answer : undefined));
    }
    case "objectCaching.InvalidateCachedMethodCall":
    case "objectCaching.InvalidateCachedMethodCalls":
      return null;
    default:
      return undefined;
  }
}

/** The items of a decoded list or tuple, or none. */
const itemsOf = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);

/** A keyword by name from a decoded dict, or undefined. */
function dictValue(dict, name) {
  const entries = dict && dict.type === "dict" && Array.isArray(dict.entries) ? dict.entries : [];
  const found = entries.find(([key]) => textOf(key) === name);
  return found ? found[1] : undefined;
}

/** A number the wire or the JSON carried, or null. */
const finite = (value) => {
  const number = typeof value === "number" || typeof value === "bigint" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};

/** Whether an answer is one the question can take: what its window on the retail client could give. */
function answerFits(question, answer) {
  switch (question.kind) {
    case "yesNo":
      return typeof answer === "boolean";
    case "choice":
      return Boolean(answer) && typeof answer === "object" && typeof answer.confirmed === "boolean" &&
        Number.isSafeInteger(answer.index) && answer.index >= 0 && answer.index < question.choices.length;
    case "quantity": {
      // Cancel is None. Otherwise a number the box's field would have let through (intonly / floatonly, min to max).
      if (answer === null) return true;
      const { min, max, digits } = question.quantity;
      return typeof answer === "number" && Number.isFinite(answer) && (digits > 0 || Number.isInteger(answer)) &&
        answer >= min && (max === null || answer <= max);
    }
    default:
      return false;
  }
}

/** The kind of a dogma effect, from the static data the BFF already reads. Loaded when first asked. */
function defaultEffectCategory(effectID) {
  // eslint-disable-next-line global-require
  const effect = require("../staticData").getEffect(effectID);
  return effect && Number.isInteger(effect.effectCategoryID) ? effect.effectCategoryID : null;
}

/** A type's dogma attribute and its group, from the same static data (godma.GetTypeAttribute, evetypes.GetGroupID). */
function defaultTypeAttribute(typeID, attributeID) {
  // eslint-disable-next-line global-require
  return require("../staticData").getTypeDogmaAttribute(typeID, attributeID);
}
/** A type's dogma effects, each as the static data has it: { effectID, name, effectCategoryID, durationAttributeID, ... }. */
function defaultTypeEffects(typeID) {
  // eslint-disable-next-line global-require
  const staticData = require("../staticData");
  const dogma = staticData.getTypeDogma(typeID);
  return (dogma && Array.isArray(dogma.effects) ? dogma.effects : []).map((effectID) => staticData.getEffect(effectID)).filter(Boolean);
}
/** const.attributeDisallowRepeatingActivation: a module that is set off once each time. */
const ATTRIBUTE_DISALLOW_REPEATING = 1014;
/** A type's name and its group's, as the static data has them: what the client knows of a type without asking. */
function defaultTypeNames(typeID) {
  // eslint-disable-next-line global-require
  const type = require("../staticData").getType(typeID);
  return type ? { name: String(type.name ?? ""), groupName: String(type.groupName ?? "") } : null;
}
/** A type's { basePrice, portionSize } from the game's static data; null for a type it has not. */
function defaultTypeBasePrice(typeID) {
  // eslint-disable-next-line global-require
  const type = require("../staticData").getType(typeID);
  return type ? { basePrice: Number(type.basePrice) || 0, portionSize: Number(type.portionSize) || 1 } : null;
}

/** A station's { ownerID, factionID } from the game's static data; null for what is no station there. */
function defaultStationOwner(stationID) {
  // eslint-disable-next-line global-require
  const staticData = require("../staticData");
  const station = staticData.getStation(stationID);
  const ownerID = station ? positive(station.corporationID) : null;
  if (ownerID === null) return null;
  const corporation = staticData.getCorporation(ownerID);
  return { ownerID, factionID: corporation ? positive(corporation.factionID) : null };
}

function defaultTypeGroup(typeID) {
  // eslint-disable-next-line global-require
  const type = require("../staticData").getType(typeID);
  return type && Number.isInteger(type.groupID) ? type.groupID : null;
}

/** A positive whole number, however the wire or the JSON spelled it; else null. */
const positive = (value) => {
  const number = typeof value === "number" || typeof value === "bigint" ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
/** idCheckers.IsStation: a station by its number alone (minStation to maxStation). */
const isStation = (itemID) => itemID >= 60000000 && itemID <= 63999999;

/** JSON arguments as the BFF sends them, into what the client's marshaller takes. */
function argumentsToWire(value) {
  if (Array.isArray(value)) return value.map(argumentsToWire);
  if (value === null || typeof value !== "object") return value;
  switch (value.type) {
    case "Buffer":
      return Buffer.from(Array.isArray(value.data) ? value.data : []);
    case "bytes":
      return argumentsToWire(value.value);
    case "tuple":
    case "list":
      return { ...value, items: (value.items ?? []).map(argumentsToWire) };
    case "dict":
      return { ...value, entries: (value.entries ?? []).map(([key, entry]) => [argumentsToWire(key), argumentsToWire(entry)]) };
    case "object":
      return { ...value, args: argumentsToWire(value.args) };
    default:
      return value;
  }
}

/**
 * The "N=node:id" of the first bound object in an answer, or null. A bound
 * object arrives as a substruct holding a substream of (id, timestamp), alone
 * or inside the (object, result) pair a bind answers with.
 */
function boundObjectID(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object" || Buffer.isBuffer(value)) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = boundObjectID(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value.type === "substruct" && value.value) {
    const pair = value.value.type === "substream" ? value.value.value : value.value;
    const id = Array.isArray(pair) ? pair[0] : null;
    const name = Buffer.isBuffer(id) ? id.toString("utf8") : typeof id === "string" ? id : "";
    if (name.startsWith("N=")) return name;
  }
  for (const inner of [value.value, value.items, value.args]) {
    const found = boundObjectID(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

/** One field of a util.KeyVal, in bridge JSON. */
function keyValField(row, name) {
  const entries = row && row.type === "object" && row.args && Array.isArray(row.args.entries) ? row.args.entries : [];
  const entry = entries.find((candidate) => Array.isArray(candidate) && candidate[0] === name);
  return entry ? entry[1] : undefined;
}

/** A character's row in GetCharacterSelectionData's answer (userDetails, training, characters, wars), or null. */
function selectionRow(selection, characterID) {
  const characters = Array.isArray(selection) ? selection[2] : null;
  const rows = characters && characters.type === "list" && Array.isArray(characters.items) ? characters.items : [];
  return rows.find((row) => positive(keyValField(row, "characterID")) === characterID) ?? null;
}

/**
 * The game-port transport.
 *
 *   connect()           -> a frame transport to the game server
 *   createSession(t)    -> a GamePortSession on it
 *   passwordFor(name)   -> the password to log in with (a development server takes any)
 *   isOnline(accountID, characterID) -> whether the server still has the character
 *                          in game; asked after a release so "released" means it
 *   allowed             -> the "service.method" pairs a pilot may call
 *   shape(service, method, args, kwargs) -> the call as the retail client sends it (retailCalls.js)
 */
function createGamePortPilots({
  endpoint = gameEndpoint(),
  connect = () => connectTcp(endpoint),
  createSession = (transport) => new GamePortSession({ transport, provisionalWaitLimitMs: PROVISIONAL_WAIT_LIMIT_MS }),
  passwordFor = () => "",
  isOnline = null,
  allowed = new Set([...contract.gatewayAllowlist.pairs, ...GAME_PORT_ONLY_CALLS]),
  shape = retailForm,
  selectSettleMs = 5000,
  releaseSettleMs = 5000,
  randomBytes = crypto.randomBytes,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // A pilot's ballpark while it is in space (pilotSpace.js).
  createSpace = (options) => createPilotSpace(options),
  onSpaceError = () => {},
  // What kind a dogma effect is, from the game's static data (dogma.data.get_effect on the retail client).
  effectCategory = defaultEffectCategory,
  // A type's dogma attribute and its group, for the scanner: a probe's range steps, and whether a launcher's charge is a probe.
  typeAttribute = defaultTypeAttribute,
  typeGroup = defaultTypeGroup,
  // A station's owner and that owner's faction, for the broker's fee: cfg.stations and get_corporation_faction_id on the retail client.
  stationOwner = defaultStationOwner,
  // A type's base price and portion size, for its average price where nothing has traded: evetypes on the retail client.
  typeBasePrice = defaultTypeBasePrice,
  typeNames = defaultTypeNames,
  // A type's dogma effects, for naming the one a module is switched on by and saying whether it repeats.
  typeEffects = defaultTypeEffects,
  // The client's own services, for the calls the server makes to it, and a word about each call once it is over.
  answerClientCall = defaultClientCallAnswer,
  onClientCall = () => {},
  // How long a question put to the user waits for an answer, and the timers that count it.
  questionWaitMs = QUESTION_WAIT_MS,
  timers = { setTimeout, clearTimeout },
  // How long after a login the client's cfg asks for its price table (averagePricesThread). Null for a transport
  // whose pilots ask for none.
  averagePricesAfterMs = AVERAGE_PRICES_AFTER_MS,
  // How long after its owner's wars were asked for the war service's thread asks for them again (warsThread). Null
  // for a transport whose pilots' wars are asked for again only when something wants them.
  warsAgainAfterMs = WARS_AGAIN_AFTER_MS,
  // How long an account's own connection is kept after the last thing asked on it.
  accountIdleMs = ACCOUNT_IDLE_MS,
} = {}) {
  const sessions = new Map();
  /** The accounts' own connections, by account, each with no character chosen on it. */
  const accountLines = new Map();
  const epoch = randomBytes(12).toString("base64url");
  /** Every call made, by pair and by how it compares with the retail client's (retailCalls.js). */
  const ledger = createCallLedger();
  const DOGMA_AS_GODMA_PRIMES = Object.freeze({ status: "same", source: "eve/client/script/environment/godma.py:2409", note: null });
  /** The server's clock (100 ns since 1601) for a reading of this machine's, in milliseconds. */
  const filetime = (ms) => (BigInt(Math.trunc(ms)) + 11644473600000n) * 10000n;
  /** standingsvc.__RefreshStandings: RemoteSvc('standingMgr').GetNPCNPCStandings(), no arguments. The web client never asks it. */
  const NPC_STANDINGS_AS_THE_CLIENT_ASKS = Object.freeze({ status: "same", source: "eve/client/script/ui/services/standingsvc.py:115", note: null });
  /** facilitySvc: self.facilityManager.GetFacility(facilityID), one facility by itself (46, 71 and 103), which no route of the BFF's may ask by name. */
  const A_FACILITY_AS_THE_CLIENT_ASKS = Object.freeze({ status: "same", source: "eve/client/script/industry/facilitySvc.py:71", note: null });
  /** eveCfg.GetAveragePricesThread: self.GetConfigSvc().GetAverageMarketPrices(), no arguments, which no route of the BFF's may ask by name. */
  const PRICES_AS_THE_CLIENT_ASKS = Object.freeze({ status: "same", source: "eve/common/script/sys/eveCfg.py:524", note: null });
  /** cfg.eveowners' priming: config.GetMultiOwnersEx(list(keysToGet)), which no route of the BFF's may ask by name. */
  const OWNERS_AS_THE_CLIENT_ASKS = Object.freeze({ status: "same", source: "carbon/common/script/sys/cfg.py:579", note: null });
  /**
   * agents.py __GetAllAgents: the whole table of agents, which every client asks its server for once and keeps for
   * as long as it runs. It is the same for every pilot and large (some eleven thousand rows), so here it is kept
   * once for them all, in the gateway's form: what the last pilot to ask was answered. Null until one has been.
   */
  let agentsTable = null;
  /** journal._UpdateMissionDataPartial: GetAgentMoniker(agentID).GetMyJournalDetails(), no arguments, on the agent's own moniker. */
  const AGENTS_OWN_JOURNAL = Object.freeze({ status: "same", source: "eve/client/script/ui/shared/neocom/journal.py:325", note: null });
  /** What the client asks of its skill handler of its own accord that the web client never asks, and where each is asked. */
  const SKILL_OWN = Object.freeze({
    CheckAndSendNotifications: Object.freeze({ status: "same", source: "notifications/client/development/skillHistoryProvider.py:26", note: null }),
    // CommitTransaction: skillHandler.SaveNewQueue(queueInfo, activate=activate). The web client's pair for it is skillMgr's, by name.
    SaveNewQueue: Object.freeze({ status: "same", source: "eve/client/script/ui/services/skillQueueSvc.py:153", note: null }),
  });
  /**
   * The refusals of a queue's saving after which the client's queue panel opens no new transaction, and so does
   * not ask for the queue again (skillQueuePanelNew.ApplySkillQueue).
   */
  const NO_NEW_QUEUE_TRANSACTION = new Set(["UserAlreadyHasSkillInTraining", "SkillInQueueRequiresOmegaCloneState"]);
  /** What the client's fleet service asks of its own accord that the web client never asks, and where each is asked. */
  const FLEET_OWN = Object.freeze({
    // CreateFleet: self.fleet.GetFleetID(), once the fleet it formed has been read.
    GetFleetID: Object.freeze({ status: "same", source: "eve/client/script/parklife/fleetSvc.py:338", note: null }),
    // OnFleetMove: self.fleet.FinishMove().
    FinishMove: Object.freeze({ status: "same", source: "eve/client/script/parklife/fleetSvc.py:1816", note: null }),
  });
  const BOUND_AS_THE_CLIENT_BINDS = Object.freeze({ status: "reshaped", source: "eve/common/script/net/eveMoniker.py, eve/client/script/environment/invCache.py", note: null });

  // ── errors ────────────────────────────────────────────────────────────────

  /** A failure of the session, in the gateway's terms. */
  function toPilotError(error, service, method) {
    if (error instanceof GamePortPilotError) return error;
    const code = error && error.code;
    const detail = String((error && error.message) || error).slice(0, 300);
    if (code === "GAME_CALL_REFUSED" && error.refusal && error.refusal.reason) {
      // What the server refused with, by name and with its values: the client acts on some of them
      // (ShipContrabandWarningUndock is a question, not a failure), and the words alone do not say which.
      return Object.assign(fail("CALL_REFUSED", String(error.refusal.reason)), {
        refusal: { key: String(error.refusal.key || ""), values: error.refusal.values ?? null },
      });
    }
    if (["CONNECTION_LOST", "CONNECTION_CLOSED", "TRANSPORT_CLOSED", "NOT_CONNECTED", "BAD_FRAME"].includes(code)) {
      return fail("SESSION_NOT_FOUND", SESSION_GONE);
    }
    if (code === "CALL_TIMEOUT" || code === "HANDSHAKE_TIMEOUT") {
      return fail("EVE_GATEWAY_TIMEOUT", "The game server did not answer in time.");
    }
    if (/^Cannot marshal/.test(detail)) {
      return fail("CALL_INVALID", `${service}.${method} was given an argument that cannot be sent: ${detail}`);
    }
    return fail("CALL_FAILED", `${service}.${method} failed: ${detail}`);
  }

  function assertAllowed(service, method) {
    // (Two names, as text: what would only spell a pair on the list is not on it.)
    if (typeof service !== "string" || typeof method !== "string" || !allowed.has(`${service}.${method}`)) {
      throw fail("CALL_NOT_ALLOWED", `${service}.${method} is not on the web-call allowlist.`);
    }
  }

  // ── what the server pushes ────────────────────────────────────────────────

  // The retail client is told a thing once, on its one connection. Here a notification goes out twice: on
  // the pilot's stream as it arrives, and with the next answer, which is what a reader with no stream has.
  // So the copy kept for the answer names the stream frame it also went out in (its cursor), and a reader
  // that has both can tell they are one.
  function record(entry, notification) {
    if (SUPPRESSED_NOTIFICATIONS.has(notification.method)) return;
    const frame = publish(entry, { kind: "notification", notification });
    entry.backlog.push(Object.freeze({ ...notification, cursor: frame.cursor }));
    if (entry.backlog.length > BACKLOG_LIMIT) entry.backlog.splice(0, entry.backlog.length - BACKLOG_LIMIT);
  }

  /** One event on the pilot's stream, for whoever is listening now and whoever resumes from before it. */
  function publish(entry, event) {
    entry.sequence += 1;
    const frame = Object.freeze({
      source: STREAM_SOURCE,
      apiVersion: 1,
      streamVersion: 1,
      type: "event",
      cursor: Object.freeze({ epoch, sequence: entry.sequence }),
      event,
    });
    entry.history.push(frame);
    if (entry.history.length > STREAM_HISTORY_LIMIT) entry.history.shift();
    for (const subscriber of [...entry.subscribers]) deliver(subscriber, frame);
    return frame;
  }

  // ── what the server asks the user ─────────────────────────────────────────
  //
  // The retail client puts a window up and the server waits for it. Here the
  // question goes out on the pilot's stream, to the browser showing that pilot,
  // and the answer comes back by answerClientQuestion. A stream is only open
  // while a browser is attached, so "nobody is listening" is "nobody to ask".

  function askUser(entry, call, question) {
    if (entry.ended || ![...entry.subscribers].some((subscriber) => !subscriber.closed)) {
      return Promise.resolve({ asked: false, answer: undefined });
    }
    const id = randomBytes(9).toString("base64url");
    // No longer than the server itself will wait: an answer after that reaches nobody.
    const serverWaitMs = Number.isFinite(call.timeoutSeconds) && call.timeoutSeconds > 0 ? call.timeoutSeconds * 1000 : Infinity;
    const waitMs = Math.min(questionWaitMs, serverWaitMs);
    return new Promise((resolve) => {
      const asked = {
        id,
        question,
        timer: timers.setTimeout(() => asked.settle(undefined, "expired"), waitMs),
        settle(answer, reason) {
          if (!entry.questions.delete(id)) return;
          timers.clearTimeout(asked.timer);
          if (!entry.ended) publish(entry, { kind: "question-closed", id, reason });
          resolve({ asked: true, answer });
        },
      };
      entry.questions.set(id, asked);
      publish(entry, {
        kind: "question",
        question: { id, service: call.service, method: call.method, ...question, askedAtMs: now(), expiresAtMs: now() + waitMs },
      });
    });
  }

  /**
   * The pilot's own ship's attribute, as godma holds it: primed once with GetAllInfo, as the client primes it,
   * and kept right by the server's notices. The client reads a hold's capacity from here and never asks the
   * server for one (godma.py 871). Null for an attribute godma was not told of, or with godma not primed.
   */
  async function shipAttribute(attributeID, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    await shipReadings(entry, place);
    return entry.dogma.attribute(place.shipID, attributeID);
  }

  /**
   * The pilot's own ship and what type it is, as the session and godma hold them. The client's inventory tree
   * goes by the type to say which bays a ship has (treeData.py 300 to 363). The type is null where godma was
   * not told of the ship.
   */
  async function ship(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    await shipReadings(entry, place);
    return { shipID: place.shipID, typeID: entry.dogma.typeOf(place.shipID) };
  }

  /** One call the client makes of its own accord on the dogma location, in the client's form and in the ledger. */
  async function ownDogmaCall(entry, method, args) {
    const form = shape("dogmaIM", method, args, null, contextFor(entry));
    ledger.note("dogmaIM", method, form);
    return monikerCall(entry, "dogmaIM", method, argumentsToWire(form.args), form.kwargs);
  }

  /**
   * gameui._HandleSessionChangeInSpace (619 to 630): in another ship in the same space, one boarded there or the
   * capsule a pilot is left in when its ship is destroyed. The client asks its dogma location to let every lock go
   * (621: a thread of target.ClearTargets, which is GetDogmaLM().ClearTargets(), targetMgr.py 1419), and makes the
   * ship its ballpark's ego itself, now or when its ball comes. The server sends no state for it. Both of
   * Tranquility's recordings of such a change have the call, within a third of a second of the session's change.
   */
  function shipChangedInSpace(entry, shipID) {
    // A thread of its own in the client: nothing waits on its answer, and a refusal of it is nobody's to hear.
    ownDogmaCall(entry, "ClearTargets", []).catch(() => {});
    entry.space.park.egoIs(shipID);
  }

  /**
   * godma.UpdateItem, for a module the server says is in a slot of the ship the pilot is in: the client asks what
   * dogma has of it, ItemGetInfo(itemID), and holds the answer. With no answer the module is held as it was.
   */
  function askAbout(entry, item) {
    if (item.locationID !== attribute(entry, "shipid")) return;
    entry.itemWork = entry.itemWork.then(async () => {
      try {
        entry.dogma.updateItem(item.itemID, await ownDogmaCall(entry, "ItemGetInfo", [item.itemID]));
      } catch {
        // The client's item change carries on to its dogma location whatever came of this.
      }
    });
  }

  /**
   * clientDogmaLocation._OnlineModuleIfApplicable and OnlineModule: a module newly fitted to the ship the pilot is
   * in is put online by the client itself, where its type can be online at all. The effect is running from then
   * and the server is told, SetModuleOnline(the ship, the module). A server that has it online already says so
   * (EffectAlreadyActive2), and that is no failure; refused for any other reason, or not answered, the effect is
   * not running after all. It comes after godma's asking, as it does on the client.
   */
  function onlineIfApplicable(entry, item) {
    if (item.locationID !== attribute(entry, "shipid")) return;
    if (!typeEffects(item.typeID).some((effect) => effect.effectID === EFFECT_ONLINE)) return;
    entry.itemWork = entry.itemWork.then(async () => {
      entry.dogma.setEffect(item.itemID, EFFECT_ONLINE, true);
      try {
        await ownDogmaCall(entry, "SetModuleOnline", [item.locationID, item.itemID]);
      } catch (error) {
        if (!error.refusal || error.refusal.key !== "EffectAlreadyActive2") entry.dogma.setEffect(item.itemID, EFFECT_ONLINE, false);
      }
    });
  }

  /**
   * The fleet the pilot is in, as the session says: session.fleetid, which the server sets with a session change
   * and the client's fleet service goes by for everything it asks of a fleet (fleetSvc.py). Null in none. And
   * whether the fleet's own object is held, as that service holds one in self.fleet: what CreateFleet answered, or
   * the Moniker that accepted an invite. It leaves by that object where it has it (LeaveFleet, 365).
   */
  function fleet(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    return { fleetID: attribute(entry, "fleetid"), holdsObject: entry.fleet !== null };
  }

  /**
   * The pilot's own ship as dogma has it, without asking: the ship's row from godma's priming, with its
   * attributes as godma holds them now, and the modules fitted in it that are online. It is what the server
   * answers to ShipGetInfo and ShipOnlineModules, which the client never asks (godma.py 2409, 697). The row
   * is null where godma is not primed for the ship where it is.
   */
  async function shipInfo(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    await shipReadings(entry, place);
    // A module just fitted is as the server has answered of it, once it has.
    await entry.itemWork;
    // Only the row godma was primed with for this ship where it is now: never an earlier ship's, or this one's from
    // somewhere it has left, when the priming for here did not come.
    const kept = entry.dogmaLoaded === primedFor(entry, place) ? entry.shipRow : null;
    if (!kept) return { shipID: place.shipID, row: null, online: [] };
    const now = { type: "dict", entries: entry.dogma.attributesOf(place.shipID) };
    const entries = kept.args.entries.map(([name, value]) => [name, name === "attributes" ? now : value]);
    return { shipID: place.shipID, row: { ...kept, args: { ...kept.args, entries } }, online: entry.dogma.onlineModules(place.shipID).map(([, moduleID]) => moduleID) };
  }

  /** The user's answer to a question the server asked. */
  async function answerClientQuestion(bridgeSessionID, questionID, answer, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const asked = entry.questions.get(String(questionID || ""));
    if (!asked) throw fail("QUESTION_NOT_FOUND", "That question is no longer open.");
    if (!answerFits(asked.question, answer)) throw fail("CALL_INVALID", "That is not an answer this question takes.");
    asked.settle(answer, "answered");
    return { answered: true, questionID: asked.id };
  }

  function deliver(subscriber, frame) {
    if (subscriber.closed) return;
    try {
      subscriber.onFrame(frame);
    } catch {
      // A listener's failure is its own; the session and the other listeners carry on.
    }
  }

  const drain = (entry) => entry.backlog.splice(0);

  // ── sessions ──────────────────────────────────────────────────────────────

  /** The live session a handle names, or SESSION_NOT_FOUND. */
  function held(handle, sessionFields) {
    const entry = sessions.get(String(handle || ""));
    const asked = sessionFields && sessionFields.userid !== undefined ? Number(sessionFields.userid) : undefined;
    if (!entry || entry.ended || (asked !== undefined && asked !== entry.accountID)) {
      throw fail("SESSION_NOT_FOUND", SESSION_GONE);
    }
    return entry;
  }

  /** The session is over: forget it, close it, and tell whoever is listening. */
  function end(entry, reason, refusalStatus = 404) {
    if (entry.ended) return;
    entry.ended = true;
    // Nobody is left to answer: each question closes unanswered, as its window would with the client.
    for (const asked of [...entry.questions.values()]) asked.settle(undefined, "session_ended");
    if (entry.space) entry.space.release();
    entry.space = null;
    averagePricesThreadEnded(entry);
    warsThreadEnded(entry);
    sessions.delete(entry.handle);
    entry.session.close();
    for (const subscriber of [...entry.subscribers]) {
      entry.subscribers.delete(subscriber);
      if (subscriber.closed) continue;
      subscriber.closed = true;
      try {
        subscriber.onClose({ code: 0, reason, refusalStatus });
      } catch {
        // As above.
      }
    }
  }

  /** Run one request on a session, with its failures in the gateway's terms. */
  async function run(entry, service, method, request) {
    try {
      return await request();
    } catch (error) {
      const mapped = toPilotError(error, service, method);
      if (mapped.code === "SESSION_NOT_FOUND") end(entry, "connection_closed");
      throw mapped;
    }
  }

  const attribute = (entry, name) => positive(entry.session.attributes[name]);

  // ── the nine ──────────────────────────────────────────────────────────────

  async function selectCharacter(args = [], kwargs = null, sessionFields = {}) {
    const accountID = positive(sessionFields && sessionFields.userid);
    const userName = String((sessionFields && sessionFields.userName) || "").trim();
    const characterID = positive(Array.isArray(args) ? args[0] : null);
    if (accountID === null) throw fail("CALL_INVALID", "Call session requires a positive integer userid.");
    if (!userName) throw fail("CALL_INVALID", "A game-port login needs the account's name.");
    if (characterID === null) throw fail("CALL_INVALID", "SelectCharacterID needs a character.");

    let transport;
    try {
      transport = await connect();
    } catch {
      throw fail("EVE_GATEWAY_UNREACHABLE", "The game server is unreachable.");
    }
    const session = createSession(transport);
    const clock = createPilotClock({ now });
    const entry = {
      handle: `${GAME_PORT_HANDLE_PREFIX}${randomBytes(24).toString("base64url")}`,
      session,
      accountID,
      userName,
      characterID,
      backlog: [],
      sequence: 0,
      history: [],
      subscribers: new Set(),
      ship: null,
      /** boundHandle -> { objectID, service }: what the BFF holds, and what it names here. */
      bound: new Map(),
      /** fleetSvc's self.fleet: the one object the client keeps for the pilot's fleet, as it is held in `bound`; null with none. */
      fleet: null,
      /** The two inventory managers invCache keeps, by which: the "N=..." of each. */
      inventoryManagers: new Map(),
      /** The monikers the client keeps for where the pilot is, by service: the "N=..." each is bound to (monikerCall). */
      monikers: new Map(),
      /** The binds under way, by what is being bound: a Moniker binds once, and a call that finds it binding waits. */
      binding: new Map(),
      /** skillsvc's skillHandler: the moniker skillMgr2 answered, once asked for; a promise of { service, nodeID, params }. */
      skillHandler: null,
      /** The pilot's sim clock (pilotClock.js): what its park steps by and its dogma measures in. */
      clock,
      /** The pilot's ballpark while it is in space (pilotSpace.js), else null. */
      space: null,
      /** The pilot's ship as dogma has it (pilotDogma.js), and which ship and place that was loaded for. */
      dogma: createPilotDogma({
        characterID,
        now: () => filetime(clock.simTime()),
        effectCategory,
        onSlotted: (item) => askAbout(entry, item),
        onFitted: (item) => onlineIfApplicable(entry, item),
      }),
      dogmaLoaded: null,
      /** What the client does of its own accord for an item the server says has moved, one call after another: over when each is answered. */
      itemWork: Promise.resolve(),
      /** The pilot's scan probes as the client's scan service knows them (pilotScanner.js). */
      scanner: createPilotScanner({ typeAttribute }),
      /** The pilot's fleet as the client's fleet service keeps it (pilotFleet.js): read once, kept right by the server's notices. */
      fleetKept: createPilotFleet({ characterID }),
      /** What the client asks of a fleet of its own accord, one thing after another: over when each is answered. */
      fleetWork: Promise.resolve(),
      /** The pilot's standings as the client's standing service keeps them (pilotStandings.js), and the reading of them that is under way. */
      standings: createPilotStandings({ characterID, corporationID: () => attribute(entry, "corpid") }),
      standingsWork: Promise.resolve(),
      /** The pilot's skills as the client's skill services keep them (pilotSkills.js), and what is being asked for them, one thing after another. */
      skills: createPilotSkills(),
      skillsWork: Promise.resolve(),
      /** The character's name, as the selection screen's row had it. */
      characterName: "",
      /** The pilot's agents' journal as the client's journal service keeps it (pilotJournal.js), and the readings of it, one after another. */
      journal: createPilotJournal(),
      journalWork: Promise.resolve(),
      /** The askings after each accepted mission, one after another (missionInfoAsked). */
      missionInfoWork: Promise.resolve(),
      /** The askings of the ship's free turret slots, one after another (turretSlotsAsked), and whether one is owed: the ship changed, and godma has not been primed since. */
      turretSlotsWork: Promise.resolve(),
      turretSlotsOwed: false,
      /** The facilities asked for by themselves at the server's word or a job's refusal, one after another (facilitiesAskedAfresh). */
      facilitiesWork: Promise.resolve(),
      /** facilitySvc.GetFacilityLocations's own keeping: a facility's places for an owner, by the two, each with when it was answered. */
      facilityPlaces: new Map(),
      /** marketsvc.GetMarketTaxAtStructure's own keeping: a structure's market tax for the pilot, by the structure, each with when it was answered. */
      marketTaxes: new Map(),
      /**
       * The job the Industry window has, as the client's industry service has the one it monitors
       * (industrySvc.monitoring, a weak reference to the window's job): null where the window has none, what its
       * monitor was opened as and answered while it is the one monitored, and A_JOB_INSTALLED once it was installed.
       */
      windowJob: null,
      /** What the job the window made was made as (jobMadeAs): it was given its facility afresh then, and is not again. */
      jobMade: null,
      /** cfg._averageMarketPrice: the price table, by type, once the cfg's one asking for it is answered; null until then, and where it could not be asked. */
      averagePrices: null,
      /** The timer of the cfg's thread that asks for it, while it has not gone off. */
      averagePricesTimer: null,
      /** agents.agentMonikers: the one object the client keeps for an agent, by agent, each as it is held in `bound`. */
      agents: new Map(),
      /** agents.allAgents: this pilot's own asking for the table of agents, once it has asked; over when it is answered. */
      agentsAsked: null,
      /** cfg.eveowners: each owner the server has been asked about, as { name, typeID }, or null for one it had no row for; and the askings, one after another. */
      owners: new Map(),
      ownersWork: Promise.resolve(),
      /** What the client's services keep until it changes, as the server answered it, by the service asked (KEPT_UNTIL_CHANGED). */
      kept: Object.fromEntries(Object.keys(KEPT_UNTIL_CHANGED).map((service) => [service, createKeptReads()])),
      /** The two reads of a planet's own object that are kept by the planet, each as { at, answer } (planetRead). */
      planetReads: new Map(),
      /** The station the pilot is docked in, as the client's station service keeps it; and its askings, one after another. */
      station: createPilotStation(),
      /** The guests of the structure the pilot is docked in, as the client's structure guests service keeps them; and their askings, one after another. */
      structureGuests: createPilotStructureGuests(),
      structureGuestsWork: Promise.resolve(),
      /** The corporations with offices where the pilot is docked, as the station's office object answered (STATION_OFFICES). */
      stationOffices: createKeptReads(),
      /** crimewatchSvc's client states as last answered (CLIENT_STATES), and the pilot's security status (mySecurityStatus): undefined while none is had. */
      clientStates: createKeptReads(),
      securityStatus: undefined,
      /** crimewatchSvc.jumpTimers: the jump activation's end, the jump fatigue's end and when they were last reckoned, as last answered or told: undefined while none is had. */
      jumpTimers: undefined,
      /**
       * The war service's wars as it keeps them (pilotWars.js); the owner its moniker was made for
       * (war_cso.__warMonikerOwnerID); its askings, one after another; and its thread's timer.
       */
      wars: createPilotWars(),
      warMonikerOwner: null,
      warsWork: Promise.resolve(),
      warsTimer: null,
      /**
       * fwWarzoneSvc._localOccupationSystemAndState: the solar system and its occupation state as the server last
       * answered or told them, (system, state), undefined while none is had; and its askings, one after another.
       */
      localOccupation: undefined,
      localOccupationWork: Promise.resolve(),
      /**
       * dynamicResourceSvc's kept bounty output of the system the session is in: { answer, until }, undefined while
       * none is kept; how many times it was let go; and its askings, one after another.
       */
      bountyOutput: undefined,
      bountyOutputLetGo: 0,
      bountyOutputWork: Promise.resolve(),
      /**
       * securitySvc.modified_security_levels: what the server answered of the solar systems whose security is other
       * than the map's, as it came (undefined while it was not asked), and each system's level as the server has
       * said it since.
       */
      modifiedSystems: undefined,
      modifiedSecurity: new Map(),
      /** characterSettingsSvc._settings: the character's settings as the server answered them, undefined while they were not asked; and their askings, one after another. */
      characterSettings: undefined,
      characterSettingsWork: Promise.resolve(),
      /** The account's clone grade as the server last said it (clonegrade/const.py: 0 alpha, 1 omega): undefined while none is had. */
      cloneGrade: undefined,
      /** Whether the office's item was primed on the Moniker for where the pilot is docked (PRIME_OFFICE): its answer, kept while docked there. */
      officePrimed: createKeptReads(),
      /** The account service's static data (ACCOUNT_STATIC), kept for as long as the character is. */
      accountStatic: createKeptReads(),
      /** The home station as the client's home station service keeps it (GET_HOME_STATION). */
      homeStation: createKeptReads(),
      /**
       * The selection screen's data as the server answered it at the choosing, in the form a call's answer has:
       * the client's character service keeps it for as long as the character is on (ccSvc.py 39 to 43, let go at
       * on_character_log_off). Null until a character has been chosen, which every pilot held here has been.
       */
      selection: null,
      /** godma's priming that is out now, and the ship in a place it is for: whoever wants the ship's readings meanwhile waits for it. */
      dogmaPriming: null,
      stationWork: Promise.resolve(),
      /** What each container bound for the BFF lists, as the server answered, until something may have changed it (INVENTORY_LISTINGS). */
      listings: createKeptReads(),
      /** marketQuote.GetAveragePrice for the items of the sale being made, by type (saleAveragesRead). */
      saleAverages: new Map(),
      /** beyonce.GetFormations as the server answered it, or the asking of it under way; null before it is asked (formationsKnown). */
      formations: null,
      /** The pilot's last order to its ship in this ballpark, as { method, targetID, range }, or null (alreadyFollowing). */
      lastMove: null,
      /** What the ship has locked and what has it locked, as the client's target service keeps them (pilotTargets.js); the askings of them, one after another; and whether godma has yet to ask for them. */
      targets: createPilotTargets(),
      targetsWork: Promise.resolve(),
      targetsOwed: false,
      /** crimewatchSvc.corpAggressionSettings: the corporation's aggression settings as last answered or told, or null; and the askings of them, one after another. */
      aggression: null,
      corpWork: Promise.resolve(),
      /** Questions the server has asked and the user has not answered yet, by ID. */
      questions: new Map(),
      ended: false,
    };
    session.clientCalls = (call) => answerClientCall(call, characterID, (question) => askUser(entry, call, question));
    session.onClientCall((call) => onClientCall(call, characterID));
    session.onNotification((notification) => {
      // machoNet.OnMachoObjectDisconnect(objectID, clientID, refID): the server has let a bound object go.
      if (notification.method === "OnMachoObjectDisconnect" && Array.isArray(notification.args)) {
        const gone = notification.args[0];
        forgetObject(entry, Buffer.isBuffer(gone) ? gone.toString("utf8") : String(gone));
      }
      entry.clock.feed(notification);
      if (entry.space) entry.space.feed(notification);
      entry.dogma.feed(notification);
      entry.scanner.feed(notification);
      afterFleetNotice(entry, entry.fleetKept.feed(notification));
      entry.standings.feed(notification);
      afterSkillNotice(entry, entry.skills.feed(notification));
      afterCorporationNotice(entry, notification);
      entry.targets.feed(notification);
      // station/base.py: a pilot arrived in the station, or left it.
      entry.station.feed(notification);
      // structureGuests (36, 40): a pilot entered the structure, or left it.
      entry.structureGuests.feed(notification);
      // crimewatchSvc (222 to 288): a timer, a flag or an engagement changed. The client works the notice into what
      // it keeps and asks nothing; so here (crimewatchStates.js). States the notice cannot be worked into are let go.
      if (CLIENT_STATE_NOTICES.has(notification.method)) entry.clientStates.amend(CLIENT_STATES, (states) => statesAfter(states, notification.method, notification.args));
      // industrySvc.OnIndustryMaterials: what the monitored job's place has is what the server says.
      if (notification.method === "OnIndustryMaterials") monitoredJobHas(entry, notification.args);
      // clone_grade_svc.OnSubscriptionChangedServer(new_state): the grade is what the server says.
      if (notification.method === "OnSubscriptionChangedServer" && typeof notification.args?.[0] === "number") entry.cloneGrade = notification.args[0];
      // crimewatchSvc.OnSecurityStatusUpdate(newSecurityStatus): the status is what the server says.
      if (notification.method === "OnSecurityStatusUpdate" && typeof notification.args?.[0] === "number") entry.securityStatus = notification.args[0];
      // crimewatchSvc.OnJumpTimersUpdated(*args) (610 to 612): the jump timers are what the server says, the three as
      // they came. A notice of another number is no such three (the timer panel's handler takes three,
      // crimewatchTimers.py 456): what is kept is let go, and asked for when next wanted.
      if (notification.method === "OnJumpTimersUpdated") entry.jumpTimers = Array.isArray(notification.args) && notification.args.length === 3 ? notification.args : undefined;
      // war_cso.OnWarChanged(war, ownerIDs, change) (82 to 96): a war changed, and it is worked into the wars kept.
      if (notification.method === "OnWarChanged") entry.wars.changed(notification.args);
      // fwWarzoneSvc.OnWarzoneOccupationStateUpdated(solarsystemID, newOccupationState) (78 to 93): of the system the
      // session is in, it is that system's state from now; of another system, nothing.
      if (notification.method === "OnWarzoneOccupationStateUpdated" && Array.isArray(notification.args) && notification.args.length === 2
        && positive(notification.args[0]) !== null && positive(notification.args[0]) === attribute(entry, "solarsystemid2")) {
        entry.localOccupation = [notification.args[0], notification.args[1]];
      }
      // dynamicResourceSvc.OnSystemDynamicBountyStateChanged(systemID, rate) (160 to 165): of the system the session
      // is in, the output kept is (rate, True) from now, good for its ninety minutes; of another system, nothing.
      if (notification.method === "OnSystemDynamicBountyStateChanged" && Array.isArray(notification.args) && notification.args.length === 2
        && positive(notification.args[0]) !== null && positive(notification.args[0]) === attribute(entry, "solarsystemid2")) {
        entry.bountyOutput = { answer: [notification.args[1], true], until: now() + BOUNTY_OUTPUT_GOOD_FOR_MS };
      }
      // securitySvc.OnSecurityModified(solar_system_id, modifier_amount, new_security) (50 to 54): that system's
      // level is the new one from now, as the service keeps it.
      if (notification.method === "OnSecurityModified" && Array.isArray(notification.args) && notification.args.length === 3
        && positive(notification.args[0]) !== null && typeof notification.args[2] === "number") {
        entry.modifiedSecurity.set(positive(notification.args[0]), pseudoSecurity(notification.args[2]));
      }
      // home_station (163, 168): the home station changed, or was moved from its structure. What is kept is let go.
      if (HOME_STATION_NOTICES.has(notification.method)) entry.homeStation.forget();
      // officeManager.OnOfficeRentalChange (71): an office rented or given up, whoever's, and the station's are not as kept.
      if (notification.method === "OnOfficeRentalChange") entry.stationOffices.forget();
      // invCache.OnItemChange: an item changed, and what a container lists may not be so any more.
      if (ITEM_NOTICES.has(notification.method)) entry.listings.forget();
      // What the client's own services tell its object cache to forget on this notice.
      forgetNamed(entry, namedOnNotice(notification.method, notification.args, entry.session.attributes));
      for (const [service, keeper] of Object.entries(KEPT_UNTIL_CHANGED)) {
        if (keeper.notices.has(notification.method) && (!keeper.concerns || keeper.concerns(notification.args, entry.session.attributes))) entry.kept[service].forget();
      }
      // facilitySvc.OnFacilitiesUpdated (42): each facility the server names is asked for by itself.
      if (notification.method === "OnFacilitiesUpdated") facilitiesAskedAfresh(entry, itemsOf((notification.args ?? [])[0]).map(positive).filter((facilityID) => facilityID !== null));
      if (COLONY_NOTICES.has(notification.method)) forgetColonies(entry);
      // A mission changed: what the client shows of its missions is drawn again from the journal, which reads it again.
      if (entry.journal.feed(notification)) journalUpToDate(entry);
      record(entry, notificationToBridgeJson(notification));
    });
    session.onSessionChange((changes) => {
      // What the client's own services tell its object cache to forget on this change.
      forgetNamed(entry, namedOnSessionChange(changes, entry.session.attributes));
      // A new place, or a new ship: what dogma said of the old one is not about this one, and nor is what a container listed.
      if (LOCATION_ATTRIBUTES.some((name) => name in changes) || "shipid" in changes) {
        entry.dogmaLoaded = null;
        entry.listings.forget();
      }
      // gameui.GetShipAccess: the ship's moniker it keeps is for the ship the pilot is in.
      if ("shipid" in changes) entry.monikers.delete("ship");
      // fwWarzoneSvc.OnSessionChanged (34 to 37): in another solar system what is kept of the local occupation is
      // let go; and the location panel, drawn again for the system, has it asked for (localOccupationWanted).
      // (The choosing of the character asks for it itself.)
      if ("solarsystemid2" in changes) {
        entry.localOccupation = undefined;
        if (sessions.has(entry.handle)) localOccupationWanted(entry).catch(() => {});
      }
      // dynamicResourceSvc.OnSessionChanged (175 to 182): in another solar system the bounty output kept is let go, and
      // the location panel is told to draw it again, which asks for it. (The choosing asks for it itself.)
      if ("solarsystemid2" in changes) {
        entry.bountyOutput = undefined;
        entry.bountyOutputLetGo += 1;
        if (sessions.has(entry.handle)) bountyOutputRead(entry).catch(() => {});
      }
      // shipFighterState.OnSessionChanged: the ship's fighters are asked for again at any change of the ship, to
      // whatever. (The choosing of the character asks them itself.)
      if ("shipid" in changes && sessions.has(entry.handle)) fightersAsked(entry).catch(() => {});
      // missionObjectivesTracker.OnSessionChanged (89 to 94): at any change of the session with a character on it,
      // each accepted mission's agent is asked what is left of it. (The choosing of the character asks them itself.)
      if (sessions.has(entry.handle)) missionInfoAsked(entry).catch(() => {});
      // The achievements' eventHandler.OnSessionChanged (251 to 260): the ship changed, and to a ship: its free
      // turret slots are owed, and asked of its own inventory once godma has the ship. (The choosing of the
      // character owes them itself.)
      if ("shipid" in changes && changes.shipid[1] !== null && sessions.has(entry.handle)) entry.turretSlotsOwed = true;
      // gameui.OnSessionChanged (462 to 469) and _HandleSessionChangeInSpace (619 to 630): in space after the
      // change, in another ship, in the same system, and with a ballpark. In another system the ballpark is a new
      // one, with a state of its own; docked, it is the station's or the structure's arm of gameui, which does neither.
      if ("shipid" in changes && changes.shipid[1] !== null && !("solarsystemid" in changes) && entry.space && whereabouts(entry).inSpace) shipChangedInSpace(entry, changes.shipid[1]);
      // station/base.py OnSessionChanged and ProcessSessionChange: out of a station, its guests and its item are let go.
      if ("stationid" in changes) entry.station.left();
      // crimewatchSvc.ProcessSessionChange and OnSessionChanged: the states asked for at a change of place, and
      // in space at a change of system or ship. (The choosing of the character asks them itself.)
      if (sessions.has(entry.handle)) clientStatesAtAChange(entry, changes);
      // station/base.py: arrived in a station, the lobby asks for the station's item and its guests. (The choosing
      // of the character asks them itself.)
      if ("stationid" in changes && sessions.has(entry.handle)) lobbyRead(entry);
      // officeManager.DoSessionChanging and OnSessionChanged (58, 66): another station or structure, or none, and its offices are not this one's.
      if ("stationid" in changes || "structureid" in changes) {
        entry.stationOffices.forget();
        entry.officePrimed.forget();
      }
      // structureServices.OnSessionChanged (21 to 24): in another structure, or in none, the services kept are not
      // its; docked in one, its services are asked for. (The choosing of the character asks them itself.)
      // structureGuests.DoSessionChanging (31): in another structure, or in none, the guests kept are not its.
      // Docked in one, the lobby asks for its guests: after its services, as the recordings of a docking have them.
      if ("structureid" in changes) {
        entry.kept[STRUCTURE_SETTINGS].forget();
        entry.structureGuests.left();
        if (sessions.has(entry.handle)) structureServicesRead(entry).then(() => structureGuestsAsked(entry));
      }
      // fleetSvc.ProcessSessionChange: in no fleet, there is no fleet's object.
      if ("fleetid" in changes) {
        entry.fleetKept.sessionChanged();
        if (changes.fleetid[1] === null) outOfFleet(entry);
      }
      // scanSvc.OnSessionChanged: another system, ship or structure, and the scanner knows of no probes.
      if (["solarsystemid", "shipid", "structureid"].some((name) => name in changes)) entry.scanner.flush();
      // calendar.OnSessionChanged: in another corporation or alliance the months of events kept are not its.
      if ("corpid" in changes || "allianceid" in changes) entry.kept[CALENDAR_PROXY].forget();
      // officeManager.OnSessionChanged: in another corporation the offices kept are not its.
      if ("corpid" in changes) entry.kept[OFFICE_MANAGER].forget();
      // facilitySvc.OnSessionChanged (29): in another region the facilities kept are not its. The largest indices stay.
      if ("regionid" in changes) entry.kept[FACILITY_MANAGER].amend("region", () => undefined);
      // home_station.OnSessionChanged (173): 'corpid' in change, and the home station kept is let go.
      if ("corpid" in changes) entry.homeStation.forget();
      // all_cso.OnSessionChanged: another alliance, another moniker, made and bound at once; no alliance, none.
      if ("allianceid" in changes) {
        entry.monikers.delete(ALLIANCE_REGISTRY);
        if (sessions.has(entry.handle)) allianceBound(entry).catch(() => {});
      }
      // war_cso.OnSessionChanged (69 to 80): in another alliance or corporation, what is kept of the wars of the
      // alliance the pilot is in now and of its corporation now is let go, and the service reckons again whether
      // the pilot is at war, which asks for its owner's wars at once (IsPlayerCurrentlyAtWarOrInFW, 302 to 311),
      // on a moniker made for that owner where it is another's (GetMoniker). Not at the choosing of a character,
      // which the timer panel's own reading covers. A pilot in a faction's militia is at war with nothing asked,
      // and of such a one the service's thread asks within ten seconds: here at once for either, as at the
      // choosing. With no corporation on the session there is no owner, and nothing is asked.
      if (("allianceid" in changes || "corpid" in changes) && !("charid" in changes && changes.charid[0] === null)) {
        entry.wars.forget(attribute(entry, "allianceid"));
        entry.wars.forget(attribute(entry, "corpid"));
        if (sessions.has(entry.handle)) warsRead(entry, warOwner(entry)).catch(() => {});
      }
      // base_corporation.GetCorpRegistry: another corporation, another registry.
      if ("corpid" in changes) {
        for (const service of CORPORATION_SERVICES) entry.monikers.delete(service);
        // crimewatchSvc.ProcessSessionChange and bco_members.OnSessionChanged: in another corporation, its aggression
        // settings and its members' names are read at once. (The choosing of the character reads them itself.)
        entry.aggression = null;
        if (changes.corpid[1] && sessions.has(entry.handle)) corporationRead(entry);
        // standingsvc.ProcessSessionChange: in another corporation the standings are read again. (The choosing of
        // the character reads them itself, once the character is on the session.)
        if (changes.corpid[1] && sessions.has(entry.handle)) refreshStandings(entry);
      }
      if (LOCATION_ATTRIBUTES.some((name) => name in changes)) {
        // targetMgr.ProcessSessionChange: docked, or its ballpark let go, it has no targets. Undocking, or logging in
        // in space, godma asks what the ship has locked and what has it locked, once its dogma location is primed.
        entry.targetsOwed = arrivingInSpace(entry, changes);
        if (entry.targetsOwed) entry.targets.forget();
        else entry.targets.emptied();
        forgetLocationObjects(entry);
        if (sessions.has(entry.handle)) syncSpace(entry);
      }
      record(entry, sessionChangeToBridgeJson(changes));
    });

    let result;
    let row;
    try {
      await session.login(userName, passwordFor(userName));
      // The login function the server sends has been answered: if it was the one that frees the client's clock, this pilot's is free.
      clock.loggedIn(session.handshakeAnswer);
      if (positive(session.attributes.userid) !== accountID) {
        throw fail("SESSION_SELECT_FAILED", "The game server logged that name in as a different account.");
      }
      // eveCfg.LoadCfgData (400 to 402): the cfg starts the thread that asks for its prices in two seconds.
      averagePricesThread(entry);
      // gameui.OnSessionChanged (449): an account come onto the session has its clone's grade asked. A grade that
      // could not be read is asked for when it is next wanted, as the client's service asks where it has none.
      await cloneGradeRead(entry).catch(() => {});
      // The character selection screen, as the retail client fills and leaves it.
      for (const method of ["GetCharacterSelectionData", "GetCharacterLockType", "SelectCharacterID"]) {
        ledger.note("charUnboundMgr", method, shape("charUnboundMgr", method, [], null));
      }
      const selection = wireToBridgeJson(await session.call("charUnboundMgr", "GetCharacterSelectionData", []));
      row = selectionRow(selection, characterID);
      if (!row) throw fail("CALL_REFUSED", "That character is not on this account.");
      entry.selection = selection;
      entry.characterName = String(keyValField(row, "characterName") || "");
      const lockType = await session.call("charUnboundMgr", "GetCharacterLockType", [characterID]);
      if (lockType !== null && lockType !== undefined) {
        throw fail("CALL_REFUSED", LOCK_REFUSALS.get(Number(lockType)) ?? "CharacterLocked");
      }
      // The gateway's session begins at this call, so what the server pushed
      // while logging in (the account's own session change) is not part of it.
      entry.backlog.length = 0;
      entry.history.length = 0;
      entry.sequence = 0;
      result = await session.call("charUnboundMgr", "SelectCharacterID", argumentsToWire(args), kwargs);
      // The session change that puts the character on the session arrives
      // before the answer. Give a slow server a moment, then take it at its word.
      for (let waited = 0; positive(session.attributes.charid) !== characterID && waited < selectSettleMs; waited += 50) {
        await sleep(50);
      }
      if (positive(session.attributes.charid) !== characterID) {
        throw fail("SESSION_SELECT_FAILED", "charUnboundMgr.SelectCharacterID completed without bringing a character online.");
      }
      // standingsvc.ProcessSessionChange: a character chosen has its standings read.
      await refreshStandings(entry);
      // skillsvc, skillQueueSvc and the notifications: a character chosen has its skills, its queue and its history read.
      await primeSkills(entry);
      // securitySvc.OnSessionChanged (45 to 48): the session has a solar system where it had none, and the service
      // asks for the systems whose security is other than the map's (Initialize, 39 to 43). In the retail client's
      // own login it is asked ahead of the journal. A manager that refuses fails no choosing.
      await modifiedSystemsAsked(entry).catch(() => {});
      // journal._UpdateMissionDataFull: a character chosen has its agents' journal read, for the missions it is on.
      await journalUpToDate(entry).catch(() => {});
      // missionObjectivesTracker.OnSessionChanged: a character chosen has each mission it has accepted asked after,
      // of the journal just read. A manager that refuses fails no choosing.
      await missionInfoAsked(entry).catch(() => {});
      // shipFighterState.OnSessionChanged: the ship on the session, its fighters are asked for. After the journal and
      // before the bookmarks, as the client's own login has it. A manager that refuses fails no choosing.
      await fightersAsked(entry).catch(() => {});
      // bookmarkSvc.ACLPrimeBookmarks: a character chosen has its bookmarks read, and the folders it knows with them,
      // after the journal, as a client asks this server. A manager that refuses fails no choosing: they are asked
      // for when they are next wanted.
      await bookmarksRead(entry, shape(BOOKMARK_MGR, ACTIVE_BOOKMARKS, [], null, contextFor(entry))).catch(() => {});
      // characterSettingsSvc._GetSettings (31 to 34): the character's settings are asked for when something first
      // wants one, and the client's services want some as they start (the chat's filters, the sensor overlay's
      // folders, the mail's settings): in every recorded login, once. A manager that refuses fails no choosing.
      await characterSettingsRead(entry).catch(() => {});
      // crimewatchSvc: the client's states, as a character on the session and a system under it each ask them; and
      // the pilot's own security status, which the client asks for once.
      await clientStatesAtAChange(entry, { charid: [null, characterID], ...(attribute(entry, "solarsystemid") === null ? {} : { solarsystemid: [null, attribute(entry, "solarsystemid")] }) });
      await securityStatusRead(entry).catch(() => {});
      // infoPanelLocationInfo.UpdateLocationInfo (155 to 162): the location panel is up from the first, docked or in
      // space, and has the warzone service say the occupation state of the system the pilot is in. In the retail
      // client's own login it is asked just ahead of the jump timers. A service that refuses fails no choosing.
      await localOccupationWanted(entry).catch(() => {});
      // And, in the same drawing, the system's bounty output (UpdateDynamicResourceInfo, 328 to 332, by a tasklet
      // of its own). A manager that refuses fails no choosing.
      await bountyOutputRead(entry).catch(() => {});
      // crimewatchTimers (335, 355): the timer panel is made as the pilot comes in, docked or in space, and reads
      // the jump timers of crimewatchSvc, which asks for them once. A service that refuses fails no choosing.
      await jumpTimersRead(entry).catch(() => {});
      // crimewatchTimers (356): the panel then has the war service say whether the pilot is at war, which asks for
      // the wars of its alliance, or of its corporation where it is in none (war_cso.IsPlayerCurrentlyAtWarOrInFW,
      // 302 to 311). A pilot in a faction's militia is at war with nothing asked, and of such a one the service's
      // own thread asks for the same wars within ten seconds (172 to 182, 185): here they are asked for at once,
      // for either. A registry that refuses fails no choosing.
      await warsRead(entry, warOwner(entry)).catch(() => {});
      // crimewatchSvc and bco_members: the corporation's registry is bound, and asked its settings and its members' names.
      await corporationRead(entry);
      // addressbook.GetContacts: the pilot's contacts, its corporation's, and who of the watched is online.
      await addressBookRead(entry);
      // The lobby of a docked client is up from the first: its reads are asked as the character is chosen in a station.
      await lobbyRead(entry, { chosen: true });
      // structureServices: chosen in a structure, its services are asked for, as a client logging in docked in one asks.
      await structureServicesRead(entry);
      // The lobby's guests panel: chosen in a structure, its guests are asked for, as a client logging in docked in one asks.
      await structureGuestsAsked(entry);
      // bco_applications: the pilot's own applications, which the client asks for once.
      await corporationAsk(entry, "GetMyApplications").catch(() => {});
      // contracts.NeocomBlink: what of the pilot's contracts wants attention, asked once the notifications are ready.
      await asks(entry, "contractProxy", "GetLoginInfo").catch(() => {});
      // notificationUI._NotificationProvider: all the pilot's notifications, from the first, for the notification window.
      await keptRead(entry, NOTIFICATION_MGR, "GetAllNotifications", shape(NOTIFICATION_MGR, "GetAllNotifications", [], { fromID: 0 }, contextFor(entry))).catch(() => {});
      // calendar.GetEventsNextXMonths: this month's events and the next's, by the server's clock, a month at a time.
      for (const monthAndYear of monthAndNext(session.serverNow())) {
        await keptRead(entry, CALENDAR_PROXY, "GetEventList", shape(CALENDAR_PROXY, "GetEventList", monthAndYear, null, contextFor(entry))).catch(() => {});
      }
      // The achievements' eventHandler.OnSessionChanged: a character chosen has a ship on its session where it had
      // none, and that ship's free turret slots are owed: asked once godma has the ship.
      entry.turretSlotsOwed = attribute(entry, "shipid") !== null;
      // agents.__GetAllAgents: the table of agents is asked for as a character is chosen. The choosing does not wait
      // on it, so it is asked for last: a call sent right behind it was answered 50 to 80 ms late (2026-10-09).
      agentsKnown(entry);
    } catch (error) {
      averagePricesThreadEnded(entry);
      warsThreadEnded(entry);
      session.close();
      // The login failing is not the select call failing; say what the session said.
      if (/^(LOGIN_REFUSED|LOGON_QUEUE|BAD_SERVER_SIGNATURE|INCOMPATIBLE_PROTOCOL|HANDSHAKE_INCOMPATIBLE)/.test(String(error && error.code))) {
        throw fail("SESSION_SELECT_FAILED", String(error.message));
      }
      const mapped = toPilotError(error, "charUnboundMgr", "SelectCharacterID");
      // No session was ever handed out, so there is none to have lost.
      throw mapped.code === "SESSION_NOT_FOUND"
        ? fail("SESSION_SELECT_FAILED", "The game server closed the connection during character selection.")
        : mapped;
    }
    // The readings after the choosing fail quietly, each for itself. A connection lost under them is the choosing lost.
    if (session.closed) throw fail("SESSION_SELECT_FAILED", "The game server closed the connection during character selection.");

    sessions.set(entry.handle, entry);
    session.onClose(() => end(entry, "connection_closed"));
    // A pilot that was left in space comes back in space.
    syncSpace(entry);
    return {
      bridgeSessionID: entry.handle,
      service: "charUnboundMgr",
      method: "SelectCharacterID",
      result: wireToBridgeJson(result === undefined ? null : result),
      notifications: drain(entry),
      session: {
        userid: accountID,
        characterID,
        characterName: String(keyValField(row, "characterName") || ""),
        stationID: attribute(entry, "stationid"),
        structureID: attribute(entry, "structureid"),
        solarSystemID: attribute(entry, "solarsystemid2") ?? attribute(entry, "solarsystemid"),
        corporationID: attribute(entry, "corpid"),
        shipID: attribute(entry, "shipid"),
      },
    };
  }

  /**
   * michelle.GetRemotePark(): what the client asks of its ballpark it asks of the park's own bound object, the one
   * object everything in space is asked of. With no park, which is a pilot not in space, the client has nothing to
   * ask and asks nothing (menusvc.TagItem: `if bp:`); asked all the same, the call is refused here and not sent.
   */
  async function parkObject(entry) {
    const objectID = entry.space ? await entry.space.remote() : null;
    if (!objectID) throw fail("CALL_REFUSED", "The pilot has no ballpark to ask: it is not in space.");
    return objectID;
  }

  /** A service's own method: at the proxy node for a service the client reaches with sm.ProxySvc, by the name alone for any other. */
  const byName = (session, service, method, form) => (form.proxy
    ? session.proxyCall(service, method, argumentsToWire(form.args), form.kwargs)
    : session.call(service, method, argumentsToWire(form.args), form.kwargs));

  async function callMethod(service, method, args = [], kwargs = null, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    assertAllowed(service, method);
    // What the client has to hand before it makes this call: godma primed for the ship, which it is from the moment it has one,
    // and anything just fitted answered for.
    if (retailNeeds(service, method) === "orders") await ownOrdersRead(entry);
    if (retailNeeds(service, method) === "fee" || retailNeeds(service, method) === "sale") await feeInputsRead(entry, feePlaces(method, args));
    if (retailNeeds(service, method) === "sale") await saleAveragesRead(entry, args);
    if (retailNeeds(service, method) === "dogma") {
      await shipReadings(entry, whereabouts(entry));
      await entry.itemWork;
    }
    // The client's agents service has the table of agents from when its character was chosen, and asks for it only
    // where it has none.
    if (service === "agentMgr" && method === "GetAgents") {
      await run(entry, service, method, () => agentsKnown(entry));
      return { service, method, result: agentsTable, notifications: drain(entry) };
    }
    const form = shape(service, method, args, kwargs, contextFor(entry));
    // What a service of the client's keeps until it changes is that service's to answer, and is noted where it is asked for.
    if (Object.hasOwn(KEPT_UNTIL_CHANGED, service) && KEPT_UNTIL_CHANGED[service].keptAs(method, form, entry.session.attributes) !== null) {
      const kept = await run(entry, service, method, () => (service === BOOKMARK_MGR ? bookmarksRead(entry, form) : keptRead(entry, service, method, form)));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The formations are asked for once, as the client's object cache has them after its first asking.
    if (service === "beyonce" && method === "GetFormations") {
      const known = await run(entry, service, method, () => formationsKnown(entry));
      return { service, method, result: wireToBridgeJson(known === undefined ? null : known), notifications: drain(entry) };
    }
    // An attribute's value is the client's own dogma location's to answer, where godma holds the item.
    if (service === "dogmaIM" && method === "QueryAttributeValue") {
      const held = attributeHeld(entry, form.args);
      if (held !== undefined) return { service, method, result: held, notifications: drain(entry) };
    }
    // What the ship has locked, and what has it locked, are the client's target service's to answer.
    if (service === "dogmaIM" && Object.hasOwn(TARGETS_KEPT, method)) {
      const kept = await run(entry, service, method, async () => {
        // Asking for them is godma's own, and godma is primed first.
        if (entry.targetsOwed && whereabouts(entry).shipID) await shipReadings(entry, whereabouts(entry));
        return targetsRead(entry, method);
      });
      return { service, method, result: wireToBridgeJson(kept), notifications: drain(entry) };
    }
    // The guests of the station a pilot is docked in, and the station's own item, are the client's station
    // service's to answer, where they are asked as the client asks them. (For a pilot in no station nothing is
    // ever had, and each asking is sent.)
    if (STATION_KEPT.has(`${service}.${method}`) && form.args.length === 0 && form.kwargs === null) {
      const kept = await run(entry, service, method, () => stationRead(entry, service, method, form));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The guests of the structure a pilot is docked in are the client's structure guests service's to answer,
    // where they are asked as the client asks them: of that structure, and with nothing else. (Another
    // structure's the client never asks for: such an asking is sent as it came, each time.)
    if (service === STRUCTURE_GUESTS && method === STRUCTURE_GUESTS_READ && form.args.length === 1 && form.kwargs === null
      && positive(form.args[0]) !== null && positive(form.args[0]) === attribute(entry, "structureid")) {
      const kept = await run(entry, service, method, () => structureGuestsRead(entry, form));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The account's clone grade is the client's clone grade service's to answer, where it is asked as the client
    // asks it: with nothing.
    if (keptCloneGrade(service, method, form)) {
      const kept = await run(entry, service, method, () => cloneGradeRead(entry));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // crimewatchSvc's client states and the pilot's security status are that service's to answer, where they are
    // asked as the client asks them: with nothing.
    if (keptOfCrimewatch(service, method, form)) {
      const kept = await run(entry, service, method, () => crimewatchKept(entry, method));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The jump timers are that service's to answer too, where they are asked as the client asks them: of the
    // pilot's own character alone.
    if (keptJumpTimers(service, method, form, entry.characterID)) {
      const kept = await run(entry, service, method, () => jumpTimersRead(entry));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The occupation state of the system the session is in is the warzone service's to answer, where it is asked
    // as the client asks it: with nothing. Answered in the server's own form, the system and its state.
    if (keptLocalOccupation(service, method, form)) {
      const kept = await run(entry, service, method, () => localOccupationRead(entry));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The bounty output of the system the session is in is the dynamic resource service's to answer, where it is
    // asked as the client asks it: with nothing.
    if (keptBountyOutput(service, method, form)) {
      const kept = await run(entry, service, method, () => bountyOutputRead(entry));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The character's settings are the character settings service's to answer, where they are asked as the client
    // asks them: with nothing.
    if (keptCharacterSettings(service, method, form)) {
      const kept = await run(entry, service, method, () => characterSettingsRead(entry));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The corporations with offices where a pilot is docked are the client's office manager's to answer, where
    // they are asked as the client asks them: of the station's own object, with nothing.
    if (service === OFFICE_MANAGER && method === STATION_OFFICES && form.moniker && form.args.length === 0 && form.kwargs === null) {
      const kept = await run(entry, service, method, () => entry.stationOffices.read(method, () => {
        // Asked of the service by name and made on its moniker, as any call of a moniker's is noted.
        ledger.note(service, method, form.status === "same" ? { ...form, status: "reshaped" } : form);
        return monikerCall(entry, service, method, [], null);
      }));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The office's item is primed once for a station's Moniker, whatever is rented or given up there since.
    if (service === OFFICE_MANAGER && method === PRIME_OFFICE && form.moniker && form.args.length === 0 && form.kwargs === null) {
      const kept = await run(entry, service, method, () => entry.officePrimed.read(method, () => {
        ledger.note(service, method, form.status === "same" ? { ...form, status: "reshaped" } : form);
        return monikerCall(entry, service, method, [], null);
      }));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // The standings service's two lists: answered from what is kept, where anything is. Nothing is sent, and nothing is counted.
    if (service === STANDING_MGR && Object.hasOwn(STANDINGS_KEPT, method) && form.args.length === 0 && form.kwargs === null) {
      await entry.standingsWork;
      if (entry.standings.loaded) {
        return { service, method, result: wireToBridgeJson(entry.standings[STANDINGS_KEPT[method]]()), notifications: drain(entry) };
      }
    }
    // The journal service's reading (journal.py 290): the whole asked for once and kept, a changed mission's agent
    // asked for its own part. Asked for by name, as the page asks when it shows the journal, it is answered from
    // the journal as it is kept, made right first. Where no journal is kept (what the server answered was none),
    // the call goes on as any call does.
    if (service === "agentMgr" && method === "GetMyJournalDetails" && form.args.length === 0 && form.kwargs === null) {
      await run(entry, service, method, () => journalUpToDate(entry));
      const journal = entry.journal.read();
      if (journal) return { service, method, result: wireToBridgeJson(journal), notifications: drain(entry) };
    }
    // The selection screen's data: the client's character service keeps what it was answered at the choosing
    // (ccSvc.GetCharacterSelectionData), and whoever asks it again, as its queue service does to count the
    // account's characters in training, has that. Asked for by name with nothing, it is what was kept: nothing
    // is sent, and nothing is counted.
    if (service === "charUnboundMgr" && method === "GetCharacterSelectionData" && form.args.length === 0 && form.kwargs === null) {
      return { service, method, result: entry.selection, notifications: drain(entry) };
    }
    // The home station service's read: asked once and kept, until the server says the home station is another.
    if (service === HOME_STATION && method === GET_HOME_STATION && form.args.length === 0 && form.kwargs === null) {
      const kept = await run(entry, service, method, () => entry.homeStation.read(method, () => {
        ledger.note(service, method, form);
        return byName(entry.session, service, method, form);
      }));
      return { service, method, result: wireToBridgeJson(kept), notifications: drain(entry) };
    }
    // facilitySvc.GetFacilityLocations (113 to 120): what was answered for a facility and an owner is what is
    // answered for a minute from then. Nothing is sent, and nothing is counted.
    if (service === FACILITY_MANAGER && method === "GetFacilityLocations" && form.status === "same" && form.kwargs === null) {
      const kept = await run(entry, service, method, () => facilityPlaces(entry, form.args, () => {
        ledger.note(service, method, form);
        return byName(entry.session, service, method, form);
      }));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // industrySvc.ConnectJob (303 to 308) is made when the window's job is given a place to take from, and that
    // job is the one monitored from then on. Asked for the job that is the one monitored, it is answered as it
    // was: nothing is sent, and nothing is counted.
    const monitoredAs = service === INDUSTRY_MONITOR && method === "ConnectJob" && form.status !== "differs" ? jobMonitoredAs(Array.isArray(args) ? args[0] : null) : null;
    if (monitoredAs !== null && entry.windowJob && entry.windowJob.monitoredAs === monitoredAs) {
      return { service, method, result: wireToBridgeJson(entry.windowJob.answer), notifications: drain(entry) };
    }
    // The account service's static data: asked once and kept, however many windows want it and however many at once.
    if (service === ACCOUNT && ACCOUNT_STATIC.has(method)) {
      const kept = await run(entry, service, method, () => entry.accountStatic.read(method, () => {
        ledger.note(service, method, form);
        return byName(entry.session, service, method, form);
      }));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    // objectCaching.PerformCachedMethodCall: what the server marked as cached is answered from its first answer
    // for as long as the client would keep it. Nothing is sent, and nothing is counted.
    if (!form.moniker && typeof entry.session.cachedMethodCall === "function") {
      const kept = entry.session.cachedMethodCall(service, method, argumentsToWire(form.args));
      if (kept) return { service, method, result: wireToBridgeJson(kept.result === undefined ? null : kept.result), notifications: drain(entry) };
    }
    // Asked of the service by name and made on its moniker: the arguments may be the client's as they stand, the call was not.
    // What the client's skill services keep is noted where it is asked for, which is not every time it is wanted (skillRead).
    const keptByAService = (service === SKILL_HANDLER && (Object.hasOwn(SKILL_KEPT, method) || isSkillQueueRead(method, form.args, form.kwargs))) ||
      (service === CORP_REGISTRY && method === AGGRESSION_SETTINGS) ||
      // An owner's wars are the war service's to answer, and are noted where they are asked for (warsRead).
      (form.moniker && keptWars(service, method, argumentsToWire(form.args), form.kwargs));
    // A call on the park is made on the park's own object. With no park it is refused here, before it is counted:
    // nothing is sent, and the ledger is of what was asked.
    const park = service === "beyonce" && ON_THE_PARK.has(method) ? await run(entry, service, method, () => parkObject(entry)) : null;
    if (!keptByAService) {
      ledger.note(service, method, ON_AN_ANSWERED_OBJECT.has(`${service}.${method}`)
        ? { ...form, status: "differs", note: "Asked of the service by its name. The client asks the object another call answered." }
        : form.moniker && form.status === "same" ? { ...form, status: "reshaped" } : form);
    }
    // A call the client makes on a service's moniker is made on the object bound for where the pilot is.
    const result = await run(entry, service, method, async () => (form.moniker
      ? monikerCall(entry, service, method, argumentsToWire(form.args), form.kwargs)
      : park !== null ? entry.session.callBound(park, method, argumentsToWire(form.args), form.kwargs)
      : byName(entry.session, service, method, form))).finally(() => {
      forgetKeptAfter(entry, service, method);
      if (mayChangeContents(service, method)) entry.listings.forget();
    }).catch((error) => {
      // industrySvc.InstallJob (139 to 144): a job the server refuses has its facility asked for afresh
      // (facilitySvc.Reload), and the refusal stands.
      const facilityID = service === "industryManager" && method === "InstallJob" && error && error.code === "CALL_REFUSED" ? jobsFacility(Array.isArray(args) ? args[0] : null) : null;
      if (facilityID !== null) facilitiesAskedAfresh(entry, [facilityID]);
      throw error;
    });
    // industrySvc.GetOwnerJobs (73 to 74) and GetJobByID (60): each row the server answers is made the client's
    // job, and a job whose row names a facility is given it afresh (_JobInstance, 196 to 197), before the jobs
    // are anyone's to read.
    if (service === "industryManager" && (method === "GetJobsByOwner" || method === "GetJob")) {
      await jobsGivenTheirFacilities(entry, method === "GetJob" ? [result] : itemsOf(result));
    }
    // The job whose monitor was opened is the one monitored from now on (self.monitoring = weakref.ref(job), 304).
    // A monitor opened before it is not let go: the client lets none go but at its window's close.
    if (monitoredAs !== null) {
      entry.windowJob = { monitoredAs, blueprintID: positive(args[0].blueprintID), monitorID: positive(itemsOf(result)[0]), answer: result };
    }
    // A monitor let go by its number is no longer the window's job's.
    if (service === INDUSTRY_MONITOR && method === "DisconnectJob" && entry.windowJob && entry.windowJob !== A_JOB_INSTALLED
      && entry.windowJob.monitorID === positive(form.args[0])) {
      entry.windowJob = null;
    }
    // A job the server took: the window has the server's job of it from now on, and the next job it makes is another.
    if (service === "industryManager" && method === "InstallJob") {
      const blueprintID = positive(jobsBlueprint(Array.isArray(args) ? args[0] : null));
      if (entry.windowJob && entry.windowJob !== A_JOB_INSTALLED && entry.windowJob.blueprintID === blueprintID) entry.windowJob = A_JOB_INSTALLED;
      if (entry.jobMade !== null && blueprintID !== null && entry.jobMade.startsWith(`${blueprintID}:`)) entry.jobMade = null;
    }
    // crimewatchSvc.SetSafetyLevel (343 to 345): once the server has taken the level, it is the level the client has.
    // A call that is not the client's (a level that is none of its three) leaves nothing the client would keep:
    // the states kept are let go, and the next reading asks the server what it made of it.
    if (service === CRIMEWATCH && method === SET_SAFETY_LEVEL) {
      if (form.status === "differs") entry.clientStates.forget();
      else await safetyLevelSet(entry, form.args[0]);
    }
    // What the client's own code names beside this call, which it does once the call is done (a refusal threw above).
    forgetNamed(entry, namedAfterCall(service, method, argumentsToWire(form.args), entry.session.attributes));
    // targetMgr._LockTarget: (flag, targets) with no flag set says the lock is made already, and the client adds the target itself.
    if (service === "dogmaIM" && method === "AddTarget" && itemsOf(result).length > 0 && !itemsOf(result)[0]) entry.targets.added(form.args[0]);
    // clientDogmaLocation's grouping calls (763 to 803): once one is answered, the client's own banks are the answer's.
    if (service === "dogmaIM") afterGroupingCall(entry, method, form.args, result);
    // An order to the ship made on the park's object is the pilot's last order, as one made on a handle is.
    if (park !== null) afterMovementCall(entry, method, form.args, form.kwargs);
    // And a place bookmarked there is a bookmark the client has from then on.
    if (park !== null) afterBookmarkCall(entry, service, method, form, result);
    return {
      service,
      method,
      result: HANDED_BACK_AS_ANSWERED.has(`${service}.${method}`) ? longKeptToBridgeJson(result) : wireToBridgeJson(result === undefined ? null : result),
      notifications: drain(entry),
    };
  }

  // ── the pilot's own market orders, as the object cache has them ──────────

  /**
   * marketQuote.GetMyOrders: GetMarketProxy().GetCharOrders(), which the client's object cache keeps for the run and
   * OnOwnOrdersChanged names. One order of that list by its ID, as its row has it by the columns' names (each value
   * as it came off the wire): null where the session keeps no list, or the order is not in it.
   */
  function ownOrderOf(entry, orderID) {
    const kept = typeof entry.session.cachedMethodCall === "function" ? entry.session.cachedMethodCall(MARKET_PROXY, OWN_ORDERS, []) : null;
    return kept ? rowsetLine(kept.result, "orderID", orderID) : null;
  }

  /**
   * The pilot's orders asked for where the session keeps none, as the client has them before it takes one down or
   * reprices it: both are done from its list of them. Noted as the client's own asking. A refusal is not this
   * call's to tell: the order then goes out as it came.
   */
  async function ownOrdersRead(entry) {
    if (typeof entry.session.cachedMethodCall !== "function" || entry.session.cachedMethodCall(MARKET_PROXY, OWN_ORDERS, [])) return;
    const form = shape(MARKET_PROXY, OWN_ORDERS, [], null, contextFor(entry));
    ledger.note(MARKET_PROXY, OWN_ORDERS, form);
    await byName(entry.session, MARKET_PROXY, OWN_ORDERS, form).catch(() => {});
  }

  // ── the broker's fee rate, as the client works it out ────────────────────

  /**
   * marketsvc.GetBrokersFeeCommissionFromStationID (161): the broker's fee rate at a station, from the pilot's
   * Broker Relations in effect and the standings the station's owner and its faction have to the pilot, where the
   * owner is an NPC (brokerFee.js). Null where it cannot be worked out here: a station the game's data has not, or
   * the pilot's skills or standings are not kept. What is no station is a structure, and has its own rate
   * (brokersFeeInStructure).
   *
   * Not lowered for a system the militias have upgraded: the client asks the war's manager for that, and this
   * server does not lower its own rate for it either.
   */
  function brokersFeeAt(entry, stationID) {
    const placeID = positive(stationID);
    // (No place at all is no station, and has no tax kept: null, either way.)
    if (!isStation(placeID)) return brokersFeeInStructure(entry, placeID);
    const station = stationOwner(placeID);
    if (!station) return null;
    // marketsvc.FactionAndCorpToCharStandings (745): an owner that is no NPC has no standing that counts, nor has its faction.
    const npc = station.ownerID > MAX_SYSTEM_ITEM && station.ownerID < MIN_PLAYER_OWNER;
    const sums = {
      brokerRelations: entry.skills.effectiveLevel(TYPE_BROKER_RELATIONS),
      factionToCharStanding: npc ? entry.standings.toCharacter(station.factionID) : 0.0,
      corpToCharStanding: npc ? entry.standings.toCharacter(station.ownerID) : 0.0,
    };
    // A skill's level or a standing that is not known is null: no rate is made of a guess.
    return Object.values(sums).every((value) => typeof value === "number") ? brokersFeeRate(sums) : null;
  }

  /**
   * buySellItemContainerBase.py 28: each entry of the client's sale window asks the market for its type's average
   * price when it is made, which is the two halves of the type's price history (marketsvc.GetAveragePrice, 368).
   * Here they are asked for as the sale goes, once for each item that has no delta of its own, each noted as the
   * client's asking, and the average worked out from them (priceHistory.js) is kept for the shaping of this sale.
   * A history that cannot be read leaves the type without an average: the item then goes without a delta.
   */
  async function saleAveragesRead(entry, args) {
    entry.saleAverages.clear();
    const [given] = Array.isArray(args) ? args : [];
    for (const item of itemsOf(given)) {
      const typeID = item && typeof item === "object" && item.type === undefined && item.delta === undefined ? positive(item.typeID) : null;
      if (typeID === null) continue;
      const half = (method) => {
        const form = shape(MARKET_PROXY, method, [typeID], null, contextFor(entry));
        ledger.note(MARKET_PROXY, method, form);
        return byName(entry.session, MARKET_PROXY, method, form);
      };
      try {
        const old = historyRows(await half("GetOldPriceHistory"));
        const fresh = historyRows(await half("GetNewPriceHistory"));
        const now = BigInt(Math.trunc(entry.session.serverNow())) * 10000n + FILETIME_OF_UNIX_EPOCH;
        entry.saleAverages.set(typeID, averagePrice(old, fresh, now, typeBasePrice(typeID) ?? undefined));
      } catch {
        // Not this sale's to tell. Nothing is kept from a sale before (cleared above), so the type has no average.
      }
    }
  }

  /** The rate for whoever wants to show it: what an order placed at that station, or in that structure, would name, or null. */
  async function brokersFeeRateFor(stationID, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    await feeInputsRead(entry, [positive(stationID)]);
    return brokersFeeAt(entry, stationID);
  }

  /**
   * The rate in a structure, from its market tax as it is kept (marketTaxAt, which whoever wants a rate has asked
   * first): the client's own sums of it (brokerFee.js). Null where no tax is kept, or one is still being asked
   * for, and where what was answered is no tax: no rate is made of a guess.
   */
  function brokersFeeInStructure(entry, structureID) {
    const said = (entry.marketTaxes.get(structureID) ?? {}).value;
    // The wire's kinds: a real, a long, a bool, None.
    const marketTax = said === null || typeof said === "boolean" ? said : typeof said === "bigint" ? Number(said) : typeof said === "number" && Number.isFinite(said) ? said : undefined;
    return marketTax === undefined ? null : brokersFeeRateInStructure({ marketTax });
  }

  /**
   * marketsvc.GetMarketTaxAtStructure (237 to 239): a structure's market tax for the pilot, which is
   * RemoteSvc('structureSettings').CharacterGetService(structureID, structures.SERVICE_MARKET), kept by the structure
   * until more than two minutes have gone by since it was answered. Two that find nothing kept ask once. What could
   * not be asked is not kept. Noted as the client's own asking.
   */
  function marketTaxAt(entry, structureID) {
    const kept = entry.marketTaxes.get(structureID);
    if (kept && now() - kept.at <= MARKET_TAX_KEPT_MS) return kept.answer;
    // One being asked for is kept from the asking, and has no time until it is answered.
    const record = { at: Infinity, value: undefined, answer: null };
    record.answer = Promise.resolve().then(() => {
      const form = shape(STRUCTURE_SETTINGS, STRUCTURE_SERVICE_VALUE, [structureID, STRUCTURE_SERVICE_MARKET], null, contextFor(entry));
      ledger.note(STRUCTURE_SETTINGS, STRUCTURE_SERVICE_VALUE, form);
      return byName(entry.session, STRUCTURE_SETTINGS, STRUCTURE_SERVICE_VALUE, form);
    }).then((answer) => { Object.assign(record, { at: now(), value: answer }); return answer; });
    entry.marketTaxes.set(structureID, record);
    record.answer.catch(() => { entry.marketTaxes.delete(structureID); });
    return record.answer;
  }

  /**
   * The places an order's rate is to be worked out for: a buy order's station where the order names no rate, and
   * the station of each item of a sale that names none. (An order with its rate has it from its own asking.)
   */
  function feePlaces(method, args) {
    if (method === "PlaceBuyOrder") return typeof args[8] === "number" ? [] : [positive(args[0])];
    return itemsOf(args[0]).map((item) => (item && typeof item.rawBrokerFeePercentage !== "number" ? positive(item.stationID) : null));
  }

  /**
   * What the rate is worked out from, read where it is not kept: the pilot's skills, as its skill service has them
   * from the first thing that wants them, and its standings, which are read when it is chosen; and for each of
   * `places` that is no station, the structure's market tax (marketTaxAt), which the client asks after it has made
   * its skill limits (marketsvc.py 163, 164). None failing is this call's to tell: the order then names no rate.
   */
  async function feeInputsRead(entry, places = []) {
    if (!entry.skills.has("skills")) await skillRead(entry, "GetSkills", []).catch(() => {});
    if (!entry.standings.loaded) await (entry.standingsWork ?? refreshStandings(entry));
    for (const placeID of places) {
      if (placeID !== null && !isStation(placeID)) await marketTaxAt(entry, placeID).catch(() => {});
    }
  }

  // ── an attribute's value, from what godma holds ──────────────────────────

  /**
   * baseDogmaLocation.GetAttributeValue (1722): the client asks its own dogma location for an attribute's value,
   * never the server. Here godma answers for an item it was told of, with the value as it stands now (what
   * GetAllInfo brought, and each change the server has told of since). Undefined for an item, or an attribute of
   * one, that godma holds nothing of: that is the server's to answer.
   */
  function attributeHeld(entry, args) {
    // Null from godma is "nothing held": of the item, or of that attribute of it.
    const value = entry.dogma.attribute(args[0], args[1]);
    return typeof value === "number" ? value : undefined;
  }

  /**
   * The session's object cache is told to forget the calls named, as the client's own code tells its cache
   * (objectCaching.InvalidateCachedMethodCalls): what cachedCallsNamed.js answers for a notice, for a change to
   * the session, and for one of the pilot's own calls. What the server names itself is the session's to hear.
   */
  function forgetNamed(entry, named) {
    if (named.length > 0 && typeof entry.session.invalidateCachedMethodCalls === "function") entry.session.invalidateCachedMethodCalls(named);
  }

  // ── what the ship has locked, as it is kept ──────────────────────────────

  /**
   * One of the dogma location's two reads the target service keeps (TARGETS_KEPT): answered from what is kept, and
   * asked for, and noted, where the list is not known. One asking after another.
   */
  function targetsRead(entry, method) {
    const which = TARGETS_KEPT[method];
    const reading = entry.targetsWork.then(async () => {
      const kept = entry.targets.read(which);
      if (kept !== undefined) return kept;
      const asked = entry.targets.asking();
      ledger.note("dogmaIM", method, shape("dogmaIM", method, [], null, contextFor(entry)));
      const answer = await monikerCall(entry, "dogmaIM", method, [], null);
      entry.targets.keep(which, answer, asked);
      return answer === undefined ? null : answer;
    });
    entry.targetsWork = reading.catch(() => {});
    return reading;
  }

  /** godma.RefreshTargets (2360): what the ship has locked, then what has it locked, each asked for if it is not known. */
  async function targetsRefreshed(entry) {
    entry.targetsOwed = false;
    for (const method of Object.keys(TARGETS_KEPT)) await targetsRead(entry, method);
  }

  /**
   * Whether a change of the session's is one godma asks for the targets at (targetMgr.ProcessSessionChange 492):
   * the session has a solar system where it had none, and is in no station. That is logging in in space, as the
   * client calls it, and undocking from a station too: docked in one, a session has no solar system. (Docked in a
   * structure it has one, so logging in there is the same change, and the client asks there as well.)
   */
  function arrivingInSpace(entry, changes) {
    const system = changes.solarsystemid;
    return Boolean(system) && positive(system[0]) === null && attribute(entry, "stationid") === null;
  }

  // ── the names of owners, as the client's cfg.eveowners has them ──────────

  /**
   * cfg.eveowners.Prime(keys) (carbon cfg.py, Recordset._Prime): of the owners asked about, those not known yet
   * are asked for in one call, config.GetMultiOwnersEx(a list of their IDs), by name. Each row answered,
   * (ownerID, ownerName, typeID, gender, ownerNameID), is kept for as long as the pilot is on. An owner the
   * server answers no row for is not asked about again (the Recordset's knownLuzers). One asking after another.
   *
   * Answers a Map of each owner asked about to { name, typeID }, or to null for one with no row. The type says
   * what the owner is. Fails as the call fails, with nothing kept of it.
   */
  async function ownersNamed(ownerIDs, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const wanted = [...new Set((Array.isArray(ownerIDs) ? ownerIDs : []).map(positive).filter((ownerID) => ownerID !== null))];
    const priming = entry.ownersWork.then(() => run(entry, "config", "GetMultiOwnersEx", async () => {
      const unknown = wanted.filter((ownerID) => !entry.owners.has(ownerID));
      if (unknown.length > 0) {
        ledger.note("config", "GetMultiOwnersEx", OWNERS_AS_THE_CLIENT_ASKS);
        const [header, rows] = itemsOf(await entry.session.call("config", "GetMultiOwnersEx", [{ type: "list", items: unknown }], null));
        const columns = itemsOf(header).map(textOf);
        const [ownerID, ownerName, typeID] = ["ownerID", "ownerName", "typeID"].map((column) => columns.indexOf(column));
        for (const row of itemsOf(rows).map(itemsOf)) entry.owners.set(positive(row[ownerID]), { name: textOf(row[ownerName]), typeID: positive(row[typeID]) ?? 0 });
        for (const each of unknown) if (!entry.owners.has(each)) entry.owners.set(each, null);
      }
      return new Map(wanted.map((each) => [each, entry.owners.get(each)]));
    }));
    entry.ownersWork = priming.catch(() => {});
    return priming;
  }

  // ── the station, as the client's station service keeps it ────────────────

  /**
   * station/base.py GetGuests (99) and GetStationItem (573): answered from what is kept for the station the pilot
   * is in, and asked for, and noted, where nothing is. One reading at a time, so that two that find nothing kept
   * ask once. An answer that is no list is handed on as it came with nothing kept of it, and so is one that came
   * after the pilot had left that station.
   */
  function stationRead(entry, service, method, form) {
    const ofGuests = service === "station";
    const reading = entry.stationWork.then(async () => {
      const stationID = attribute(entry, "stationid");
      if (ofGuests ? entry.station.guestsKnown(stationID) : entry.station.itemKnown(stationID)) {
        return ofGuests ? { type: "list", items: entry.station.guestsRead() } : entry.station.itemRead();
      }
      ledger.note(service, method, form);
      const answered = await byName(entry.session, service, method, form);
      if (isAList(answered) && attribute(entry, "stationid") === stationID) {
        if (ofGuests) entry.station.guestsReceived(stationID, answered);
        else entry.station.itemReceived(answered);
      }
      return answered;
    });
    entry.stationWork = reading.catch(() => {});
    return reading;
  }

  // ── what the client's services keep until it changes ──────────────────────

  /**
   * A read of a planet's own object that is kept by the planet: answered from what is kept, and asked for, and
   * noted, where nothing is. A colony kept longer than PLANET_INFO_KEPT_MS is asked for again. One that could not
   * be asked is not kept.
   */
  function planetRead(entry, object, method, ask) {
    const keptAs = `${method}:${JSON.stringify(object.params)}`;
    const kept = entry.planetReads.get(keptAs);
    if (kept && (method !== PLANET_INFO || now() - kept.at < PLANET_INFO_KEPT_MS)) return kept.answer;
    const record = { at: now(), answer: ask() };
    entry.planetReads.set(keptAs, record);
    record.answer.catch(() => { if (entry.planetReads.get(keptAs) === record) entry.planetReads.delete(keptAs); });
    return record.answer;
  }

  /** One of crimewatchSvc's own askings, with nothing, on a Moniker made for the call (eveMoniker.CharGetCrimewatchLocation()): noted as it is sent. */
  function crimewatchAsked(entry, method) {
    ledger.note(CRIMEWATCH, method, shape(CRIMEWATCH, method, [], null, contextFor(entry)));
    return monikerCall(entry, CRIMEWATCH, method, [], null);
  }

  /**
   * crimewatchSvc.ProcessSessionChange (94) and OnSessionChanged (116): the client's states asked for where the
   * change has the place or the character in it, and again where the pilot is in space and the change has the
   * system or the ship in it. Each asking's answer is what is kept from then on. Each fails for itself.
   */
  async function clientStatesAtAChange(entry, changes) {
    const asked = () => entry.clientStates.read(CLIENT_STATES, () => crimewatchAsked(entry, CLIENT_STATES)).catch(() => {});
    if ("locationid" in changes || "charid" in changes) {
      entry.clientStates.forget();
      await asked();
    }
    if (attribute(entry, "solarsystemid") !== null && ("solarsystemid" in changes || "shipid" in changes)) {
      entry.clientStates.forget();
      await asked();
    }
  }

  /** One of crimewatchSvc's two kept reads: what is kept, or asked for where nothing is. */
  /**
   * crimewatchSvc.SetSafetyLevel: the client sets the level at the server, keeps it as the level it has, and asks
   * crimewatch nothing. The states kept say it in their fourth place, after the timers, the engagements and who is
   * flagged (GetClientStates, 96); what is kept in another form says no level, and is left as it is.
   */
  const safetyLevelSet = (entry, level) => entry.clientStates.amend(CLIENT_STATES, (states) => (
    Array.isArray(states) && states.length === 4 ? [states[0], states[1], states[2], level] : states));

  const crimewatchKept = (entry, method) => (method === CLIENT_STATES
    ? entry.clientStates.read(method, () => crimewatchAsked(entry, method))
    : securityStatusRead(entry));

  /**
   * securitySvc.Initialize (security/client/securitySvc.py 39 to 43): sm.RemoteSvc('securityMgr').get_modified_systems(),
   * by the service's name with nothing: the solar systems whose security is other than the map's, each by its ID
   * with a row of (solarSystemID, security, modifiedSecurity). The service keeps each one's modified level and asks
   * once, as its session first has a solar system (OnSessionChanged, 45 to 48), which is the choosing of a
   * character; from then on the server's OnSecurityModified says a system's level (50 to 54). Tranquility's
   * recordings of a login each have the one call, answered an indexed rowset with no rows. The answer is kept as
   * it came. Its rows are not read into the levels kept: no answer on record has a row to read one from. No page
   * reads either yet.
   */
  async function modifiedSystemsAsked(entry) {
    const form = shape(SECURITY_MGR, MODIFIED_SYSTEMS, [], null, contextFor(entry));
    ledger.note(SECURITY_MGR, MODIFIED_SYSTEMS, form);
    entry.modifiedSystems = await byName(entry.session, SECURITY_MGR, MODIFIED_SYSTEMS, form);
    return entry.modifiedSystems;
  }

  /**
   * characterSettingsSvc._GetSettings (eve/client/script/ui/services/characterSettingsSvc.py 31 to 34): the
   * character's settings, charMgr.GetCharacterSettings() of the service by its name with nothing, asked while none
   * are kept and kept for the session (a reset of the session lets them go, 26 to 29). They are the client's own
   * settings that it keeps at the server by a key each: the mail's, the fleet's setups, the inventory's and the
   * chat's filters, the sensor overlay's folders, the wallet's own payments, two of the settings menu's. Its Get
   * reads one by its key out of what is kept (36 to 42). Tranquility answers a utillib.KeyVal of them, each a
   * unicode string, and its recordings of a login each have the one call. One asking at a time.
   *
   * The service's Save and Delete are not made here yet (44 to 58: charMgr.SaveCharacterSetting(key, value) and
   * charMgr.DeleteCharacterSetting(key), each worked into what is kept): no page sets one.
   */
  function characterSettingsRead(entry) {
    const reading = entry.characterSettingsWork.then(async () => {
      if (entry.characterSettings === undefined) {
        const form = shape("charMgr", CHARACTER_SETTINGS, [], null, contextFor(entry));
        ledger.note("charMgr", CHARACTER_SETTINGS, form);
        entry.characterSettings = await byName(entry.session, "charMgr", CHARACTER_SETTINGS, form);
      }
      return entry.characterSettings;
    });
    entry.characterSettingsWork = reading.catch(() => {});
    return reading;
  }

  // ── the occupation of the system, as the client's warzone service has it ──

  /**
   * fwWarzoneSvc.GetLocalOccupationState (47 to 60): the occupation state of the solar system the session is in.
   * Kept as (system, state) while the session is in that system; where what is kept is of another system, or
   * nothing is, sm.RemoteSvc('fwWarzoneSolarsystem').GetLocalOccupationState() is asked, by the service's name
   * with nothing, and it answers (system, state). An answer for a system the session is not in (it was asked as
   * the session moved) is asked for once more; one that is the session's is kept, and after two that are not the
   * asking fails, as the client's raises. One asking at a time (the service's lock). Answers the pair as the
   * server gave it: the client's own readers take the state out of it. Tranquility's recordings have the call
   * once at each login and once after each change of solar system, answered (system, None) in high security.
   */
  function localOccupationRead(entry) {
    const reading = entry.localOccupationWork.then(async () => {
      const here = () => attribute(entry, "solarsystemid2");
      const of = (pair) => (Array.isArray(pair) && pair.length === 2 ? positive(pair[0]) : undefined);
      if (here() === null) return undefined;
      if (of(entry.localOccupation) === here()) return entry.localOccupation;
      const asked = () => {
        const form = shape(FW_WARZONE, LOCAL_OCCUPATION, [], null, contextFor(entry));
        ledger.note(FW_WARZONE, LOCAL_OCCUPATION, form);
        return byName(entry.session, FW_WARZONE, LOCAL_OCCUPATION, form);
      };
      let answer = await asked();
      if (of(answer) === undefined) throw fail("CALL_FAILED", "fwWarzoneSolarsystem.GetLocalOccupationState did not answer a solar system and its state.");
      if (of(answer) !== here()) answer = await asked();
      if (of(answer) === undefined || of(answer) !== here()) throw fail("CALL_FAILED", "fwWarzoneSolarsystem.GetLocalOccupationState did not answer for the solar system the session is in, asked twice.");
      entry.localOccupation = answer;
      return answer;
    });
    entry.localOccupationWork = reading.catch(() => {});
    return reading;
  }

  /**
   * infoPanelLocationInfo.UpdateSOVLocationInfo (335 to 341): the location panel shows whose the system is, and to
   * say it reads the local occupation state, where the session is in a solar system of known space or a
   * wormhole's (and its setting to show sovereignty is on, as it is until the pilot turns it off). The panel is
   * drawn as the pilot comes in and again for each solar system. In a system no faction holds it goes on to ask
   * for the system's sovereignty structures, which is not asked here yet.
   */
  function localOccupationWanted(entry) {
    return inKnownOrWormholeSpace(attribute(entry, "solarsystemid2")) ? localOccupationRead(entry) : Promise.resolve(undefined);
  }

  /**
   * dynamicResourceSvc.GetDynamicBountySettingForCurrentSystem (58 to 65): the bounty output of the system the
   * session is in, sm.RemoteSvc('dynamicBountyMgr').GetOutputForClientSolarSystem(), by the service's name with
   * nothing: (output, whether the dynamic bounty system is at work there). Kept ninety minutes from its keeping
   * (@expiring_memoize(5400): brennivin/threadutils.py 262 to 320), let go at a change of the session's solar
   * system (175 to 182), and replaced by the server's OnSystemDynamicBountyStateChanged (160 to 165). Its one
   * reader is the location panel (infoPanelLocationInfo.py 319 to 326), as it is drawn: as the pilot comes in, and
   * for each solar system. Where the server's global config has the dynamic bounty system switched off the client
   * asks nothing and takes (1.0, False); the game port keeps no global config and takes the switch as it is until
   * set: not thrown. Tranquility's recordings have the call once at each login and once after each change of solar
   * system, answered (1.0, False). One asking at a time; an answer that came for a system since left is not kept.
   */
  function bountyOutputRead(entry) {
    const reading = entry.bountyOutputWork.then(async () => {
      if (attribute(entry, "solarsystemid2") === null) return undefined;
      if (entry.bountyOutput && now() < entry.bountyOutput.until) return entry.bountyOutput.answer;
      const letGo = entry.bountyOutputLetGo;
      const form = shape(BOUNTY_MGR, BOUNTY_OUTPUT, [], null, contextFor(entry));
      ledger.note(BOUNTY_MGR, BOUNTY_OUTPUT, form);
      const answer = await byName(entry.session, BOUNTY_MGR, BOUNTY_OUTPUT, form);
      if (letGo === entry.bountyOutputLetGo) entry.bountyOutput = { answer, until: now() + BOUNTY_OUTPUT_GOOD_FOR_MS };
      return answer;
    });
    entry.bountyOutputWork = reading.catch(() => {});
    return reading;
  }

  // ── the wars, as the client's war service has them ────────────────────────

  /** The owner the war service's moniker is for (eveMoniker.GetWar, 184 to 192): the session's alliance, or its corporation where it has none. */
  const warOwner = (entry) => attribute(entry, "allianceid") ?? attribute(entry, "corpid");

  /**
   * war_cso.GetMoniker (57 to 67): the moniker is the one made for the session's owner. Where that owner is
   * another's by now, the old one is let go and another is made, which the next call binds before it is asked.
   */
  function warMonikerIsItsOwners(entry) {
    const owner = warOwner(entry);
    if (entry.warMonikerOwner !== owner) entry.monikers.delete(WAR_REGISTRY);
    entry.warMonikerOwner = owner;
  }

  /**
   * war_cso.GetWars(ownerID, forceRefresh) (98 to 106): an owner's wars as the war service keeps them, good for
   * twelve hours. Where none are kept, or they are older, they are asked for: self.GetMoniker().GetWars(ownerID),
   * on the service's moniker, with the owner alone, and what answers is kept (pilotWars.js). One asking after
   * another: of two askers at once the second is answered from what the first kept. An answer that cannot be kept
   * is handed on as it came. Tranquility's recordings of a login have the bind and the one call so, the owner the
   * pilot's corporation. With no owner to name nothing is asked.
   */
  function warsRead(entry, ownerID, forceRefresh = false) {
    const reading = entry.warsWork.then(async () => {
      if (ownerID === null) return undefined;
      const kept = entry.wars.kept(ownerID, now(), forceRefresh);
      if (kept !== undefined) return kept;
      warMonikerIsItsOwners(entry);
      ledger.note(WAR_REGISTRY, WARS_READ, shape(WAR_REGISTRY, WARS_READ, [ownerID], null, contextFor(entry)));
      const answer = await keptCall(entry, entry.monikers, WAR_REGISTRY, WAR_REGISTRY, () => monikerParams(entry, WAR_REGISTRY, undefined), WARS_READ, [ownerID], null);
      entry.wars.keep(ownerID, answer, now());
      // The thread reads the wars of the session's own owner: from this asking of them it has twelve hours.
      if (ownerID === warOwner(entry)) warsThread(entry);
      return answer;
    });
    entry.warsWork = reading.catch(() => {});
    return reading;
  }

  /**
   * war_cso.CheckForStartOrEndOfWar (172 to 182) and _CheckForWarStartingOrEnding (185): every ten seconds, with a
   * character on the session, the war service's thread reads GetWars(session.allianceid or session.corpid). That
   * is answered from what is kept until it is more than twelve hours old, and asked of the server then. Here: one
   * timer from each asking of the owner's wars, which asks again when the thread would (WARS_AGAIN_AFTER_MS), and
   * which nobody waits on. What the thread does with the wars it reads (which have just begun or ended) is the
   * client's own drawing, and nothing is asked for it.
   */
  function warsThread(entry) {
    warsThreadEnded(entry);
    if (warsAgainAfterMs === null || entry.ended) return;
    entry.warsTimer = timers.setTimeout(() => {
      entry.warsTimer = null;
      if (!sessions.has(entry.handle)) return;
      // Asked, and the thread goes on from that asking; where nothing was asked after all, it goes on from now.
      warsRead(entry, warOwner(entry)).catch(() => {}).then(() => {
        if (entry.warsTimer === null && sessions.has(entry.handle)) warsThread(entry);
      });
    }, warsAgainAfterMs);
    // The timer is not what keeps this process up.
    if (entry.warsTimer && typeof entry.warsTimer.unref === "function") entry.warsTimer.unref();
  }

  /** The pilot's session is over, or never came to be: the thread asks nothing more. */
  function warsThreadEnded(entry) {
    timers.clearTimeout(entry.warsTimer);
    entry.warsTimer = null;
  }

  /**
   * clone_grade_svc.get_clone_grade_with_grace_period (113): sm.RemoteSvc('subscriptionMgr').GetCloneGrade(), by the
   * service's name, asked for while there is none and kept.
   */
  async function cloneGradeRead(entry) {
    if (entry.cloneGrade === undefined) {
      ledger.note(SUBSCRIPTION_MGR, CLONE_GRADE, shape(SUBSCRIPTION_MGR, CLONE_GRADE, [], null));
      entry.cloneGrade = await entry.session.call(SUBSCRIPTION_MGR, CLONE_GRADE, []);
    }
    return entry.cloneGrade;
  }

  /** crimewatchSvc.GetMySecurityStatus (590): asked for while there is none, and kept. */
  async function securityStatusRead(entry) {
    if (entry.securityStatus === undefined) entry.securityStatus = await crimewatchAsked(entry, OWN_SECURITY_STATUS);
    return entry.securityStatus;
  }

  /**
   * crimewatchSvc.GetJumpTimers (605 to 608): sm.RemoteSvc('jumpTimers').GetTimers(session.charid), by the service's
   * name, asked for while there is none and kept: the jump activation's end, the jump fatigue's end and when they
   * were last reckoned, each a time or None. The client's timer panel wants them as it is made
   * (ui/crimewatch/crimewatchTimers.py 335, 355), which is as a pilot comes in, docked or in space; from then on
   * the server's OnJumpTimersUpdated says what they are (610 to 612) and nothing is asked. An answer of three Nones
   * is an answer, and is kept as any. Tranquility's four recordings of a login each have the one call, answered
   * (None, None, None).
   */
  async function jumpTimersRead(entry) {
    if (entry.jumpTimers === undefined) {
      const form = shape(JUMP_TIMERS, JUMP_TIMERS_READ, [entry.characterID], null, contextFor(entry));
      ledger.note(JUMP_TIMERS, JUMP_TIMERS_READ, form);
      entry.jumpTimers = await byName(entry.session, JUMP_TIMERS, JUMP_TIMERS_READ, form);
    }
    return entry.jumpTimers;
  }

  /**
   * What a docked client's lobby asks as it comes up, on the pilot's own session and as the client sends each.
   * As a character is chosen in a station: the offices its corporation rents (officeManager.corp_offices), the
   * station's own item and its guests (station/base.py GetStationItem, GetGuests), and the map's stations
   * (uisvc.GetStation), in the order the server's log of a retail client logging in docked has them. As a pilot
   * docks: the item and the guests, the other two being the client's still. A pilot in no station is asked none.
   * Each is kept as its own service keeps it, so that what the page reads of them after is answered from here;
   * and each fails for itself.
   */
  async function lobbyRead(entry, { chosen = false } = {}) {
    if (attribute(entry, "stationid") === null) return;
    const form = (service, method) => shape(service, method, [], null, contextFor(entry));
    if (chosen) await keptRead(entry, OFFICE_MANAGER, "GetMyCorporationsOffices", form(OFFICE_MANAGER, "GetMyCorporationsOffices")).catch(() => {});
    await stationRead(entry, "stationSvc", "GetStationItemBits", form("stationSvc", "GetStationItemBits")).catch(() => {});
    await stationRead(entry, "station", "GetGuests", form("station", "GetGuests")).catch(() => {});
    if (chosen) await asks(entry, "map", "GetStationInfo").catch(() => {});
  }

  /**
   * structureServices._FetchOnlineServices (54 to 58): the services of the structure the pilot is docked in, asked
   * as it docks and as its character is chosen in one, and kept as its service keeps them. A pilot in no structure
   * is asked none. It fails for itself: what could not be asked is asked for when it is next wanted.
   */
  function structureServicesRead(entry) {
    const structureID = attribute(entry, "structureid");
    if (structureID === null) return Promise.resolve();
    return keptRead(entry, STRUCTURE_SETTINGS, STRUCTURE_SERVICES, shape(STRUCTURE_SETTINGS, STRUCTURE_SERVICES, [structureID], null, contextFor(entry))).then(() => {}, () => {});
  }

  /**
   * structureGuests.GetGuests (21 to 26): the guests of the structure the pilot is docked in, answered from what is
   * kept, and asked for, and noted, where none are. One reading at a time, so that two that find none kept ask
   * once. An answer that is no dict is handed on as it came with nothing kept of it. (One that comes after the
   * pilot has left the structure is kept as that structure's, and is never read: what is kept is let go at every
   * change of the session's structure, the docking that would read it among them.)
   */
  function structureGuestsRead(entry, form) {
    const reading = entry.structureGuestsWork.then(async () => {
      const structureID = attribute(entry, "structureid");
      if (entry.structureGuests.known(structureID)) return entry.structureGuests.read();
      ledger.note(STRUCTURE_GUESTS, STRUCTURE_GUESTS_READ, form);
      const answered = await byName(entry.session, STRUCTURE_GUESTS, STRUCTURE_GUESTS_READ, form);
      if (isADict(answered)) entry.structureGuests.received(structureID, answered);
      return answered;
    });
    entry.structureGuestsWork = reading.catch(() => {});
    return reading;
  }

  /**
   * The lobby's guests panel (dockedUI/guests.py 98 to 101), as a pilot docks in a structure and as its character
   * is chosen in one: the structure's guests, asked for where none are kept. A pilot in no structure is asked
   * none. It fails for itself: what could not be asked is asked for when it is next wanted.
   */
  function structureGuestsAsked(entry) {
    const structureID = attribute(entry, "structureid");
    if (structureID === null) return Promise.resolve();
    return structureGuestsRead(entry, shape(STRUCTURE_GUESTS, STRUCTURE_GUESTS_READ, [structureID], null, contextFor(entry))).then(() => {}, () => {});
  }

  /** Every colony kept is forgotten, and asked for when it is next wanted. What a planet carries stays. */
  function forgetColonies(entry) {
    for (const keptAs of [...entry.planetReads.keys()]) if (keptAs.startsWith(`${PLANET_INFO}:`)) entry.planetReads.delete(keptAs);
  }

  /** One of the pilot's own writes that changes what a service keeps, done or refused, by name or on an object: what was kept may not be so. */
  function forgetKeptAfter(entry, service, method) {
    for (const [reads, keeper] of Object.entries(KEPT_UNTIL_CHANGED)) {
      if (Object.hasOwn(keeper.writes, service) && keeper.writes[service].has(method)) entry.kept[reads].forget();
    }
  }

  /** A read a service keeps the answer of (KEPT_UNTIL_CHANGED): answered from what is kept, and asked for, and noted, where nothing is. */
  function keptRead(entry, service, method, form) {
    return entry.kept[service].read(KEPT_UNTIL_CHANGED[service].keptAs(method, form, entry.session.attributes), () => {
      ledger.note(service, method, form);
      return byName(entry.session, service, method, form);
    });
  }

  /**
   * bookmarkSvc.GetBookmarks (69 to 79): the bookmark manager's three lists as they are kept, asked for, and noted,
   * where none are; less the bookmarks whose time has run out by the server's clock, which the client's service
   * takes out of what it keeps by itself and asks nothing for. (It looks for them when five minutes have gone by
   * since it last looked; here every reading looks.) An answer that is not the three lists is handed on, and not kept.
   */
  async function bookmarksRead(entry, form) {
    const answered = await keptRead(entry, BOOKMARK_MGR, ACTIVE_BOOKMARKS, form);
    if (isTheThreeLists(answered)) return withoutExpiredBookmarks(answered, entry.session.serverNow());
    entry.kept[BOOKMARK_MGR].forget();
    return answered;
  }

  /**
   * bookmarkSvc.ACLBookmarkLocation (617 to 619): a place bookmarked on the park is answered the bookmark's ID, its
   * item, its type, its place, its system and when it runs out. With an ID among them the client makes a bookmark
   * of the eight and of what it sent (NewBookmarkCreated), keeps it beside the rest, and asks nothing; with none it
   * keeps what it has, as it does where the call is refused, which never comes here. So here, where the call was
   * the client's own. One that was not, or an answer that is not the eight, leaves nothing the client would keep:
   * what is kept is let go, and asked for when it is next wanted. Where nothing is kept there is nothing to work it
   * into, and the next reading asks.
   */
  function afterBookmarkCall(entry, service, method, form, result) {
    if (service !== "beyonce" || method !== BOOKMARK_LOCATION) return;
    const answered = Array.isArray(result) || isAList(result) ? itemsOf(result) : [];
    if (form.status === "differs" || answered.length !== 8) {
      entry.kept[BOOKMARK_MGR].forget();
      return;
    }
    const [bookmarkID, itemID, typeID, x, y, z, locationID, expiry] = answered;
    if (!bookmarkID) return;
    const [, folderID, name, comment] = form.args;
    const made = bookmarkMade({
      bookmarkID, folderID, itemID, typeID, name, comment, expiry, x, y, z, locationID,
      created: BigInt(Math.trunc(entry.session.serverNow())) * 10000n + FILETIME_OF_UNIX_EPOCH,
      subfolderID: (form.kwargs && form.kwargs.subfolderID) ?? null,
      creatorID: entry.characterID,
    });
    entry.kept[BOOKMARK_MGR].amend("active", (lists) => (isTheThreeLists(lists) ? withBookmark(lists, made, bookmarkID) : undefined));
  }

  // ── the price table, as the client's cfg has it ───────────────────────────

  /**
   * eveCfg.LoadCfgData (400 to 402) and GetAveragePricesThread (522 to 525): the client's cfg starts with no prices
   * and starts a thread that waits two seconds and asks sm.RemoteSvc('config').GetAverageMarketPrices() once. What
   * answers is the cfg's for as long as the client runs. Here: once for a pilot's session, by a timer nobody waits
   * on. A table that could not be asked for is none, as the cfg's stays empty, and is not asked for again.
   */
  function averagePricesThread(entry) {
    if (averagePricesAfterMs === null) return;
    entry.averagePricesTimer = timers.setTimeout(() => {
      entry.averagePricesTimer = null;
      ledger.note("config", "GetAverageMarketPrices", PRICES_AS_THE_CLIENT_ASKS);
      Promise.resolve().then(() => entry.session.call("config", "GetAverageMarketPrices", [], null))
        .then((answered) => { entry.averagePrices = pricesByType(answered); }, () => {});
    }, averagePricesAfterMs);
    // The timer is not what keeps this process up.
    if (entry.averagePricesTimer && typeof entry.averagePricesTimer.unref === "function") entry.averagePricesTimer.unref();
  }

  /** The pilot's session is over, or never came to be: the thread that had not asked yet asks nothing. */
  function averagePricesThreadEnded(entry) {
    timers.clearTimeout(entry.averagePricesTimer);
    entry.averagePricesTimer = null;
  }

  /**
   * inventorycommon.typeHelpers.GetAveragePrice and GetAdjustedAveragePrice (92 to 110), off the price table the
   * pilot's cfg has: a type's two prices, each null where the table has not the type (the client's KeyError). One
   * type's average is the client's own to say (103), whatever the table has of it. Null where the pilot has no
   * table: before its asking is answered, and where it could not be asked. (The client reads none of any type
   * then; who reckons a number from prices is to know there are none.)
   */
  function averageMarketPrice(sessionFields = {}, bridgeSessionID = undefined, typeID = null) {
    const entry = held(bridgeSessionID, sessionFields);
    if (entry.averagePrices === null) return null;
    const type = positive(typeID);
    const [averagePrice, adjustedPrice] = (type === null ? undefined : entry.averagePrices.get(type)) ?? [null, null];
    return { averagePrice: type === TYPE_WITH_ITS_OWN_AVERAGE ? ITS_OWN_AVERAGE : averagePrice, adjustedPrice };
  }

  // ── the facilities, as the client's facility service keeps them ──────────

  /** The region's facilities as they are kept, asked for, and noted, where they are not (facilitySvc._PrimeFacilities, 128). */
  const regionsFacilities = (entry) => keptRead(entry, FACILITY_MANAGER, "GetFacilities", shape(FACILITY_MANAGER, "GetFacilities", [], null, contextFor(entry)));

  /**
   * A facility asked for by itself, facilityManager.GetFacility(facilityID), and what is answered kept by its ID in
   * the place of anything kept of it (_PrimeFacility, 141). Fails as the asking fails. Where the region's are not
   * kept there is nothing to put it among, and the next reading of them asks for them all.
   */
  async function facilityAsked(entry, facilityID) {
    ledger.note(FACILITY_MANAGER, "GetFacility", A_FACILITY_AS_THE_CLIENT_ASKS);
    const row = await entry.session.call(FACILITY_MANAGER, "GetFacility", [facilityID], null);
    entry.kept[FACILITY_MANAGER].amend("region", (facilities) => (isAList(facilities) ? withFacility(facilities, facilityID, row) : undefined));
    return row;
  }

  /** A facility let go of what is kept (facilities.pop, 44 and 102; the `del`, 110), where `only` says so of it. */
  function facilityLetGo(entry, facilityID, only = () => true) {
    return entry.kept[FACILITY_MANAGER].amend("region", (facilities) => {
      if (!isAList(facilities)) return undefined;
      const kept = facilityAmong(facilities, facilityID);
      return kept && only(kept) ? withFacility(facilities, facilityID) : facilities;
    });
  }

  /**
   * facilitySvc.Reload(facilityID) (102 to 103) and each turn of OnFacilitiesUpdated (44 to 48): the facility is
   * let go and asked for by itself, one after another. Never fails: what the server will not answer for stays let
   * go, as it does at the client's notice (its `except UserError: pass`), and nobody waits on this.
   */
  function facilitiesAskedAfresh(entry, facilityIDs) {
    const asking = entry.facilitiesWork.then(async () => {
      for (const facilityID of facilityIDs) {
        facilityLetGo(entry, facilityID);
        await facilityAsked(entry, facilityID).catch(() => {});
      }
    });
    entry.facilitiesWork = asking.catch(() => {});
    return asking;
  }

  /**
   * facilitySvc.GetFreshFacility (107 to 112), which is what the client's industry service gives a job for its
   * facility (industrySvc.CreateJob, 109). One that is kept and has rig modifiers is let go; the region's are asked
   * for where they are not kept (GetFacility, 68); and the facility, where it is not among them, is asked for by
   * itself and kept (71). Answers the facility's row, or null where none is named (`if facilityID:`). Fails as
   * the asking of it fails: the server will not answer for a facility it does not know.
   */
  async function freshFacility(sessionFields = {}, bridgeSessionID = undefined, facilityID = null, job = null) {
    const entry = held(bridgeSessionID, sessionFields);
    const id = positive(facilityID);
    if (id === null) return null;
    // The job a window has was given its facility when it was made, once (CreateJob, 109): asked of for the same
    // job again, the facility is the one kept, where it is kept still.
    const made = job ? jobMadeAs(job.blueprintID, job.activityID, id) : null;
    return run(entry, FACILITY_MANAGER, "GetFacility", async () => {
      const had = made !== null && entry.jobMade === made ? facilityAmong(await regionsFacilities(entry), id) : null;
      const row = had ?? await facilityGivenAfresh(entry, id);
      if (made !== null) entry.jobMade = made;
      return wireToBridgeJson(row);
    });
  }

  /**
   * A facility's places for an owner, as facilitySvc.GetFacilityLocations keeps them: what was answered for the
   * two is what is answered until more than a minute has gone by since. Two that find nothing kept ask once.
   * What could not be asked is not kept.
   */
  function facilityPlaces(entry, args, ask) {
    const keptAs = args.map((each) => String(positive(each))).join(":");
    const kept = entry.facilityPlaces.get(keptAs);
    if (kept && now() - kept.at <= FACILITY_PLACES_KEPT_MS) return kept.answer;
    const record = { at: Infinity, answer: null };
    record.answer = Promise.resolve().then(ask).then((answer) => { record.at = now(); return answer; });
    entry.facilityPlaces.set(keptAs, record);
    record.answer.catch(() => { if (entry.facilityPlaces.get(keptAs) === record) entry.facilityPlaces.delete(keptAs); });
    return record.answer;
  }

  /** industryMonitor.DisconnectJob with a monitor's number or None, as the client's industry service sends it (313): noted as it is sent. */
  function monitorLetGo(entry, monitorID) {
    const form = shape(INDUSTRY_MONITOR, "DisconnectJob", [monitorID], null, contextFor(entry));
    ledger.note(INDUSTRY_MONITOR, "DisconnectJob", form);
    return byName(entry.session, INDUSTRY_MONITOR, "DisconnectJob", form);
  }

  /**
   * The Industry window closed: industryWnd.Close (107 to 110) is industrySvc.DisconnectJob(self.jobData), which
   * lets a monitor go `if job is None or self.monitoring() == job` (310 to 314). So a window whose job is the one
   * monitored lets that monitor go by its number; one with no job sends None; and one whose job was installed
   * sends nothing, its job being the server's and not the one monitored. The window has no job after.
   * Fails as the sending fails.
   */
  async function industryWindowClosed(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const job = entry.windowJob;
    entry.windowJob = null;
    entry.jobMade = null;
    if (job === A_JOB_INSTALLED) return { sent: false };
    await run(entry, INDUSTRY_MONITOR, "DisconnectJob", () => monitorLetGo(entry, job ? job.monitorID : null));
    return { sent: true };
  }

  /**
   * The window's job let go while the window stays (industryWnd.OnIndustryRemoveBlueprint, 434 to 437:
   * self.jobData = None). The job is gone and with it the service's hold on the one monitored, which is a weak
   * one; nothing is sent, and its monitor is left. The next job the window makes is made anew.
   */
  function industryJobLetGo(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    entry.windowJob = null;
    entry.jobMade = null;
  }

  /** facilitySvc.GetFreshFacility (107 to 112), of a facility that is named: its row, as it is then kept. */
  async function facilityGivenAfresh(entry, id) {
    facilityLetGo(entry, id, hasRigModifiers);
    const kept = facilityAmong(await regionsFacilities(entry), id);
    return kept ?? await facilityAsked(entry, id);
  }

  /**
   * industrySvc._JobInstance (190 to 197), for each row of jobs the server answered, in their order: `if
   * data.facilityID: job.facility = self.facilitySvc.GetFreshFacility(data.facilityID)`. So a job at a facility
   * with rig modifiers has it asked for by itself each time the job is made, one asking for each such job, and a
   * job at a facility that is not among the region's has it asked for once.
   *
   * Never fails. At the client a facility the server will not answer for fails the making of the jobs; here the
   * jobs are answered all the same, the facility is left not kept, and the rest are given theirs.
   */
  async function jobsGivenTheirFacilities(entry, rows) {
    for (const row of rows) {
      const id = rowsFacility(row);
      if (id !== null) await run(entry, FACILITY_MANAGER, "GetFacility", () => facilityGivenAfresh(entry, id)).catch(() => {});
    }
  }

  /** One of the client's own askings of a service by its name, with nothing: noted as it is sent. */
  function asks(entry, service, method) {
    const form = shape(service, method, [], null, contextFor(entry));
    ledger.note(service, method, form);
    return byName(entry.session, service, method, form);
  }

  /**
   * shipFighterState.OnSessionChanged (ui/inflight/squadrons/shipFighterState.py 72 to 74): at any change of the
   * session's ship the client's ship fighter state asks the ship's fighters again, fightersSvc.GetFightersForShip
   * (parklife/fightersSvc.py 99), which is sm.RemoteSvc('fighterMgr').GetFightersForShip(): by the service's name,
   * with nothing sent, from whatever ship and wherever. The choosing of a character is such a change. Tranquility's
   * recordings have it twelve times, each answered ([], [], {}). No page shows a ship's fighters yet: it is asked
   * as the client asks it, and nothing is kept of the answer.
   */
  const fightersAsked = (entry) => asks(entry, "fighterMgr", "GetFightersForShip");

  /** appConst.agentMissionStateAccepted. */
  const AGENT_MISSION_STATE_ACCEPTED = 2;
  /** A journal's time as a number to put in order by; null where it has none. */
  const journalTime = (value) => (typeof value === "bigint" ? value : typeof value === "number" && Number.isFinite(value) ? BigInt(Math.trunc(value)) : null);

  /**
   * missionObjectivesTracker.GetAgentMissions (missions/client/missionObjectivesTracker.py 52 to 82): the agents of
   * the journal's missions that the pilot has accepted and that have not run out, in the order of their running
   * out (SortListOfTuples by expirationTime; one with no time comes first, as Python 2 puts None before a number).
   */
  function acceptedMissionAgents(journal, wallclock) {
    const missions = [];
    for (const mission of journal ? journal[0].items : []) {
      if (!Array.isArray(mission)) continue;
      const expirationTime = journalTime(mission[5]);
      if (Number(mission[0]) !== AGENT_MISSION_STATE_ACCEPTED || (expirationTime && expirationTime < wallclock)) continue;
      const agentID = positive(mission[4]);
      if (agentID !== null) missions.push({ expirationTime, agentID });
    }
    // Array.prototype.sort is stable, as Python's sorted is.
    missions.sort((a, b) => (a.expirationTime === b.expirationTime ? 0 : a.expirationTime === null ? -1 : b.expirationTime === null ? 1 : a.expirationTime < b.expirationTime ? -1 : 1));
    return missions.map((mission) => mission.agentID);
  }

  /**
   * missionObjectivesTracker._InitializeCurrentAgentMissionInfo (267 to 272) and _UpdateCurrentAgentMissionInfo (274
   * to 279): the client keeps, for each mission the pilot has accepted, what the server says is left of it, and
   * asks it afresh of every one, one after another: sm.RemoteSvc('missionTrackerMgr').GetMissionInfoItems(agentID),
   * by the service's name. It does so at every change of its session once a character is on it (OnSessionChanged,
   * 89 to 94, by UpdateMissionStatusForSessionChange, 213) and as each warp ends (OnClientEvent_WarpFinished, 84 to
   * 87). The missions are read from the journal (GetAgentMissions asks the journal service for them, which reads
   * what it has to). With none accepted nothing is asked. Tranquility's recordings have it so: a pilot on three
   * missions, three calls at each session change and three at each warp's end. No page shows what is answered
   * yet: it is asked as the client asks it, and nothing is kept of the answer.
   */
  function missionInfoAsked(entry) {
    const asking = entry.missionInfoWork.then(async () => {
      await journalUpToDate(entry);
      for (const agentID of acceptedMissionAgents(entry.journal.read(), filetime(now()))) {
        const form = shape("missionTrackerMgr", "GetMissionInfoItems", [agentID], null, contextFor(entry));
        ledger.note("missionTrackerMgr", "GetMissionInfoItems", form);
        await byName(entry.session, "missionTrackerMgr", "GetMissionInfoItems", form);
      }
    });
    entry.missionInfoWork = asking.catch(() => {});
    return asking;
  }

  /**
   * The achievements' event handler (achievements/client/eventHandler.py). At every change of the session's ship
   * to a ship (OnSessionChanged, 251 to 260: 'shipid' in the change and the new one not None) it reckons whether two
   * turret hardpoints have come free (OnHighSlotFittingChanged, 419 to 429): godma's item of the session's ship,
   * and where that is of the ship category, invCache.GetInventoryFromId(shipID).GetAvailableTurretSlots(): the
   * ship's own inventory, bound of the manager where the pilot is, asked with nothing sent. A capsule is a ship.
   * The choosing of a character is such a change. In the client godma has the ship by then: it primes at the
   * session's change, before this in every recording. The game port's godma primes when something first wants the
   * ship's readings, so the asking is owed from the change and made as godma is next primed (primeGodma), which a
   * page's first reading of the flight brings about. Tranquility's recordings have the call in 20, at a login, at
   * an ejection and at a boarding. Nothing is kept of the answer: it feeds the client's own operations, which no
   * page has.
   */
  function turretSlotsAsked(entry) {
    const asking = entry.turretSlotsWork.then(async () => {
      if (!entry.turretSlotsOwed) return;
      entry.turretSlotsOwed = false;
      const place = whereabouts(entry);
      if (place.shipID === null) return;
      const item = entry.dogma.item(place.shipID);
      if (!item || positive(item.categoryID) !== CATEGORY_SHIP) return;
      // invCache.GetInventoryFromId(itemid, passive=0), noted as the bind of an inventory it is.
      ledger.note("invbroker", "GetInventoryFromId", BOUND_AS_THE_CLIENT_BINDS);
      const shipInventory = boundObjectID(await inventoryCall(entry, "location", "GetInventoryFromId", [argumentsToWire(place.shipID), 0]));
      ledger.note("invbroker", "GetAvailableTurretSlots", shape("invbroker", "GetAvailableTurretSlots", [], null, contextFor(entry)));
      await entry.session.callBound(shipInventory, "GetAvailableTurretSlots", [], null);
    });
    entry.turretSlotsWork = asking.catch(() => {});
    return asking;
  }

  /**
   * An account's connection: the retail client at its character selection and
   * creation screens, logged in as the account and nothing more. One for an
   * account, opened by the first thing asked on it.
   */
  function accountLine(accountID, userName) {
    const have = accountLines.get(accountID);
    if (have) return have;
    const line = { session: null, opening: null, calls: 0, timer: null };
    const forget = () => {
      if (accountLines.get(accountID) === line) accountLines.delete(accountID);
      timers.clearTimeout(line.timer);
      line.timer = null;
    };
    line.hangUp = () => {
      forget();
      if (line.session) line.session.close();
    };
    line.opening = (async () => {
      let transport;
      try {
        transport = await connect();
      } catch {
        throw fail("EVE_GATEWAY_UNREACHABLE", "The game server is unreachable.");
      }
      line.session = createSession(transport);
      // The server hanging up, or anything else that ends it: the next thing asked opens another.
      line.session.onClose(forget);
      await line.session.login(userName, passwordFor(userName));
      if (positive(line.session.attributes.userid) !== accountID) {
        throw fail("CALL_REFUSED", "The game server logged that name in as a different account.");
      }
      return line.session;
    })();
    accountLines.set(accountID, line);
    return line;
  }

  /**
   * A call the retail client makes before a character is chosen. On its
   * character selection and creation screens the client is logged in as the
   * account and nothing more, and it asks `charUnboundMgr` whatever those
   * screens need, all on the one connection.
   *
   * The BFF has no such screen open. What it asks for an account in one go
   * (making a character is five calls) is asked on one connection, logged in
   * as the client logs in, and the connection is closed when nothing has been
   * asked on it for a little while.
   *
   * The server lets an account log in beside its own pilot: only taking over a
   * character that is online puts the earlier session off
   * (charService.js, "Login takeover"). So this does not disturb a pilot of
   * the same account that something else is flying.
   */
  async function accountCall(service, method, args = [], kwargs = null, sessionFields = {}) {
    const accountID = positive(sessionFields && sessionFields.userid);
    const userName = String((sessionFields && sessionFields.userName) || "").trim();
    if (accountID === null) throw fail("CALL_INVALID", "Call session requires a positive integer userid.");
    if (!userName) throw fail("CALL_INVALID", "A game-port login needs the account's name.");
    assertAllowed(service, method);
    // Choosing a character brings it online on the connection it is chosen on, and this one is not kept.
    if (method === "SelectCharacterID") throw fail("CALL_NOT_ALLOWED", "A character is chosen by selecting it, not by a call of the account's.");
    const line = accountLine(accountID, userName);
    timers.clearTimeout(line.timer);
    line.timer = null;
    line.calls += 1;
    // No session was handed out for this call, so there is none for the caller to have lost.
    const failed = (error) => {
      const mapped = toPilotError(error, service, method);
      return mapped.code === "SESSION_NOT_FOUND" ? fail("CALL_FAILED", `${service}.${method} failed: the game server closed the connection.`) : mapped;
    };
    try {
      let session;
      try {
        session = await line.opening;
      } catch (error) {
        line.hangUp();
        throw failed(error);
      }
      try {
        const form = shape(service, method, args, kwargs, {});
        ledger.note(service, method, form);
        const result = await byName(session, service, method, form);
        return { service, method, result: wireToBridgeJson(result), notifications: [] };
      } catch (error) {
        // The server saying no is an answer, and the client stays on its screen. Anything else, and the connection is not asked again.
        if (!(error && error.code === "GAME_CALL_REFUSED")) line.hangUp();
        throw failed(error);
      }
    } finally {
      line.calls -= 1;
      if (line.calls === 0 && accountLines.get(accountID) === line) {
        line.timer = timers.setTimeout(line.hangUp, accountIdleMs);
        // A connection waiting to be closed is nothing to keep the process alive for.
        if (line.timer && typeof line.timer.unref === "function") line.timer.unref();
      }
    }
  }

  async function releaseBridgeSession(bridgeSessionID, sessionFields = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    end(entry, "session_released");
    // Closing the connection is the whole of a retail logoff, and the server
    // acts on it a moment later. "Released" is only said once it has.
    if (typeof isOnline === "function") {
      for (let waited = 0; waited < releaseSettleMs; waited += 100) {
        if ((await isOnline(entry.accountID, entry.characterID)) === false) {
          return { released: true, characterID: entry.characterID };
        }
        await sleep(100);
      }
      return { released: false, characterID: entry.characterID };
    }
    return { released: true, characterID: entry.characterID };
  }

  /**
   * The active ship's type and whether it is a capsule, from the ship's own row as godma holds it: primed with
   * GetAllInfo once for a ship in a place, as the client is. The client never asks ShipGetInfo.
   * Location is still worth reporting where godma could not be primed: an unknown type says so, and is never guessed.
   */
  async function shipFacts(entry, place) {
    await shipReadings(entry, place);
    const item = entry.dogma.item(place.shipID);
    const typeID = item ? positive(item.typeID) : null;
    const groupID = item ? positive(item.groupID) : null;
    return { shipID: place.shipID, typeID, groupID, isCapsule: typeID === null || groupID === null ? null : groupID === GROUP_CAPSULE };
  }

  /** Where the session says the pilot is. In space is `solarsystemid` set, as on any retail session. */
  function whereabouts(entry) {
    const stationID = attribute(entry, "stationid");
    const structureID = attribute(entry, "structureid");
    const inSpace = !stationID && !structureID && attribute(entry, "solarsystemid") !== null;
    return {
      inSpace,
      stationID,
      structureID,
      solarSystemID: attribute(entry, "solarsystemid2") ?? attribute(entry, "solarsystemid"),
      shipID: attribute(entry, "shipid"),
    };
  }

  /**
   * godma.Prime: the ship's items and their attributes, from the dogma location
   * bound for where the pilot is, in one call. Asked once for a ship in a
   * place; after that godma is told of each change. Answers what dogma says of
   * the ship now, or null if it could not be asked.
   */
  /** What godma is primed for: a ship in a place. It is primed again for another ship, or the same one somewhere else. */
  const primedFor = (entry, place) => `${place.shipID}@${place.stationID ?? place.structureID ?? attribute(entry, "solarsystemid")}`;

  async function shipReadings(entry, place) {
    const loadedFor = primedFor(entry, place);
    if (entry.dogmaLoaded !== loadedFor) {
      // Once for a ship in a place means once however many want its readings while the asking is out: the client
      // has one godma, and one priming of it. Each of them waits for the one answer.
      if (!entry.dogmaPriming || entry.dogmaPriming.for !== loadedFor) {
        const priming = { for: loadedFor, done: null };
        priming.done = primeGodma(entry, place, loadedFor).finally(() => {
          if (entry.dogmaPriming === priming) entry.dogmaPriming = null;
        });
        entry.dogmaPriming = priming;
      }
      if (!(await entry.dogmaPriming.done)) return null; // the snapshot is still worth having; the readings say unknown
    }
    return entry.dogma.shipReadings(place.shipID);
  }

  /** The asking itself. True where godma is primed for the ship in the place; false where dogma could not be asked; fails where the session is lost. */
  async function primeGodma(entry, place, loadedFor) {
    try {
      // godma.GetDogmaLM: the dogma location bound for where the pilot is, kept and asked everything of.
      ledger.note("dogmaIM", "GetAllInfo", DOGMA_AS_GODMA_PRIMES);
      // godma.Prime (2405 to 2409): each of the three is asked for where godma does not hold it. The character
      // is held from the priming that brought it; the ship is let go at every change that primes again
      // (ProcessSessionChange, 1154 to 1170: `del self.invByID[session.shipid]`), and so is the structure, which is
      // not on its list of what to keep. `session.shipid and ...` and `session.structureid and ...` are None
      // where the session has none. So a session's first priming is (True, True, None), and each after it
      // (False, True, None); in a structure the third is True.
      const asking = [!entry.dogma.holdsCharacter(), place.shipID ? true : null, place.structureID ? true : null];
      const allInfo = await monikerCall(entry, "dogmaIM", "GetAllInfo", asking);
      // What godma let go before it asked: every inventory but the character's.
      entry.dogma.purge();
      entry.dogma.loadAllInfo(allInfo);
      entry.dogmaLoaded = loadedFor;
      if (entry.targetsOwed) targetsRefreshed(entry).catch(() => {});
      // The achievements' eventHandler.OnHighSlotFittingChanged: godma has the ship now, and its turret slots were owed.
      if (entry.turretSlotsOwed) turretSlotsAsked(entry).catch(() => {});
      // The ship's own row, as the server gave it: what ShipGetInfo would answer, were it asked.
      const rows = keyValField(wireToBridgeJson(allInfo), "shipInfo");
      const own = rows && Array.isArray(rows.entries) ? rows.entries.find(([itemID]) => positive(itemID) === place.shipID) : null;
      entry.shipRow = own ? own[1] : null;
      return true;
    } catch (error) {
      const mapped = toPilotError(error, "dogmaIM", "GetAllInfo");
      if (mapped.code === "SESSION_NOT_FOUND") {
        end(entry, "connection_closed");
        throw mapped;
      }
      return false;
    }
  }

  /**
   * michelle.UpdateBallpark: a ballpark while the session is in a solar system
   * and not docked, and none otherwise; a new one for a new system.
   */
  function syncSpace(entry) {
    const place = whereabouts(entry);
    const wanted = place.inSpace ? attribute(entry, "solarsystemid") : null;
    if (entry.space && entry.space.solarSystemID !== wanted) {
      entry.space.release();
      entry.space = null;
      // Its orders were to a ship in that ballpark.
      entry.lastMove = null;
    }
    if (wanted !== null && !entry.space) {
      entry.space = createSpace({
        session: entry.session,
        solarSystemID: wanted,
        sleep,
        simTime: entry.clock.simTime,
        askFormations: () => formationsKnown(entry),
        onError: (error, what) => onSpaceError(error, what, entry.characterID),
        // missionObjectivesTracker.OnClientEvent_WarpFinished (84 to 87): as a warp of the pilot's own ship ends, each
        // accepted mission's agent is asked what is left of it. The client's event comes of its warp effect, which
        // looks every half second of the simulation whether the ship's ball is still in warp
        // (environment/effects/Warp.py, 523); here it is the ball's own leaving of warp.
        onPost: (name, id) => {
          if (name === "OnDeactivatingWarp" && sessions.has(entry.handle) && positive(id) === positive(attribute(entry, "shipid"))) missionInfoAsked(entry).catch(() => {});
        },
      });
      // michelle.DoDestinyUpdate: the dogma messages riding with a ballpark update are scattered as OnMultiEvent, which is godma's.
      entry.space.park.onMultiEvent = (messages) => entry.dogma.multiEvent(messages);
      // targetMgr.DoBallsRemove: a ball that goes is no target any more.
      entry.space.park.onBallsRemoved = (gone) => entry.targets.ballsRemoved(gone.map((each) => each.id));
      // Nobody waits on this: the state arrives when the server has answered the bind.
      Promise.resolve(entry.space.start()).catch((error) => onSpaceError(error, "start", entry.characterID));
    }
  }

  async function readFlightStatus(bridgeSessionID, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    const ship = place.shipID ? await shipFacts(entry, place) : null;
    return {
      flight: {
        inSpace: place.inSpace,
        docked: !place.inSpace && Boolean(place.stationID || place.structureID),
        solarSystemID: place.solarSystemID,
        stationID: place.stationID,
        structureID: place.structureID,
        shipID: place.shipID,
        shipTypeID: ship ? ship.typeID : null,
        // The hull's group, from the same row: what the client's lobby tells a corvette by (corvetteButton.py,
        // station.CreateNewbieShip). The gateway's flight does not say it.
        shipGroupID: ship ? ship.groupID : null,
        shipIsCapsule: ship ? ship.isCapsule : null,
        // session.corprole: the roles the pilot has in its corporation, as the server's session has them now. The
        // client's lobby reads its buttons off it (dockedUI/controllers/baseController.py, _HasRole). A 64-bit
        // mask, so as its digits. The BFF keeps it for itself and hands the page none of it.
        corpRole: String(wholeOf(entry.session.attributes.corprole) ?? 0n),
        // session.corpid: the corporation the pilot is in, as the server's session has it now. A pilot's
        // corporation changes under it (one joined, left or founded), and the BFF's routes that go by the pilot's
        // corporation are to go by this one. The gateway's flight does not say it. The BFF keeps it for itself, as
        // it keeps the roles, and hands the page none of it.
        corporationID: attribute(entry, "corpid"),
        // Movement is the pilot's own ball in its ballpark; nothing to say when docked or before the state has come.
        ...(place.inSpace && entry.space && entry.space.park.validState ? projectFlight(entry.space.park) : { shipMode: null, shipSpeedFraction: null }),
      },
      notifications: drain(entry),
    };
  }

  async function readSpaceSnapshot(bridgeSessionID, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    // The pace the pilot's clock is meant to hold (blue.os.desiredSimDilation): what the client's time dilation indicator reads.
    const timeDilation = entry.clock.timeDilation;
    if (place.inSpace) {
      const park = entry.space ? entry.space.park : null;
      const readings = park && park.validState ? await shipReadings(entry, place) : null;
      return {
        // Until the server's state has arrived there is a park and nothing in it.
        space: park && park.validState
          ? { ...projectSpace(park, { solarSystemID: place.solarSystemID, shipID: place.shipID, readings, warpDestination: entry.warpDestination ?? null, alignTarget: alignTargetOf(entry, park), simTime: entry.space.simTime() }), timeDilation }
          : { inSpace: true, solarSystemID: place.solarSystemID, shipID: place.shipID, sampledAtMs: now(), entities: [], ship: null, timeDilation },
        notifications: drain(entry),
      };
    }
    return {
      space: { inSpace: false, solarSystemID: place.solarSystemID, shipID: place.shipID, sampledAtMs: now(), entities: [], ship: null, timeDilation },
      notifications: drain(entry),
    };
  }

  /**
   * The scanner as the retail client's scan service has it: the probes it has
   * been told of (pilotScanner.js), and the launcher godma shows on the ship
   * (scanSvc.GetProbeLauncher, GetChargesInProbeLauncher). Nothing is asked of
   * the server for the probes: a pilot that logs in with probes still out has
   * none here until it reconnects to them, as on the client.
   */
  async function readScannerState(bridgeSessionID, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    if (!place.inSpace) {
      return {
        scanner: { inSpace: false, solarSystemID: place.solarSystemID, shipID: place.shipID, maxActiveProbes: 0, launcher: null, probes: [] },
        notifications: drain(entry),
      };
    }
    // godma.Prime, if the ship has not been loaded for this place yet.
    await shipReadings(entry, place);
    const probes = entry.scanner.activeProbes().slice(0, MAX_PROBES);
    const fitted = entry.dogma.onlineModule(place.shipID, GROUP_SCAN_PROBE_LAUNCHER);
    let launcher = null;
    if (fitted) {
      // Only scan probes count as loaded: a launcher can hold other things.
      const charge = fitted.charge && typeGroup(fitted.charge.typeID) === GROUP_SCANNER_PROBE ? fitted.charge : null;
      const loadedCount = charge ? Math.max(0, Math.trunc(charge.quantity)) : 0;
      launcher = {
        moduleID: fitted.moduleID,
        typeID: fitted.typeID,
        online: true,
        chargeTypeID: charge ? charge.typeID : null,
        loadedCount,
        launchCount: Math.min(loadedCount, Math.max(0, MAX_PROBES - probes.length)),
      };
    }
    return {
      scanner: {
        inSpace: true,
        solarSystemID: place.solarSystemID,
        shipID: place.shipID,
        maxActiveProbes: MAX_PROBES,
        launcher,
        probes: probes.map((probe) => ({
          probeID: probe.probeID,
          typeID: probe.typeID,
          pos: probe.pos,
          destination: probe.destination,
          scanRange: probe.scanRange,
          rangeStep: probe.rangeStep,
          state: probe.state,
          expiry: String(probe.expiry ?? "0"),
        })),
      },
      notifications: drain(entry),
    };
  }

  /**
   * What the client's scan service does to its own list after a call to the
   * scan manager has been answered (scanSvc.py, probeTracker.py):
   *
   *   RequestScans(probes)        the probes it sent are moving (SetProbesAsMoving)
   *   RecoverProbes(probeIDs)     the ones the server answers with are moving
   *   DestroyProbe(probeID)       that probe is gone
   *   SetActivityState(ids, on)   each goes between idle and inactive
   *
   * and, for the two calls the web client makes where the retail client only
   * changes its own list (SetProbeDestination, SetProbeRangeStep), that change.
   */
  /**
   * What the client's dogma location does to its own weapon banks once a
   * grouping call has been answered (clientDogmaLocation.py 763 to 801):
   *
   *   LinkWeapons, MergeModuleGroups, PeelAndLink, LinkAllWeapons   the answer is the ship's banks, anew
   *   UnlinkModule(shipID, moduleID)                                the answer is the slave taken out of that bank
   *   UnlinkAllModules(shipID)                                      no banks
   */
  function afterGroupingCall(entry, method, args, result) {
    if (["LinkWeapons", "MergeModuleGroups", "PeelAndLink", "LinkAllWeapons"].includes(method)) {
      entry.dogma.setWeaponBanks(args[0], result);
    } else if (method === "UnlinkModule") {
      entry.dogma.unlinkModule(args[0], args[1], result);
    } else if (method === "UnlinkAllModules") {
      entry.dogma.setWeaponBanks(args[0], null);
    }
  }

  /**
   * What the client keeps of its own movement orders. Asked to warp to a thing, it notes which
   * (space.WarpDestination(celestialID=...), from the menu and from the autopilot), and words the warp from it
   * if the server's warp then points there. A warp to anything else forgets it.
   */
  function afterMovementCall(entry, method, args, kwargs) {
    // The pilot's last order to its ship, for alreadyFollowing: what was ordered, and after what, at what range.
    // (A fleet's tag on a thing is the park's to take and no order to the ship: what the ship is flying stands.)
    // (A range that went as a float it was made, the autopilot's nought, is that number: retailCalls.js, following.)
    const sent = (value) => (value !== null && typeof value === "object" && value.type === "real" ? value.value : value);
    if (method.startsWith("Cmd") && method !== "CmdFleetTagTarget") entry.lastMove = { method, targetID: positive(args[0]), range: typeof sent(args[1]) === "number" ? sent(args[1]) : null };
    if (method === "CmdWarpToStuffAutopilot") {
      entry.warpDestination = positive(args[0]);
    } else if (method === "CmdWarpToStuff") {
      entry.warpDestination = args[0] === "item" ? positive(args[1]) : null;
    } else if (method === "CmdAlignTo") {
      // menusvc._AlignTo: what was aligned to is kept (StoreAlignTarget), a thing or a bookmark, and the HUD
      // names it for as long as the ship flies that course. `since` is the park's tick at the order.
      const given = kwargs && typeof kwargs === "object" ? kwargs : {};
      const itemID = positive(given.dstID);
      const bookmark = positive(given.bookmarkID) !== null;
      entry.alignTarget = itemID !== null || bookmark ? { itemID: bookmark ? null : itemID, bookmark, since: parkTick(entry) } : null;
    } else if (method === "CmdGotoDirection") {
      // Steered by hand: the client forgets what it had aligned to (cameraUtil, eveCommands: ClearAlignTargets).
      entry.alignTarget = null;
    }
  }

  /**
   * movementFunctions._IsAlreadyFollowingBallAtRange: the pilot's own ball, in its own ballpark, is already in
   * that mode (following, or orbiting for CmdOrbit), after that ball, at that range. The client's menu then sends
   * no approach, keep at range or orbit. The range is compared as the client compares it, with the float the
   * ballpark holds.
   *
   * Held to one thing more than the client is: the pilot's last order must have been this one, or none. The
   * client goes by its ballpark alone, which has not yet heard of a stop sent a moment ago; it would hold back the
   * approach that was to follow the stop, and leave the ship stopped.
   */
  function alreadyFollowing(bridgeSessionID, sessionFields, method, targetID, range) {
    const entry = held(bridgeSessionID, sessionFields);
    const park = entry.space ? entry.space.park : null;
    const ball = park && park.ego !== null ? park.ballpark.ball(park.ego) : null;
    if (!ball) return false;
    const mode = method === "CmdOrbit" ? BALL_MODE.ORBIT : BALL_MODE.FOLLOW;
    if (ball.mode !== mode || ball.followId !== targetID || ball.followRange !== range) return false;
    const last = entry.lastMove;
    return last === null || (last.method === method && last.targetID === targetID && last.range === range);
  }

  /**
   * michelle.AddBallpark: sm.RemoteSvc('beyonce').GetFormations(), each time a ballpark is made. The client's
   * object cache answers every asking after the first (recorded on Tranquility: "returning a cached result" at
   * each ballpark of a flight through several systems), so the server is asked once. Here the first asking is
   * sent, noted, and kept for the pilot; a ballpark made later, and the BFF's own asking, are answered from it.
   * An asking that fails is not kept.
   */
  function formationsKnown(entry) {
    if (entry.formations === null) {
      ledger.note("beyonce", "GetFormations", shape("beyonce", "GetFormations", [], null, contextFor(entry)));
      const asking = entry.session.call("beyonce", "GetFormations", []);
      entry.formations = asking;
      asking.catch(() => { if (entry.formations === asking) entry.formations = null; });
    }
    return entry.formations;
  }

  /** The tick of the pilot's park, or null when it has none. */
  const parkTick = (entry) => (entry.space && entry.space.park && entry.space.park.validState ? entry.space.park.currentTime : null);

  /**
   * The client forgets what it had aligned to as soon as its ship is seen doing anything but fly that course
   * (spaceMgr.GetHeaderAndSubtextForActionIndication: ClearAlignTargets when the ball is not in GOTO). The
   * order takes a tick or two to come back from the server as the ball's new course, so for that long the
   * ship's old mode is not held against it.
   */
  const ALIGN_GRACE_TICKS = 3;
  function alignTargetOf(entry, park) {
    const kept = entry.alignTarget ?? null;
    if (kept === null) return null;
    const ego = park.ego === null ? null : park.ballpark.ball(park.ego);
    if (ego && ego.mode !== BALL_MODE.GOTO && (kept.since === null || park.currentTime >= kept.since + ALIGN_GRACE_TICKS)) {
      entry.alignTarget = null;
      return null;
    }
    return kept;
  }

  function afterScanManagerCall(entry, method, args, result) {
    const list = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
    if (method === "RequestScans") {
      const sent = args[0];
      // As it went out: {probeID: probe}, or None for a scan with no probes.
      const probeIDs = sent && sent.type === "dict" && Array.isArray(sent.entries) ? sent.entries.map(([probeID]) => probeID) : [];
      entry.scanner.moving(probeIDs.map(Number).filter(Number.isFinite));
    } else if (method === "RecoverProbes") {
      entry.scanner.moving(list(result).map(Number).filter(Number.isFinite));
    } else if (method === "DestroyProbe") {
      entry.scanner.removed(Number(args[0]));
    } else if (method === "SetActivityState") {
      for (const probeID of list(args[0])) entry.scanner.setActive(Number(probeID), args[1] === true);
    } else if (method === "SetProbeDestination") {
      entry.scanner.setDestination(Number(args[0]), args[1]);
    } else if (method === "SetProbeRangeStep") {
      entry.scanner.setRangeStep(Number(args[0]), Number(args[1]));
    }
  }

  // ── bound objects ─────────────────────────────────────────────────────────

  /** The pilot moved: what was bound for the old place is the old place's. */
  function forgetLocationObjects(entry) {
    entry.inventoryManagers.clear();
    for (const service of [...entry.monikers.keys()]) {
      // The skill handler is the character's, wherever it is: skillsvc keeps its moniker until it forgets everything.
      // The war registry's is its owner's, wherever the pilot is: the war service keeps it until that owner is another's.
      if (!CORPORATION_SERVICES.has(service) && service !== ALLIANCE_REGISTRY && service !== SKILL_HANDLER && service !== WAR_REGISTRY) entry.monikers.delete(service);
    }
    for (const [handle, object] of entry.bound) {
      if (LOCATION_SERVICES.has(object.service)) entry.bound.delete(handle);
    }
  }

  /** The server has let one bound object go: whatever names it here is forgotten, as the client forgets the object. */
  function forgetObject(entry, objectID) {
    // An agent's moniker is the client's still, and binds again by its next call: the handles for it are new ones' to ask for.
    for (const [agentID, object] of entry.agents) {
      if (object.objectID === objectID) entry.agents.set(agentID, { ...object, objectID: null });
    }
    for (const [which, held] of entry.inventoryManagers) {
      if (held === objectID) entry.inventoryManagers.delete(which);
    }
    for (const [service, held] of entry.monikers) {
      if (held === objectID) entry.monikers.delete(service);
    }
    for (const [handle, object] of entry.bound) {
      if (object.objectID === objectID) entry.bound.delete(handle);
    }
    if (entry.fleet && entry.fleet.objectID === objectID) outOfFleet(entry);
  }

  /** eveMoniker.GetLocationBindParams: the solar system when the session has one, else the station. */
  function locationBindParams(entry) {
    const solarSystemID = attribute(entry, "solarsystemid");
    if (solarSystemID !== null) return [solarSystemID, GROUP_SOLAR_SYSTEM];
    const stationID = attribute(entry, "stationid");
    if (stationID !== null) return [stationID, GROUP_STATION];
    throw fail("CALL_FAILED", "You have no place to go");
  }

  /**
   * What a service's Moniker is made with (eveMoniker.py), or undefined where the
   * retail client makes none. `given` is what the BFF passed, for the ones that take it.
   */
  function monikerParams(entry, service, given) {
    switch (service) {
      case "ship": // GetShipAccess
      case "invbroker": // GetInventoryMgr
      case "dogmaIM": // CharGetDogmaLocation
      case "crimewatch": // CharGetCrimewatchLocation
        return locationBindParams(entry);
      case "entity": // GetEntityAccess: only with session.solarsystemid
        return attribute(entry, "solarsystemid") === null ? undefined : attribute(entry, "solarsystemid2");
      case "beyonce": // GetBallPark
        return attribute(entry, "solarsystemid") ?? undefined;
      case "planetOrbitalRegistryBroker": // GetPlanetOrbitalRegistry(session.solarsystemid): in space only
        return attribute(entry, "solarsystemid") ?? undefined;
      case OFFICE_MANAGER: // officeManager.station: Moniker('officeManager', session.stationid or session.structureid)
        return attribute(entry, "stationid") ?? attribute(entry, "structureid") ?? undefined;
      case "repairSvc": { // repair.GetRemoteRepairMgr: Moniker('repairSvc', (the dockable place, the place, the place's group))
        const stationID = attribute(entry, "stationid");
        if (stationID !== null) return [stationID, stationID, GROUP_STATION];
        const structureID = attribute(entry, "structureid");
        return structureID === null ? undefined : [structureID, attribute(entry, "solarsystemid2"), GROUP_SOLAR_SYSTEM];
      }
      case "reprocessingSvc": // GetReprocessingManager
        return attribute(entry, "structureid") ?? attribute(entry, "stationid") ?? undefined;
      case "corpRegistry": // GetCorpRegistry: Moniker('corpRegistry', session.corpid)
        return attribute(entry, "corpid") ?? undefined;
      case "allianceRegistry": // GetAlliance: Moniker('allianceRegistry', (session.allianceid, 1)), the 1 for "is master"
        return [attribute(entry, "allianceid"), 1];
      case WAR_REGISTRY: // GetWar: Moniker('warRegistry', (session.allianceid or session.corpid, 1)), the 1 for "is master"
        return [warOwner(entry), 1];
      case "fleetObjectHandler": // GetFleet: Moniker(fleetID or session.fleetid), which is None outside a fleet
        return positive(Array.isArray(given) ? given[0] : given) ?? attribute(entry, "fleetid");
      default: // agentMgr (agentID), planetMgr (planetID), charMgr ((charid, containerGlobal)): as given
        return argumentsToWire(given === undefined ? null : given);
    }
  }

  /**
   * A call on a Moniker the client keeps (moniker.py MonikeredCall, Bind). While the moniker is not bound the
   * call goes with the bind, MachoBindObject(params, (method, args, keywords)), which answers the object and the
   * call's own answer together; after that it goes to the object. A Moniker binds once at a time: a call that
   * finds it binding waits, and is made on the object, or binds for itself if that bind failed. `kept` is where
   * the object is held under `key`, until the pilot is somewhere else or the server lets it go. A moniker the
   * client binds before it uses it is bound with no call, and the call made on what it bound.
   */
  async function keptCall(entry, kept, key, service, paramsOf, method, args, kwargs) {
    const name = `${service}:${key}`;
    while (!kept.has(key) && entry.binding.has(name)) await entry.binding.get(name).catch(() => {});
    if (kept.has(key)) return entry.session.callBound(kept.get(key), method, args, kwargs);
    const carries = !BOUND_BEFORE_USE.has(service);
    const bound = await binds(entry, kept, key, name, service, paramsOf(), carries ? [method, args, kwargs] : null);
    return carries ? bound.result : entry.session.callBound(bound.objectID, method, args, kwargs);
  }

  /** A moniker's bind, with the call it carries or none: known as binding while it is, and its object kept when it answers. */
  async function binds(entry, kept, key, name, service, params, call) {
    const binding = entry.session.bind(service, params, call);
    entry.binding.set(name, binding);
    try {
      const bound = await binding;
      kept.set(key, bound.objectID);
      return bound;
    } finally {
      entry.binding.delete(name);
    }
  }

  /**
   * all_cso.GetMoniker, as the session's alliance changes: the new alliance's moniker made and bound for its own
   * sake (Bind()). Nothing is sent for a session with no alliance: the client cannot make the moniker.
   */
  async function allianceBound(entry) {
    if (attribute(entry, "allianceid") === null) return;
    await binds(entry, entry.monikers, ALLIANCE_REGISTRY, `${ALLIANCE_REGISTRY}:${ALLIANCE_REGISTRY}`, ALLIANCE_REGISTRY, monikerParams(entry, ALLIANCE_REGISTRY, undefined), null);
  }

  /**
   * skillsvc.GetSkillHandler: the client asks skillMgr2 for its skill handler once and keeps the Moniker that
   * answers. The moniker says what it is bound by: its service, its parameters, and its node where the server
   * names one, which is then known without asking (moniker.py __setstate__). Asked for again after an answer
   * that was no moniker, or none.
   */
  function skillHandlerMoniker(entry) {
    if (!entry.skillHandler) {
      const asked = (async () => {
        ledger.note("skillMgr2", "GetMySkillHandler", shape("skillMgr2", "GetMySkillHandler", [], null, contextFor(entry)));
        const moniker = monikerOf(await entry.session.call("skillMgr2", "GetMySkillHandler", [], null));
        if (!moniker) throw fail("CALL_FAILED", "skillMgr2.GetMySkillHandler did not answer a skill handler.");
        if (moniker.nodeID !== null) entry.session.setNodeOfAddress(moniker.service, moniker.params, moniker.nodeID);
        return moniker;
      })();
      entry.skillHandler = asked;
      asked.catch(() => { if (entry.skillHandler === asked) entry.skillHandler = null; });
    }
    return entry.skillHandler;
  }

  /**
   * A call on a moniker the client keeps: for where the pilot is (eveMoniker.py: GetShipAccess for `ship`,
   * CharGetDogmaLocation for `dogmaIM`), for its corporation, or its skill handler.
   */
  async function monikerCall(entry, service, method, args, kwargs = null) {
    if (madeAfresh(service, method, { dockedInStation: attribute(entry, "stationid") !== null })) {
      // A Moniker the client makes for the one call: it binds carrying the call, and is not kept.
      return (await entry.session.bind(service, monikerParams(entry, service, undefined), [method, args, kwargs])).result;
    }
    // crimewatchSvc.GetCorpAggressionSettings: the settings as they are kept, asked for where none are.
    if (service === CORP_REGISTRY && method === AGGRESSION_SETTINGS) return corporationDoes(entry, () => entry.aggression ?? aggressionRefreshed(entry));
    // What the war service keeps of an owner's wars is its to answer. Anything else of the war registry's is asked
    // on the service's moniker, which is another where its owner is another's by now.
    if (service === WAR_REGISTRY) {
      if (keptWars(service, method, args, kwargs)) return warsRead(entry, positive(args[0]));
      warMonikerIsItsOwners(entry);
    }
    if (service !== SKILL_HANDLER) {
      return keptCall(entry, entry.monikers, service, service, () => monikerParams(entry, service, undefined), method, args, kwargs);
    }
    // What the client's skill services keep is theirs to answer. Anything else of the handler's is asked of it.
    if (Object.hasOwn(SKILL_KEPT, method)) return skillsDoes(entry, () => skillRead(entry, method, args));
    if (isSkillQueueRead(method, args, kwargs)) return skillsDoes(entry, () => skillQueueRead(entry));
    // skillQueueSvc.CommitTransaction: the save, with what the client's queue service and panel do around it.
    if (method === "SaveNewQueue") return skillsDoes(entry, () => saveOnHandler(entry, args, kwargs));
    // skillsvc.ApplyFreeSkillPoints: the points applied, with what the client's skill service does around it.
    if (method === "ApplyFreeSkillPoints") return skillsDoes(entry, () => freePointsApplied(entry, args, kwargs));
    return onSkillHandler(entry, method, args, kwargs);
  }

  /**
   * ApplyFreeSkillPoints on the handler, as the client's skill service makes it (skillsvc.py 867 to 888): the
   * free points are had first, asked for where none are kept (868); and what the handler answers is the free
   * points left, which the service has from then on (887). `args` and `kwargs` are the call's own.
   */
  async function freePointsApplied(entry, args, kwargs) {
    await skillRead(entry, "GetFreeSkillPoints", []);
    const left = await onSkillHandler(entry, "ApplyFreeSkillPoints", args, kwargs);
    entry.skills.keep("freeSkillPoints", left);
    return left;
  }

  // ── the skills as they are kept ───────────────────────────────────────────

  /** A call on the skill handler: on the moniker skillMgr2 answered, bound by the first call made on it and kept. */
  async function onSkillHandler(entry, method, args = [], kwargs = null) {
    const moniker = await skillHandlerMoniker(entry);
    return keptCall(entry, entry.monikers, SKILL_HANDLER, moniker.service, () => moniker.params, method, args, kwargs);
  }

  /** One of the skill services' own askings of the handler: noted as it is sent, and what answers kept where the services keep it. */
  async function skillAsk(entry, method, args = []) {
    // With no handler to ask there is no call, and none is noted.
    await skillHandlerMoniker(entry);
    ledger.note(SKILL_HANDLER, method, SKILL_OWN[method] ?? shape(SKILL_HANDLER, method, args, null, contextFor(entry)));
    const answer = await onSkillHandler(entry, method, args);
    if (Object.hasOwn(SKILL_KEPT, method)) entry.skills.keep(SKILL_KEPT[method], answer);
    else if (method === "GetSkillQueueAndFreePoints") entry.skills.keep("queue", answer);
    return answer;
  }

  /**
   * What the client's skill services keep of one of the handler's reads, asked for where none is kept. The
   * attributes are asked for behind the boosters and the implants, each asked again whatever is kept
   * (skillsvc.GetCharacterAttributes). The history is asked for by how many its asker wants (retailCalls.js); the
   * others with nothing, whatever the asker passed. What answers is handed on as it came, kept or not.
   */
  async function skillRead(entry, method, args) {
    const name = SKILL_KEPT[method];
    if (entry.skills.has(name)) return entry.skills.read(name);
    if (name === "attributes") {
      await skillAsk(entry, "GetBoosters");
      await skillAsk(entry, "GetImplants");
    }
    return skillAsk(entry, method, name === "history" ? args : []);
  }

  /**
   * The queue service's read, asked for by name: the queue as it is kept and the free points as they are kept, in
   * the form the handler answers in. Asked of the handler where no queue is kept (PrimeSkillQueue), and what it
   * answers then handed on as it came.
   */
  async function skillQueueRead(entry) {
    if (!entry.skills.has("queue")) return skillAsk(entry, SKILL_QUEUE_READ);
    return [entry.skills.read("queue"), entry.skills.read("freeSkillPoints") ?? 0];
  }

  /** The skill services' askings one after another, so that what one keeps the next finds kept. Fails as `work` fails, for whoever waits on it; nobody need. */
  function skillsDoes(entry, work) {
    const doing = entry.skillsWork.then(work);
    entry.skillsWork = doing.catch(() => {});
    return doing;
  }

  /**
   * What the client asks of its skill handler when a character is chosen (SKILL_LOGIN_READS). Never fails: at the
   * first that cannot be read the rest are left, and each is asked for when it is next wanted.
   */
  function primeSkills(entry) {
    return skillsDoes(entry, async () => {
      for (const [method, args] of SKILL_LOGIN_READS) await skillAsk(entry, method, args);
    }).catch(() => {});
  }

  /**
   * The server's clock as this pilot's session has it (session.js serverNow), in whole milliseconds. It is what the
   * pilot's own client would read off its clock: the session's connection keeps it set.
   */
  function serverNowMs(sessionFields = {}, bridgeSessionID = undefined) {
    return Math.trunc(held(bridgeSessionID, sessionFields).session.serverNow());
  }

  /**
   * The Skills window's sheet, made from what the client's skill services keep (skillSheet.js), in the form the
   * web gateway's sheet is in. What is not kept is asked for as the client's windows would ask: the two lists,
   * the queue and the free points (skillsvc.GetFreeSkillPoints), and, where a skill is in training, the
   * character's attributes, which its points so far are reckoned from (skillQueueSvc.GetEstimatedSkillPointsTrained
   * reads skillsvc.GetCharacterAttributes: the boosters, the implants and the attributes).
   */
  async function skillSheet(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    return run(entry, SKILL_HANDLER, "GetSkills", () => skillsDoes(entry, async () => {
      const skills = await skillRead(entry, "GetSkills", []);
      const allSkills = await skillRead(entry, "GetAllSkills", []);
      // skillQueueSvc.PrimeSkillQueue, where the choosing's own asking of it could not be made.
      if (!entry.skills.has("queue")) await skillAsk(entry, "GetSkillQueueAndFreePoints");
      const freeSkillPoints = await skillRead(entry, "GetFreeSkillPoints", []);
      const attributes = entry.skills.inTraining() === null ? entry.skills.read("attributes") ?? null : await skillRead(entry, "GetAttributes", []);
      return buildSkillSheet({
        characterID: entry.characterID,
        characterName: entry.characterName,
        skills,
        allSkills,
        queue: entry.skills.read("queue"),
        freeSkillPoints,
        attributes,
        now: () => entry.session.serverNow(),
        typeName: (typeID) => typeNames(typeID)?.name,
        typeGroupName: (typeID) => typeNames(typeID)?.groupName,
        typeAttribute,
      });
    }));
  }

  /**
   * industrySvc._UpdateSkills (224): the pilot's level in effect of each skill named, as the client's skill service
   * has it (skillInfo.effectiveSkillLevel, and nought for a skill the pilot has not). The skills are kept from the
   * choosing; where they are not, they are asked for as that service asks for them.
   */
  async function skillLevels(sessionFields = {}, bridgeSessionID = undefined, typeIDs = []) {
    const entry = held(bridgeSessionID, sessionFields);
    return run(entry, SKILL_HANDLER, "GetSkills", () => skillsDoes(entry, async () => {
      await skillRead(entry, "GetSkills", []);
      return typeIDs.map((typeID) => entry.skills.effectiveLevel(typeID));
    }));
  }

  /**
   * A queue saved as the client's queue panel saves one (skillQueuePanelNew.ApplySkillQueue, activate=True).
   * `entries` is the whole queue wanted, each [typeID, toLevel], in order.
   *
   *   skillQueueSvc.TrimQueue          each entry's training time is reckoned first, which reads the character's
   *                                    attributes where they are not kept; an empty queue has nothing to reckon
   *   skillQueueSvc.CommitTransaction  SaveNewQueue({position: (typeID, toLevel)}, activate=True), on the handler
   *   ApplySkillQueue's finally        a new transaction, which asks for the queue afresh
   *                                    (GetSkillQueueAndFreePoints): after a refusal too, but for two refusals
   *
   * Recorded on Tranquility as those two calls one after the other (Archive/Apply Skill Points Flow). The queue
   * kept is right from the server's own notice of the save, and then from the asking. Not done, which the client
   * does: the queue cut where it would train for longer than a queue may (TrimQueue), an alpha clone's levels
   * refused before anything is sent, and the save made again unstarted where the server refuses an alpha's queue
   * for its size.
   *
   * The same save asked for by the handler's name (the page's own, the plan's Phase 6b) is made the same way:
   * monikerCall hands it to saveOnHandler, which is the three steps above.
   */
  async function saveSkillQueue(entries, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    return run(entry, SKILL_HANDLER, "SaveNewQueue", () => skillsDoes(entry, async () => {
      const queueInfo = { type: "dict", entries: entries.map(([typeID, toLevel], position) => [position, [typeID, toLevel]]) };
      const result = await saveOnHandler(entry, [queueInfo], { activate: true }, () => ledger.note(SKILL_HANDLER, "SaveNewQueue", SKILL_OWN.SaveNewQueue));
      return { service: SKILL_HANDLER, method: "SaveNewQueue", result: wireToBridgeJson(result === undefined ? null : result), notifications: drain(entry) };
    }));
  }

  /**
   * SaveNewQueue on the handler, with what the client's queue service and its panel do before and after it.
   * `args` and `kwargs` are the save's own, as they go on the wire: the queue by place, and `activate`.
   * The attributes are read only for a save that says it starts the queue, of a queue with something on it: an
   * unstarted queue is not trimmed (CommitTransaction 149), an empty one has nothing to reckon, and a save that
   * does not say is not the client's. `sent` is called once there is a handler to save on, before the save goes.
   */
  async function saveOnHandler(entry, args, kwargs, sent = () => {}) {
    const queued = Array.isArray(args[0]?.entries) ? args[0].entries.length : 0;
    if (queued > 0 && kwargs?.activate === true) await skillRead(entry, "GetAttributes", []);
    await skillHandlerMoniker(entry);
    sent();
    let asksAgain = true;
    try {
      return await onSkillHandler(entry, "SaveNewQueue", args, kwargs);
    } catch (error) {
      asksAgain = !NO_NEW_QUEUE_TRANSACTION.has(String(error && error.refusal && error.refusal.key));
      throw error;
    } finally {
      if (asksAgain) await skillAsk(entry, "GetSkillQueueAndFreePoints").catch(() => {});
    }
  }

  /** What the client's skill service does after a notice that only the transport can do (pilotSkills.js feed). */
  function afterSkillNotice(entry, next) {
    for (const what of next) {
      if (what === "reset") {
        // skillsvc.Reset: self.skillHandler = None. Its next call asks skillMgr2 for the handler again, and binds it again.
        entry.skillHandler = null;
        entry.monikers.delete(SKILL_HANDLER);
      } else {
        // skillsvc.GetCharacterAttributes(True): the boosters, the implants and the attributes, read again at once.
        skillsDoes(entry, async () => {
          for (const method of ["GetBoosters", "GetImplants", "GetAttributes"]) await skillAsk(entry, method);
        });
      }
    }
  }

  /**
   * shipmodulebutton.GetDefaultEffect, as far as the static data here can say
   * it: the one effect of a type that a pilot switches on (an activation or a
   * target effect, and not `online`), by name. Null when the type has none, or
   * more than one: the client tells those apart by a flag this data lacks.
   */
  function defaultEffectName(typeID) {
    if (typeID === null) return null;
    const found = typeEffects(typeID).filter((effect) => effect.effectID !== EFFECT_ONLINE &&
      (effect.effectCategoryID === EFFECT_CATEGORY.ACTIVATION || effect.effectCategoryID === EFFECT_CATEGORY.TARGET));
    return found.length === 1 ? found[0].name : null;
  }

  /** shipmodulebutton.IsEffectRepeatable: the effect has a duration and the module does not forbid repeating. Null when the effect is not one of the type's. */
  function effectRepeats(typeID, effectName) {
    if (typeID === null) return null;
    const effect = typeEffects(typeID).find((each) => each.name === effectName);
    if (!effect) return null;
    return effect.durationAttributeID !== null && effect.durationAttributeID !== undefined && !typeAttribute(typeID, ATTRIBUTE_DISALLOW_REPEATING);
  }

  /** shipmodulebutton.ActivateEffect (1318): the effect is one aimed at a target (effectCategory 2). Null when the effect is not one of the type's. */
  function effectTargeted(typeID, effectName) {
    if (typeID === null) return null;
    const effect = typeEffects(typeID).find((each) => each.name === effectName);
    return effect ? effect.effectCategoryID === EFFECT_CATEGORY.TARGET : null;
  }

  /** shipmodulebutton.ToggleOverload (231): the first of a type's effects of the overload category, by its ID. Null when the type has none, or is not known. */
  function overloadEffectOf(typeID) {
    const effect = typeEffects(typeID).find((each) => each.effectCategoryID === EFFECT_CATEGORY.OVERLOAD);
    return effect ? effect.effectID : null;
  }

  /**
   * An item's stack size as the client's inventory cache would have it (item.stacksize), from the item's row in a
   * listing the pilot holds (INVENTORY_LISTINGS): the row's own stack size where the codec gives one, else its
   * quantity, and 1 for a thing that is one of a kind, whose quantity is below nothing. Null for an item no
   * listing held has, and for a row that says neither.
   */
  function stackSizeOf(entry, itemID) {
    const wanted = positive(itemID);
    if (wanted === null) return null;
    for (const listing of entry.listings.answers()) {
      for (const row of itemsOf(listing)) {
        const fields = rowFields(row);
        if (fields === null || positive(fields.itemID) !== wanted) continue;
        const [size, quantity] = [fields.stacksize, fields.quantity].map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
        return size !== null ? size : quantity === null ? null : quantity < 0 ? 1 : quantity;
      }
    }
    return null;
  }

  /**
   * An item's row as the client's inventory cache would have it, from a listing the pilot holds
   * (INVENTORY_LISTINGS): the packed row the server listed, its text read as text, which the codec writes again as
   * the bytes it was read from. Null for an item no listing held has, and for a row that is no packed row.
   */
  function rowOfItem(entry, itemID) {
    const wanted = positive(itemID);
    if (wanted === null) return null;
    for (const listing of entry.listings.answers()) {
      for (const row of itemsOf(listing)) {
        const fields = rowFields(row);
        if (fields === null || positive(fields.itemID) !== wanted) continue;
        return row && row.type === "packedrow" ? wireToBridgeJson(row) : null;
      }
    }
    return null;
  }

  /** What only the pilot's own client would know, for a call to be sent as that client sends it (retailCalls.js). */
  function contextFor(entry) {
    const typeOf = (itemID) => entry.dogma.typeOf(positive(itemID) ?? 0);
    return {
      shipID: attribute(entry, "shipid"),
      characterID: entry.characterID,
      corporationID: attribute(entry, "corpid"),
      allianceID: attribute(entry, "allianceid"),
      // session.solarsystemid: the system the pilot is in space in, and none while docked.
      solarSystemID: attribute(entry, "solarsystemid"),
      // session.stationid or session.structureid: where the pilot is docked, and none in space.
      dockedAt: attribute(entry, "stationid") ?? attribute(entry, "structureid"),
      // session.structureid: the structure the pilot is docked in, and none in a station or in space.
      structureID: attribute(entry, "structureid"),
      // The group of the ship the pilot is in, as godma holds its item (GetShipItem().groupID), and none where
      // godma has not been primed for that ship.
      shipGroupID: positive(entry.dogma.item(positive(attribute(entry, "shipid")) ?? 0)?.groupID),
      onlineModules: () => {
        const shipID = attribute(entry, "shipid");
        return entry.dogmaLoaded && shipID !== null ? entry.dogma.onlineModules(shipID) : null;
      },
      // invCache: the item as a listing has it.
      stackSize: (itemID) => stackSizeOf(entry, itemID),
      // invCache: the item's own row, as a listing has it.
      itemRow: (itemID) => rowOfItem(entry, itemID),
      // marketQuote.GetMyOrders: one of the pilot's own orders, as its row has it.
      ownOrder: (orderID) => ownOrderOf(entry, orderID),
      // marketQuote.GetBrokersFeeCommissionFromStationID: the rate the client names with an order there.
      brokersFee: (stationID) => brokersFeeAt(entry, stationID),
      // marketQuote.GetAveragePrice, as the entries of the sale being made have it (saleAveragesRead).
      averagePrice: (typeID) => entry.saleAverages.get(positive(typeID)) ?? null,
      effectName: (itemID) => defaultEffectName(typeOf(itemID)),
      effectTargeted: (itemID, effectName) => effectTargeted(typeOf(itemID), effectName),
      effectRepeats: (itemID, effectName) => effectRepeats(typeOf(itemID), effectName),
      // The module's own overload effect, by its ID: null for a module with none, and for one godma does not know.
      overloadEffect: (itemID) => overloadEffectOf(typeOf(itemID)),
      // fleetSvc.GetMyShipTypeID: godma's word for the ship the pilot is in.
      shipTypeID: () => typeOf(attribute(entry, "shipid")),
      // targetMgr.targetsByID, as it is kept (pilotTargets.js): whether the ship has the thing locked. Null while
      // the list is not known.
      targetLocked: (itemID) => {
        const kept = entry.targets.read(TARGETS);
        return kept ? kept.items.some((each) => String(each) === String(itemID)) : null;
      },
      fleetID: attribute(entry, "fleetid"),
      holdsFleet: entry.fleet !== null,
      // fleetSvc.IsBoss and self.options, as the fleet is kept (pilotFleet.js).
      fleetBoss: entry.fleetKept.isBoss(),
      fleetOptions: () => entry.fleetKept.options(),
    };
  }

  /**
   * A call on invCache's `inventorymgr` (where the pilot is) or `stationInventoryMgr` (its station): each a Moniker it
   * keeps. The station's is only asked of a pilot docked in one, for whom the two are bound by the same parameters.
   */
  const inventoryCall = (entry, which, method, args) =>
    keptCall(entry, entry.inventoryManagers, which, "invbroker", () => locationBindParams(entry), method, args, null);

  /**
   * Make the bind the BFF asked the gateway for, as the retail client makes
   * it. Answers the bound object's "N=...", or null when the server handed
   * none back.
   */
  async function bindRetail(entry, service, method, args, kwargs) {
    const { session } = entry;
    if (method === "MachoBindObject") {
      // michelle.GetRemotePark(): the park's own bound ballpark, the one object everything is asked of. Any other
      // moniker is made by bindObject and binds when it is first called.
      return entry.space.remote();
    }
    if (service === "invbroker" && method === "GetInventory") {
      // invCache.GetInventory(const.containerHangar): the station's hangar from the station's manager.
      //
      // Docked in a structure the hangars are the structure's own inventory (invControllers.StructureItemHangar and
      // StructureShipHangar, whose container is invCache.GetInventoryFromId(session.structureid)), which godma has
      // bound already as the pilot docks, passively (godma.PrimeLocation, 2394: GetInventoryFromId(itemID, 1)), from
      // the manager for where the pilot is. Every recording of a client docked in a structure has that one bind
      // and no other for its hangars. (invCache.GetInventory(containerStructure) is the hangar view's, for the
      // structure's type: hangarView.py 629. The page has no such view, and it is not asked.)
      const asked = positive(args[0]);
      const structureID = attribute(entry, "structureid");
      if (asked !== (structureID ?? attribute(entry, "stationid"))) {
        throw fail("CALL_REFUSED", "The pilot is not docked there.");
      }
      if (structureID !== null) return boundObjectID(await inventoryCall(entry, "location", "GetInventoryFromId", [structureID, 1]));
      return boundObjectID(await inventoryCall(entry, "station", "GetInventory", [CONTAINER_HANGAR, null]));
    }
    if (service === "invbroker" && method === "GetInventoryFromId") {
      // invCache.GetInventoryFromId(itemid, passive=0): both positional.
      const passive = kwargs && kwargs.passive !== undefined ? kwargs.passive : args[1] ?? 0;
      return boundObjectID(await inventoryCall(entry, "location", "GetInventoryFromId", [argumentsToWire(args[0]), passive]));
    }
    // A service's own method that answers with a bound object:
    // sm.RemoteSvc('scanMgr').GetSystemScanMgr(), sm.RemoteSvc('fleetObjectHandler').CreateFleet().
    return boundObjectID(await session.call(service, method, argumentsToWire(args), kwargs ?? null));
  }

  /** idCheckers.IsNPC(session.corpid): whether the pilot's corporation is an NPC one. */
  function inNpcCorporation(entry) {
    const corporationID = attribute(entry, "corpid");
    return corporationID > MAX_SYSTEM_ITEM && corporationID < MIN_PLAYER_OWNER;
  }

  // ── the standings as they are kept ────────────────────────────────────────

  /**
   * standingsvc.__RefreshStandings: the NPCs' standings with each other, then the character's, and beside the
   * character's its corporation's where that is not an NPC corporation, whose standings are none
   * (idCheckers.IsNPC(session.corpid)). What is answered is kept; what cannot be read leaves what was kept as it
   * was. Never fails.
   */
  function refreshStandings(entry) {
    const ask = (method) => {
      ledger.note("standingMgr", method, method === "GetNPCNPCStandings" ? NPC_STANDINGS_AS_THE_CLIENT_ASKS : shape("standingMgr", method, [], null, contextFor(entry)));
      return entry.session.call("standingMgr", method, [], null);
    };
    entry.standingsWork = (async () => {
      const npcNpc = await ask("GetNPCNPCStandings");
      const [char, corp] = inNpcCorporation(entry) ? [await ask("GetCharStandings")] : await Promise.all([ask("GetCharStandings"), ask("GetCorpStandings")]);
      entry.standings.refreshed({ npcNpc, char, corp });
    })().catch(() => {});
    return entry.standingsWork;
  }

  /**
   * The pilot's standings as the client's standing service has them kept: the character's and its corporation's,
   * each as the server answered it when the character was chosen, kept right since by the server's notices, in
   * the gateway's form. The corporation's is null where none is kept (an NPC corporation's are none). Null where
   * the character's could not be read: then nothing is kept.
   */
  async function standingsKept(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    await entry.standingsWork;
    if (!entry.standings.loaded) return null;
    return { char: wireToBridgeJson(entry.standings.char()), corp: wireToBridgeJson(entry.standings.corp()) };
  }

  // ── the fleet's own object, and the fleet as it is kept ───────────────────

  /** No fleet's object is held, and nothing of a fleet is kept (fleetSvc.Clear, and a session in no fleet). */
  function outOfFleet(entry) {
    entry.fleet = null;
    entry.fleetKept.clear();
  }

  /** One call the client makes of its own accord on the fleet's object, in the client's form and in the ledger. */
  function ownFleetCall(entry, object, method, args = []) {
    ledger.note("fleetObjectHandler", method, FLEET_OWN[method] ?? shape("fleetObjectHandler", method, args, null, contextFor(entry)));
    return entry.session.callBound(object.objectID, method, args, null);
  }

  /** fleetSvc.InitFleet: the fleet's state asked of its object, and kept where that is the fleet's object still. */
  async function initFleet(entry, object) {
    const state = await ownFleetCall(entry, object, "GetInitState");
    if (entry.fleet === object) entry.fleetKept.init(state);
  }

  /**
   * Something the client's fleet service does of its own accord. Each is a tasklet of its own in the client, so
   * none waits for another (the same call made twice at once is one call: session.js). What cannot be done is
   * left undone, as an error in the client's handler leaves it. Answers when this one is over; entry.fleetWork
   * is over when all of them are.
   */
  function fleetDoes(entry, work) {
    const doing = work().catch(() => {});
    entry.fleetWork = Promise.all([entry.fleetWork, doing]);
    return doing;
  }

  /** What the client does after a notice about its fleet (pilotFleet.js feed): each of `next`, in order. */
  function afterFleetNotice(entry, next) {
    for (const what of next) {
      const object = entry.fleet;
      if (what === "left") {
        entry.fleet = null;
      } else if (object && what === "init") {
        // OnFleetJoin, the pilot's own: InitFleet.
        fleetDoes(entry, () => initFleet(entry, object));
      } else if (object && what === "move") {
        // OnFleetMove: self.fleet.FinishMove(), by which the session's wing and squad change.
        fleetDoes(entry, () => ownFleetCall(entry, object, "FinishMove"));
      } else if (object) {
        // A wing or squad's notice: self.wings = self.fleet.GetWings().
        fleetDoes(entry, async () => {
          const wings = await ownFleetCall(entry, object, "GetWings");
          if (entry.fleet === object) entry.fleetKept.setWings(wings);
        });
      }
    }
  }

  /**
   * fleetSvc keeps one object for the pilot's fleet, self.fleet, and reads the fleet's state from it as soon as
   * it has it. CreateFleet (331): after Init, InitFleet and then self.fleet.GetFleetID(). OnFleetInvite (1194):
   * the Moniker that accepted is the object from then on, and InitFleet. LeaveFleet (365): once it has answered
   * there is no object and nothing kept (self.Clear()). CreateWing (575): a wing that was made is given a squad at
   * once, CreateSquad(wingID). `result` is what the call answered.
   */
  function afterFleetCall(entry, object, method, result) {
    if (method === "AcceptInvite") {
      entry.fleet = object;
      return fleetDoes(entry, () => initFleet(entry, object));
    }
    if (entry.fleet !== object) return null;
    if (method === "LeaveFleet") outOfFleet(entry);
    if (method === "CreateWing" && positive(result) !== null) return fleetDoes(entry, () => ownFleetCall(entry, object, "CreateSquad", [result]));
    if (method !== "Init") return null;
    return fleetDoes(entry, async () => {
      await initFleet(entry, object);
      await ownFleetCall(entry, object, "GetFleetID");
    });
  }

  /**
   * The fleet as the client's fleet service has it kept, for a pilot whose fleet's object is held: its state as
   * GetInitState answered it when the pilot formed or joined the fleet, kept right since by the server's notices;
   * its wings; its message of the day, asked for only where the server has said none (fleetSvc.GetMotd). And what
   * the two windows the client's main one offers to some would show, for a pilot who would have them
   * (fleetwindow.py): the join requests, the boss's, asked for where none is kept the first time they are shown
   * for a fleet; and the composition, a commander's or the boss's, asked for again when the kept one is twenty
   * seconds old or the pilot's own record has changed (fleetSvc.GetFleetComposition). Anyone else is asked for
   * neither, and has none. Each in the gateway's form, under the name of the read it stands for. Null where no
   * object is held or no state could be read: then nothing is kept, as the client keeps nothing.
   */
  async function fleetKept(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    // What the client is asking of its own accord comes first.
    await entry.fleetWork;
    // A state that could not be read when the client read it is read now: the BFF's own doing, for the page's sake.
    const object = entry.fleet;
    if (object && !entry.fleetKept.inited) await fleetDoes(entry, () => initFleet(entry, object));
    if (!entry.fleetKept.inited) return null;
    if (entry.fleetKept.motd() === null) {
      await fleetDoes(entry, async () => entry.fleetKept.setMotd(await ownFleetCall(entry, object, "GetMotd")));
    }
    if (entry.fleetKept.isBoss() && entry.fleetKept.openJoinRequests()) {
      await fleetDoes(entry, async () => {
        const requests = await ownFleetCall(entry, object, "GetJoinRequests");
        if (entry.fleet === object) entry.fleetKept.setJoinRequests(requests);
      });
    }
    const commands = () => entry.fleetKept.isBoss() || FLEET_COMMANDER_ROLES.has(attribute(entry, "fleetrole"));
    if (commands() && entry.fleetKept.compositionDue(now())) {
      await fleetDoes(entry, async () => {
        const composition = await ownFleetCall(entry, object, "GetFleetComposition");
        if (entry.fleet === object) entry.fleetKept.setComposition(composition, now());
      });
    }
    // Out of the fleet meanwhile, there is nothing kept.
    if (!entry.fleetKept.inited) return null;
    return {
      GetInitState: wireToBridgeJson(entry.fleetKept.read()),
      GetWings: wireToBridgeJson(entry.fleetKept.wings()),
      GetMotd: wireToBridgeJson(entry.fleetKept.motd()),
      GetJoinRequests: wireToBridgeJson(entry.fleetKept.isBoss() ? entry.fleetKept.joinRequests() : { type: "dict", entries: [] }),
      GetFleetComposition: wireToBridgeJson(commands() ? entry.fleetKept.composition() : null),
      notifications: drain(entry),
    };
  }

  /**
   * A call on a moniker the BFF asked for. As the client's own Moniker (moniker.py), it binds when it is first
   * called, carrying that call, and the calls after go to the object it bound; and where the client makes a new
   * Moniker for a call, one is made here for it and not kept.
   */
  function handleCall(entry, handle, object, method, args, kwargs) {
    if (madeAfresh(object.service, method, { dockedInStation: attribute(entry, "stationid") !== null })) {
      return entry.session.bind(object.service, object.params, [method, args, kwargs]).then((bound) => bound.result);
    }
    const kept = { has: () => object.objectID !== null, get: () => object.objectID, set: (key, objectID) => { object.objectID = objectID; } };
    // An object several handles name is bound once: its own name, where it has one, is what its binding is known by.
    return keptCall(entry, kept, object.key ?? handle, object.service, () => object.params, method, args, kwargs);
  }

  // ── the corporation's registry, as the client's services ask and keep it ──

  /** One of the client's own askings of the corporation's registry: noted as it is sent, with nothing, on the corporation's moniker. */
  function corporationAsk(entry, method) {
    ledger.note(CORP_REGISTRY, method, shape(CORP_REGISTRY, method, [], null, contextFor(entry)));
    return keptCall(entry, entry.monikers, CORP_REGISTRY, CORP_REGISTRY, () => monikerParams(entry, CORP_REGISTRY, undefined), method, [], null);
  }

  /** crimewatchSvc.RefreshCorpAggressionSettings: the settings asked for, and kept as answered. */
  async function aggressionRefreshed(entry) {
    entry.aggression = await corporationAsk(entry, AGGRESSION_SETTINGS);
    return entry.aggression;
  }

  /** What asks for the settings or reads them kept, one after another, so that what one keeps the next finds kept. Fails as `work` fails, for whoever waits on it. */
  function corporationDoes(entry, work) {
    const doing = entry.corpWork.then(work);
    entry.corpWork = doing.catch(() => {});
    return doing;
  }

  /**
   * What the client's services ask of the corporation's registry when the session's corporation changes, the
   * choosing of a character among them: its aggression settings (crimewatchSvc.ProcessSessionChange), which
   * are kept, and its members' names (bco_members.OnSessionChanged, which primes the client's names with them
   * and keeps nothing else). Each fails for itself.
   *
   * A character chosen is asked besides for its own applications, as the client asks for them once
   * (bco_applications), after the address book's reads as a recorded login has them. They are not kept here,
   * though the client keeps them and works its list over at each OnCorporationApplicationChanged: the BFF's own
   * flows read one pilot's applications straight after another pilot's change to them, on another connection,
   * where a kept list could be a notice behind.
   */
  function corporationRead(entry) {
    return corporationDoes(entry, async () => {
      await aggressionRefreshed(entry).catch(() => {});
      await corporationAsk(entry, "GetEveOwners").catch(() => {});
    });
  }

  /**
   * addressbook.GetContacts, as a character is chosen (OnCharacterSessionChanged). The client asks these side by
   * side, and Tranquility's recording of a login has them in this order: the pilot's contacts and blocked owners
   * (charMgr.GetContactList), its corporation's contacts where the corporation is not an NPC one
   * (corp.GetContactList, which is GetCorpRegistry().GetCorporateContacts()), and who of its watched contacts is
   * online (onlineStatus.Prime, which is GetInitialState). Each fails for itself.
   *
   * A pilot in an alliance is asked for the alliance's contacts beside these, between the corporation's and the
   * online state (alliance.GetContactList, which is GetMoniker().GetAllianceContacts(), the moniker made and bound
   * for it). No recording has an alliance: the place is the address book's own order.
   *
   * Nothing is kept of them, though the client keeps them all and works them over at the server's notices: no
   * window of the page reads a contact yet.
   */
  async function addressBookRead(entry) {
    const ofTheAlliance = (method) => {
      ledger.note(ALLIANCE_REGISTRY, method, shape(ALLIANCE_REGISTRY, method, [], null, contextFor(entry)));
      return keptCall(entry, entry.monikers, ALLIANCE_REGISTRY, ALLIANCE_REGISTRY, () => monikerParams(entry, ALLIANCE_REGISTRY, undefined), method, [], null);
    };
    await Promise.all([
      asks(entry, "charMgr", "GetContactList"),
      ...(inNpcCorporation(entry) ? [] : [corporationAsk(entry, "GetCorporateContacts")]),
      ...(attribute(entry, "allianceid") === null ? [] : [ofTheAlliance("GetAllianceContacts")]),
      asks(entry, "onlineStatus", "GetInitialState"),
    ].map((asked) => asked.catch(() => {})));
  }

  /** crimewatchSvc.OnCorpAggressionSettingsChange(aggressionSettings): the settings are what the server says. */
  function afterCorporationNotice(entry, notification) {
    if (notification.method === "OnCorpAggressionSettingsChange") entry.aggression = Array.isArray(notification.args) ? notification.args[0] : null;
  }

  // ── the agents' table, and the agents' journal as it is kept ──────────────

  /**
   * agents.__GetAllAgents, for one pilot: RemoteSvc('agentMgr').GetAgents(), asked once and not again while what
   * answered is had. Asked again where the asking failed. What answers is the one table kept for all pilots.
   */
  function agentsKnown(entry) {
    if (!entry.agentsAsked) {
      const asked = (async () => {
        ledger.note("agentMgr", "GetAgents", shape("agentMgr", "GetAgents", [], null, contextFor(entry)));
        agentsTable = wireToBridgeJson(await entry.session.call("agentMgr", "GetAgents", [], null));
      })();
      entry.agentsAsked = asked;
      asked.catch(() => { entry.agentsAsked = null; });
    }
    return entry.agentsAsked;
  }

  /** agents.GetAgentMoniker: the one Moniker('agentMgr', agentID) the client keeps for an agent, made when first wanted. */
  function agentObject(entry, agentID) {
    if (!entry.agents.has(agentID)) entry.agents.set(agentID, { objectID: null, service: "agentMgr", params: agentID, key: `agent:${agentID}` });
    return entry.agents.get(agentID);
  }

  /**
   * journal._CheckUpdateMissionData, one reading at a time as under the service's semaphore. With no journal kept
   * the whole of it is asked for by name. With one kept and agents marked, each marked agent is asked for its own
   * part on its own moniker, all at once, and the parts are put into what is kept (pilotJournal.js). Fails as the
   * asking fails, for whoever waits on it: the agents marked are then marked no longer, and what was kept is as it
   * was, as in the client.
   */
  function journalUpToDate(entry) {
    const reading = entry.journalWork.then(async () => {
      if (!entry.journal.kept) {
        ledger.note("agentMgr", "GetMyJournalDetails", shape("agentMgr", "GetMyJournalDetails", [], null, contextFor(entry)));
        entry.journal.full(await entry.session.call("agentMgr", "GetMyJournalDetails", [], null));
        return;
      }
      const agentIDs = entry.journal.takeOutdated();
      const answers = await Promise.all(agentIDs.map((agentID) => {
        ledger.note("agentMgr", "GetMyJournalDetails", AGENTS_OWN_JOURNAL);
        const object = agentObject(entry, agentID);
        return handleCall(entry, object.key, object, "GetMyJournalDetails", [], null);
      }));
      entry.journal.partial(agentIDs, answers);
    });
    entry.journalWork = reading.catch(() => {});
    return reading;
  }

  /**
   * The pilot's agents' journal as the client's journal service has it: read when the character was chosen, and
   * after a mission's change made right by its agent's own answer. In the gateway's form. Null where what the
   * server answered was no journal: then nothing is kept.
   */
  async function journalKept(sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    await run(entry, "agentMgr", "GetMyJournalDetails", () => journalUpToDate(entry));
    const journal = entry.journal.read();
    return journal ? wireToBridgeJson(journal) : null;
  }

  async function bindObject(service, method, args = [], kwargs = null, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    assertAllowed(service, method);
    // fleetSvc.CreateFleet (332): `if session.fleetid: raise UserError('FleetError')`, before anything is asked. So
    // here: a session in a fleet forms no other, nothing is sent, and what was not sent is not counted.
    if (service === "fleetObjectHandler" && method === "CreateFleet" && attribute(entry, "fleetid") !== null) throw fail("CALL_REFUSED", "FleetError");
    ledger.note(service, method, BOUND_AS_THE_CLIENT_BINDS);
    if (method === "MachoBindObject" && !(service === "beyonce" && entry.space)) {
      // A Moniker: what it is bound by is settled now, from what the client's own carries (eveMoniker.py), and
      // nothing is sent until it is called.
      const given = Array.isArray(args) ? args[0] : undefined;
      // The pilot's own fleet (none named, or the session's named) is asked of the one object fleetSvc keeps for
      // it, where it is held: no Moniker is made.
      const named = positive(Array.isArray(given) ? given[0] : given);
      const fleets = service === "fleetObjectHandler" && (named === null || named === attribute(entry, "fleetid")) ? entry.fleet : null;
      // An agent is asked on the one object the client's agents service keeps for it, whoever asks.
      const own = fleets ?? (service === "agentMgr" && named !== null ? agentObject(entry, named) : null);
      const params = monikerParams(entry, service, given);
      if (params === undefined) throw fail("BOUND_NO_OBJECT", `${service}.${method} did not return a bound object.`);
      const made = randomBytes(24).toString("base64url");
      entry.bound.set(made, own ?? { objectID: null, service, params });
      return { boundHandle: made, service, method, notifications: drain(entry) };
    }
    let objectID;
    try {
      objectID = await run(entry, service, method, async () => bindRetail(entry, service, method, Array.isArray(args) ? args : [], kwargs));
    } catch (error) {
      // The session's own word for a bind the server answered without an object.
      if (error.code === "CALL_FAILED" && / did not return a bound object\.| could not say where its object lives\./.test(error.message)) objectID = null;
      else throw error;
    }
    if (!objectID) throw fail("BOUND_NO_OBJECT", `${service}.${method} did not return a bound object.`);
    const boundHandle = randomBytes(24).toString("base64url");
    const object = { objectID, service };
    entry.bound.set(boundHandle, object);
    // fleetSvc.CreateFleet: self.fleet = sm.RemoteSvc('fleetObjectHandler').CreateFleet(), from the answer on.
    if (method === "CreateFleet") entry.fleet = object;
    return { boundHandle, service, method, notifications: drain(entry) };
  }

  async function callBoundMethod(service, method, args = [], kwargs = null, sessionFields = {}, bridgeSessionID = undefined, boundHandle = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const object = entry.bound.get(String(boundHandle || ""));
    if (!object) throw fail("BOUND_HANDLE_NOT_FOUND", "Unknown bound-object handle for this session.");
    if (object.service !== service) throw fail("BOUND_HANDLE_NOT_FOUND", "Bound-object handle does not belong to the requested service.");
    assertAllowed(service, method);
    // fleetSvc.OnFleetInvite (1171): `if session.fleetid is not None: __fleetMoniker.RejectInvite(True)`. A session
    // in a fleet asks no acceptance: so here nothing is sent, and what was not sent is not counted.
    if (service === "fleetObjectHandler" && method === "AcceptInvite" && attribute(entry, "fleetid") !== null) throw fail("CALL_REFUSED", "FleetError");
    // fleetSvc.Invite, before it asks. 357: `if IsNPC(charID) or not IsCharacter(charID):`, where the client says
    // so itself; by the number alone here (retailCalls.js, couldBeAPilot), a pilot's number as text being that
    // number. 361: `if charID != session.charid:`, and for the pilot's own character it asks nothing. So here,
    // for either, nothing is sent, and what was not sent is not counted.
    if (service === "fleetObjectHandler" && method === "Invite") {
      const invitee = Array.isArray(args) ? args[0] : null;
      if (!couldBeAPilot(typeof invitee === "string" ? Number(invitee) : invitee)) throw fail("CALL_REFUSED", "That is no pilot to invite.");
      if (String(invitee) === String(entry.characterID)) throw fail("CALL_REFUSED", "A pilot does not invite itself to its own fleet.");
    }
    if (retailNeeds(service, method) === "dogma") await shipReadings(entry, whereabouts(entry));
    const form = shape(service, method, args, kwargs, contextFor(entry));
    if (service === "dogmaIM" && method === "QueryAttributeValue") {
      const held = attributeHeld(entry, form.args);
      if (held !== undefined) return { service, method, result: held, notifications: drain(entry) };
    }
    // What crimewatch's service keeps is its to answer on a Moniker's handle too.
    if (keptOfCrimewatch(service, method, form)) {
      const kept = await run(entry, service, method, () => crimewatchKept(entry, method));
      return { service, method, result: wireToBridgeJson(kept === undefined ? null : kept), notifications: drain(entry) };
    }
    /** The call itself, noted as it is sent. */
    const sent = async () => {
      ledger.note(service, method, form);
      // fittingSvc.LoadFitting: the fitting is applied on the ship's own inventory, invCache.GetInventoryFromId(ship),
      // which the location's manager is asked for. The BFF's route has the manager's handle.
      if (service === "invbroker" && method === "FitFitting") {
        // invCache.GetInventoryFromId(itemid, passive=0), noted as the bind of an inventory it is.
        ledger.note("invbroker", "GetInventoryFromId", BOUND_AS_THE_CLIENT_BINDS);
        const shipInventory = boundObjectID(await inventoryCall(entry, "location", "GetInventoryFromId", [argumentsToWire(form.args[0]), 0]));
        return entry.session.callBound(shipInventory, method, argumentsToWire(form.args), form.kwargs);
      }
      return object.params === undefined
        ? entry.session.callBound(object.objectID, method, argumentsToWire(form.args), form.kwargs)
        : handleCall(entry, String(boundHandle), object, method, argumentsToWire(form.args), form.kwargs);
    };
    // What a container lists is the inventory cache's to answer: asked for, and noted, only where nothing is kept.
    const listing = service === "invbroker" && INVENTORY_LISTINGS.has(method);
    // A planet's colony and what the planet carries are kept by the planet, where they are asked as the client asks them.
    const ofAPlanet = service === PLANET_MGR && PLANET_READS.has(method) && object.params !== undefined && form.args.length === 0;
    let result;
    try {
      result = await run(entry, service, method, () => (listing ? entry.listings.read(listingKeptAs(boundHandle, form), sent) : ofAPlanet ? planetRead(entry, object, method, sent) : sent()));
    } catch (error) {
      if (mayChangeContents(service, method)) entry.listings.forget();
      forgetKeptAfter(entry, service, method);
      if (changesAColony(service, method)) forgetColonies(entry);
      // The session's own word for a bind the server answered without an object: the gateway's, for a bind.
      if (/ did not return a bound object\.| could not say where its object lives\./.test(error.message)) {
        throw fail("BOUND_NO_OBJECT", `${service}.MachoBindObject did not return a bound object.`);
      }
      throw error;
    }
    if (mayChangeContents(service, method)) entry.listings.forget();
    forgetKeptAfter(entry, service, method);
    if (changesAColony(service, method)) forgetColonies(entry);
    if (service === "scanMgr") afterScanManagerCall(entry, method, form.args, result);
    if (service === "dogmaIM") afterGroupingCall(entry, method, form.args, result);
    if (service === "beyonce") afterMovementCall(entry, method, form.args, kwargs);
    afterBookmarkCall(entry, service, method, form, result);
    if (service === "fleetObjectHandler") await afterFleetCall(entry, object, method, result);
    return {
      service,
      method,
      result: wireToBridgeJson(result === undefined ? null : result),
      notifications: drain(entry),
    };
  }

  /**
   * The session's notifications as they arrive, in the gateway's frames. A
   * cursor from this process that is still in the history is replayed from;
   * any other gets a snapshot frame, which tells the reader to re-read.
   */
  function openSessionEventStream({ bridgeSessionID, userid, cursor = null, onFrame, onOpen, onClose } = {}) {
    const subscriber = {
      onFrame: typeof onFrame === "function" ? onFrame : () => {},
      onClose: typeof onClose === "function" ? onClose : () => {},
      closed: false,
    };
    let entry;
    try {
      entry = held(bridgeSessionID, userid === undefined ? undefined : { userid });
    } catch {
      // Deferred, as the gateway client's is: the caller must be holding the
      // handle this returns by the time its close handler runs.
      queueMicrotask(() => {
        if (subscriber.closed) return;
        subscriber.closed = true;
        subscriber.onClose({ code: 0, reason: "session not found", refusalStatus: 404 });
      });
      return { close() { subscriber.closed = true; } };
    }
    const sequence = cursor && cursor.epoch === epoch ? Number(cursor.sequence) : NaN;
    const oldest = entry.history.length > 0 ? entry.history[0].cursor.sequence : entry.sequence + 1;
    const replayable = Number.isSafeInteger(sequence) && sequence >= 0 && sequence <= entry.sequence && sequence >= oldest - 1;
    const first = replayable
      ? entry.history.filter((frame) => frame.cursor.sequence > sequence)
      : [Object.freeze({
          source: STREAM_SOURCE,
          apiVersion: 1,
          streamVersion: 1,
          type: "snapshot",
          cursor: Object.freeze({ epoch, sequence: entry.sequence }),
          reason: cursor ? "cursor_not_replayable" : "no_cursor",
        })];
    // Subscribed before the first frames go out, so nothing published while
    // they are being read is lost; they go out on the next tick, behind onOpen.
    const pending = [...first];
    const live = subscriber.onFrame;
    subscriber.onFrame = (frame) => pending.push(frame);
    entry.subscribers.add(subscriber);
    queueMicrotask(() => {
      if (subscriber.closed) return;
      if (typeof onOpen === "function") {
        try {
          onOpen();
        } catch {
          // The stream is open whether or not the listener liked hearing so.
        }
      }
      subscriber.onFrame = live;
      for (const frame of pending.splice(0)) deliver(subscriber, frame);
    });
    return {
      close() {
        subscriber.closed = true;
        entry.subscribers.delete(subscriber);
      },
    };
  }

  /** Close every session: the BFF is stopping, and each pilot logs off as a closed client's would. */
  function shutdown() {
    for (const entry of [...sessions.values()]) end(entry, "transport_shutdown");
    for (const line of [...accountLines.values()]) line.hangUp();
  }

  return {
    selectCharacter,
    callMethod,
    bindObject,
    callBoundMethod,
    alreadyFollowing,
    releaseBridgeSession,
    readFlightStatus,
    readScannerState,
    readSpaceSnapshot,
    openSessionEventStream,
    accountCall,
    answerClientQuestion,
    ship,
    fleet,
    fleetKept,
    standingsKept,
    brokersFeeRate: brokersFeeRateFor,
    skillSheet,
    skillLevels,
    freshFacility,
    industryJobLetGo,
    industryWindowClosed,
    averageMarketPrice,
    serverNowMs,
    saveSkillQueue,
    journalKept,
    ownersNamed,
    shipInfo,
    shipAttribute,
    shutdown,
    /** Every pair called since this transport was made, most called first, with how each compares with the retail client's. */
    callLedger: () => ledger.rows(),
    /** How many pilots are on the game port now. */
    get size() {
      return sessions.size;
    },
  };
}

module.exports = { GamePortPilotError, argumentsToWire, boundObjectID, createGamePortPilots };
