// What a pilot is missing to fly a ship or use a thing, as the retail client reckons it, out of the skills each type
// needs (the client's requiredSkillsForTypes table: GET /api/client-data/required-skills) and the pilot's skills
// (skillHandler.GetSkills, and GetAllSkills for those lapsed too).
//
//   the gate      baseDogmaLocation.GetMissingSkills (970 to 976): each skill the type needs that the pilot has not,
//                 or has below its level, by the skill's EFFECTIVE level. station.TryActivateShip boards nothing
//                 where any is missing (base.py 221 to 223), and shows the skill requirement window.
//   the window    skillRequirementDialog.py, with skillsvc.py's walks:
//                   the skills listed  GetSkillsMissingToUseItemRecursive (581 to 595): each needed skill below its
//                                      level by the TRAINED level (GetMyLevel), its own needs first where the pilot
//                                      has no points in it at all, each once at the highest level asked
//                   the levels         GetTotalMissingSkillLevelsToUseItem (556 to 566): over every skill needed,
//                                      however deep, the levels short of each
//                   the books          GetSkillBooksMissingFromList (597): the skills listed the pilot has not even
//                                      lapsed
//
// The order of a type's own needs is the table's as the BFF gives it (by skill, rising); the client's is its built
// table's, which was not read.

/** The skills each type needs, by type: skill to level. */
export type RequiredSkills = Readonly<Record<number, Readonly<Record<number, number>>>>;

/** One skill of the pilot's, as its CharacterSkillEntry says. */
export interface PilotSkill {
  readonly trainedSkillLevel: number;
  readonly trainedSkillPoints: number;
  readonly effectiveSkillLevel: number;
}

/** The pilot's skills by type. */
export type PilotSkills = ReadonlyMap<number, PilotSkill>;

/** A type's own needs, in the table's order: [skill, level]. */
function needsOf(required: RequiredSkills, typeID: number): readonly (readonly [number, number])[] {
  return Object.entries(required[typeID] ?? {}).map(([skill, level]) => [Number(skill), Number(level)] as const);
}

/** baseDogmaLocation.GetMissingSkills: skill to the level needed, for each one the pilot is short of. */
export function missingSkills(typeID: number, required: RequiredSkills, skills: PilotSkills): ReadonlyMap<number, number> {
  const missing = new Map<number, number>();
  for (const [skill, level] of needsOf(required, typeID)) {
    const mine = skills.get(skill);
    if (mine === undefined || mine.effectiveSkillLevel < level) missing.set(skill, level);
  }
  return missing;
}

/** skillsvc.GetSkillsMissingToUseItemRecursive: [skill, level], each once, its own needs before it. */
export function missingSkillsRecursive(
  typeID: number,
  required: RequiredSkills,
  skills: PilotSkills,
  includingLapsed: PilotSkills,
): readonly (readonly [number, number])[] {
  const listed = new Map<number, number>();
  const walk = (of: number): void => {
    for (const [skill, level] of needsOf(required, of)) {
      const myLevel = skills.get(skill)?.trainedSkillLevel;
      if (myLevel !== undefined && myLevel >= level) continue;
      if (skill !== of) {
        const lapsed = includingLapsed.get(skill);
        if (lapsed === undefined || lapsed.trainedSkillPoints <= 0) walk(skill);
      }
      listed.set(skill, Math.max(listed.get(skill) ?? 0, level));
    }
  };
  walk(typeID);
  return [...listed.entries()];
}

/** skillsvc.GetTotalMissingSkillLevelsToUseItem: the levels short of every skill needed, however deep. */
export function totalMissingLevels(typeID: number, required: RequiredSkills, skills: PilotSkills): number {
  const all = new Map<number, number>();
  const walk = (of: number, seen: Set<number>): void => {
    for (const [skill, level] of needsOf(required, of)) {
      all.set(skill, Math.max(all.get(skill) ?? 0, level));
      if (skill !== of && !seen.has(skill)) walk(skill, new Set([...seen, skill]));
    }
  };
  walk(typeID, new Set([typeID]));
  let short = 0;
  for (const [skill, level] of all) {
    const myLevel = skills.get(skill)?.trainedSkillLevel ?? 0;
    if (myLevel < level) short += level - myLevel;
  }
  return short;
}

/** skillsvc.GetSkillBooksMissingFromList: the skills listed that the pilot has not, lapsed or not. */
export function missingSkillBooks(listed: readonly (readonly [number, number])[], includingLapsed: PilotSkills): readonly number[] {
  return listed.map(([skill]) => skill).filter((skill) => !includingLapsed.has(skill));
}
