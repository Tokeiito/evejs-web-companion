# Goal R45: Delete the legacy app; the SPA becomes `/`

**Issued:** 2026-07-21 by the orchestrator, at the operator's explicit direction: *"Delete the legacy. Make our app the new '/'"*. **Status:** Ready. **Client + bridge.**

## Why

`:26500` currently serves two apps:

- **`/`** → `public/index.html` — the legacy app. **Fully dead**: all six tabs (`overview`, `inventory`, `market`, `industry`, `skills`, `pi`) fetch `/api/characters/:id/:page`, a route family retired in R9b. Verified: every one returns **`200 text/html`** because `express.static` + the catch-all hand back `index.html`, so a JSON client cannot even distinguish breakage from a server error.
- **`/dist/`** → the Svelte SPA, 18 panels, everything built this session.

R41 closed the last gap (Planetary Interaction), so the SPA is now a strict superset. Anyone typing `:26500` gets a broken app.

## The part that will silently break

`vite.config.ts` sets **`base: "/dist/"`** (`:31`) with `outDir: "../public/dist"` (`:33`), so the built `index.html` references **absolute** asset URLs:

```html
<script src="/dist/assets/index-*.js">
<link href="/dist/assets/index-*.css">
```

**Moving where the HTML is served without changing `base` and rebuilding yields a blank page** — the document loads and the assets 404. Change the base, rebuild, and verify the emitted `index.html` references the new paths *before* declaring anything done.

## Required changes

1. **`vite.config.ts`** — `base` becomes `/`. **Do not point `outDir` at `public/` itself**: Vite's `emptyOutDir` would wipe sibling files. Keep the build output in its own directory and serve *that* at the root.
2. **`src/server.js:6864-6872`** — the static mount and catch-all now serve the SPA build directory. **The `/icon-cache` mount must stay ABOVE the catch-all** with `fallthrough: false` (R27 established this: it is what makes a missing icon return a real 404 so `<img onerror>` fires reliably rather than receiving `index.html` with a 200).
3. **Delete the legacy files**: `public/index.html`, `public/app.js`, `public/styles.css`, `public/commandClient.js`, `public/eventClient.js`, `public/mutationScope.js`. **The operator has explicitly authorised this deletion**, which overrides the standing data-preservation rule *for these files only*.
4. **`/dist/` should keep working** or redirect, so an existing bookmark does not break. Your call which; say which you chose.

## Check before deleting

- **Is anything else served out of `public/`?** Enumerate the directory first. Anything that is not the legacy app must keep being served.
- **Is any legacy file referenced anywhere?** Grep `src/`, `web/src/`, tests and docs for `app.js`, `commandClient.js`, `eventClient.js`, `mutationScope.js`, `styles.css` before removing them. `web/src/styles.css` is the SPA's own stylesheet and is **not** the legacy `public/styles.css` — do not confuse them.
- **Do any tests assert the old root?** A test expecting `/` to return the legacy shell must be updated to the new truth, not deleted.

## Hard rules

- **Preserve `_local` gameplay data, `data/`, icon caches and manifests.** The deletion authorisation covers the six legacy app files, nothing else.
- **A 200 is not proof** — ten confirmed patterns, and this whole goal exists because a 200 hid a dead app for thirty goals. Verify by fetching the root and checking the **content**, not the status.
- **Client + bridge only.** No eve.js changes.

## Invariants

**R7d** · **R8** · **R9a** · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1614/1614**), `tsc` + `build:web` clean.
2. Make the changes; rebuild; **inspect the emitted `index.html`** and confirm the asset paths match where they are served from.
3. **Restart :26500 and verify live**, and verify it properly:
   - `GET /` returns the **SPA**, not the legacy shell — check for the SPA's own markers, not just a 200.
   - The SPA's JS and CSS both return **200 with the right content type**.
   - An icon still returns `200 image/png`, and an **uncached** typeID still returns a real **404** — not `index.html`. This is the R27 ordering guarantee and it is the most likely casualty.
   - A deep link (e.g. `/dist/` if kept, or a client route) still resolves.
   - Log in and confirm a panel actually loads.
4. Roadmap R45 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

Typing `:26500` gives the real app. The legacy files are gone. Icons still 404 correctly when absent. The suite is green and the app is verified live, by content.

## Constraints

- Never `git add -A`. Never push. Another agent has in-flight destiny/parity work in eve.js on branch `ReconcileEliteMode` — never revert, stash, checkout-over or clobber it.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` countdown flakes pass in isolation — do not chase them.
- Servers: :26002 EveJS (PID 62824), :26500 web (PID 60856), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You will need to restart :26500** — own the process you start, set no `EVEJS_*` overrides, leave all three healthy.
- **The operator intends to review the app immediately after this lands.** Leaving `:26500` down or serving a blank page is the worst possible outcome. If anything is uncertain, verify again rather than declaring done.
- Preserve `icon-typeids*.txt` in the repo root (the orchestrator's). Leave characters docked; release sessions.
- **Browser pane:** screenshots time out and rAF never fires; static geometry IS measurable but async panel content never flushes. `get_page_text` works for confirming which app is served. Say plainly what you could not see.
