// An accepted mission's objectives as the client's tracker shows them: the job board's tracked agent mission
// (jobboard/client/features/agent_missions/info_panel_entry.py, AgentMissionInfoPanelEntry and
// OldStyleAgentMissionObjectiveEntry), from the client's mission objectives tracker
// (missions/client/missionObjectivesTracker.py) and its objectives (missions/client/ui/missionObjectiveData.py).
//
//   The tracker asks the server's mission tracker for a mission's objectives (GetAllMissionObjectives) and for the one
//   it is on now (GetMissionInfoItems; OnMissionsUpdated says it again). Each is a list whose first is its kind: TravelTo
//   and a place, TransportItemsPresent and an item, a place and a quantity, AllObjectivesComplete and the agent, ...
//   The objectives shown are those up to and including the one it is on now, matched as text (_IsCurrentObjective);
//   none where it is not among them (InfoPanelAgentMissionData._InitializeObjectives). One done is shown with its header
//   only, and only where it has one; the one it is on now with its header, its words and its one button.
//
//   Each kind has its words (MISSION_HINT_LABEL_PATH and its parameters) and its place: the mission's first bookmark of
//   the kinds it looks for, in its order (BOOKMARK_LOCATION_TYPES, FindBookmark). Its header is its own where it has
//   one, else the place's hint with the system's name taken out (GetHeaderText). Its button goes by where the pilot is
//   and where the place is (AgentMissionObjective._GetButtonState, 205 to 245; buttonConst).
//
// Not done: the objective's icon; a mission's newer objective chain (ObjectiveChainEntry), which agent missions on this
// server have not; the warp's preparing (the page cannot tell it from flying); an undock being made.

import { isListValue, type JsonValue } from "./wire.ts";
import type { NameRef } from "../store/names.ts";
import type { MissionSpot } from "../store/types.ts";

/** One objective as the tracker's reads give it: its kind first, then what that kind has. */
export type MissionInfo = readonly JsonValue[];

/** One accepted mission as the tracker has read it. */
export interface TrackedMission {
  readonly agentID: number;
  /** GetAllMissionObjectives. */
  readonly all: readonly MissionInfo[];
  /** GetMissionInfoItems, or what OnMissionsUpdated said since. */
  readonly current: MissionInfo | null;
  /** IsInActiveDungeonID. */
  readonly inActiveDungeon: boolean;
}

/** OnMissionsUpdated's missions: each its agent and the objective it is on now. */
export function decodeMissionsUpdated(value: JsonValue | null | undefined): { readonly agentID: number; readonly info: MissionInfo | null }[] {
  const items = isListValue(value) ? value.items : Array.isArray(value) ? (value as readonly JsonValue[]) : [];
  const out: { readonly agentID: number; readonly info: MissionInfo | null }[] = [];
  for (const item of items) {
    const entries = (item as { type?: unknown; entries?: unknown } | null)?.type === "dict" ? ((item as { entries: [JsonValue, JsonValue][] }).entries) : [];
    const field = (key: string): JsonValue | undefined => entries.find(([name]) => name === key)?.[1];
    const agentID = asNumber(field("agentID"));
    if (agentID === null || agentID <= 0) continue;
    out.push({ agentID, info: decodeMissionInfo(field("info")) });
  }
  return out;
}

/** A read's objective: a list or a tuple whose first is its kind; null for anything else. */
export function decodeMissionInfo(value: JsonValue | null | undefined): MissionInfo | null {
  const items = isListValue(value) ? value.items : Array.isArray(value) ? (value as readonly JsonValue[]) : null;
  if (items === null || items.length === 0 || items[0] === null || items[0] === undefined) return null;
  return items;
}

/** GetAllMissionObjectives: the mission's objectives, in order. */
export function decodeMissionInfos(value: JsonValue | null | undefined): MissionInfo[] {
  const items = isListValue(value) ? value.items : Array.isArray(value) ? (value as readonly JsonValue[]) : [];
  return items.map((item) => decodeMissionInfo(item)).filter((info): info is MissionInfo => info !== null);
}

/**
 * The tracker's wait on an item (missionObjectivesTracker.py _WantNotificationWhenTypeIDArrives, 136 to 143): the type
 * an objective is waiting for to come aboard, where it is a fetch's, a transport's or a drop-off's missing item, or
 * one with all done; null where it waits for none.
 */
