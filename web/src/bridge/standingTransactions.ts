// What the client's standings panel shows of a standing's history and of a corporation's (charsheet/standingsPanel
// standingsHistoryEntry.py, standingCompositionEntry.py): each change's icon, date, change and reason.
//
// THE REASON is eveFormat.FmtStandingTransaction (76 to 222): a subject, the row's words, and a body, its hint, each
// a label of the client's filled from the transaction's fields (fromID, int_1 to int_3, msg) as its event has them.
// The client builds them in turn and gives up on the first that fails (an owner or a place it cannot name: a KeyError
// in cfg.eveowners or cfg.evelocations, a bonus message it cannot unpickle), keeping the subject it had by then and
// no body; where nothing is had, "Standing Change".
//
// THE CHANGE is the modification as the standing service keeps it (standingsvc.GetStandingTransactions: the server's
// times ten), RoundStandingChange'd (to three places, and no smaller than 0.001 either way) and written by
// GetStandingChangeFormatted ("+" before a gain, as Python's %s writes the float).

import type { JsonValue } from "./wire.ts";

/** appLogConst's standing events. */
export const STANDING_EVENTS = Object.freeze({
  reset: 25,
  decay: 49,
  recommendationLetterUsed: 60,
  playerSet: 65,
  playerCorpSet: 68,
  agentBuyOff: 71,
  agentDonation: 72,
  missionCompleted: 73,
  missionFailed: 74,
  missionDeclined: 75,
  combatAggression: 76,
  combatShipKill: 77,
  combatPodKill: 78,
  combatOther: 79,
  missionBonus: 80,
  tutorialAgentInitial: 81,
  derivedPositive: 82,
  derivedNegative: 83,
  slashSet: 84,
  pirateKillSecurityStatus: 89,
  missionOfferExpired: 90,
  combatAssistance: 112,
  contraband: 126,
  propertyDamage: 154,
  promotionFactionIncrease: 216,
  shipKillOwnFaction: 223,
  podKillOwnFaction: 224,
  aggressionOwnFaction: 225,
  assistanceOwnFaction: 226,
  propertyDamageOwnFaction: 227,
  siteDefended: 229,
  siteConquered: 230,
  groupRewardCorporation: 485,
  groupRewardFaction: 486,
  campaignObjectiveContributionReward: 558,
});

/** A standing's change as the panel reads it. */
export interface StandingChange {
  readonly eventTypeID: number;
  /** As the standing service keeps it: the server's times ten. */
  readonly modification: number;
  readonly fromID: number | null;
  readonly msg: string | null;
  readonly int1: number | null;
  readonly int2: number | null;
  readonly int3: number | null;
}

/** What FmtStandingTransaction needs of the client. */
export interface StandingChangeWording {
  /** A label's text: the install's, else the page's own. */
  readonly template: (label: string) => string;
  /** A label's text filled with these arguments (names through the page's names). */
  readonly fill: (template: string, args: Readonly<Record<string, JsonValue>>) => string;
  /** cfg.eveowners' name of an owner; null for a number that is no owner (the client's KeyError). */
  readonly ownerName: (ownerID: number) => string | null;
  /** cfg.evelocations' name of a place; null for a number that is no place. */
  readonly locationName: (locationID: number) => string | null;
  /** localization.GetByMessageID: the message's text; null where the install has none, undefined while not read. */
  readonly messageText: (messageID: number) => string | null | undefined;
  /** get_corporation_faction_id. */
  readonly corporationFaction: (corporationID: number) => number | null;
}

const LABEL = (name: string): string => `UI/Generic/FormatStandingTransactions/${name}`;
/** localization's words for a message it does not have (localizationBase.GetByMessageID, common/util.py). */
const unresolvedMessage = (messageID: number): string => `[no messageID: ${messageID}]`;

class LookupFailed extends Error {}

/** Python's truth of a value: None, nought and the empty string are false. */
const truthy = (value: unknown): boolean => value !== null && value !== undefined && value !== 0 && value !== "";

