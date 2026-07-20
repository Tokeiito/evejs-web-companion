# Dogma divergence report — EveJS vs. an independent engine

**Goal R20.** Investigation and harness only; **no game mechanics were changed**.
Produced 2026-07-20.

The browser fitting window (R21) is to show real ship statistics, taken as
**server-authoritative** — EveJS computes them, and we make EveJS correct. This
report is the evidence for deciding *what* needs correcting.

---

## Headline

**EveJS's dogma maths is correct.** Across the whole corpus, on every attribute
both engines model, there are **zero value disagreements**.

```
TOTALS: MATCH=767  VALUE_DIFF=0  EVEJS_ZERO=36  MISSING_IN_EVEJS=24  PHANTOM_SHIPBONUS=2798
```

That includes the cases specifically chosen to be hard: multi-module stacking
penalties, hull role bonuses scaled by skill level, and skill-driven
pre-multiplication of per-level bonus attributes. The Drake's four shield
resonances — hull resist bonus × two stacking-penalised hardeners × four
compensation skills — agree to **fifteen significant figures**.

The problems are therefore **not** arithmetic. They are, in order of how much
they threaten the fitting window:

1. a **call-path trap** that silently halves every resistance number;
2. a set of **statistics EveJS does not compute at all** (EHP, DPS, cap
   stability, align time) — the bulk of what the window needs;
3. two small, real **data/seeding defects**;
4. cosmetic **attribute-map pollution**.

---

## Method

Both engines were fed **identical inputs**, so any difference is attributable to
the engine and not to stale data.

| | |
| --- | --- |
| **Oracle** | EVEShipFit `dogma-engine` (Rust, MIT), commit `e8e536b`, vendored at `tools/dogma-oracle/third_party/dogma-engine/` |
| **Static data** | EveJS's own SDE, build **3396210** — the same dump EveJS imports its `typeDogma` table from |
| **Skills** | The operator character's real sheet (`140000005`): 511 skills, all at level V |
| **EveJS entry point** | `liveFittingState.buildShipResourceState()`, driven with synthetic in-memory items via its documented `options.fittedItems` / `options.skillMap` hooks — no live character or inventory state is read or written |

Reproduction command in [`tools/dogma-oracle/README.md`](../tools/dogma-oracle/README.md).

### On getting the oracle running

There is **no published artifact**. Neither `@eveshipfit/dogma-engine` nor
`@eveshipfit/data` exists on the public npm registry — upstream publishes to
GitHub Packages (`@eveshipfit:registry=https://npm.pkg.github.com`), which
requires authentication we do not have. It was therefore built from source with
the local Rust toolchain (cargo 1.95.0).

Building the **library only** (`default-features = false`) avoids the entire
problem: it drops the `wasm` feature (no `wasm-pack` needed, which is not
installed) and the `rust` feature, whose `build.rs` is what pulls in Protobuf
and `@eveshipfit/data`. The engine's `Info` trait is implemented locally against
EveJS's SDE instead. Total build time under 4 seconds.

`EVEShipFit/data`'s licence was checked as instructed: its own code is MIT, but
the EVE data it carries is governed by the **CCP Developer License Agreement**
(`LICENSE.EVE`). Nothing from that repo is vendored — the data pack is generated
locally from the SDE EveJS already ships, and is deliberately not committed.

### The fit corpus

Each fit is `(shipTypeID, [modules by slot])`, in
[`tools/dogma-oracle/corpus.json`](../tools/dogma-oracle/corpus.json), consumed
by **both** engines. `slot`/`index` map to EveJS flagIDs as
`low→11+i, medium→19+i, high→27+i, rig→92+i`.

| id | ship | what it exercises |
| --- | --- | --- |
| `mammoth-bare` | Mammoth (652) | unfitted hull baseline |
| `mammoth-farmer` | Mammoth + 5× Expanded Cargohold II | **the ship Farmer actually flies** (`activeShipID 9988400029047`, docked Jita 4-4); five identical modules — textbook stacking penalty |
| `rifter-bare` | Rifter (587) | unfitted hull baseline |
| `rifter-tank` | Rifter + DCII, SAR II, 2× Multispectrum Coating II, SSE II, Trimark | armour/shield resists, resist stacking, rig |
| `rifter-guns` | Rifter + 3× 200mm AutoCannon II / EMP S, 2× Gyrostabilizer II | turret DPS, damage-multiplier stacking, charges |
| `rifter-prop` | Rifter + 5MN MWD II, 2× Nanofiber, 2× Inertial Stabilizers | speed, mass, inertia, align, signature bloom |
| `drake-shield` | Drake + 6× HML II / Fury, 2× LSE II, 2× Multispectrum Shield Hardener II, 2× BCS II, 2× CDFE | hull role bonus × skill level, resist + HP stacking, missile DPS |
| `skiff-mining` | Skiff + 2× Modulated Strip Miner II, 2× Mining Laser Upgrade II | the mining case; exhumer role bonuses |

