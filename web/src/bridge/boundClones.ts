// R76 — the 6 RB-CLONE BOUND reads, decoded from real captured bytes
// (PLUMBING ONLY — no UI, no writes).
//
// These are the raw retail jump-clone reads on service "jumpCloneSvc". machoNet
// keys "jumpCloneSvc" as null (session-global, NOT station-keyed) exactly like
// R73's "skillHandler", so although JumpCloneService also defines MachoBindObject
// these reads ride the ORDINARY top-level /call seam — the BFF dispatches each as
// heldTopLevelCall("jumpCloneSvc", <method>), NOT the bound two-step. Every handler
// takes (args, session) and forwards ONLY session to jumpCloneRuntime; the caller's
// args are DROPPED server-side and the location filter is the SESSION's own docked
// location. Verified LIVE cross-account (Farmer 140000005 vs Test Two 140000002):
// injecting a foreign station/char id returns Farmer's OWN clone state, never Test
// Two's — the ValidateInstallJumpClone discriminator is decisive (Farmer's session
// returns [] "install allowed" while Test Two's own returns a skill-req error list;
// a foreign-station inject on Farmer still returns [], so the result is session-
// derived, not arg-steered). Clones/implants are PRIVATE.
//
// ---------------------------------------------------------------------------
// WIRE SHAPES (captured LIVE 2026-07-22, Farmer 140000005 unless noted):
//
//  GetCloneState: {type:"object", name:"util.KeyVal", args:{type:"dict", entries:[
//    ["clones",  Rowset(header/columns=[jumpCloneID,locationID,cloneName])],
//    ["implants", Rowset(header/columns=[jumpCloneID,typeID])],
//    ["timeLastJump", {type:"long", value:"0"}]]}}
//    Each Rowset is eve.common.script.sys.rowset.Rowset {header,columns,RowClass:
//    util.Row, lines:{type:"list", items:[…]}}. Farmer + Test Two both carry EMPTY
//    lines (a legitimate "no jump clones" state); the server's buildCloneRows maps
//    each clone to a BARE-ARRAY line [jumpCloneID, locationID, cloneName] (implants
//    [jumpCloneID, typeID]) — read through wire.readRowsetRows, which handles bare-
//    array AND util.Row-wrapped lines.
//  GetStationCloneState: a bare Rowset(header/columns=[jumpCloneID,locationID,
//    cloneName]) — own clones at the SESSION's docked location (empty for Farmer).
//  GetShipCloneState: a bare Rowset(header/columns=[jumpCloneID,ownerID,locationID])
//    — own clones in the session's active ship (empty for Farmer).
//  GetNumClonesInPilotsStructure: a BARE number (0 for Farmer) — count of own
//    clones at the session structure/ship.
//  GetPriceForClone: a BARE number (Farmer 900000) — the current docked location's
//    clone-bay fee. ⚠ ISK: kept as an EXACT decimal string (bigint-safe), never
//    forced through a lossy path.
//  ValidateInstallJumpClone: a BARE ARRAY of error entries — [] means install is
//    allowed (Farmer). Each entry is EITHER a bare label string OR a
//    [label, paramsObject] 2-tuple; captured populated LIVE on Test Two (unskilled,
//    clone limit 0): ["UI/Medical/JumpCloneSkillReqNotMet",
//    ["UI/Medical/JumpCloneUsageAndCapacity", {count:0, limit:0}]]. The params ride
//    the wire as a PLAIN object (no {type:"dict"} wrapper).
//
// This module decodes the raw marshaled reads for GET /api/bridge/bound-clones; NO
// UI consumes it yet.

import { readRowsetRows, unwrapLong, type JsonValue } from "./wire.ts";

// --- local coercions (do NOT import from market*.ts — separate session) -----

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/**
 * An EXACT integer as a decimal string — FILETIMEs and ISK, which can exceed 2^53
 * and must never pass through Number. Accepts a bare integer, a {type:"long"}
 * wrapper (number or decimal-string), or a bare decimal string. `null` for a
 * genuinely absent/null field.
 */
