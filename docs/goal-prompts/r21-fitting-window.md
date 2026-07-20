# Goal R21: The fitting window — radial slot layout + real ship statistics

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. The operator's ask: *"a fitting window with the same look/feel as EVE Workbench or other fitting tools"* — i.e. a real fitting tool, not a styled table.

## The target

Reference: `https://eveworkbench.com/fit/…`. Observed structure:

- **RADIAL view (desktop/tablet)** — the ship at the centre with its slots arranged in **arcs around it**, each slot a socket showing the fitted module (empty sockets visibly empty and clickable). This is the signature look and the point of this goal.
- **LIST view (mobile)** — the same fit as a list. EVE Workbench explicitly offers both and lets the user choose, noting "for smartphone users we suggest the List-view." **Our R8 responsive contract already thinks this way** — radial above the breakpoint, list below, with a manual toggle so a desktop user can pick list too.
- **Stat panels alongside**, grouped exactly as the reference groups them: **Firepower** (total DPS, weapons, drones, volley) · **Mining** (m³/s) · **Resource usage** (CPU, powergrid, drone bay, drone bandwidth — used vs available) · **Resistance** (4 damage types × shield/armor/hull, each as a %, with EHP per layer and a total) · **Capacitor** (capacity, delta, recharge, "lasts for") · **Repairs** (EHP/s per layer) · **Targeting & misc** (targets, targeting range, drone range, scan resolution, sensor strength, signature radius, speed, warp speed, align time, cargo).
- Header identifies the ship and class; charges / drone bay / cargo bay contents are shown.

## Slice A — the fitting window (commit first)

1. **Radial layout.** Ship centred; slot sockets positioned on arcs grouped by family (high / mid / low / rig, plus subsystem when present). SVG or CSS-positioned nodes, computed from the slot counts the server reports — never hardcode 8/8/8. Each socket: fitted module (icon if we have one, else its name), or an empty socket. Clicking a socket drives the **existing** R12 fit/unfit/online-offline actions; rig removal keeps its two-step destroy confirm.
2. **Icons.** Check whether module/ship icons are available locally (`config.iconCacheDir`, gameStore `itemIcons`, and the existing icon-manifest work) and use them if so; otherwise fall back to a clean text/abbreviation socket. Do **not** hotlink external image hosts.
3. **List view + toggle.** Below the R8 breakpoint default to list; above it default to radial; give the player a visible toggle either way and remember the choice.
4. **Use the R19 design system** — panel chrome, tabular numerals, meters, and especially the **shield / armor / hull triad tokens** (`--color-shield`, `--color-armor`, `--color-hull`) for the resistance and EHP displays.
5. Stat panels render with what we can honestly source today (see Slice B for the rest): resource usage from the existing read, plus the ship/class header and cargo/drone info.

## Slice B — real statistics (commit second)

The R20 dogma oracle established: **EveJS's maths is correct — 767 comparisons, zero value disagreements.** The gap is that it never *derives* player-facing stats. Read `docs/dogma-divergence-report.md` before starting.

Derive and display, server-authoritative:
- **Resistances** — EveJS holds correct raw *resonances*; promote them as `1 − resonance`. Trivial and correct.
- **EHP** — derive from layer HP + resists (already-correct attributes).
- **Align time** — a helper exists at `runtime.js:9639` but is not wired into fitting state.
- **DPS / volley** — blocked on one thing: `buildEffectiveFittedModuleAttributeMap` is not exported. Exporting it is a **one-line eve.js change**; that is the only game-mechanics-adjacent edit authorised here, and it must be an export only — no logic change. Reference values to pin: **Rifter 197.6, Drake 266.5**.
- **Speed, targeting, signature, warp speed, cargo** — from existing attributes.

⚠ **THE TRAP — pin it with a test.** `buildShipResourceState()` called bare applies only **passive and online** effects; active modules contribute nothing and *nothing errors*. That reads Drake EM resist as **20% instead of 61.3%** and EHP **~38k instead of ~76k** — every tank number ~2× wrong, silently. The correct path is `collectAssumedActiveFittingEffects` → `additionalAttributeModifierEntries` (see `fittingSnapshotBuilder.js`), which reproduces the oracle exactly. **Add a regression test asserting Drake EM ≈ 61%** so this can never be reintroduced.

⚠ **CAPACITOR STABILITY — DO NOT INVENT IT.** EveJS has no cap solver, and the oracle's own approach depends on EVEShipFit-specific attributes we cannot reuse; writing one is out of scope here. Show capacitor **capacity / recharge / delta** where sourceable, and mark stability explicitly **unavailable**. Never display a computed-looking number we did not compute. Same rule for any other stat you cannot source: show it as unavailable rather than zero or blank-that-reads-as-zero.

## Invariants (all must hold, all must be re-proven)

**R7d** zero visible numeric IDs · **R8** no horizontal scroll at 360px, targets ≥40px, tables still reflow · **R9a** plain player language · **R18** `panelFirstMount.test.ts` stays green (all panels render on first mount — this is the guard that catches a panel that dies on sight).

Server stays authoritative: the browser never simulates dogma. It displays what the server computes (plus arithmetic promotions like `1 − resonance` and EHP that are pure functions of server values).

## Required work

1. **Baseline** (record): web `npm test` (expect 779/779); eve.js suites green (19 gateway suites, manifest 3/3, agent-parity 6/6).
2. Slice A, commit. Slice B, commit. Tests for the slot geometry (counts drive the arcs), the derived-stat maths, the Drake-EM regression, and the "unavailable" rendering path.
3. Update `docs/bridge-wire-contract.md` (any new read), the roadmap (R21 row), and note in `docs/design-system.md` anything the fitting window adds.
4. Commit eve.js and web **separately**; report all hashes. **Do not push.**

## Definition of done

- The Fitting tab shows a radial fitting layout with the ship centred and its real slots as sockets, module-by-name (icons where available), fit/unfit/online actions working from the sockets, a list view below the breakpoint plus a toggle, and stat panels grouped like the reference — with resistances, EHP, align time, DPS and the rest derived from the server's own correct values, and **anything we cannot source shown honestly as unavailable**. All invariants re-proven; all suites green. Committed; hashes reported; not pushed.

## Constraints

- eve.js: **the only permitted change is exporting `buildEffectiveFittedModuleAttributeMap`** (export only, no logic change), plus tests. Everything else there is READ-ONLY. Branch `ReconcileEliteMode`; pathspec commit; never `git add -A`; never revert other agents' in-flight work.
- The OPERATOR runs EveJS (:26002) and the market daemon (:40111); the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart any of them. You may run your own preview on another port. **Never push.**
- Screenshots have been unavailable in this environment for two workers running — verify layout by measurement (computed styles, geometry, overflow sweeps) and **say plainly that you did not visually inspect it** rather than claiming otherwise.
