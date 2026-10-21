"use strict";

const { createClientRowDescriptorLayout } = require("./clientRowDescriptorLayout");

/** Named source-port descriptor protocol on the installed Python heap.
 * Original virtual getters execute untouched; this class is explicitly NOT
 * the shipped Blue heap type or a general DBRow/unpickler/StateManager.
 */
async function createClientRowDescriptor({ provider }) {
  const layouts = await createClientRowDescriptorLayout({ provider });
  const runtime = await provider.ready(), values = runtime.values;
  const module = values.global("_create_row_descriptor_protocol").call();
  const Descriptor = module.getAttr("Descriptor"), provenance = new WeakMap();
  const builtins = values.global("__builtin__"), list = builtins.getAttr("list"), tuple = builtins.getAttr("tuple");
  const getters = new Map([
    ["eve.common.script.sys.eveCfg.StackSize", module.getAttr("StackSize")],
    ["eve.common.script.sys.eveCfg.Singleton", module.getAttr("Singleton")],
  ]);
  function materialize(wire) {
    if (!Array.isArray(wire?.list) || wire.list.length || !Array.isArray(wire.dict) || wire.dict.length) {
      throw new TypeError("Descriptor collection payloads are outside the inventory descriptor capability.");
    }
    const prepared = layouts.inventorySchema(wire), descriptor = Descriptor.call(prepared.schema);
    if (wire.header.length > 2) {
      const state = prepared.virtualState;
      if (state?.type !== "list" || !Array.isArray(state.items)) {
        throw new TypeError("The inventory descriptor requires its actual list of virtual resolvers.");
      }
      const native = list.call();
      for (const entry of state.items) {
        if (!Array.isArray(entry) || entry.length !== 2 ||
            !(Buffer.isBuffer(entry[0]) || typeof entry[0] === "string" && /^[\x00-\x7f]*$/.test(entry[0])) ||
            entry[1]?.type !== "token" || !getters.has(entry[1].value)) {
          throw new TypeError("The inventory virtual column needs a known original client resolver.");
        }
        const pair = list.call();
        pair.getAttr("append").call(Buffer.isBuffer(entry[0]) ? entry[0] : Buffer.from(entry[0], "ascii"));
        pair.getAttr("append").call(getters.get(entry[1].value));
        native.getAttr("append").call(tuple.call(pair));
      }
      descriptor.getAttr("__setstate__").call(native);
    }
    // Publish provenance only after all original getter resolution and state
    // conversion succeed. The caller can then assign its real header slot.
    provenance.set(descriptor, prepared);
    return descriptor;
  }
  return Object.freeze({
    module, Descriptor, layouts, identity: runtime.identity,
    create: schema => Descriptor.call(schema), materialize,
    provenance(descriptor) {
      if (!provenance.has(descriptor)) throw new TypeError("This descriptor has no wire provenance in this owner.");
      return provenance.get(descriptor);
    },
  });
}

module.exports = { createClientRowDescriptor };
