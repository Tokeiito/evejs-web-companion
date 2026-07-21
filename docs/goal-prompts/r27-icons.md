# Goal R27: Use the icons we already scraped

**Issued:** 2026-07-20 by the orchestrator (operator AFK; they explicitly suggested revisiting the icon-scraping work). **Status:** Ready to run. **Web-only.**

The app is all text. We already have EVE's item icons on disk, already served, with helper functions already written — and **nothing calls them.** This is the cheapest visual upgrade available.

## Verified research — what exists

- **On disk:** `data/icon-cache/` — `manifest.json` (536 entries) and `types/64/icon/<typeID>.png` (**536 files, 4.3 MB**). One size (64), one variation (`icon`). No 32/128/256, no `bp`/`bpc`/`render`.
- ⚠ **`data/` is gitignored**, so the cache is local-only and NOT reproducible from a clone. Anything you build must degrade gracefully on a machine without it — including CI.
- **Helpers already written in `src/staticData.js`:** `normalizeIconRequest` (:314, size clamped to {32,64,128,256,512,1024}, variation sanitised), `getTypeIconCachePath` (:327), `getLocalTypeIconUrl` (:340, `fs.existsSync` gate → `/icon-cache/types/<size>/<variation>/<id>.png` or `null`), `getRemoteTypeIconUrl` (:349), `getTypeIconUrl` (:356). All exported at `:1011-1023` — and **`getTypeIconUrl` / `getLocalTypeIconUrl` have ZERO call sites anywhere in `src/`.** No BFF endpoint emits an icon URL today.
- **Serving is already correct:** `src/server.js:5619` mounts `express.static(iconCacheDir)` at `/icon-cache` with `fallthrough: false`, **above** the SPA catch-all — so a missing icon returns a real 404 rather than `index.html` with a 200, which means `<img onerror>` fires reliably. `vite.config.ts:40` proxies `/icon-cache` in dev. Do not disturb this ordering.

## Objective

1. **One shared icon component** (e.g. `web/src/ui/TypeIcon.svelte`) used everywhere, taking a `typeID` and an accessible label, rendering `/icon-cache/types/64/icon/<typeID>.png`.
2. **A graceful fallback that is never ugly and never a broken image**: on `onerror` (or a null typeID), fall back to a clean text/initial tile derived from the item's already-resolved **name**. Coverage is only 536 types — the fallback is the common case, not the edge case, so design for it first.
3. **Apply it** where it earns its place: **Overview** rows (what's around you), **Inventory & Ship** and the **ore hold**, **Market** order rows, **Industry** blueprints, and the **Fitting** window (which already uses icons — reuse the shared component rather than leaving two implementations).
4. **Stay local-only.** Do NOT hotlink `images.evetech.net` from the browser. `getRemoteTypeIconUrl` exists, but an external request per row is not something to switch on silently — if you wire it at all, it must be **off by default** and clearly documented as opt-in.

## Invariants

- **R7d — zero visible numeric IDs.** An icon's `src` path legitimately contains a typeID (R21 already established asset paths are exempt); the rendered *text* must stay name-only. The `alt` text must be the item's **name**, never its ID.
- **R8** responsive — icons must not break the card reflow or push tables sideways; give them a fixed box so rows don't jitter as images load.
- **R9a** plain player language. **R18** `panelFirstMount` green.
- **Accessibility:** decorative-but-labelled — every icon carries a meaningful `alt`, and no information is conveyed by the icon alone (the name stays visible next to it).
- **CI/clone safety:** with `data/icon-cache` absent, every panel must still render correctly (fallback tiles) and every test must still pass. Prove this — e.g. a test that renders with an unresolvable icon path.

## Required work

1. Baseline: web `npm test` (expect 1102/1102), `tsc` + `build:web` clean.
2. Build the component + fallback, apply across the listed panels, unify the Fitting window onto it.
3. Tests: the fallback path renders a name-derived tile; `alt` is the name; a null/unknown typeID never emits a broken `src`; the invariant sweeps still pass.
4. **Report coverage honestly** — how many of the typeIDs actually on screen in a typical view have a cached icon. If it is low, say so; that tells the operator whether re-running the scraper is worth it. **Do NOT run the scraper** (it fetches from an external service) — just report what widening coverage would involve.
5. Update the roadmap (R27 row) + `docs/design-system.md` with the icon pattern. Commit; report hash. **Do not push.**

## Definition of done

- One icon component used across Overview, Inventory/ore hold, Market, Industry and Fitting; cached icons appear; everything degrades to a clean named tile when an icon is missing or the cache is absent entirely; no external requests; all invariants re-proven; suites green. Committed; hash reported; not pushed.

## Constraints

- Web-only; eve.js untouched. Servers: the orchestrator has permission to control both — you may restart the web app to see your work, but **leave both servers running and healthy**. Never push.
- Screenshots have been unavailable to every worker — verify by measurement and say plainly what you could not see.
