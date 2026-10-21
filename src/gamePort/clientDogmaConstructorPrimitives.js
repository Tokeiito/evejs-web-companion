"use strict";

// Local Base constructor prerequisites only. Original eventCounters10-56 and
// BaseDogmaLocation.MessageMgr76-94; cdxctorprimitivesagent1. No location,
// loaded-item, brain effects, service startup or full contextmanager claim.
const { types: { isPromise } } = require("node:util");
class ClientDogmaConstructorPrimitiveNotReadyError extends Error {
  constructor(part) {
    super(`Native constructor component requires a ready ${part} adapter.`);
    this.name = "ClientDogmaConstructorPrimitiveNotReadyError";
  }
}

function eventKey(key) {
  // Counter membership has no dictionary iteration consumer. Canonicalize
  // builtin numeric equality, while callbacks retain the ORIGINAL argument.
  // Object/rich keys and distinct native NaN identities need another adapter.
  if (key === null || typeof key === "string" || typeof key === "bigint") return key;
  if (typeof key === "boolean") return key ? 1n : 0n;
  if (typeof key === "number" && !Number.isNaN(key)) return Number.isInteger(key) ? BigInt(key) : key;
  throw new ClientDogmaConstructorPrimitiveNotReadyError("event key identity");
}

class ClientDogmaEventCount {
  #counts = new Map();

  // Raw original generator boundary: creation does not enter. next() enters;
  // normal next() exits and invokes _OnEvent, whereas throw()/return() run the
  // finally decrement and skip _OnEvent. Native contextlib's with adapter and
  // async body/exception injection remain separate integration prerequisites.
  *Event(key) {
    this._AddEventCount(key);
    try { yield null; }
    finally { this._DecreaseEventCount(key); }
    const result = this._OnEvent(key);
    if (isPromise(result)) {
      throw new ClientDogmaConstructorPrimitiveNotReadyError("synchronous event callback");
    }
  }

  _AddEventCount(key) {
    const stored = eventKey(key);
    this.#counts.set(stored, (this.#counts.get(stored) ?? 0n) + 1n);
  }

  _DecreaseEventCount(key) {
    const stored = eventKey(key);
    if (!this.#counts.has(stored)) throw Object.assign(new Error(String(key)), { name: "KeyError", key, args: [key] });
    const count = this.#counts.get(stored) - 1n;
    if (count < 1n) this.#counts.delete(stored);
    else this.#counts.set(stored, count);
  }

  IsEventHappening(key) { return key === null ? false : (this.#counts.get(eventKey(key)) ?? 0n) > 0n; }
  _OnEvent() {} // Actual base hook is a no-op.
}

class ClientDogmaBrainUpdate extends ClientDogmaEventCount {
  #callback;

  constructor(callback) {
    super();
    // Original constructor stores even a non-callable input. Its failure is
    // deferred until the normal exit hook, AFTER the event count decreases.
    this.#callback = callback;
  }

  _OnEvent(key) {
    // EVERY normal nested exit invokes the callback, even while an outer
    // event for this same key remains active. There is no zero-count filter.
    if (typeof this.#callback !== "function") throw new ClientDogmaConstructorPrimitiveNotReadyError("brain-update callback");
    const result = Reflect.apply(this.#callback, undefined, [key]);
    if (isPromise(result)) {
      throw new ClientDogmaConstructorPrimitiveNotReadyError("synchronous brain-update callback");
    }
  }
}

class ClientDogmaMessageMgr {
  constructor(collections) {
    // An actual NEW source-created identity set, using the same world domain.
    // Surrogate domain slot order is not the installed client's private heap.
    this.attributes = collections.strongSet();
  }

  AddAttribute(attribute) {
    // This world domain models identity-hashed attribute objects/functions.
    // Native generic hashable primitives/tuple keys and list-unhashability
    // require a generic Python set adapter; do not silently treat JS containers
    // as hashable native attribute objects or invent an empty-message result.
    if (attribute === null || !["object", "function"].includes(typeof attribute) || Array.isArray(attribute) ||
      ArrayBuffer.isView(attribute) || attribute instanceof Map || attribute instanceof Set) {
      throw new ClientDogmaConstructorPrimitiveNotReadyError("identity-hashed message attribute");
    }
    this.attributes.add(attribute);
  }

  GetMessages() {
    const messages = [];
    // Capture THIS set's iterator once. Attribute code may mutate it or replace
    // this.attributes; native live-size checks remain the set iterator's job.
    for (const attribute of this.attributes) {
      const construct = attribute.ConstructMessage;
      if (typeof construct !== "function") throw new ClientDogmaConstructorPrimitiveNotReadyError("ConstructMessage");
      const message = Reflect.apply(construct, attribute, []);
      if (message === undefined || isPromise(message)) {
        throw new ClientDogmaConstructorPrimitiveNotReadyError("message projection");
      }
      if (message !== null) messages.push(message); // Preserve false/0/empty.
    }
    return messages; // Never clears, including on a failed/reentrant read.
  }

  Clear() { this.attributes.clear(); }
}

module.exports = { ClientDogmaEventCount, ClientDogmaBrainUpdate, ClientDogmaMessageMgr, ClientDogmaConstructorPrimitiveNotReadyError };
