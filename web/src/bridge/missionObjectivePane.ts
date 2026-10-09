// The agent window's right-hand pane: a mission's objectives, laid out as the retail client lays them out.
//
// agentDialogueUtil.GetMissionObjectiveHTML (282 to 407) writes the pane as HTML, in this order:
//
//   a warning, when the mission matters to standings
//   the heading: the mission's name with "Objectives", "Objectives Complete" or "Objectives Failed"
//   a line of overview
//   each objective (_ProcessObjectiveEntry, 30 to 97): a transport's pickup, dropoff and cargo; where
//     to bring a thing and what; whom to report to and where
//   each dungeon (_ProcessDungeonData, 100 to 154): its heading, the agent's words for it or the stock
//     ones, struck through with what became of it once it is over, and its place
//   granted items, rewards, bonus rewards, collateral, and a heading and text of the mission's own
//
// This lays the same things out in the same order as blocks of plain text, each row with the mark the
// client draws beside it: done (its tick), open (its circle) or failed (its cross). The words are the
// client's, read from its install at run time (the words store). A block whose words are not to hand is
// left out, and the page shows only what it can say.
//
// Not done: the security rating the client writes before a place's name; its warning about low
// security on the way (it plots the route); the banner about reduced payouts in high security; the
// links to a dungeon's ship restrictions; a blueprint's properties after its name; a heraldry agent's
// own loyalty points.

import { formatTemplate, plainText, QUANTITY_AND_ITEM } from "./clientWords.ts";
import { AGENT_MISSION_STATE_FAILED, TYPE_CREDITS, objectivesHeading, type MissionCargo, type MissionItem, type MissionLocation, type MissionMessage, type MissionObjective, type MissionObjectives } from "./missionObjectives.ts";
import { INTERVAL_WORD_LABELS, intervalWriter } from "./timeInterval.ts";
import type { NameKind } from "../store/names.ts";

const FOLDER = "UI/Agents/StandardMission/";
export const PANE_LABELS = Object.freeze({
  importantStandings: `${FOLDER}ImportantStandingsWarning`,
  /** Each takes missionName. */
  heading: Object.freeze({ open: `${FOLDER}MissionObjectives`, complete: `${FOLDER}MissionObjectivesComplete`, failed: `${FOLDER}MissionObjectivesFailed` }),
  overview: `${FOLDER}OverviewAndObjectivesBlurb`,
  /** Takes agentID. */
  reportToAgent: `${FOLDER}ObjectiveReportToAgent`,
  agentLocation: `${FOLDER}AgentLocation`,
  transportHeader: `${FOLDER}TransportObjectiveHeader`,
  transportBlurb: `${FOLDER}TransportBlurb`,
  transportPickup: `${FOLDER}TransportPickupLocation`,
  transportDropOff: `${FOLDER}TransportDropOffLocation`,
  transportCargo: `${FOLDER}TransportCargo`,
  fetchHeader: `${FOLDER}FetchObjectiveHeader`,
  fetchBlurb: `${FOLDER}FetchObjectiveBlurb`,
  fetchDropOff: `${FOLDER}FetchObjectiveDropOffLocation`,
  fetchItem: `${FOLDER}FetchObjectiveItem`,
  /** Takes cargoDescription and size. */
  cargoWithSize: `${FOLDER}CargoDescriptionWithSize`,
  objectiveHeader: `${FOLDER}ObjectiveHeader`,
  optionalHeader: `${FOLDER}OptionalObjectiveHeader`,
  dungeonBody: `${FOLDER}DungeonObjectiveBody`,
  optionalBody: `${FOLDER}OptionalObjectiveBody`,
  dungeonCompleted: `${FOLDER}DungeonObjectiveCompleted`,
  dungeonFailed: `${FOLDER}DungeonObjectiveFailed`,
  objectiveLocation: `${FOLDER}ObjectiveLocation`,
  grantedItems: `${FOLDER}GrantedItems`,
  grantedDetail: `${FOLDER}GrantedItemDetail`,
  grantedDetailAccepted: `${FOLDER}AcceptedGrantedItemDetail`,
  /** Takes agentID. */
  referral: `${FOLDER}MissionReferral`,
  rewardsTitle: `${FOLDER}RewardsTitle`,
  rewardsHeader: `${FOLDER}RewardsHeader`,
  /** Takes lpAmount. */
  loyaltyPoints: `${FOLDER}NumLoyaltyPoints`,
  /** Takes rpAmount. */
  researchPoints: `${FOLDER}NumResearchPoints`,
  bonusTitle: `${FOLDER}BonusRewardsTitle`,
  /** Takes timeRemaining, the game's time left. */
  bonusHeader: `${FOLDER}BonusRewardsHeader`,
  bonusPassed: `${FOLDER}BonusTimePassed`,
  collateralTitle: `${FOLDER}CollateralTitle`,
  collateralHeader: `${FOLDER}CollateralHeader`,
  /** FmtISK: takes amount. */
  isk: "UI/Util/FmtIsk",
  /** A ship in space to go to: takes typeID and locationID. */
  itemLocation: "UI/Agents/Items/ItemLocation",
  quantityAndItem: QUANTITY_AND_ITEM,
});

