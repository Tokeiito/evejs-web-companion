// R77 — the 7 RB-PI (planetary-industry) BOUND reads, decoded from real captured
// bytes (PLUMBING ONLY — no UI, no writes).
//
// These are the raw retail planetMgr reads addressed on Moniker("planetMgr",
// planetID) (eveMoniker.GetPlanet). Unlike R73's skillHandler / R76's jumpCloneSvc
// (session-global monikers on the top-level /call seam), planetMgr defines
// MachoBindObject, so these ride the REAL bound two-step: the BFF binds
// planetMgr.MachoBindObject(planetID) and dispatches each read as a bound method
// (GET /api/bridge/bound-planet). Six of the seven also accept the planetID in
// args; the two that do NOT (GetResourceData, GetProgramResultInfo) recover it from
// the bind that MachoBindObject establishes (session._planetMgrLastPlanetID).
//
// ⚠ OWNERSHIP (verified LIVE cross-account, Farmer 140000005 owns colony planetID
// 40009077 vs Test Two 140000002). GetPlanetInfo (colony body scoped to
// session.characterID — Test Two saw the planet geography with NO colony body),
// GetPlanetResourceInfo / GetResourceData (static per-planet resource geography) and
// GetProgramResultInfo (a computed extractor-yield estimate) read no foreign colony.
// But GetFullNetworkForOwner(planetID, ownerID) returned FARMER's full 4-pin network
// to a Test Two session, and GetCommandPinsForPlanet / GetExtractorsForPlanet
// returned Farmer's command pin / extractor (owner 140000005) — an arg-injection
// LEAK, kept plumbed and flagged in docs/arg-injection-leak-handoff.md (operator
// flag-only). The BFF route defaults ownerID to the session's own char, so THIS
// route reads only the caller's own colony; the leak is the /api/bridge/call vector.
//
// ---------------------------------------------------------------------------
// WIRE SHAPES (captured LIVE 2026-07-22, Farmer 140000005 colony 40009077):
//
//  GetPlanetInfo(planetID): util.KeyVal{planetID, solarSystemID, planetTypeID,
//    radius, celestialIndex, [ownerID, pins(list of pin KeyVal), links(list of
//    LINK KeyVal{typeID,endpoint1,endpoint2,level}), routes(list of route KeyVal),
//    level, currentSimTime(bare-string FILETIME)]}. The bracketed keys appear ONLY
//    when the SESSION char owns a colony there; absent otherwise (a real "no colony"
//    state — Test Two saw only the first five geography keys).
//  A pin KeyVal (buildPinRow): {id(pinID), latitude, longitude, ownerID,
//    lastRunTime(bare-string FILETIME), typeID, contents(dict typeID->qty), state,
//    +conditional by entity type} — command/spaceport add lastLaunchTime(FILETIME);
//    process adds schematicID(id|null), hasReceivedInputs(bool),
//    receivedInputsLastCycle(bool); ecu adds cycleTime, programType(id), qtyPerCycle,
//    expiryTime(FILETIME), installTime(FILETIME), headRadius(double),
//    heads(list of bare [headID, latitude, longitude] tuples). NB cycleTime/qtyPerCycle
//    arrive as plain NUMBERS; the FILETIMEs (lastRunTime/lastLaunchTime/expiry/install/
//    currentSimTime) arrive as BARE DECIMAL STRINGS — both handled bigint-safe.
//  GetPlanetResourceInfo(planetID): a CachedMethodCallResult
//    {name:rawstr "carbon…CachedMethodCallResult", args:[<versionCheck dict>,
//    {type:"substream", value:{type:"dict", entries:[[resourceTypeID, quality], …]}},
//    <cache-version tuple>]}. The payload is the SUBSTREAM's dict (Farmer:
//    {2073:73, 2267:53, 2268:102, 2270:81, 2288:130}).
//  GetResourceData({resourceTypeID,oldBand,newBand,proximity}): util.KeyVal{
//    data({type:"bytes", value:{type:"Buffer", data:[…]}} — Farmer 900 bytes),
//    numBands(15), proximity(0)}. Static per-planet resource distribution bytes.
//  GetFullNetworkForOwner(planetID, ownerID): a 2-tuple ARRAY [pins, links] where
//    pins is a list of pin KeyVals (same shape as above) and links is a list of
//    BARE 2-tuples [endpoint1, endpoint2] (NOT the KeyVal link of GetPlanetInfo).
//  GetCommandPinsForPlanet(planetID): {type:"dict", entries:[[ownerID, KeyVal{pinID,
//    id, typeID, ownerID, latitude, longitude}], …]} across ALL owners on the planet.
//  GetExtractorsForPlanet(planetID): {type:"list", items:[KeyVal{pinID, id, typeID,
//    ownerID, latitude, longitude}, …]} across ALL owners.
//  GetProgramResultInfo(planetID-via-bind, resourceTypeID, heads, headRadius): a
//    3-tuple ARRAY [qtyToDistribute, cycleTime, numCycles] (Farmer [1, 144000000000,
//    84]). cycleTime is large → bigint-safe.
//
// This module decodes the raw marshaled reads for GET /api/bridge/bound-planet; NO
// UI consumes it yet. ids stay data (R7d); FILETIMEs / cycle-times / quantities are
// bigint-safe (never truncated through Number). LOCAL coercions only — nothing is
// imported from market*.ts (a separate session owns those).

