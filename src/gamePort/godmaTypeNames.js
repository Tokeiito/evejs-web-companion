"use strict";

// evetypes.GetName/GetNameID397/250 and localizationBase.GetImportant104-139.
// Explicit primary-English mode: player == primary, QA wrapping/override off.
// The installed 52514 unique name texts have no parameters/tokens. This is not
// the alternate-language important/highlight/tooltip or general parser policy.
class GodmaTypeNamesNotReadyError extends Error {
  constructor(message = "Installed primary-English type names are not ready; await ready().") {
    super(message); this.name = "GodmaTypeNamesNotReadyError";
  }
}
class TypeNotFoundException extends Error {
  constructor(typeID) { super(`Type ${String(typeID)} was not found.`); this.name = "TypeNotFoundException"; this.typeID = typeID; }
}

function createGodmaPrimaryTypeNames({ typeNameIDs, messages, language = () => "en-us" }) {
  if (typeof typeNameIDs !== "function" || typeof messages !== "function") throw new TypeError("Installed type-name ID and message readers are required.");
  let names = null, pending = null;
  function prepared() {
    if (names === null) throw new GodmaTypeNamesNotReadyError();
    return names;
  }
  async function load() {
    if (language() !== "en-us") throw new GodmaTypeNamesNotReadyError("The primary-English type-name policy requires en-us text.");
    const ids = await typeNameIDs();
    if (!ids || typeof ids !== "object" || Array.isArray(ids) || !Object.hasOwn(ids, "0")) throw new GodmaTypeNamesNotReadyError("Installed complete type-name IDs, including type0, are unavailable.");
    const definitions = new Map();
    for (const [key, messageID] of Object.entries(ids)) {
      const typeID = Number(key);
      if (!Number.isSafeInteger(typeID) || typeID < 0 || String(typeID) !== key || !Number.isSafeInteger(messageID) || messageID <= 0) throw new TypeError("Installed type-name IDs contain a malformed entry.");
      definitions.set(typeID, messageID);
    }
    // All fields exist in this verified installed corpus, so projection retains
    // complete type membership. Do not infer generic names for missing rows.
    const texts = await messages([...new Set(definitions.values())]);
    const loaded = new Map();
    for (const [typeID, messageID] of definitions) {
      if (!texts || !Object.hasOwn(texts, messageID) || typeof texts[messageID] !== "string") throw new GodmaTypeNamesNotReadyError(`Installed type-name message ${messageID} is unavailable.`);
      loaded.set(typeID, texts[messageID]);
    }
    names = loaded;
    return api;
  }
  function ready() {
    if (names !== null) return Promise.resolve(api);
    if (pending !== null) return pending;
    const reading = Promise.resolve().then(load);
    pending = reading;
    const forget = () => { if (pending === reading) pending = null; };
    reading.then(forget, forget);
    return reading;
  }
  const api = {
    ready, isReady: () => names !== null,
    name(typeID) {
      const held = prepared(), original = typeID;
      if (typeof typeID === "bigint" || typeof typeID === "boolean") typeID = Number(typeID);
      // Numeric inventory metadata supplies integer type IDs; no speculative
      // string/int parser or SDE/typeID fallback is provided here.
      if (!Number.isSafeInteger(typeID) || !held.has(typeID)) throw new TypeNotFoundException(original);
      return held.get(typeID);
    },
  };
  return api;
}

module.exports = { createGodmaPrimaryTypeNames, GodmaTypeNamesNotReadyError, TypeNotFoundException };
