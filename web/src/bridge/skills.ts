// The skill sheet and the training queue, as pure functions (goal R28).
//
// ---------------------------------------------------------------------------
// NOTHING HERE COMPUTES A GAME MECHANIC.
//
// The SP curve, the level thresholds, the prerequisite tree, Omega/Alpha gating
// and the training rate are ALL the server's. The gateway's GET /skills hands
// them over already evaluated — per skill, the SP required for each of the five
// levels; per queue entry, the SP it starts and ends at and the instants it
// starts and ends. This module only *arranges* those numbers: it groups them,
// places a current SP total between two thresholds, and interpolates a bar
// between two reads.
//
// ---------------------------------------------------------------------------
// TIME IS THE SERVER'S, AND A READ ALWAYS WINS.
//
// Every instant arrives as epoch milliseconds next to `serverNowMs`, the same
// clock sampled in the same read. `clockOffsetMs` is the difference between
// that and the browser's own clock, so `serverNow(offset)` is what the SERVER
// would call now — on a machine whose clock is minutes off, the countdown is
// still right.
//
// Interpolation NEVER runs past what the server said: SP is clamped to the
// entry's own destination and the remaining time is clamped at zero. A skill
// cannot finish early, and it cannot appear to over-train while we wait for the
// next read. When a read lands it replaces everything — this module has no
// memory and no simulation of its own.

import type { JsonValue } from "./wire.ts";
import type {
  SkillGroup,
  SkillQueueEntry,
  SkillQueueState,
  SkillRow,
  SkillSheet,
  SkillTrainingReadout,
} from "../store/types.ts";

const MAX_SKILL_LEVEL = 5;

