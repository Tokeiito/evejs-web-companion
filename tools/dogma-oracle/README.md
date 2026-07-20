# Dogma oracle harness

A **read-only measuring instrument**. It runs an independent EVE Online dogma
engine over a fixed fit corpus so EveJS's own ship-statistic maths can be
checked against a second opinion. It changes no game mechanics and writes
nothing to any game store.

Output: [`docs/dogma-divergence-report.md`](../../docs/dogma-divergence-report.md).

## The oracle

[`third_party/dogma-engine`](third_party/dogma-engine) is a verbatim vendored
copy of **EVEShipFit's `dogma-engine`** (MIT). See
[`third_party/dogma-engine/PROVENANCE.md`](third_party/dogma-engine/PROVENANCE.md)
for the upstream commit and licence terms. Its `LICENSE` file is kept intact.

There is **no published npm/WASM artifact** for it (neither
`@eveshipfit/dogma-engine` nor `@eveshipfit/data` exists on the public npm
registry; upstream publishes them to GitHub Packages, which needs auth), so it
is built from source with the local Rust toolchain. Only the library crate is
used — the upstream `rust` and `wasm` feature sets are disabled, which also
removes the Protobuf/`@eveshipfit/data` build dependency.

## Why it is a fair comparison

The oracle is fed **EveJS's own SDE** (build `3396210`, the same dump EveJS
imports its `typeDogma` table from) and **the same pilot skill sheet**. Both
engines therefore see identical static data and identical skill levels, so any
difference in the output is attributable to the *engine*, not to stale data.

## Reproducing

Three steps. Paths below assume `eve.js` and `evejs-web-poc` are siblings.

```bash
SDE=../../../eve.js/_local/sde/eve-online-static-data-3396210-jsonl
OUT=/tmp/dogma-oracle

# 1. Compact data pack from EveJS's SDE (~13 MB; not committed - CCP data).
node build-datapack.mjs "$SDE" "$OUT/datapack.json"

# 2. The oracle's numbers.
cargo build --release
./target/release/dogma-oracle "$OUT/datapack.json" corpus.json "$OUT/oracle-out.json"

# 3. EveJS's numbers (run from the eve.js repo).
node ../../../eve.js/tools/dogma-oracle/extract-evejs-stats.js \
     corpus.json "$OUT/evejs-out.json"

# 4. The diff.
node compare.mjs "$OUT/oracle-out.json" "$OUT/evejs-out.json" "$OUT/datapack.json"
```

## Files

| File | Role |
| --- | --- |
| `corpus.json` | The fit corpus. Consumed by **both** engines. |
| `skills-farmer.json` | Pilot skill sheet (character `140000005`, 511 skills at V). |
| `build-datapack.mjs` | SDE JSONL → compact JSON pack for the oracle. |
| `src/main.rs` | Implements dogma-engine's `Info` trait against that pack. |
| `compare.mjs` | Classifies every difference; prints derived stats. |
| `third_party/dogma-engine/` | Vendored MIT oracle. |

The EveJS-side extractor lives in the other repo, at
`eve.js/tools/dogma-oracle/extract-evejs-stats.js`. It builds synthetic
in-memory items and passes them through `buildShipResourceState`'s documented
`options.fittedItems` / `options.skillMap` injection points, so it never reads
or writes live character or inventory state.

## Data licensing

The data pack is derived from CCP's EVE Online Static Data Export and is subject
to the [CCP Developer License Agreement](https://developers.eveonline.com/license-agreement).
It is deliberately **not committed** — regenerate it locally with step 1.
