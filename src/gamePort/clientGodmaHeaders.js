"use strict";

const { createClientGodmaRowsets } = require("./clientGodmaRowsets");

/** Original selected Godma constructor and descriptor properties. The existing
 * pilot dogma owns this capability; its numeric stores remain authoritative.
 * JS async demand precedes original native warm access, never a fake sync RPC.
 */
async function createClientGodmaHeaders({ provider, inventoryHeader }) {
  if (!inventoryHeader?.instance || !inventoryHeader.staticService?.types || !inventoryHeader.descriptors?.module) {
    throw new TypeError("The same pilot's native inventory header owner is required.");
  }
  const context = inventoryHeader.context;
  function assertCurrent() {
    if (context.transport.sessionLifecycle().closed || context.lifecycle().retired) throw new Error("The Godma header transport is closed.");
    context.assertCurrent();
  }
  assertCurrent();
  const runtime = await provider.ready();
  assertCurrent();
  const module = runtime.values.global("_create_godma_header_owner").call(
    inventoryHeader.staticService.types, inventoryHeader.instance, inventoryHeader.descriptors.module);
  const instance = module.getAttr("instance");
  const names = new Set(["itemrd", "sublocrd", "subloc_internalrd"]);
  function argument(name) {
    if (!names.has(name)) throw new TypeError("Unknown original Godma descriptor property.");
    return Buffer.from(name, "ascii");
  }
  let rowsets = null;
  return Object.freeze({
    module, instance, inventoryHeader, context,
    prepareRowsets() {
      assertCurrent();
      return rowsets ??= createClientGodmaRowsets({ provider, godmaModule: module, inventoryHeader });
    },
    async read(name) {
      assertCurrent();
      const key = argument(name);
      if (module.getAttr("needs_remote").call(key).truth()) {
        await inventoryHeader.GetItemHeader();
        assertCurrent();
      }
      // Recheck after actual async demand: None or a reset does not magically
      // create a synchronous native producer. Warm source reads current fields.
      return module.getAttr("read_warm").call(key);
    },
    readWarm(name) { assertCurrent(); return module.getAttr("read_warm").call(argument(name)); },
    reset() { assertCurrent(); return instance.getAttr("OnSessionReset").call(); },
  });
}

module.exports = { createClientGodmaHeaders };