import { unwrapLong, type JsonValue } from "./wire.ts";

// --- local coercions (do NOT import from market*.ts — separate session) -----

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/**
 * An EXACT integer as a decimal string — FILETIMEs, cycle-times and quantities,
 * which can exceed 2^53 and must never pass through Number. Accepts a bare integer,
 * a {type:"long"} wrapper (number or decimal-string), or a bare decimal string.
 * `null` for a genuinely absent/null field.
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
  // A BARE decimal string (a contents-dict typeID key, or an id the gateway emitted
  // as a bigint string): a Number when it is safely in range, else the exact string
  // (never truncated). Keeps typeIDs uniform whether they arrived as a number or a
  // dict key string.
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const asBig = BigInt(value);
    return asBig <= BigInt(Number.MAX_SAFE_INTEGER) && asBig >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(asBig)
      : value;
  }
  return null;
}

/** A small structural integer (a count / band / level) as a Number, else fallback. */
function smallInt(value: JsonValue | undefined, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

/** A double (latitude / longitude / radius), else fallback. */
function asReal(value: JsonValue | undefined, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/** A boolean; null when the field is absent (distinguish "false" from "not present"). */
function asBoolOrNull(value: JsonValue | undefined): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return value === undefined ? null : Boolean(value);
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

/** Whether a util.KeyVal / bare dict carries a key at all (present-but-null aware). */
function hasKey(value: JsonValue | undefined, key: string): boolean {
  return keyValEntries(value).some(
    (row) => Array.isArray(row) && (row as readonly JsonValue[])[0] === key,
  );
}

/** The items of a marshaled list ({type:"list", items:[…]}); [] when not a list. */
function listItems(value: JsonValue | undefined): readonly JsonValue[] {
  const obj = asObject(value);
  return obj.type === "list" && Array.isArray(obj.items)
    ? (obj.items as readonly JsonValue[])
    : [];
}

// --- shared pin / link / route decoders -------------------------------------

/** One extractor head — a bare [headID, latitude, longitude] tuple. */
export interface ColonyPinHead {
  readonly headID: number | string | null;
  readonly latitude: number;
  readonly longitude: number;
}

/** One item in a pin's cargo (contents dict typeID -> quantity). qty bigint-safe. */
export interface ColonyPinContent {
  readonly typeID: number | string | null;
  readonly quantity: string | null;
}

/**
 * One colony pin (buildPinRow) — the base fields plus whatever conditional fields
 * its entity type carried. Absent conditionals are null / [] (never invented).
 */
export interface ColonyPin {
  readonly id: number | string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly ownerID: number | string | null;
  /** ⚠ EXACT FILETIME decimal string (100ns ticks since 1601), or null. */
  readonly lastRunTime: string | null;
  readonly typeID: number | string | null;
  readonly contents: readonly ColonyPinContent[];
  readonly state: number;
  // command / spaceport
  readonly lastLaunchTime: string | null;
  // process (factory)
  readonly schematicID: number | string | null;
  readonly hasReceivedInputs: boolean | null;
  readonly receivedInputsLastCycle: boolean | null;
  // ecu (extractor control unit)
  readonly cycleTime: string | null;
  readonly programType: number | string | null;
  readonly qtyPerCycle: string | null;
  readonly expiryTime: string | null;
  readonly installTime: string | null;
  readonly headRadius: number | null;
  readonly heads: readonly ColonyPinHead[];
}

function decodeContents(value: JsonValue | undefined): readonly ColonyPinContent[] {
  const obj = asObject(value);
  const entries = obj.type === "dict" && Array.isArray(obj.entries)
    ? (obj.entries as readonly JsonValue[])
    : [];
  const out: ColonyPinContent[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const pair = entry as readonly JsonValue[];
      out.push({ typeID: idData(pair[0]), quantity: exactInt(pair[1]) });
    }
  }
  return out;
}

function decodeHeads(value: JsonValue | undefined): readonly ColonyPinHead[] {
  return listItems(value).map((head) => {
    const cells = Array.isArray(head) ? (head as readonly JsonValue[]) : listItems(head);
    return {
      headID: idData(cells[0]),
      latitude: asReal(cells[1]),
      longitude: asReal(cells[2]),
    };
  });
}

function decodePin(value: JsonValue | undefined): ColonyPin {
  return {
    id: idData(keyValField(value, "id")),
    latitude: asReal(keyValField(value, "latitude")),
    longitude: asReal(keyValField(value, "longitude")),
    ownerID: idData(keyValField(value, "ownerID")),
    lastRunTime: exactInt(keyValField(value, "lastRunTime")),
    typeID: idData(keyValField(value, "typeID")),
    contents: decodeContents(keyValField(value, "contents")),
    state: smallInt(keyValField(value, "state")),
    lastLaunchTime: exactInt(keyValField(value, "lastLaunchTime")),
    schematicID: hasKey(value, "schematicID") ? idData(keyValField(value, "schematicID")) : null,
    hasReceivedInputs: hasKey(value, "hasReceivedInputs")
      ? asBoolOrNull(keyValField(value, "hasReceivedInputs"))
      : null,
    receivedInputsLastCycle: hasKey(value, "receivedInputsLastCycle")
      ? asBoolOrNull(keyValField(value, "receivedInputsLastCycle"))
      : null,
    cycleTime: exactInt(keyValField(value, "cycleTime")),
    programType: hasKey(value, "programType") ? idData(keyValField(value, "programType")) : null,
    qtyPerCycle: exactInt(keyValField(value, "qtyPerCycle")),
    expiryTime: exactInt(keyValField(value, "expiryTime")),
    installTime: exactInt(keyValField(value, "installTime")),
    headRadius: hasKey(value, "headRadius") ? asReal(keyValField(value, "headRadius")) : null,
    heads: decodeHeads(keyValField(value, "heads")),
  };
}

/** A colony link as a KeyVal (GetPlanetInfo) — {typeID, endpoint1, endpoint2, level}. */
export interface ColonyLink {
  readonly typeID: number | string | null;
  readonly endpoint1: number | string | null;
  readonly endpoint2: number | string | null;
  readonly level: number;
}

function decodeColonyLink(value: JsonValue | undefined): ColonyLink {
  return {
    typeID: idData(keyValField(value, "typeID")),
    endpoint1: idData(keyValField(value, "endpoint1")),
    endpoint2: idData(keyValField(value, "endpoint2")),
    level: smallInt(keyValField(value, "level")),
  };
}

/** A colony route (GetPlanetInfo) — {routeID, charID, path, commodityTypeID, quantity}. */
export interface ColonyRoute {
  readonly routeID: number | string | null;
  readonly charID: number | string | null;
  readonly path: readonly (number | string | null)[];
  readonly commodityTypeID: number | string | null;
  readonly commodityQuantity: string | null;
}

function decodeRoute(value: JsonValue | undefined): ColonyRoute {
  return {
    routeID: idData(keyValField(value, "routeID")),
    charID: idData(keyValField(value, "charID")),
    path: listItems(keyValField(value, "path")).map((pinID) => idData(pinID)),
    commodityTypeID: idData(keyValField(value, "commodityTypeID")),
    commodityQuantity: exactInt(keyValField(value, "commodityQuantity")),
  };
}

// --- GetPlanetInfo ----------------------------------------------------------

/** The colony body of GetPlanetInfo, present only when the session char owns one. */
export interface PlanetColonyBody {
  readonly ownerID: number | string | null;
  readonly pins: readonly ColonyPin[];
  readonly links: readonly ColonyLink[];
  readonly routes: readonly ColonyRoute[];
  readonly level: number;
  /** ⚠ EXACT FILETIME decimal string, or null. */
  readonly currentSimTime: string | null;
}

export interface PlanetInfo {
  readonly planetID: number | string | null;
  readonly solarSystemID: number | string | null;
  readonly planetTypeID: number | string | null;
  readonly radius: number;
  readonly celestialIndex: number;
  /** The session char's own colony here, or null when none (a real "no colony"). */
  readonly colony: PlanetColonyBody | null;
}

/** Decode GetPlanetInfo — planet geography + (only) the session char's own colony. */
export function decodePlanetInfo(result: JsonValue | undefined): PlanetInfo {
  const colony: PlanetColonyBody | null = hasKey(result, "pins")
    ? {
        ownerID: idData(keyValField(result, "ownerID")),
        pins: listItems(keyValField(result, "pins")).map(decodePin),
        links: listItems(keyValField(result, "links")).map(decodeColonyLink),
        routes: listItems(keyValField(result, "routes")).map(decodeRoute),
        level: smallInt(keyValField(result, "level")),
        currentSimTime: exactInt(keyValField(result, "currentSimTime")),
      }
    : null;
  return {
    planetID: idData(keyValField(result, "planetID")),
    solarSystemID: idData(keyValField(result, "solarSystemID")),
    planetTypeID: idData(keyValField(result, "planetTypeID")),
    radius: smallInt(keyValField(result, "radius")),
    celestialIndex: smallInt(keyValField(result, "celestialIndex")),
    colony,
  };
}

// --- GetPlanetResourceInfo (CachedMethodCallResult) -------------------------

/** One resource band-quality entry for the planet. */
export interface PlanetResourceQuality {
  readonly resourceTypeID: number | string | null;
  readonly quality: number;
}

const CACHED_METHOD_CALL_RESULT = "CachedMethodCallResult";

/** The name string of a marshaled object (bare or rawstr/token wrapper); "" otherwise. */
function objectName(value: JsonValue | undefined): string {
  const obj = asObject(value);
  if (typeof obj.name === "string") {
    return obj.name;
  }
  const named = asObject(obj.name);
  return typeof named.value === "string" ? named.value : "";
}

/**
 * The payload dict of GetPlanetResourceInfo. It arrives wrapped in a
 * CachedMethodCallResult whose args is an ARRAY carrying a {type:"substream"} whose
 * value is the {resourceTypeID -> quality} dict. Falls back to a bare dict if a
 * future path returns it unwrapped. `[]` when neither.
 */
function resourceInfoDictEntries(result: JsonValue | undefined): readonly JsonValue[] {
  const obj = asObject(result);
  // Unwrapped bare dict / KeyVal.
  const direct = keyValEntries(result);
  if (direct.length > 0 && !objectName(result).includes(CACHED_METHOD_CALL_RESULT)) {
    return direct;
  }
  // CachedMethodCallResult: args is an array; find the substream carrying the dict.
  const args = Array.isArray(obj.args) ? (obj.args as readonly JsonValue[]) : [];
  for (const arg of args) {
    const argObj = asObject(arg);
    if (argObj.type === "substream") {
      const inner = asObject(argObj.value);
      if (inner.type === "dict" && Array.isArray(inner.entries)) {
        return inner.entries as readonly JsonValue[];
      }
    }
    if (argObj.type === "dict" && Array.isArray(argObj.entries)) {
      // A dict directly under args (not the versionCheck one — it has string keys).
      const entries = argObj.entries as readonly JsonValue[];
      const looksLikeResourceDict = entries.every(
        (e) => Array.isArray(e) && typeof (e as readonly JsonValue[])[0] === "number",
      );
      if (entries.length > 0 && looksLikeResourceDict) {
        return entries;
      }
    }
  }
  return direct;
}

/** Decode GetPlanetResourceInfo — the static resourceTypeID -> quality table. */
export function decodePlanetResourceInfo(
  result: JsonValue | undefined,
): readonly PlanetResourceQuality[] {
  return resourceInfoDictEntries(result)
    .filter((entry): entry is readonly JsonValue[] => Array.isArray(entry))
    .map((entry) => ({
      resourceTypeID: idData(entry[0]),
      quality: smallInt(entry[1]),
    }));
}

// --- GetResourceData --------------------------------------------------------

/** The per-planet resource distribution bytes for one resourceTypeID. */
export interface PlanetResourceData {
  /** Raw distribution bytes (the spherical-harmonics buffer), or null when absent. */
  readonly data: readonly number[] | null;
  readonly numBands: number;
  readonly proximity: number;
}

/** Bytes from a {type:"bytes", value:{type:"Buffer", data:[…]}} wrapper, else null. */
function decodeBytes(value: JsonValue | undefined): readonly number[] | null {
  const obj = asObject(value);
  if (obj.type !== "bytes") {
    return null;
  }
  const buffer = asObject(obj.value);
  if (buffer.type === "Buffer" && Array.isArray(buffer.data)) {
    return (buffer.data as readonly JsonValue[]).map((b) => smallInt(b));
  }
  return null;
}

/** Decode GetResourceData — {data bytes, numBands, proximity}. */
export function decodeResourceData(result: JsonValue | undefined): PlanetResourceData {
  return {
    data: decodeBytes(keyValField(result, "data")),
    numBands: smallInt(keyValField(result, "numBands")),
    proximity: smallInt(keyValField(result, "proximity")),
  };
}

// --- GetFullNetworkForOwner -------------------------------------------------

/** A network link — a bare [endpoint1, endpoint2] tuple (GetFullNetworkForOwner). */
export interface NetworkLink {
  readonly endpoint1: number | string | null;
  readonly endpoint2: number | string | null;
}

export interface PlanetNetwork {
  readonly pins: readonly ColonyPin[];
  readonly links: readonly NetworkLink[];
}

/** Decode GetFullNetworkForOwner — [pins, links] (links are bare 2-tuples). */
export function decodeFullNetwork(result: JsonValue | undefined): PlanetNetwork {
  const outer = Array.isArray(result) ? (result as readonly JsonValue[]) : [];
  return {
    pins: listItems(outer[0]).map(decodePin),
    links: listItems(outer[1]).map((link) => {
      const cells = Array.isArray(link) ? (link as readonly JsonValue[]) : listItems(link);
      return { endpoint1: idData(cells[0]), endpoint2: idData(cells[1]) };
    }),
  };
}

// --- GetCommandPinsForPlanet ------------------------------------------------

/** A command / extractor pin summary (shared shape). */
export interface PlanetPinSummary {
  readonly ownerID: number | string | null;
  readonly pinID: number | string | null;
  readonly id: number | string | null;
  readonly typeID: number | string | null;
  readonly latitude: number;
  readonly longitude: number;
}

function decodePinSummary(
  value: JsonValue | undefined,
  ownerKey: number | string | null,
): PlanetPinSummary {
  return {
    ownerID: ownerKey ?? idData(keyValField(value, "ownerID")),
    pinID: idData(keyValField(value, "pinID")),
    id: idData(keyValField(value, "id")),
    typeID: idData(keyValField(value, "typeID")),
    latitude: asReal(keyValField(value, "latitude")),
    longitude: asReal(keyValField(value, "longitude")),
  };
}

/** Decode GetCommandPinsForPlanet — one command pin per owner on the planet. */
export function decodeCommandPins(result: JsonValue | undefined): readonly PlanetPinSummary[] {
  const obj = asObject(result);
  const entries = obj.type === "dict" && Array.isArray(obj.entries)
    ? (obj.entries as readonly JsonValue[])
    : [];
  const out: PlanetPinSummary[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const pair = entry as readonly JsonValue[];
      out.push(decodePinSummary(pair[1], idData(pair[0])));
    }
  }
  return out;
}

