// R73 — decoding the 13 RB-SKILL bound reads, against REAL CAPTURED BYTES.
//
// Every fixture below is VERBATIM from a live capture on 2026-07-22:
//   - Farmer (140000005, a MAXED character, 511 skills at V) for the populated
//     skill sheet / attributes / total SP / ISIS changes / respec, and the
//     genuinely-empty history / boosters / implants / queue.
//   - GM Elysian (140000004) for the populated GetSkillQueue (Gunnery 3300 → V),
//     captured by queuing via the existing skillMgr.SaveNewQueue and clearing.
//
// The bigint fixtures matter: Farmer's total SP (641792000) and the queue
// FILETIMEs (134296439593290000) are asserted as EXACT decimal strings — a
// decoder that routed them through Number would be caught here.

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeSkills,
  decodeAttributes,
  decodeSkillPoints,
  decodeFreeSkillPoints,
  decodeDiminishedSp,
  decodeSkillHistory,
  decodeSkillChangesForISIS,
  decodeRespecInfo,
  decodeBoosters,
  decodeImplants,
  decodeSkillQueue,
  decodeBoundSkills,
  exactInt,
  idData,
} from "./boundSkills.ts";

// --- real captured bytes ----------------------------------------------------

const SKILLS_SAMPLE: JsonValue = {
  type: "dict",
  entries: [
    [
      2403,
      {
        type: "objectex1",
        header: [
          { type: "token", value: "characterskills.common.character_skill_entry.CharacterSkillEntry" },
          [2403, 5, 1280000, 5, null],
          {
            type: "dict",
            entries: [
              ["itemID", 14000000502403],
              ["ownerID", 140000005],
              ["locationID", 140000005],
              ["flagID", 7],
              ["groupID", 1241],
              ["categoryID", 16],
              ["groupName", "Planet Management"],
              ["published", true],
              ["inTraining", false],
            ],
          },
        ],
        list: [],
        dict: [],
      },
    ],
    [
      2406,
      {
        type: "objectex1",
        header: [
          { type: "token", value: "characterskills.common.character_skill_entry.CharacterSkillEntry" },
          [2406, 5, 768000, 3, null],
          {
            type: "dict",
            entries: [
              ["itemID", 14000000502406],
              ["ownerID", 140000005],
              ["locationID", 140000005],
              ["flagID", 7],
              ["groupID", 1241],
              ["categoryID", 16],
              ["groupName", "Planet Management"],
              ["published", true],
              ["inTraining", false],
            ],
          },
        ],
        list: [],
        dict: [],
      },
    ],
  ],
};

const ATTRIBUTES: JsonValue = {
  type: "dict",
  entries: [[164, 20], [165, 20], [166, 20], [167, 20], [168, 20]],
};

const RESPEC_INFO: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [["freeRespecs", 3], ["lastRespecDate", null], ["nextTimedRespec", null]],
  },
};

const CHANGES_FOR_ISIS: JsonValue = [[2403, 1280000], [2406, 768000], [2495, 1024000]];

const EMPTY_LIST: JsonValue = { type: "list", items: [] };
const EMPTY_DICT: JsonValue = { type: "dict", entries: [] };

const POPULATED_QUEUE: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "utillib.KeyVal", // ⚠ NOT util.KeyVal — the buildKeyVal class name.
      args: {
        type: "dict",
        entries: [
          ["trainingStartSP", 45255],
          ["queuePosition", 0],
          ["trainingTypeID", 3300],
          ["trainingDestinationSP", 256000],
          ["trainingEndTime", { type: "long", value: "134296439593290000" }],
          ["trainingStartTime", { type: "long", value: "134292224693290000" }],
          ["trainingToLevel", 5],
        ],
      },
    },
  ],
};

// --- GetSkills / GetAllSkills ----------------------------------------------

test("decodeSkills: real Farmer entries, SP kept EXACT, ids kept as data", () => {
  const rows = decodeSkills(SKILLS_SAMPLE);
  assert.equal(rows.length, 2);
  const first = rows[0]!;
  assert.equal(first.typeID, 2403);
  assert.equal(first.trainedSkillLevel, 5);
  assert.equal(first.skillPoints, "1280000"); // exact string, not a number
  assert.equal(typeof first.skillPoints, "string");
  assert.equal(first.skillRank, 5);
  assert.equal(first.virtualSkillLevel, null);
  assert.equal(first.itemID, 14000000502403);
  assert.equal(first.ownerID, 140000005);
  assert.equal(first.locationID, 140000005);
  assert.equal(first.flagID, 7);
  assert.equal(first.groupID, 1241);
  assert.equal(first.categoryID, 16);
  assert.equal(first.groupName, "Planet Management");
  assert.equal(first.published, true);
  assert.equal(first.inTraining, false);
  assert.equal(rows[1]!.typeID, 2406);
  assert.equal(rows[1]!.skillPoints, "768000");
  assert.equal(rows[1]!.skillRank, 3);
});

