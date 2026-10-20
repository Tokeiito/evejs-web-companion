// Show Info on a corporation and on an alliance: what the client's info window reads of them and the rows it makes.
//
//   corporationInfoWindow.py   reconstruct_info_window: corpmgr.GetPublicInfo(itemID); the CEO beside the picture for a
//                              player's corporation; construct_header: the alliance it is a member of, its headquarters
//                              (a player's corporation: its station, by the house icon)
//   infosvc.py UpdateDataCorp  the Attributes tab: CEO (or CEO and Founder), Founder, Alliance, Ticker Name, Shares,
//                              Member Count (not for an NPC corporation), ISK Tax Rate, LP Tax Rate, Friendly Fire;
//                              for a player's corporation Permitted Faction Enlistments and War Eligibility; its URL
//   infosvc.py UpdateDataAlliance  the Attributes tab of allianceRegistry.GetAlliancePublicInfo(itemID): Executor, Short
//                              Name, Created By Corporation, Created By, Start Date, Default Vulnerability Time, War
//                              Eligibility, Current Capital, URL
//
// Tranquility's answer to GetPublicInfo (LOGS/Archive, "Applying and accepting a corp invite"): a util.KeyVal of
// creatorID, descriptionID, taxRate, corporationID, tickerName, corporationNameID, memberCount, shares (a string there),
// allianceID, deleted, stationID, url, loyaltyPointTaxRate, ceoID, corporationName, aggressionSettings, allowWar and
// description.

import { readKeyVal, type JsonValue } from "./wire.ts";
import { isRecord, longToDecimalString, toNum, toNumOrNull, toStr } from "./allianceInfo.ts";
import { unicodeIntText } from "./py27UnicodeInt.ts";

/** inventorycommon/const.py: the NPC corporations' numbers (idCheckers.IsNPCCorporation). */
export function isNpcCorporation(ownerID: number): boolean {
  return ownerID >= 1_000_000 && ownerID <= 1_999_999;
}

/**
 * Whether an owner is a character (the info window asks its type's group: cfg.eveowners.Get(id).typeID in
 * groupCharacter). By its number, as idCheckers.IsCharacter takes it: an NPC character (minAgent 3000000 to maxAgent
 * 3999999) or a player's (90000000 to 97999999, 2100000000 to 2129999999); in 100000000 to 2099999999, where the client
 * asks the owner's type, EveJS keeps its pilots and no corporation or alliance.
 */
export function isCharacterOwner(ownerID: number): boolean {
  return (ownerID >= 3_000_000 && ownerID <= 3_999_999)
    || (ownerID >= 90_000_000 && ownerID <= 97_999_999)
    || (ownerID >= 100_000_000 && ownerID <= 2_129_999_999);
}

/** corpmgr.GetPublicInfo, as the info window reads it. */
export interface CorporationPublicInfo {
  readonly corporationID: number;
  readonly corporationName: string;
  readonly tickerName: string;
  readonly ceoID: number | null;
  readonly creatorID: number | null;
  readonly allianceID: number | null;
  readonly stationID: number | null;
  /** As sent: an int is written grouped, anything else (Tranquility's string) as it is. */
  readonly shares: number | string | null;
  readonly memberCount: number | null;
  readonly taxRate: number;
  readonly loyaltyPointTaxRate: number;
  /** None where it is not known (warPermitUtil: CorpStatusWarPermitUnknown). */
  readonly allowWar: boolean | null;
  readonly url: string;
  readonly description: string;
  readonly deleted: boolean;
}

function flag(value: JsonValue | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  const number = toNumOrNull(value);
  return number === null ? null : number !== 0;
}

/** corpmgr.GetPublicInfo's util.KeyVal; null for anything else. */
export function corporationPublicInfoOf(result: JsonValue | null | undefined): CorporationPublicInfo | null {
  const corporationID = toNumOrNull(readKeyVal(result, "corporationID"));
  if (corporationID === null) return null;
  const read = (key: string): JsonValue | undefined => readKeyVal(result, key);
  const shares = read("shares");
  return {
    corporationID,
    corporationName: toStr(read("corporationName")),
    tickerName: toStr(read("tickerName")),
    ceoID: toNumOrNull(read("ceoID")),
    creatorID: toNumOrNull(read("creatorID")),
    allianceID: toNumOrNull(read("allianceID")),
    stationID: toNumOrNull(read("stationID")),
    shares: typeof shares === "string" ? shares : toNumOrNull(shares),
    memberCount: toNumOrNull(read("memberCount")),
    taxRate: toNum(read("taxRate")),
    loyaltyPointTaxRate: toNum(read("loyaltyPointTaxRate")),
    allowWar: flag(read("allowWar")),
    url: toStr(read("url")),
    description: toStr(read("description")),
    deleted: flag(read("deleted")) === true,
  };
}