// --- GetExtractorsForPlanet -------------------------------------------------

/** Decode GetExtractorsForPlanet — every extractor across all owners on the planet. */
export function decodeExtractors(result: JsonValue | undefined): readonly PlanetPinSummary[] {
  return listItems(result).map((pin) => decodePinSummary(pin, null));
}

// --- GetProgramResultInfo ---------------------------------------------------

/** A computed extractor-program yield estimate (all bigint-safe). */
export interface ProgramResult {
  readonly qtyToDistribute: string | null;
  readonly cycleTime: string | null;
  readonly numCycles: string | null;
}

/** Decode GetProgramResultInfo — [qtyToDistribute, cycleTime, numCycles]. */
export function decodeProgramResult(result: JsonValue | undefined): ProgramResult {
  const tuple = Array.isArray(result) ? (result as readonly JsonValue[]) : [];
  return {
    qtyToDistribute: exactInt(tuple[0]),
    cycleTime: exactInt(tuple[1]),
    numCycles: exactInt(tuple[2]),
  };
}

// --- The whole GET /api/bridge/bound-planet envelope ------------------------
//
// The BFF issues all 7 reads independently (Promise.allSettled) and returns each as
// `{result}` on success or `{error: <code>}` on failure — a planet with no colony
// (no pins / no command pins / no extractors) and a zeroed program estimate are
// legitimate states, not a blanking failure. This decoder folds that envelope into
// typed data, carrying each read's error through as a string.

