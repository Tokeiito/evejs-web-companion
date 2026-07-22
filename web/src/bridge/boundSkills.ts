// R73 — the 13 RB-SKILL BOUND reads, decoded from real captured bytes
// (PLUMBING ONLY — no UI, no writes).
//
// These are the raw retail skill reads the client issues against the moniker
// skillMgr2.GetMySkillHandler returns: Moniker("skillHandler", null,
// <session charID>, null). Because that is a Moniker (not an "N=" OID substruct)
// the reads ride the ORDINARY top-level /call seam with service "skillHandler"
// (a real registered service — SkillHandlerService extends SkillMgrService, so
// serviceManager.lookup dispatches the inherited Handle_* under that name). Every
// one derives the character from the SESSION and ignores any caller-supplied
// charID — verified live cross-account (Farmer 140000005 vs GM Elysian 140000004:
// injecting Farmer's id returns the caller's OWN skills, never Farmer's).
//
// This module is DISTINCT from skills.ts (R28): that decodes the BFF's composed
// GET /api/bridge/skills sheet; this decodes the raw marshaled skillHandler reads
// for GET /api/bridge/bound-skills.
//
// ---------------------------------------------------------------------------
// WIRE SHAPES (captured LIVE 2026-07-22, Farmer 140000005 unless noted):
//
//  GetSkills / GetAllSkills (identical): {type:"dict", entries:[[typeID,
//    CharacterSkillEntry], …]} where each value is an objectex1:
//      {type:"objectex1", header:[
//         {type:"token", value:"…CharacterSkillEntry"},
//         [typeID, trainedSkillLevel, trainedSkillPoints, skillRank, virtualLevel],
//         {type:"dict", entries:[["itemID",…],["ownerID",…],["locationID",…],
//            ["flagID",…],["groupID",…],["categoryID",…],["groupName",…],
//            ["published",bool],["inTraining",bool]]}],
//       list:[], dict:[]}
//  GetAttributes: {type:"dict", entries:[[164,20],[165,20],[166,20],[167,20],
//    [168,20]]}  (attributeID → points; 164=cha 165=int 166=mem 167=per 168=wil)
//  GetSkillPoints: a BARE number, the total SP (Farmer 641792000). ⚠ BIGINT: a
//    maxed character exceeds 2^53 — kept as an EXACT decimal string, never Number.
//  GetFreeSkillPoints: a BARE number (Farmer 0). Kept exact.
//  GetDiminishedSpFromInjectors(typeID,qty,nonDim): a BARE number (0 for a
//    non-injector typeID). Kept exact.
//  GetSkillHistory: {type:"list", items:[utillib.KeyVal{logDate:long FILETIME,
//    eventTypeID, skillTypeID, absolutePoints, level}, …]} (empty for Farmer).
//  GetSkillChangesForISIS: a BARE ARRAY of [skillTypeID, spChange] 2-tuples.
//  GetRespecInfo: util.KeyVal{freeRespecs, lastRespecDate, nextTimedRespec}
//    (the dates are long FILETIMEs or null — null for Farmer).
//  GetBoosters / GetImplants: {type:"dict", entries:[[slot, KeyVal], …]} (both
//    EMPTY for Farmer and GM Elysian — a legitimate "none" state).
//  GetSkillQueue: {type:"list", items:[utillib.KeyVal{trainingStartSP,
//    queuePosition, trainingTypeID, trainingDestinationSP, trainingEndTime:long,
//    trainingStartTime:long, trainingToLevel}, …]} — populated shape captured
//    LIVE on GM Elysian (Gunnery 3300 → V); EMPTY for Farmer.
//  CheckInjectionConstraints(itemID,qty): returns null on success, but with no
//    owned injector REFUSES (CALL_REFUSED "SkillTradingItemNotFound") — the
//    legitimate empty state for a character holding no injector.
//
// ⚠ TWO KeyVal CLASS NAMES ON THIS WIRE. buildKeyVal-made rows come across as
// "utillib.KeyVal" (queue entries, history rows) while the hand-built
// GetRespecInfo is "util.KeyVal". The shared wire.ts readKeyVal only accepts
// "util.KeyVal", so a util.KeyVal-only reader would silently drop every queue
// field. The local readObjectDict below is NAME-AGNOSTIC on purpose.