export function arrivalAwaited(info: MissionInfo | null): number | null {
  if (info === null || info.length < 2) return null;
  const kinds = info.map((part) => pyStr(part));
  const awaits = kinds[0]!.startsWith("MissionFetch") || ["TransportItemsMissing", "DropOffItemsMissing", "AllObjectivesComplete"].some((key) => kinds.includes(key));
  return awaits ? asNumber(info[1]) : null;
}

/** The places an objective asks to hear of the pilot reaching (SetDestinationNotificationTrigger), as far as its datum names one. */
export function placesAwaited(info: MissionInfo | null): number[] {
  if (info === null) return [];
  const kind = pyStr(info[0]!);
  const at = kind === "TravelTo" ? 1 : kind === "TransportItemsPresent" ? 2 : kind === "FetchObjectAcquiredDungeonDone" ? 3 : null;
  const place = at === null ? null : asNumber(info[at]);
  return place === null || place <= 0 ? [] : [place];
}

/** OnItemsChanged's destinations the tracker counts an item arriving in (104 to 120): the ship's cargo and holds; the hangar while docked. */
const ARRIVAL_FLAGS: ReadonlySet<number> = new Set([5, 134, 182, 181, 135, 136, 137, 138, 139, 140, 141, 142, 147]);
const FLAG_HANGAR = 4;
export function isArrivalFlag(flagID: number, docked: boolean): boolean {
  return ARRIVAL_FLAGS.has(flagID) || (docked && flagID === FLAG_HANGAR);
}

/** A value as Python's str() writes it (a long as its digits, a list as its repr), for the tracker's match by text. */
function pyStr(value: JsonValue): string {
  if (value === null) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (isListValue(value) || Array.isArray(value)) {
    const items = isListValue(value) ? value.items : (value as readonly JsonValue[]);
    const repr = (item: JsonValue): string => (typeof item === "string" ? `'${item}'` : pyStr(item));
    return `[${items.map(repr).join(", ")}]`;
  }
  const wrapped = value as { type?: unknown; value?: unknown };
  if (wrapped.type === "long" && (typeof wrapped.value === "string" || typeof wrapped.value === "number")) return String(wrapped.value);
  return JSON.stringify(value);
}

/** _IsCurrentObjective: two objectives the same where each part's str() is. */
function sameObjective(one: MissionInfo, other: MissionInfo | null): boolean {
  if (other === null) return one.length === 0;
  return one.length === other.length && one.every((part, i) => pyStr(part) === pyStr(other[i]!));
}

/** InfoPanelAgentMissionData._InitializeObjectives: those up to and including the one it is on now; none where that is not among them. */
export function trackedObjectiveInfos(all: readonly MissionInfo[], current: MissionInfo | null): MissionInfo[] {
  const shown: MissionInfo[] = [];
  for (const info of all) {
    shown.push(info);
    if (sameObjective(info, current)) return shown;
  }
  return [];
}

const asNumber = (value: JsonValue | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const wrapped = value as { type?: unknown; value?: unknown };
  const raw = typeof value === "object" && wrapped.type === "long" ? wrapped.value : value;
  const number = Number(raw);
  return Number.isFinite(number) && raw !== "" ? number : null;
};

/**
 * A part of an objective's words: a number (or an ID a tag of the label names), a word, a name the page's cache gives,
 * or a message of the client's by its number.
 */
export type ObjectiveArg = number | string | { readonly name: NameRef } | { readonly message: number };

/** An objective's words: the client's label and its parameters, the page's own where the install's are not to hand. */
export interface ObjectiveWords {
  readonly label: string;
  readonly args: Readonly<Record<string, ObjectiveArg>>;
  readonly own: string;
  /** A place whose system's security the client writes after the words (GetColorCodedSecurityStringForLocation). */
  readonly securityOf?: number;
}

/** How the objective's button goes (the kinds that differ from AgentMissionObjective's). */
type ButtonRule = "agent" | "talkToAgent" | "allComplete" | "none" | "readJournal" | "dropInContainer";

/** One objective as the tracker shows it. */
export interface TrackedObjective {
  /** The client's class for it. */
  readonly kind: string;
  /** Its own header (FetchItemHeader where it has no place; MissionTransport's), else null. */
  readonly ownHeader: ObjectiveWords | null;
  /** Its words (missionHint), null where it has none. */
  readonly hint: ObjectiveWords | null;
  /** Its place: the mission's first bookmark of the kinds it looks for. */
  readonly bookmark: MissionSpot | null;
  readonly startConversation: boolean;
  readonly rule: ButtonRule;
  /** TalkToAgent's agent, and its place. */
  readonly targetAgentID: number | null;
  /** TravelTo's place. */
  readonly locationID: number | null;
}

