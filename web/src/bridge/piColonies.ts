// planetMgr's two top-level PI reads decoded to plain rows (goal R71, PLUMBING
// ONLY — no UI).
//
// GET /api/bridge/pi-colonies bundles two independent CRowset reads. Both handlers
// IGNORE their args and scope to session.characterID (the "ForChar" name is a decoy
// — verified LIVE: a FOREIGN charID in args returned Farmer's OWN colony, and a
// second session saw a different, empty set):
//
//   • colonies = planetMgr.GetPlanetsForChar()   -> a carbon…CRowset over columns
//     [solarSystemID, planetID, typeID, numberOfPins, celestialIndex]. Captured LIVE
//     from Farmer (char 140000005) on 2026-07-22: ONE colony row
//     [30000142, 40009077, 2016, 4, 1].
//   • launches = planetMgr.GetMyLaunchesDetails() -> a carbon…CRowset over columns
//     [launchID, solarSystemID, itemID(int64), ownerID, planetID, status, launchTime
//     (FILETIME long), x, y, z]. Captured LIVE EMPTY for Farmer (a real "no customs-
//     office launches" state).
//
// ⚠ THE ROWS OF A CRowset LIVE ON `list`, NOT `items` — the objectex2 CRowset is the
// SAME shape personalAssets.ts decodes (ListStations). Each row is a POSITIONAL
// packedrow (`columns:[["solarSystemID",3],…]` with a parallel `values:[…]`, no
// `fields`), read through `readRowField` so a future name-keyed variant still decodes.
//
// R7d: every id (solarSystemID / planetID / typeID / itemID / ownerID) survives as a
// numeric field for a future UI to resolve; none is forced into a label. launchTime is
// a FILETIME bigint. x/y/z are plain doubles.

import { readRowField, unwrapLong, type JsonValue } from "./wire.ts";

/** One PI colony (planetMgr.GetPlanetsForChar row). */
export interface PlanetColony {
  readonly solarSystemID: number;
  readonly planetID: number;
  readonly typeID: number;
  readonly numberOfPins: number;
  readonly celestialIndex: number;
}

/** One customs-office launch (planetMgr.GetMyLaunchesDetails row). */
export interface LaunchDetail {
  readonly launchID: number;
  readonly solarSystemID: number;
  /** itemID is declared int64 (still well under 2^53 in this world). */
  readonly itemID: number;
  readonly ownerID: number;
  readonly planetID: number;
  readonly status: number;
  /** FILETIME the launch was made (a bigint); null when absent/zero. */
  readonly launchTime: bigint | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A number from a row field, whatever encoding it arrived in: a plain number, a
 * {type:"long"} wrapper, or a BARE DECIMAL STRING (what the gateway emits for a
 * genuine BigInt). 0 when absent — never a substituted default that hides a shape gap.
 */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * The rows of a CRowset. They live on `list` (an objectex2's rows are NOT on
 * `items`); reading `items` here yields an empty result with no error. `[]` for
 * anything that is not a CRowset — a real "no rows" answer.
 */
function crowsetRows(result: JsonValue | null | undefined): readonly JsonValue[] {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return [];
  }
  const list = (result as { list?: unknown }).list;
  return Array.isArray(list) ? (list as readonly JsonValue[]) : [];
}

/**
 * Decode planetMgr.GetPlanetsForChar -> the session character's PI colonies. Sorted
 * by planet id so the list is stable across reloads. An empty CRowset is a real "no
 * colonies" state, returned as [].
 */
export function decodePlanetColonies(
  result: JsonValue | null | undefined,
): readonly PlanetColony[] {
  const rows: PlanetColony[] = [];
  for (const row of crowsetRows(result)) {
    const planetID = toNumber(readRowField(row, "planetID"));
    if (planetID <= 0) {
      continue;
    }
    rows.push({
      solarSystemID: toNumber(readRowField(row, "solarSystemID")),
      planetID,
      typeID: toNumber(readRowField(row, "typeID")),
      numberOfPins: toNumber(readRowField(row, "numberOfPins")),
      celestialIndex: toNumber(readRowField(row, "celestialIndex")),
    });
  }
  return rows.sort((left, right) => left.planetID - right.planetID);
}

/**
 * Decode planetMgr.GetMyLaunchesDetails -> the session character's customs-office
 * launches. An empty CRowset (Farmer's real state) returns []. launchTime stays a
 * bigint FILETIME; every id is kept as data (R7d).
 */
export function decodeLaunchDetails(
  result: JsonValue | null | undefined,
): readonly LaunchDetail[] {
  const rows: LaunchDetail[] = [];
  for (const row of crowsetRows(result)) {
    const launchID = toNumber(readRowField(row, "launchID"));
    const itemID = toNumber(readRowField(row, "itemID"));
    if (launchID <= 0 && itemID <= 0) {
      continue;
    }
    rows.push({
      launchID,
      solarSystemID: toNumber(readRowField(row, "solarSystemID")),
      itemID,
      ownerID: toNumber(readRowField(row, "ownerID")),
      planetID: toNumber(readRowField(row, "planetID")),
      status: toNumber(readRowField(row, "status")),
      launchTime: toFiletime(readRowField(row, "launchTime")),
      x: toNumber(readRowField(row, "x")),
      y: toNumber(readRowField(row, "y")),
      z: toNumber(readRowField(row, "z")),
    });
  }
  return rows.sort((left, right) => left.launchID - right.launchID);
}
