"use strict";

const owners = new WeakMap();

/** Real original per-client logging root/Manager, handler and FMT_EVE.
 * Private application namespaces share only installed stdlib/pure helpers.
 * Original atexit registration can retain native owners until process exit;
 * there is no claimed engine teardown, PyFinalize or full logmodule error graph.
 */
function createClientStdLogging({ provider, logging, preferences, sessionContext, boot }) {
  if (!provider || typeof provider.ready !== "function" || !logging?.module || !preferences?.handler || !boot || sessionContext?.preferences !== preferences || sessionContext.boot !== boot || typeof sessionContext.assertCurrent !== "function") throw new TypeError("Standard logging requires the same real logmodule, preferences, boot and effective session owner.");
  const existing = owners.get(logging);
  if (existing) {
    if (existing.provider !== provider || existing.preferences !== preferences || existing.sessionContext !== sessionContext || existing.boot !== boot) throw new Error("An initialized native logging namespace cannot change its client owners.");
    return existing.pending;
  }
  const slot = { provider, preferences, sessionContext, boot, pending: null };
  owners.set(logging, slot);
  // Reserve before awaiting: installing original handlers/atexit hooks has
  // native side effects. A failed attempt stays failed rather than reinitializing.
  slot.pending = (async () => {
    const runtime = await provider.ready();
    sessionContext.assertCurrent();
    const module = runtime.values.global("_create_std_logging").call(logging.module, preferences.handler, sessionContext.module);
    return Object.freeze({
      module: module.getAttr("logging"), helpers: module.getAttr("stdlogutils"), logserver: module.getAttr("logserver"),
      formatter: module.getAttr("formatter"), root: module.getAttr("root"),
      logmodule: logging, preferences, boot, sessionContext, identity: runtime.identity,
      assertCurrent: () => sessionContext.assertCurrent(),
      getLogger(...args) { sessionContext.assertCurrent(); return module.getAttr("logging").getAttr("getLogger").call(...args); },
    });
  })();
  return slot.pending;
}

module.exports = { createClientStdLogging };