test("decodeSkills: an empty sheet decodes to no rows", () => {
  assert.deepEqual(decodeSkills(EMPTY_DICT), []);
});

// --- GetAttributes ----------------------------------------------------------

test("decodeAttributes: the five learning attributes by id", () => {
  const attrs = decodeAttributes(ATTRIBUTES);
  assert.equal(attrs.length, 5);
  assert.deepEqual(
    attrs.map((a) => a.attributeID),
    [164, 165, 166, 167, 168],
  );
  for (const a of attrs) {
    assert.equal(a.points, 20);
  }
});

// --- scalar SP reads (bigint-safe) ------------------------------------------

test("decodeSkillPoints: Farmer's total SP as an EXACT string, never Number", () => {
  assert.equal(decodeSkillPoints(641792000), "641792000");
  assert.equal(typeof decodeSkillPoints(641792000), "string");
  // A value past 2^53, carried as a long-string, survives exactly.
  assert.equal(
    decodeSkillPoints({ type: "long", value: "9007199254740993" }),
    "9007199254740993",
  );
});

test("decodeFreeSkillPoints / decodeDiminishedSp: exact, zero stays '0'", () => {
  assert.equal(decodeFreeSkillPoints(0), "0");
  assert.equal(decodeDiminishedSp(0), "0");
  assert.equal(decodeDiminishedSp(500000), "500000");
});

// --- GetSkillHistory --------------------------------------------------------

// The answer's form is Tranquility's, recorded at three logins of the retail client: a carbon CRowset of packed
// rows (logDate, eventTypeID, skillTypeID, relativePoints, absolutePoints). The rows below have the values of two
// recorded rows, in the two shapes a packed row reaches the page in (read off the running BFFs, 2026-10-13): the
// game port's with its fields by name, the gateway's with its values by place. Until then this file had a list of
// KeyVal with a "level", which no recording has.
const HISTORY_COLUMNS = [["logDate", 64], ["eventTypeID", 2], ["skillTypeID", 3], ["relativePoints", 3], ["absolutePoints", 3]];
const HISTORY_DESCRIPTOR = { type: "objectex1", header: [{ type: "token", value: "blue.DBRowDescriptor" }, [HISTORY_COLUMNS]], list: [], dict: [] };
const historyOf = (rows: readonly unknown[]) => ({
  type: "objectex2",
  header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [["header", HISTORY_DESCRIPTOR]] }],
  list: rows,
  dict: [],
}) as never;

test("decodeSkillHistory: a rowset of no rows is no history (a legitimate state)", () => {
  assert.deepEqual(decodeSkillHistory(historyOf([])), []);
});

test("decodeSkillHistory: Tranquility's rows, as either transport hands a packed row on, dates and points exact", () => {
  const rows = decodeSkillHistory(historyOf([
    {
      type: "packedrow", header: HISTORY_DESCRIPTOR, columns: HISTORY_COLUMNS,
      fields: { logDate: { type: "long", value: "134282810790000000" }, eventTypeID: 53, skillTypeID: 3424, relativePoints: 2307, absolutePoints: 2829 },
      values: [{ type: "long", value: "134282810790000000" }, 53, 3424, 2307, 2829],
    },
    { type: "packedrow", header: HISTORY_DESCRIPTOR, columns: HISTORY_COLUMNS, values: ["134276504640000000", 307, 81032, 908, 1000] },
  ]));
  assert.deepEqual(rows, [
    { logDate: "134282810790000000", eventTypeID: 53, skillTypeID: 3424, relativePoints: "2307", absolutePoints: "2829" },
    { logDate: "134276504640000000", eventTypeID: 307, skillTypeID: 81032, relativePoints: "908", absolutePoints: "1000" },
  ]);
});

// --- GetSkillChangesForISIS -------------------------------------------------

test("decodeSkillChangesForISIS: bare [typeID, sp] tuples, SP exact", () => {
  const changes = decodeSkillChangesForISIS(CHANGES_FOR_ISIS);
  assert.deepEqual(changes, [
    { typeID: 2403, skillPoints: "1280000" },
    { typeID: 2406, skillPoints: "768000" },
    { typeID: 2495, skillPoints: "1024000" },
  ]);
});

// --- GetRespecInfo ----------------------------------------------------------

test("decodeRespecInfo: util.KeyVal, null dates stay null (never 1970)", () => {
  const respec = decodeRespecInfo(RESPEC_INFO);
  assert.equal(respec.freeRespecs, 3);
  assert.equal(respec.lastRespecDate, null);
  assert.equal(respec.nextTimedRespec, null);
});

// --- GetBoosters / GetImplants ----------------------------------------------

test("decodeBoosters / decodeImplants: empty live, a legitimate 'none'", () => {
  assert.deepEqual(decodeBoosters(EMPTY_DICT), []);
  assert.deepEqual(decodeImplants(EMPTY_DICT), []);
});