import { unwrapLong, type JsonValue } from "./wire.ts";

// --- local coercions (do NOT import from market*.ts — separate session) -----

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/**
 * The inner {type:"dict", entries} of a KeyVal-family object, whatever its class
 * name (util.KeyVal / utillib.KeyVal), or a bare dict passed straight through.
 * `null` when the value is neither.
 */
function readObjectDict(value: JsonValue | undefined): { entries: readonly JsonValue[] } | null {
  const obj = asObject(value);
  if (obj.type === "dict" && Array.isArray(obj.entries)) {
    return { entries: obj.entries as readonly JsonValue[] };
  }
  if (obj.type === "object") {
    const args = asObject(obj.args);
    if (args.type === "dict" && Array.isArray(args.entries)) {
      return { entries: args.entries as readonly JsonValue[] };
    }
  }
  return null;
}

/** One key from a KeyVal-family object or bare dict; undefined when absent. */
function readField(value: JsonValue | undefined, key: string): JsonValue | undefined {
  const dict = readObjectDict(value);
  if (!dict) {
    return undefined;
  }
  const entry = dict.entries.find(
    (row) => Array.isArray(row) && (row as readonly JsonValue[])[0] === key,
  );
  return Array.isArray(entry) ? (entry as readonly JsonValue[])[1] : undefined;
}

/**
 * An EXACT integer as a decimal string — SP counts and FILETIMEs, which exceed
 * 2^53 and must never pass through Number. Accepts a bare integer, a
 * {type:"long"} wrapper (number or decimal-string), or a bare decimal string.
 * `null` for anything else (including a genuinely absent/null field).
 */
export function exactInt(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long.toString();
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  return null;
}

/** A small structural integer (level, rank, position) as a Number, else fallback. */
function smallInt(value: JsonValue | undefined, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

/**
 * A positive game id as a Number when it is a safe integer, else its exact
 * decimal string (R7d — data, never coerced into a label, never truncated).
 * `null` when absent.
 */
export function idData(value: JsonValue | undefined): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long <= BigInt(Number.MAX_SAFE_INTEGER) && long >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(long)
      : long.toString();
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  return null;
}

function asBool(value: JsonValue | undefined): boolean {
  return value === true;
}

