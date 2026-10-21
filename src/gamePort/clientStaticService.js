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
 * over those same owners, not full logmodule LogTraceback/LogException. No full
 * Run/Load/ServiceManager state,
 * generic config/counter services, full client or IM readiness is published.
 */
async function createClientStaticService({ provider, clock, logging, preferences, taskletTimer = null, constants, builtData = null, attributeConstants = null, typeAttributeConstants = null, createLocalizationSettings = null, localizationData = null, createSessionContext = null, transportSession = null, createStdLogging = null }) {
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
    types, clock, logging, preferences, taskletTimer, builtData, identity: runtime.identity, prepareAttributes, preparePhases, prepareLocalizationSettings, prepareLocalizationData, prepareSessionContext, prepareStdLogging,
    create: () => Client.call(),
    // Allocation is explicit so a failed original __init__ leaves inspectable
    // native fields. It is never presented as an initialized/ready service.
    allocate: () => Client.getAttr("__new__").call(Client),
    initialize: instance => Client.getAttr("__init__").call(instance),
  });
}

module.exports = { createClientStaticService };
