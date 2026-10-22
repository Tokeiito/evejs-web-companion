"use strict";

const { getDecodedNumberKind } = require("../gameProtocol/marshal");
const { decodedFieldRecord, createGodmaNativeRecordConverter } = require("./clientGodmaFreshness");

/** Canonical numeric storage on the SAME original StateManager. These are
 * actual dicts/scalars and mutable charge lists, with no JS value/type/input
 * maps. Explicit supplied-info Refresh is original code; change is still the
 * bounded numeric source port, pending genuine native item metadata/Apply.
 */
function createClientGodmaNumericValues({ runtime, owner, module, assertCurrent }) {
  const tuple = runtime.values.global("_attach_godma_freshness").call(owner).getAttr("tuple_key");
  const native = createGodmaNativeRecordConverter(runtime, tuple);
  const nameBytes = name => Buffer.from(name, "utf8");
  const index = i => runtime.values.int(i);
  function record(value) {
    const type = value.kind;
    const kind = type === "float" ? "real" : type === "int" || type === "long" ? "integer" : undefined;
    return Object.freeze({ value: value.scalar, native: value,
      kind: kind && Object.freeze({ kind, pythonType: type, source: "original-godma-heap" }) });
  }
  return Object.freeze({
    forManager(scope, { now, attributeKey, readAttributeRecord }) {
      const manager = scope.manager;
      function current() {
        assertCurrent(); scope.assertCurrent();
        if (manager.getAttr("godma") !== owner.getAttr("instance")) throw new Error("The captured Godma manager was released.");
      }
      const field = name => { current(); return manager.getAttr(name); };
      // Public lookup aliases are explicitly longs. Ingress insertion keys
      // instead use original decoder records, before numeric normalization.
      const lookup = item => runtime.values.long(BigInt(item));
      const contains = (dict, key) => dict.getAttr("__contains__").call(key).truth();
      const dictionary = (fieldName, item) => {
        const outer = field(fieldName);
        return contains(outer, item) ? outer.getItem(item) : undefined;
      };
      const scalarValues = item => dictionary("attributesByItemAttribute", item);
      const charges = item => dictionary("chargedAttributesByItemAttribute", item);
      const hasName = (dict, name) => dict && contains(dict, name);
      const name = attributeID => nameBytes(attributeKey(attributeID));
      function* reverseNames(fieldName, key) {
        const list = field(fieldName).getItem(key);
        for (let i = 0; ; i++) {
          current();
          if (i >= list.getAttr("__len__").call().scalar) return;
          yield list.getItem(index(i));
        }
      }
      function read(itemID, attributeID, at) {
        const item = lookup(itemID), key = name(attributeID), states = charges(item);
        if (hasName(states, key)) {
          const state = states.getItem(key);
          // Native Ec==0 precedes any clock demand. There is no fake blue.os:
          // the existing explicit Node timestamp producer remains the boundary.
          const time = module.getAttr("zero_capacity").call(state).truth() ? runtime.values.none()
            : at === undefined || at === null ? runtime.values.long(now()) : runtime.values.convert(at);
          return record(module.getAttr("charge_at").call(manager, state, time));
        }
        const values = scalarValues(item);
        return hasName(values, key) ? record(values.getItem(key)) : undefined;
      }
      function createCharge(item, key, amount, time) {
        current();
        // Original helper owns division/read order, list construction, store
        // and logging. A genuine uncached metadata or SimTime demand can fail;
        // storage preparation does not manufacture that missing dependency.
        const pair = field("chargedAttributeTauCaps").getItem(key);
        return manager.getAttr("CreateChargedAttribute").call(item, key, amount, time, pair);
      }
      function refresh(itemID, info, doUpdate, rawItem) {
        current();
        const time = decodedFieldRecord(info, "time"), wallclock = decodedFieldRecord(info, "wallclockTime");
        const incoming = decodedFieldRecord(info, "attributes").value;
        if (!Array.isArray(incoming?.entries)) throw new TypeError("Original numeric refresh requires an attribute dictionary.");
        const given = module.getAttr("new_info").call(native(time), native(wallclock));
        const attributes = given.getAttr("attributes");
        // Build the receiving Python dict ONCE in wire insertion order. The
        // original Refresh then iterates its actual native table order.
        for (const pair of incoming.entries) attributes.setItem(
          native({ value: pair[0], kind: getDecodedNumberKind(pair, 0) }),
          native({ value: pair[1], kind: getDecodedNumberKind(pair, 1) }));
        return manager.getAttr("RefreshItemAttributes").call(native(rawItem), given, doUpdate);
      }
      function change(itemID, attributeID, time, amount, kind, mappings, raw) {
        current();
        const item = native(raw.item), values = scalarValues(item);
        if (!values) return false;
        const key = owner.getAttr("manager_data").getAttr("data").getAttr("get_attribute_name").call(native(raw.attribute));
        const old = readAttributeRecord(itemID, attributeKey(attributeID), scope);
        const value = native({ value: amount, kind }), oldValue = native(old), stamp = native(raw.time);
        if (module.getAttr("equal").call(oldValue, value).truth()) return false;
        values.setItem(key, value);
        if (mappings.has(attributeKey(attributeID))) {
          module.getAttr("ensure_charge_item").call(manager, item);
          createCharge(item, key, value, stamp);
        } else if (mappings.hasMax(attributeKey(attributeID))) {
          for (const chargedKey of reverseNames("chargedAttributeTauCapsByMax", key)) {
            const chargedName = chargedKey.scalar.toString("utf8"), states = charges(item);
            if (!states) continue;
            if (hasName(states, chargedKey)) {
              const charge = native(readAttributeRecord(itemID, chargedName, scope));
              const adjusted = module.getAttr("ratio_charge").call(charge, value, oldValue);
              createCharge(item, chargedKey, adjusted, stamp);
              break;
            }
            const pair = field("chargedAttributeTauCaps").getItem(chargedKey);
            if (values.getAttr("get").call(pair.getItem(index(0))).truth() && values.getAttr("get").call(pair.getItem(index(1))).truth()) {
              createCharge(item, chargedKey, values.getItem(chargedKey), stamp);
              break;
            }
          }
        } else if (mappings.hasTau(attributeKey(attributeID))) {
          for (const chargedKey of reverseNames("chargedAttributesByTau", key)) {
            const chargedName = chargedKey.scalar.toString("utf8");
            if (!hasName(charges(item), chargedKey)) continue;
            createCharge(item, chargedKey, native(readAttributeRecord(itemID, chargedName, scope)), stamp);
            break;
          }
        }
        return true;
      }
      return Object.freeze({
        manager, refresh, change, record: read,
        scalarRecord(item, attribute) {
          const key = name(attribute), values = scalarValues(lookup(item));
          return hasName(values, key) ? record(values.getItem(key)) : undefined;
        },
        value: (item, attribute, at) => read(item, attribute, at)?.value,
        has: item => contains(field("attributesByItemAttribute"), lookup(item)),
        chargeInputs(item, attribute) {
          const key = name(attribute), states = charges(lookup(item));
          if (!hasName(states, key)) return undefined;
          const list = states.getItem(key);
          // Debug view of CURRENT four cells only. Raw rechargeTime is not
          // retained by the client and must never become another authority.
          return Object.freeze({ amount: record(list.getItem(index(0))), time: record(list.getItem(index(1))),
            tau: record(list.getItem(index(2))), capacity: record(list.getItem(index(3))) });
        },
        drop(ids) { for (const item of ids) { current(); module.getAttr("drop").call(manager, lookup(item)); } },
        clear() {
          // Explicit local teardown, never an implementation of Release.
          field("attributesByItemAttribute").getAttr("clear").call();
          field("chargedAttributesByItemAttribute").getAttr("clear").call();
        },
      });
    },
  });
}

module.exports = { createClientGodmaNumericValues };
