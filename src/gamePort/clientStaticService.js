"use strict";

const constantNames = Object.freeze(["effectHiPower", "effectLoPower", "effectMedPower", "effectSkillEffect"]);

/**
 * Prepare the original installed Core/Base/Client static CONSTRUCTOR types.
 * Each create() invokes original Core.__init__, virtual InitService and Base
 * __init__ against this client's real clock, logmodule and Handler. The native
 * heap owns all fields and shared class literals; failures retain their prefix
 * on an explicitly allocated instance. prepareAttributes() separately binds
 * original attribute helpers to real cFSD data; its load(instance) executes
 * original LoadAttributes on that SAME instance. preparePhases() binds the other
 * three original phases and lazy native physical/type helpers. The separate
 * localization settings preparation retains real boot/preferences and original
 * cleaner methods; it does not load messages or initialize localization. The
 * separate localization data preparation retains the actual shared native
 * English backend, without publishing the settings/session/Get chain.
 * prepareSessionContext() retains the configured original Sissy field owner;
 * production supplies the same effective owner prepared before login.
 * prepareStdLogging() retains original per-client root/Manager/handler/FMT_EVE
 * over those same owners. prepareErrorLogging() separately attaches the original
 * pre-UI error graph; prepareLocalizationLookup() extends the same settings
 * instance with original Get/Important methods and actual main-label data.
 * prepareFullLoad() binds the original timed Load and its native group/cfg tail.
 * prepareRun() binds original Run, weak reload monitors and cache refresh on
 * that same owner. Disk watching, ServiceManager state, generic config/counter
 * services and full client/IM readiness remain separate.
 */
