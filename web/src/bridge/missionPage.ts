// A mission's page, as the retail client's job board lays one out.
//
// The journal's "Read Details", and a double click on a mission's line, is agents.PopupMission
// (missionentry.py 70 to 79). With the job board on, which it is unless a server turns it off, that opens
// the mission there (agents.py 726, jobboard open_mission), and the old details window is never built.
//
// The page (jobboard/client/features/agent_missions/page.py, job.py) is made from three things:
//
//   the journal's line       the mission's state, whether it is important, when it expires
//   one read from the server GetMissionObjectiveInfo(ignoreLocateCheck=True) on the agent's object,
//                            turned into objectives and rewards by evemissions/client/mission.py
//   the client's own record  evemissions.client.data.get_mission: the message IDs of the name, the
//                            briefing, what the agent says on offering, and the extra information
//
// and is laid out in this order: the title and the state; when it expires; a warning when the mission
// matters to standings; the agent and its corporation; the briefing; the objectives; the ship the
// mission needs; the collateral, while it is an offer; what the agent hands over; the rewards and the
// bonus rewards; a banner about reduced rewards in high security; the extra information.
//
// This makes the same page as plain text, in the client's words, read from its install at run time (the
// words store). What cannot be said is left out.
//
// Not done: how many jumps away a place is (the client plots the route), which leaves a place's distance
// blank unless the pilot is there; the security rating before a place's name; "Objectives Complete" as the state (the client
// has it from its own tracker); a ship's packaged size as cargo; the ship restrictions panel; the
// reduced-rewards banner; the bonus's countdown; a blueprint's properties; what an alpha clone is paid.
// The bonus's countdown is the one time on the client's page that is not written here.

import { formatTemplate, plainText, QUANTITY_AND_ITEM } from "./clientWords.ts";
import type { AgentRecord } from "./agents.ts";
import { effectiveStandingWithAgent } from "./effectiveStanding.ts";
import { SHORT_INTERVAL_WORD_LABELS, shortIntervalWriter } from "./timeInterval.ts";
import { AGENT_MISSION_STATE_FAILED, TYPE_CREDITS, type MissionCargo, type MissionItem, type MissionLocation, type MissionMessage, type MissionObjectives } from "./missionObjectives.ts";
import type { NameKind } from "../store/names.ts";

const FOLDER = "UI/Agents/StandardMission/";
const JOURNAL = "UI/Journal/JournalWindow/Agents/";
export const PAGE_LABELS = Object.freeze({
  expired: "UI/Generic/Expired",
  completed: "UI/Generic/Completed",
  offered: `${JOURNAL}StateOffered`,
  /** Each takes expirationTime, the game's time left. */
  offerExpiresIn: `${JOURNAL}OfferExpiresIn`,
  missionExpiresIn: `${JOURNAL}MissionExpiresIn`,
  offerDoesNotExpire: `${JOURNAL}OfferDoesNotExpire`,
  missionDoesNotExpire: `${JOURNAL}MissionDoesNotExpire`,
  importantStandings: `${FOLDER}ImportantStandingsWarning`,
  /** Takes level. */
  agentLevel: "UI/Agents/AgentEntry/Level",
  /** Each takes effectiveStanding: the second when it is the least of the pilot's standings that counts. */
  effectiveStanding: "UI/Agents/Dialogue/EffectiveStanding",
  effectiveStandingLow: "UI/Agents/Dialogue/EffectiveStandingLow",
  briefingTitle: `${FOLDER}MissionBriefing`,
  objectivesTitle: `${FOLDER}Objectives`,
  agentLocation: `${FOLDER}AgentLocation`,
  cargo: `${FOLDER}TransportCargo`,
  pickup: `${FOLDER}TransportPickupLocation`,
  dropOff: `${FOLDER}TransportDropOffLocation`,
  objectiveLocation: `${FOLDER}ObjectiveLocation`,
  /** Takes agentLink, the agent's name as a link. */
  reportTo: `${FOLDER}ObjectiveReportTo`,
  transportBlurb: `${FOLDER}TransportBlurb`,
  fetchBlurb: `${FOLDER}FetchObjectiveBlurb`,
  dungeonBody: `${FOLDER}DungeonObjectiveBody`,
  optionalBody: `${FOLDER}OptionalObjectiveBody`,
  /** Takes cargoDescription and size. */
  cargoWithSize: `${FOLDER}CargoDescriptionWithSize`,
  thisStation: `${FOLDER}ThisStation`,
  thisSolarSystem: `${FOLDER}ThisSolarSystem`,
  collateralTitle: `${FOLDER}CollateralTitle`,
  collateralText: `${FOLDER}CollateralText`,
  grantedItems: `${FOLDER}GrantedItems`,
  grantedText: `${FOLDER}GrantedItemText`,
  rewardsTitle: `${FOLDER}RewardsTitle`,
  bonusTitle: `${FOLDER}BonusRewardsTitle`,
  /** Takes lpAmount. */
  loyaltyPointsShort: `${FOLDER}NumLoyaltyPointsShort`,
  /** Takes rpAmount. */
  researchPoints: `${FOLDER}NumResearchPoints`,
  /** Takes agentID. */
  referral: `${FOLDER}MissionReferral`,
  /** FmtISK: takes amount. */
  isk: "UI/Util/FmtIsk",
  /** A ship in space to go to: takes typeID and locationID. */
  itemLocation: "UI/Agents/Items/ItemLocation",
  quantityAndItem: QUANTITY_AND_ITEM,
  startConversation: "UI/Chat/StartConversationAgent",
});

