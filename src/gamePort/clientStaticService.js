"use strict";

const constantNames = Object.freeze(["effectHiPower", "effectLoPower", "effectMedPower", "effectSkillEffect"]);

/**
 * Prepare the original installed Core/Base/Client static CONSTRUCTOR types.
 * Each create() invokes original Core.__init__, virtual InitService and Base
 * __init__ against this client's real clock, logmodule and Handler. The native
 * heap owns all fields and shared class literals; failures retain their prefix
 * on an explicitly allocated instance. prepareAttributes() separately binds
 * original attribute helpers to real cFSD data; its load(instance) executes
 * original LoadAttributes on that SAME instance. No Run/Load/ServiceManager state,
 * generic config/counter services, full client or IM readiness is published.
 */
async function createClientStaticService({ provider, clock, logging, preferences, constants, builtData = null, attributeConstants = null }) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed runtime provider is required.");
  if (!clock || typeof clock.getWallclockTimeNow !== "function") throw new TypeError("The client's actual native wallclock is required.");
  if (!logging?.module || !preferences?.handler || typeof constants !== "function") throw new TypeError("Real logmodule, preference owner and installed constants are required.");
  const [runtime, loaded] = await Promise.all([provider.ready(), constants()]);
  if (!loaded || constantNames.some(name => !Number.isSafeInteger(loaded[name]))) throw new TypeError("Installed static constructor effect constants are unavailable.");
  const values = runtime.values;
  const now = values.wrap(runtime.binding.wallclockBackend(() => clock.getWallclockTimeNow()));
  const types = values.global("_create_static_service_types").call(now, logging.module, preferences.handler, ...constantNames.map(name => values.int(loaded[name])));
  const Client = types.getAttr("ClientDogmaStaticSvc");
  let attributeData = null, pendingAttributes = null;
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
  return Object.freeze({
    types, clock, logging, preferences, builtData, identity: runtime.identity, prepareAttributes,
    create: () => Client.call(),
    // Allocation is explicit so a failed original __init__ leaves inspectable
    // native fields. It is never presented as an initialized/ready service.
    allocate: () => Client.getAttr("__new__").call(Client),
    initialize: instance => Client.getAttr("__init__").call(instance),
  });
}

module.exports = { createClientStaticService };
