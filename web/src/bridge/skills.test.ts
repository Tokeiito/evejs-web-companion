// R28: the skill sheet, the countdown, and the eleven refusals.
//
// The whole file exists to hold three lines that are easy to cross:
//
//   1. THE CLIENT DOES NOT DO SP MATHS. Every threshold on screen came off the
//      server's `levelSkillPoints`. If someone ever "helpfully" recomputes one,
//      the progress assertions here read a curve nobody in this repo defines.
//
//   2. A COUNTDOWN INTERPOLATES; IT DOES NOT SIMULATE. It may fill a bar
//      between two reads, and it may never pass the destination the server set
//      or run its clock past the server's own end instant.
//
//   3. A REFUSAL IS A SENTENCE, NOT A CODE. All eleven public codes are things
//      a player hits in ordinary play, and every one of them must come out in
//      words with something to do next.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SKILL_QUEUE_REFUSAL_CODES,
  decodeSkillSheet,
  formatDuration,
  formatSkillPoints,
  groupSkills,
  levelSquares,
  romanLevel,
  serverNow,
  skillProgress,
  skillQueueRefusal,
  trainingReadout,
} from "./skills.ts";
import type { JsonValue } from "./wire.ts";
import type { SkillRow, SkillQueueState } from "../store/types.ts";

// The exact envelope GET /api/bridge/skills returns, with real numbers taken
// from the live emulator: Gunnery is rank 1, so its five thresholds are
// 250 / 1414 / 8000 / 45255 / 256000.
const GUNNERY_THRESHOLDS = [250, 1414, 8000, 45255, 256000];

function sheetPayload(overrides: Record<string, JsonValue> = {}): JsonValue {
  return {
    characterName: "Test Two",
    totalSkillPoints: 384402,
    freeSkillPoints: 0,
    serverNowMs: 1_784_617_000_000,
    skills: [
      {
        typeID: 3300,
        name: "Gunnery",
        groupName: "Gunnery",
        level: 4,
        rank: 1,
        skillPoints: 45255,
        levelSkillPoints: GUNNERY_THRESHOLDS,
        inTraining: false,
      },
      {
        typeID: 3315,
        name: "Surgical Strike",
        groupName: "Gunnery",
        level: 0,
        rank: 4,
        skillPoints: 0,
        levelSkillPoints: [1000, 5657, 32000, 181019, 1024000],
        inTraining: false,
      },
      {
        typeID: 3380,
        name: "Industry",
        groupName: "Production",
        level: 1,
        rank: 1,
        skillPoints: 250,
        levelSkillPoints: GUNNERY_THRESHOLDS,
        inTraining: false,
      },
    ],
    queue: { active: false, entries: [], endTimeMs: null, maxEntries: 150 },
    ...overrides,
  } as unknown as JsonValue;
}

// --- Decoding ---------------------------------------------------------------

test("the sheet decodes with the server's thresholds untouched", () => {
  const sheet = decodeSkillSheet(sheetPayload(), 1_784_617_000_000);
  assert.equal(sheet.characterName, "Test Two");
  assert.equal(sheet.totalSkillPoints, 384402);
  assert.equal(sheet.skills.length, 3);
  assert.deepEqual(sheet.skills[0]!.levelSkillPoints, GUNNERY_THRESHOLDS);
  assert.equal(sheet.queue?.maxEntries, 150);
});

test("an unread queue is null, and an EMPTY queue is a real empty queue", () => {
  // ⚠ The distinction the panel depends on: "we could not look" must never
  // render as "you are not training anything".
  const unread = decodeSkillSheet(sheetPayload({ queue: null }), Date.now());
  assert.equal(unread.queue, null);

  const empty = decodeSkillSheet(sheetPayload(), Date.now());
  assert.deepEqual(empty.queue?.entries, []);
  assert.equal(empty.queue?.active, false);
});

test("the clock offset is measured against the server, not assumed to be zero", () => {
  // A browser whose clock is two minutes fast still gets the right countdown.
  const readAt = 1_784_617_120_000;
  const sheet = decodeSkillSheet(sheetPayload(), readAt);
  assert.equal(sheet.clockOffsetMs, -120_000);
  assert.equal(serverNow(sheet.clockOffsetMs, readAt), 1_784_617_000_000);

  // A server that gave no clock leaves the browser's own — an un-corrected
  // countdown beats a wildly wrong one.
  const silent = decodeSkillSheet(sheetPayload({ serverNowMs: null }), readAt);
  assert.equal(silent.clockOffsetMs, 0);
});

