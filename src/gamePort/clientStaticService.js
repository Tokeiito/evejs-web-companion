"use strict";

const constantNames = Object.freeze(["effectHiPower", "effectLoPower", "effectMedPower", "effectSkillEffect"]);

/**
 * Prepare the original installed Core/Base/Client static CONSTRUCTOR types.
 * Each create() invokes original Core.__init__, virtual InitService and Base
 * __init__ against this client's real clock, logmodule and Handler. The native
 * heap owns all fields and shared class literals; failures retain their prefix
 * on an explicitly allocated instance. No Run/Load/ServiceManager state,
 * generic config/counter services, full client or IM readiness is published.
 */
async function createClientStaticService({ provider, clock, logging, preferences, constants }) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed runtime provider is required.");
  if (!clock || typeof clock.getWallclockTimeNow !== "function") throw new TypeError("The client's actual native wallclock is required.");
  if (!logging?.module || !preferences?.handler || typeof constants !== "function") throw new TypeError("Real logmodule, preference owner and installed constants are required.");
  const [runtime, loaded] = await Promise.all([provider.ready(), constants()]);
  if (!loaded || constantNames.some(name => !Number.isSafeInteger(loaded[name]))) throw new TypeError("Installed static constructor effect constants are unavailable.");
  const values = runtime.values;
  const now = values.wrap(runtime.binding.wallclockBackend(() => clock.getWallclockTimeNow()));
  const types = values.global("_create_static_service_types").call(now, logging.module, preferences.handler, ...constantNames.map(name => values.int(loaded[name])));
  const Client = types.getAttr("ClientDogmaStaticSvc");
  return Object.freeze({
    types, clock, logging, preferences, identity: runtime.identity,
    create: () => Client.call(),
    // Allocation is explicit so a failed original __init__ leaves inspectable
    // native fields. It is never presented as an initialized/ready service.
    allocate: () => Client.getAttr("__new__").call(Client),
    initialize: instance => Client.getAttr("__init__").call(instance),
  });
}

module.exports = { createClientStaticService };
