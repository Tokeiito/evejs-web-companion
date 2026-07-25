// A module's EFFECTIVE stats for the fitting window (goal R21, slice B).
//
// WHERE THESE NUMBERS COME FROM
//
// Every value here is read straight out of the SERVER's post-dogma attribute
// map for one fitted module — the `attributes` dict on a `DogmaItemInfo` in the
// `GetAllInfo` snapshot (bridge/boundDogma.ts). The server has ALREADY applied
// the character's skills, the hull's bonuses and any in-space effects before it
// sends these, so an "Optimal range" here is the range THIS pilot's gun reaches
// on THIS hull, not the type's base. The browser never recomputes any of it; it
// only labels, orders and formats what the server measured.
//
// WHY A CURATED MAP, VERIFIED AGAINST THE SDE
//
// A module reports hundreds of attributes, most of them plumbing. This map is
// the handful a player actually reads off a module, and each id was checked
// against this build's own `dogmaAttributes` (SDE `_key` + `name` + `unitID`) —
// a wrong id would render a confident WRONG stat, which is exactly the failure
// the fitting window's "never invent a value" rule exists to prevent. Only ids
// in this map are shown; everything else is left off rather than guessed at.
//
//   64  damageMultiplier    unit 104 (x)     51  speed  (rate of fire) unit 101 (ms)
//   114 emDamage            unit 113 (HP)    73  duration (cycle)      unit 101 (ms)
//   118 thermalDamage       unit 113 (HP)    54  maxRange (optimal)    unit 1   (m)
//   117 kineticDamage       unit 113 (HP)    158 falloff              unit 1   (m)
//   116 explosiveDamage     unit 113 (HP)    160 trackingSpeed        (rad/s)
//   68  shieldBonus         unit 113 (HP)    76  maxTargetRange       unit 1   (m)
//   84  armorDamageAmount   unit 113 (HP)    6   capacitorNeed        unit 114 (GJ)
//   50  cpu                 unit 106 (tf)    30  power                unit 107 (MW)

import type { DogmaAttribute } from "./boundDogma.ts";

const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** Metres, shown as km once the number gets long — the way EVE reads a range. */
function asRange(value: number): string {
  return value >= 1000
    ? `${NUMBER.format(value / 1000)} km`
    : `${NUMBER.format(Math.round(value))} m`;
}

/** A millisecond duration the server reports (rate of fire, cycle time) in seconds. */
function asSeconds(milliseconds: number): string {
  return `${NUMBER.format(milliseconds / 1000)} s`;
}

function asFixed(digits: number, suffix: string): (value: number) => string {
  return (value) => `${NUMBER.format(Number(value.toFixed(digits)))}${suffix}`;
}

/** One curated module attribute: what it is called, its SDE unit, how it reads. */
export interface ModuleAttributeSpec {
  /** dgmAttributeTypes `_key` — verified against the SDE, never assumed. */
  readonly id: number;
  /** Plain-language label, never the attribute name or id. */
  readonly label: string;
  /** The SDE unit this attribute is measured in (documentation + the tests). */
  readonly unit: string;
  /** Render the raw EFFECTIVE value as a human string, INCLUDING its unit. */
  readonly format: (value: number) => string;
}

/**
 * The curated attributes, in the order EVE's own module info reads them: what
 * it does to a target first (damage, tracking, range), then what it costs to
 * run (activation, CPU, powergrid). A module simply omits the ones it does not
 * carry — a turret has no shield-boost figure, a hardener no optimal range.
 */
export const MODULE_ATTRIBUTES: readonly ModuleAttributeSpec[] = [
  { id: 64, label: "Damage multiplier", unit: "x", format: (v) => `×${NUMBER.format(Number(v.toFixed(2)))}` },
  { id: 114, label: "EM damage", unit: "HP", format: asFixed(1, " HP") },
  { id: 118, label: "Thermal damage", unit: "HP", format: asFixed(1, " HP") },
  { id: 117, label: "Kinetic damage", unit: "HP", format: asFixed(1, " HP") },
  { id: 116, label: "Explosive damage", unit: "HP", format: asFixed(1, " HP") },
  { id: 51, label: "Rate of fire", unit: "s", format: asSeconds },
  { id: 73, label: "Activation time", unit: "s", format: asSeconds },
  { id: 54, label: "Optimal range", unit: "m", format: asRange },
  { id: 158, label: "Falloff", unit: "m", format: asRange },
  { id: 160, label: "Tracking speed", unit: "rad/s", format: asFixed(4, " rad/s") },
  { id: 68, label: "Shield boost", unit: "HP", format: asFixed(0, " HP") },
  { id: 84, label: "Armor repaired", unit: "HP", format: asFixed(0, " HP") },
  { id: 76, label: "Max targeting range", unit: "m", format: asRange },
  { id: 6, label: "Activation cost", unit: "GJ", format: asFixed(1, " GJ") },
  { id: 50, label: "CPU", unit: "tf", format: asFixed(1, " tf") },
  { id: 30, label: "Powergrid", unit: "MW", format: asFixed(1, " MW") },
];

/** One curated stat, ready to render: its label and its formatted effective value. */
export interface ModuleStat {
  readonly id: number;
  readonly label: string;
  readonly value: string;
}

/**
 * The curated EFFECTIVE stats of one module, in reading order, keeping ONLY the
 * attributes the module actually reports as a finite number. Anything absent is
 * dropped rather than shown as zero — the same discipline the ship stats keep,
 * because a fabricated 0 in a fitting window is a claim we are not entitled to.
 */
export function moduleEffectiveStats(
  attributes: readonly DogmaAttribute[] | undefined,
): readonly ModuleStat[] {
  if (!attributes || attributes.length === 0) {
    return [];
  }
  const byID = new Map<number, number>();
  for (const attribute of attributes) {
    if (typeof attribute.value === "number" && Number.isFinite(attribute.value)) {
      byID.set(attribute.attributeID, attribute.value);
    }
  }
  const stats: ModuleStat[] = [];
  for (const spec of MODULE_ATTRIBUTES) {
    const value = byID.get(spec.id);
    if (value !== undefined) {
      stats.push({ id: spec.id, label: spec.label, value: spec.format(value) });
    }
  }
  return stats;
}
