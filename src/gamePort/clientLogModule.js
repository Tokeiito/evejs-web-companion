"use strict";

/**
 * Selected ORIGINAL installed logmodule/logserver code, in a private native
 * Python namespace per emulated client. Cache keys, shared suppression values,
 * truth, argument errors, decorators and streams remain actual Python objects.
 * The backend is the real configured synchronous local logger. This is not
 * the Blue engine's native heap type, full logmodule import, boot/eveprefs.Init,
 * exception/UI logging graph, CoreService or service readiness.
 */
async function createClientLogModule({ provider, log }) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed client runtime provider is required.");
  if (!log || typeof log.domain?.createChannel !== "function") throw new TypeError("A configured client logging backend is required.");
  const runtime = await provider.ready(), values = runtime.values;
  const backend = values.wrap(runtime.binding.loggingBackend((facility, object) => log.domain.createChannel(facility, object)));
  const module = values.global("_create_logmodule").call(backend);
  const call = name => (...args) => module.getAttr(name).call(...args);
  return Object.freeze({
    module, log, identity: runtime.identity,
    GetChannel: call("GetChannel"), init: call("init"),
    Suppress: call("Suppress"), Unsuppress: call("Unsuppress"),
    SuppressAllChannels: call("SuppressAllChannels"), UnsuppressAllChannels: call("UnsuppressAllChannels"),
    AddGlobalChannels: call("AddGlobalChannels"), SetUiMessageFunc: call("SetUiMessageFunc"),
    get channels() { return module.getAttr("channels"); },
    get channelDict() { return module.getAttr("channelDict"); },
    get ChannelWrapper() { return module.getAttr("ChannelWrapper"); },
    get LogChannelStream() { return module.getAttr("LogChannelStream"); },
  });
}

module.exports = { createClientLogModule };
