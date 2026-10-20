"use strict";

const { InventoryItems } = require("./inventoryItems");

// The client's inventory cache, kept for one pilot (eve/client/script/environment/invCache.py).
//
// The client holds one container for each key, as invCache.GetInventory and GetInventoryFromId make them: the
// station's hangar as (containerHangar, None), anything else by its own item as (itemID, None). A container is bound
// once and kept; asked for again it is the one held, and nothing is asked of the server (GetInventoryFromId 553 to
// 556). Each keeps the items it has listed and the flags it has listed (invCacheContainer.cachedItems, listed): a
// flag's items are asked for once (List 1131, ListByFlags 1167, the latter only for the flags not listed yet), and
// from then on the server's word of each item that changes is worked into what the container holds
// (invCache.OnItemChange 229 to 311, to the container the item was in and the one it is in now;
// invCacheContainer._ProcessItemChange 1326). Nothing is asked again after a notice, nor after a write of the
// pilot's own.
//
// _ProcessItemChange as the client's own bytecode has it (invCache.pyc, walked in its Python, 2026-10-16), not as
// its decompiled source prints it: the chain is the station's hangar / the corporation's deliveries / an item gone
// from here or emptied / an item come here / any other, each to the end. The source prints the last branch's body
// ("if shouldCache: cachedItems[itemID] = item") after the chain, as if an item that left were put back. It is not.
//
// What the containers are forgotten at is the client's too (ProcessSessionChange 143 to 168, DoBallRemove 135): all
// of them in another station, structure or solar system; the ship left behind in space; a ball that leaves the park.
//
// The container's own item is kept separately, as _SetItemData966-975 does. A first station hangar List needs it
// for the lazy itemID property; numeric container IDs are seeded by their bind, so their List does not fetch it.
// Its public item can separately be replaced by OnItemChange; that does not prime the backing typeID property.
// No capacity is kept here (the page reckons a container's capacity from what is listed).
// The cargo containers among a batch of changed items, which the client
// asks the server to validate (ValidateLocationCacheForItems), are not asked about.
// cachedItems retains its Python2 dictionary table across inserts/deletes;
// List scans that table, not insertion order. The input is each row ingress
// sequence: a remote DBRow set's allocator-dependent iteration is a separate
// boundary (CCP PyRowSet.cpp hashes object pointers), not an item-ID sort.

/** The columns of an inventory row by their index in it, as a change is given (const.ixItemID ... ixCustomInfo). */
const COLUMN_BY_IX = ["itemID", "typeID", "ownerID", "locationID", "flagID", "quantity", "groupID", "categoryID", "customInfo"];
/** const.ixOwnerID, ixFlag, ixQuantity, ixStackSize, ixSingleton. */
const IX = Object.freeze({ OWNER: 2, FLAG: 4, QUANTITY: 5, STACKSIZE: 9, SINGLETON: 10 });
/** const.containerHangar, containerCorpMarket, containerCapsuleerDeliveries. */
const CONTAINER_HANGAR = 10004;
const CONTAINER_CORP_MARKET = 10012;
const CONTAINER_CAPSULEER_DELIVERIES = 10015;
/** const.flagCorpDeliveries, flagCapsuleerDeliveries. */
const FLAG_CORP_DELIVERIES = 62;
const FLAG_CAPSULEER_DELIVERIES = 187;
/** const.corpHangarQueryRolesByFlag: the role a corporation's hangar division is read with, by its flag. */
const QUERY_ROLE_BY_FLAG = new Map([
  [115, 1048576n], [116, 2097152n], [117, 4194304n], [118, 8388608n], [119, 16777216n], [120, 33554432n], [121, 67108864n],
  [184, 4n],
]);
/** const.containerGroupIDs: wrecks, cargo, spawn, secure, audit log, freight and mission containers, overseers' belongings. */
const CONTAINER_GROUP_IDS = new Set([186, 12, 306, 340, 448, 649, 496, 952]);
/** idCheckers.IsSystemOrNPC: below the first player's number. */
const MIN_PLAYER_OWNER = 90000000;

/** A number off the wire as a number where one holds it. */
const num = (value) => {
  if (typeof value === "bigint") return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  return value === undefined ? null : value;
};
/** An item's ID as a key: its number; a charge in a module by its tuple (ship, flag, type). */
const itemKey = (value) => (Array.isArray(value) ? value.map((part) => String(num(part))).join("/") : num(value));
/** The key of a container, (location, owner) as the client's. */
const containerKey = (location, owner) => `${num(location)}|${owner === null || owner === undefined ? "" : num(owner)}`;
const itemsOf = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
/**
 * The rows a listing answered, out of whichever envelope it came in: a list; a Python set, as Tranquility answers a
 * flagged List (objectex1 of __builtin__.set and a one-tuple of its list); an object of one argument.
 */
