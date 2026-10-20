// Ordinary numeric inventory moves through invCacheContainer.Add998-1025/MultiAdd1027-1063.
// PlayerTrade returns a direct moniker (invControllers1691) and does not use this wrapper.
// Fitted/tuple sublocations and their pre-try dogma unload path are separate producers.
import type { Ask } from "./ask.ts";
import { BridgeCallError } from "./callMethod.ts";
import { hashedSetOrder, wholeHashOf } from "./py27DictOrder.ts";
import { readDictPairs, readRowField, unwrapLong, type JsonValue } from "./wire.ts";

interface Scope {
  readonly ask: Ask;
  readonly act: Ask;
  readonly current: () => void;
  readonly activeShipID: number | null;
  readonly dockedAt: number | null;
  readonly structureID: number | null;
  readonly now: () => number;
  /** Original RaiseLockError's blank reason and already-formatted FmtDate string. */
  readonly blankLockValues: (when: JsonValue) => Promise<JsonValue>;
}

interface HeldLock {
  readonly when: JsonValue;
  readonly error: string;
  readonly values: JsonValue;
}

const exactID = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const refusal = (key: string, values: JsonValue | null = null): BridgeCallError =>
  new BridgeCallError("CALL_REFUSED", key, 409, null, null, { key, values });

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
  let broker = { locks: new Map<number, HeldLock>() };
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
    // A whole pilot lifetime is isolated; same-pilot InvalidateCache replaces this broker's current map.
    const lifetime = broker;
    if (service !== "invbroker" || !["Add", "MultiAdd"].includes(method)) return scope.act(service, method, args, kwargs, of);
    const ids = method === "Add" ? [args[0]] : args[0];
    if (!Array.isArray(ids) || !ids.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      throw new Error("Ordinary inventory moves require exact numeric item IDs.");
    }
    if (scope.activeShipID !== null && ids.includes(scope.activeShipID)) {
      throw refusal("CanNotPlaceActiveShipInAnotherHangar");
    }
    // The backing property read is on this same inventory. The BFF's container cache owns its lifetime.
    const readOwn = async () => {
      const own = await scope.ask("invbroker", "GetSelfInvItem", [], null, of); scope.current();
      const itemID = readRowField(own, "itemID"), typeID = readRowField(own, "typeID");
      if (!exactID(itemID) || typeof typeID !== "number" || !Number.isSafeInteger(typeID) || typeID < 0) throw new Error("The destination inventory's own item and type could not be read.");
      return { itemID, typeID };
    };
    // Original Add1003/MultiAdd1032 evaluate itemID before quantity or persistent-lock guards.
    // A numeric key seeds it; the special hangar key requires actual backing metadata, even for an empty MultiAdd.
    // A structure's hangar alias binds GetInventoryFromId(structureID), not the station's special key.
    const seededID = exactID(of) ? of : of === "hangar" ? scope.structureID : null;
    let own = seededID !== null ? { itemID: seededID, typeID: null as number | null } : await readOwn();
    const acquired: number[] = [];
    const hold = (id: number, error: string, values: JsonValue) => lifetime.locks.set(id, {
      when: { type: "long", value: (BigInt(Math.trunc(scope.now())) * 10000n + 116444736000000000n).toString() }, error, values,
    });
    if (method === "Add") {
      const id = ids[0] as number;
      if (kwargs?.qty === 0) {
        console.error("Trying to add a stack with 0 quantity to a container. Fix your code.");
        return null;
      }
      if (scope.dockedAt !== null) {
        const persistent = await at(scope, scope.dockedAt); scope.current();
        if (persistent.has(String(id))) throw refusal("CrpItemIsLocked");
      }
      if (id === own.itemID) throw refusal("CannotPlaceItemInsideItself");
      // Argument evaluation primes typeID BEFORE TryLockItem, including when another operation holds the lock.
      if (own.typeID === null) own = await readOwn();
      const held = lifetime.locks.get(id);
      if (held) {
        const values = held.error ? held.values : await scope.blankLockValues(held.when); scope.current();
        throw refusal(held.error || "ItemIsLocked", values);
      }
      hold(id, "lockAddItemToContainer", { type: "dict", entries: [["containerType", own.typeID]] });
      // TryLockItem is outside the try: a failed contender never releases somebody else's lock.
      try {
        scope.current();
        return await scope.act(service, method, args, kwargs, of);
      } finally {
        // Native UnlockItem is by ID, including after a notice released/reacquired it; no ownership token.
        lifetime.locks.delete(id);
      }
    }
    // Ordinary move flags are cargo/bays/hangar/divisions; fitted CheckCanFit is not this path.
    for (const id of ids as number[]) {
      if (id === own.itemID) continue;
      if (scope.dockedAt !== null) {
        const persistent = await at(scope, scope.dockedAt); scope.current();
        if (persistent.has(String(id))) continue;
      }
      if (lifetime.locks.has(id)) continue;
      hold(id, "", { type: "dict", entries: [] }); acquired.push(id);
    }
    if (!acquired.length) return null;
    try {
      scope.current();
      await scope.act(service, method, [ordinaryMultiAddOrder(acquired), ...args.slice(1)], kwargs, of);
    } finally {
      for (const id of hashedSetOrder(acquired, wholeHashOf, String)) lifetime.locks.delete(id);
    }
    return true; // The original wrapper ignores the remote return; callers still verify custody.
  };

  return {
    act,
    // ItemLocking.OnLockedItemChange67-79. No location-list consumer is primed here.
    invalidate(location: number) { byLocation.delete(location); },
    // invCache.InvalidateCache573 resets broker locks, not the separate ItemLocking service's location cache.
    resetLocalLocks() { broker.locks = new Map(); },
    /** OnItemChange229-240 calls LockedItemChange before row cloning and all downstream cache work. */
    itemChanged(item: unknown, change: unknown) {
      const oldQuantity = readDictPairs(change).find(([key]) => unwrapLong(key) === 5n)?.[1];
      if (oldQuantity !== undefined && ((unwrapLong(oldQuantity) ?? 0n) < 0n || (unwrapLong(readRowField(item, "quantity")) ?? 0n) < 0n)) {
        throw new Error("OnItemChange in invCache: negative qty");
      }
      const id = unwrapLong(readRowField(item, "itemID"));
      if (id !== null && id > 0n && id <= BigInt(Number.MAX_SAFE_INTEGER)) broker.locks.delete(Number(id));
    },
    clear() { byLocation = new Map(); broker = { locks: new Map() }; },
  };
}
