"use strict";

// Base.LoadItem162-203 and Client.LoadItem347-351. This is the normal numeric
// key wrapper around a supplied genuine _LoadItem phase, not the complete
// location constructor, inventory producer, activation or effect engine.
// cdxloadwrapperagent1 retains original bytecode, 19 sequential cases and real
// Stackless channel/critical cases. JS scheduling is an explicit adapter.
const { createClientDogmaNumericMap, clientDogmaItemID } = require("./clientDogmaItem");
const { createClientDogmaLoadScheduling } = require("./clientDogmaLoadScheduling");

const thenable = value => value !== null && value !== undefined && typeof value.then === "function";
const sameKey = (left, right) => left === null || right === null ? left === right : clientDogmaItemID(left) === clientDogmaItemID(right);
const keyError = key => Object.assign(new Error(String(key)), { name: "KeyError", key, args: [key] });
const OPTIONS = new Set(["instanceRow", "wait", "invItem", "newInstance", "timerName"]);

class ClientDogmaLoadPolicyNotReadyError extends Error {
  constructor(part) {
    super(`Native item loading requires a ready ${part} adapter.`);
    this.name = "ClientDogmaLoadPolicyNotReadyError";
  }
}

function method(object, name) {
  if (typeof object?.[name] !== "function") throw new ClientDogmaLoadPolicyNotReadyError(name);
  return object[name].bind(object);
}

class ClientDogmaItemLoader {
  /** Extend a NEW construction world with wrapper state. Does not admit any
   * inventory/metadata rows. exceptionPolicy must deliberately classify native
   * Exception vs BaseException/emulator errors and supply real args/strx/
   * startswith behavior; JS error.message is never inferred to be e.args[0].
   * pendingModifiers supplies native live callable-tuple sets/order/formatting
   * when demanded. Unavailable nonempty tuple support cannot be skipped.
   */
  constructor({ world, loadItem, exceptionPolicy, logging, pendingModifiers, scheduling = createClientDogmaLoadScheduling() }) {
    if (typeof loadItem !== "function") throw new TypeError("The genuine _LoadItem phase is required.");
    for (const name of ["isException", "argsLength", "firstArgStartsWith", "strx"]) method(exceptionPolicy, name);
    method(logging, "LogException");
    this.world = world;
    this.loadItem = loadItem;
    this.exceptions = exceptionPolicy;
    this.logging = logging;
    this.pendingModifiers = pendingModifiers;
    this.scheduling = scheduling;
    this.loadingItems = createClientDogmaNumericMap();
    this.failedLoadingItems = createClientDogmaNumericMap();
    // This map represents ONLY the ('LoadItem', numericKey) critical sections.
    // It is not the full Base.crits dictionary for all other operations.
    this.crits = createClientDogmaNumericMap();
    this.modifiersAwaitingTarget = createClientDogmaNumericMap({
      missing: () => method(this.pendingModifiers, "createSet")(),
    });
  }

  IsItemLoaded(itemKey) { return !this.loadingItems.has(itemKey) && this.world.dogmaItems.has(itemKey); }
  IsItemLoading(itemKey) { return this.loadingItems.has(itemKey); }

  BaseLoadItem(itemKey, options = {}) {
    // Python rejects unknown Base keywords before entering its body. Client's
    // early session-location return precedes this argument binding instead.
    for (const key of Object.keys(options)) {
      if (!OPTIONS.has(key)) throw new TypeError(`LoadItem() got an unexpected keyword argument '${key}'`);
    }
    const { instanceRow = null, invItem = null, newInstance = false } = options;
    // wait and timerName are accepted and NEVER read by original bytecode.
    return this.scheduling.run(() => this._BaseLoadItem(itemKey, { instanceRow, invItem, newInstance }));
  }

  async ClientLoadItem(itemKey, sessionLocationID, options = {}) {
    if (sameKey(itemKey, sessionLocationID)) return itemKey;
    await this.BaseLoadItem(itemKey, options);
    return null; // Original Client discards Base's normal itemKey return.
  }