/** Every label the page may need, for asking the words store: its own, and those its time left is written with. */
export const PAGE_WORD_LABELS: readonly string[] = [...Object.values(PAGE_LABELS), ...SHORT_INTERVAL_WORD_LABELS];

/** The keys of a mission's messages in the client's record that the page reads (job.py 143 to 157). */
export const PAGE_MESSAGES = Object.freeze({
  briefing: "messages.mission.briefing",
  offered: "messages.mission.offered.agentsays",
  extraHeader: "messages.mission.extrainfo.header",
  extraBody: "messages.mission.extrainfo.body",
});

/** The client's own record of a mission, as much of it as the page reads. */
export interface ClientMission {
  readonly nameID: number | null;
  /** Message IDs by the record's own keys ("messages.mission.briefing"). */
  readonly messages: Readonly<Record<string, number>>;
}

/** A record as the BFF answers it (GET /api/client-data/missions/<id>), or null for anything else. */
export function decodeClientMission(value: unknown): ClientMission | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as { nameID?: unknown; messages?: unknown };
  const messages: Record<string, number> = {};
  if (typeof record.messages === "object" && record.messages !== null && !Array.isArray(record.messages)) {
    for (const [key, id] of Object.entries(record.messages)) {
      if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) messages[key] = id;
    }
  }
  const nameID = typeof record.nameID === "number" && Number.isSafeInteger(record.nameID) && record.nameID > 0 ? record.nameID : null;
  return { nameID, messages };
}

/** The message IDs of a record that the page words, for asking the words store. */
export function pageMessageIDs(record: ClientMission | null): number[] {
  if (record === null) return [];
  const ids = Object.values(PAGE_MESSAGES).map((key) => record.messages[key]).filter((id): id is number => id !== undefined);
  return record.nameID === null ? ids : [record.nameID, ...ids];
}

/** objectives.ObjectiveState, as the step draws it: a tick in green, its own icon, or red. */
export type StepState = "done" | "open" | "failed";

export interface PageStep {
  readonly kind: "agent" | "cargo" | "pickup" | "dropoff" | "dungeon";
  readonly state: StepState;
  /** What the step is, on the left above it. */
  readonly title: string | null;
  /** How far away its place is, beside the title: only "this station" and "this solar system" are known here. */
  readonly where: string | null;
  readonly text: string;
}

/** One group of steps, under the line the client writes above them. */
export interface PageSteps {
  readonly briefing: string | null;
  readonly steps: readonly PageStep[];
}

