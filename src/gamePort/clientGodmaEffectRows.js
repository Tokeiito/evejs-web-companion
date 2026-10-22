"use strict";

const { getDecodedNumberKind } = require("../gameProtocol/marshal");
const { decodedFieldRecord, createGodmaNativeRecordConverter } = require("./clientGodmaFreshness");

/** Sole named effect-row store on the captured original manager. Original
 * indexed rowsets/EffectWrapper and typed backing cells are shared. The named
 * refresh/cache-write source ports stop before genuine scatter/control/tasklet
 * continuation; this capability does not claim whole native event readiness.
 */
function createClientGodmaEffectRows({ runtime, owner, module, assertCurrent }) {
  const tuple = runtime.values.global("_attach_godma_freshness").call(owner).getAttr("tuple_key");
  const numeric = createGodmaNativeRecordConverter(runtime, tuple);
  const index = i => runtime.values.int(i);
  const lookup = item => runtime.values.long(BigInt(item));
  const contains = (container, key) => container.getAttr("__contains__").call(key).truth();
  const scalar = value => Buffer.isBuffer(value.scalar) ? value.scalar.toString("utf8") : value.scalar;
  // Build each incoming dictionary once, in wire insertion order. Preserve
  // decoder classes before slicing/spreading or normalizing numeric inputs.
  function incoming(record) {
    if (record.native) return record.native;
    const value = record.value;
    if (typeof value === "string" || Buffer.isBuffer(value)) return runtime.values.convert(value);
    if (Array.isArray(value)) return tuple.call(...value.map((part, i) => incoming({ value: part, kind: getDecodedNumberKind(value, i) })));
    if (value?.type === "list") {
      const list = module.getAttr("new_list").call();
      for (let i = 0; i < value.items.length; i++) list.getAttr("append").call(incoming({ value: value.items[i], kind: getDecodedNumberKind(value.items, i) }));
      return list;
    }
    if (value?.type === "dict") {
      const dict = module.getAttr("new_dict").call();
      for (const pair of value.entries) dict.setItem(incoming({ value: pair[0], kind: getDecodedNumberKind(pair, 0) }), incoming({ value: pair[1], kind: getDecodedNumberKind(pair, 1) }));
      return dict;
    }
    return numeric(record);
  }
  function snapshot(container) {
    const keys = module.getAttr("native_keys").call(container), result = [];
    for (let i = 0, n = keys.getAttr("__len__").call().scalar; i < n; i++) result.push(keys.getItem(index(i)));
    return result;
  }
  return Object.freeze({
    forManager(scope) {
      const manager = scope.manager;
      function current() {
        assertCurrent(); scope.assertCurrent();
        if (manager.getAttr("godma") !== owner.getAttr("instance")) throw new Error("The captured Godma manager was released.");
      }
      const field = name => { current(); return manager.getAttr(name); };
      function project(wrapper) {
        if (wrapper.kind === "NoneType") return null;
        const names = wrapper.getAttr("header").getAttr("Keys").call(), result = {};
        for (let i = 0, n = names.getAttr("__len__").call().scalar; i < n; i++) {
          const name = scalar(names.getItem(index(i)));
          Object.defineProperty(result, name, { enumerable: true, get() { current(); return scalar(wrapper.getAttr(name)); } });
        }
        return result;
      }
      function get(item, name) {
        current();
        return project(manager.getAttr("GetEffect").call(lookup(item), Buffer.from(name, "utf8")));
      }
      function* entries(item) {
        const outer = field("effectsByItemEffect"), id = lookup(item);
        if (!contains(outer, id)) return;
        const table = outer.getItem(id);
        for (const name of snapshot(table)) { current(); yield project(table.getItem(name)); }
      }
      function byID(item, effectID) {
        for (const row of entries(item)) if (Number(row.effectID) === Number(effectID)) return row;
        return null;
      }
      function applyNative(args, callbacks, originalArgs) {
        current();
        const result = module.getAttr("apply_fields").call(manager, args);
        if (result.kind === "NoneType") return false;
        if (result.getItem(index(1)).truth()) callbacks.onActivated(scalar(args.getItem(index(0))), scalar(args.getItem(index(1))));
        // Explicit existing local continuation boundary, not native SM/pwn or
        // uthread. No synthetic successful native event/scatter completion.
        callbacks.afterState({ itemID: scalar(args.getItem(index(0))), effect: result.getItem(index(0)), args: originalArgs, nativeArgs: args });
        return true;
      }
      return Object.freeze({
        get, byID, entries,
        has(item) { return contains(field("effectsByItemEffect"), lookup(item)); },
        refresh(item, type, info, doUpdate, callbacks, options) {
          current();
          const given = module.getAttr("new_info").call();
          given.setAttr("activeEffects", incoming(decodedFieldRecord(info, "activeEffects")));
          const time = options.time ?? decodedFieldRecord(info, "time");
          if (time.native || time.value !== undefined) given.setAttr("time", incoming(time));
          const events = module.getAttr("refresh_rows").call(manager, incoming(item), incoming(type), given, runtime.values.bool(doUpdate));
          // Environment-only wire projection follows successful publication;
          // it is not an active/timing store or a native service event.
          options.onPublished?.();
          for (let i = 0, n = events.getAttr("__len__").call().scalar; i < n; i++) applyNative(events.getItem(index(i)), callbacks);
        },
        apply(args, callbacks, { source = args, offset = 0 } = {}) {
          if (args.length < 10) throw new TypeError("Godma effect notice requires its ten positional arguments.");
          // error/actualStopTime belong to the external continuation and are
          // never inspected by the cached-field prefix. Preserve their raw
          // decoded objects instead of forcing unused objects through numeric
          // conversion (or replacing them with a fabricated None).
          return applyNative(tuple.call(...args.slice(0, 9).map((value, i) => incoming({ value, kind: getDecodedNumberKind(source, i + offset) }))), callbacks, args);
        },
        setActive(item, effectID, active) {
          current();
          const row = byID(item, effectID);
          if (!row) return false;
          const wrapper = manager.getAttr("GetEffect").call(lookup(item), Buffer.from(row.effectName, "utf8"));
          wrapper.setAttr("isActive", runtime.values.bool(active));
          return true;
        },
        defaultEffect(typeID) { current(); return project(manager.getAttr("GetDefaultEffect").call(lookup(typeID))); },
        drop(ids) { for (const id of ids) { current(); module.getAttr("drop").call(manager, lookup(id)); } },
        clear() { field("effectsByItemEffect").getAttr("clear").call(); },
      });
    },
  });
}

module.exports = { createClientGodmaEffectRows };