function asRecord(value: JsonValue): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function asNumber(value: JsonValue | undefined, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/** An instant, or null when the server had none. Never coerced to 0 (= 1970). */
function asInstant(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function asText(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function decodeSkillRow(value: JsonValue): SkillRow | null {
  const record = asRecord(value);
  const typeID = asNumber(record.typeID);
  if (!Number.isSafeInteger(typeID) || typeID <= 0) {
    return null;
  }
  const thresholds = Array.isArray(record.levelSkillPoints)
    ? (record.levelSkillPoints as JsonValue[]).map((entry) => asNumber(entry))
    : [];
  return {
    typeID,
    // A skill with no name is still shown — as "—", which the icon tile turns
    // into "?". Silently dropping it would hide SP the player owns.
    name: asText(record.name) || "—",
    groupName: asText(record.groupName) || "Other",
    level: Math.max(0, Math.min(MAX_SKILL_LEVEL, asNumber(record.level))),
    rank: Math.max(1, asNumber(record.rank, 1)),
    skillPoints: Math.max(0, asNumber(record.skillPoints)),
    levelSkillPoints: thresholds,
    inTraining: record.inTraining === true,
  };
}

function decodeQueueEntry(value: JsonValue): SkillQueueEntry | null {
  const record = asRecord(value);
  const typeID = asNumber(record.typeID);
  const toLevel = asNumber(record.toLevel);
  if (typeID <= 0 || toLevel < 1) {
    return null;
  }
  return {
    typeID,
    toLevel,
    startSP: Math.max(0, asNumber(record.startSP)),
    destinationSP: Math.max(0, asNumber(record.destinationSP)),
    startTimeMs: asInstant(record.startTimeMs),
    endTimeMs: asInstant(record.endTimeMs),
    skillPointsPerMinute: Math.max(0, asNumber(record.skillPointsPerMinute)),
  };
}

function decodeQueue(value: JsonValue | undefined): SkillQueueState | null {
  if (value === null || value === undefined) {
    // The gateway could not read the queue at all. null is "unknown", which the
    // panel says out loud — it is never rendered as an empty queue.
    return null;
  }
  const record = asRecord(value);
  const entries = Array.isArray(record.entries)
    ? (record.entries as JsonValue[])
        .map(decodeQueueEntry)
        .filter((entry): entry is SkillQueueEntry => entry !== null)
    : [];
  return {
    active: record.active === true,
    entries,
    endTimeMs: asInstant(record.endTimeMs),
    maxEntries: Math.max(0, asNumber(record.maxEntries)),
  };
}

/** The whole GET /api/bridge/skills payload, decoded. */
export function decodeSkillSheet(value: JsonValue, readAtMs: number): SkillSheet {
  const record = asRecord(value);
  const serverNowMs = asInstant(record.serverNowMs);
  const skills = Array.isArray(record.skills)
    ? (record.skills as JsonValue[])
        .map(decodeSkillRow)
        .filter((row): row is SkillRow => row !== null)
    : [];
  return {
    characterName: asText(record.characterName),
    totalSkillPoints: Math.max(0, asNumber(record.totalSkillPoints)),
    freeSkillPoints: Math.max(0, asNumber(record.freeSkillPoints)),
    skills,
    queue: decodeQueue(record.queue),
    // How far the browser's clock is from the server's. Zero when the server
    // did not say — better an un-corrected countdown than a wildly wrong one.
    clockOffsetMs: serverNowMs === null ? 0 : serverNowMs - readAtMs,
  };
}

/** What the SERVER would call now, on this browser's clock. */
export function serverNow(clockOffsetMs: number, browserNowMs: number): number {
  return browserNowMs + clockOffsetMs;
}

// --- The character sheet ----------------------------------------------------

/**
 * Skills gathered into their groups, the way the character sheet reads them.
 *
 * Groups are sorted by name and so are the skills inside them, so the sheet is
 * stable across reads — a skill finishing training must never make the list
 * jump around under the player's cursor.
 */
export function groupSkills(skills: readonly SkillRow[]): readonly SkillGroup[] {
  const byGroup = new Map<string, SkillRow[]>();
  for (const skill of skills) {
    const bucket = byGroup.get(skill.groupName);
    if (bucket) {
      bucket.push(skill);
    } else {
      byGroup.set(skill.groupName, [skill]);
    }
  }
  return [...byGroup.entries()]
    .map(([groupName, rows]) => {
      const sorted = [...rows].sort((left, right) => left.name.localeCompare(right.name));
      return {
        groupName,
        skills: sorted,
        skillCount: sorted.length,
        totalSkillPoints: sorted.reduce((total, row) => total + row.skillPoints, 0),
        // How many are finished. The sheet leads with this because "24 of 31 at
        // V" is the thing a player actually wants to know about a group.
        maxedCount: sorted.filter((row) => row.level >= MAX_SKILL_LEVEL).length,
      };
    })
    .sort((left, right) => left.groupName.localeCompare(right.groupName));
}

/**
 * Where a skill stands: the level it has, and how far into the NEXT one its SP
 * has carried it.
 *
 * Partial progress is real and worth showing — a skill sitting at IV with 60%
 * of V banked is not the same as one that has just finished IV — and it is read
 * straight off the server's thresholds rather than recomputed.
 */
export function skillProgress(skill: SkillRow): {
  readonly level: number;
  readonly nextLevel: number | null;
  readonly skillPoints: number;
  readonly nextLevelSkillPoints: number | null;
  readonly fraction: number;
} {
  const level = skill.level;
  if (level >= MAX_SKILL_LEVEL) {
    return {
      level,
      nextLevel: null,
      skillPoints: skill.skillPoints,
      nextLevelSkillPoints: null,
      fraction: 1,
    };
  }
  const nextLevel = level + 1;
  const floor = level === 0 ? 0 : (skill.levelSkillPoints[level - 1] ?? 0);
  const ceiling = skill.levelSkillPoints[nextLevel - 1] ?? null;
  if (ceiling === null || ceiling <= floor) {
    return {
      level,
      nextLevel,
      skillPoints: skill.skillPoints,
      nextLevelSkillPoints: ceiling,
      fraction: 0,
    };
  }
  const span = ceiling - floor;
  const done = Math.max(0, Math.min(span, skill.skillPoints - floor));
  return {
    level,
    nextLevel,
    skillPoints: skill.skillPoints,
    nextLevelSkillPoints: ceiling,
    fraction: done / span,
  };
}

/**
 * The classic five squares. `filled` is what the character HAS; `queued` is
 * what the queue will bring it to — drawn differently so a player can see at a
 * glance what is planned versus what is theirs.
 */
export function levelSquares(
  skill: SkillRow,
  queue: SkillQueueState | null,
): readonly ("filled" | "queued" | "empty")[] {
  const queuedTo = queue === null
    ? 0
    : queue.entries.reduce(
        (highest, entry) => (entry.typeID === skill.typeID ? Math.max(highest, entry.toLevel) : highest),
        0,
      );
  const squares: ("filled" | "queued" | "empty")[] = [];
  for (let level = 1; level <= MAX_SKILL_LEVEL; level += 1) {
    squares.push(level <= skill.level ? "filled" : level <= queuedTo ? "queued" : "empty");
  }
  return squares;
}

// --- The training queue -----------------------------------------------------

/**
 * The live readout for whatever is training right now.
 *
 * SP is interpolated from the server's OWN rate between reads and clamped to
 * the destination the server set; remaining time is clamped at zero. Both
 * halves are derived from the same entry, so the bar and the clock can never
 * disagree. `null` means nothing is training — an inactive queue, an empty one,
 * or a head entry the server gave no times for.
 */
export function trainingReadout(
  queue: SkillQueueState | null,
  nowMs: number,
): SkillTrainingReadout | null {
  if (queue === null || !queue.active || queue.entries.length === 0) {
    return null;
  }
  const head = queue.entries[0]!;
  if (head.startTimeMs === null || head.endTimeMs === null) {
    return null;
  }
  const span = head.destinationSP - head.startSP;
  const elapsedMinutes = Math.max(0, (nowMs - head.startTimeMs) / 60_000);
  const earned = head.skillPointsPerMinute > 0
    ? head.skillPointsPerMinute * elapsedMinutes
    // No rate to interpolate with: fall back to the fraction of the WALL CLOCK
    // that has passed, which is the server's own span rather than a guess.
    : span * clampFraction(head.endTimeMs === head.startTimeMs
        ? 1
        : (nowMs - head.startTimeMs) / (head.endTimeMs - head.startTimeMs));
  const skillPoints = Math.min(head.destinationSP, head.startSP + Math.max(0, earned));
  return {
    typeID: head.typeID,
    toLevel: head.toLevel,
    skillPoints,
    startSP: head.startSP,
    destinationSP: head.destinationSP,
    fraction: span <= 0 ? 1 : clampFraction((skillPoints - head.startSP) / span),
    // Never negative: an entry whose end time has passed is FINISHED as far as
    // the display is concerned, and the next read is what confirms it.
    remainingMs: Math.max(0, head.endTimeMs - nowMs),
    finishAtMs: head.endTimeMs,
    skillPointsPerMinute: head.skillPointsPerMinute,
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * A duration in the words a player uses. Coarse on purpose: a queue that ends
 * in eleven days does not need its seconds, and a skill that ends in forty
 * seconds does not need its days.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** A skill point count, grouped so 641792000 reads as 641,792,000. */
export function formatSkillPoints(value: number): string {
  return Math.round(Math.max(0, value)).toLocaleString("en-US");
}

/** The classic Roman numeral for a skill level. Never a bare digit. */
export function romanLevel(level: number): string {
  return ["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(MAX_SKILL_LEVEL, level))] ?? "";
}

// --- Refusals ARE the feature ----------------------------------------------
//
// All eleven of these are things a player hits in ordinary play, not
// exceptional failures — the queue is full, the skill book was never injected,
// the clone is Alpha. The server refuses the WHOLE save with one code and
// changes nothing, so each of these has to say what happened and what to do
// next. A code on screen would be an admission that we did not know (R9a).
//
// The codes arrive as the CALL_REFUSED message: these throwWrappedUserError
// sites pass no prose, so eve.js's readWrappedUserErrorRefusal falls through to
// the bare code. The BFF passes it along untranslated so the wording lives here,
// where it is testable, rather than in a route.

const SKILL_QUEUE_REFUSALS: Readonly<Record<string, (skillName: string) => string>> =
  Object.freeze({
    QueueTooManySkills: () =>
      "Your training queue is full. Take a skill off it before adding another.",
    QueueTooLong: () =>
      "That queue reaches too far into the future. Take some skills off the end of it and add them again later.",
    QueueSkillNotUploaded: (skillName) =>
      `You have not learned ${skillName} yet. Buy its skill book and inject it before you can train it.`,
    QueueCannotTrainPastMaximumLevel: (skillName) =>
      `${skillName} is already at level V. That is as high as a skill goes.`,
    QueueCannotTrainOmegaRestrictedSkill: (skillName) =>
      `${skillName} needs an Omega clone at that level. Your clone cannot train it yet.`,
    QueueCannotTrainPreviouslyTrainedSkills: (skillName) =>
      `You have already trained ${skillName} to that level. Choose a higher one.`,
    QueueCannotPlaceSkillLevelsOutOfOrder: (skillName) =>
      `Levels have to be trained in order. Add the level below this one for ${skillName} first.`,
    QueueCannotPlaceSkillBeforeRequirements: (skillName) =>
      `${skillName} needs another skill trained first. Put the skill it depends on ahead of it in the queue.`,
    UserAlreadyHasSkillInTraining: () =>
      "Another character on this account is already training. Only one of them can train at a time.",
    SkillInQueueRequiresOmegaCloneState: () =>
      "Your queue contains a skill only an Omega clone can train. Take it off the queue, or upgrade the clone.",
    SkillInQueueOverAlphaSpTrainingSize: () =>
      "An Alpha clone can only train up to a set number of skill points, and this queue goes past that limit.",
  });

/** Every refusal code this client explains in words. Exported for the tests. */
export const SKILL_QUEUE_REFUSAL_CODES: readonly string[] = Object.freeze(
  Object.keys(SKILL_QUEUE_REFUSALS),
);

/**
 * The server's refusal, in words a player can act on.
 *
 * `skillName` is what the player was just doing — the panel knows it, the
 * server's error does not carry it. Codes that do not name a skill ignore it.
 * An UNKNOWN code keeps the server's own words rather than inventing a
 * reassuring sentence: being wrong in plain language is worse than being terse.
 */
export function skillQueueRefusal(
  code: string,
  message: string,
  skillName = "that skill",
): string {
  // The BFF sends the code as `error` for typed failures and as the refusal
  // `message` for CALL_REFUSED, so both are checked and neither is trusted to
  // be the one carrying it.
  const explain = SKILL_QUEUE_REFUSALS[message.trim()] ?? SKILL_QUEUE_REFUSALS[code.trim()];
  if (explain) {
    return explain(skillName || "that skill");
  }
  const detail = message.trim();
  return detail === "" || detail === code
    ? "The server would not save that queue, and did not say why."
    : detail;
}