---

## Findings, ranked by impact

### 1. HIGH — active-module effects are opt-in, and the default silently halves your tank

`buildShipResourceState()` on its own applies only **passive and online** effects.
Every *active* module — hardeners, afterburners, repairers — contributes nothing.
Nothing errors; you just get quietly wrong numbers.

On `drake-shield`, both hardeners vanish and only the hull's resist bonus lands:

| attribute | oracle | EveJS, passive-only | EveJS, assumed-active |
| --- | --- | --- | --- |
| `shieldEmDamageResonance` (271) | 0.38746944336953026 | **0.8** | 0.38746944336953026 ✅ |
| `shieldExplosiveDamageResonance` (272) | 0.19373472168476513 | **0.4** | 0.19373472168476513 ✅ |
| `shieldKineticDamageResonance` (273) | 0.23248166602171813 | **0.48** | 0.23248166602171813 ✅ |
| `shieldThermalDamageResonance` (274) | 0.30997555469562427 | **0.64** | 0.30997555469562427 ✅ |

In player-facing terms that is **EM resist 20% instead of 61.3%**, and Drake EHP
**~38 000 instead of ~76 000** — a factor-of-two error on the single most
prominent number in a fitting window.

The correct call path already exists and is used by
`_secondary/fitting/fittingSnapshotBuilder.js`:

```js
const assumed = collectAssumedActiveFittingEffects({ characterID, shipItem, fittedItems, skillMap });
buildShipResourceState(characterID, shipItem, {
  fittedItems, skillMap,
  additionalAttributeModifierEntries: assumed.shipAttributeModifierEntries,
});
```

**This is not a maths bug — it is an API trap.** No fix to the engine is needed.
R21 must go through `buildFittingSnapshot()` (or replicate the wiring above) and
must never call `buildShipResourceState()` bare. Worth a regression test that
asserts a Drake's EM resist is ~61%, so the trap cannot be re-entered silently.

### 2. MEDIUM — `warpCapacitorNeed` is truncated to zero for 563 types

A precision defect in the **SDE import**, not in the engine. Every attribute
value below roughly `1e-5` is stored as `0`:

```
total (typeID, attribute) pairs   643 235
lost to zero                          637   (0.10%)
magnitude of lost values (log10)  -6:228  -7:334  -8:61  -9:14
```

| attribute | types affected |
| --- | --- |
| `warpCapacitorNeed` (153) | **563** |
| `accessDifficulty` (901) | 37 |
| `jumpPortalConsumptionMassFactor` (1001) | 20 |
| `agility` (70) | 16 |
| `agilityMultiplier` (169) | 1 |

Rifter: SDE `2.24e-6`, oracle `1.12e-6` (halved by Warp Drive Operation V),
EveJS `0`. Warping is capacitor-free.

Origin is `tools/DatabaseCreator` (the SDE → `_local/gameStore` conversion) —
`getTypeDogmaAttributes(587)` already returns `0` before any dogma runs. Almost
certainly an integer/rounding coercion on a `dataType: 5` float.

**Checked and clear:** none of the 16 `agility` losses is a ship — they are all
XL cruise missile charges. **Align time is not affected.** The exposure is
capacitor simulation, not the fitting window.

### 3. LOW–MEDIUM — modified attributes are seeded at `0` instead of the SDE `defaultValue`

When an effect modifies an attribute the item does not itself carry, EveJS
creates it at `0`; the oracle creates it at the attribute's SDE `defaultValue`.
A multiplicative modifier then yields `0` forever.

| attribute | SDE default | oracle | EveJS |
| --- | --- | --- | --- |
| `advancedAgility` (853) | 1 | 0.75 | **0** |
| `advancedCapitalAgility` (874) | 1 | 0.75 | **0** |
| `jumpDriveCapacitorNeed` (898) | 1 | 0.75 | **0** |
| `jumpDriveConsumptionAmount` (868) | 2000 | 1000 | **0** |