/** crimewatch/corp_aggression/settings.py AggressionSettings: when friendly fire becomes legal, and illegal. */
export interface AggressionSettings {
  readonly enableAfter: bigint | null;
  readonly disableAfter: bigint | null;
}

function isAggressionBuiltin(result: JsonValue): boolean {
  return typeof result === "number" || typeof result === "boolean" || typeof result === "string"
    || Array.isArray(result) || (isRecord(result) && ["long", "real", "float", "wstring", "Buffer", "list", "tuple", "dict", "set"].includes(String(result.type)));
}

/** GetCorpFriendlyFireStatus280-282 calls this method on the cached raw reply. */
export function assertCorpAggressionStatusMethod(result: JsonValue): void {
  if (isAggressionBuiltin(result)) throw Object.assign(new Error("The aggression reply has no attribute 'IsFriendlyFireLegalAtTime'."), {
    name: "AttributeError", code: "INFO_CORPORATION_AGGRESSION_METHOD_MISSING",
  });
  // Unknown classes and malformed instance states can fail during native
  // unmarshalling, before this consumer. Do not infer their failure here.
}

/** Native ASCII attribute names compare equally to Unicode/byte-string keys. */
function aggressionStateKey(value: JsonValue): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  if (value.type === "wstring" && typeof value.value === "string") return value.value;
  if (value.type === "Buffer" && Array.isArray(value.data)
    && value.data.every(byte => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return value.data.map(byte => String.fromCharCode(byte as number)).join("");
  }
  return null;
}

/** corpmgr.GetAggressionSettings: the object's two times (its state dict); null for anything else. */
export function aggressionSettingsOf(result: JsonValue | null | undefined, now?: bigint): AggressionSettings | null {
  if (!isRecord(result) || result.type !== "object" || typeof result.name !== "string" || !result.name.endsWith("AggressionSettings")) {
    return null;
  }
  const args = result.args;
  const entries = isRecord(args) && Array.isArray(args.entries) ? args.entries : null;
  if (entries === null) return null;
  const canonical = result.name === "crimewatch.corp_aggression.settings.AggressionSettings";
  const state = new Map<string, JsonValue>();
  let onlyTextKeys = true;
  if (canonical) for (const entry of entries) {
    if (!Array.isArray(entry)) { onlyTextKeys = false; continue; }
    const key = aggressionStateKey(entry[0]);
    if (key === null) { onlyTextKeys = false; continue; }
    // ReadObjectDict sets entries in wire order. ASCII str/unicode aliases
    // coalesce in the native dict, with the last value retained.
    state.set(key, entry[1]);
  }
  const read = (key: string): JsonValue | undefined => canonical
    ? state.get(key) : entries.find(candidate => Array.isArray(candidate) && candidate[0] === key)?.[1];
  const numericTime = (key: string): boolean => {
    const value = read(key);
    return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value))
      || (isRecord(value) && value.type === "long" && /^-?\d+$/.test(longToDecimalString(value) ?? ""));
  };
  const time = (key: string): bigint | null => {
    const value = read(key);
    // Native settings retain the value, and bool is an int in these numeric
    // comparisons. False/True timestamps are 0/1, distinct from None.
    if (typeof value === "boolean") return value ? 1n : 0n;
    const text = longToDecimalString(value);
    return text === null ? null : BigInt(text);
  };
  // The compiled settings methods read disable first, then enable. Instance
  // unmarshalling installs the state without __init__; an absent field is not
  // None. Preserve the native consumer failure after the raw reply is cached.
  // Other classes/state shapes still need their own native consumer audit.
  if (canonical) {
    const requireCallable = (method: string): void => {
      const shadow = state.get(method);
      if (state.has(method) && shadow !== undefined && (shadow === null || isAggressionBuiltin(shadow))) {
        throw Object.assign(new TypeError("The aggression status method is not callable."), { code: "INFO_CORPORATION_AGGRESSION_NOT_CALLABLE" });
      }
    };
    // Instance dict state can shadow a class method. The first status call
    // fails before any settings field is read, even if those fields are absent.
    requireCallable("IsFriendlyFireLegalAtTime");
    const originalStatus = onlyTextKeys && !state.has("IsFriendlyFireLegalAtTime");
    if (originalStatus) requireCallable("_IsDisableTimeInPast");
    for (const key of ["_disableAfter", "_enableAfter"]) {
      // Original IsFriendlyFireLegalAtTime calls the disable helper before
      // reading disable, then the enable helper before reading enable. An
      // unknown callable or nonnumeric comparison needs its own native audit.
      if (key === "_enableAfter" && originalStatus && !state.has("_IsDisableTimeInPast") && numericTime("_disableAfter")) {
        requireCallable("_IsEnableTimeInPast");
      }
      if (!state.has(key)) {
        throw Object.assign(new Error(`AggressionSettings instance has no attribute '${key}'`), { name: "AttributeError", code: "INFO_CORPORATION_AGGRESSION_MISSING_FIELD" });
      }
    }
    // The second call follows the first method's field reads. Limit this
    // boundary to original methods and known numeric state. Its enable helper
    // is conditional: a pending disable returns before it is called.
    const firstUnmodified = onlyTextKeys
      && !["IsFriendlyFireLegalAtTime", "_IsDisableTimeInPast", "_IsEnableTimeInPast"].some(key => state.has(key));
    const numericTimes = ["_disableAfter", "_enableAfter"].every(numericTime);
    if (firstUnmodified && numericTimes) {
      requireCallable("GetNextPendingChangeTime");
      if (!state.has("GetNextPendingChangeTime")) {
        requireCallable("_IsDisableTimeInFuture");
        const disable = time("_disableAfter");
        if (!state.has("_IsDisableTimeInFuture") && now !== undefined && (disable === null || disable < now)) {
          requireCallable("_IsEnableTimeInFuture");
        }
      }
    }
  }
  return { enableAfter: time("_enableAfter"), disableAfter: time("_disableAfter") };
}

