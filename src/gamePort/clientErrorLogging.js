"use strict";

const owners = new WeakMap();

/** Original logmodule error/stream graph, on the current pre-UI client profile.
 * Real Bunch/prefs disable popups only when actual input says so; enabled UI or
 * loaded service-manager profiles require their real providers. Startup inputs
 * port Blue's consumed argv operations over captured process.argv. This is not
 * ExeFile expansion, BlueOS/SettingsSvc construction or browser-dialog readiness.
 */
function createClientErrorLogging({ provider, logging, standardLogging, taskletTimer, sessionContext }) {
  if (!provider || typeof provider.ready !== "function" || !logging?.module || standardLogging?.logmodule !== logging || standardLogging.sessionContext !== sessionContext || taskletTimer?.log !== logging.log || !taskletTimer?.backend) throw new TypeError("Error logging requires the same real standard/channel/session/timer owners.");
  const existing = owners.get(logging);
  if (existing) {
    if (existing.provider !== provider || existing.standardLogging !== standardLogging || existing.taskletTimer !== taskletTimer || existing.sessionContext !== sessionContext) throw new Error("An attached error namespace cannot change its actual client owners.");
    return existing.pending;
  }
  const argumentsSnapshot = Object.freeze([...process.argv]);
  const slot = { provider, standardLogging, taskletTimer, sessionContext, pending: null };
  owners.set(logging, slot);
  slot.pending = (async () => {
    const runtime = await provider.ready(), values = runtime.values;
    sessionContext.assertCurrent(); standardLogging.assertCurrent();
    const argumentsList = values.global("__builtins__").getItem(Buffer.from("list")).call();
    for (const argument of argumentsSnapshot) argumentsList.getAttr("append").call(values.unicode(argument));
    const module = values.global("_attach_error_logging").call(logging.module, standardLogging.helpers, sessionContext.module, taskletTimer.backend, argumentsList);
    function assertCurrent() { sessionContext.assertCurrent(); module.getAttr("assert_profile").call(); }
    const call = name => (...args) => { assertCurrent(); return module.getAttr(name).call(...args); };
    return Object.freeze({
      module: logging.module, localizationLogger: module.getAttr("localization_logger"), UserError: module.getAttr("UserError"),
      exceptions: module.getAttr("exceptions"),
      settings: module.getAttr("settings"), startup: module.getAttr("startup"), arguments: argumentsSnapshot,
      logging, standardLogging, taskletTimer, sessionContext, identity: runtime.identity, assertCurrent,
      LogTraceback: call("traceback_entry"), LogException: call("exception_entry"),
      localizationTraceback(...args) { assertCurrent(); return module.getAttr("localization_logger").getAttr("LogTraceback").call(...args); },
    });
  })();
  return slot.pending;
}

module.exports = { createClientErrorLogging };