const AGENT_LOCATION_TYPES = ["agenthomebase"];
const ORIGIN_LOCATION_TYPES = ["objective", "objective.source"];
const DROP_OFF_LOCATION_TYPES = ["objective.destination"];
const DUNGEON_LOCATION_TYPES = ["dungeon"];
const TALK_TO_AGENT_LOCATION_TYPES = ["objective"];

/** FindBookmark: the first bookmark whose kind is among each list of kinds in turn. */
function findBookmark(bookmarks: readonly MissionSpot[], kinds: readonly (readonly string[])[]): MissionSpot | null {
  for (const types of kinds) {
    const found = bookmarks.find((bookmark) => types.includes(bookmark.locationType));
    if (found !== undefined) return found;
  }
  return null;
}

const typeName = (typeID: number | null): ObjectiveArg => (typeID === null ? "item" : { name: { kind: "type", id: typeID } });
// (GetItemLink names an item that is an owner by the owner's name; a dungeon's things are none, and go by their type's.)
const itemName = (typeID: number | null): ObjectiveArg => typeName(typeID);
const placeName = (locationID: number): ObjectiveArg =>
  ({ name: { kind: locationID >= 60_000_000 && locationID < 64_000_000 ? "station" : locationID >= 30_000_000 && locationID < 40_000_000 ? "system" : "structure", id: locationID } });

/**
 * CreateObjective: the objective of a read's datum; ReadJournal where its kind is none the client knows (or it cannot
 * be read). `pilotSystemID` and `inActiveDungeon` are where the pilot is, which TravelTo's words go by.
 */
