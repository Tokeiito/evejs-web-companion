"use strict";

// dogma.data365-427 and native RefreshItemEffects1646-1684. Installed-loader
// evidence: cdxeffectdataagent1 (29 source/resource identities). Relation order
// and isDefault belong to typeDogma, not the server SDE's flattened effect IDs.
const OPTIONAL_IDS = [
  "descriptionID", "trackingSpeedAttributeID", "rangeAttributeID",
  "falloffAttributeID", "dischargeAttributeID", "durationAttributeID",
  "iconID", "fittingUsageChanceAttributeID",
];
const CORE_NUMBERS = ["effectID", "effectCategory", "isOffensive", "isAssistance"];

function identity(value) {
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) value = Number(value);
  if (!Number.isSafeInteger(value)) throw new TypeError("A safe integer dogma identity is required.");
  return value;
}

function dictionary(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is unavailable.`);
  return value;
}

function integerField(row, name, label) {
  if (!Object.hasOwn(row, name) || !Number.isSafeInteger(row[name])) throw new Error(`${label} has no valid ${name}.`);
  return row[name];
}

/** Raw readers: typeDogma(id) returns a row, explicit null for a known missing
 * type, or throws/returns undefined when unavailable; dogmaEffects(ids) and
 * messages(ids) return keyed objects, or throw/return null when unavailable.
 * Readers may be asynchronous. This provider prepares local static definitions;
 * it performs no native RPC, value/effect-state updates or localization parsing. */
function createGodmaEffectData({ typeDogma, dogmaEffects, messages }) {
  if (![typeDogma, dogmaEffects, messages].every(reader => typeof reader === "function")) {
    throw new TypeError("Installed typeDogma, dogmaEffects and message readers are required.");
  }
  const types = new Map(), typePending = new Map();
  const effects = new Map(), effectPending = new Map();
  const descriptions = new Map(), descriptionPending = new Map();

  function track(pending, id, reading) {
    pending.set(id, reading);
    const forget = () => { if (pending.get(id) === reading) pending.delete(id); };
    reading.then(forget, forget);
  }

  function normalizeEffect(row, id) {
    dictionary(row, `Dogma effect ${id}`);
    const normalized = { ...row };
    for (const name of CORE_NUMBERS) integerField(row, name, `Dogma effect ${id}`);
    if (row.effectID !== id) throw new Error(`Dogma effect ${id} has a different effectID.`);
    if (!Object.hasOwn(row, "effectName") || typeof row.effectName !== "string") throw new Error(`Dogma effect ${id} has no valid effectName.`);
    // Actual cFSD getters return None for these known optional fields even when
    // dir()/the JSON walker omits them. Unknown fields get no guessed defaults.
    for (const name of OPTIONAL_IDS) {
      const value = Object.hasOwn(row, name) ? row[name] : null;
      if (value !== null && !Number.isSafeInteger(value)) throw new Error(`Dogma effect ${id} has no valid ${name}.`);
      normalized[name] = value;
    }
    return normalized;
  }

  async function prepareEffects(ids) {
    const missing = [...new Set(ids)].filter(id => !effects.has(id) && !effectPending.has(id));
    if (missing.length > 0) {
      // Assign all per-effect pending entries before any reader runs/yields.
      // Concurrent types can share one read without flattening their order.
      const batch = Promise.resolve().then(async () => {
        const found = dictionary(await dogmaEffects(missing), "Installed dogmaEffects data");
        const normalized = new Map();
        for (const id of missing) {
          if (!Object.hasOwn(found, id) || found[id] === null || found[id] === undefined) {
            throw new Error(`Installed dogma effect ${id} is missing.`);
          }
          normalized.set(id, Object.freeze(normalizeEffect(found[id], id)));
        }
        return normalized;
      });
      for (const id of missing) {
        const reading = batch.then(found => {
          const row = found.get(id);
          effects.set(id, row);
          return row;
        });
        track(effectPending, id, reading);
      }
    }
    return Promise.all(ids.map(id => effects.has(id) ? effects.get(id) : effectPending.get(id)));
  }

  async function effect(effectID) {
    const id = identity(effectID);
    if (effects.has(id)) return Promise.resolve(effects.get(id));
    if (effectPending.has(id)) return effectPending.get(id);
    return prepareEffects([id]).then(rows => rows[0]);
  }

  // Native get_effect_description is called only after RefreshItemEffects has
  // selected a generated row. Static effect reads (including notices) do not
  // demand localization or fail because an unused description is unavailable.
  async function description(effectID) {
    const id = identity(effectID);
    if (descriptions.has(id)) return descriptions.get(id);
    if (descriptionPending.has(id)) return descriptionPending.get(id);
    const reading = Promise.resolve().then(async () => {
      const row = await effect(id);
      let text = "";
      if (row.descriptionID) {
        const texts = dictionary(await messages([row.descriptionID]), "Installed effect descriptions");
        text = Object.hasOwn(texts, row.descriptionID) ? texts[row.descriptionID] : undefined;
        if (typeof text !== "string") throw new Error(`Installed effect description ${row.descriptionID} is missing.`);
      }
      descriptions.set(id, text);
      return text;
    });
    track(descriptionPending, id, reading);
    return reading;
  }

  async function typeEffects(typeID) {
    const id = identity(typeID);
    if (types.has(id)) return Promise.resolve(types.get(id));
    if (typePending.has(id)) return typePending.get(id);
    const reading = Promise.resolve().then(async () => {
      const row = await typeDogma(id);
      // Native get_type_effects returns [] only for a confirmed missing type.
      if (row === null) {
        const empty = Object.freeze([]);
        types.set(id, empty);
        return empty;
      }
      dictionary(row, `Installed typeDogma ${id}`);
      if (!Object.hasOwn(row, "dogmaEffects") || !Array.isArray(row.dogmaEffects)) throw new Error(`Installed typeDogma ${id} has no effect relation list.`);
      const relations = row.dogmaEffects.map(relation => {
        dictionary(relation, `Type ${id} effect relation`);
        return {
          effectID: integerField(relation, "effectID", `Type ${id} effect relation`),
          isDefault: integerField(relation, "isDefault", `Type ${id} effect relation`),
        };
      });
      const definitions = await prepareEffects(relations.map(relation => relation.effectID));
      const ordered = Object.freeze(relations.map((relation, index) => Object.freeze({ isDefault: relation.isDefault, effect: definitions[index] })));
      types.set(id, ordered);
      return ordered;
    });
    track(typePending, id, reading);
    return reading;
  }

  return {
    typeEffects,
    effect,
    description,
    // A warm lookup only. Null means not ready, not native get_effect absence.
    cachedEffect: effectID => effects.get(identity(effectID)) ?? null,
  };
}

module.exports = { createGodmaEffectData };
