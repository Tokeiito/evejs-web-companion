"use strict";

/** Views over the ORIGINAL guard's dict/set/private fields. No second row or
 * metadata cache. Async transport and notice orchestration remain outside;
 * native invByID is not published until the cache is coherent.
 */
function createClientInventoryContainerStorage({ runtime, module, guard, wireRows, inventoryHeader, assertCurrent }) {
  const contains = (container, key) => container.getAttr("__contains__").call(key).truth();
  function field(name) { assertCurrent(); return guard.getAttr(name); }
  function key(value) {
    // Tuple spellings are lookup keys only. Insert the ACTUAL row.itemID.
    return wireRows.argument(typeof value === "string" && /^-?\d+\/-?\d+\/-?\d+$/.test(value)
      ? value.split("/").map(part => BigInt(part)) : value);
  }
  const items = {
    has(id) { return contains(field("cachedItems"), key(id)); },
    get(id) {
      const values = field("cachedItems"), wanted = key(id);
      return contains(values, wanted) ? wireRows.project(values.getItem(wanted)) : undefined;
    },
    set(id, wire) {
      const row = wireRows.materialize(wire);
      field("cachedItems").setItem(row.getAttr("itemID"), row); return items;
    },
    delete(id) {
      const values = field("cachedItems"), wanted = key(id);
      if (!contains(values, wanted)) return false;
      values.getAttr("__delitem__").call(wanted); return true;
    },
    *values() {
      const iterator = field("cachedItems").getAttr("itervalues").call();
      while (true) {
        assertCurrent();
        const step = module.getAttr("next_value").call(iterator);
        if (!step.getItem(0n).truth()) return;
        yield wireRows.project(step.getItem(1n));
      }
    },
  };
  const listed = {
    has(flag) { return contains(field("listed"), wireRows.argument(flag)); },
    add(flag, wire = null) {
      const value = wire === null ? wireRows.argument(flag) : wireRows.materialize(wire).getAttr("flagID");
      field("listed").getAttr("add").call(value); return listed;
    },
  };
  function optional(value) { return value.kind === "NoneType" ? undefined : wireRows.project(value); }
  return Object.freeze({
    items, listed,
    self() { return optional(field("_item")); },
    setSelf(wire) { assertCurrent(); module.getAttr("set_self_item").call(guard, wireRows.materialize(wire)); },
    own() { return optional(field("__dict__").getAttr("get").call(Buffer.from("item"))); },
    setOwn(wire) { assertCurrent(); guard.setAttr("item", wireRows.materialize(wire)); },
    needsItemID() { return field("_itemID").kind === "NoneType" && field("moniker").kind !== "NoneType"; },
    logListed() { assertCurrent(); guard.getAttr("LogInfo").call(Buffer.from("We now have listed"), field("listed"), Buffer.from("in"), field("key")); },
    async begin() {
      assertCurrent();
      if (inventoryHeader.instance.getAttr("_invCache__itemhdr").kind === "NoneType") await inventoryHeader.GetItemHeader();
      assertCurrent();
      return module.getAttr("new_listing").call();
    },
    finish(result, flags, many, typeID) {
      assertCurrent();
      if (many && flags.length === 0) return { type: "list", items: [] };
      const nativeFlags = wireRows.argument(many ? { type: "list", items: flags } : flags);
      const value = module.getAttr("finish_listing").call(guard, result, nativeFlags, many, typeID !== undefined,
        typeID === undefined ? runtime.values.none() : wireRows.argument(typeID));
      return { type: "list", items: Array.from({ length: Number(value.getAttr("__len__").call().scalar) }, (_, i) => wireRows.project(value.getItem(BigInt(i)))) };
    },
  });
}

module.exports = { createClientInventoryContainerStorage };