/**
 * pickle.loads of a protocol 0 pickle of a dict of strings (cPickle.loads(binascii.a2b_hex(msg))), the mission
 * bonus's header and body; it throws for anything else, as the client's does.
 */
function unpickleTextDict(hex: string): Map<string, string> {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new LookupFailed("not hex");
  let text = "";
  for (let at = 0; at < hex.length; at += 2) text += String.fromCharCode(parseInt(hex.slice(at, at + 2), 16));
  const stack: unknown[] = [];
  const memo = new Map<string, unknown>();
  const MARK = Symbol("mark");
  const unescape = (body: string): string =>
    body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_whole, escape: string) => {
      if (escape[0] === "x" || escape[0] === "u") return String.fromCharCode(parseInt(escape.slice(1), 16));
      return ({ n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"' } as Record<string, string>)[escape] ?? escape;
    });
  // An opcode is one character; S, V, p and g take what runs to the next newline, the others nothing.
  let at = 0;
  const argument = (): string => {
    const end = text.indexOf("\n", at);
    if (end < 0) throw new LookupFailed("no newline");
    const value = text.slice(at, end);
    at = end + 1;
    return value;
  };
  while (at < text.length) {
    const op = text[at++];
    if (op === "(") {
      stack.push(MARK);
    } else if (op === "d") {
      const mark = stack.lastIndexOf(MARK);
      if (mark < 0) throw new LookupFailed("no mark");
      stack.splice(mark);
      stack.push(new Map<string, string>());
    } else if (op === "S") {
      const arg = argument();
      const quote = arg[0];
      if ((quote !== "'" && quote !== '"') || arg.length < 2 || arg[arg.length - 1] !== quote) throw new LookupFailed("bad string");
      stack.push(unescape(arg.slice(1, -1)));
    } else if (op === "V") {
      stack.push(unescape(argument()));
    } else if (op === "p") {
      memo.set(argument(), stack[stack.length - 1]);
    } else if (op === "g") {
      const key = argument();
      if (!memo.has(key)) throw new LookupFailed("no memo");
      stack.push(memo.get(key));
    } else if (op === "s") {
      const value = stack.pop();
      const key = stack.pop();
      const dict = stack[stack.length - 1];
      if (!(dict instanceof Map) || typeof key !== "string" || typeof value !== "string") throw new LookupFailed("bad item");
      dict.set(key, value);
    } else if (op === ".") {
      const result = stack.pop();
      if (!(result instanceof Map)) throw new LookupFailed("not a dict");
      return result as Map<string, string>;
    } else {
      throw new LookupFailed(`opcode ${op}`);
    }
  }
  throw new LookupFailed("no stop");
}

