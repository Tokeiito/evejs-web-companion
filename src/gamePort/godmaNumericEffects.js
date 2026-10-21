"use strict";

// godma.RefreshItemEffects1647-1684: native named backing rows, separate from
// the old active-effect projection and from clientDogmaLocation passive effects.
// EffectWrapper964 writes through these fields; ItemWrapper does not.
const REQUIRED = new Set([16, 11, 12, 13, 2663]);
const ACTIVE_CATEGORIES = new Set([1, 2, 3, 5]);
const FIELDS = ["itemID", "effectID", "effectName", "effectCategory", "isDefault", "isActive", "isOffensive", "isAssistance", "description", "trackingSpeedAttributeID", "rangeAttributeID", "falloffAttributeID", "dischargeAttributeID", "durationAttributeID", "iconID", "targetID", "startTime", "duration", "repeat", "isDeactivating"];
const bool = value => value === null ? null : Boolean(value);
// Blue's integer columns return an integer even when Set receives a bool.
// Ordinary effect duration/repeat values fit their signed 32-bit columns.
const integer = value => value === null ? null : typeof value === "boolean" || typeof value === "bigint" ? Number(value) : value;

function createGodmaNumericEffects({ data, fieldsOf, number, key, onActivated = () => {}, afterState = () => {} }) {
  const effects = new Map();

  // Cached fields of OnGodmaShipEffect1441-1462. Activation is a local callback,
  // not an await-listeners bar. afterState exposes the continuation boundary;
  // controlled routing, ActualStopEffect/pending/ChainEvent/UI remain external.
  function applyKnown(args, effect) {
    const [itemID, effectID, time, start, active, environment, startTime, duration, repeat, error, actualStopTime = null] = args;
    const row = effects.get(key(itemID))?.get(effect.effectName);
    if (!row) return false;
    row.isDeactivating = false;
    row.isActive = bool(active);
    row.startTime = startTime;
    row.duration = integer(duration);
    row.repeat = integer(repeat);
    if (!Array.isArray(environment) || environment.length < 4) throw new RangeError("Godma effect environment has no target field.");
    row.targetID = environment[3];
    if (active) onActivated(itemID, effectID);
    afterState({ itemID, effect, actualStopTime, effectState: { itemID, effectName: effect.effectName, time, start, active, environment, duration, repeat, error } });
    return true;
  }

  async function refresh(itemID, typeID, info, doUpdate) {
    const fields = fieldsOf(info), active = fields.get("activeEffects");
    if (!active || !Array.isArray(active.entries)) throw new TypeError("Godma effect refresh requires an active-effect dictionary.");
    const activeDict = new Map(active.entries.map(([id, line]) => [number(id), line]));
    const definitions = await data.typeEffects(typeID), generated = [], events = [];
    for (const { isDefault, effect } of definitions) {
      const id = effect.effectID, category = effect.effectCategory;
      if (!(isDefault && id !== 132 || REQUIRED.has(id) || ACTIVE_CATEGORIES.has(category) || effect.fittingUsageChanceAttributeID !== null)) continue;
      const values = [
        itemID, id, effect.effectName, category, bool(isDefault), activeDict.has(id),
        bool(effect.isOffensive), bool(effect.isAssistance), await data.description(id),
        effect.trackingSpeedAttributeID, effect.rangeAttributeID, effect.falloffAttributeID,
        effect.dischargeAttributeID, effect.durationAttributeID, effect.iconID,
        null, null, null, null, false,
      ];
      const row = Object.fromEntries(FIELDS.map((name, index) => [name, values[index]]));
      generated.push(row);
      if (activeDict.has(id) && ACTIVE_CATEGORIES.has(category) && !REQUIRED.has(id)) {
        const line = activeDict.get(id);
        if (!Array.isArray(line) || line.length < 10) throw new RangeError("Godma active effect has no complete environment/timing line.");
        if (!fields.has("time")) throw new TypeError("Godma active effect refresh requires time.");
        events.push({ effect, args: [itemID, id, fields.get("time"), true, true, line.slice(0, 7), line[7], line[8], line[9], null] });
      }
    }
    // Generate completely before publishing. A merge preserves absent old names
    // and replaces selected rows, including their initially-null timing fields.
    const id = key(itemID);
    const held = doUpdate && effects.has(id) ? effects.get(id) : new Map();
    for (const row of generated) held.set(row.effectName, row);
    effects.set(id, held);
    for (const { effect, args } of events) applyKnown(args, effect);
  }

  async function apply(args) {
    const effect = data.cachedEffect(number(args[1])) ?? await data.effect(number(args[1]));
    return applyKnown(args, effect);
  }

  return {
    refresh, apply,
    has: itemID => effects.has(key(itemID)),
    get: (itemID, effectName) => effects.get(key(itemID))?.get(effectName) ?? null,
    drop(ids) { for (const id of ids) effects.delete(key(id)); },
    clear() { effects.clear(); },
  };
}

module.exports = { createGodmaNumericEffects };
