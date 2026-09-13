export interface RouteItemChoice {
  readonly typeID: number;
  readonly groupID?: number | null;
  readonly name: string;
}

/**
 * Route cargo may exist only at the remote endpoint, so locally observed
 * inventory is a convenience rather than the picker catalogue. Static type
 * search results lead the merged list; local matches fill any remaining rows.
 */
export async function findRouteItemChoices(
  query: string,
  localItems: readonly RouteItemChoice[],
  findGlobalTypes: (query: string) => Promise<readonly RouteItemChoice[]>,
  limit = 8,
): Promise<readonly RouteItemChoice[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const q = trimmed.toLowerCase();
  const globalItems = await findGlobalTypes(trimmed);
  const localMatches = localItems.filter((item) => item.name.toLowerCase().includes(q));
  const merged = new Map<number, RouteItemChoice>();
  for (const item of [...globalItems, ...localMatches]) {
    if (item.typeID > 0 && item.name.trim().length > 0 && !merged.has(item.typeID)) {
      merged.set(item.typeID, item);
    }
  }
  return [...merged.values()].slice(0, limit);
}