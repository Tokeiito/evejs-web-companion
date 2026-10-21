"use strict";

/** Original crowset/Godma rowset and old-style StateManager CLASS bodies.
 * One shared source effect-header expression executes during class creation.
 * This does not construct or prime a manager, replace numeric stores, or
 * supply the unfinished native scheduling/BeNice continuation.
 */
async function createClientGodmaRowsets({ provider, godmaModule, inventoryHeader }) {
  const context = inventoryHeader.context;
  function assertCurrent() {
    if (context.transport.sessionLifecycle().closed || context.lifecycle().retired) throw new Error("The Godma rowset transport is closed.");
    context.assertCurrent();
  }
  assertCurrent();
  const [rows, errors, runtime] = await Promise.all([
    inventoryHeader.prepareRows(), inventoryHeader.staticService.prepareErrorLogging(), provider.ready(),
  ]);
  assertCurrent();
  if (errors.sessionContext !== context) throw new TypeError("Rowset logging must retain the same client context.");
  const module = runtime.values.global("_create_godma_rowset_types").call(godmaModule, rows.module, errors.module);
  return Object.freeze({
    module, rows, errors, inventoryHeader, godmaModule, context, assertCurrent,
    crowset: module.getAttr("crowset"), godmarowset: module.getAttr("godmarowset"),
    StateManager: module.getAttr("StateManager"), identity: runtime.identity,
  });
}

module.exports = { createClientGodmaRowsets };
