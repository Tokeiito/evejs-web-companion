"use strict";

// ── A list of skills read as the client reads one from the clipboard ─────────
//
// The skill plan editor's Import Skills from Clipboard (skillPlanEditorContents.ImportSkillsFromClipboard) reads the
// clipboard with the skill queue's importer (skillQueueSvc.GetSkillPlanImporter: textImporting.importSkillplan
// ImportSkillPlan.GetSkillsAndLevelsFromText): each line its parts by spaces, the last a level (1 to 5, or I to V in
// any case), the rest a skill's name (or its type number); a line it cannot read is failed. The names are the skill
// types' (evetypes.GetTypeIDsByCategory(categorySkill)), by English name cleaned and lowered (TextToTypeIDFinder); a
// client in English has no localized names to try besides.

const { cleanText, getLines } = require("./importMultibuy");

/** ImportSkillPlan.levelDict and validLevelStrings. */
const LEVEL_BY_NUMERAL = Object.freeze({ i: 1, ii: 2, iii: 3, iv: 4, v: 5 });
const LEVEL_DIGITS = Object.freeze(["1", "2", "3", "4", "5"]);
/** Python's int() of a string: an optional sign and digits, with spaces about them. */
const PY_INT = /^\s*[+-]?\d+\s*$/;

/** textImporting.SplitAndStrip(text, ' '): the parts between single spaces, each stripped, the empty ones left out. */
function splitAndStrip(text, splitOn) {
  return String(text).split(splitOn).map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * An importer over the skills' names (a Map of a name cleaned and lowered to its type) and a test of a type being a
 * skill (evetypes.IsSkill).
 *
 *   getSkillsAndLevelsFromText(text)  {skillsAndLevels: [[typeID, level], ...], failed: [line, ...]}
 */
function createSkillplanImport(namesToTypeIDs, isSkill) {
  /** _GetSkillTypeID: a type number that is a skill's, else the name cleaned and lowered. */
  function skillTypeID(skillName) {
    if (PY_INT.test(skillName)) {
      const typeID = Number.parseInt(skillName, 10);
      return isSkill(typeID) ? typeID : null;
    }
    return namesToTypeIDs.get(cleanText(skillName).toLowerCase()) ?? null;
  }

  function getSkillsAndLevelsFromText(text) {
    const skillsAndLevels = [];
    const failed = [];
    for (const eachLine of getLines(text)) {
      const parts = splitAndStrip(eachLine, " ");
      if (parts.length === 0) continue;
      const levelString = parts[parts.length - 1];
      const level = LEVEL_DIGITS.includes(levelString)
        ? Number(levelString)
        : LEVEL_BY_NUMERAL[levelString.toLowerCase()] ?? null;
      if (!level) {
        failed.push(eachLine);
        continue;
      }
      const typeID = skillTypeID(parts.slice(0, -1).join(" ").trim());
      if (typeID) skillsAndLevels.push([typeID, level]);
      else failed.push(eachLine);
    }
    return { skillsAndLevels, failed };
  }

  return { getSkillsAndLevelsFromText };
}

module.exports = { createSkillplanImport, splitAndStrip };