test("decodeImplants: a synthetic slot dict carries its KeyVal fields losslessly", () => {
  const implants = decodeImplants({
    type: "dict",
    entries: [
      [
        7,
        {
          type: "object",
          name: "utillib.KeyVal",
          args: {
            type: "dict",
            entries: [["typeID", 9941], ["slot", 7], ["itemID", 14000000509941]],
          },
        },
      ],
    ],
  });
  assert.equal(implants.length, 1);
  assert.equal(implants[0]!.slot, 7);
  assert.equal(implants[0]!.fields.typeID, 9941);
  assert.equal(implants[0]!.fields.itemID, 14000000509941);
});

// --- GetSkillQueue ----------------------------------------------------------

test("decodeSkillQueue: empty for Farmer (not training)", () => {
  assert.deepEqual(decodeSkillQueue(EMPTY_LIST), []);
});

test("decodeSkillQueue: the LIVE populated entry, FILETIMEs + SP EXACT (utillib.KeyVal)", () => {
  const entries = decodeSkillQueue(POPULATED_QUEUE);
  assert.equal(entries.length, 1);
  const e = entries[0]!;
  assert.equal(e.queuePosition, 0);
  assert.equal(e.trainingTypeID, 3300);
  assert.equal(e.trainingToLevel, 5);
  assert.equal(e.trainingStartSP, "45255");
  assert.equal(e.trainingDestinationSP, "256000");
  // ⚠ the whole point: a utillib.KeyVal row is read (util.KeyVal-only readers
  // would drop every field), and the FILETIMEs survive as exact strings.
  assert.equal(e.trainingStartTime, "134292224693290000");
  assert.equal(e.trainingEndTime, "134296439593290000");
});

// --- helpers ----------------------------------------------------------------

test("exactInt: number, long-wrapper, decimal-string all exact; junk -> null", () => {
  assert.equal(exactInt(641792000), "641792000");
  assert.equal(exactInt({ type: "long", value: "134296439593290000" }), "134296439593290000");
  assert.equal(exactInt("256000"), "256000");
  assert.equal(exactInt(null), null);
  assert.equal(exactInt(undefined), null);
  assert.equal(exactInt("not-a-number"), null);
});

test("idData: safe ints stay numbers; huge ids become exact strings; junk -> null", () => {
  assert.equal(idData(140000005), 140000005);
  assert.equal(idData({ type: "long", value: "9007199254740993" }), "9007199254740993");
  assert.equal(idData(null), null);
});

// --- the whole /api/bridge/bound-skills envelope ----------------------------

test("decodeBoundSkills: folds each read's {result|error} into typed data", () => {
  const raw: JsonValue = {
    ok: true,
    reads: {
      GetSkills: { result: SKILLS_SAMPLE },
      GetAllSkills: { result: SKILLS_SAMPLE },
      GetAttributes: { result: ATTRIBUTES },
      GetSkillHistory: { result: historyOf([]) },
      GetSkillChangesForISIS: { result: CHANGES_FOR_ISIS },
      GetRespecInfo: { result: RESPEC_INFO },
      GetFreeSkillPoints: { result: 0 },
      GetBoosters: { result: EMPTY_DICT },
      GetImplants: { result: EMPTY_DICT },
      // The read that legitimately REFUSES when no injector is owned — the BFF
      // mirrors /api/bridge/call: code in `error`, detail in `message`.
      CheckInjectionConstraints: { error: "CALL_REFUSED", message: "SkillTradingItemNotFound" },
      GetSkillPoints: { result: 641792000 },
      GetDiminishedSpFromInjectors: { result: 0 },
      GetSkillQueue: { result: POPULATED_QUEUE },
    },
  };
  const decoded = decodeBoundSkills(raw);
  assert.equal(decoded.skills.value.length, 2);
  assert.equal(decoded.skills.error, null);
  assert.equal(decoded.allSkills.value.length, 2);
  assert.equal(decoded.attributes.value.length, 5);
  assert.deepEqual(decoded.skillHistory.value, []);
  assert.equal(decoded.skillChangesForISIS.value.length, 3);
  assert.equal(decoded.respecInfo.value?.freeRespecs, 3);
  assert.equal(decoded.freeSkillPoints.value, "0");
  assert.deepEqual(decoded.boosters.value, []);
  assert.deepEqual(decoded.implants.value, []);
  // A refusal is carried through as a code, NOT an exception, and the value is
  // the empty (null) result — an empty state, not a blanking failure.
  assert.equal(decoded.injectionConstraints.error, "CALL_REFUSED");
  assert.equal(decoded.injectionConstraints.value, null);
  assert.equal(decoded.skillPoints.value, "641792000");
  assert.equal(decoded.diminishedSp.value, "0");
  assert.equal(decoded.skillQueue.value.length, 1);
  assert.equal(decoded.skillQueue.value[0]!.trainingEndTime, "134296439593290000");
});

test("decodeBoundSkills: a missing envelope never throws", () => {
  const decoded = decodeBoundSkills(null);
  assert.deepEqual(decoded.skills.value, []);
  assert.equal(decoded.skillPoints.value, null);
  assert.deepEqual(decoded.skillQueue.value, []);
});
