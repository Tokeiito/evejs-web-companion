#!/usr/bin/env node
/**
 * Diff EveJS's fitting statistics against the dogma-engine oracle.
 *
 * Usage:
 *   node compare.mjs <oracle-out.json> <evejs-out.json> <datapack.json>
 *
 * Classifies every hull-attribute difference so the report can distinguish
 * "the math disagrees" from "one side does not model this at all".
 */
import fs from 'node:fs';

const [, , oraclePath, evejsPath, packPath] = process.argv;
if (!oraclePath || !evejsPath || !packPath) {
  console.error('usage: node compare.mjs <oracle-out.json> <evejs-out.json> <datapack.json>');
  process.exit(2);
}

const O = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
const E = JSON.parse(fs.readFileSync(evejsPath, 'utf8'));
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const nm = (id) => (pack.dogmaAttributes[id] || {}).name || `attr${id}`;
const dflt = (id) => (pack.dogmaAttributes[id] || {}).defaultValue;

// Attributes EveJS computes that the oracle has no concept of (fitting
// resources / hardpoint accounting). Not divergences.
const EVEJS_ONLY = new Set([15, 49, 101, 102, 1152, 1153, 1154]);

const RES = {
  shield: { hp: 263, res: [271, 272, 273, 274] },
  armor: { hp: 265, res: [267, 268, 269, 270] },
  hull: { hp: 9, res: [113, 111, 109, 110] },
};
const EPS = 1e-6;

function classify(id, base, o, e) {
  if (e === undefined) return 'MISSING_IN_EVEJS';
  if (Math.abs(o - e) <= EPS) return 'MATCH';
  if (o === 0 && e === 5) return 'PHANTOM_SHIPBONUS';
  if (base === 5 && o === 25 && e === 5) return 'PHANTOM_SHIPBONUS';
  if (e === 0 && o !== 0) return 'EVEJS_ZERO';
  return 'VALUE_DIFF';
}

console.log('# Attribute-level classification (EveJS assumed-active vs oracle)\n');
const totals = {};
const detail = { VALUE_DIFF: [], EVEJS_ZERO: [], MISSING_IN_EVEJS: [] };

for (const of_ of O) {
  const ef = E.find((x) => x.id === of_.id);
  if (!ef) continue;
  const base = new Map(of_.hull.map((a) => [a.id, a.base]));
  const oracle = new Map(of_.hull.map((a) => [a.id, a.value]));
  const evejs = new Map(
    Object.entries(ef.attributesAssumedActive).map(([k, v]) => [Number(k), Number(v)]),
  );

  const counts = {};
  for (const [id, o] of oracle) {
    if (EVEJS_ONLY.has(id)) continue;
    const cls = classify(id, base.get(id), o, evejs.get(id));
    counts[cls] = (counts[cls] || 0) + 1;
    totals[cls] = (totals[cls] || 0) + 1;
    if (detail[cls]) {
      detail[cls].push({ fit: of_.id, id, base: base.get(id), o, e: evejs.get(id) });
    }
  }
  console.log(
    of_.id.padEnd(16),
    Object.entries(counts)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('  '),
  );
}
console.log('\nTOTALS:', JSON.stringify(totals));

for (const cls of ['VALUE_DIFF', 'EVEJS_ZERO', 'MISSING_IN_EVEJS']) {
  const rows = detail[cls];
  console.log(`\n## ${cls} (${rows.length})`);
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.id}`;
    if (cls !== 'VALUE_DIFF' && seen.has(key)) continue;
    seen.add(key);
    console.log(
      ` ${String(r.id).padStart(5)} ${nm(r.id).padEnd(30)} base=${String(r.base).padEnd(14)}` +
        ` oracle=${String(r.o).padEnd(20)} evejs=${r.e} (attrDefault=${dflt(r.id)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Derived fitting-window statistics, computed from the ORACLE's attributes.
// EveJS computes none of these; they are the reference values a fitting window
// would have to show.
// ---------------------------------------------------------------------------
console.log('\n\n# Derived fitting-window statistics (oracle reference values)\n');
for (const f of O) {
  const ef = E.find((x) => x.id === f.id);
  const g = (id) => {
    const a = f.hull.find((x) => x.id === id);
    return a ? a.value : null;
  };

  let ehp = 0;
  const layers = [];
  for (const [name, spec] of Object.entries(RES)) {
    const hp = g(spec.hp) ?? 0;
    const res = spec.res.map((r) => g(r) ?? 1);
    const avg = res.reduce((a, b) => a + b, 0) / res.length;
    ehp += hp / avg;
    layers.push(
      `${name} ${Math.round(hp)}hp [${res.map((r) => `${((1 - r) * 100).toFixed(1)}%`).join('/')}]`,
    );
  }

  // Align time: t = -ln(0.25) * inertiaModifier * mass / 1e6
  const mass = g(4);
  const agility = g(70);
  const align = mass && agility ? (-Math.log(0.25) * agility * mass) / 1e6 : null;

  // DPS / volley from turret + missile modules.
  let dps = 0;
  let volley = 0;
  for (const it of f.items) {
    const a = (id) => {
      const x = it.attributes.find((y) => y.id === id);
      return x ? x.value : null;
    };
    const rof = a(51);
    if (!rof) continue;
    const mult = a(64) ?? 1;
    const src = it.charge_attributes ?? it.attributes;
    const dmg = [114, 116, 117, 118].reduce((s, id) => {
      const x = src.find((y) => y.id === id);
      return s + (x ? x.value : 0);
    }, 0);
    if (!dmg) continue;
    volley += dmg * mult;
    dps += (dmg * mult) / (rof / 1000);
  }

  console.log(`== ${f.id}  (${f.ship_name})`);
  console.log(`   EHP (uniform profile) ${Math.round(ehp)}   ${layers.join(' | ')}`);
  console.log(
    `   maxVelocity ${g(37)}  mass ${mass}  inertia ${agility}  align ${align ? align.toFixed(2) + 's' : 'n/a'}`,
  );
  console.log(
    `   capacitor ${g(482)} / recharge ${g(55)}ms   targetRange ${g(76)}m  scanRes ${g(564)}  sig ${g(552)}`,
  );
  if (dps) console.log(`   DPS ${dps.toFixed(1)}  volley ${volley.toFixed(1)}`);
  if (ef) {
    console.log(
      `   [EveJS computes] cpu ${ef.summary.cpuLoad}/${ef.summary.cpuOutput}  pg ${ef.summary.powerLoad}/${ef.summary.powerOutput}`,
    );
  }
}