/** A panel with a title, a line of its own and what it is about. */
export interface PagePanel {
  readonly title: string | null;
  readonly text: string | null;
  readonly items: string;
}

/** The agent's card: its level, its name, the division it works in. */
export interface PageAgent {
  readonly level: string | null;
  readonly name: string;
  readonly division: string | null;
}

/** Its corporation's card: the pilot's effective standing with the agent, the corporation, and the faction it belongs to. */
export interface PageCorporation {
  /** In the client's words; null until the pilot's standings and skills are both to hand. */
  readonly standing: string | null;
  /** Whether the standing is a low one (the client writes it in bold). */
  readonly standingLow: boolean;
  readonly name: string;
  readonly faction: string | null;
}

export interface PageRewards {
  readonly title: string | null;
  readonly rewards: readonly string[];
}

export interface MissionPage {
  readonly title: string | null;
  readonly state: { readonly kind: "expired" | "offered" | "completed"; readonly text: string | null } | null;
  readonly expires: string | null;
  readonly important: string | null;
  /** The two cards, when the client's agents service knows the agent; the second only for an agent with a corporation. */
  readonly agent: PageAgent | null;
  readonly corporation: PageCorporation | null;
  readonly briefing: { readonly title: string | null; readonly text: string } | null;
  /** The steps the client groups first (an agent to see, cargo, pick-up, drop-off), then the dungeons. */
  readonly objectives: { readonly title: string | null; readonly general: PageSteps; readonly extra: PageSteps } | null;
  readonly collateral: PagePanel | null;
  readonly granted: PagePanel | null;
  readonly rewards: PageRewards | null;
  readonly bonusRewards: PageRewards | null;
  readonly extra: { readonly title: string; readonly text: string } | null;
  /** The words of the button that opens the agent's window. */
  readonly talk: string | null;
}

/** What the job is made from: the journal's line, the read, and the client's record. */
export interface MissionPageInput {
  readonly missionState: number | null;
  readonly important: boolean;
  /** When the mission or its offer expires, on the server's clock; null for none. */
  readonly expirationTime: bigint | null;
  /** The mission's name from the journal's line, for when the client's record cannot be had. */
  readonly missionTitleID: number | null;
  readonly missionTitle: string | null;
  /** This mission's objectives as last read for the page (pageObjectives); null before any have come. */
  readonly objectives: MissionObjectives | null;
  /** What the client's agents service knows of the mission's agent; null before it has answered, or when it does not know it. */
  readonly agent: AgentRecord | null;
  /** The standings the server lists towards the pilot, by owner; null before they have been read. */
  readonly standings: ReadonlyMap<number, number> | null;
  /** The level the pilot has in a skill, nought for one it has not; null before its skills have been read. */
  readonly skillLevel: ((typeID: number) => number) | null;
  readonly record: ClientMission | null;
}

export interface PageContext {
  readonly templates: Readonly<Record<string, string | null | undefined>>;
  readonly nameOf: (kind: NameKind, id: number) => string;
  /** session.locationid, session.stationid and session.solarsystemid2. */
  readonly locationID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  /** The server's clock. */
  readonly now: bigint;
  /** A message with nothing filled in, as the client's GetByMessageID gives a mission's name; null when it cannot be had. */
  readonly messageText: (messageID: number) => string | null;
  /** One of the mission's own messages, filled with the mission's keywords and the agent's IDs; null when it cannot be had. */
  readonly sayOfMission: (messageID: number) => string | null;
  /** What an agent says of a dungeon, as agents.py ProcessMessage fills it; null when it cannot be had. */
  readonly say: (message: MissionMessage) => string | null;
}

const OFFERED_STATES: readonly number[] = [0, 1];
const ACCEPTED_STATES: readonly number[] = [2, AGENT_MISSION_STATE_FAILED];
const COMPLETED = 4;

const isStation = (id: number): boolean => id >= 60_000_000 && id < 64_000_000;
const isSolarSystem = (id: number): boolean => id >= 30_000_000 && id < 40_000_000;
/** idCheckers.IsCharacter, for what the server sends here: an agent, or a capsuleer. */
const isCharacter = (id: number): boolean => (id >= 3_000_000 && id < 4_000_000) || (id >= 90_000_000 && id < 98_000_000) || (id >= 2_100_000_000 && id < 2_147_483_647);

