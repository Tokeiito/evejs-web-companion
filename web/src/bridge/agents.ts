// Agent conversation / briefing / journal decoders (goal R4, "how to add a
// page"). The retail agent flow runs on the BFF (which holds the bound agent
// handle) and returns the raw retail-shaped marshaled results here; this module
// decodes them into plain rows for the store.
//
// Decoder rule (docs/bridge-wire-contract.md): mission rows carry long-encoded
// IDs and ISK/LP amounts. Numerics are decoded with unwrapLong — never the
// `typeof === "number" ? … : 0` pattern, which silently zeroes a {type:"long"}
// value. ISK amounts and FILETIMEs (which can exceed 2^53) are kept as decimal
// strings, not lossy Number.

import { unwrapLong, type DictEntry, type JsonValue } from "./wire.ts";
import type {
  AgentAction,
  AgentConversation,
  CourierBriefing,
  JournalMission,
  JournalState,
} from "../store/types.ts";

// Retail agent dialogue button constants (agentMissionRuntime.js), the second
// value in each availableActions tuple. Exported so the UI can identify the
// Accept / Decline / Complete buttons without magic numbers.
export const AGENT_BUTTON = Object.freeze({
  VIEW_MISSION: 1,
  REQUEST_MISSION: 2,
  ACCEPT: 3,
  ACCEPT_REMOTELY: 5,
  COMPLETE: 6,
  COMPLETE_REMOTELY: 7,
  DECLINE: 9,
  DEFER: 10,
  QUIT: 11,
});

const BUTTON_LABELS: Readonly<Record<number, string>> = Object.freeze({
  [AGENT_BUTTON.VIEW_MISSION]: "View Mission",
  [AGENT_BUTTON.REQUEST_MISSION]: "Request Mission",
  [AGENT_BUTTON.ACCEPT]: "Accept",
  [AGENT_BUTTON.ACCEPT_REMOTELY]: "Accept Remotely",
  [AGENT_BUTTON.COMPLETE]: "Complete Mission",
  [AGENT_BUTTON.COMPLETE_REMOTELY]: "Complete Remotely",
  [AGENT_BUTTON.DECLINE]: "Decline",
  [AGENT_BUTTON.DEFER]: "Defer",
  [AGENT_BUTTON.QUIT]: "Quit",
});

export function agentButtonLabel(buttonType: number): string {
  return BUTTON_LABELS[buttonType] ?? `Action ${buttonType}`;
}

// --- marshaled-value helpers ----------------------------------------------

/** Items of a {type:"tuple"} or {type:"list"} wrapper; [] otherwise. */
function seqItems(value: JsonValue | undefined): readonly JsonValue[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as { type?: unknown; items?: unknown };
    if (
      (candidate.type === "tuple" || candidate.type === "list") &&
      Array.isArray(candidate.items)
    ) {
      return candidate.items as readonly JsonValue[];
    }
  }
  return [];
}

/** Entries of a {type:"dict"} or util.KeyVal wrapper; [] otherwise. */
function dictEntries(value: JsonValue | undefined): readonly DictEntry[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as { type?: unknown; name?: unknown; entries?: unknown; args?: unknown };
    if (candidate.type === "dict" && Array.isArray(candidate.entries)) {
      return candidate.entries as readonly DictEntry[];
    }
    if (candidate.type === "object" && candidate.name === "util.KeyVal") {
      return dictEntries(candidate.args as JsonValue);
    }
  }
  return [];
}

/** Read one key from a dict/KeyVal wrapper; undefined when absent. */
function readDict(value: JsonValue | undefined, key: string): JsonValue | undefined {
  const entry = dictEntries(value).find((pair) => Array.isArray(pair) && pair[0] === key);
  return entry ? entry[1] : undefined;
}

/** Decode an integer-ish numeric (plain or long); null when absent/malformed. */
function toNumber(value: JsonValue | undefined): number | null {
  const long = unwrapLong(value);
  return long === null ? null : Number(long);
}

/** Decode a possibly-fractional numeric (e.g. cargo volume); null when absent. */
function toFloat(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  return long === null ? null : Number(long);
}

/** Keep an ISK amount / FILETIME as a bigint-safe decimal string; null if absent. */
function toDecimalString(value: JsonValue | undefined): string | null {
  const long = unwrapLong(value);
  return long === null ? null : long.toString();
}

