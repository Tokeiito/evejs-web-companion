// The client's expert systems (packages/expertSystems), as rules on what is read:
//
//   the data         expertSystems/data.py ExpertSystem, from res:/staticdata/expertsystems.fsdbinary (its own loader):
//                    each one's days, whether hidden or retired, the skills it gives and at what level
//   the pilot's      expertSystemSvc.GetMyExpertSystems (expertSystemMgr, by the service's name): by type, when it was
//                    installed and when it expires, as two filetimes; the home page's slots hold them by when they
//                    were installed (PageController.load), MAX_CHARACTER_INSTALLATIONS of them
//   an installed one  ExpertSystem (character_sheet/home/controller.py): it expires soon under a day from now; its
//                    extending is refused where it is hidden or retired, or where more than
//                    MAX_INSTALLED_DURATION_TO_ALLOW_TOP_UP of it is left (validate_extend)

import { readDictPairs, unwrapLong } from "./wire.ts";
import { intDictOrder } from "./py27DictOrder.ts";

/** expertSystems/const.py MAX_CHARACTER_INSTALLATIONS: the home page's slots. */
export const MAX_CHARACTER_INSTALLATIONS = 3;
/** expertSystems/const.py MAX_INSTALLED_DURATION_TO_ALLOW_TOP_UP: 30 days, in milliseconds. */
export const MAX_INSTALLED_DURATION_TO_ALLOW_TOP_UP_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILETIME_EPOCH = 116444736000000000n;

/** An expert system as the client's data has it. */
export interface ExpertSystemData {
  readonly typeID: number;
  readonly durationDays: number;
  readonly hidden: boolean;
  readonly retired: boolean;
  /** skillsGranted: each skill and the level it gives, in the order the client's loader iterates them. */
  readonly skills: readonly (readonly [number, number])[];
  /** associatedShipTypes: the ships it goes with. */
  readonly ships: readonly number[];
}

/** data.py get_expert_systems() (hidden and retired left out, _filter_expert_systems): those to browse. */
export function browsableExpertSystems(all: Iterable<ExpertSystemData>): ExpertSystemData[] {
  return [...all].filter((one) => !one.hidden && !one.retired);
}

/** One of the pilot's: its type, and when it was installed and when it expires, in milliseconds. */
export interface InstalledExpertSystem {
  readonly typeID: number;
  readonly installedMs: number;
  readonly expiresMs: number;
}

function filetimeMs(value: unknown): number | null {
  const ticks = typeof value === "number" ? BigInt(Math.trunc(value)) : unwrapLong(value);
  return ticks !== null && ticks > 0n ? Number((ticks - FILETIME_EPOCH) / 10000n) : null;
}

/** GetMyExpertSystems' answer, the pilot's expert systems by when they were installed (PageController.load). */
export function installedExpertSystems(answer: unknown): InstalledExpertSystem[] {
  const out: InstalledExpertSystem[] = [];
  for (const [key, value] of readDictPairs(answer)) {
    const typeID = Number(key);
    const items = Array.isArray(value)
      ? value
      : value !== null && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: readonly unknown[] }).items
        : [];
    const installedMs = filetimeMs(items[0]);
    const expiresMs = filetimeMs(items[1]);
    if (!Number.isSafeInteger(typeID) || typeID <= 0 || installedMs === null || expiresMs === null) continue;
    out.push({ typeID, installedMs, expiresMs });
  }
  return out.sort((left, right) => left.installedMs - right.installedMs);
}

/** ExpertSystem.expires_soon: under a day left. */
export function expiresSoon(expiresMs: number, nowMs: number): boolean {
  return expiresMs - nowMs < DAY_MS;
}

/** ExpertSystem.remaining_time_proportion: the part of its time left, nought where none. */
export function remainingProportion(installed: InstalledExpertSystem, nowMs: number): number {
  const total = installed.expiresMs - installed.installedMs;
  return total <= 0 ? 0 : Math.max(0, installed.expiresMs - nowMs) / total;
}

/**
 * skills/client/util.py get_skills_to_train(expert_system.skills): the skills' dict (ExpertSystem.skills:
 * dict(skillsGranted), its keys as CPython iterates them) walked; for each skill the pilot has not at its level,
 * trained or queued (MySkillLevelIncludingQueued), first each of its missing needs (GetSkillsMissingToUseItemRecursive)
 * not so had, then the skill; each at the highest level asked of it, in the order first asked (an OrderedDict).
 */
export function skillsToTrain(
  granted: readonly (readonly [number, number])[],
  levelIncludingQueued: (skill: number) => number,
  missingRecursive: (skill: number) => readonly (readonly [number, number])[],
): Map<number, number> {
  const levels = new Map(granted);
  const result = new Map<number, number>();
  for (const skill of intDictOrder(granted.map(([typeID]) => typeID))) {
    const level = levels.get(skill) ?? 0;
    if (levelIncludingQueued(skill) >= level) continue;
    for (const [needed, neededLevel] of missingRecursive(skill)) {
      if (levelIncludingQueued(needed) >= neededLevel) continue;
      result.set(needed, Math.max(result.get(needed) ?? 0, neededLevel));
    }
    result.set(skill, Math.max(result.get(skill) ?? 0, level));
  }
  return result;
}

/** ExpertSystem.validate_extend: why it may not be extended, or null where it may. */
export function extendRefusal(data: ExpertSystemData | null, expiresMs: number, nowMs: number): "hidden" | "retired" | "duration" | null {
  if (data?.hidden) return "hidden";
  if (data?.retired) return "retired";
  if (expiresMs - nowMs > MAX_INSTALLED_DURATION_TO_ALLOW_TOP_UP_MS) return "duration";
  return null;
}