/**
 * base_corporation.GetCorpFriendlyFireStatus with AggressionSettings.IsFriendlyFireLegalAtTime and
 * GetNextPendingChangeTime: whether friendly fire is legal now, and when it next changes (null where nothing is
 * pending). With neither time past it is legal (DEFAULT_AGGRESSION_ENABLED).
 */
export function friendlyFireAt(settings: AggressionSettings, now: bigint): { readonly legal: boolean; readonly changeAt: bigint | null } {
  const { enableAfter, disableAfter } = settings;
  const disablePast = disableAfter !== null && disableAfter < now;
  const enablePast = enableAfter !== null && enableAfter < now;
  const legal = disablePast && enablePast ? disableAfter! < enableAfter! : disablePast ? false : enablePast ? true : true;
  const changeAt = disableAfter !== null && disableAfter >= now ? disableAfter : enableAfter !== null && enableAfter >= now ? enableAfter : null;
  return { legal, changeAt };
}

/** The friendly fire status's label (GetCorpFriendlyFireStatus); `tomorrow` where the change is on another day. */
export function friendlyFireLabel(legal: boolean, changeAt: bigint | null, tomorrow: boolean): string {
  if (changeAt === null) return legal ? "UI/Corporations/FriendlyFire/Legal" : "UI/Corporations/FriendlyFire/Illegal";
  if (legal) return tomorrow ? "UI/Corporations/FriendlyFire/LegalWithChangeTimeTomorrow" : "UI/Corporations/FriendlyFire/LegalWithChangeTime";
  return tomorrow ? "UI/Corporations/FriendlyFire/IllegalWithChangeTimeTomorrow" : "UI/Corporations/FriendlyFire/IllegalWithChangeTime";
}

/** evewar/warPermitUtil.GetLabelPathForAllowWar. */
export function warPermitLabel(allowWar: boolean | null): string {
  if (allowWar === null) return "UI/WarPermit/CorpStatusWarPermitUnknown";
  return allowWar ? "UI/WarPermit/CorpStatusWarAllowed" : "UI/WarPermit/CorpStatusWarNotAllowed";
}

const byteEncoder = new TextEncoder();

