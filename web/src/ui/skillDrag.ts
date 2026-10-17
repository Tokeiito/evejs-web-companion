// The skill being dragged across the page's windows, as the client's drag data is: readable while it is dragged, so a
// drop target can judge it as it is dragged over (the skill queue's IsMoveAllowed line). A browser's drag holds its
// data back until the drop, so each source says what it drags here as the drag begins, and clears it as it ends.
//
//   a plan's contents row      listentry.SkillEntry (SkillPlanContentsSkillEntry.GetDragData): its skill, had or not
//   the plan editor            TypeDragData (a catalogue skill) and SkillLevelDragData (a plan's level, a TypeDragData)
//   the skill queue's rows     SkillQueueSkillEntry: its skill and level

import type { SkillQueueDrop } from "../app/flow.ts";

let current: SkillQueueDrop | null = null;

/** A skill's drag begun. */
export function startSkillDrag(drop: SkillQueueDrop): void {
  current = drop;
}

/** The drag ended, dropped or not. */
export function endSkillDrag(): void {
  current = null;
}

/** What is being dragged, where a skill is. */
export function skillDragged(): SkillQueueDrop | null {
  return current;
}