test("an absent instant stays null and never becomes 1970", () => {
  const sheet = decodeSkillSheet(
    sheetPayload({
      queue: {
        active: true,
        maxEntries: 150,
        endTimeMs: null,
        entries: [
          {
            typeID: 3300,
            toLevel: 5,
            startSP: 45255,
            destinationSP: 256000,
            startTimeMs: null,
            endTimeMs: null,
            skillPointsPerMinute: 30,
          },
        ],
      },
    } as unknown as Record<string, JsonValue>),
    Date.now(),
  );
  assert.equal(sheet.queue?.entries[0]!.startTimeMs, null);
  assert.equal(sheet.queue?.entries[0]!.endTimeMs, null);
  // With no instants there is nothing honest to count down, so there is no
  // readout at all rather than a bar anchored at the epoch.
  assert.equal(trainingReadout(sheet.queue, Date.now()), null);
});

// --- The character sheet ----------------------------------------------------

test("skills group by their group, sorted, with the counts the sheet leads on", () => {
  const sheet = decodeSkillSheet(sheetPayload(), Date.now());
  const groups = groupSkills(sheet.skills);
  assert.deepEqual(groups.map((group) => group.groupName), ["Gunnery", "Production"]);

  const gunnery = groups[0]!;
  assert.deepEqual(gunnery.skills.map((skill) => skill.name), ["Gunnery", "Surgical Strike"]);
  assert.equal(gunnery.skillCount, 2);
  assert.equal(gunnery.totalSkillPoints, 45255);
  assert.equal(gunnery.maxedCount, 0, "nothing here is at V yet");
});

test("group ordering is stable, so a finished skill never reshuffles the sheet", () => {
  const sheet = decodeSkillSheet(sheetPayload(), Date.now());
  const first = groupSkills(sheet.skills);
  // The same skills, handed over in a different order.
  const shuffled = groupSkills([...sheet.skills].reverse());
  assert.deepEqual(
    first.map((group) => [group.groupName, group.skills.map((skill) => skill.name)]),
    shuffled.map((group) => [group.groupName, group.skills.map((skill) => skill.name)]),
  );
});

test("progress to the next level is read off the server's thresholds", () => {
  const gunnery: SkillRow = {
    typeID: 3300,
    name: "Gunnery",
    groupName: "Gunnery",
    level: 4,
    rank: 1,
    // Exactly at IV: no progress into V yet.
    skillPoints: 45255,
    levelSkillPoints: GUNNERY_THRESHOLDS,
    inTraining: false,
  };
  const atFour = skillProgress(gunnery);
  assert.equal(atFour.nextLevel, 5);
  assert.equal(atFour.nextLevelSkillPoints, 256000);
  assert.equal(atFour.fraction, 0);

  // Halfway from IV (45255) to V (256000).
  const halfway = skillProgress({
    ...gunnery,
    skillPoints: 45255 + (256000 - 45255) / 2,
  });
  assert.equal(halfway.fraction, 0.5);

  // A finished skill has no next level and no bar to fill.
  const maxed = skillProgress({ ...gunnery, level: 5, skillPoints: 256000 });
  assert.equal(maxed.nextLevel, null);
  assert.equal(maxed.nextLevelSkillPoints, null);
  assert.equal(maxed.fraction, 1);

  // A brand-new skill counts from zero, not from the level-I threshold.
  const untrained = skillProgress({ ...gunnery, level: 0, skillPoints: 125 });
  assert.equal(untrained.nextLevel, 1);
  assert.equal(untrained.nextLevelSkillPoints, 250);
  assert.equal(untrained.fraction, 0.5);
});

test("the five squares separate what you HAVE from what is merely planned", () => {
  const gunnery: SkillRow = {
    typeID: 3300,
    name: "Gunnery",
    groupName: "Gunnery",
    level: 2,
    rank: 1,
    skillPoints: 1414,
    levelSkillPoints: GUNNERY_THRESHOLDS,
    inTraining: false,
  };
  assert.deepEqual(levelSquares(gunnery, null), [
    "filled",
    "filled",
    "empty",
    "empty",
    "empty",
  ]);

  const queue: SkillQueueState = {
    active: true,
    endTimeMs: 2,
    maxEntries: 150,
    entries: [
      {
        typeID: 3300,
        toLevel: 4,
        startSP: 1414,
        destinationSP: 45255,
        startTimeMs: 1,
        endTimeMs: 2,
        skillPointsPerMinute: 30,
      },
    ],
  };
  // ⚠ III and IV are QUEUED, not owned. Showing them as filled would tell a
  // player they can fly something they cannot.
  assert.deepEqual(levelSquares(gunnery, queue), [
    "filled",
    "filled",
    "queued",
    "queued",
    "empty",
  ]);
});