/** The bridge's exact UTF8 text or explicit byte array, restored to native str. */
function enlistmentByteText(value: JsonValue | null | undefined): string | null {
  const bytes = typeof value === "string" ? byteEncoder.encode(value)
    : isRecord(value) && value.type === "Buffer" && Array.isArray(value.data)
      && value.data.every(byte => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? value.data as number[] : null;
  if (bytes === null) return null;
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Recordset.Get's int(key), within the owner IDs this transport represents. */
function enlistmentOwnerKey(value: JsonValue): number {
  let key: number;
  const text = isRecord(value) && value.type === "wstring" && typeof value.value === "string"
    ? unicodeIntText(value.value) : enlistmentByteText(value);
  if (text !== null) {
    // The client runtime's byte int parser also accepts native byte0xA0 as
    // whitespace. UTF8 text containing NBSP remains bytes C2 A0 and fails.
    if (!/^[ \t\n\r\f\v\u00a0]*[+-]?[0-9]+[ \t\n\r\f\v\u00a0]*$/.test(text)) {
      throw Object.assign(new Error("Invalid enlistment owner key for int()."), { name: "ValueError", code: "INFO_CORPORATION_ENLISTMENT_OWNER_KEY" });
    }
    key = Number(text);
  } else if (typeof value === "number") key = Math.trunc(value);
  else if (typeof value === "boolean") key = value ? 1 : 0;
  else if (isRecord(value) && value.type === "long" && longToDecimalString(value) !== null) key = Number(longToDecimalString(value));
  else {
    throw Object.assign(new TypeError("int() requires a string or number for an enlistment owner key."), { code: "INFO_CORPORATION_ENLISTMENT_OWNER_KEY" });
  }
  // Do not send a rounded identifier. Lossless larger keys need a wider
  // owner-key representation.
  if (!Number.isSafeInteger(key)) throw Object.assign(new RangeError("The enlistment owner key exceeds this transport's integer range."), { code: "INFO_CORPORATION_ENLISTMENT_OWNER_RANGE" });
  return key === 0 ? 0 : key;
}

/** Native enlistment iteration: convert each key only when its owner is read. */
export function enlistmentFactionsOf(result: JsonValue | null | undefined): Iterable<number> | null {
  // Native UpdateDataCorp iterates these too. No owner lookup occurs for an
  // empty dict/str/unicode, but the "No factions permitted" row is still built.
  if (result === "" || (isRecord(result)
    && ((result.type === "dict" && Array.isArray(result.entries) && result.entries.length === 0)
      || (result.type === "wstring" && result.value === "")))) return [];
  // UpdateDataCorp iterates the answer directly. Numeric/bool scalars cannot
  // become an omitted row; native iteration raises TypeError before owner reads.
  // The bridge collapses some int/long/integral-float types, so do not invent
  // a Python type name in this diagnostic. None has its own flow consumer.
  if (typeof result === "number" || typeof result === "boolean"
    || (isRecord(result) && (result.type === "long" || result.type === "real" || result.type === "float"))) {
    throw Object.assign(new TypeError("The corporation enlistment answer is not iterable."), { code: "INFO_CORPORATION_ENLISTMENT_NOT_ITERABLE" });
  }
  const unicode = isRecord(result) && result.type === "wstring" && typeof result.value === "string" ? result.value : null;
  const bytes = enlistmentByteText(result);
  // UpdateDataCorp iterates str/unicode, rather than treating the entire text
  // as one Recordset.Get key. Keep conversion lazy so earlier characters can
  // prime owners before a later invalid character raises. Typed Unicode uses
  // narrow UTF16 units and keeps its type at int(key). Byte text restores the
  // bridge's exact UTF8 bytes or Bufferdata, retaining each byte's identity.
  const items = unicode !== null
    ? unicode.split("").map(value => ({ type: "wstring", value }))
    : bytes !== null
      ? bytes.split("").map(value => ({ type: "Buffer", data: [value.charCodeAt(0)] }))
      : Array.isArray(result)
        ? result
        : isRecord(result) && (result.type === "list" || result.type === "tuple" || result.type === "set") && Array.isArray(result.items)
          ? result.items
          : null;
  if (items === null) return null;
  return (function* () { for (const item of items) yield enlistmentOwnerKey(item); })();
}

/** The labels the two windows word their rows with (the page's own words stand in where the install's are not had). */
export const OWNER_INFO_WORDS: Readonly<Record<string, string>> = {
  "UI/InfoWindow/TabNames/Description": "Description",
  "UI/InfoWindow/TabNames/Attributes": "Attributes",
  "UI/Corporations/CorpUIHome/CeoAndFounder": "CEO, founder",
  "UI/Corporations/Common/CEO": "CEO",
  "UI/Corporations/Common/Founder": "Founder",
  "UI/Common/Alliance": "Alliance",
  "UI/Corporations/CorpUIHome/TickerName": "Ticker",
  "UI/Corporations/CorpUIHome/Shares": "Shares",
  "UI/Corporations/CorpUIHome/MemberCount": "Members",
  "UI/Corporations/CorpUIHome/ISKTaxRate": "ISK tax",
  "UI/Corporations/CorpUIHome/LPTaxRate": "LP tax",
  "UI/Corporations/CorpUIHome/FriendlyFire": "Friendly fire",
  "UI/Common/Percentage": "{[numeric]percentage, decimalPlaces=1}%",
  "UI/Corporations/CorpUIHome/PermittedFwFactions": "May enlist with",
  "UI/Corporations/CorpUIHome/NoFwFactionsPermitted": "No faction",
  "UI/WarPermit/WarPermitStatus": "Wars",
  "UI/WarPermit/CorpStatusWarPermitUnknown": "Not known",
  "UI/WarPermit/CorpStatusWarAllowed": "Can be at war",
  "UI/WarPermit/CorpStatusWarNotAllowed": "Cannot be at war",
  "UI/Corporations/CorpUIHome/URL": "Web",
  "UI/Corporations/CorpUIHome/URLPlaceholder": "{linkTag}{url}</url>",
  "UI/InfoWindow/MemberOfAlliance": "In {allianceName}",
  "UI/InfoWindow/ClosedCorpOrAllianceCaption": "{corpOrAllianceName} (closed)",
  "UI/InfoWindow/ClickForAllianceInfo": "The alliance's information",
  "UI/FactionWarfare/MilitiaAndFaction": "Fights for {factionName}",
  "UI/Corporations/BaseCorporationUI/ISKTaxRateDescription": "",
  "UI/Corporations/BaseCorporationUI/LPTaxRateDescription": "",
  "UI/Corporations/FriendlyFire/Description": "",
  "UI/WarPermit/WarPermitExplanation": "",
  "UI/Corporations/FriendlyFire/Legal": "Allowed",
  "UI/Corporations/FriendlyFire/Illegal": "Not allowed",
  "UI/Corporations/FriendlyFire/LegalWithChangeTime": "Allowed until {time}",
  "UI/Corporations/FriendlyFire/LegalWithChangeTimeTomorrow": "Allowed until {time} tomorrow",
  "UI/Corporations/FriendlyFire/IllegalWithChangeTime": "Not allowed until {time}",
  "UI/Corporations/FriendlyFire/IllegalWithChangeTimeTomorrow": "Not allowed until {time} tomorrow",
  "UI/Corporations/CorporationWindow/Alliances/Home/Executor": "Executor",
  "UI/Corporations/CorporationWindow/Alliances/Home/ShortName": "Ticker",
  "UI/InfoWindow/CreatedByCorp": "Founding corporation",
  "UI/Corporations/CorporationWindow/Alliances/Home/CreatedBy": "Founder",
  "UI/InfoWindow/StartDate": "Founded",
  "UI/Sovereignty/DefaultVulnerabilityTime": "Vulnerability hour",
  "UI/Sovereignty/CurrentCapital": "Capital",
  "UI/Common/URL": "Web",
  "UI/Sovereignty/VulnerabilityTime": "{[numeric]hour, leadingZeroes=2}:00",
  "UI/Sovereignty/VulnerabilityTimerChangesTime": "{[numeric]hour, leadingZeroes=2}:00, then {[numeric]newHour, leadingZeroes=2}:00",
  "UI/Sovereignty/VulnerabilityTimerChangesInfo": "From {[datetime]validAfterDate, date=short, time=short}",
  "UI/Common/Unknown": "Not known",
};

/** What Show Info on a corporation reads (flow.corporationShowInfo), with the server's time it was read at. */
export interface CorporationShowInfo {
  readonly stage: "complete";
  readonly info: CorporationPublicInfo;
  readonly aggression: AggressionSettings | null;
  /** Null for an NPC corporation, whose window has no such row, or where the read failed. */
  readonly enlistmentFactions: readonly number[] | null;
  /** Sorted cfg.eveowners names, read before completion; None is a row value. */
  readonly enlistmentFactionNames: readonly (string | null)[] | null;
  /** Friendly-fire status time, before the later enlistment/owner reads. */
  readonly readAt: bigint;
}

/** The native header exists before UpdateDataCorp and the main tabs complete. */
export type CorporationInfoRead = CorporationShowInfo | {
  readonly stage: "header";
  readonly info: CorporationPublicInfo;
};
