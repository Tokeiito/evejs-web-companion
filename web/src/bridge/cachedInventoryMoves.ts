// Ordinary numeric inventory moves through invCacheContainer.MultiAdd1027-1063.
// PlayerTrade returns a direct moniker (invControllers1691) and does not use this wrapper.
// Fitted/tuple sublocations and their pre-try dogma unload path are separate producers.
import type { Ask } from "./ask.ts";
import { BridgeCallError } from "./callMethod.ts";
import { hashedSetOrder, wholeHashOf } from "./py27DictOrder.ts";
import type { JsonValue } from "./wire.ts";

interface Scope {
  readonly ask: Ask;
  readonly act: Ask;
  readonly current: () => void;
  readonly activeShipID: number | null;
  readonly dockedAt: number | null;
}

/** NEW lockedItems - empty charges set, then list(): two add/traverse steps, not a set copy. */
export function ordinaryMultiAddOrder(ids: readonly number[]): number[] {
  const acquired = hashedSetOrder(ids, wholeHashOf, String);
  return hashedSetOrder(acquired, wholeHashOf, String);
}

function lockedIDs(value: JsonValue): ReadonlySet<string> {
  const dict = value as { readonly type?: JsonValue; readonly entries?: JsonValue } | null;
  if (!dict || typeof dict !== "object" || Array.isArray(dict) || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    throw new Error("The locked-item dictionary could not be read.");
  }
  const ids = new Set<string>();
  for (const entry of dict.entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error("A locked-item dictionary entry could not be read.");
    const raw = entry[0];
    if (typeof raw === "number" && Number.isSafeInteger(raw)) ids.add(String(raw));
    else if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.type === "long" && typeof raw.value === "string" && /^-?\d+$/.test(raw.value)) ids.add(String(BigInt(raw.value)));
    else throw new Error("A locked-item ID cannot be represented exactly.");
  }
  return ids;
}

export function createCachedInventoryMoves(capture: () => Scope) {
  let localLocks = new Set<number>();
  let byLocation = new Map<number, Promise<ReadonlySet<string>>>();

  // ItemLocking.GetLockedItemsByLocation30-34: one coalesced remote dictionary per location.
  function at(scope: Scope, location: number): Promise<ReadonlySet<string>> {
    const cache = byLocation;
    let pending = cache.get(location);
    if (!pending) {
      pending = scope.ask("itemLocking", "GetItemsByLocation", [location]).then(lockedIDs);
      cache.set(location, pending);
      void pending.catch(() => { if (cache.get(location) === pending) cache.delete(location); });
    }
    return pending;
  }

  const act: Ask = async (service, method, args, kwargs, of) => {
    const scope = capture();
    if (service !== "invbroker" || method !== "MultiAdd") return scope.act(service, method, args, kwargs, of);
    const ids = args[0];
    if (!Array.isArray(ids) || !ids.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      throw new Error("Ordinary inventory moves require exact numeric item IDs.");
    }
    if (scope.activeShipID !== null && ids.includes(scope.activeShipID)) {
      throw new BridgeCallError("CALL_REFUSED", "CanNotPlaceActiveShipInAnotherHangar", 409, null, null,
        { key: "CanNotPlaceActiveShipInAnotherHangar", values: null });
    }
    const locks = localLocks, acquired: number[] = [];
    // Ordinary move flags are cargo/bays/hangar/divisions; fitted CheckCanFit is not this path.
    for (const id of ids as number[]) {
      if (id === of) continue;
      if (scope.dockedAt !== null) {
        const persistent = await at(scope, scope.dockedAt); scope.current();
        if (persistent.has(String(id))) continue;
      }
      if (locks.has(id)) continue;
      locks.add(id); acquired.push(id);
    }
    if (!acquired.length) return null;
    try {
      scope.current();
      await scope.act(service, method, [ordinaryMultiAddOrder(acquired), ...args.slice(1)], kwargs, of);
    } finally {
      for (const id of hashedSetOrder(acquired, wholeHashOf, String)) locks.delete(id);
    }
    return true; // The original wrapper ignores the remote return; callers still verify custody.
  };

  return {
    act,
    // ItemLocking.OnLockedItemChange67-79. No location-list consumer is primed here.
    invalidate(location: number) { byLocation.delete(location); },
    clear() { byLocation = new Map(); localLocks = new Set(); },
  };
}