// --- The countdown ----------------------------------------------------------

const START = 1_784_617_000_000;
const HOUR = 3_600_000;

function trainingQueue(overrides: Partial<SkillQueueState["entries"][number]> = {}): SkillQueueState {
  return {
    active: true,
    maxEntries: 150,
    endTimeMs: START + HOUR,
    entries: [
      {
        typeID: 3300,
        toLevel: 3,
        startSP: 1414,
        destinationSP: 8000,
        startTimeMs: START,
        endTimeMs: START + HOUR,
        // 6586 SP over 60 minutes.
        skillPointsPerMinute: 6586 / 60,
        ...overrides,
      },
    ],
  };
}

test("nothing trains when the queue is empty, inactive, or unread", () => {
  assert.equal(trainingReadout(null, START), null);
  assert.equal(
    trainingReadout({ active: false, entries: [], endTimeMs: null, maxEntries: 150 }, START),
    null,
  );
  assert.equal(
    trainingReadout({ ...trainingQueue(), active: false }, START),
    null,
    "a paused queue is not training, however full it is",
  );
});

test("the readout interpolates from the SERVER's rate between reads", () => {
  const queue = trainingQueue();
  const atStart = trainingReadout(queue, START)!;
  assert.equal(atStart.skillPoints, 1414);
  assert.equal(atStart.fraction, 0);
  assert.equal(atStart.remainingMs, HOUR);

  const halfway = trainingReadout(queue, START + HOUR / 2)!;
  assert.ok(Math.abs(halfway.fraction - 0.5) < 1e-9);
  assert.ok(Math.abs(halfway.skillPoints - (1414 + 6586 / 2)) < 1e-6);
  assert.equal(halfway.remainingMs, HOUR / 2);
});

test("interpolation NEVER runs past what the server said", () => {
  const queue = trainingQueue();
  // An hour after it should have finished — a page left open, or a browser
  // whose clock ran ahead.
  const late = trainingReadout(queue, START + HOUR * 2)!;
  assert.equal(late.skillPoints, 8000, "SP is clamped to the server's destination");
  assert.equal(late.fraction, 1);
  assert.equal(late.remainingMs, 0, "a countdown never goes negative");

  // ...and before it started (a browser clock running behind), nothing is
  // subtracted from the SP the character already had.
  const early = trainingReadout(queue, START - HOUR)!;
  assert.equal(early.skillPoints, 1414);
  assert.equal(early.fraction, 0);
});

test("a read always wins: the SAME instant re-derives from the new server values", () => {
  // The server rebased the entry (a queue edit moved the head). Nothing is
  // carried over from the previous readout — this module has no memory.
  const before = trainingReadout(trainingQueue(), START + HOUR / 2)!;
  const after = trainingReadout(
    trainingQueue({ startSP: 5000, destinationSP: 8000, skillPointsPerMinute: 3000 / 60 }),
    START + HOUR / 2,
  )!;
  assert.notEqual(before.skillPoints, after.skillPoints);
  assert.equal(after.skillPoints, 6500);
});

test("with no rate, the bar falls back to the server's own span — never to a guess", () => {
  const queue = trainingQueue({ skillPointsPerMinute: 0 });
  const halfway = trainingReadout(queue, START + HOUR / 2)!;
  assert.ok(Math.abs(halfway.fraction - 0.5) < 1e-9);
  assert.ok(Math.abs(halfway.skillPoints - (1414 + 6586 / 2)) < 1e-6);
  assert.equal(halfway.remainingMs, HOUR / 2);
});

test("only the head of the queue is the readout; later entries wait their turn", () => {
  const queue: SkillQueueState = {
    active: true,
    maxEntries: 150,
    endTimeMs: START + HOUR * 3,
    entries: [
      ...trainingQueue().entries,
      {
        typeID: 3380,
        toLevel: 2,
        startSP: 250,
        destinationSP: 1414,
        startTimeMs: START + HOUR,
        endTimeMs: START + HOUR * 3,
        skillPointsPerMinute: 0,
      },
    ],
  };
  const readout = trainingReadout(queue, START + HOUR / 2)!;
  assert.equal(readout.typeID, 3300, "the SECOND entry is not what is training");
  assert.equal(readout.finishAtMs, START + HOUR);
});

// --- Words ------------------------------------------------------------------

test("durations read the way a player says them", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(-5000), "0s", "never a negative countdown");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(90_000), "1m 30s");
  assert.equal(formatDuration(3 * HOUR + 20 * 60_000), "3h 20m");
  assert.equal(formatDuration(11 * 24 * HOUR + 5 * HOUR), "11d 5h");
});