export interface BoundPlanetResult<T> {
  readonly value: T;
  /** The failure code when the read did not succeed, else null. */
  readonly error: string | null;
}

export interface BoundPlanet {
  readonly planetID: number | null;
  readonly ownerID: number | null;
  readonly resourceTypeID: number | null;
  readonly planetInfo: BoundPlanetResult<PlanetInfo>;
  readonly resourceInfo: BoundPlanetResult<readonly PlanetResourceQuality[]>;
  readonly resourceData: BoundPlanetResult<PlanetResourceData>;
  readonly network: BoundPlanetResult<PlanetNetwork>;
  readonly commandPins: BoundPlanetResult<readonly PlanetPinSummary[]>;
  readonly extractors: BoundPlanetResult<readonly PlanetPinSummary[]>;
  readonly programResult: BoundPlanetResult<ProgramResult>;
}

function pick(
  reads: Record<string, JsonValue>,
  key: string,
): { result: JsonValue | undefined; error: string | null } {
  const cell = asObject(reads[key]);
  const error = typeof cell.error === "string" && cell.error.length > 0 ? cell.error : null;
  return { result: cell.result, error };
}

function numberOrNull(value: JsonValue | undefined): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 ? Math.trunc(numeric) : null;
}

/** Decode the /api/bridge/bound-planet envelope. */
export function decodeBoundPlanet(raw: JsonValue | null | undefined): BoundPlanet {
  const root = asObject(raw);
  const reads = asObject(root.reads);
  const map = <T>(key: string, decode: (r: JsonValue | undefined) => T): BoundPlanetResult<T> => {
    const { result, error } = pick(reads, key);
    return { value: decode(result), error };
  };
  return {
    planetID: numberOrNull(root.planetID),
    ownerID: numberOrNull(root.ownerID),
    resourceTypeID: numberOrNull(root.resourceTypeID),
    planetInfo: map("GetPlanetInfo", decodePlanetInfo),
    resourceInfo: map("GetPlanetResourceInfo", decodePlanetResourceInfo),
    resourceData: map("GetResourceData", decodeResourceData),
    network: map("GetFullNetworkForOwner", decodeFullNetwork),
    commandPins: map("GetCommandPinsForPlanet", decodeCommandPins),
    extractors: map("GetExtractorsForPlanet", decodeExtractors),
    programResult: map("GetProgramResultInfo", decodeProgramResult),
  };
}