/** Every label the pane may need, for asking the words store: its own, and those a bonus's time left is written with. */
export const PANE_WORD_LABELS: readonly string[] = [
  ...Object.values(PANE_LABELS).flatMap((label) => (typeof label === "string" ? [label] : Object.values(label))),
  ...INTERVAL_WORD_LABELS,
];

/** The mark the client draws beside a row: its tick, its circle, or its cross. */
export type PaneMark = "done" | "open" | "failed";

export interface PaneRow {
  readonly mark: PaneMark | null;
  readonly label: string | null;
  readonly text: string;
}

export interface PaneBlock {
  readonly kind: "warning" | "heading" | "overview" | "objective" | "items";
  /** The heading's state, for its colour. */
  readonly state?: "open" | "complete" | "failed";
  /** A mission a game master finished by hand (the client says so above the heading). */
  readonly cheated?: boolean;
  readonly title: string | null;
  readonly text: string | null;
  /** A dungeon that is over: its words are struck through, and this says what became of it. */
  readonly outcome?: string | null;
  readonly rows: readonly PaneRow[];
  /** The objective a block is for, so the page can put its own controls beside it. */
  readonly objective?: MissionObjective;
}

export interface PaneContext {
  readonly templates: Readonly<Record<string, string | null | undefined>>;
  readonly nameOf: (kind: NameKind, id: number) => string;
  /** session.locationid: the station the pilot is docked in, or the solar system it is flying in. */
  readonly locationID: number | null;
  /** A mission's name from its message's number, as the client's GetByMessageID gives it; null when it cannot be had. */
  readonly messageText: (messageID: number) => string | null;
  /** What an agent says of a dungeon, as agents.py ProcessMessage fills it; null when it cannot be had. */
  readonly say: (message: MissionMessage) => string | null;
}

/** The names the pane will ask for, so the page can fetch them before it is drawn. */
export function paneNameRefs(objectives: MissionObjectives): Array<{ kind: NameKind; id: number }> {
  const refs: Array<{ kind: NameKind; id: number }> = [];
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
      if (objective.dropoff === null && objective.dropoffOwnerID) refs.push({ kind: "owner", id: objective.dropoffOwnerID });
      thing(objective.cargo?.typeID ?? null);
    }
  }
  for (const dungeon of objectives.dungeons) place(dungeon.location);
  for (const item of [...objectives.agentGift, ...objectives.normalRewards, ...objectives.bonusRewards, ...objectives.collateral]) thing(item.typeID);
  return refs;
}

/** The numbers of the messages the pane will ask for: the mission's name. */
export function paneMessageIDs(objectives: MissionObjectives): number[] {
  return objectives.missionTitleID !== null && objectives.missionTitleID > 0 ? [objectives.missionTitleID] : [];
}

function placeKind(id: number): NameKind {
  if (id >= 30_000_000 && id < 40_000_000) return "system";
  if (id >= 60_000_000 && id < 64_000_000) return "station";
  return "structure";
}

/** idCheckers.IsCharacter, for what the server sends here: an agent, or a capsuleer. */
const isCharacter = (id: number): boolean => (id >= 3_000_000 && id < 4_000_000) || (id >= 90_000_000 && id < 98_000_000) || (id >= 2_100_000_000 && id < 2_147_483_647);