On this corpus it only touches capital/jump-drive attributes — **no impact on
the ships anyone here flies**. It is listed because it is a latent correctness
bug: any attribute with a non-zero default that gets modified without being
present on the hull will read zero. Capital ships would surface it immediately.

### 4. LOW (cosmetic) — ~350 phantom `shipBonus*` entries per fit

EveJS writes the pilot's skill level (`5`) into ~350 `shipBonus*` /
`eliteBonus*` attributes that the hull does not have. The oracle either leaves
them absent or resolves them to `default × level`.

**Numerically harmless — verified.** Bonuses the hull *does* have are computed
correctly by both engines:

| Drake attribute | hull base | oracle | EveJS |
| --- | --- | --- | --- |
| `shipBonusCBC1` (743) | 10 | 50 | 50 ✅ |
| `shipBonusCBC2` (745) | −4 | −20 | −20 ✅ |
| `roleBonusCBC` (2043) | 25 | 25 | 25 ✅ |

The consequence is noise: ~350 junk entries in a ~450-entry map. Anything that
renders "all attributes", diffs snapshots, or fingerprints fitting state pays
for it. Low priority, but it makes the attribute map hard to read.

### 5. LOW — `volume`, `radius` and `heatDamage` never reach the hull attribute map

`volume` (161) and `radius` (162) live on the *type* record, not in `typeDogma`,
and EveJS's ship attribute map does not pull them across (Mammoth: `radius` 617,
`volume` 255 000 — both absent). `heatDamage` (1211) is likewise absent.

Not needed for today's window, but `radius` is an input to warp-time and
alignment maths, so it will be wanted eventually.

---

## Statistics EveJS does not compute at all

**These are gaps, not divergences** — and they are the larger part of the work.
EveJS promotes exactly one set of named fields out of the attribute map
(`synchronizeShipResourceStateSummary`, `liveFittingState.js:2499`):

> `cpuOutput, powerOutput, cargoCapacity, droneCapacity, fighterCapacity,
> maxVelocity, agility, mass, maxTargetRange, maxLockedTargets, signatureRadius,
> cloakingTargetingDelay, scanResolution, capacitorCapacity,
> capacitorRechargeRate, shieldCapacity, shieldRechargeRate, armorHP,
> structureHP, upgradeCapacity, fuelBay, + mining-hold keys`

Everything the fitting window needs beyond that must be built:

| Statistic | Status in EveJS | Notes |
| --- | --- | --- |
| **EHP** | **Absent everywhere** for ships | No `ehp` / `effectiveHitPoints` anywhere in `server/src` for ships. A structure-only variant exists (`applyStructureEffectiveHitpointsToSnapshot`). Needs a damage-profile convention. |
| **Resistance percentages** | Raw resonances only | Attributes 267–274 / 109–113 are present **and correct**; nothing promotes them to named fields or converts `resonance → 1 − resonance`. Cheapest possible win. |
| **DPS / volley / alpha** | **No aggregation at all** | Per-shot damage vectors exist (`droneDogma.js`, `fighterDogma.js`, `precursorTurrets.js`); nothing sums weapons into a fit-level number. |
| **Capacitor stability** | **No solver** | Capacity and recharge rate are exposed; there is a non-linear recharge simulation in `space/runtime.js` but no stability/depletion calculation. The oracle's own pass-4 `capacitorDepletesIn` is *also* unavailable to us — it needs EVEShipFit's custom negative-ID attributes, which are not in the SDE. **Both engines lack this; it must be written from scratch.** |
| **Align time** | Helper exists, not wired in | `calculateAlignTimeSecondsFromMassInertia()` at `space/runtime.js:9639`. Not part of fitting state. Inputs (`mass`, `agility`) are present and correct. |
| **Skill-aware module attributes** | **Not exported** | `buildEffectiveFittedModuleAttributeMap()` is private. The only exported module API, `buildEffectiveItemAttributeMap()`, ignores ship and skill context — it reports the Rifter's autocannon `damageMultiplier` as 3.465 where the true fitted value is 6.5507. **This is the blocker for DPS**, and it is a one-line export, not new maths. |
| Drone / fighter DPS contribution | Absent | Per-drone dogma exists; no fit-level aggregation. |
| Repair / boost rates (HP/s) | Absent | Module attributes present. |
| Turret optimal + falloff, missile flight time / range | Absent at fit level | Present per module. |
| Warp speed, warp time | Absent | |

