// Overview view logic (goal R11) — pure, framework-free, fully testable.
//
// The server hands the browser positions; everything a player actually reads in
// an overview — how far away a thing is, what order the list is in, what is
// filtered out — is computed HERE, in the client. That is not a shortcut: it is
// how the retail client works. The server pushes ball state and the client
// re-derives distance and re-renders on its own cadence.
//
// Nothing in this module renders a numeric game ID (goal R7d). It carries IDs so
// the caller can key rows, resolve names, and issue a move; the strings it
// produces (`formatDistance`) are units, never identifiers.

import type { SpaceEntity, SpaceSnapshot, SpaceVector } from "../store/types.ts";

/** One astronomical unit in metres — the unit EVE distances read in at range. */
export const METRES_PER_AU = 149_597_870_700;

/** Straight-line distance between two points, in metres. */
export function distanceMeters(from: SpaceVector, to: SpaceVector): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * A distance as a player reads it: metres up close, kilometres in between,
 * AU once it is a warp away. Mirrors the retail overview's own thresholds.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return "—";
  }
  if (meters >= METRES_PER_AU / 10) {
    return `${(meters / METRES_PER_AU).toFixed(1)} AU`;
  }
  if (meters >= 1_000) {
    const km = meters / 1_000;
    return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/** An overview row: a visible object plus the distance the client computed. */
export interface OverviewRow extends SpaceEntity {
  /** Distance from the player's ship, in metres. */
  readonly distance: number;
}

export type OverviewSort = "distance" | "name";

export interface OverviewFilter {
  /** Free-text match over the row's name / type name / group name. */
  readonly text?: string;
  /** Restrict to one category, or null for all. */
  readonly categoryID?: number | null;
  /** Restrict to one group, or null for all. */
  readonly groupID?: number | null;
}

/**
 * Names the caller has already resolved for a row, so text search can match what
 * the player actually SEES (a type or group name) rather than an id.
 */
export interface OverviewRowNames {
  readonly typeName?: string | null;
  readonly groupName?: string | null;
}

/** Look up the resolved names for one row (supplied by the component). */
export type OverviewNameLookup = (entity: SpaceEntity) => OverviewRowNames;

const NO_NAMES: OverviewRowNames = {};

function matchesText(
  entity: SpaceEntity,
  names: OverviewRowNames,
  needle: string,
): boolean {
  const haystack = [entity.name, names.typeName, names.groupName]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Build the overview list: drop the player's own ship, apply the filters,
 * compute each remaining row's distance from the ship, and sort.
 *
 * `cap` bounds how many rows the caller renders — a busy grid can hold hundreds
 * of balls and the panel must stay responsive at a 1s cadence. The cap is
 * applied AFTER sorting, so capping always keeps the nearest objects.
 */
export function buildOverviewRows(
  snapshot: SpaceSnapshot | null,
  origin: SpaceVector,
  options: {
    readonly filter?: OverviewFilter;
    readonly sort?: OverviewSort;
    readonly cap?: number;
    readonly names?: OverviewNameLookup;
  } = {},
): { readonly rows: readonly OverviewRow[]; readonly matched: number } {
  if (!snapshot) {
    return { rows: [], matched: 0 };
  }
  const filter = options.filter ?? {};
  const lookup = options.names ?? (() => NO_NAMES);
  const needle = (filter.text ?? "").trim().toLowerCase();

  const matched: OverviewRow[] = [];
  for (const entity of snapshot.entities) {
    if (entity.isSelf) {
      continue;
    }
    if (
      filter.categoryID !== null &&
      filter.categoryID !== undefined &&
      entity.categoryID !== filter.categoryID
    ) {
      continue;
    }
    if (
      filter.groupID !== null &&
      filter.groupID !== undefined &&
      entity.groupID !== filter.groupID
    ) {
      continue;
    }
    if (needle.length > 0 && !matchesText(entity, lookup(entity), needle)) {
      continue;
    }
    matched.push({ ...entity, distance: distanceMeters(origin, entity.position) });
  }

  const sort = options.sort ?? "distance";
  matched.sort((left, right) => {
    if (sort === "name") {
      const byName = (left.name ?? "").localeCompare(right.name ?? "");
      if (byName !== 0) {
        return byName;
      }
    }
    // Distance is the tiebreaker for name sort and the primary key otherwise —
    // nearest first, as an overview always reads.
    return left.distance - right.distance;
  });

  const cap = options.cap;
  const rows =
    typeof cap === "number" && cap > 0 && matched.length > cap
      ? matched.slice(0, cap)
      : matched;
  return { rows, matched: matched.length };
}

/**
 * The distinct category / group ids present in a snapshot, so the panel can
 * offer only filters that would actually match something. Ids only — the
 * component resolves each to a NAME before rendering it (R7d).
 */
export function overviewFilterIDs(snapshot: SpaceSnapshot | null): {
  readonly categoryIDs: readonly number[];
  readonly groupIDs: readonly number[];
} {
  if (!snapshot) {
    return { categoryIDs: [], groupIDs: [] };
  }
  const categories = new Set<number>();
  const groups = new Set<number>();
  for (const entity of snapshot.entities) {
    if (entity.isSelf) {
      continue;
    }
    if (entity.categoryID !== null) {
      categories.add(entity.categoryID);
    }
    if (entity.groupID !== null) {
      groups.add(entity.groupID);
    }
  }
  return {
    categoryIDs: [...categories],
    groupIDs: [...groups],
  };
}

/**
 * A health/capacitor ratio as a whole percentage for a labelled bar, or null
 * when the ship has no such layer to report.
 */
export function ratioPercent(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return null;
  }
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}
