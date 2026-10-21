"use strict";

const { types: { isPromise } } = require("node:util");
const { ClientDogmaBrainLiteralAttribute } = require("./clientDogmaLiteralAttribute");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");

/** Base157's NEW cold keydefaultdict(BrainLiteralAttribute). Generic Python
 * tuple hash/equality is an explicit dependency: numeric aliases, first-key
 * value class, skills tuple and NaN-object identity must survive. No JSON key,
 * raw JS array identity, guessed numeric class or default literal is supplied.
 * This is keyed lookup only, not Python dictionary traversal/heap behavior.
 */
class ClientDogmaBrainLiteralCache {
  #values = new Map();
  #keys;
  #format;

  constructor({ keyPolicy, format } = {}) { this.#keys = keyPolicy; this.#format = format; }
  get size() { return this.#values.size; }

  #key(key) {
    if (typeof this.#keys?.canonical !== "function") throw new ClientDogmaConstructorPrimitiveNotReadyError("brain literal tuple keys");
    // A ready policy supplies equal Map tokens IF AND ONLY IF the source keys
    // are Python-equal (including its explicit NaN-object identity policy).
    // It owns hashing/unhashable failures before any literal construction.
    const token = this.#keys.canonical(key);
    if (token === undefined || isPromise(token)) throw new ClientDogmaConstructorPrimitiveNotReadyError("brain literal key projection");
    return token;
  }

  has(key) { return this.#values.has(this.#key(key)); }
  get(key) {
    const token = this.#key(key);
    if (this.#values.has(token)) return this.#values.get(token);
    // Pass the ORIGINAL key to the factory and publish only after it returns.
    // Equal later keys retain the first literal/value/skills, without coercion.
    const literal = new ClientDogmaBrainLiteralAttribute(key, { format: this.#format });
    // keydefaultdict.__missing__ performs d[key]=value AFTER the factory,
    // requiring a fresh hash/key-policy operation before publication too.
    this.#values.set(this.#key(key), literal);
    return literal;
  }
}

module.exports = { ClientDogmaBrainLiteralCache };
