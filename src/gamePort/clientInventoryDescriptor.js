"use strict";

const { types: { isPromise } } = require("node:util");

class ClientInventoryDescriptorNotReadyError extends Error {
  constructor(part) {
    super(`Native inventory descriptor requires a ready ${part} adapter.`);
    this.name = "ClientInventoryDescriptorNotReadyError";
  }
}

function forceTruthy(force) {
  // Explicit normalized builtin domain only. Python float NaN is true and
  // signed zero is false; JS Boolean(NaN) would silently change this branch.
  // Native wrappers/containers or __nonzero__/__len__ need their own adapter.
  if (force === null) return false;
  switch (typeof force) {
    case "boolean": return force;
    case "number": return force !== 0;
    case "bigint": return force !== 0n;
    case "string": return force.length !== 0;
    default: throw new ClientInventoryDescriptorNotReadyError("force truth value");
  }
}

/** invCache.GetItemHeader428-432's descriptor slot only. The required producer
 * performs the actual remote invbroker.GetItemDescriptor demand. This is not
 * the invCache service, its Run/notification lifecycle or a StateManager.
 * Returned decoded descriptors retain their original identity/provenance;
 * neither their shape nor their contents are projected or synthesized here.
 */
class ClientInventoryDescriptor {
  #header = null; // Original invCache.Initialize: __itemhdr = None.
  #getItemDescriptor;
  #logInfo;
  #readHeader;
  #writeHeader;

  constructor({ getItemDescriptor, LogInfo, headerSlot = null } = {}) {
    if (typeof getItemDescriptor !== "function") {
      throw new TypeError("The actual invbroker.GetItemDescriptor producer is required.");
    }
    if (typeof LogInfo !== "function") {
      throw new TypeError("The synchronous invCache.LogInfo adapter is required.");
    }
    this.#getItemDescriptor = getItemDescriptor;
    this.#logInfo = LogInfo;
    if (headerSlot !== null && (typeof headerSlot.get !== "function" || typeof headerSlot.set !== "function")) {
      throw new TypeError("The inventory header slot requires synchronous get/set operations.");
    }
    // A supplied native field is the sole authoritative slot. Never mirror its
    // value in #header: original warm accessors must observe every replacement.
    this.#readHeader = headerSlot === null ? () => this.#header : () => headerSlot.get();
    this.#writeHeader = headerSlot === null ? value => { this.#header = value; } : value => headerSlot.set(value);
  }

  #accept(header) {
    this.#writeHeader(header);
    // Native logs AFTER assignment. A logger failure retains the new value;
    // reentrant logging may replace it before the final current-slot return.
    const logged = Reflect.apply(this.#logInfo, undefined, ["invCache got remote itemhdr", this.#readHeader()]);
    if (isPromise(logged)) throw new ClientInventoryDescriptorNotReadyError("synchronous LogInfo");
    return this.#readHeader();
  }

  GetItemHeader(force = 0) {
    // Preserve the source's OR short circuit: a cold read does not inspect
    // force at all. None returned by the producer remains a future miss.
    if (this.#readHeader() === null || forceTruthy(force)) {
      const result = Reflect.apply(this.#getItemDescriptor, undefined, []);
      if (isPromise(result)) {
        // No pending memo: overlapping demands independently call the remote
        // producer. Each successful completion writes its value at that time;
        // a rejection keeps whatever header is current, including a newer one.
        // Only intrinsic promises take this path; synchronous opaque objects'
        // arbitrary .then getters are never inspected. Standard JS Promise
        // adoption still applies to this async result's returned descriptor:
        // its supported decoded-descriptor domain must be nonthenable.
        return Promise.prototype.then.call(result, header => this.#accept(header));
      }
      return this.#accept(result);
    }
    return this.#readHeader();
  }

  // Initialize108's field phase, distinct from ordinary InvalidateCache.
  resetHeader() { this.#writeHeader(null); }
}

module.exports = { ClientInventoryDescriptor, ClientInventoryDescriptorNotReadyError };