function placeKind(id: number): NameKind {
  if (isSolarSystem(id)) return "system";
  if (isStation(id)) return "station";
  return "structure";
}

/** agentinteraction.textutils.fix_text, for text that is then shown plain: no line breaks of its own, and no trailing ones. */
export function fixText(text: string): string {
  let fixed = text.replace(/\r\n/g, "").replace(/\n/g, "").trim();
  while (fixed.endsWith("<br>")) {
    fixed = fixed.slice(0, -"<br>".length);
  }
  return fixed;
}

/**
 * The objectives the page holds after an answer to its read. An answer about this mission replaces what
 * was held; an answer about another mission, or none at all (a mission that is over), changes nothing
 * (Mission.update_objective_info, 166).
 */
export function pageObjectives(held: MissionObjectives | null, answer: MissionObjectives | null, contentID: number | null): MissionObjectives | null {
  return answer !== null && answer.contentID !== null && answer.contentID === contentID ? answer : held;
}

/**
 * What the server saying a mission changed does to that mission's page (the job board's
 * AgentMissionsJobProvider.OnAgentMissionChanged): the job is given a new state and read again, or only
 * read again, or it is removed, and with it its page. Anything else leaves the page as it is.
 */
export function pageOnMissionChange(action: string): "close" | { readonly missionState: number | null } | null {
  switch (action) {
    case "completed":
      return { missionState: COMPLETED };
    case "accepted":
      return { missionState: 2 };
    case "modified":
    case "dungeon_moved":
    case "failed":
    case "offer_expired":
      return { missionState: null };
    case "offered":
    case "declined":
    case "offer_declined":
    case "offer_removed":
    case "quit":
    case "reset":
      return "close";
    default:
      return null;
  }
}

/**
 * The state the job is in for the page. The journal's line gives it first; the mission's own objectives,
 * once read, replace it with theirs, whatever that is (Mission._update_objectives).
 */
export function pageMissionState(input: MissionPageInput): number | null {
  return input.objectives !== null ? input.objectives.missionState : input.missionState;
}

/** The names the page will ask for, so they can be fetched before it is drawn. */
export function pageNameRefs(input: MissionPageInput): Array<{ kind: NameKind; id: number }> {
  const refs: Array<{ kind: NameKind; id: number }> = [];
  if (input.agent !== null) {
    refs.push({ kind: "owner", id: input.agent.agentID });
    if (input.agent.corporationID !== null) refs.push({ kind: "corporation", id: input.agent.corporationID });
    if (input.agent.factionID !== null) refs.push({ kind: "faction", id: input.agent.factionID });
  }
  const objectives = input.objectives;
  if (objectives === null) return refs;
  const place = (location: MissionLocation | null): void => {
    if (location?.locationID) refs.push({ kind: placeKind(location.locationID), id: location.locationID });
    if (location?.shipTypeID) refs.push({ kind: "type", id: location.shipTypeID });
  };
  const thing = (typeID: number | null): void => {
    if (typeID && typeID !== TYPE_CREDITS) refs.push(isCharacter(typeID) ? { kind: "owner", id: typeID } : { kind: "type", id: typeID });
  };
  for (const objective of objectives.objectives) {
    if (objective.kind === "agent") {
      if (objective.agentID) refs.push({ kind: "owner", id: objective.agentID });
      place(objective.location);
    } else if (objective.kind === "transport") {
      place(objective.pickup);
      place(objective.dropoff);
      thing(objective.cargo?.typeID ?? null);
    } else {
      place(objective.dropoff);
      thing(objective.cargo?.typeID ?? null);
    }
  }
  for (const dungeon of objectives.dungeons) place(dungeon.location);
  for (const item of [...objectives.agentGift, ...objectives.normalRewards, ...objectives.bonusRewards, ...objectives.collateral]) thing(item.typeID);
  return refs;
}

