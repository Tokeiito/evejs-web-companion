// The Mission bot's "Agent to work for" picker filters: type-to-search plus the
// Level / Corporation selects (styled after the Agent Finder's filter row).
// Pure over the Choice rows the panel already built from the station roster and
// the finder's finds — no fetch, no store. Extracted here so the rules are
// unit-testable rather than buried in the component's markup; the panel derives
// `chosen` (what Start actually uses) FROM the filtered list, so narrowing the
// list narrows what the bot can be sent to.

/** The fields of a picker row the filters read. */
export interface FilterableAgentChoice {
  /** The agent's display name (already resolved — never an ID). */
  readonly label: string;
  readonly stationName: string | null;
  readonly level: number | null;
  readonly corporationID: number | null;
}

export interface AgentChoiceFilter {
  /**
   * Free-text query over name/station/level; blank = no text filter. Matching
   * is a case-insensitive substring, like the Agent Finder's search.
   */
  readonly searchText: string;
  /** Exact agent level to keep; null = all levels. */
  readonly level: number | null;
  /** Exact employing corporation to keep; null = all corporations. */
  readonly corporationID: number | null;
}

function matchesSearch(choice: FilterableAgentChoice, query: string): boolean {
  const haystack = [choice.label, choice.stationName ?? "", `l${choice.level ?? ""}`]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Filter the picker's choices for display. The input order (here-first, then
 * nearest-first) is preserved — the filters only ever remove rows:
 *  - a specific level keeps only agents OF that level; an agent whose level is
 *    unknown (null) does not match any specific level.
 *  - a specific corporation keeps only its agents; unknown (null) likewise
 *    matches only "all".
 *  - a non-blank query must appear in the agent's name, station, or "lN" level
 *    tag (case-insensitive substring).
 */
export function filterAgentChoices<T extends FilterableAgentChoice>(
  choices: readonly T[],
  filter: AgentChoiceFilter,
): T[] {
  const query = filter.searchText.trim().toLowerCase();
  return choices.filter((choice) => {
    if (filter.level !== null && choice.level !== filter.level) {
      return false;
    }
    if (filter.corporationID !== null && choice.corporationID !== filter.corporationID) {
      return false;
    }
    if (query && !matchesSearch(choice, query)) {
      return false;
    }
    return true;
  });
}
