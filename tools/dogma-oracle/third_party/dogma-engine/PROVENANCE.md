# Provenance — EVEShipFit dogma-engine (vendored, unmodified)

| | |
| --- | --- |
| **Upstream** | https://github.com/EVEShipFit/dogma-engine |
| **Commit** | `e8e536be341959a8abdc6f02600fe449bc6f4764` (2025-06-17, "feat: support `/offline` suffix in EFT import (#66)") |
| **Vendored** | 2026-07-20 |
| **Licence** | MIT — Copyright (c) 2023 EVEShipFit Team. Full text in `LICENSE`, retained verbatim. |
| **Description** | "Library to calculate statistics for EVE Online ship fits" |

## What was changed

**Nothing in `src/`.** The Rust sources, `Cargo.toml`, `build.rs`, `README.md`
and `LICENSE` are byte-identical to upstream. Only `.git/` and `.github/` were
dropped, and this file was added.

## How it is consumed

As a path dependency with `default-features = false`, so only the library
(`calculate`, `data_types`, `info`) is compiled. The upstream `rust` and `wasm`
feature sets are **off**, which means:

- no `wasm-bindgen` / `wasm-pack` toolchain is needed;
- `build.rs` is a no-op, so the Protobuf compile step and its
  `@eveshipfit/data` npm dependency are not required.

The `info::Info` trait is implemented locally in `../../src/main.rs` against a
data pack derived from EveJS's own SDE, rather than upstream's Protobuf files.

## Attribution note

If any of this code or its derivatives ends up in a shipped artifact, the MIT
licence text in `LICENSE` and the copyright line above must travel with it.