function asText(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

// --- GetSkills / GetAllSkills ----------------------------------------------

/** One CharacterSkillEntry. SP kept exact (bigint-safe); ids kept as data. */
export interface BoundSkillRow {
  readonly typeID: number;
  /** null when the server carried no trained level (never coerced to 0). */
  readonly trainedSkillLevel: number | null;
  /** ⚠ EXACT decimal string (bigint-safe), never a JS number. */
  readonly skillPoints: string | null;
  readonly skillRank: number;
  readonly virtualSkillLevel: number | null;
  readonly itemID: number | string | null;
  readonly ownerID: number | string | null;
  readonly locationID: number | string | null;
  readonly flagID: number | null;
  readonly groupID: number | null;
  readonly categoryID: number | null;
  readonly groupName: string;
  readonly published: boolean;
  readonly inTraining: boolean;
}

function decodeSkillEntry(
  typeIDKey: JsonValue | undefined,
  value: JsonValue | undefined,
): BoundSkillRow | null {
  const obj = asObject(value);
  const header = Array.isArray(obj.header) ? (obj.header as readonly JsonValue[]) : [];
  const positional = Array.isArray(header[1]) ? (header[1] as readonly JsonValue[]) : [];
  const meta = header[2];
  const typeID = smallInt(positional[0] ?? typeIDKey, 0);
  if (typeID <= 0) {
    return null;
  }
  const optLevel = (v: JsonValue | undefined): number | null =>
    v === null || v === undefined ? null : smallInt(v, 0);
  const optId = (v: JsonValue | undefined): number | null =>
    v === null || v === undefined ? null : smallInt(v, 0);
  return {
    typeID,
    trainedSkillLevel: optLevel(positional[1]),
    skillPoints: exactInt(positional[2]),
    skillRank: Math.max(1, smallInt(positional[3], 1)),
    virtualSkillLevel: optLevel(positional[4]),
    itemID: idData(readField(meta, "itemID")),
    ownerID: idData(readField(meta, "ownerID")),
    locationID: idData(readField(meta, "locationID")),
    flagID: optId(readField(meta, "flagID")),
    groupID: optId(readField(meta, "groupID")),
    categoryID: optId(readField(meta, "categoryID")),
    groupName: asText(readField(meta, "groupName")),
    published: asBool(readField(meta, "published")),
    inTraining: asBool(readField(meta, "inTraining")),
  };
}

/** Decode GetSkills / GetAllSkills (identical): the character's whole skill sheet. */
export function decodeSkills(result: JsonValue | undefined): readonly BoundSkillRow[] {
  const dict = asObject(result);
  const entries = dict.type === "dict" && Array.isArray(dict.entries)
    ? (dict.entries as readonly JsonValue[])
    : [];
  const rows: BoundSkillRow[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const row = decodeSkillEntry((entry as readonly JsonValue[])[0], (entry as readonly JsonValue[])[1]);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

// --- GetAttributes ----------------------------------------------------------

/** attributeID → points. 164=charisma 165=intelligence 166=memory 167=perception 168=willpower. */
export interface BoundAttribute {
  readonly attributeID: number;
  readonly points: number;
}

export function decodeAttributes(result: JsonValue | undefined): readonly BoundAttribute[] {
  const dict = asObject(result);
  const entries = dict.type === "dict" && Array.isArray(dict.entries)
    ? (dict.entries as readonly JsonValue[])
    : [];
  const out: BoundAttribute[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const attributeID = smallInt((entry as readonly JsonValue[])[0], 0);
    if (attributeID <= 0) {
      continue;
    }
    out.push({ attributeID, points: smallInt((entry as readonly JsonValue[])[1], 0) });
  }
  return out;
}

// --- Scalar SP reads (bigint-safe) ------------------------------------------

/** GetSkillPoints — the total SP, EXACT (a maxed char exceeds 2^53). */
export function decodeSkillPoints(result: JsonValue | undefined): string | null {
  return exactInt(result);
}

/** GetFreeSkillPoints — unallocated SP, EXACT. */
export function decodeFreeSkillPoints(result: JsonValue | undefined): string | null {
  return exactInt(result);
}

/** GetDiminishedSpFromInjectors — the SP an injection would grant, EXACT. */
export function decodeDiminishedSp(result: JsonValue | undefined): string | null {
  return exactInt(result);
}

// --- GetSkillHistory --------------------------------------------------------

export interface BoundSkillHistoryRow {
  /** ⚠ EXACT FILETIME decimal string (100ns ticks since 1601), or null. */
  readonly logDate: string | null;
  readonly eventTypeID: number;
  readonly skillTypeID: number;
  /** ⚠ EXACT decimal string (SP), never a JS number. */
  readonly absolutePoints: string | null;
  readonly level: number;
}

export function decodeSkillHistory(result: JsonValue | undefined): readonly BoundSkillHistoryRow[] {
  const obj = asObject(result);
  const items = obj.type === "list" && Array.isArray(obj.items)
    ? (obj.items as readonly JsonValue[])
    : [];
  return items.map((row) => ({
    logDate: exactInt(readField(row, "logDate")),
    eventTypeID: smallInt(readField(row, "eventTypeID"), 0),
    skillTypeID: smallInt(readField(row, "skillTypeID"), 0),
    absolutePoints: exactInt(readField(row, "absolutePoints")),
    level: smallInt(readField(row, "level"), 0),
  }));
}

// --- GetSkillChangesForISIS -------------------------------------------------

/** One [skillTypeID, spChange] pair, SP kept exact. */
export interface BoundSkillChange {
  readonly typeID: number;
  readonly skillPoints: string | null;
}

export function decodeSkillChangesForISIS(result: JsonValue | undefined): readonly BoundSkillChange[] {
  const pairs = Array.isArray(result) ? (result as readonly JsonValue[]) : [];
  const out: BoundSkillChange[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair)) {
      continue;
    }
    const typeID = smallInt((pair as readonly JsonValue[])[0], 0);
    if (typeID <= 0) {
      continue;
    }
    out.push({ typeID, skillPoints: exactInt((pair as readonly JsonValue[])[1]) });
  }
  return out;
}

// --- GetRespecInfo ----------------------------------------------------------

export interface BoundRespecInfo {
  readonly freeRespecs: number;
  /** ⚠ EXACT FILETIME decimal string, or null when never respecced. */
  readonly lastRespecDate: string | null;
  readonly nextTimedRespec: string | null;
}

export function decodeRespecInfo(result: JsonValue | undefined): BoundRespecInfo {
  return {
    freeRespecs: smallInt(readField(result, "freeRespecs"), 0),
    lastRespecDate: exactInt(readField(result, "lastRespecDate")),
    nextTimedRespec: exactInt(readField(result, "nextTimedRespec")),
  };
}

// --- GetBoosters / GetImplants ----------------------------------------------
// slot → KeyVal of arbitrary implant/booster fields. EMPTY live for both test
// characters (a legitimate "none" state). The per-field set is not fixed, so the
// decoded record carries whatever fields the KeyVal held, losslessly (R7d).

export interface BoundSlotItem {
  readonly slot: number;
  readonly fields: Readonly<Record<string, JsonValue>>;
}

function decodeSlotDict(result: JsonValue | undefined): readonly BoundSlotItem[] {
  const dict = asObject(result);
  const entries = dict.type === "dict" && Array.isArray(dict.entries)
    ? (dict.entries as readonly JsonValue[])
    : [];
  const out: BoundSlotItem[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const slot = smallInt((entry as readonly JsonValue[])[0], 0);
    const inner = readObjectDict((entry as readonly JsonValue[])[1]);
    const fields: Record<string, JsonValue> = {};
    if (inner) {
      for (const row of inner.entries) {
        if (Array.isArray(row) && typeof (row as readonly JsonValue[])[0] === "string") {
          fields[(row as readonly JsonValue[])[0] as string] = (row as readonly JsonValue[])[1] as JsonValue;
        }
      }
    }
    out.push({ slot, fields });
  }
  return out;
}

/** Decode GetBoosters — active boosters by slot (empty when none). */
export function decodeBoosters(result: JsonValue | undefined): readonly BoundSlotItem[] {
  return decodeSlotDict(result);
}

/** Decode GetImplants — active implants by slot (empty when none). */
export function decodeImplants(result: JsonValue | undefined): readonly BoundSlotItem[] {
  return decodeSlotDict(result);
}

// --- GetSkillQueue ----------------------------------------------------------

export interface BoundQueueEntry {
  readonly queuePosition: number;
  readonly trainingTypeID: number;
  readonly trainingToLevel: number;
  /** ⚠ EXACT decimal strings (SP), never JS numbers. */
  readonly trainingStartSP: string | null;
  readonly trainingDestinationSP: string | null;
  /** ⚠ EXACT FILETIME decimal strings (100ns since 1601), or null. */
  readonly trainingStartTime: string | null;
  readonly trainingEndTime: string | null;
}

/** Decode GetSkillQueue — the training queue in order (empty when not training). */
export function decodeSkillQueue(result: JsonValue | undefined): readonly BoundQueueEntry[] {
  const obj = asObject(result);
  const items = obj.type === "list" && Array.isArray(obj.items)
    ? (obj.items as readonly JsonValue[])
    : [];
  return items.map((row) => ({
    queuePosition: smallInt(readField(row, "queuePosition"), 0),
    trainingTypeID: smallInt(readField(row, "trainingTypeID"), 0),
    trainingToLevel: smallInt(readField(row, "trainingToLevel"), 0),
    trainingStartSP: exactInt(readField(row, "trainingStartSP")),
    trainingDestinationSP: exactInt(readField(row, "trainingDestinationSP")),
    trainingStartTime: exactInt(readField(row, "trainingStartTime")),
    trainingEndTime: exactInt(readField(row, "trainingEndTime")),
  }));
}

// --- The whole GET /api/bridge/bound-skills envelope ------------------------
//
// The BFF issues all 13 reads independently (Promise.allSettled) and returns
// each as `{result}` on success or `{error: <code>}` on failure/refusal — an
// empty booster list or a refused CheckInjectionConstraints (no injector owned)
// is a legitimate state, not a blanking failure. This decoder folds that
// envelope into typed data, carrying each read's error through as a string.

export interface BoundSkillsResult<T> {
  readonly value: T;
  /** The failure/refusal code when the read did not succeed, else null. */
  readonly error: string | null;
}

export interface BoundSkills {
  readonly skills: BoundSkillsResult<readonly BoundSkillRow[]>;
  readonly allSkills: BoundSkillsResult<readonly BoundSkillRow[]>;
  readonly attributes: BoundSkillsResult<readonly BoundAttribute[]>;
  readonly skillHistory: BoundSkillsResult<readonly BoundSkillHistoryRow[]>;
  readonly skillChangesForISIS: BoundSkillsResult<readonly BoundSkillChange[]>;
  readonly respecInfo: BoundSkillsResult<BoundRespecInfo | null>;
  readonly freeSkillPoints: BoundSkillsResult<string | null>;
  readonly boosters: BoundSkillsResult<readonly BoundSlotItem[]>;
  readonly implants: BoundSkillsResult<readonly BoundSlotItem[]>;
  readonly injectionConstraints: BoundSkillsResult<null>;
  readonly skillPoints: BoundSkillsResult<string | null>;
  readonly diminishedSp: BoundSkillsResult<string | null>;
  readonly skillQueue: BoundSkillsResult<readonly BoundQueueEntry[]>;
}

function pick(envelope: Record<string, JsonValue>, key: string): { result: JsonValue | undefined; error: string | null } {
  const cell = asObject(envelope[key]);
  const error = typeof cell.error === "string" && cell.error.length > 0 ? cell.error : null;
  return { result: cell.result, error };
}

/** Decode the /api/bridge/bound-skills envelope. */
export function decodeBoundSkills(raw: JsonValue | null | undefined): BoundSkills {
  const reads = asObject(asObject(raw).reads);
  const map = <T>(key: string, decode: (r: JsonValue | undefined) => T): BoundSkillsResult<T> => {
    const { result, error } = pick(reads, key);
    return { value: decode(result), error };
  };
  return {
    skills: map("GetSkills", decodeSkills),
    allSkills: map("GetAllSkills", decodeSkills),
    attributes: map("GetAttributes", decodeAttributes),
    skillHistory: map("GetSkillHistory", decodeSkillHistory),
    skillChangesForISIS: map("GetSkillChangesForISIS", decodeSkillChangesForISIS),
    respecInfo: map("GetRespecInfo", (r) => (r === undefined ? null : decodeRespecInfo(r))),
    freeSkillPoints: map("GetFreeSkillPoints", decodeFreeSkillPoints),
    boosters: map("GetBoosters", decodeBoosters),
    implants: map("GetImplants", decodeImplants),
    injectionConstraints: map("CheckInjectionConstraints", () => null),
    skillPoints: map("GetSkillPoints", decodeSkillPoints),
    diminishedSp: map("GetDiminishedSpFromInjectors", decodeDiminishedSp),
    skillQueue: map("GetSkillQueue", decodeSkillQueue),
  };
}
