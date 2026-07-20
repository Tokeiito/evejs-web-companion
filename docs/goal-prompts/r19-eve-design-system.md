# Goal R19: EVE-like visual identity — a design system, applied to every panel

**Issued:** 2026-07-20 by the orchestrator (operator chose "design system + restyle every existing panel"). **Status:** Ready to run. **Web-only, presentation-only — no behavior, data, or bridge changes.**

The client works but looks like plain HTML tables and lists. This goal gives it an EVE-like visual identity and applies it consistently across **all** panels, so we don't end up half-EVE and half-default. R21 (the fitting window) will be built in this language, so the system must be good enough to build on.

## What exists to build on

- **Tailwind v4** is already integrated via `@tailwindcss/vite`, CSS-first (`web/src/styles.css` does `@import "tailwindcss"`), with the app's Eve-dark palette already lifted into an `@theme` block plus `@layer base` / `@layer components` (R8). Extend that — do not bolt on a second styling approach.
- **Responsive contract from R8 (must survive):** record tables carry `reflow` + a `data-label` on every `<td>` and sit inside a `table-wrap overflow-x-auto`; they reflow to stacked labelled cards at ≤640px. Control rows use `.controls`; row actions use `.row-actions`; interactive targets are ≥40px. The app shell is `#app`, capped and centred on desktop.
- **A new safety net from R18:** `web/src/ui/panelFirstMount.test.ts` renders **all 16 components** on first mount via a Svelte server-generator hook. Keep it green — it is now the only thing standing between us and another panel that dies on sight.

## Objective

1. **Define the design system** in `styles.css` (tokens + `@layer components`), documented briefly in `docs/`:
   - **Palette:** an EVE-style dark industrial scheme — near-black backgrounds, cool desaturated blue-greys, a restrained accent (the existing `--color-accent` is a starting point), plus semantic colours for good/warning/danger and for the shield/armor/hull triad (those three will be reused heavily by the fitting window).
   - **Chrome:** panel/frame treatment (thin borders, subtle inner glow or gradient, corner treatment), section headers, dividers.
   - **Typography:** a clear hierarchy — condensed/uppercase headers with letter-spacing for that EVE feel, comfortable body text, and **tabular numerals for all numeric columns** (ISK, quantities, distances, percentages must align).
   - **Density + data display:** tighter, more scannable rows; zebra or hover states; right-aligned numerics; a consistent treatment for "empty/none" states; bars/meters for used-vs-total resources (CPU, powergrid, cargo, capacitor).
   - **Controls:** buttons (primary/secondary/danger), inputs, selects, tabs — all touch-sized.
2. **Apply it to every panel**: Station, Inventory & Ship, Fitting, Industry, Market, Mail, Contracts, Agents & Missions, Agent Finder, Flight, Around Your Ship, Travel, Chat, plus login and character select. Replace bare tables/lists with the system's data-table and panel components. Keep each panel's information identical — this is presentation only.
3. **Keep it coherent**: one set of components used everywhere, not per-panel one-offs.

## Hard constraints

- **Presentation only.** Do not touch `flow.ts`, `api.ts`, the store, decoders, the BFF, or eve.js. Component markup may be restructured, but props/store reads/handlers stay identical.
- **R7d — zero visible numeric IDs** must still hold. Re-run the sweep and prove it.
- **R8 — responsive** must still hold: no horizontal page scroll at 360px, tables still reflow to labelled cards, targets still ≥40px. Verify at ~360 / ~768 / ~1280.
- **R9a — plain player language** must still hold.
- **`panelFirstMount.test.ts` must stay green** — all 16 panels still render on first mount.
- Don't regress readability for the sake of theme: contrast must stay legible (aim for WCAG AA on body text), and nothing critical should be conveyed by colour alone.

## Required work

1. **Baseline** (record): web `npm test` (expect 779/779), `tsc` + `build:web` clean.
2. Build the system, then apply it panel by panel. Commit in coherent increments (system first, then panels) — each commit green.
3. **Verify visually at three widths.** You may run your own build/preview on a port that is NOT 26500 to drive a browser and check; do NOT start/stop/restart the orchestrator's web app (:26500) or the operator's EveJS (:26002) / market daemon (:40111). Report what you actually observed at each width.
4. Update the roadmap (R19 row) and add the short design-system doc. Commit; report hashes. **Do not push.**

## Definition of done

- A documented EVE-like design system exists in the Tailwind layer and **every** panel uses it; the app reads as one product rather than default HTML. All invariants (R7d / R8 / R9a / first-mount) verified and green; `tsc` + `build:web` clean; behavior and data unchanged. Committed; hashes reported; not pushed.

## Constraints

- Web repo only; eve.js untouched. Never `git add -A` — stage only your files. **Never push** (something external auto-pushes this repo; that is not you).
- Note `tools/dogma-oracle/**` belongs to R20 — leave it alone.