**Corroborating evidence that the underlying maths is sound:** per-module CPU and
powergrid loads — the one place EveJS *does* expose skill-aware module numbers —
match the oracle exactly on every module in the corpus, including the Skiff's
awkward `71.77734375`.

---

## Reference values

Computed from the oracle's attributes; these are what a correct fitting window
should show for this pilot. EHP uses a uniform (25/25/25/25) damage profile.

| fit | EHP | shield resists (EM/Exp/Kin/Th) | velocity | align | DPS | volley |
| --- | --- | --- | --- | --- | --- | --- |
| `mammoth-bare` | 3 959 | 0 / 50 / 40 / 20 | 187.5 | 9.79 s | — | — |
| `mammoth-farmer` | 2 687 | 0 / 50 / 40 / 20 | 108.3 | 9.79 s | — | — |
| `rifter-bare` | 2 262 | 0 / 50 / 40 / 20 | 456.3 | 3.20 s | — | — |
| `rifter-tank` | 4 674 | 12.5 / 56.3 / 47.5 / 30 | 456.3 | 3.35 s | — | — |
| `rifter-guns` | 2 262 | 0 / 50 / 40 / 20 | 456.3 | 3.20 s | 197.6 | 271.2 |
| `rifter-prop` | 2 027 | 0 / 50 / 40 / 20 | 540.8 | 1.84 s | — | — |
| `drake-shield` | 75 982 | 61.3 / 80.6 / 76.8 / 69.0 | 187.5 | 8.21 s | 266.5 | 1 989.9 |
| `skiff-mining` | 41 449 | 20 / 60 / 52 / 36 | 137.5 | 11.98 s | — | — |

Note `mammoth-farmer`: five Expanded Cargohold II take cargo from 6 875 to
23 164 m³ (stacking penalty applied, both engines agreeing exactly) while
structure HP collapses from 1 169 to 316 — hence EHP *dropping* from 3 959 to
2 687. Both engines agree on every term.

---

## Recommendation

**Fixing EveJS's dogma is not the job. There is nothing meaningful to fix.** The
engine agrees with an independent implementation on every attribute both model.
The work R21 actually needs is **derivation and exposure**, not correction.

Suggested order:

1. **Use the right call path.** Go through `buildFittingSnapshot()` (or wire
   `collectAssumedActiveFittingEffects` yourself). Add a regression test pinning
   a Drake's EM resist near 61%. *Cost: near zero. Skipping it makes every tank
   number wrong by ~2×.*
2. **Promote resistances.** `1 − resonance` for the twelve attributes already
   computed correctly. *Cost: trivial. Immediately unblocks resists and EHP.*
3. **Derive EHP and align time.** Both are pure functions of attributes already
   present and correct; the align-time helper already exists. Needs a decision on
   the default damage profile (uniform vs. omni vs. user-selectable).
4. **Export `buildEffectiveFittedModuleAttributeMap`,** then aggregate DPS/volley
   over turrets, launchers and drones. Adding the export is one line; the
   aggregation is the real work, and `tools/dogma-oracle` gives you a reference
   to check it against (Rifter 197.6 DPS, Drake 266.5 DPS).
5. **Capacitor stability** — genuinely new work, and the only item here neither
   engine can help with. Defer unless the operator wants it in the first cut.
6. **Optional cleanups**, all outside the fitting window's critical path: the
   `defaultValue` seeding bug (item 3), the SDE import truncation (item 2), the
   phantom `shipBonus` writes (item 4).

Steps 1–4 are shallow and well-bounded. Only step 5 is deep, and it is separable.

---

## Caveats

- **Uniform-damage EHP** is one convention among several; the oracle does not
  prescribe one either (its `Ship::damage_profile` defaults to 25/25/25/25).
- **Charges, drones and implants** are only lightly covered. The corpus has no
  drone-heavy fit, and implants were disabled
  (`includeActiveImplantModifiers: false`) to keep inputs identical.
- **Overheating** is untested — no module in the corpus is in the `Overload`
  state.
- **Strategic cruisers** are untested; subsystems mutate slot counts and take a
  separate code path in both engines.
- The oracle's own pass-4 derived attributes are unavailable here (they depend on
  EVEShipFit's custom attribute definitions), so the oracle was used strictly as
  an **attribute-level** reference. All derived statistics in this report were
  computed by `compare.mjs` from those attributes.