const rowsOf = (answer) => {
  if (answer && answer.type === "objectex1" && Array.isArray(answer.header) && answer.header[0] && answer.header[0].value === "__builtin__.set") {
    return itemsOf(Array.isArray(answer.header[1]) ? answer.header[1][0] : null);
  }
  if (answer && answer.type === "object" && Array.isArray(answer.args)) return itemsOf(answer.args[0]);
  return itemsOf(answer);
};
/** A dict off the wire as a Map of its entries. */
const dictOf = (value) => new Map(value && Array.isArray(value.entries) ? value.entries.map(([k, v]) => [num(k), v]) : []);

/**
 * `rowFields(row)` reads an inventory row's fields by name. `session()` answers the pilot's session as the client
 * reads it: { stationid, charid, corpid, shipid, corprole (a BigInt) }.
 */
function createPilotInventory({ rowFields, session }) {
  /** The containers held, by key: { location, owner, objectID, items: Map(itemKey -> row), listed: Set(flag | null), work }. */
  const containers = new Map();
  /** The binds under way, by key: each a promise of the bound object, or of null where the bind failed. */
  const binding = new Map();
  /** How many times everything was let go: a bind begun before is not held after. */
  let forgotten = 0;

  /** A container bound: held from now on, by its key. */
  const hold = (key, objectID) => {
    const [location, owner] = key.split("|");
    if (!containers.has(key)) {
      containers.set(key, { location: num(Number(location)), owner: owner === "" ? null : num(Number(owner)), objectID, items: new InventoryItems(), listed: new Set(), work: Promise.resolve() });
    } else {
      containers.get(key).objectID = objectID;
    }
  };

  /** An item's fields, its stack size as the client's row has it (a singleton is one). */
  const fieldsOf = (row) => {
    const fields = rowFields(row);
    if (!fields) return null;
    const read = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, num(value)]));
    if (typeof read.stacksize !== "number") read.stacksize = typeof read.quantity === "number" ? (read.quantity < 0 ? 1 : read.quantity) : null;
    return read;
  };

  /** blue.DBRow(item) with the change's values put back: the item as it was. */
  const oldOf = (item, change) => {
    const old = { ...item };
    for (const [ix, value] of change) {
      const at = ix === IX.STACKSIZE || ix === IX.SINGLETON ? IX.QUANTITY : ix;
      if (COLUMN_BY_IX[at]) old[COLUMN_BY_IX[at]] = num(value);
    }
    return old;
  };

  /** An item's row in any container held, or null. */
  const rowOf = (itemID) => {
    const wanted = itemKey(itemID);
    for (const container of containers.values()) {
      if (container.items.has(wanted)) return container.items.get(wanted);
    }
    return null;
  };

  /** Public .item notice override, then the lazy backing row, then an already-listed parent row. */
  const ownRowOf = (container) => container.ownItem ?? container.selfItem ?? rowOf(container.location);

  /** What a container answers for what is listed in it: its rows that `keep` keeps, as a list. */
  const answerOf = (container, keep) => ({
    type: "list",
    items: [...container.items.values()].filter((row) => {
      const fields = fieldsOf(row);
      return fields !== null && keep(fields);
    }),
  });

  /** A container's work, one after another, so that two readings of one flag ask once. */
  const inTurn = (container, work) => {
    const done = container.work.then(work);
    container.work = done.catch(() => {});
    return done;
  };

  /** What a listing answered, taken into the container (invCacheContainer.List 1138 to 1142). */
  const takeListed = (container, answer) => {
    for (const row of rowsOf(answer)) {
      const fields = fieldsOf(row);
      if (fields === null) continue;
      container.items.set(itemKey(fields.itemID), row);
      container.listed.add(fields.flagID);
    }
  };

  /** Original _SetItemData keeps itemID/typeID/item together, independently of cachedItems. */
  function selfItem(key, ask) {
    const container = containers.get(key);
    if (!container) return ask();
    if (container.selfItem !== undefined) return Promise.resolve(container.selfItem);
    if (container.selfWork) return container.selfWork;
    const work = Promise.resolve().then(ask).then((row) => {
      const own = fieldsOf(row);
      if (!own || own.itemID == null || own.typeID == null) throw new Error("The inventory did not return its own item and type.");
      if (containers.get(key) === container) container.selfItem = row;
      return row;
    });
    container.selfWork = work;
    void work.finally(() => { if (container.selfWork === work) container.selfWork = null; }).catch(() => {});
    return work;
  }

  /** invCacheContainer._ProcessItemChange, for one container. */
  function processItemChange(container, row, item, old, change, s) {
    const { location, owner } = container;
    const id = itemKey(item.itemID);
    const { items } = container;
    let shouldCache = false;
    if (container.listed.has(item.flagID) || item.ownerID === s.charid) shouldCache = true;
    else if (item.locationID === s.shipid) shouldCache = true;
    else if (item.ownerID === s.corpid) {
      let role = 0n;
      if (QUERY_ROLE_BY_FLAG.has(item.flagID)) role = QUERY_ROLE_BY_FLAG.get(item.flagID);
      else {
        // self.item.groupID in const.containerGroupIDs: the container's own row, where one is held.
        const own = fieldsOf(ownRowOf(container));
        if (own && CONTAINER_GROUP_IDS.has(own.groupID) && !(item.locationID < MIN_PLAYER_OWNER)) {
          const held = containers.get(containerKey(item.locationID, null));
          const holder = fieldsOf(held ? ownRowOf(held) : rowOf(item.locationID));
          if (holder && QUERY_ROLE_BY_FLAG.has(holder.flagID)) role = QUERY_ROLE_BY_FLAG.get(holder.flagID);
        }
      }
      if ((s.corprole & role) !== 0n) shouldCache = true;
    }
    if (location === CONTAINER_HANGAR) {
      if (owner !== null && owner !== item.ownerID && owner !== old.ownerID) return;
      if (!s.stationid) return;
      if (owner !== null && item.ownerID === owner && change.has(IX.OWNER)) {
        items.set(id, row);
        return;
      }
      if (item.locationID !== s.stationid || item.stacksize === 0 || item.ownerID !== s.charid) {
        items.delete(id);
        return;
      }
      if (item.ownerID === s.charid) items.set(id, row);
    } else if (location === CONTAINER_CORP_MARKET || location === CONTAINER_CAPSULEER_DELIVERIES) {
      if (owner !== null && owner !== item.ownerID && owner !== old.ownerID) return;
      if (!s.stationid) return;
      if (item.locationID !== s.stationid || item.stacksize === 0 || item.ownerID !== s.corpid) {
        items.delete(id);
        return;
      }
      if (item.ownerID === s.corpid) {
        // Original compiled _ProcessItemChange1390-1399 deletes then reinserts
        // valid delivery rows even when custody is unchanged; retain the dummy slot history.
        if (items.has(id)) items.delete(id);
        items.set(id, row);
      }
    } else if (item.locationID !== location || item.stacksize === 0) {
      items.delete(id);
    } else if (old.locationID !== location && item.locationID === location) {
      items.delete(id);
      if (shouldCache) items.set(id, row);
    } else {
      items.delete(id);
      if (shouldCache) items.set(id, row);
    }
  }

  /** The key of the container an item is in, as invCache.OnItemChange reckons it (keyIs and keyWas, 244 to 276). */
  function keyFor(item, s) {
    let key = null;
    if (s.stationid && item.locationID === s.stationid) {
      if (item.ownerID === s.charid || item.ownerID === s.corpid) key = [CONTAINER_HANGAR, null];
      if (item.flagID === FLAG_CORP_DELIVERIES) key = [CONTAINER_CORP_MARKET, item.ownerID];
      if (item.flagID === FLAG_CAPSULEER_DELIVERIES) key = [CONTAINER_CAPSULEER_DELIVERIES, item.ownerID];
      else if (key === null) key = [CONTAINER_HANGAR, item.ownerID];
    }
    return key === null ? containerKey(item.locationID, null) : containerKey(key[0], key[1]);
  }

  return {
    selfItem,
    /** Every row any container holds. */
    rows: () => [...containers.values()].flatMap((container) => [...container.items.values()]),
    /** The key of the container (location, owner). */
    keyOf: containerKey,
    /**
     * The bound object of a container held, or of one being bound now, as a promise (null where the binding failed);
     * null where neither: asked for again, it is the one given (GetInventoryFromId 553).
     */
    boundObject(key) {
      const held = containers.get(key);
      if (held && held.objectID) return Promise.resolve(held.objectID);
      return binding.get(key) ?? null;
    },
    /**
     * A container being bound (`making`, the bind's promise): asked for meanwhile it is the one given, and once bound
     * it is held, unless everything was let go while it was being bound.
     */
    binding(key, making) {
      const generation = forgotten;
      const tracked = Promise.resolve(making).then(
        (objectID) => {
          if (objectID && generation === forgotten) hold(key, objectID);
          return objectID || null;
        },
        () => null,
      );
      binding.set(key, tracked);
      tracked.then(() => {
        if (binding.get(key) === tracked) binding.delete(key);
      });
      return tracked;
    },
    /**
     * invCacheContainer.List(flag): the flag's items, asked for (`ask()`) where the flag has not been listed, and
     * answered from what the container holds. `typeID` narrows it when present, including None/0 (List1159).
     * Undefined alone means no type filter. Where no container
     * is held for the key, it is asked and nothing is kept.
     */
    list(key, flag, ask, typeID, askSelf = null) {
      const container = containers.get(key);
      if (!container) return ask();
      return inTurn(container, async () => {
        if (!container.listed.has(flag)) {
          const answer = await ask();
          if (containers.get(key) !== container) return answer;
          takeListed(container, answer);
          // List1145 evaluates self.itemID after the remote listing, even when that listing is empty.
          if ([CONTAINER_HANGAR, CONTAINER_CORP_MARKET, CONTAINER_CAPSULEER_DELIVERIES].includes(container.location) && askSelf) await selfItem(key, askSelf);
          container.listed.add(flag);
        }
        return answerOf(container, (fields) => (flag === null || fields.flagID === flag) && (typeID === undefined || fields.typeID === typeID));
      });
    },
    /**
     * invCacheContainer.ListByFlags(flags): the flags not listed yet asked for (`ask(unlisted)`), alone, and the
     * flags' items answered from what the container holds.
     */
    listByFlags(key, flags, ask, typeID, askSelf = null) {
      const container = containers.get(key);
      if (!container) return ask(flags);
      return inTurn(container, async () => {
        if (flags.length === 0) return { type: "list", items: [] };
        const unlisted = flags.filter((flag) => !container.listed.has(flag));
        if (unlisted.length > 0) {
          const answer = await ask(unlisted);
          if (containers.get(key) !== container) return answer;
          takeListed(container, answer);
          if ([CONTAINER_HANGAR, CONTAINER_CORP_MARKET, CONTAINER_CAPSULEER_DELIVERIES].includes(container.location) && askSelf) await selfItem(key, askSelf);
          for (const flag of unlisted) container.listed.add(flag);
        }
        return answerOf(container, (fields) => flags.includes(fields.flagID) && (typeID === undefined || fields.typeID === typeID));
      });
    },
    /**
     * invCache.OnItemChange(item, change, location): the item worked into the container it was in and, where it is
     * in another or its flag changed, the one it is in now; the container that is the item let go where the pilot
     * gave it away. `change` is the server's dict of what was before.
     */
    itemChanged(row, changeDict) {
      const item = fieldsOf(row);
      if (item === null) return;
      const change = dictOf(changeDict);
      const old = oldOf(item, change);
      const s = session();
      const is = keyFor(item, s);
      const was = keyFor(old, s);
      if (containers.has(was)) processItemChange(containers.get(was), row, item, old, change, s);
      if ((is !== was || change.has(IX.FLAG)) && containers.has(is)) processItemChange(containers.get(is), row, item, old, change, s);
      const itself = containerKey(item.itemID, null);
      if (containers.has(itself)) {
        if (old.ownerID === s.charid && s.charid !== item.ownerID) containers.delete(itself);
        // Original OnItemChange295-300 replaces public .item, independently of _item/_typeID.
        // A cold notice must not suppress a later lazy typeID's GetSelfInvItem.
        else containers.get(itself).ownItem = row;
      }
    },
    /** One container let go (DoBallRemove; a ship left in space). */
    drop(key) {
      containers.delete(key);
    },
    /**
     * invCache.InvalidateCorpCache at a change of the pilot's corporation roles, docked: the containers that are the
     * corporation's own items let go, as far as the rows held tell whose a container is.
     */
    dropOwnedBy(ownerID) {
      for (const [key, container] of containers) {
        const own = fieldsOf(ownRowOf(container));
        if (own && own.ownerID === num(ownerID)) containers.delete(key);
      }
    },
    /** Every container let go (InvalidateCache), and the binds under way not held when they come. */
    forget() {
      containers.clear();
      binding.clear();
      forgotten += 1;
    },
  };
}

module.exports = { createPilotInventory, rowsOf, CONTAINER_HANGAR };