/**
 * The pane for these objectives, or [] when its heading cannot be said (the client's words are not to
 * hand): a pane with no heading would be rows about nothing.
 */
export function objectivePane(objectives: MissionObjectives, context: PaneContext): PaneBlock[] {
  const words = (label: string, args: Record<string, string | number> = {}): string | null => {
    const template = context.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf: context.nameOf, writeInterval })) : null;
  };
  const writeInterval = intervalWriter(context.templates);
  const blocks: PaneBlock[] = [];

  const state = objectivesHeading(objectives);
  const missionName = objectives.missionTitle ?? (objectives.missionTitleID === null ? null : context.messageText(objectives.missionTitleID));
  const heading = missionName === null ? null : words(PANE_LABELS.heading[state], { missionName });
  if (heading === null) {
    return [];
  }
  if (objectives.importantStandings) {
    const warning = words(PANE_LABELS.importantStandings);
    if (warning !== null) blocks.push({ kind: "warning", title: null, text: warning, rows: [] });
  }
  blocks.push({ kind: "heading", state, cheated: objectives.completionStatus === 2, title: heading, text: null, rows: [] });
  const overview = words(PANE_LABELS.overview);
  if (overview !== null) blocks.push({ kind: "overview", title: null, text: overview, rows: [] });

  // LocationWrapper: a ship in space to go to is worded by its type; anything else by its own name.
  const placeText = (location: MissionLocation | null): string | null => {
    if (location === null || location.locationID === null) return null;
    if (location.shipTypeID !== null) {
      const ship = words(PANE_LABELS.itemLocation, { typeID: location.shipTypeID, locationID: location.locationID });
      if (ship !== null) return ship;
    }
    return context.nameOf(placeKind(location.locationID), location.locationID);
  };
  const cargoText = (cargo: MissionCargo | null): string | null => {
    if (cargo === null || cargo.typeID === null) return null;
    const text = words(PANE_LABELS.quantityAndItem, { quantity: cargo.quantity ?? 0, item: cargo.typeID });
    if (text === null) return null;
    return cargo.volume !== null && cargo.volume > 0 ? words(PANE_LABELS.cargoWithSize, { cargoDescription: text, size: cargo.volume }) ?? text : text;
  };
  const row = (mark: PaneMark | null, label: string, text: string | null): PaneRow[] => (text === null ? [] : [{ mark, label: words(label), text }]);
  const at = (location: MissionLocation | null): boolean => location !== null && location.locationID !== null && location.locationID === context.locationID;
  const marked = (done: boolean): PaneMark => (done ? "done" : "open");

  for (const objective of objectives.objectives) {
    if (objective.kind === "agent") {
      const title = objective.agentID === null ? null : words(PANE_LABELS.reportToAgent, { agentID: objective.agentID });
      if (title !== null) blocks.push({ kind: "objective", title, text: null, rows: row(null, PANE_LABELS.agentLocation, placeText(objective.location)), objective });
    } else if (objective.kind === "transport") {
      const hasCargo = objective.cargo?.hasCargo === true;
      const atPickup = at(objective.pickup);
      blocks.push({
        kind: "objective",
        title: words(PANE_LABELS.transportHeader),
        text: words(PANE_LABELS.transportBlurb),
        rows: [
          ...row(marked(atPickup || hasCargo), PANE_LABELS.transportPickup, placeText(objective.pickup)),
          ...row(marked(at(objective.dropoff) && (atPickup || hasCargo)), PANE_LABELS.transportDropOff, placeText(objective.dropoff)),
          ...row(marked(hasCargo), PANE_LABELS.transportCargo, cargoText(objective.cargo)),
        ],
        objective,
      });
    } else {
      // With nowhere named, the client shows whom to bring it to.
      const where = placeText(objective.dropoff) ?? (objective.dropoffOwnerID === null ? null : context.nameOf("owner", objective.dropoffOwnerID));
      blocks.push({
        kind: "objective",
        title: words(PANE_LABELS.fetchHeader),
        text: words(PANE_LABELS.fetchBlurb),
        rows: [
          ...row(marked(at(objective.dropoff)), PANE_LABELS.fetchDropOff, where),
          ...row(marked(objective.cargo?.hasCargo === true), PANE_LABELS.fetchItem, cargoText(objective.cargo)),
        ],
        objective,
      });
    }
  }

  const failed = objectives.missionState === AGENT_MISSION_STATE_FAILED;
  for (const dungeon of objectives.dungeons) {
    // A failed mission's dungeons are failed, whatever they say of themselves.
    const completionStatus = failed ? 0 : dungeon.completionStatus;
    const objectiveCompleted = failed ? 0 : dungeon.objectiveCompleted;
    const stock = words(dungeon.optional ? PANE_LABELS.optionalBody : PANE_LABELS.dungeonBody);
    const body = dungeon.briefingMessage === null ? stock : context.say(dungeon.briefingMessage) ?? stock;
    blocks.push({
      kind: "objective",
      title: words(dungeon.optional ? PANE_LABELS.optionalHeader : PANE_LABELS.objectiveHeader),
      text: body,
      outcome: completionStatus === null ? null : words(completionStatus === 1 ? PANE_LABELS.dungeonCompleted : PANE_LABELS.dungeonFailed),
      rows: row(objectiveCompleted === null ? "open" : objectiveCompleted === 1 ? "done" : "failed", PANE_LABELS.objectiveLocation, placeText(dungeon.location)),
    });
  }

  // _ProcessTypeAndQuantity: ISK as the client writes an amount of it; anything else as so many of an item.
  const itemText = (item: MissionItem): string | null => {
    if (item.typeID === null) return null;
    if (item.typeID === TYPE_CREDITS) return words(PANE_LABELS.isk, { amount: item.quantity });
    if (isCharacter(item.typeID)) return words(PANE_LABELS.referral, { agentID: item.typeID });
    return words(PANE_LABELS.quantityAndItem, { quantity: item.quantity, item: item.typeID });
  };
  const entries = (items: readonly MissionItem[]): PaneRow[] => items.flatMap((item) => { const text = itemText(item); return text === null ? [] : [{ mark: null, label: null, text }]; });
  const section = (title: string, detail: string | null, rows: PaneRow[]): void => {
    const said = words(title);
    if (said !== null && rows.length > 0) blocks.push({ kind: "items", title: said, text: detail, rows });
  };

  const accepted = objectives.missionState === 2 || failed;
  section(PANE_LABELS.grantedItems, words(accepted ? PANE_LABELS.grantedDetailAccepted : PANE_LABELS.grantedDetail), entries(objectives.agentGift));

  const rewards = entries(objectives.normalRewards);
  if (objectives.loyaltyPoints > 0) {
    const text = words(PANE_LABELS.loyaltyPoints, { lpAmount: objectives.loyaltyPoints });
    if (text !== null) rewards.push({ mark: null, label: null, text });
  }
  if (objectives.researchPoints > 0) {
    const text = words(PANE_LABELS.researchPoints, { rpAmount: Math.round(objectives.researchPoints) });
    if (text !== null) rewards.push({ mark: null, label: null, text });
  }
  section(PANE_LABELS.rewardsTitle, words(PANE_LABELS.rewardsHeader), rewards);

  // Each bonus under its own line: how long is left to earn it, or that the time has passed.
  const bonuses = objectives.bonusRewards.flatMap((bonus) => {
    const text = itemText(bonus);
    const header = bonus.timeRemaining > 0n ? words(PANE_LABELS.bonusHeader, { timeRemaining: bonus.timeRemaining.toString() }) : words(PANE_LABELS.bonusPassed);
    return text === null ? [] : [{ mark: null, label: header, text }];
  });
  section(PANE_LABELS.bonusTitle, null, bonuses);

  section(PANE_LABELS.collateralTitle, words(PANE_LABELS.collateralHeader), entries(objectives.collateral));

  if (objectives.missionExtra !== null && objectives.missionExtra.headerID !== null && objectives.missionExtra.bodyID !== null) {
    const none = { label: null, parameters: null, text: null, contentID: objectives.contentID };
    const title = context.say({ ...none, messageID: objectives.missionExtra.headerID });
    const text = context.say({ ...none, messageID: objectives.missionExtra.bodyID });
    if (title !== null && text !== null) blocks.push({ kind: "items", title, text, rows: [] });
  }
  return blocks;
}