export function trackedObjective(
  info: MissionInfo | null,
  agentID: number,
  bookmarks: readonly MissionSpot[],
  pilotSystemID: number | null,
  inActiveDungeon: boolean,
): TrackedObjective {
  const base = (kind: string, kinds: readonly (readonly string[])[], hint: ObjectiveWords | null, extra: Partial<TrackedObjective> = {}): TrackedObjective => ({
    kind,
    ownHeader: null,
    hint,
    bookmark: findBookmark(bookmarks, kinds),
    startConversation: false,
    rule: "agent",
    targetAgentID: null,
    locationID: null,
    ...extra,
  });
  const readJournal = base("ReadJournal", [], null, { rule: "readJournal" });
  if (info === null) return readJournal;
  const kind = pyStr(info[0]!);
  const n = (at: number): number | null => asNumber(info[at]);
  switch (kind) {
    case "TravelTo": {
      const locationID = n(1);
      if (locationID === null) return readJournal;
      const hint: ObjectiveWords | null = locationID === pilotSystemID
        ? (inActiveDungeon ? null : { label: "UI/Agents/MissionTracker/WarpTo", args: {}, own: "Warp to the mission's site." })
        : { label: "UI/Agents/MissionTracker/TravelTo", args: { destination: placeName(locationID) }, own: "Travel to {destination}", securityOf: locationID };
      return base("TravelTo", [DUNGEON_LOCATION_TYPES], hint, { locationID });
    }
    case "MissionFetch":
    case "MissionFetchContainer":
    case "Remove item from container":
    case "MissionFetchMine":
    case "MissionFetchMineTrigger": {
      const typeID = n(1);
      const quantity = kind === "MissionFetch" || kind.startsWith("MissionFetchMine") ? (info.length > 2 ? n(2) : null) : null;
      const many = quantity !== null && quantity > 1;
      const label = kind === "MissionFetchContainer" ? "UI/Agents/MissionTracker/RetrieveFromContainer"
        : kind === "Remove item from container" ? "UI/Agents/MissionTracker/RetrieveContentsFromContainer"
          : kind.startsWith("MissionFetchMine") ? (many ? "UI/Agents/MissionTracker/FetchMineQuantity" : "UI/Agents/MissionTracker/FetchMine")
            : many ? "UI/Agents/MissionTracker/FetchItems" : "UI/Agents/MissionTracker/FetchItem";
      const className = kind === "MissionFetchContainer" ? "MissionFetchContainer" : kind === "Remove item from container" ? "MissionFetchContainerContents"
        : kind.startsWith("MissionFetchMine") ? (many ? "MissionFetchMineQuantity" : "MissionFetchMine") : many ? "MissionFetchMany" : "MissionFetch";
      const kinds = [DUNGEON_LOCATION_TYPES, ORIGIN_LOCATION_TYPES];
      const bookmark = findBookmark(bookmarks, kinds);
      // MissionFetch's header where it has no place (NO_LOCATION_HEADER_PATH): the plural one for MissionFetchMany's.
      const ownHeader: ObjectiveWords | null = bookmark !== null ? null
        : className === "MissionFetchMany" || className === "MissionFetchMineQuantity"
          ? { label: "UI/Agents/MissionTracker/FetchItemsHeader", args: {}, own: "Get the items" }
          : { label: "UI/Agents/MissionTracker/FetchItemHeader", args: {}, own: "Get the item" };
      return base(className, kinds, { label, args: { item: typeName(typeID), ...(many ? { quantity: quantity! } : {}) }, own: many ? "{quantity} of {item} wanted" : "{item} wanted" }, { ownHeader });
    }
    case "MissionFetchTarget":
      return base("MissionFetchTarget", [DUNGEON_LOCATION_TYPES], { label: "UI/Agents/MissionTracker/FetchTarget", args: { npc: typeName(n(1)), item: typeName(n(2)) }, own: "{item} from {npc}" });
    case "AllObjectivesComplete":
      return base("AllObjectivesComplete", [DROP_OFF_LOCATION_TYPES, ORIGIN_LOCATION_TYPES, AGENT_LOCATION_TYPES], null, { startConversation: true, rule: "allComplete" });
    case "TransportItemsPresent": {
      const typeID = n(1);
      const locationID = n(2);
      const quantity = n(3);
      const many = quantity !== null && quantity > 1;
      return base("TransportItemsPresent", [DROP_OFF_LOCATION_TYPES], {
        label: many ? "UI/Agents/MissionTracker/TransportItems" : "UI/Agents/MissionTracker/TransportItem",
        args: { item: typeName(typeID), destination: locationID === null ? "destination" : placeName(locationID), ...(many ? { quantity: quantity! } : {}) },
        own: many ? "Take {quantity} of {item} to {destination}" : "Take {item} to {destination}",
        ...(locationID === null ? {} : { securityOf: locationID }),
      });
    }
    case "TransportItemsMissing":
    case "DropOffItemsMissing": {
      const typeID = n(1);
      const quantity = n(2);
      const many = quantity !== null && quantity > 1;
      return base(kind, [DUNGEON_LOCATION_TYPES, ORIGIN_LOCATION_TYPES, AGENT_LOCATION_TYPES], {
        label: many ? "UI/Agents/MissionTracker/TransportItemsMissing" : "UI/Agents/MissionTracker/TransportItemMissing",
        args: { item: typeName(typeID), ...(many ? { quantity: quantity! } : {}) },
        own: many ? "{quantity} of {item} wanted in the cargo hold" : "{item} wanted in the cargo hold",
      }, kind === "DropOffItemsMissing" ? { rule: "none" } : {});
    }
    case "MissionTransport":
      return base("MissionTransport", [DROP_OFF_LOCATION_TYPES], { label: "UI/Agents/MoveItemToItemHangar", args: { item: typeName(n(1)) }, own: "Put {item} in the item hangar" }, {
        ownHeader: { label: "UI/Agents/MoveItemToItemHangarTitle", args: {}, own: "Hand it in" },
      });
    case "FetchObjectAcquiredDungeonDone": {
      const typeID = n(1);
      const giverID = n(2);
      const quantity = n(4);
      const many = quantity !== null && quantity > 1;
      return base("FetchObjectsAcquiredDungeonDone", [AGENT_LOCATION_TYPES, DROP_OFF_LOCATION_TYPES, ORIGIN_LOCATION_TYPES], {
        label: many ? "UI/Agents/MissionTracker/FetchItemsReturn" : "UI/Agents/MissionTracker/FetchItemReturn",
        args: { item: typeName(typeID), agent: giverID === null ? "agent" : { name: { kind: "agent", id: giverID } }, ...(many ? { quantity: quantity! } : {}) },
        own: many ? "Take {quantity} of {item} to {agent}" : "Take {item} to {agent}",
      });
    }
    case "GoToGate":
      return base("GoToGate", [DUNGEON_LOCATION_TYPES], { label: "UI/Agents/MissionTracker/GoToGate", args: {}, own: "Take the acceleration gate" });
    case "KillTrigger":
      return base("KillTrigger", [DUNGEON_LOCATION_TYPES], { label: "UI/Agents/MissionTracker/KillTrigger", args: { target: itemName(n(1)) }, own: "Destroy {target}" });
    case "KillAllTrigger":
      return base("KillAllTrigger", [DUNGEON_LOCATION_TYPES], { label: "UI/Agents/MissionTracker/KillAllTrigger", args: {}, own: "Destroy the enemies" });
    case "Destroy":
    case "DestroyLCSAndAll": {
      // (objectNameID's message, where it has one, names the thing; its type's name else.)
      const nameID = n(3);
      const lcs: ObjectiveArg = nameID !== null && nameID > 0 ? { message: nameID } : itemName(n(1));
      return base(kind, [DUNGEON_LOCATION_TYPES], {
        label: kind === "Destroy" ? "UI/Agents/MissionTracker/Destroy" : "UI/Agents/MissionTracker/DestroyLCSAndAll",
        args: { lcs },
        own: kind === "Destroy" ? "Destroy {lcs}" : "Destroy {lcs} and its guards",
      });
    }
    case "DestroyAll":
    case "Destroy all the enemies":
      return base("DestroyAll", [DUNGEON_LOCATION_TYPES], { label: "UI/Agents/MissionTracker/DestroyAll", args: {}, own: "Destroy every enemy here" });
    case "Attack":
    case "Approach":
    case "Hack":
    case "Salvage": {
      const label = kind === "Attack" ? "UI/Agents/MissionTracker/Attack" : kind === "Hack" ? "UI/Agents/MissionTracker/Hack" : "UI/Agents/MissionTracker/Approach";
      return base(kind, [DUNGEON_LOCATION_TYPES], { label, args: { target: itemName(n(1)) }, own: `${kind} {target}` });
    }
    case "TalkToAgent": {
      const targetAgentID = n(1);
      const bookmark = findBookmark(bookmarks, [TALK_TO_AGENT_LOCATION_TYPES]);
      const locationID = bookmark?.itemID ?? null;
      return base("TalkToAgentObjective", [TALK_TO_AGENT_LOCATION_TYPES], null, { startConversation: true, rule: "talkToAgent", targetAgentID, locationID });
    }
    case "DropItemInMissionContainer":
      return base("DropItemInMissionContainerObjective", [], {
        label: "UI/Agents/MissionTracker/DropItemInMissionContainer",
        args: { dropOffType: typeName(n(3)), dropOffQuantity: n(4) ?? 1, missionContainerType: typeName(n(1)) },
        own: "Put {dropOffQuantity} of {dropOffType} in the {missionContainerType}.",
      }, { rule: "dropInContainer" });
    default:
      // A dungeon's trigger by its name (NAME_BY_TRIGGER_TYPE) is DungeonTriggerObjective's, whose button is Read
      // Details where it would be none; the page has not that table, and an effect's activation
      // (dunTriggerEffectActivated) is not done yet: both read as ReadJournal.
      return readJournal;
  }
}

