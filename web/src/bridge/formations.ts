// beyonce.GetFormations decoded (goal R71, PLUMBING ONLY — no UI).
//
// ⚠ THE TOP-LEVEL CALL RETURNS A proxyCache OBJECT REFERENCE, NOT THE INLINE DATA.
// GetFormations builds its result with buildCachedMethodCallResult(..., {proxyCache:
// true}) — verified LIVE from Farmer on 2026-07-22, the bridge receives a
// CachedMethodCallResult whose args[1] is a carbon…cachedObject.CachedObject REFERENCE
// (objectId = ["Method Call","server",["beyonce","GetFormations"]], nodeId, version),
// with the actual formation-shape pickle stored server-side under that objectId. The
// static Diamond/Arrow point offsets therefore sit behind a SECOND object-cache fetch
// that this thin, reads-only batch does not wire (no new handler, no cache channel).
//
// So decodeFormations surfaces the real bytes HONESTLY: it returns the cache reference
// (so a future object-cache-fetch batch can complete the read) and an empty formation
// list. It ALSO decodes the INLINE form — {…, args:[details, {type:"substream", value:
// [[name,[[x,y,z],…]],…]}, version]} — so that if the handler ever drops proxyCache the
// same decoder yields the shapes. (The inline fixture in the tests is synthesized from
// the server's formation constant since proxyCache is always on live.)

import { unwrapLong, type JsonValue } from "./wire.ts";

/** One point offset in a formation (metres, ship-relative). */
export interface FormationPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One named formation and its point offsets. */
export interface Formation {
  readonly name: string;
  readonly points: readonly FormationPoint[];
}

/** A proxyCache pointer the top-level call returns in place of inline data. */
export interface CachedObjectReference {
  /** The compound object-cache key, carried opaque (a future fetch resolves it). */
  readonly objectId: JsonValue;
  readonly nodeId: number | null;
  /** The FILETIME portion of the object version; null when absent. */
  readonly version: bigint | null;
}

export interface FormationsResult {
  readonly formations: readonly Formation[];
  /** Non-null when the read returned a proxyCache pointer instead of inline shapes. */
  readonly cacheReference: CachedObjectReference | null;
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/** A rawstr/token wrapper's text, or a bare string; "" otherwise. */
function nameText(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string") {
      return inner;
    }
  }
  return "";
}

function isObjectNamed(value: unknown, needle: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if ((value as { type?: unknown }).type !== "object") {
    return false;
  }
  return nameText((value as { name?: JsonValue }).name).includes(needle);
}

/** Decode the inline formation array [[name,[[x,y,z],…]],…] -> Formation[]. */
function decodeInlineFormations(value: JsonValue | null | undefined): readonly Formation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const formations: Formation[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }
    const name = nameText(entry[0] as JsonValue);
    const rawPoints = entry[1];
    const points: FormationPoint[] = [];
    if (Array.isArray(rawPoints)) {
      for (const point of rawPoints) {
        if (Array.isArray(point) && point.length >= 3) {
          points.push({
            x: toNumber(point[0] as JsonValue),
            y: toNumber(point[1] as JsonValue),
            z: toNumber(point[2] as JsonValue),
          });
        }
      }
    }
    if (name !== "" || points.length > 0) {
      formations.push({ name, points });
    }
  }
  return formations;
}

/** Decode a CachedObject reference (objectId, nodeId, versionTuple) -> the pointer. */
function decodeCacheReference(value: JsonValue): CachedObjectReference | null {
  if (!isObjectNamed(value, "cachedObject.CachedObject")) {
    return null;
  }
  const args = (value as { args?: JsonValue }).args;
  if (!Array.isArray(args)) {
    return null;
  }
  const versionTuple = args[2];
  const version =
    Array.isArray(versionTuple) && versionTuple.length > 0
      ? unwrapLong(versionTuple[0] as JsonValue)
      : null;
  return {
    objectId: (args[0] ?? null) as JsonValue,
    nodeId: typeof args[1] === "number" ? args[1] : toNumber(args[1] as JsonValue) || null,
    version,
  };
}

/**
 * Decode beyonce.GetFormations. Returns the inline formation shapes when present, else
 * the proxyCache reference the live top-level call actually yields (formations then
 * []). Both forms are read from the CachedMethodCallResult's args members.
 */
export function decodeFormations(
  result: JsonValue | null | undefined,
): FormationsResult {
  // A bare inline array (defensive — a handler that returns formations unwrapped).
  if (Array.isArray(result)) {
    return { formations: decodeInlineFormations(result), cacheReference: null };
  }
  if (isObjectNamed(result, "CachedMethodCallResult")) {
    const args = (result as { args?: JsonValue }).args;
    if (Array.isArray(args)) {
      for (const member of args) {
        if (
          typeof member === "object" &&
          member !== null &&
          !Array.isArray(member) &&
          (member as { type?: unknown }).type === "substream"
        ) {
          return {
            formations: decodeInlineFormations(
              ((member as { value?: JsonValue }).value ?? null) as JsonValue | null,
            ),
            cacheReference: null,
          };
        }
        const reference = decodeCacheReference(member as JsonValue);
        if (reference) {
          return { formations: [], cacheReference: reference };
        }
      }
    }
  }
  return { formations: [], cacheReference: null };
}