function exactInt(value: JsonValue | undefined): string | null {
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

/**
 * An ISK amount as an EXACT string (bigint-safe). Integer amounts go through the
 * exact-long path; a fractional fee (a structure clone-bay tax can be non-integer)
 * is preserved via its own String() rather than dropped. `null` when absent.
 */
function iskExact(value: JsonValue | undefined): string | null {
  const exact = exactInt(value);
  if (exact !== null) {
    return exact;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * A positive game id as a Number when it is a safe integer, else its exact decimal
 * string (R7d — data, never coerced into a label, never truncated). `null` when
 * absent.
 */
function idData(value: JsonValue | undefined): number | string | null {
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

/** A small structural integer (a count) as a Number, else fallback. */
function smallInt(value: JsonValue | undefined, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function asText(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** The dict entries of a util.KeyVal / bare dict; [] when neither. */
function keyValEntries(value: JsonValue | undefined): readonly JsonValue[] {
  const obj = asObject(value);
  if (obj.type === "object") {
    const args = asObject(obj.args);
    if (args.type === "dict" && Array.isArray(args.entries)) {
      return args.entries as readonly JsonValue[];
    }
  }
  if (obj.type === "dict" && Array.isArray(obj.entries)) {
    return obj.entries as readonly JsonValue[];
  }
  return [];
}

/** One key from a util.KeyVal / bare dict; undefined when absent. */
function keyValField(value: JsonValue | undefined, key: string): JsonValue | undefined {
  const entry = keyValEntries(value).find(
    (row) => Array.isArray(row) && (row as readonly JsonValue[])[0] === key,
  );
  return Array.isArray(entry) ? (entry as readonly JsonValue[])[1] : undefined;
}

// --- GetCloneState ----------------------------------------------------------

/** One jump clone (from the clones Rowset). ids kept as data (R7d). */
export interface BoundClone {
  readonly jumpCloneID: number | string | null;
  readonly locationID: number | string | null;
  readonly cloneName: string;
}

/** One active-body implant (from the implants Rowset). */
export interface BoundCloneImplant {
  readonly jumpCloneID: number | string | null;
  readonly typeID: number | string | null;
}

export interface BoundCloneState {
  readonly clones: readonly BoundClone[];
  readonly implants: readonly BoundCloneImplant[];
  /** ⚠ EXACT FILETIME decimal string (100ns ticks since 1601), or null. */
  readonly timeLastJump: string | null;
}

function decodeCloneRows(rowset: JsonValue | undefined): readonly BoundClone[] {
  return readRowsetRows(rowset).map((row) => ({
    jumpCloneID: idData(row.jumpCloneID),
    locationID: idData(row.locationID),
    cloneName: asText(row.cloneName),
  }));
}

/** Decode GetCloneState — the whole clone sheet (clones + implants + last-jump). */
export function decodeCloneState(result: JsonValue | undefined): BoundCloneState {
  return {
    clones: decodeCloneRows(keyValField(result, "clones")),
    implants: readRowsetRows(keyValField(result, "implants")).map((row) => ({
      jumpCloneID: idData(row.jumpCloneID),
      typeID: idData(row.typeID),
    })),
    timeLastJump: exactInt(keyValField(result, "timeLastJump")),
  };
}

// --- GetStationCloneState ---------------------------------------------------

/** Decode GetStationCloneState — own clones at the session's docked location. */
export function decodeStationCloneState(result: JsonValue | undefined): readonly BoundClone[] {
  return decodeCloneRows(result);
}

// --- GetShipCloneState ------------------------------------------------------

/** One clone installed in a ship (from the ship-clone Rowset). */
export interface BoundShipClone {
  readonly jumpCloneID: number | string | null;
  readonly ownerID: number | string | null;
  readonly locationID: number | string | null;
}

/** Decode GetShipCloneState — own clones in the session's active ship. */
export function decodeShipCloneState(result: JsonValue | undefined): readonly BoundShipClone[] {
  return readRowsetRows(result).map((row) => ({
    jumpCloneID: idData(row.jumpCloneID),
    ownerID: idData(row.ownerID),
    locationID: idData(row.locationID),
  }));
}

// --- GetNumClonesInPilotsStructure ------------------------------------------

/** Decode GetNumClonesInPilotsStructure — a bare count (0 when none). */
export function decodeNumClonesInStructure(result: JsonValue | undefined): number {
  return smallInt(result, 0);
}

// --- GetPriceForClone -------------------------------------------------------

/** Decode GetPriceForClone — the clone-bay install fee, EXACT ISK string. */
export function decodePriceForClone(result: JsonValue | undefined): string | null {
  return iskExact(result);
}

// --- ValidateInstallJumpClone -----------------------------------------------

/** One validation error: a localization label + optional substitution params. */
export interface BoundCloneValidationError {
  readonly label: string;
  /** The label's substitution params (e.g. {count, limit}) or null. */
  readonly params: Readonly<Record<string, JsonValue>> | null;
}

export interface BoundCloneValidation {
  /** True when the error list is empty — an install is allowed. */
  readonly allowed: boolean;
  readonly errors: readonly BoundCloneValidationError[];
}

function decodeValidationParams(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null {
  const obj = asObject(value);
  // The wire carries params as a PLAIN object; tolerate a {type:"dict"} wrapper too.
  if (obj.type === "dict" && Array.isArray(obj.entries)) {
    const out: Record<string, JsonValue> = {};
    for (const entry of obj.entries as readonly JsonValue[]) {
      if (Array.isArray(entry) && typeof (entry as readonly JsonValue[])[0] === "string") {
        out[(entry as readonly JsonValue[])[0] as string] = (entry as readonly JsonValue[])[1] as JsonValue;
      }
    }
    return out;
  }
  const keys = Object.keys(obj);
  return keys.length > 0 ? obj : null;
}

/** Decode ValidateInstallJumpClone — [] = install allowed; else labeled errors. */
export function decodeValidateInstall(result: JsonValue | undefined): BoundCloneValidation {
  const entries = Array.isArray(result) ? (result as readonly JsonValue[]) : [];
  const errors: BoundCloneValidationError[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      errors.push({ label: entry, params: null });
      continue;
    }
    if (Array.isArray(entry)) {
      const tuple = entry as readonly JsonValue[];
      const label = typeof tuple[0] === "string" ? (tuple[0] as string) : "";
      if (label) {
        errors.push({ label, params: decodeValidationParams(tuple[1]) });
      }
    }
  }
  return { allowed: errors.length === 0, errors };
}

// --- The whole GET /api/bridge/bound-clones envelope ------------------------
//
// The BFF issues all 6 reads independently (Promise.allSettled) and returns each
// as `{result}` on success or `{error: <code>}` on failure — an empty clone list,
// a 0 structure count and an empty validator array are all legitimate states, not
// a blanking failure. This decoder folds that envelope into typed data, carrying
// each read's error through as a string.

export interface BoundClonesResult<T> {
  readonly value: T;
  /** The failure code when the read did not succeed, else null. */
  readonly error: string | null;
}

export interface BoundClones {
  readonly cloneState: BoundClonesResult<BoundCloneState>;
  readonly stationClones: BoundClonesResult<readonly BoundClone[]>;
  readonly shipClones: BoundClonesResult<readonly BoundShipClone[]>;
  readonly numClonesInStructure: BoundClonesResult<number>;
  readonly priceForClone: BoundClonesResult<string | null>;
  readonly installValidation: BoundClonesResult<BoundCloneValidation>;
}

function pick(reads: Record<string, JsonValue>, key: string): { result: JsonValue | undefined; error: string | null } {
  const cell = asObject(reads[key]);
  const error = typeof cell.error === "string" && cell.error.length > 0 ? cell.error : null;
  return { result: cell.result, error };
}

/** Decode the /api/bridge/bound-clones envelope. */
export function decodeBoundClones(raw: JsonValue | null | undefined): BoundClones {
  const reads = asObject(asObject(raw).reads);
  const map = <T>(key: string, decode: (r: JsonValue | undefined) => T): BoundClonesResult<T> => {
    const { result, error } = pick(reads, key);
    return { value: decode(result), error };
  };
  return {
    cloneState: map("GetCloneState", decodeCloneState),
    stationClones: map("GetStationCloneState", decodeStationCloneState),
    shipClones: map("GetShipCloneState", decodeShipCloneState),
    numClonesInStructure: map("GetNumClonesInPilotsStructure", decodeNumClonesInStructure),
    priceForClone: map("GetPriceForClone", decodePriceForClone),
    installValidation: map("ValidateInstallJumpClone", decodeValidateInstall),
  };
}
