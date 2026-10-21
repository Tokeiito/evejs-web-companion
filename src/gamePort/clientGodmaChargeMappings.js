"use strict";

/** Views of InitializeData's actual three native dictionaries. No JS mapping
 * cache or hardcoded reverse-list order. This prepares static relationships;
 * it does not populate native runtime attribute/charge/item stores.
 */
function createClientGodmaChargeMappings({ runtime, owner, assertCurrent }) {
  const zero = runtime.values.int(0), one = runtime.values.int(1);
  const bytes = name => Buffer.from(name, "utf8");
  const text = value => {
    const scalar = value.scalar;
    if (!Buffer.isBuffer(scalar)) throw new TypeError("An installed byte-string attribute name is required.");
    return scalar.toString("utf8");
  };
  return Object.freeze({
    forManager(manager) {
      function current() {
        assertCurrent();
        if (manager.getAttr("godma") !== owner.getAttr("instance")) throw new Error("The captured Godma manager was released.");
      }
      current();
      // This is the original method on the captured manager, including its
      // guard and partial-publication semantics, never a re-resolved owner.
      manager.getAttr("InitializeData").call();
      const mapping = name => { current(); return manager.getAttr(name); };
      const has = (field, name) => mapping(field).getAttr("__contains__").call(bytes(name)).truth();
      function* names(field, name) {
        const list = mapping(field).getItem(bytes(name));
        // Python's list iterator retains its original list and sees its
        // current length at each advance; do not sort or snapshot it here.
        for (let index = 0; ; index++) {
          current();
          if (index >= list.getAttr("__len__").call().scalar) return;
          yield text(list.getItem(runtime.values.int(index)));
        }
      }
      return Object.freeze({
        manager,
        has: name => has("chargedAttributeTauCaps", name),
        get(name) {
          const pair = mapping("chargedAttributeTauCaps").getItem(bytes(name));
          return [text(pair.getItem(zero)), text(pair.getItem(one))];
        },
        part(name, index) {
          return text(mapping("chargedAttributeTauCaps").getItem(bytes(name)).getItem(index === 0 ? zero : one));
        },
        hasMax: name => has("chargedAttributeTauCapsByMax", name),
        byMax: name => names("chargedAttributeTauCapsByMax", name),
        hasTau: name => has("chargedAttributesByTau", name),
        byTau: name => names("chargedAttributesByTau", name),
      });
    },
  });
}

module.exports = { createClientGodmaChargeMappings };
