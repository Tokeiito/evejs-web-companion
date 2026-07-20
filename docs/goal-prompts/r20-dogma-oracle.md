# Goal R20: Dogma oracle — measure where EveJS's ship-stat calculations are wrong

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. **INVESTIGATION + HARNESS ONLY — change no game mechanics.**

The operator wants the browser fitting window to show real ship statistics (EHP, resistances, DPS, capacitor stability, align time, speed, targeting), and wants them **server-authoritative**: EveJS computes them, and we make EveJS *correct*. This goal builds the measuring instrument and produces the evidence — it does **not** fix anything yet.

## The oracle

**EVEShipFit** (https://github.com/EVEShipFit) publishes **`dogma-engine`** — "Library to calculate statistics for EVE Online ship fits", **Rust, MIT-licensed**. Sibling repos: `react` (MIT, a fit-display component library — *not* used here), `eveship.fit` (MIT), and `sde`/`data` (SDE→Protobuf pipelines, license listed as "Other" — **check the license before using those two**).

**Practicalities, in order of preference:**
1. **Prefer a published artifact** — check npm for an `@eveshipfit/*` dogma-engine / WASM package. Using a published package avoids needing a Rust toolchain.
2. If none exists, check whether Rust/cargo is available and building to WASM or a native binary is feasible.
3. **If neither works, STOP and report** — do not sink the session into toolchain yak-shaving. A clear "here is why it can't be built here, here is what it would take" is a perfectly good outcome.

Respect the MIT license: keep attribution and the license text with anything vendored, and record where it came from.

## Objective

1. **Get the oracle running** on a fixed set of fits (see 2). Vendor it under a clearly-marked third-party directory with its license.
2. **Choose a fit corpus** — a handful of fits that exercise the interesting math: at minimum one unfitted ship, one with tank modules (resist/EHP), one with weapons (DPS/volley), one with propulsion (speed/align), and ideally the ship Farmer is actually flying (`activeShipID 9988400029047`, at Jita 4-4) plus the Skiff-style mining case. Express each fit as (shipTypeID, [module typeIDs by slot]) so both sides can consume it.
3. **Get EveJS's numbers for the same fits.** Find what EveJS's dogma actually computes and how to extract it in-process (`server/src/` dogma / `liveFittingState.js` / the fitting services). A read-only harness that builds a fit in a test world and reads the resulting attributes is fine.
4. **Produce a DIVERGENCE REPORT** — the deliverable. For each fit and each statistic: EveJS's value, dogma-engine's value, the delta, and (where you can tell) a hypothesis for *why* (missing skill application, wrong stacking-penalty order, an unimplemented effect, a unit mismatch, …). Rank by impact — a wrong EHP or resist matters more than a rounding difference in scan resolution.
5. Note explicitly which statistics EveJS **does not compute at all** — those are gaps, not divergences, and they matter for the fitting-window design (R21).

## Hard constraints

- **Change no game mechanics.** Do not "fix" EveJS dogma in this goal — that is a separate, operator-authorized decision that depends on what you find. This goal is read-only on `eve.js/server/src` except for anything you add under tests/tools.
- Do not modify the web client's UI.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either. Run tests/harnesses of your own only.
- Other agents are active in eve.js with in-flight work — stage only your files, **pathspec commit**, never `git add -A`, never revert them. **Never push.**
- A parallel worker (R18) is fixing `web/src/ui/Fitting.svelte` — do not touch `web/src/ui/*`.

## Definition of done

- The oracle runs against a documented fit corpus; a **divergence report** is committed (a markdown doc under `docs/`) listing per-statistic EveJS vs dogma-engine values, deltas, ranked by impact, plus the list of statistics EveJS doesn't compute at all; the harness is reproducible (documented command) and its third-party code is properly attributed and licensed. No game mechanics changed. Committed; hash reported; not pushed.
- **Or**, if the oracle genuinely cannot be run in this environment: a committed report explaining precisely why, what was tried, and what it would take — with any EveJS-side gap analysis you *were* able to do by reading the code.

## Why this matters

The fitting window (R21) will display these numbers to a player as fact. We should know which of them are true before we render them.
