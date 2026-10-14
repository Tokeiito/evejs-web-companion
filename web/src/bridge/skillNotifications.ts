// The skill history's notifications, as the client's notification center makes them.
//
// When the client's notification center fills its list (notifications/client/notificationUI.py 330 to 336: when it
// is first shown after the character is chosen, and again after it is cleared), it takes the skill history's
// notifications and then the server's (notificationSvc.GetAllFormattedNotifications), and sorts them all by when
// they were made, the newest first (326 to 328).
//
// The skill history's are its provider's (notifications/client/development/skillHistoryProvider.py). It asks the
// skill handler to send whatever notifications it has (26: CheckAndSendNotifications()), then the skill service
// for ten rows of the history (32: GetSkillHistory(10), which answers with the history the service keeps, however
// many it was first asked for). Of each row whose skill the pilot has (34 to 36) it makes a notification made at
// the row's date (42), headed with what happened and the skill's name and level, '%s - %s': what happened by the
// row's event, in the skill history panel's labels and "unknown" for any other (EVENT_TYPE_TO_ACTION, 9 to 18),
// and the skill and level in UI/SkillQueue/Skills/SkillNameAndLevel (40). Rows from before the player last
// cleared the center are left out (38); the page has no clearing, and leaves none out.
//
// The level is not reckoned as the History panel reckons it (skillHistoryRow.py 23 to 36): of the levels nought
// to five, those whose points are fewer than the row's are counted. Points past one level's and short of the
// next's count the next.
//
// The game port's transport asks the provider's two calls at the login, as the client does, and keeps the
// history as the skill service does; the page's own ask of the history is answered from what it keeps.

import type { BoundSkillHistoryRow, BoundSkillRow } from "./boundSkills.ts";
import { pointsOfLevel } from "./skillHistoryPanel.ts";

/** The label of the skill's name and level (skillHistoryProvider.py 40). */
export const SKILL_NAME_AND_LEVEL_LABEL = "UI/SkillQueue/Skills/SkillNameAndLevel";

/** How many rows of the history the provider asks for (skillHistoryProvider.py 32). */
export const SKILL_NOTIFICATION_ROWS = 10;

/** One of the skill history's notifications: when it was made, which skill, what happened, and the level. */
export interface SkillNotification {
  /** ⚠ EXACT FILETIME decimal string (100ns ticks since 1601): the row's date, which is when it was made. */
  readonly logDate: string;
  readonly skillTypeID: number;
  readonly eventTypeID: number;
  readonly level: number;
}

/** SkillHistoryRow._calcCurrentLevel (skillHistoryRow.py 29 to 36): the levels, nought to five, whose points are fewer. */
export function skillNotificationLevel(rank: number, points: number): number {
  let level = 0;
  for (let each = 0; each <= 5; each += 1) {
    if (pointsOfLevel(rank, each) < points) {
      level = each + 1;
    }
  }
  return level;
}

/**
 * The provider's notifications of the history's rows: one for each row whose skill is among the pilot's, with the
 * level reckoned by that skill's rank, in the history's order (the center sorts them with the rest).
 */
export function skillNotificationsOf(history: readonly BoundSkillHistoryRow[], skills: readonly BoundSkillRow[]): readonly SkillNotification[] {
  const rankOf = new Map(skills.map((skill) => [skill.typeID, skill.skillRank]));
  const notifications: SkillNotification[] = [];
  for (const row of history) {
    const rank = rankOf.get(row.skillTypeID);
    if (rank === undefined || row.logDate === null) {
      continue;
    }
    notifications.push({
      logDate: row.logDate,
      skillTypeID: row.skillTypeID,
      eventTypeID: row.eventTypeID,
      level: skillNotificationLevel(rank, Number(row.absolutePoints ?? 0)),
    });
  }
  return notifications;
}
