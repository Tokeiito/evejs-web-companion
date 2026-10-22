"use strict";

const { ClientInventoryDescriptor, ClientInventoryDescriptorNotReadyError } = require("./clientInventoryDescriptor");
const { createClientRowDescriptor } = require("./clientRowDescriptor");
const { createClientRow } = require("./clientRow");
const { createClientInventoryRows } = require("./clientInventoryRows");

/** One native invCache header field, shared with the existing inventory owner.
 * Async JS demand is explicit; original compiled GetItemHeader runs warm only.
 * No synchronous RPC bridge, full invCache startup or ServiceManager claim.
 */
async function createClientInventoryHeader({ provider, staticService, getItemDescriptor }) {
  if (typeof getItemDescriptor !== "function" || typeof staticService?.prepareRun !== "function") {
    throw new TypeError("The same client's static service and real inventory RPC producer are required.");
  }
  const context = await staticService.prepareSessionContext();
  function assertCurrent() {
    if (context.transport.sessionLifecycle().closed || context.lifecycle().retired) {
      throw new Error("The inventory header transport is closed.");
    }
    context.assertCurrent(); // Native tasklet-entry/profile check, not liveness.
  }
  assertCurrent();
  await staticService.prepareRun(); // Attach the real Core logger; do not Run.
  assertCurrent();
  const runtime = await provider.ready(), descriptors = await createClientRowDescriptor({ provider });
  assertCurrent();
  const instance = runtime.values.global("_create_inventory_header_owner").call(staticService.types);
  const slot = {
    get() {
      assertCurrent();
      const value = instance.getAttr("_invCache__itemhdr");
      return value.kind === "NoneType" ? null : value;
    },
    set(value) { assertCurrent(); instance.setAttr("_invCache__itemhdr", value); },
  };
  const cache = new ClientInventoryDescriptor({
    headerSlot: slot,
    getItemDescriptor: async () => {
      assertCurrent();
      const wire = await getItemDescriptor();
      assertCurrent();
      // A genuine None stays None and remains a miss. Every non-None answer
      // must materialize before the source slot assignment and logging.
      return wire === null ? null : descriptors.materialize(wire);
    },
    LogInfo: (message, header) => {
      assertCurrent();
      return instance.getAttr("LogInfo").call(Buffer.from(message, "ascii"), header);
    },
  });
  let rows = null;
  let wireRows = null;
  let containerFields = null;
  return Object.freeze({
    instance, descriptors, staticService, context,
    prepareWireRows() {
      assertCurrent();
      return wireRows ??= (rows ??= createClientRow({ provider, descriptors })).then(prepared => {
        assertCurrent();
        return createClientInventoryRows({ runtime, rows: prepared, descriptors, assertCurrent });
      });
    },
    attachContainerFields(fields) {
      assertCurrent();
      if (fields.getAttr("broker") !== instance || !fields.getAttr("complete").truth()) throw new TypeError("Original container fields require this same complete broker owner.");
      if (containerFields && containerFields !== fields) throw new TypeError("The inventory broker already has another container field owner.");
      containerFields = fields;
    },
    invalidateContainerFields() {
      // Local teardown remains valid after transport retirement. It neither
      // demands RPC nor recreates an owner/header on a closed session.
      containerFields?.getAttr("invalidate_container_fields").call();
    },
    prepareRows() {
      assertCurrent();
      // One capability on this existing owner, using its SAME descriptor
      // class. No second inventory/effect registry or eager row projection.
      return rows ??= createClientRow({ provider, descriptors }).then(value => {
        assertCurrent();
        return value;
      });
    },
    GetItemHeader: force => cache.GetItemHeader(force),
    resetHeader: () => cache.resetHeader(),
    warmHeader() {
      if (slot.get() === null) throw new ClientInventoryDescriptorNotReadyError("explicit asynchronous header demand before original warm access");
      return instance.getAttr("GetItemHeader").call();
    },
  });
}

module.exports = { createClientInventoryHeader };