/**
 * The words a TalkToAgent objective has, which go by where the pilot is (TalkToAgentObjective.__init__): Report To
 * Agent at the place, else Travel To it.
 */
export function talkToAgentHint(objective: TrackedObjective, locationID: number | null): ObjectiveWords | null {
  if (objective.rule !== "talkToAgent" || objective.locationID === null) return objective.hint;
  return objective.locationID === locationID
    ? { label: "UI/Agents/MissionTracker/ReportToAgent", args: { agent: objective.targetAgentID ?? 0 }, own: "Report to the agent" }
    : { label: "UI/Agents/MissionTracker/TravelTo", args: { destination: placeName(objective.locationID) }, own: "Travel to {destination}", securityOf: objective.locationID };
}

/** The objective's header (GetHeaderText): its own; AllObjectivesComplete's by where the pilot is; else its place's hint less its system's name. */
export function objectiveHeader(
  objective: TrackedObjective,
  pilotLocationID: number | null,
  remoteCompletable: boolean,
  systemName: (systemID: number) => string | null,
  hintOf: (bookmark: MissionSpot) => string = (bookmark) => bookmark.hint ?? "",
): ObjectiveWords | { readonly text: string } | null {
  if (objective.ownHeader !== null) return objective.ownHeader;
  const bookmark = objective.bookmark;
  if (objective.rule === "allComplete") {
    if (bookmark === null) return null;
    if (remoteCompletable || (pilotLocationID !== null && (pilotLocationID === bookmark.itemID || pilotLocationID === bookmark.solarSystemID))) {
      return { label: "UI/Agents/CompleteMission", args: {}, own: "Hand the mission in" };
    }
    const locationID = bookmark.locationID ?? bookmark.solarSystemID;
    return locationID === null ? null : { label: "UI/Agents/MissionTracker/TravelTo", args: { destination: placeName(locationID) }, own: "Travel to {destination}", securityOf: locationID };
  }
  if (bookmark === null) return { text: "" };
  const name = bookmark.solarSystemID === null ? null : systemName(bookmark.solarSystemID);
  const hint = hintOf(bookmark);
  return { text: stripHeader(name === null || name === "" ? hint : hint.split(name).join("")) };
}

