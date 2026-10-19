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

/** corpmgr.GetAggressionSettings: the object's two times (its state dict); null for anything else. */
export function aggressionSettingsOf(result: JsonValue | null | undefined): AggressionSettings | null {
  if (!isRecord(result) || result.type !== "object" || typeof result.name !== "string" || !result.name.endsWith("AggressionSettings")) {
    return null;
  }
  const args = result.args;
  const entries = isRecord(args) && Array.isArray(args.entries) ? args.entries : null;
  if (entries === null) return null;
  // The compiled settings methods read disable first, then enable. Instance
  // unmarshalling installs the state without __init__; an absent field is not
  // None. Preserve the native consumer failure after the raw reply is cached.
  // Other classes/state shapes still need their own native consumer audit.
  if (result.name === "crimewatch.corp_aggression.settings.AggressionSettings") {
    for (const key of ["_disableAfter", "_enableAfter"]) {
      if (!entries.some((candidate) => Array.isArray(candidate) && candidate[0] === key)) {
        throw Object.assign(new Error(`'AggressionSettings' object has no attribute '${key}'`), { name: "AttributeError", code: "INFO_CORPORATION_AGGRESSION_MISSING_FIELD" });
      }
    }
  }
  const time = (key: string): bigint | null => {
    const entry = entries.find((candidate) => Array.isArray(candidate) && candidate[0] === key);
    const text = Array.isArray(entry) ? longToDecimalString(entry[1]) : null;
    return text === null ? null : BigInt(text);
  };
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

/** fwCharacterEnlistmentMgr.GetCorpAllowedEnlistmentFactions: the factions' numbers; null for anything else. */
export function enlistmentFactionsOf(result: JsonValue | null | undefined): readonly number[] | null {
  // UpdateDataCorp iterates the answer directly. Numeric/bool scalars cannot
  // become an omitted row; native iteration raises TypeError before owner reads.
  // The bridge collapses some int/long/integral-float types, so do not invent
  // a Python type name in this diagnostic. None has its own flow consumer.
  if (typeof result === "number" || typeof result === "boolean"
    || (isRecord(result) && (result.type === "long" || result.type === "real" || result.type === "float"))) {
    throw Object.assign(new TypeError("The corporation enlistment answer is not iterable."), { code: "INFO_CORPORATION_ENLISTMENT_NOT_ITERABLE" });
  }
  const items = Array.isArray(result)
    ? result
    : isRecord(result) && (result.type === "list" || result.type === "tuple" || result.type === "set") && Array.isArray(result.items)
      ? result.items
      : null;
  if (items === null) return null;
  return items.map((item) => toNumOrNull(item)).filter((id): id is number => id !== null);
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
  readonly readAt: bigint;
}

/** The native header exists before UpdateDataCorp and the main tabs complete. */
export type CorporationInfoRead = CorporationShowInfo | {
  readonly stage: "header";
  readonly info: CorporationPublicInfo;
};