test("skill points and levels are readable, and a level is never a bare digit", () => {
  assert.equal(formatSkillPoints(641792000), "641,792,000");
  assert.equal(formatSkillPoints(0), "0");
  assert.deepEqual([1, 2, 3, 4, 5].map(romanLevel), ["I", "II", "III", "IV", "V"]);
  assert.equal(romanLevel(0), "", "level zero has no numeral — it is untrained");
});

// --- Refusals ARE the feature -----------------------------------------------

test("all ELEVEN public refusal codes render as player language", () => {
  // The exact allowlist the gateway publishes
  // (PUBLIC_SKILL_QUEUE_ERROR_CODES in evejsWebGatewayRuntime.js).
  const PUBLIC_CODES = [
    "QueueTooManySkills",
    "QueueTooLong",
    "QueueSkillNotUploaded",
    "QueueCannotTrainPastMaximumLevel",
    "QueueCannotTrainOmegaRestrictedSkill",
    "QueueCannotTrainPreviouslyTrainedSkills",
    "QueueCannotPlaceSkillLevelsOutOfOrder",
    "QueueCannotPlaceSkillBeforeRequirements",
    "UserAlreadyHasSkillInTraining",
    "SkillInQueueRequiresOmegaCloneState",
    "SkillInQueueOverAlphaSpTrainingSize",
  ];
  assert.equal(PUBLIC_CODES.length, 11);
  // Not one more, not one fewer: a code the gateway can send and this client
  // cannot explain would reach a player as jargon.
  assert.deepEqual([...SKILL_QUEUE_REFUSAL_CODES].sort(), [...PUBLIC_CODES].sort());

  for (const code of PUBLIC_CODES) {
    // The refusal arrives as the CALL_REFUSED *message*, which is the bare code.
    const words = skillQueueRefusal("CALL_REFUSED", code, "Gunnery");
    assert.ok(words.length > 0, `${code} must say something`);
    // R9a: no code, no camelCase jargon, no "error".
    assert.ok(!words.includes(code), `${code} must not appear in its own message`);
    assert.ok(
      !/[a-z][A-Z]/.test(words.replace(/Alpha|Omega|Gunnery/g, "")),
      `${code} must not leak camelCase jargon: ${words}`,
    );
    assert.ok(/[.!]$/.test(words), `${code} must read as a sentence: ${words}`);
    assert.ok(words.length > 25, `${code} must explain, not just name: ${words}`);
  }
});

test("a refusal names the skill the player was acting on", () => {
  assert.match(
    skillQueueRefusal("CALL_REFUSED", "QueueCannotPlaceSkillBeforeRequirements", "Caldari Cruiser"),
    /^Caldari Cruiser needs another skill trained first\./,
  );
  assert.match(
    skillQueueRefusal("CALL_REFUSED", "QueueSkillNotUploaded", "Astrogeology"),
    /You have not learned Astrogeology yet\./,
  );
  // Codes about the whole queue ignore the skill — naming one would be a lie
  // about which skill caused it.
  assert.equal(
    skillQueueRefusal("CALL_REFUSED", "QueueTooManySkills", "Gunnery").includes("Gunnery"),
    false,
  );
});

test("the code may arrive as the error code instead of the message", () => {
  // Belt and braces: the BFF surfaces CALL_REFUSED with the code as the
  // message, but a typed failure could carry it the other way round.
  assert.equal(
    skillQueueRefusal("QueueTooManySkills", "", "Gunnery"),
    skillQueueRefusal("CALL_REFUSED", "QueueTooManySkills", "Gunnery"),
  );
});

test("an UNKNOWN refusal keeps the server's own words rather than inventing calm ones", () => {
  // R28's rule, unchanged: when the server says something a player can act on,
  // those are its words and they stand. Being wrong in plain language is worse
  // than being terse.
  assert.equal(
    skillQueueRefusal("CALL_REFUSED", "That skill plan is not available to you.", "Gunnery"),
    "That skill plan is not available to you.",
  );
  // R31 CORRECTS THE OTHER HALF. A bare code is not "the server's own words",
  // it is a name the server never meant a player to read — so it degrades to an
  // honest sentence instead of being dumped on screen. The reason is still not
  // invented: the fallback says only that it was refused.
  assert.equal(
    skillQueueRefusal("CALL_REFUSED", "SomethingNobodyHasSeen", "Gunnery"),
    "The server turned that down without a reason this client can put into words.",
  );
  // And a refusal with nothing in it says exactly that, instead of implying
  // the save worked.
  assert.match(
    skillQueueRefusal("CALL_FAILED", "", "Gunnery"),
    /would not save that queue, and did not say why/,
  );
});