/** FmtStandingTransaction: the reason's subject (the row's words) and body (its hint), filled and with their markup. */
export function standingChangeWords(change: StandingChange, wording: StandingChangeWording): { readonly subject: string; readonly body: string } {
  const label = (name: string, args: Readonly<Record<string, JsonValue>> = {}): string => wording.fill(wording.template(LABEL(name)), args);
  const owner = (ownerID: number | null): string => {
    const name = ownerID === null ? null : wording.ownerName(ownerID);
    if (name === null) throw new LookupFailed("no owner");
    return name;
  };
  const location = (locationID: number | null): string => {
    const name = locationID === null ? null : wording.locationName(locationID);
    if (name === null) throw new LookupFailed("no location");
    return name;
  };
  const E = STANDING_EVENTS;
  let subject = label("subjectStandingChange");
  let body = "";
  try {
    const { eventTypeID, int1, int2, int3, msg } = change;
    switch (eventTypeID) {
      case E.decay:
        subject = label("subjectDecay");
        body = label("messageDecay");
        break;
      case E.derivedPositive:
        subject = label("subjectDerivedModificatonPositive");
        body = label("messageDerivedModificatonPositive", { name: owner(change.fromID) });
        break;
      case E.derivedNegative:
        subject = label("subjectDerivedModificatonNegitive");
        body = label("messageDerivedModificatonNegitive", { name: owner(change.fromID) });
        break;
      case E.combatAggression:
        subject = label("subjectCombatAgression");
        body = label("messageCombatAgression", { locationID: int2, ownerName: owner(int1), typeID: int3 });
        break;
      case E.combatAssistance:
        subject = label("subjectCombatAssistence");
        body = label("messageCombatAssistence", { locationID: int2, name: owner(int1), typeID: int3 });
        break;
      case E.combatShipKill:
        subject = label("subjectCombatShipKill");
        body = label("messageCombatShipKill", { locationID: int2, name: owner(int1), typeID: int3 });
        break;
      case E.propertyDamage:
        subject = label("subjectPropertyDamage");
        body = label("messagePropertyDamage", { locationID: int2, name: owner(int1), typeID: int3 });
        break;
      case E.combatPodKill: {
        const n1 = truthy(int1) ? owner(int1) : "???";
        const n2 = truthy(int2) ? location(int2) : "???";
        subject = label("subjectCombatPodKill");
        body = label("messageCombatPodKill", { locationName: n2, name: n1 });
        break;
      }
      case E.slashSet: {
        const n = truthy(int1) ? owner(int1) : "???";
        subject = label("subjectSetBySlashCmd");
        body = label("messageSetBySlashCmd", { message: msg, name: n });
        break;
      }
      case E.reset:
        subject = label("subjectSetBySlashCmd");
        body = label("messageResetBySlashCmd");
        break;
      case E.playerSet:
        subject = label("subjectPlayerSet");
        body = label("messagePlayerSet", { message: msg });
        break;
      case E.playerCorpSet:
        subject = label("subjectCorporationSet");
        body = label("messageCorporationSet", { message: msg, name: owner(int1) });
        break;
      case E.missionCompleted:
      case E.missionDeclined:
      case E.missionFailed:
      case E.missionOfferExpired: {
        const read = int1 !== null ? wording.messageText(int1) : null;
        const missionName = int1 !== null ? (read === null ? unresolvedMessage(int1) : (read ?? "")) : (msg ?? "");
        if (eventTypeID === E.missionCompleted) {
          subject = label("subjectMissionComplete", { message: missionName });
          body = label("messageMissionComplete", { message: missionName });
        } else if (eventTypeID === E.missionDeclined) {
          subject = label("subjectMissionDeclined", { message: missionName });
          body = label("messageMissionDecline", { message: missionName });
        } else if (eventTypeID === E.missionFailed) {
          subject = label("subjectMissionFailed", { message: missionName });
          body = label("messageMissionFailed", { message: missionName });
        } else {
          subject = label("subjectMissionExpired", { message: missionName });
          // As the client has it: the words without the name where there is one, and with it where there is none.
          body = truthy(missionName) ? label("messageMissionExpiredNoMsg") : label("messageMissionExpiredMsg", { message: missionName });
        }
        break;
      }
      case E.missionBonus: {
        const stuff = unpickleTextDict(msg ?? "");
        if (change.modification >= 0.0) {
          subject = label("subjectMissionBonus", { message: stuff.get("header") ?? "???" });
          body = label("messageMissionBonus", { message: stuff.get("body") ?? "???" });
        } else {
          subject = label("subjectMissionPenalty", { message: stuff.get("header") ?? "???" });
          body = label("messageMissionPenalty", { message: stuff.get("body") ?? "???" });
        }
        break;
      }
      case E.pirateKillSecurityStatus:
        subject = label("subjectLawEnforcmentGain");
        body = label("messageLawEnforcmentGain", { name: owner(int1) });
        break;
      case E.promotionFactionIncrease: {
        // The rank's name is the faction warfare service's (GetRankLabel), which the page does not have: the body is
        // left out, as the client's would be where that failed.
        subject = label("subjectFacwarPromotion");
        owner(int2);
        if (int2 !== null) wording.corporationFaction(int2);
        throw new LookupFailed("no rank label");
      }
      case E.shipKillOwnFaction:
        subject = label("subjectCombatShipKill");
        body = label("messageCombatSkipKillOwnFaction", { factionName: owner(int1), locationID: int2, typeID: int3 });
        break;
      case E.podKillOwnFaction:
        subject = label("subjectCombatPodKill");
        body = label("messageCombatPodKillOwnFaction", { factionName: owner(int1), locationID: int2 });
        break;
      case E.aggressionOwnFaction:
        subject = label("subjectCombatAgression");
        body = label("messageCombatAgressionOwnFaction", { factionName: owner(int1), locationID: int2, typeID: int3 });
        break;
      case E.assistanceOwnFaction:
        subject = label("subjectCombatAssistence");
        body = label("messageCombatAssistanceOwnFaction", { factionName: owner(int1), locationID: int2, typeID: int3 });
        break;
      case E.propertyDamageOwnFaction:
        subject = label("subjectPropertyDamage");
        body = label("messageCombatProprtyDamageOwnFaction", { factionName: owner(int1), locationID: int2, typeID: int3 });
        break;
      case E.siteDefended:
        subject = label("subjectFacwarSiteDefened");
        body = label("messageFacwarSiteDefened", { enemyFactionName: owner(int2), factionName: owner(int1) });
        break;
      case E.siteConquered:
        subject = label("subjectFacwarSiteConquered");
        body = label("messageFacwarSiteConquered", { enemyFactionName: owner(int2), factionName: owner(int1) });
        break;
      case E.recommendationLetterUsed:
        subject = label("subjectRecomendationLetterUsed");
        body = label("messageRecomendationLetterUsed");
        break;
      case E.tutorialAgentInitial:
        body = label("messageGraduation");
        break;
      case E.contraband: {
        const factionName = truthy(int1) ? owner(int1) : label("labelSomeone");
        const locationName = truthy(int2) ? location(int2) : label("labelSomewhere");
        subject = label("subjectContraband");
        body = label("messageContraband", { factionName, systemName: locationName });
        break;
      }
      case E.groupRewardCorporation:
      case E.groupRewardFaction:
        subject = label("subjectGroupReward");
        body = label("messageGroupReward");
        break;
      case E.campaignObjectiveContributionReward:
        subject = label("subjectCampaignObjectiveContributionReward");
        body = label("messageCampaignObjectiveContributionReward");
        break;
      default:
        break;
    }
  } catch {
    // log.LogException: the subject had by then, and no body.
  }
  return { subject, body };
}

