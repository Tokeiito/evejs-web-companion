"use strict";

// The Skills window's sheet, made from what the retail client's skill services
// keep (pilotSkills.js), each figure made the way the client's own windows make
// it. It is in the form the web gateway's sheet is in, so the page reads either.
//
//   a skill's row        its entry as kept: level, points, rank
//   a level's points     characterskills/util.py GetSPForLevelRaw
//   the skill training   skillQueueSvc.SkillInTraining: the queue's first entry,
//                        where that has an end
//   its points           skillQueueSvc.GetSkillPointsFromSkillObject: the points
//                        kept and what the time since the queue began has added
//                        at the pilot's rate (the client takes the larger of
//                        that and the points kept, which it never is less than)
//   the rate             characterskills/util.py GetSkillPointsPerMinute, from
//                        the character's attributes for the skill's two
//   the total            skillsvc.GetTotalSkillPointsForCharacter: every skill's
//                        points, the lapsed with them, and the free points
//
// The reckoning of the skill in training is right only where the entry kept
// holds what the skill had when the queue's first entry began, which is what a
// server must answer in its skill lists. One that answers the points trained
// so far has a client that logged in during the training count the time before
// its login twice (this server did, until eve.js 16d95626a).
//
// Not done here, which the client does: a booster that runs out while the skill
// trains lowers the rate from then (skill_training.py), and an alpha clone's
// attributes count for half (clonegrade ALPHA_TRAINING_MULTIPLIER). The rate
// here is an omega clone's with the attributes as they are now.
//
// A skill held by a lent level alone (an expert system's) has no level or points
// of its own and is left out, as the gateway's sheet leaves it out.

const { skillInTraining } = require("./pilotSkills");

/** characterskills/const.py */
const MAX_SKILL_LEVEL = 5;
const SKILL_POINT_MULTIPLIER = 250;
/** characterskills/queue.py */
const SKILLQUEUE_MAX_NUM_SKILLS = 150;
/** dogma/const.py: which of the character's attributes a skill trains by. */
const ATTRIBUTE_PRIMARY = 180;
const ATTRIBUTE_SECONDARY = 181;
/** 1601 to 1970, in the 100 ns the server counts in. */
const FILETIME_EPOCH = 116444736000000000n;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const entriesOf = (value) => (value && value.type === "dict" && Array.isArray(value.entries) ? value.entries : []);
const itemsOf = (value) => (value && Array.isArray(value.items) ? value.items : []);
/** A server's time as this machine counts it, in milliseconds. Null for none. */
function epochMs(filetime) {
  const ticks = typeof filetime === "bigint" ? filetime : typeof filetime === "number" && Number.isFinite(filetime) ? BigInt(Math.trunc(filetime)) : null;
  return ticks !== null && ticks > 0n ? Number((ticks - FILETIME_EPOCH) / 10000n) : null;
}

/** characterskills.util.GetSPForLevelRaw: the points a skill of a rank has at a level. */
function skillPointsForLevel(rank, level) {
  if (level <= 0) return 0;
  return Math.ceil(rank * SKILL_POINT_MULTIPLIER * 2 ** (2.5 * (Math.min(level, MAX_SKILL_LEVEL) - 1)));
}

/** characterskills.util.GetSkillPointsPerMinute */
const skillPointsPerMinute = (primary, secondary) => primary + secondary / 2.0;

/**
 * skill_training.get_skill_points_trained_at_sample_time, with no booster running out on the way: the points a
 * skill had, and what training since `startMs` at `rate` a minute has added by `nowMs`, whole points.
 */
function pointsTrainedBy(points, startMs, nowMs, rate) {
  if (startMs > nowMs) return points;
  return Math.trunc(((nowMs - startMs) / 60000) * rate + points);
}

/**
 * The sheet. `skills`, `allSkills`, `queue`, `freeSkillPoints` and `attributes` are what the services keep, as
 * they came off the wire (`attributes` may be null: then no rate is said and the skill in training has the points
 * kept). `now()` reads the client's clock, in milliseconds. `typeName`, `typeGroupName` and `typeAttribute`
 * say what the client knows of a type without asking.
 */
