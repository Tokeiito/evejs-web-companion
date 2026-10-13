// The character sheet's skill history, as the client's panel makes it.
//
// What is asserted here is the client's own rule, read in its code (build 3396210), with Tranquility's recorded
// rows for the points: the points a level takes (characterskills/util.py 40 to 46, GetSPForLevelRaw, with
// characterskills/const.py's multiplier of 250 and five levels), the level the panel reckons of a row's points
// and its skill's rank (charsheet/skillHistoryPanel.py 59 to 65), which rows make a line (56 to 58), and the
// order (46).

import test from "node:test";
import assert from "node:assert/strict";

import { levelOfPoints, pointsOfLevel, skillHistoryActionLabel, skillHistoryLines } from "./skillHistoryPanel.ts";

test("a level's points are the client's: ceil(rank * 250 * 2 ** (2.5 * (level - 1)))", () => {
  // util.py 40 to 46. Tranquility's rows of a level trained have these as the points the skill then had.
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => pointsOfLevel(1, level)), [250, 1415, 8000, 45255, 256000]);
  assert.deepEqual([1, 2, 4].map((level) => pointsOfLevel(2, level)), [500, 2829, 90510]);
  assert.deepEqual([pointsOfLevel(4, 2), pointsOfLevel(3, 2)], [5657, 4243]);
  // 41 to 44: nought and less take none, and more than the fifth takes the fifth's.
  assert.deepEqual([pointsOfLevel(1, 0), pointsOfLevel(1, 6)], [0, 256000]);
});

test("the level is the last whose points are not more than the skill had", () => {
  // skillHistoryPanel.py 60 to 65: levels = [0, the five], level = 5, and the first level whose points are more
  // than the row's stops the count one below it.
  assert.deepEqual([250, 1415, 8000, 45255, 256000].map((points) => levelOfPoints(1, points)), [1, 2, 3, 4, 5]);
  assert.deepEqual([0, 249, 1414, 8203, 300000].map((points) => levelOfPoints(1, points)), [0, 0, 1, 3, 5]);
  assert.deepEqual([levelOfPoints(2, 2829), levelOfPoints(2, 90510), levelOfPoints(4, 5657)], [2, 4, 2]);
});

test("a line is made of each row whose skill the pilot has, the newest first", () => {
  const skill = (typeID: number, skillRank: number) => ({ typeID, skillRank }) as never;
  const row = (logDate: string, eventTypeID: number, skillTypeID: number, absolutePoints: string) => ({ logDate, eventTypeID, skillTypeID, relativePoints: "0", absolutePoints });
  const lines = skillHistoryLines(
    [
      // Two of Tranquility's recorded rows, and one of a skill that is not among the pilot's (57 to 58).
      row("134276504640000000", 307, 81032, "1000"),
      row("134282810790000000", 53, 3424, "2829"),
      row("134282744520000000", 53, 3328, "2829"),
    ],
    [skill(3424, 2), skill(81032, 4)],
  );
  assert.deepEqual(lines, [
    { logDate: "134282810790000000", skillTypeID: 3424, eventTypeID: 53, level: 2 },
    { logDate: "134276504640000000", skillTypeID: 81032, eventTypeID: 307, level: 1 },
  ]);
});

test("what happened is named by the client's table, and what is not in it is unknown", () => {
  // ACTIONS, skillHistoryPanel.py 17 to 25, and 70's default. The two completions share a label (19 and 22).
  assert.equal(skillHistoryActionLabel(37), skillHistoryActionLabel(53));
  assert.equal(skillHistoryActionLabel(307), "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillPointsApplied");
  assert.equal(skillHistoryActionLabel(56), "UI/Generic/Unknown");
});