/** The reasons' labels, with the page's own words where the install's are not had. */
export const STANDING_CHANGE_WORDS: Readonly<Record<string, string>> = {
  "UI/Generic/FormatStandingTransactions/subjectStandingChange": "A change of standing",
  "UI/Generic/FormatStandingTransactions/subjectDecay": "Drift",
  "UI/Generic/FormatStandingTransactions/messageDecay": "Standings drift down over time.",
  "UI/Generic/FormatStandingTransactions/subjectDerivedModificatonPositive": "Through others",
  "UI/Generic/FormatStandingTransactions/messageDerivedModificatonPositive": "{name} thought better of you for what you did to those it likes or dislikes.",
  "UI/Generic/FormatStandingTransactions/subjectDerivedModificatonNegitive": "Through others",
  "UI/Generic/FormatStandingTransactions/messageDerivedModificatonNegitive": "{name} thought worse of you for what you did to those it likes or dislikes.",
  "UI/Generic/FormatStandingTransactions/subjectCombatAgression": "Attack",
  "UI/Generic/FormatStandingTransactions/messageCombatAgression": "You attacked a {[item]typeID.name} of {ownerName} in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/subjectCombatAssistence": "Help in a fight",
  "UI/Generic/FormatStandingTransactions/messageCombatAssistence": "You helped a {[item]typeID.name} of {name} in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/subjectCombatShipKill": "A ship destroyed",
  "UI/Generic/FormatStandingTransactions/messageCombatShipKill": "You destroyed a {[item]typeID.name} of {name} in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/subjectPropertyDamage": "Damage done",
  "UI/Generic/FormatStandingTransactions/messagePropertyDamage": "You destroyed a {[item]typeID.name} of {name} in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/subjectCombatPodKill": "A capsule destroyed",
  "UI/Generic/FormatStandingTransactions/messageCombatPodKill": "You destroyed the capsule of {name} in {locationName}.",
  "UI/Generic/FormatStandingTransactions/subjectSetBySlashCmd": "Set by a GM",
  "UI/Generic/FormatStandingTransactions/messageSetBySlashCmd": "{name} set it: {message}",
  "UI/Generic/FormatStandingTransactions/messageResetBySlashCmd": "A GM put it back to nothing.",
  "UI/Generic/FormatStandingTransactions/subjectPlayerSet": "Set by the pilot",
  "UI/Generic/FormatStandingTransactions/messagePlayerSet": "The pilot set it: {message}",
  "UI/Generic/FormatStandingTransactions/subjectCorporationSet": "Set by the corporation",
  "UI/Generic/FormatStandingTransactions/messageCorporationSet": "{name} set it for the corporation: {message}",
  "UI/Generic/FormatStandingTransactions/subjectMissionComplete": "Mission done: {message}",
  "UI/Generic/FormatStandingTransactions/messageMissionComplete": "For finishing the mission {message}.",
  "UI/Generic/FormatStandingTransactions/subjectMissionDeclined": "Mission turned down: {message}",
  "UI/Generic/FormatStandingTransactions/messageMissionDecline": "For turning down the mission {message}.",
  "UI/Generic/FormatStandingTransactions/subjectMissionFailed": "Mission failed: {message}",
  "UI/Generic/FormatStandingTransactions/messageMissionFailed": "For failing the mission {message}.",
  "UI/Generic/FormatStandingTransactions/subjectMissionExpired": "Mission let lapse: {message}",
  "UI/Generic/FormatStandingTransactions/messageMissionExpiredNoMsg": "For leaving an offered mission until it lapsed.",
  "UI/Generic/FormatStandingTransactions/messageMissionExpiredMsg": "For leaving the offered mission {message} until it lapsed.",
  "UI/Generic/FormatStandingTransactions/subjectMissionBonus": "Mission extra: {message}",
  "UI/Generic/FormatStandingTransactions/messageMissionBonus": "An extra within the mission {message}.",
  "UI/Generic/FormatStandingTransactions/subjectMissionPenalty": "Mission cost: {message}",
  "UI/Generic/FormatStandingTransactions/messageMissionPenalty": "A cost within the mission {message}.",
  "UI/Generic/FormatStandingTransactions/subjectLawEnforcmentGain": "Law enforcement",
  "UI/Generic/FormatStandingTransactions/messageLawEnforcmentGain": "CONCORD thanked you for acting against {name}.",
  "UI/Generic/FormatStandingTransactions/subjectFacwarPromotion": "Promotion",
  "UI/Generic/FormatStandingTransactions/messageFacwarPromotion": "For your promotion to {rankName} in the {corpName}.",
  "UI/Generic/FormatStandingTransactions/messageCombatSkipKillOwnFaction": "You destroyed a {[item]typeID.name} of a {factionName} pilot in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/messageCombatPodKillOwnFaction": "You destroyed the capsule of a {factionName} pilot in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/messageCombatAgressionOwnFaction": "You attacked a {[item]typeID.name} of a {factionName} pilot in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/messageCombatAssistanceOwnFaction": "You helped a {[item]typeID.name} of a {factionName} pilot against your militia in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/messageCombatProprtyDamageOwnFaction": "You destroyed a {[item]typeID.name} of a {factionName} pilot in {[location]locationID.name}.",
  "UI/Generic/FormatStandingTransactions/subjectFacwarSiteDefened": "A site held",
  "UI/Generic/FormatStandingTransactions/messageFacwarSiteDefened": "For helping the {factionName} hold a site against the {enemyFactionName}.",
  "UI/Generic/FormatStandingTransactions/subjectFacwarSiteConquered": "A site taken",
  "UI/Generic/FormatStandingTransactions/messageFacwarSiteConquered": "For helping the {factionName} take a site from the {enemyFactionName}.",
  "UI/Generic/FormatStandingTransactions/subjectRecomendationLetterUsed": "A letter of recommendation",
  "UI/Generic/FormatStandingTransactions/messageRecomendationLetterUsed": "A letter of recommendation took you straight into this faction's war.",
  "UI/Generic/FormatStandingTransactions/messageGraduation": "Given as you left the academy.",
  "UI/Generic/FormatStandingTransactions/labelSomeone": "someone",
  "UI/Generic/FormatStandingTransactions/labelSomewhere": "somewhere",
  "UI/Generic/FormatStandingTransactions/subjectContraband": "Contraband",
  "UI/Generic/FormatStandingTransactions/messageContraband": "The {factionName} thought less of you for carrying contraband in {systemName}.",
  "UI/Generic/FormatStandingTransactions/subjectGroupReward": "A site cleared",
  "UI/Generic/FormatStandingTransactions/messageGroupReward": "For clearing a site.",
  "UI/Generic/FormatStandingTransactions/subjectCampaignObjectiveContributionReward": "A campaign",
  "UI/Generic/FormatStandingTransactions/messageCampaignObjectiveContributionReward": "For your part in a campaign objective.",
};

