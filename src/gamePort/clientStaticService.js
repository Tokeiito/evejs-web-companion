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
 * three original phases and lazy native physical/type helpers. No full
 * Run/Load/ServiceManager state,
 * generic config/counter services, full client or IM readiness is published.
 */
async function createClientStaticService({ provider, clock, logging, preferences, taskletTimer = null, constants, builtData = null, attributeConstants = null, typeAttributeConstants = null }) {
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
    types, clock, logging, preferences, taskletTimer, builtData, identity: runtime.identity, prepareAttributes, preparePhases,
    create: () => Client.call(),
    // Allocation is explicit so a failed original __init__ leaves inspectable
    // native fields. It is never presented as an initialized/ready service.
    allocate: () => Client.getAttr("__new__").call(Client),
    initialize: instance => Client.getAttr("__init__").call(instance),
  });
}

module.exports = { createClientStaticService };