function toBoolOrNull(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// --- conversation ----------------------------------------------------------

/**
 * Decode a DoAction result:
 *   tuple( tuple(agentSays, availableActions), lastActionInfo )
 * where agentSays is tuple(message, contentID) — message being a string key, a
 * numeric briefing id, or a tuple(messageKey, substitutionDict) — and each
 * availableAction is tuple(actionID token, buttonType).
 */
export function decodeConversation(result: JsonValue): AgentConversation {
  const outer = seqItems(result);
  const inner = seqItems(outer[0]);
  const saysItems = seqItems(inner[0]);
  const firstSays = saysItems[0];
  let agentSays = "";
  if (typeof firstSays === "string") {
    agentSays = firstSays;
  } else if (typeof firstSays === "number") {
    agentSays = String(firstSays);
  } else {
    const nested = seqItems(firstSays);
    agentSays = typeof nested[0] === "string" ? nested[0] : "";
  }
  const actions: AgentAction[] = seqItems(inner[1]).map((entry) => {
    const items = seqItems(entry);
    const actionID = toNumber(items[0]) ?? 0;
    const buttonType = toNumber(items[1]) ?? 0;
    return { actionID, buttonType, label: agentButtonLabel(buttonType) };
  });
  const lastActionInfo = outer[1];
  return {
    agentSays,
    contentID: toNumber(saysItems[1]),
    actions,
    lastActionInfo: {
      missionCompleted: toBoolOrNull(readDict(lastActionInfo, "missionCompleted")),
      missionDeclined: toBoolOrNull(readDict(lastActionInfo, "missionDeclined")),
      missionQuit: toBoolOrNull(readDict(lastActionInfo, "missionQuit")),
      loyaltyPoints: toNumber(readDict(lastActionInfo, "loyaltyPoints")),
    },
  };
}

/** The Accept button in a conversation, if the agent is offering one. */
export function findAcceptAction(
  conversation: AgentConversation | null,
): AgentAction | null {
  if (!conversation) {
    return null;
  }
  return (
    conversation.actions.find((action) => action.buttonType === AGENT_BUTTON.ACCEPT) ?? null
  );
}

// --- briefing --------------------------------------------------------------

/**
 * Decode the courier briefing from GetMissionObjectiveInfo (the authoritative
 * transport objective: pickup, dropoff, cargo, rewards, LP) plus
 * GetMissionBriefingInfo (title, accept/expiration FILETIMEs, and a Mission
 * Keywords summary used as a fallback). Returns null when neither read carried a
 * transport objective (no accepted courier).
 */
export function decodeBriefing(
  briefingResult: JsonValue,
  objectiveResult: JsonValue,
): CourierBriefing | null {
  const objectives = seqItems(readDict(objectiveResult, "objectives"));
  const transport = objectives
    .map((entry) => seqItems(entry))
    .find((items) => items[0] === "transport" || items[0] === "fetch");
  const transportInner = transport ? seqItems(transport[1]) : [];
  // [issuerID, pickupDict, issuerID, dropoffDict, cargoDict]
  const pickup = transportInner[1];
  const dropoff = transportInner[3];
  const cargo = transportInner[4];
  const keywords = readDict(briefingResult, "Mission Keywords");

  const iskAmounts = seqItems(readDict(objectiveResult, "normalRewards"))
    .map((entry) => seqItems(entry))
    .filter((items) => toNumber(items[0]) === 29)
    .map((items) => items[1]);
  const bonusAmounts = seqItems(readDict(objectiveResult, "bonusRewards"))
    .map((entry) => seqItems(entry))
    .filter((items) => toNumber(items[0]) === 29)
    .map((items) => items[1]);

  const hasObjective = transport !== undefined;
  const hasKeywords = dictEntries(keywords).length > 0;
  if (!hasObjective && !hasKeywords) {
    return null;
  }

  return {
    missionTitleID:
      toNumber(readDict(objectiveResult, "missionTitleID")) ??
      toNumber(readDict(briefingResult, "Mission Title ID")),
    cargoTypeID:
      toNumber(readDict(cargo, "typeID")) ??
      toNumber(readDict(keywords, "objectiveTypeID")),
    cargoQuantity:
      toNumber(readDict(cargo, "quantity")) ??
      toNumber(readDict(keywords, "objectiveQuantity")),
    cargoVolume: toFloat(readDict(cargo, "volume")),
    pickupLocationID:
      toNumber(readDict(pickup, "locationID")) ??
      toNumber(readDict(keywords, "objectiveLocationID")),
    pickupSystemID:
      toNumber(readDict(pickup, "solarsystemID")) ??
      toNumber(readDict(keywords, "objectiveLocationSystemID")),
    destinationLocationID:
      toNumber(readDict(dropoff, "locationID")) ??
      toNumber(readDict(keywords, "objectiveDestinationID")),
    destinationSystemID:
      toNumber(readDict(dropoff, "solarsystemID")) ??
      toNumber(readDict(keywords, "objectiveDestinationSystemID")),
    rewardISK:
      toDecimalString(iskAmounts[0]) ?? toDecimalString(readDict(keywords, "rewardQuantity")),
    bonusISK: toDecimalString(bonusAmounts[0] ?? iskAmounts[1]),
    loyaltyPoints: toNumber(readDict(objectiveResult, "loyaltyPoints")),
    expirationTime: toDecimalString(readDict(briefingResult, "Expiration Time")),
    acceptTimestamp: toDecimalString(readDict(briefingResult, "AcceptTimestamp")),
  };
}

// --- journal ---------------------------------------------------------------

function decodeJournalRow(row: JsonValue): JournalMission {
  // [missionState, ?, missionTypeLabel, missionTitleID, agentID, expiry(long),
  //  bookmarks, ?, ?, missionID]
  const items = seqItems(row);
  return {
    missionState: toNumber(items[0]),
    missionTypeLabel: typeof items[2] === "string" ? items[2] : null,
    missionTitleID: toNumber(items[3]),
    agentID: toNumber(items[4]),
    expirationTime: toDecimalString(items[5]),
    missionID: toNumber(items[9]),
  };
}

/** Decode GetMyJournalDetails: tuple(activeMissions, offeredMissions). */
export function decodeJournal(result: JsonValue): JournalState {
  const buckets = seqItems(result);
  return {
    active: seqItems(buckets[0]).map(decodeJournalRow),
    offered: seqItems(buckets[1]).map(decodeJournalRow),
  };
}