async function createClientStaticService({ provider, clock, logging, preferences, taskletTimer = null, constants, builtData = null, attributeConstants = null, typeAttributeConstants = null, loadTailConstants = null, createLocalizationSettings = null, localizationData = null, createSessionContext = null, transportSession = null, createStdLogging = null, createErrorLogging = null, createLocalizationLookup = null }) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed runtime provider is required.");
  if (!clock || typeof clock.getWallclockTimeNow !== "function") throw new TypeError("The client's actual native wallclock is required.");
  if (!logging?.module || !preferences?.handler || typeof constants !== "function") throw new TypeError("Real logmodule, preference owner and installed constants are required.");
  if (taskletTimer !== null && (taskletTimer.clock !== clock || taskletTimer.log !== logging.log)) throw new TypeError("The static service must share its client's actual clock and timer logger.");
  const [runtime, loaded] = await Promise.all([provider.ready(), constants()]);
  if (!loaded || constantNames.some(name => !Number.isSafeInteger(loaded[name]))) throw new TypeError("Installed static constructor effect constants are unavailable.");
  const values = runtime.values;
  const now = values.wrap(runtime.binding.wallclockBackend(() => clock.getWallclockTimeNow()));
  const types = values.global("_create_static_service_types").call(now, logging.module, preferences.handler, ...constantNames.map(name => values.int(loaded[name])));
  const Client = types.getAttr("ClientDogmaStaticSvc");
  let attributeData = null, pendingAttributes = null;
  let phases = null, pendingPhases = null;
  let localizationSettings = null, pendingLocalizationSettings = null;
  let nativeLocalization = null, pendingLocalizationData = null;
  let sessionContext = null, pendingSessionContext = null;
  let stdLogging = null, pendingStdLogging = null;
  let errorLogging = null, pendingErrorLogging = null;
  let lookup = null, pendingLookup = null;
  let fullLoad = null, pendingFullLoad = null;
  let runOwner = null, pendingRun = null;
  function prepareRun() {
    if (runOwner !== null) return Promise.resolve(runOwner);
    if (pendingRun !== null) return pendingRun;
    pendingRun = Promise.all([prepareFullLoad(), prepareStdLogging(), prepareSessionContext()]).then(([fullLoad, standardLogging, sessionContext]) => {
      fullLoad.localization.assertCurrent();
      const module = values.global("_attach_static_run").call(fullLoad.module, standardLogging.module, standardLogging.helpers, sessionContext.module, logging.module);
      function assertCurrent() { fullLoad.localization.assertCurrent(); module.getAttr("assert_profile").call(); }
      runOwner = Object.freeze({
        module, fullLoad, standardLogging, sessionContext, signal: module.getAttr("signal"),
        run(instance, ...args) { assertCurrent(); return module.getAttr("run").call(instance, ...args); },
        emit(name) { assertCurrent(); return module.getAttr("emit").call(Buffer.from(name)); },
        // Explicitly adopted fresh native snapshots, not original disk loading.
        adoptSnapshot(name, raw) { assertCurrent(); return module.getAttr("adopt_snapshot").call(Buffer.from(name), raw); },
        assertCurrent,
      });
      return runOwner;
    });
    return pendingRun; // Failed native attachment retains its prefix.
  }
  function prepareFullLoad() {
    if (fullLoad !== null) return Promise.resolve(fullLoad);
    if (pendingFullLoad !== null) return pendingFullLoad;
    if (!taskletTimer || !builtData || typeof loadTailConstants !== "function") throw new Error("Actual native full static Load inputs are not configured.");
    // Attachment mutates existing native owners. Keep failure/prefix sticky;
    // never recreate their classes, indexes or caches to hide a partial attempt.
    pendingFullLoad = Promise.all([preparePhases(), prepareLocalizationLookup(), builtData.table("groupsOrdered"), builtData.table("categoriesOrdered"), loadTailConstants()])
      .then(([phases, localization, groups, categories, constants]) => {
        const names = ["categoryCharge", "attributeFactionID", "groupControlBunker", "categoryModule", "categoryStructureModule", "categoryStarbase"];
        if (!constants || names.some(name => !Number.isSafeInteger(constants[name]))) throw new TypeError("Installed static Load tail constants are unavailable.");
        localization.assertCurrent();
        const dictionary = preferences.handler.getAttr("__dict__").getAttr("__class__").call();
        for (const name of names) dictionary.setItem(Buffer.from(name), values.int(constants[name]));
        const module = values.global("_attach_static_load").call(types, phases.data, phases.evetypes, groups, categories, localization.module, taskletTimer.module, dictionary);
        fullLoad = Object.freeze({
          module, phases, localization, groups, categories, cfg: module.getAttr("cfg"),
          identity: Object.freeze({ groups: builtData.identity("groupsOrdered"), categories: builtData.identity("categoriesOrdered") }),
          // Original Load returns None. Only a normal return establishes this
          // invocation completed; no Run/monitor/IM readiness is inferred.
          load(instance) { localization.assertCurrent(); return module.getAttr("load").call(instance); },
        });
        return fullLoad;
      });
    return pendingFullLoad;
  }
  function prepareLocalizationLookup() {
    if (lookup !== null) return Promise.resolve(lookup);
    if (pendingLookup !== null) return pendingLookup;
    if (typeof createLocalizationLookup !== "function") throw new Error("Actual original localization lookup is not configured.");
    const reading = Promise.all([prepareLocalizationSettings(), prepareLocalizationData(), prepareErrorLogging()])
      .then(([localizationSettings, localizationData, errorLogging]) => createLocalizationLookup({ localizationSettings, localizationData, errorLogging, sessionContext }))
      .then(owner => {
        if (!owner?.instance || owner.localizationSettings !== localizationSettings || owner.localizationData !== nativeLocalization || owner.errorLogging !== errorLogging || owner.sessionContext !== sessionContext) throw new Error("Localization lookup must retain the same native client owners.");
        owner.assertCurrent(); lookup = owner; return owner;
      });
    pendingLookup = reading;
    const forget = () => { if (pendingLookup === reading) pendingLookup = null; };
    reading.then(forget, forget); return reading;
  }
  function prepareErrorLogging() {
    if (errorLogging !== null) return Promise.resolve(errorLogging);
    if (pendingErrorLogging !== null) return pendingErrorLogging;
    if (typeof createErrorLogging !== "function" || !taskletTimer) throw new Error("Actual original error graph and timer inputs are not configured.");
    const reading = prepareStdLogging().then(standardLogging => createErrorLogging({ standardLogging, sessionContext })).then(owner => {
      if (!owner?.module || !owner.localizationLogger || owner.logging !== logging || owner.standardLogging !== stdLogging || owner.taskletTimer !== taskletTimer || owner.sessionContext !== sessionContext) throw new Error("Error logging must retain the same native client owners.");
      owner.assertCurrent();
      errorLogging = owner; return owner;
    });
    pendingErrorLogging = reading;
    const forget = () => { if (pendingErrorLogging === reading) pendingErrorLogging = null; };
    reading.then(forget, forget); return reading;
  }
  function prepareStdLogging() {
    if (stdLogging !== null) return Promise.resolve(stdLogging);
    if (pendingStdLogging !== null) return pendingStdLogging;
    if (typeof createStdLogging !== "function") throw new Error("Actual owned standard logging is not configured.");
    const reading = Promise.all([prepareSessionContext(), prepareLocalizationSettings()]).then(([sessionContext, localizationSettings]) =>
      createStdLogging({ sessionContext, localizationSettings })).then(owner => {
      if (!owner?.module || !owner.root || owner.logmodule !== logging || owner.preferences !== preferences || owner.sessionContext !== sessionContext || owner.boot !== localizationSettings.boot) throw new Error("Standard logging must retain the same native client owners.");
      owner.assertCurrent();
      stdLogging = owner; return owner;
    });
    pendingStdLogging = reading;
    const forget = () => { if (pendingStdLogging === reading) pendingStdLogging = null; };
    reading.then(forget, forget); return reading;
  }
  function prepareSessionContext() {
    if (sessionContext !== null) return Promise.resolve(sessionContext);
    if (pendingSessionContext !== null) return pendingSessionContext;
    if (typeof createSessionContext !== "function" || !transportSession) throw new Error("Actual typed transport session context is not configured.");
    const reading = Promise.resolve().then(createSessionContext).then(owner => {
      if (!owner?.session || !owner.localstorage || owner.transport !== transportSession || typeof owner.assertCurrent !== "function") throw new Error("The native session context must share this client's actual transport.");
      if (owner.preferences && owner.preferences !== preferences) throw new Error("The native session context must share this client's actual preference owner.");
      owner.assertCurrent();
      sessionContext = owner; return owner;
    });
    pendingSessionContext = reading;
    const forget = () => { if (pendingSessionContext === reading) pendingSessionContext = null; };
    reading.then(forget, forget); return reading;
  }
  function prepareLocalizationData() {
    if (nativeLocalization !== null) return Promise.resolve(nativeLocalization);
    if (pendingLocalizationData !== null) return pendingLocalizationData;
    if (!localizationData || typeof localizationData.ready !== "function") throw new Error("Actual native localization message inputs are not configured.");
    const reading = localizationData.ready().then(owner => {
      if (!owner?.backend || !owner.main || !owner.english) throw new Error("Actual native localization data is unavailable.");
      nativeLocalization = owner; return owner;
    });
    pendingLocalizationData = reading;
    const forget = () => { if (pendingLocalizationData === reading) pendingLocalizationData = null; };
    reading.then(forget, forget); return reading;
  }
  function prepareLocalizationSettings() {
    if (localizationSettings !== null) return Promise.resolve(localizationSettings);
    if (pendingLocalizationSettings !== null) return pendingLocalizationSettings;
    if (typeof createLocalizationSettings !== "function") throw new Error("Actual native localization boot/settings inputs are not configured.");
    const reading = Promise.resolve().then(createLocalizationSettings).then(owner => {
      if (!owner?.settings || owner.preferences !== preferences || typeof owner.cleanImportantMarkup !== "function") throw new Error("The localization settings must share this client's actual preference owner.");
      localizationSettings = owner;
      return owner;
    });
    pendingLocalizationSettings = reading;
    const forget = () => { if (pendingLocalizationSettings === reading) pendingLocalizationSettings = null; };
    reading.then(forget, forget); return reading;
  }
  function prepareAttributes() {
    if (attributeData !== null) return Promise.resolve(attributeData);
    if (pendingAttributes !== null) return pendingAttributes;
    if (!builtData || typeof builtData.table !== "function" || typeof attributeConstants !== "function") throw new Error("Actual native cFSD attribute inputs are not configured.");
    const reading = Promise.all([builtData.table("dogmaAttributes"), attributeConstants()]).then(([raw, loadedConstants]) => {
      if (!loadedConstants || typeof loadedConstants !== "object") throw new Error("Installed attribute constants are unavailable.");
      const dictionary = preferences.handler.getAttr("__dict__").getAttr("__class__").call();
      for (const [name, value] of Object.entries(loadedConstants)) {
        if (!Number.isSafeInteger(value)) throw new TypeError(`Installed attribute constant ${name} is not an integer.`);
        dictionary.setItem(Buffer.from(name, "ascii"), values.int(value));
      }
      const data = values.global("_attach_static_attribute_data").call(types, raw, dictionary);
      attributeData = Object.freeze({ data, raw, identity: builtData.identity("dogmaAttributes"), load: instance => instance.getAttr("LoadAttributes").call() });
      return attributeData;
    });
    pendingAttributes = reading;
    const forget = () => { if (pendingAttributes === reading) pendingAttributes = null; };
    reading.then(forget, forget); return reading;
  }
  function preparePhases() {
    if (phases !== null) return Promise.resolve(phases);
    if (pendingPhases !== null) return pendingPhases;
    if (!builtData || typeof builtData.table !== "function" || typeof typeAttributeConstants !== "function") throw new Error("Actual native type and effect inputs are not configured.");
    const reading = Promise.all([prepareAttributes(), builtData.table("typeDogma"), builtData.table("dogmaEffects"), builtData.table("types"), typeAttributeConstants()])
      .then(([attributes, typeDogma, effects, rawTypes, typeConstants]) => {
        if (!typeConstants || typeof typeConstants !== "object") throw new Error("Installed physical attribute constants are unavailable.");
        const dictionary = preferences.handler.getAttr("__dict__").getAttr("__class__").call();
        for (const [name, value] of Object.entries({ ...typeConstants, dgmEffPassive: loaded.dgmEffPassive, dgmEffSystem: loaded.dgmEffSystem })) {
          if (!Number.isSafeInteger(value)) throw new TypeError(`Installed static phase constant ${name} is not an integer.`);
          dictionary.setItem(Buffer.from(name, "ascii"), values.int(value));
        }
        const evetypes = values.global("_attach_static_phases").call(types, attributes.data, typeDogma, effects, rawTypes, dictionary);
        phases = Object.freeze({
          data: attributes.data, evetypes, attributes, typeDogma, effects, rawTypes,
          identity: Object.freeze(Object.fromEntries(["typeDogma", "dogmaEffects", "types"].map(name => [name, builtData.identity(name)]))),
          loadTypeAttributes: instance => instance.getAttr("LoadTypeAttributes").call(),
          loadEffects: instance => instance.getAttr("LoadEffects").call(),
          loadTypeEffects: (instance, ...args) => instance.getAttr("LoadTypeEffects").call(...args),
        });
        return phases;
      });
    pendingPhases = reading;
    const forget = () => { if (pendingPhases === reading) pendingPhases = null; };
    reading.then(forget, forget); return reading;
  }
  return Object.freeze({
    types, clock, logging, preferences, taskletTimer, builtData, identity: runtime.identity, prepareAttributes, preparePhases, prepareLocalizationSettings, prepareLocalizationData, prepareSessionContext, prepareStdLogging, prepareErrorLogging, prepareLocalizationLookup, prepareFullLoad, prepareRun,
    create: () => Client.call(),
    // Allocation is explicit so a failed original __init__ leaves inspectable
    // native fields. It is never presented as an initialized/ready service.
    allocate: () => Client.getAttr("__new__").call(Client),
    initialize: instance => Client.getAttr("__init__").call(instance),
  });
}

module.exports = { createClientStaticService };