/** round(x, places) as Python 2.7 rounds a float: the exact value's nearest, a tie away from nought. */
function pyRound(value: number, places: number): number {
  const magnitude = Number(Math.abs(value).toFixed(places));
  return value < 0 || Object.is(value, -0) ? -magnitude : magnitude;
}
/** str(float): an integral one with ".0", -0.0 as Python writes it. */
function pyFloatText(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** standingUtil.RoundStandingChange: to three places, and no smaller than 0.001 either way. */
export function roundStandingChange(modification: number): number {
  const rounded = pyRound(modification, 3);
  const size = Math.max(0.001, Math.abs(rounded));
  return rounded < 0 || Object.is(rounded, -0) ? -size : size;
}

/** standingsUtil.GetStandingChangeFormatted: the change as written, and its colour's kind. */
export function standingChangeText(change: number): { readonly text: string; readonly tone: "good" | "neutral" | "bad" } {
  if (change > 0.0) return { text: `+${pyFloatText(change)}`, tone: "good" };
  if (change === 0.0) return { text: pyFloatText(change), tone: "neutral" };
  return { text: pyFloatText(change), tone: "bad" };
}

/** A composition's standing as its row writes it (round(standing, 2), GetStandingChangeFormatted). */
export function compositionStandingText(standing: number): { readonly text: string; readonly tone: "good" | "neutral" | "bad" } {
  return standingChangeText(pyRound(standing, 2));
}

/** standingUIConst ACTIONID_BY_EVENTID and ICONS_BY_ACTIONID (GetStandingEventIcon): an event's icon. */
const ACTION_ICONS: Readonly<Record<string, string>> = {
  aggression: "res:/UI/Texture/Classes/Standings/Actions/aggression.png",
  derivedOtherFactions: "res:/UI/Texture/Classes/Standings/Actions/derivedOtherFactions.png",
  failRejectMission: "res:/UI/Texture/Classes/Standings/Actions/failRejectMission.png",
  completeMission: "res:/UI/Texture/Classes/Standings/Actions/completeMission.png",
  other: "res:/UI/Texture/Classes/Standings/Actions/other.png",
};
const ACTION_BY_EVENT: Readonly<Record<number, keyof typeof ACTION_ICONS>> = {
  71: "completeMission",
  72: "completeMission",
  80: "completeMission",
  73: "completeMission",
  75: "failRejectMission",
  74: "failRejectMission",
  90: "failRejectMission",
  76: "aggression",
  79: "aggression",
  78: "aggression",
  77: "aggression",
  83: "derivedOtherFactions",
  82: "derivedOtherFactions",
  89: "aggression",
  // ACTION_DUNGEONGROUPREWARD, drawn with the aggression icon.
  485: "aggression",
  486: "aggression",
};
export function standingEventIcon(eventTypeID: number): string {
  return ACTION_ICONS[ACTION_BY_EVENT[eventTypeID] ?? "other"]!;
}
