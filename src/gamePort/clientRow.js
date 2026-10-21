"use strict";

const { createClientRowDescriptor } = require("./clientRowDescriptor");

/** General named source-port row on the installed Python heap. Actual native
 * values enter the shared cells; object columns retain those same objects.
 * This is not a Blue heap type, wire unmarshaller or ready StateManager.
 */
async function createClientRow({ provider, descriptors = null }) {
  const runtime = await provider.ready();
  descriptors ??= await createClientRowDescriptor({ provider });
  const module = runtime.values.global("_create_row_protocol").call(descriptors.module);
  const Row = module.getAttr("Row");
  return Object.freeze({
    module, Row, descriptors, identity: runtime.identity,
    create: (...nativeArguments) => Row.call(...nativeArguments),
  });
}

module.exports = { createClientRow };
