// The Agent Finder's client-side row filters (goal R52 jumps limit + R6a text
// search). Pure over the rows the flow already fetched and jump-annotated — no
// fetch, no store, no server re-find. Extracted here so the "within N jumps"
// and text filters are unit-testable rather than buried in the component's
// markup; the view applies these, THEN the render cap, so the cap counts what
// actually matched.

import type { AgentFinderRow } from "../store/types.ts";

export interface FinderFilter {
  /**
   * Max jumps to include; null = no jumps filter (show all rows, reachable or
   * not, as before R52). A limit is opt-in: a blank input means null.
   */
  readonly jumpsLimit: number | null;
  /**
   * Free-text query over name/system/station/kind/level/id; blank = no text
   * filter (R6a client-side search, unchanged).
   */
  readonly searchText: string;
}

/**
 * Read a "within N jumps" limit from the raw input string. A blank/whitespace
 * input, or anything that is not a non-negative number, means "no limit" (null)
 * — the filter is opt-in and never silently excludes everything on a typo.
 * (Number("") is 0, so the blank check must come first.)
 */
export function parseJumpsLimit(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

function matchesSearch(agent: AgentFinderRow, query: string): boolean {
  const haystack = [
    agent.name,
    agent.solarSystemName ?? "",
    agent.stationName ?? "",
    agent.missionKind ?? "",
    `l${agent.level ?? ""}`,
    String(agent.agentID),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Filter the already-fetched, already-nearest-sorted finder rows for display.
 * Jumps filter FIRST, then the text filter (the view applies the render cap
 * after, so the cap counts real matches):
 *  - jumpsLimit active → an agent passes only when it is reachable
 *    (jumps !== null) and jumps <= the limit. Unreachable agents (jumps null)
 *    are excluded; a same-system agent (0 jumps) passes any limit >= 0.
 *  - jumpsLimit null → no jumps constraint (every row survives this step).
 *  - a non-blank query → the agent's name/location/kind/level/id must contain
 *    it (case-insensitive substring).
 * Returns a new array; the input order (nearest-first) is preserved.
 */
export function filterFinderRows(
  rows: readonly AgentFinderRow[],
  filter: FinderFilter,
): AgentFinderRow[] {
  const { jumpsLimit, searchText } = filter;
  const query = searchText.trim().toLowerCase();
  return rows.filter((agent) => {
    if (jumpsLimit !== null && (agent.jumps === null || agent.jumps > jumpsLimit)) {
      return false;
    }
    if (query && !matchesSearch(agent, query)) {
      return false;
    }
    return true;
  });
}
