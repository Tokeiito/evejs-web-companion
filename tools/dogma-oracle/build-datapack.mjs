#!/usr/bin/env node
/**
 * Build a compact JSON data pack for the dogma oracle from EveJS's own SDE
 * (the JSONL export under eve.js/_local/sde/...).
 *
 * The point of using EveJS's own SDE is that the oracle and EveJS then consume
 * IDENTICAL static data, so any divergence in the output is attributable to the
 * ENGINE (missing effects, stacking order, unit handling), not to stale data.
 *
 * Usage:
 *   node build-datapack.mjs <path-to-sde-jsonl-dir> <out.json>
 *
 * Read-only with respect to the SDE.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [, , sdeDir, outPath] = process.argv;
if (!sdeDir || !outPath) {
  console.error('usage: node build-datapack.mjs <sde-jsonl-dir> <out.json>');
  process.exit(2);
}

async function eachLine(file, fn) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(sdeDir, file)),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    fn(JSON.parse(line));
  }
}

const en = (v) => (v && typeof v === 'object' ? v.en : v);

// ---- groups -> categoryID -------------------------------------------------
const groupCategory = new Map();
await eachLine('groups.jsonl', (g) => groupCategory.set(g._key, g.categoryID));

// ---- dogma attribute metadata --------------------------------------------
const dogmaAttributes = {};
await eachLine('dogmaAttributes.jsonl', (a) => {
  dogmaAttributes[a._key] = {
    defaultValue: a.defaultValue ?? 0,
    highIsGood: !!a.highIsGood,
    stackable: !!a.stackable,
    name: a.name ?? '',
    unitID: a.unitID ?? null,
  };
});

// ---- dogma effect metadata -----------------------------------------------
const DOMAIN = {
  itemID: 0,
  shipID: 1,
  charID: 2,
  otherID: 3,
  structureID: 4,
  target: 5,
  targetID: 6,
};
const FUNC = {
  ItemModifier: 0,
  LocationGroupModifier: 1,
  LocationModifier: 2,
  LocationRequiredSkillModifier: 3,
  OwnerRequiredSkillModifier: 4,
  EffectStopper: 5,
};

const dogmaEffects = {};
await eachLine('dogmaEffects.jsonl', (e) => {
  dogmaEffects[e._key] = {
    name: e.name ?? '',
    dischargeAttributeID: e.dischargeAttributeID ?? null,
    durationAttributeID: e.durationAttributeID ?? null,
    effectCategory: e.effectCategoryID ?? 0,
    electronicChance: !!e.electronicChance,
    isAssistance: !!e.isAssistance,
    isOffensive: !!e.isOffensive,
    isWarpSafe: !!e.isWarpSafe,
    propulsionChance: !!e.propulsionChance,
    rangeChance: !!e.rangeChance,
    rangeAttributeID: e.rangeAttributeID ?? null,
    falloffAttributeID: e.falloffAttributeID ?? null,
    trackingSpeedAttributeID: e.trackingSpeedAttributeID ?? null,
    fittingUsageChanceAttributeID: e.fittingUsageChanceAttributeID ?? null,
    resistanceAttributeID: e.resistanceAttributeID ?? null,
    modifierInfo: (e.modifierInfo ?? []).map((m) => ({
      domain: DOMAIN[m.domain] ?? 0,
      func: FUNC[m.func] ?? 0,
      modifiedAttributeID: m.modifiedAttributeID ?? null,
      modifyingAttributeID: m.modifyingAttributeID ?? null,
      // operation is absent only for EffectStopper, which the engine skips.
      operation: m.operation ?? 9,
      groupID: m.groupID ?? null,
      skillTypeID: m.skillTypeID ?? null,
    })),
  };
});

// ---- per-type dogma -------------------------------------------------------
const typeDogma = {};
await eachLine('typeDogma.jsonl', (t) => {
  typeDogma[t._key] = {
    a: (t.dogmaAttributes ?? []).map((x) => [x.attributeID, x.value]),
    e: (t.dogmaEffects ?? []).map((x) => [x.effectID, x.isDefault ? 1 : 0]),
  };
});

// ---- types (only the ones we might touch: anything with dogma) ------------
const types = {};
await eachLine('types.jsonl', (t) => {
  const gid = t.groupID ?? 0;
  const cid = groupCategory.get(gid) ?? 0;
  // Keep anything with dogma, plus all skills (cat 16) and ships (cat 6).
  if (!typeDogma[t._key] && cid !== 16 && cid !== 6) return;
  types[t._key] = {
    groupID: gid,
    categoryID: cid,
    mass: t.mass ?? null,
    capacity: t.capacity ?? null,
    volume: t.volume ?? null,
    radius: t.radius ?? null,
    name: en(t.name) ?? '',
  };
});

const pack = { sde: path.basename(sdeDir), types, typeDogma, dogmaAttributes, dogmaEffects };
fs.writeFileSync(outPath, JSON.stringify(pack));
console.error(
  `datapack: ${Object.keys(types).length} types, ${Object.keys(typeDogma).length} typeDogma, ` +
    `${Object.keys(dogmaAttributes).length} attrs, ${Object.keys(dogmaEffects).length} effects -> ${outPath}`,
);
