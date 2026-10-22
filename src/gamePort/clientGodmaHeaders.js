"use strict";

const { createClientGodmaRowsets } = require("./clientGodmaRowsets");
const { createClientGodmaFreshness } = require("./clientGodmaFreshness");
const { createClientGodmaChargeMappings } = require("./clientGodmaChargeMappings");
const { createClientGodmaNumericValues } = require("./clientGodmaNumericValues");
const { createClientGodmaInventoryRows } = require("./clientGodmaInventoryRows");
const { createClientGodmaEffectRows } = require("./clientGodmaEffectRows");
const { createClientInventorySessionChecks } = require("./clientInventorySessionChecks");

/** Original selected Godma constructor and descriptor properties. The existing
 * pilot dogma owns this capability and its prepared canonical numeric stores.
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
  let managerPreparation = null;
  let managerDataPreparation = null;
  let typeWrapperPreparation = null;
  let freshnessPreparation = null;
  let chargeMappingPreparation = null;
  let numericValuePreparation = null;
  let inventoryRowsPreparation = null;
  let effectRowsPreparation = null;
  let inventoryCheckPreparation = null;
  function prepareStateManager() {
    assertCurrent();
    return managerPreparation ??= (async () => {
      const types = await (rowsets ??= createClientGodmaRowsets({ provider, godmaModule: module, inventoryHeader }));
      assertCurrent();
      const constantsOwner = runtime.values.global("_prepare_godma_state_manager").call(module, types.module);
      // Explicit async preparation, separate from native cold tasklet/RPC
      // publication. The original lazy call still owns the manager slot.
      if (module.getAttr("needs_remote").call(Buffer.from("itemrd")).truth()) {
        await inventoryHeader.GetItemHeader();
        assertCurrent();
      }
      return Object.freeze({
        module, constants: constantsOwner.getAttr("appConst"), rowsets: types, context,
        getWarm() { assertCurrent(); return module.getAttr("get_state_manager_warm").call(); },
      });
    })();
  }
  function prepareStateManagerData() {
    assertCurrent();
    return managerDataPreparation ??= (async () => {
      const [manager, attributes] = await Promise.all([
        prepareStateManager(), inventoryHeader.staticService.prepareAttributes(),
      ]);
      assertCurrent();
      const dataOwner = runtime.values.global("_attach_godma_state_manager_data").call(module, attributes.data);
      return Object.freeze({
        module: dataOwner, manager, attributes, context,
        initializeWarm() { assertCurrent(); return dataOwner.getAttr("initialize_warm").call(); },
      });
    })();
  }
  return Object.freeze({
    module, instance, inventoryHeader, context,
    prepareRowsets() {
      assertCurrent();
      return rowsets ??= createClientGodmaRowsets({ provider, godmaModule: module, inventoryHeader });
    },
    prepareStateManager,
    prepareStateManagerData,
    prepareInventorySessionChecks() {
      assertCurrent();
      return inventoryCheckPreparation ??= (async () => {
        await prepareStateManager();
        assertCurrent();
        const checks = runtime.values.global("_attach_inventory_session_checks").call(module, context.module);
        return createClientInventorySessionChecks({ runtime, module: checks, context, assertCurrent });
      })();
    },
    prepareEffectRows() {
      assertCurrent();
      return effectRowsPreparation ??= (async () => {
        await prepareStateManager();
        assertCurrent();
        const rows = runtime.values.global("_attach_godma_effect_rows").call(module);
        return createClientGodmaEffectRows({ runtime, owner: module, module: rows, assertCurrent });
      })();
    },
    prepareInventoryRows() {
      assertCurrent();
      return inventoryRowsPreparation ??= (async () => {
        await prepareStateManager();
        assertCurrent();
        const rows = runtime.values.global("_attach_godma_inventory_rows").call(module);
        return createClientGodmaInventoryRows({ runtime, owner: module, module: rows, assertCurrent });
      })();
    },
    prepareChargeMappings() {
      assertCurrent();
      return chargeMappingPreparation ??= (async () => {
        await prepareStateManagerData();
        assertCurrent();
        return createClientGodmaChargeMappings({ runtime, owner: module, assertCurrent });
      })();
    },
    prepareNumericValues() {
      assertCurrent();
      return numericValuePreparation ??= (async () => {
        await prepareStateManagerData();
        assertCurrent();
        const moduleValues = runtime.values.global("_attach_godma_numeric_values").call(module);
        return createClientGodmaNumericValues({ runtime, owner: module, module: moduleValues, assertCurrent });
      })();
    },
    prepareFreshness() {
      assertCurrent();
      return freshnessPreparation ??= (async () => {
        await prepareStateManager();
        assertCurrent();
        const freshness = runtime.values.global("_attach_godma_freshness").call(module);
        return createClientGodmaFreshness({ runtime, owner: module, module: freshness, context, assertCurrent });
      })();
    },
    prepareTypeWrappers() {
      assertCurrent();
      return typeWrapperPreparation ??= (async () => {
        const [managerData, fullLoad] = await Promise.all([
          prepareStateManagerData(), inventoryHeader.staticService.prepareFullLoad(),
        ]);
        assertCurrent();
        fullLoad.localization.assertCurrent();
        const typeOwner = runtime.values.global("_attach_godma_type_wrappers").call(module, fullLoad.module);
        function assertTypes() { assertCurrent(); fullLoad.localization.assertCurrent(); }
        return Object.freeze({
          module: typeOwner, managerData, fullLoad, context, TypeWrapper: typeOwner.getAttr("TypeWrapper"),
          getWarm(typeID) { assertTypes(); return typeOwner.getAttr("get_warm").call(typeID); },
          readWarm(typeID, name) { assertTypes(); return typeOwner.getAttr("read_warm").call(typeID, name); },
          attributeExistsWarm(typeID, name) { assertTypes(); return typeOwner.getAttr("attribute_exists_warm").call(typeID, name); },
        });
      })();
    },
    getStateManagerWarm() {
      assertCurrent();
      return module.getAttr("get_state_manager_warm").call();
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
