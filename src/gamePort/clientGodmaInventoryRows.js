"use strict";

/** Native backing rows + location dict-of-sets only. Real passive inventory
 * registrations remain owned by the existing transport inventory cache. No
 * invented invByID containers, whole native notice/Prime or loaded-node claim.
 */
function createClientGodmaInventoryRows({ runtime, owner, module, assertCurrent, wireRows }) {
  if (!wireRows?.materialize || !wireRows?.project) throw new TypeError("The same inventory owner's wire-row ingress is required.");
  const lookupKey = value => value === null ? runtime.values.none() : runtime.values.long(BigInt(value));
  const jsKey = value => {
    const scalar = value.scalar;
    return typeof scalar === "bigint" && scalar >= BigInt(Number.MIN_SAFE_INTEGER) && scalar <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scalar) : scalar;
  };
  return Object.freeze({
    forManager(scope) {
      const manager = scope.manager;
      // Operand aliases live only for this synchronous admission operation,
      // not across awaits or in a second retained metadata registry.
      let ingressKeys = [];
      const key = value => ingressKeys.find(([id]) => id === value)?.[1] ?? lookupKey(value);
      function current() {
        assertCurrent(); scope.assertCurrent();
        if (manager.getAttr("godma") !== owner.getAttr("instance")) throw new Error("The captured Godma manager was released.");
      }
      const field = name => { current(); return manager.getAttr(name); };
      const contains = (container, item) => container.getAttr("__contains__").call(item).truth();
      function snapshot(container) {
        const keys = module.getAttr("native_keys").call(container), result = [];
        for (let i = 0, n = keys.getAttr("__len__").call().scalar; i < n; i++) result.push(keys.getItem(runtime.values.int(i)));
        return result;
      }
      function project(row) {
        current();
        return wireRows.project(row);
      }
      function materialize(row) {
        current();
        return wireRows.materialize(row);
      }
      const rows = {
        has: item => contains(field("invitems"), key(item)),
        get(item) {
          const id = key(item);
          return contains(field("invitems"), id) ? project(module.getAttr("raw_item").call(manager, id)) : undefined;
        },
        set(item, row) {
          const value = materialize(row);
          const itemKey = value.getAttr("itemID"), locationKey = value.getAttr("locationID");
          ingressKeys = [[jsKey(itemKey), itemKey], [jsKey(locationKey), locationKey]];
          // Incoming itemID is the actual packed cell (a Python long), not the
          // normalized key used by the bounded admission algorithm.
          field("invitems").setItem(itemKey, value);
          return rows;
        },
        delete(item) {
          const values = field("invitems"), id = key(item);
          if (!contains(values, id)) return false;
          values.getAttr("__delitem__").call(id); return true;
        },
        clear() { field("invitems").getAttr("clear").call(); },
        *[Symbol.iterator]() {
          for (const item of snapshot(field("invitems"))) { current(); yield [jsKey(item), project(module.getAttr("raw_item").call(manager, item))]; }
        },
      };
      function setView(value) {
        return {
          add(item) { current(); value.getAttr("add").call(key(item)); return this; },
          delete(item) {
            current(); const id = key(item);
            if (!contains(value, id)) return false;
            value.getAttr("remove").call(id); return true;
          },
          remove(item) { current(); value.getAttr("remove").call(key(item)); },
        };
      }
      const locations = {
        has: item => contains(field("itemsByLocationID"), key(item)),
        get(item) { const values = field("itemsByLocationID"), id = key(item); return contains(values, id) ? setView(values.getItem(id)) : undefined; },
        required(item) { return setView(field("itemsByLocationID").getItem(key(item))); },
        set(item, value) { field("itemsByLocationID").setItem(key(item), value); return locations; },
        delete(item) {
          const values = field("itemsByLocationID"), id = key(item);
          if (!contains(values, id)) return false;
          values.getAttr("__delitem__").call(id); return true;
        },
        *keys() { for (const item of snapshot(field("itemsByLocationID"))) { current(); yield jsKey(item); } },
        clear() { field("itemsByLocationID").getAttr("clear").call(); },
      };
      return Object.freeze({ rows, itemsByLocation: locations, emptySet() { current(); return module.getAttr("empty_set").call(); } });
    },
  });
}

module.exports = { createClientGodmaInventoryRows };