/** Python's s.strip(' ').strip('-').strip(' '). */
function stripHeader(text: string): string {
  return text.replace(/^ +| +$/g, "").replace(/^-+|-+$/g, "").replace(/^ +| +$/g, "");
}

/** The button's states (buttonConst), and the client's words for each. */
export type ButtonState =
  | "none" | "undock" | "dock" | "warpTo" | "setDestination" | "startConversation" | "destinationSet" | "approach"
  | "warping" | "approaching" | "completeReferral" | "readDetails" | "dropItemInMissionContainer";

export const BUTTON_LABELS: Readonly<Record<Exclude<ButtonState, "none">, { readonly label: string; readonly own: string }>> = Object.freeze({
  undock: { label: "UI/Neocom/UndockBtn", own: "Undock" },
  dock: { label: "UI/Inflight/DockInStation", own: "Dock" },
  warpTo: { label: "UI/Inflight/WarpToBookmark", own: "Warp there" },
  setDestination: { label: "UI/Inflight/SetDestination", own: "Head there" },
  destinationSet: { label: "UI/Inflight/DestinationSet", own: "On the route" },
  approach: { label: "UI/Inflight/ApproachObject", own: "Fly closer" },
  warping: { label: "UI/Inflight/Warping", own: "In warp" },
  approaching: { label: "UI/Inflight/Messages/ApproachingHeader", own: "Flying closer" },
  startConversation: { label: "UI/Commands/StartConversation", own: "Talk" },
  completeReferral: { label: "UI/Commands/StartConversation", own: "Talk" },
  readDetails: { label: "UI/Agents/Commands/ReadDetails", own: "Read about it" },
  dropItemInMissionContainer: { label: "UI/Agents/Commands/OpenContainer", own: "Open it" },
});

/**
 * BUTTON_DISABLED_STATES, as far as the page has them, and Approaching: StatefulButton.SetBusy disables the button in
 * each of ACTIVE_BUTTON_STATES but Undocking.
 */
export const BUTTON_DISABLED: ReadonlySet<ButtonState> = new Set<ButtonState>(["destinationSet", "warping", "approaching"]);

/** Where the pilot is, as the button goes by it. */
export interface TrackerSituation {
  readonly stationID: number | null;
  readonly structureID: number | null;
  /** session.solarsystemid2. */
  readonly solarSystemID: number | null;
  /** In space in a ship (a ballpark). */
  readonly inSpace: boolean;
  readonly warping: boolean;
  /** The thing the ship follows (IsApproachingBall), null where it follows nothing. */
  readonly approachingID: number | null;
  readonly waypoints: readonly number[];
  /** ConvertStationIDToSolarSystemIDIfNecessary for the last waypoint, null where it is not known. */
  readonly lastWaypointSystemID: number | null;
  /** BookmarkChecker.getDistanceToActiveShip, null where it cannot be told. */
  readonly distanceToBookmark: number | null;
  readonly inActiveDungeon: boolean;
  readonly remoteCompletable: boolean;
}

const isStation = (id: number | null | undefined): boolean => typeof id === "number" && id >= 60_000_000 && id < 64_000_000;
/** const.minWarpDistance and missionObjectiveData's DUNGEON_DISTANCE_THRESHOLD. */
const MIN_WARP_DISTANCE = 150_000;
const DUNGEON_DISTANCE_THRESHOLD = 500_000;

