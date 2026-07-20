# Goal R8: Adopt Tailwind CSS and make the web client responsive (phone → desktop)

**Issued:** 2026-07-19 by the orchestrator; operator chose **Tailwind** for the responsive direction. **Status:** Ready to run. **Web-only — no eve.js change.**

The web client (Svelte 5 + Vite + TS) is desktop-shaped and breaks on phones (wide tables, a fixed tab row, small touch targets). Adopt **Tailwind CSS** and make every current tab **mobile-first responsive**, working from ~360px phones up to desktop — **without changing any behavior, data flow, or the R7b–R7d work** (especially: do NOT reintroduce any visible numeric IDs — names only stays true).

You are a worker session. Read FIRST: `web/src/ui/*.svelte`, `web/src/main.ts`/entry + `index.html`/the HTML template, `vite.config.*`, `package.json`, and any global CSS. Understand the current styling (scoped `<style>` blocks vs global) before changing it. Execute exactly this goal, then stop.

## Setup

1. Add **Tailwind** to the Vite build using the current stable release and the first-party Vite integration (Tailwind v4 + `@tailwindcss/vite` and `@import "tailwindcss"` CSS-first, unless you find a reason to use v3+PostCSS — record which and why). Wire it so `npm run build:web` emits the Tailwind CSS into the existing `public/dist/` bundle and the app picks it up. Ensure the HTML has a proper `<meta name="viewport" content="width=device-width, initial-scale=1">`.
2. Keep the toolchain green: `tsc`, `npm run build:web`, and `npm test` must all pass. Add the Tailwind deps to `package.json` (committed); do not break the existing build.

## Responsive requirements (mobile-first)

Establish a small, coherent design system with Tailwind and apply it across all tabs:
- **Layout/container:** a fluid page container, no horizontal body overflow at 360px; readable line lengths on desktop.
- **Navigation (the tab bar: Station / Inventory & Ship / Agents & Missions / Agent Finder / Flight / Travel / Chat):** must work on a phone — wrap or horizontally scroll or collapse into a menu; tabs are touch-sized (≥40px hit area).
- **Tables → cards on narrow screens (the key fix):** Inventory (hangar/cargo rows), Agents & Missions (agent list, journal), Station guests, and any other data table must reflow to a **stacked, labeled card layout** on phones (each row becomes a labeled block) while keeping the table on wider screens. No tiny horizontally-crushed tables. Where a table must scroll, wrap it in its own `overflow-x-auto` container so the page itself never scrolls sideways.
- **Forms/controls:** inputs, selects, and buttons are full-width-friendly and touch-sized on mobile; the Flight/Travel/Chat send controls stack cleanly.
- **Chat:** the roster + message list + send box lay out sensibly on a phone (message list scrolls within its own area; send box reachable).
- **Typography/spacing:** consistent scale via Tailwind; respect the existing light/dark look if there is one (support both if the app already does; otherwise keep the current palette).

## Constraints on scope

- **Behavior-preserving only.** No changes to `flow.ts`, `api.ts`, the store, decoders, or any bridge/BFF code — this is presentation. If a `.svelte` component's markup must be restructured for responsiveness, keep its props/store reads/handlers identical.
- **Do not reintroduce IDs.** The R7d "names only" result must hold — re-run the ID grep sweep after restyling.
- Preserve the developer description blurbs' content (you may restyle them, e.g. small/muted), but don't remove them in this pass.

## Required work

1. **Baseline** (record): web `npm test` (expect 358/358), `build:web` clean.
2. Tailwind setup + verify (a smoke that a Tailwind utility class actually applies in the built app). Commit the setup as a coherent first commit.
3. Responsive restyle of the layout + nav + every tab per the requirements. Commit (may be incremental by area, each commit green).
4. **Verify at widths:** confirm no horizontal overflow and usable layout at ~360px (mobile), ~768px (tablet), and desktop — describe how you checked (e.g. build + inspect the CSS/markup; if you can drive a browser at a set viewport, do so, but do NOT start/stop the orchestrator's servers). Re-run the **ID grep sweep** and report it clean.
5. Update README (responsive/Tailwind note) + roadmap (R8 row). `tsc` + `build:web` + `npm test` all green; commit; report hash(es). **Do not push.**

## Out of scope

- eve.js changes. New features or data. A full visual redesign/rebrand — this is responsiveness + adopting Tailwind, keeping the app recognizable. Chat XMPP work (R7b, separate).

## Definition of done

- Tailwind is integrated into the Vite build; every tab is usable on a ~360px phone (no sideways scroll, touch-sized controls, tables reflow to cards, nav works), and still good on desktop. Behavior/data unchanged; zero visible IDs still holds (grep proof). `tsc`/`build:web`/`npm test` green. Committed; hashes reported; not pushed.
- Roadmap R8 row Complete with evidence (Tailwind version + integration, the responsive patterns, the width checks, the ID-sweep re-proof).

## Constraints (ops)

- Web repo only; eve.js READ-ONLY. Operator runs EveJS (:26002); orchestrator runs the web app (:26500). Do NOT start/stop/restart either server; run only `npm test`, `tsc`, `npm run build:web`. Never push; never `git add -A` — stage only your files.
