"use strict";

const owners = new WeakMap();

/** Original lookup methods/data phase on the same settings instance and real
 * English backend. Native code supplies text, original Python supplies language,
 * session/player, QA, important-text and error/fallback behavior. This does not
 * run Localization.__init__/LoadLanguageData or install property handlers.
 * The explicit source-backed fresh telemetry policy rejects enabled markup;
 * it is not a native BlueOS getter or ExeFile startup state.
 */
function createClientLocalizationLookup({ provider, localizationSettings, localizationData, errorLogging, sessionContext }) {
  if (!provider || typeof provider.ready !== "function" || !localizationSettings?.module || !localizationData?.module || errorLogging?.sessionContext !== sessionContext || errorLogging.standardLogging?.preferences !== localizationSettings.preferences || sessionContext?.boot !== localizationSettings.boot) throw new TypeError("Localization lookup requires the same real data, settings, logging and current session owners.");
  const old = owners.get(localizationSettings);
  if (old) {
    if (old.provider !== provider || old.localizationData !== localizationData || old.errorLogging !== errorLogging || old.sessionContext !== sessionContext) throw new Error("An attached localization lookup cannot change its native owners.");
    return old.pending;
  }
  const slot = { provider, localizationData, errorLogging, sessionContext, pending: null };
  owners.set(localizationSettings, slot); // Native phase failures retain their prefix.
  slot.pending = (async () => {
    const runtime = await provider.ready();
    function assertCurrent() {
      sessionContext.assertCurrent(); errorLogging.assertCurrent();
      if (sessionContext.transport.sessionLifecycle().closed) throw new Error("The native localization pilot has closed.");
    }
    assertCurrent();
    const module = runtime.values.global("_attach_localization_lookup").call(localizationSettings.module, localizationData.module, errorLogging.standardLogging.module, errorLogging.module, errorLogging.localizationLogger, sessionContext.module, errorLogging.startup);
    const instance = module.getAttr("instance"), policy = module.getAttr("policy"), entries = module.getAttr("entries");
    function assertLookup() {
      assertCurrent();
      if (policy.getAttr("markupZonesInPython").truth()) throw new Error("Existing localization decorators cannot adopt an enabled telemetry policy.");
    }
    const call = name => (...args) => { assertLookup(); return entries.getItem(Buffer.from(name)).call(...args); };
    return Object.freeze({
      module, instance, langutils: module.getAttr("langutils"), uiutil: module.getAttr("uiutil"), policy,
      localizationSettings, localizationData, errorLogging, sessionContext, identity: runtime.identity, assertCurrent: assertLookup,
      Get: call("Get"), GetByMessageID: call("GetByMessageID"), GetByLabel: call("GetByLabel"),
      GetImportantByMessageID: call("GetImportantByMessageID"), GetImportantByLabel: call("GetImportantByLabel"),
      invoke(name, args, kwargs) { assertLookup(); return module.getAttr("invoke").call(name, args, kwargs); },
    });
  })();
  return slot.pending;
}

module.exports = { createClientLocalizationLookup };