/** The page for a mission. */
export function missionPage(input: MissionPageInput, context: PageContext): MissionPage {
  const words = (label: string, args: Record<string, string | number> = {}): string | null => {
    const template = context.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf: context.nameOf, writeShortInterval })) : null;
  };
  // The time left is a label's short written interval.
  const writeShortInterval = shortIntervalWriter(context.templates);
  const record = input.record;
  const objectives = input.objectives;
  const missionState = pageMissionState(input);
  const offered = missionState !== null && OFFERED_STATES.includes(missionState);
  const expired = input.expirationTime !== null && input.expirationTime !== 0n && input.expirationTime - context.now < 0n;

  // The title is the client's own name for the mission; failing its record, the journal's.
  const named = record === null || record.nameID === null ? null : context.messageText(record.nameID);
  const title = named ?? input.missionTitle ?? (input.missionTitleID === null ? null : context.messageText(input.missionTitleID));

  // AgentMissionJob.get_state_info: expired before offered, and the job's own "completed" after both.
  const state: MissionPage["state"] = expired
    ? { kind: "expired", text: words(PAGE_LABELS.expired) }
    : offered
      ? { kind: "offered", text: words(PAGE_LABELS.offered) }
      : missionState === COMPLETED
        ? { kind: "completed", text: words(PAGE_LABELS.completed) }
        : null;

  // Mission.has_expiration_time, then agentUtil.GetMissionExpirationText: the time left, for an offer or a mission
  // under way. Those are all the states a mission is "active" in, so the one test stands for both.
  let expires: string | null = null;
  const accepted = missionState !== null && ACCEPTED_STATES.includes(missionState);
  if (input.expirationTime !== null && input.expirationTime !== 0n && !expired && (offered || accepted)) {
    const left = input.expirationTime - context.now;
    expires = left === 0n
      ? words(offered ? PAGE_LABELS.offerDoesNotExpire : PAGE_LABELS.missionDoesNotExpire)
      : words(offered ? PAGE_LABELS.offerExpiresIn : PAGE_LABELS.missionExpiresIn, { expirationTime: left.toString() });
  }

  const important = input.important || objectives?.importantStandings === true ? words(PAGE_LABELS.importantStandings) : null;

  // page.py _construct_agent and _construct_corporation: the agent's level, name and division; its corporation and that corporation's faction.
  const known = input.agent;
  const agent: PageAgent | null = known === null ? null : {
    level: known.level === null ? null : words(PAGE_LABELS.agentLevel, { level: known.level }),
    name: context.nameOf("owner", known.agentID),
    division: known.divisionNameID === null ? null : context.messageText(known.divisionNameID),
  };
  // standingsvc.GetEffectiveStandingWithAgent: said only when there is something to work it out from.
  const effective = known === null || input.standings === null || input.skillLevel === null ? null : effectiveStandingWithAgent(known, input.standings, input.skillLevel);
  const corporation: PageCorporation | null = known === null || known.corporationID === null ? null : {
    standing: effective === null ? null : words(effective.low ? PAGE_LABELS.effectiveStandingLow : PAGE_LABELS.effectiveStanding, { effectiveStanding: effective.value }),
    standingLow: effective !== null && effective.low,
    name: context.nameOf("corporation", known.corporationID),
    faction: known.factionID === null ? null : context.nameOf("faction", known.factionID),
  };

  // AgentMissionJob.description: what the agent says on offering while it is an offer and the mission has such words, else the briefing.
  const message = (key: string): string => {
    const messageID = record?.messages[key];
    const said = messageID === undefined ? null : context.sayOfMission(messageID);
    return said === null ? "" : plainText(fixText(said));
  };
  const description = offered && record?.messages[PAGE_MESSAGES.offered] !== undefined ? message(PAGE_MESSAGES.offered) : message(PAGE_MESSAGES.briefing);
  const briefing = description === "" ? null : { title: words(PAGE_LABELS.briefingTitle), text: description };

  // LocationWrapper: a ship in space to go to is worded by its type; anything else by its own name.
  const placeText = (location: MissionLocation | null): string => {
    if (location === null || location.locationID === null) return "";
    if (location.shipTypeID !== null) {
      const ship = words(PAGE_LABELS.itemLocation, { typeID: location.shipTypeID, locationID: location.locationID });
      if (ship !== null) return ship;
    }
    return context.nameOf(placeKind(location.locationID), location.locationID);
  };
  // ObjectiveSteps._get_location_info: a station is the pilot's own, or stands for its system; a system is the pilot's own, or so many jumps away.
  const whereText = (location: MissionLocation | null): string | null => {
    if (location === null || location.locationID === null) return null;
    let locationID = location.locationID;
    if (isStation(locationID)) {
      if (context.stationID === locationID) return words(PAGE_LABELS.thisStation);
      if (location.solarsystemID === null) return null;
      locationID = location.solarsystemID;
    }
    // The client asks first whether it is a solar system at all; only a solar system can be the pilot's.
    return context.solarSystemID === locationID ? words(PAGE_LABELS.thisSolarSystem) : null;
  };
  const cargoText = (cargo: MissionCargo): string => {
    const text = words(PAGE_LABELS.quantityAndItem, { quantity: cargo.quantity ?? 0, item: cargo.typeID ?? 0 }) ?? "";
    return cargo.volume !== null && cargo.volume > 0 ? words(PAGE_LABELS.cargoWithSize, { cargoDescription: text, size: cargo.volume }) ?? text : text;
  };
  const at = (location: MissionLocation | null): boolean => location !== null && location.locationID !== null && location.locationID === context.locationID;
  const marked = (done: boolean): StepState => (done ? "done" : "open");
  const located = (kind: PageStep["kind"], state: StepState, label: string, location: MissionLocation | null): PageStep =>
    ({ kind, state, title: words(label), where: whereText(location), text: placeText(location) });

  // mission._build_objective_entries, and ObjectiveSteps for each step's words. The line above a group is its LAST step's.
  const general: PageStep[] = [];
  let generalBriefing: string | null = null;
  let objectivesType: string | null = null;
  for (const objective of objectives?.objectives ?? []) {
    objectivesType = objective.kind;
    if (objective.kind === "agent") {
      general.push(located("agent", "open", PAGE_LABELS.agentLocation, objective.location));
      generalBriefing = objective.agentID === null ? null : words(PAGE_LABELS.reportTo, { agentLink: context.nameOf("owner", objective.agentID) });
      continue;
    }
    // An objective the client cannot read whole (no cargo, or a place missing) gives no steps at all: it logs the error and goes on.
    if (objective.cargo === null || objective.dropoff === null || (objective.kind === "transport" && objective.pickup === null)) {
      continue;
    }
    const hasCargo = objective.cargo.hasCargo;
    const cargo: PageStep = { kind: "cargo", state: marked(hasCargo), title: words(PAGE_LABELS.cargo), where: null, text: cargoText(objective.cargo) };
    if (objective.kind === "transport") {
      const pickedUp = at(objective.pickup) || hasCargo;
      general.push(cargo, located("pickup", marked(pickedUp), PAGE_LABELS.pickup, objective.pickup), located("dropoff", marked(at(objective.dropoff) && pickedUp), PAGE_LABELS.dropOff, objective.dropoff));
    } else {
      general.push(cargo, located("dropoff", marked(at(objective.dropoff) && hasCargo), PAGE_LABELS.dropOff, objective.dropoff));
    }
  }
  // A drop-off's line depends on the kind of the mission's LAST objective, which is what the view is handed,
  // and that is a transport or a fetch whenever a drop-off is the last step.
  const lastGeneral = general[general.length - 1];
  if (lastGeneral !== undefined && lastGeneral.kind === "dropoff") {
    generalBriefing = words(objectivesType === "transport" ? PAGE_LABELS.transportBlurb : PAGE_LABELS.fetchBlurb);
  }

  const failed = missionState === AGENT_MISSION_STATE_FAILED;
  const extraSteps: PageStep[] = [];
  let extraBriefing: string | null = null;
  for (const dungeon of objectives?.dungeons ?? []) {
    if (dungeon.dungeonID === null) continue;
    // A failed mission's dungeons are failed, whatever they say of themselves.
    const completed = failed ? 0 : dungeon.objectiveCompleted;
    extraSteps.push(located("dungeon", completed === null ? "open" : completed === 1 ? "done" : "failed", PAGE_LABELS.objectiveLocation, dungeon.location));
    const stock = words(dungeon.optional ? PAGE_LABELS.optionalBody : PAGE_LABELS.dungeonBody);
    const said = dungeon.briefingMessage === null ? null : context.say(dungeon.briefingMessage);
    extraBriefing = said === null ? stock : plainText(fixText(said));
  }
  const steps = general.length + extraSteps.length;

  // Reward.get_text: ISK as an amount of it, loyalty and research points by their own labels, a referral by the agent's name, anything else as so many of an item.
  const itemText = (item: MissionItem, long: boolean): string | null => {
    if (item.typeID === null) return null;
    if (item.typeID === TYPE_CREDITS) return words(PAGE_LABELS.isk, { amount: item.quantity });
    if (isCharacter(item.typeID)) return long ? words(PAGE_LABELS.referral, { agentID: item.typeID }) : context.nameOf("owner", item.typeID);
    return words(PAGE_LABELS.quantityAndItem, { quantity: item.quantity, item: item.typeID });
  };
  // Only an amount above nought is drawn, and only such amounts are kept when the answer is read (missionObjectives.ts).
  const texts = (items: readonly MissionItem[]): string[] => items.map((item) => itemText(item, false)).filter((text): text is string => text !== null);

  const normal = texts(objectives?.normalRewards ?? []);
  if (objectives !== null && objectives.loyaltyPoints > 0) {
    const text = words(PAGE_LABELS.loyaltyPointsShort, { lpAmount: objectives.loyaltyPoints });
    if (text !== null) normal.push(text);
  }
  if (objectives !== null && Math.round(objectives.researchPoints) > 0) {
    const text = words(PAGE_LABELS.researchPoints, { rpAmount: Math.round(objectives.researchPoints) });
    if (text !== null) normal.push(text);
  }
  // The page builds its rewards only when the mission pays something; the bonus is drawn inside them.
  const paid = objectives !== null && (objectives.normalRewards.length > 0 || objectives.loyaltyPoints > 0 || Math.round(objectives.researchPoints) > 0);
  const bonus = paid ? texts(objectives?.bonusRewards ?? []) : [];

  const grantedTexts = (objectives?.agentGift ?? []).map((item) => itemText(item, true)).filter((text): text is string => text !== null);
  const collateralFirst = objectives?.collateral[0];
  const collateralAmount = collateralFirst === undefined ? null : words(PAGE_LABELS.isk, { amount: collateralFirst.quantity });

  // AgentMissionJob.extra_information: only with a body, and then under its own heading.
  const extraBody = message(PAGE_MESSAGES.extraBody);

  return {
    title,
    state,
    expires,
    important,
    agent,
    corporation,
    briefing,
    objectives: steps === 0 ? null : {
      title: words(PAGE_LABELS.objectivesTitle),
      general: { briefing: generalBriefing, steps: general },
      extra: { briefing: extraBriefing, steps: extraSteps },
    },
    // The collateral is shown for an offer only (page.py 55).
    collateral: collateralAmount !== null && offered ? { title: words(PAGE_LABELS.collateralTitle), text: words(PAGE_LABELS.collateralText), items: collateralAmount } : null,
    granted: grantedTexts.length === 0 ? null : { title: words(PAGE_LABELS.grantedItems), text: words(PAGE_LABELS.grantedText), items: grantedTexts.join(", ") },
    rewards: paid && normal.length > 0 ? { title: words(PAGE_LABELS.rewardsTitle), rewards: normal } : null,
    bonusRewards: bonus.length > 0 ? { title: words(PAGE_LABELS.bonusTitle), rewards: bonus } : null,
    extra: extraBody === "" ? null : { title: message(PAGE_MESSAGES.extraHeader), text: extraBody },
    talk: words(PAGE_LABELS.startConversation),
  };
}