  async _BaseLoadItem(itemKey, options) {
    if (sameKey(itemKey, this.world.locationID)) return itemKey;
    if (this.IsItemLoaded(itemKey)) return itemKey;
    if (!this.crits.has(itemKey)) this.crits.set(itemKey, this.scheduling.createCritical(["LoadItem", itemKey]));
    const acquisition = this.crits.get(itemKey).acquire();
    // Acquire is OUTSIDE the try/finally. Synchronous/reentrant acquisition
    // must not insert an artificial await before the second presence check.
    if (thenable(acquisition)) await acquisition;
    try {
      try {
        if (this.world.dogmaItems.has(itemKey)) return itemKey;
        this.loadingItems.set(itemKey, this.scheduling.createChannel());
        let item;
        try {
          item = this.loadItem(itemKey, options);
          if (thenable(item)) item = await item;
        } finally {
          // Read the CURRENT mapping on every handoff, including failure.
          // None wakes receivers before deletion/pending/post/error marking;
          // it carries no load-success promise and no producer exception.
          for (;;) {
            const channel = this._loadingChannel(itemKey);
            if (!channel.queue) break;
            const handoff = channel.send(null);
            if (thenable(handoff)) await handoff;
          }
          if (!this.loadingItems.delete(itemKey)) throw keyError(itemKey);
        }
        if (item !== null) {
          if (item === undefined) throw new ClientDogmaLoadPolicyNotReadyError("_LoadItem return (use explicit None)");
          if (this.modifiersAwaitingTarget.has(itemKey)) {
            const format = method(this.pendingModifiers, "formatNotice");
            const notice = format(itemKey, item, this.modifiersAwaitingTarget.get(itemKey));
            if (typeof notice !== "string") throw new ClientDogmaLoadPolicyNotReadyError("pending notice projection");
            const logged = method(this.pendingModifiers, "LogNotice")(notice);
            if (thenable(logged)) await logged;
            // Iteration starts AFTER the notice, against the current map entry.
            // The adapter must enforce original set order/live-size failures;
            // a JS insertion-order Set/snapshot is not a native substitute.
            const calls = method(this.pendingModifiers, "iterate")(this.modifiersAwaitingTarget.get(itemKey));
            if (typeof calls?.[Symbol.iterator] !== "function") throw new ClientDogmaLoadPolicyNotReadyError("live pending iterator");
            for (const tuple of calls) {
              if (!Array.isArray(tuple) || typeof tuple[0] !== "function") throw new ClientDogmaLoadPolicyNotReadyError("pending callable tuple projection");
              const called = Reflect.apply(tuple[0], undefined, tuple.slice(1));
              if (thenable(called)) await called;
            }
            if (!this.modifiersAwaitingTarget.delete(itemKey)) throw keyError(itemKey);
          }
          const post = item.PostLoadAction();
          if (thenable(post)) await post;
        }
      } catch (error) {
        if (!this._isException(error)) throw error;
        // LogException is OUTSIDE the swallowing failed-marking try. Its error
        // masks this error and skips failedLoadingItems, as original does.
        // Python has sys.exc_info here; carry that context explicitly in JS.
        const logged = this.logging.LogException(`Failed to load a dogma item ${String(itemKey)}`, error);
        if (thenable(logged)) await logged;
        try {
          const length = this.exceptions.argsLength(error);
          if (!Number.isSafeInteger(length) || length < 0) throw new ClientDogmaLoadPolicyNotReadyError("native args length");
          let skip = false;
          if (length) {
            skip = this.exceptions.firstArgStartsWith(error, "GetItem: Item not here");
            if (typeof skip !== "boolean") throw new ClientDogmaLoadPolicyNotReadyError("native startswith truth");
          }
          if (!skip) {
            const text = this.exceptions.strx(error);
            if (typeof text !== "string") throw new ClientDogmaLoadPolicyNotReadyError("strx projection");
            this.failedLoadingItems.set(itemKey, "Exception: " + text);
          }
        } catch (markingError) {
          // Only native Exception is swallowed. A BaseException/emulator
          // boundary from the adapter still propagates through final release.
          if (!this._isException(markingError)) throw markingError;
        }
        throw error;
      }
    } finally {
      // Release the CURRENT entry and then reread IsCool, like Base1696-1701.
      // A release error can mask the body error/result. Never roll back nodes,
      // links, pending effects or other partially written state here.
      if (!this.crits.has(itemKey)) throw keyError(itemKey);
      const released = this.crits.get(itemKey).release();
      if (thenable(released)) await released;
      if (this.crits.has(itemKey) && this.crits.get(itemKey).IsCool() && !this.crits.delete(itemKey)) throw keyError(itemKey);
    }
    return itemKey;
  }

  _loadingChannel(itemKey) {
    if (!this.loadingItems.has(itemKey)) throw keyError(itemKey);
    return this.loadingItems.get(itemKey);
  }

  _isException(error) {
    if (error instanceof ClientDogmaLoadPolicyNotReadyError) return false;
    const result = this.exceptions.isException(error);
    if (typeof result !== "boolean") throw new ClientDogmaLoadPolicyNotReadyError("native Exception lineage");
    return result;
  }
}

module.exports = { ClientDogmaItemLoader, ClientDogmaLoadPolicyNotReadyError };
