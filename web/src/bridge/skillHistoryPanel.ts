// The character sheet's skill history, as the client's panel makes it.
//
// The client's History panel has two tabs, employment and skills (charsheet/historyPanel.py 21 to 32). The skills
// tab (charsheet/skillHistoryPanel.py) asks the skill service for the history (54: skillsvc.GetSkillHistory(),
// fifty rows, which the service keeps) and makes a line of each row whose skill the pilot has (56 to 58): the
// date, the skill's name, what happened by the row's event (ACTIONS, 17 to 25, and "unknown" for any other), and a
// level. No row says a level: it is reckoned from the points the skill had then and the skill's rank (59 to 65),
// by the points each level takes (characterskills/util.py 40 to 46, GetSPForLevelRaw). The list is shown the
// newest first (46: reversesort, on the date).
//
// The words are the client's own, read from the player's install by their labels (app/flow.ts requestWords); the
// page's own stand in where there is no install to read.

import type { BoundSkillHistoryRow, BoundSkillRow } from "./boundSkills.ts";

/** characterskills/const.py 6 and 7. */
const MAX_SKILL_LEVEL = 5;
const SKILL_POINT_MULTIPLIER = 250;

/** The panel's headers (skillHistoryPanel.py 42 to 46) and what it says of an empty list. */
export const SKILL_HISTORY_HEADER_LABELS = {
  date: "UI/Common/Date",
  skill: "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/Skill",
  action: "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/Action",
  level: "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/Level",
  none: "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/NoRecordsFound",
} as const;

/** FmtDate(logDate, 'ls') is this label with the date (carbon/common/script/util/format.py 93 to 94). */
export const SKILL_HISTORY_DATE_LABEL = "/Carbon/UI/Common/DateTime/DateLongShort";

/** What an event is called when the panel has no word for it (skillHistoryPanel.py 70). */
export const SKILL_HISTORY_UNKNOWN_LABEL = "UI/Generic/Unknown";

const SKILL_TABS = "UI/CharacterSheet/CharacterSheetWindow/SkillTabs";
/**
 * ACTIONS (skillHistoryPanel.py 17 to 25): the label of what happened, by the row's event (appConst.py 1526 to
 * 1541: the gift 24, the clone penalty 34, a training started 36, complete 37 and cancelled 38, a GM's giving 39,
 * a queue's training completed 53, free points used 307, a level extracted 431). The two completions share a label.
 */
const ACTION_LABELS: Readonly<Record<number, string>> = {
  24: `${SKILL_TABS}/SkillGift`,
  34: `${SKILL_TABS}/SkillClonePenalty`,
  36: `${SKILL_TABS}/SkillTrainingStarted`,
  37: `${SKILL_TABS}/SkillTrainingComplete`,
  38: `${SKILL_TABS}/SkillTrainingCanceled`,
  39: `${SKILL_TABS}/GMGiveSkill`,
  53: `${SKILL_TABS}/SkillTrainingComplete`,
  307: `${SKILL_TABS}/SkillPointsApplied`,
  431: `${SKILL_TABS}/SkillLevelExtracted`,
};

/** The page's own words for what happened, where the client's are not to be read. */
export const SKILL_HISTORY_OWN_ACTION_WORDS: Readonly<Record<number, string>> = {
  24: "Gift",
  34: "Clone penalty",
  36: "Training started",
  37: "Training complete",
  38: "Training stopped",
  39: "Given by a GM",
  53: "Training complete",
  307: "Free skill points applied",
  431: "Skill level extracted",
};

/** The label of what a row's event is called: ACTIONS.get(eventTypeID, the label for "unknown"). */
export function skillHistoryActionLabel(eventTypeID: number): string {
  return ACTION_LABELS[eventTypeID] ?? SKILL_HISTORY_UNKNOWN_LABEL;
}

/** Every label the panel's words are read by. */
export const SKILL_HISTORY_WORD_LABELS: readonly string[] = [
  ...Object.values(SKILL_HISTORY_HEADER_LABELS),
  SKILL_HISTORY_DATE_LABEL,
  SKILL_HISTORY_UNKNOWN_LABEL,
  ...new Set(Object.values(ACTION_LABELS)),
];

/** GetSPForLevelRaw (characterskills/util.py 40 to 46): the points a level of a skill of that rank takes. */
export function pointsOfLevel(rank: number, level: number): number {
  if (level <= 0) {
    return 0;
  }
  return Math.ceil(rank * SKILL_POINT_MULTIPLIER * 2 ** (2.5 * (Math.min(level, MAX_SKILL_LEVEL) - 1)));
}

/**
 * The level a skill of that rank had with those points, as the panel reckons it (skillHistoryPanel.py 59 to 65):
 * the last level whose points are not more than the skill had, of nought and the five.
 */
export function levelOfPoints(rank: number, points: number): number {
  for (let level = 0; level <= MAX_SKILL_LEVEL; level += 1) {
    if (pointsOfLevel(rank, level) > points) {
      return level - 1;
    }
  }
  return MAX_SKILL_LEVEL;
}

/** One line of the panel: when, which skill, what happened, and the level reckoned. */
export interface SkillHistoryLine {
  /** ⚠ EXACT FILETIME decimal string (100ns ticks since 1601). */
  readonly logDate: string;
  readonly skillTypeID: number;
  readonly eventTypeID: number;
  readonly level: number;
}

/**
 * The panel's lines of the history's rows: one for each row whose skill is among the pilot's (56 to 58), with the
 * level reckoned by that skill's rank, the newest first (46). Rows of one date stand as they were answered.
 */
export function skillHistoryLines(history: readonly BoundSkillHistoryRow[], skills: readonly BoundSkillRow[]): readonly SkillHistoryLine[] {
  const rankOf = new Map(skills.map((skill) => [skill.typeID, skill.skillRank]));
  const lines: { readonly line: SkillHistoryLine; readonly date: bigint; readonly place: number }[] = [];
  for (const row of history) {
    const rank = rankOf.get(row.skillTypeID);
    if (rank === undefined || row.logDate === null) {
      continue;
    }
    lines.push({
      line: { logDate: row.logDate, skillTypeID: row.skillTypeID, eventTypeID: row.eventTypeID, level: levelOfPoints(rank, Number(row.absolutePoints ?? 0)) },
      date: BigInt(row.logDate),
      place: lines.length,
    });
  }
  return lines.sort((left, right) => (left.date === right.date ? left.place - right.place : left.date < right.date ? 1 : -1)).map(({ line }) => line);
}