function buildSkillSheet({ characterID, characterName = "", skills, allSkills, queue, freeSkillPoints, attributes = null, now, typeName, typeGroupName, typeAttribute }) {
  const queued = itemsOf(queue).map((entry) => new Map(entriesOf(entry && entry.args).map(([key, value]) => [text(key), value])));
  const training = skillInTraining(queue);
  const head = queued[0];
  const attribute = (attributeID) => number((entriesOf(attributes).find(([id]) => number(id) === attributeID) ?? [])[1]);
  /** The pilot's rate at a skill, or null where the attributes or the skill's two are not known. */
  const rateFor = (typeID) => {
    const [primary, secondary] = [ATTRIBUTE_PRIMARY, ATTRIBUTE_SECONDARY].map((which) => attribute(number(typeAttribute(typeID, which))));
    const rate = primary === null || secondary === null ? null : skillPointsPerMinute(primary, secondary);
    // The client's calculator refuses a rate of nothing or less.
    return rate > 0 ? rate : null;
  };
  const trainingRate = training === null ? null : rateFor(training);
  const trainingStartMs = training === null ? null : epochMs(head.get("trainingStartTime"));

  const rows = [];
  let inTrainingRow = null;
  for (const [typeID, entry] of entriesOf(skills)) {
    const fields = entry && Array.isArray(entry.header) && Array.isArray(entry.header[1]) ? entry.header[1] : null;
    const level = fields ? number(fields[1]) : null;
    if (level === null) continue;
    const type = number(typeID);
    const rank = number(fields[3]) ?? 0;
    const points = number(fields[2]) ?? 0;
    const row = {
      typeID: type,
      name: String(typeName(type) ?? ""),
      groupName: String(typeGroupName(type) ?? ""),
      level,
      rank,
      skillPoints: points,
      levelSkillPoints: Array.from({ length: MAX_SKILL_LEVEL }, (unused, index) => skillPointsForLevel(rank, index + 1)),
      inTraining: type === training,
    };
    if (row.inTraining) inTrainingRow = row;
    rows.push(row);
  }
  rows.sort((left, right) => left.name.localeCompare(right.name));
  // The clock is read after the types have been looked up, which the first time is a read from disk: the sheet's
  // time is the time its figures were worked at.
  const nowMs = now();
  if (inTrainingRow && trainingRate !== null && trainingStartMs !== null) {
    inTrainingRow.skillPoints = pointsTrainedBy(inTrainingRow.skillPoints, trainingStartMs, nowMs, trainingRate);
  }

  const free = Math.max(0, number(freeSkillPoints) ?? 0);
  const trained = entriesOf(allSkills).reduce((sum, [, entry]) => sum + (number(entry && Array.isArray(entry.header) && Array.isArray(entry.header[1]) ? entry.header[1][2] : null) ?? 0), 0);
  return {
    characterID,
    characterName,
    totalSkillPoints: Math.max(0, trained) + free,
    freeSkillPoints: free,
    serverNowMs: Math.trunc(nowMs),
    skills: rows,
    queue: {
      active: training !== null,
      entries: queued.map((entry, index) => ({
        queuePosition: number(entry.get("queuePosition")) ?? index,
        typeID: number(entry.get("trainingTypeID")) ?? 0,
        toLevel: number(entry.get("trainingToLevel")) ?? 0,
        startSP: number(entry.get("trainingStartSP")) ?? 0,
        destinationSP: number(entry.get("trainingDestinationSP")) ?? 0,
        startTimeMs: epochMs(entry.get("trainingStartTime")),
        endTimeMs: epochMs(entry.get("trainingEndTime")),
        // The rate is said of the skill in training alone: a later entry's is what the attributes are then.
        skillPointsPerMinute: index === 0 && trainingRate !== null ? trainingRate : 0,
      })),
      endTimeMs: queued.length ? epochMs(queued[queued.length - 1].get("trainingEndTime")) : null,
      maxEntries: SKILLQUEUE_MAX_NUM_SKILLS,
    },
    queueWarning: null,
  };
}

module.exports = { buildSkillSheet, pointsTrainedBy, skillPointsForLevel, skillPointsPerMinute };