/** The objective's button, as its kind's _GetButtonState has it. */
export function objectiveButton(objective: TrackedObjective, at: TrackerSituation): ButtonState {
  switch (objective.rule) {
    case "none":
      return "none";
    case "readJournal":
      return "readDetails";
    case "dropInContainer":
      return "dropItemInMissionContainer";
    case "talkToAgent": {
      const bookmark = objective.bookmark;
      if (bookmark === null) return "none";
      if (at.inSpace) {
        const near = at.distanceToBookmark !== null && at.distanceToBookmark > 0 && at.distanceToBookmark < DUNGEON_DISTANCE_THRESHOLD;
        if (near && !isStation(bookmark.itemID)) return "completeReferral";
      } else if (bookmark.itemID !== null && bookmark.itemID === at.stationID) {
        return "completeReferral";
      }
      return agentButton(objective, at, null);
    }
    case "allComplete": {
      const bookmark = objective.bookmark;
      if (bookmark === null) return "none";
      if (at.remoteCompletable) return "startConversation";
      if (bookmark.itemID !== null && bookmark.itemID === at.stationID) return "startConversation";
      return agentButton(objective, at, (base) => {
        // AllObjectivesComplete._GetBallparkButtonState: within the site's reach and no station, talk; else a place far
        // enough to warp to, warp.
        if (base !== null) {
          const near = at.distanceToBookmark !== null && at.distanceToBookmark > 0 && at.distanceToBookmark < DUNGEON_DISTANCE_THRESHOLD;
          return base === "none" && near && !isStation(bookmark.itemID) ? "startConversation" : base;
        }
        return at.distanceToBookmark === null || at.distanceToBookmark > MIN_WARP_DISTANCE ? "warpTo" : null;
      });
    }
    case "agent":
      return agentButton(objective, at, null);
  }
}

/** AgentMissionObjective._GetButtonState (205 to 245); `ballpark` its kind's _GetBallparkButtonState where it has its own. */
function agentButton(
  objective: TrackedObjective,
  at: TrackerSituation,
  ballpark: ((base: ButtonState | null) => ButtonState | null) | null,
): ButtonState {
  const bookmark = objective.bookmark;
  if (bookmark === null) return "none";
  const state = agentButtonBeforeWarp(objective, bookmark, at, ballpark);
  // GetWarpingState, over a state that was a warp, a dock or none.
  return at.warping && (state === "warpTo" || state === "dock" || state === "none") ? "warping" : state;
}

function agentButtonBeforeWarp(
  objective: TrackedObjective,
  bookmark: MissionSpot,
  at: TrackerSituation,
  ballpark: ((base: ButtonState | null) => ButtonState | null) | null,
): ButtonState {
  const itemID = bookmark.itemID ?? null;
  // _ShouldUndock: docked anywhere but at the place.
  if ((at.stationID !== null && at.stationID !== itemID) || (at.structureID !== null && at.structureID !== itemID)) return "undock";
  if (bookmark.solarSystemID !== at.solarSystemID) {
    return at.waypoints.length > 0 && at.lastWaypointSystemID !== null && at.lastWaypointSystemID === bookmark.solarSystemID ? "destinationSet" : "setDestination";
  }
  // _IsAtTheRightStation.
  if (at.stationID !== null && at.stationID === itemID) return objective.startConversation ? "startConversation" : "none";
  if (!at.inSpace) return "none";
  // _ShouldDock, IsApproachingBall.
  if (isStation(itemID) && at.approachingID !== itemID) return "dock";
  if (itemID !== null && at.approachingID === itemID) return "approaching";
  // _GetBallparkButtonState.
  const distance = at.distanceToBookmark;
  let base: ButtonState | null = null;
  if (distance !== null && distance > 0 && distance < DUNGEON_DISTANCE_THRESHOLD && !isStation(itemID)) base = "none";
  else if (distance !== null && distance > 0 && distance < MIN_WARP_DISTANCE) base = "approach";
  const fromPark = ballpark === null ? base : ballpark(base);
  if (fromPark !== null) return fromPark;
  if (at.inActiveDungeon) return "none";
  // autoPilot.InWarpRange, IsPositionWithinWarpDistance: far enough to warp (a distance not known is taken as far).
  return distance === null || distance > MIN_WARP_DISTANCE ? "warpTo" : "none";
}
