# Goal R18: Fix the Fitting tab (it does nothing when clicked)

**Issued:** 2026-07-20 by the orchestrator, from live diagnosis. **Status:** Ready to run. **Web-only.** Small and blocking — the fitting window rebuild (R21) depends on this panel working.

## Reproduction and evidence (gathered live by the orchestrator — do not re-derive)

Clicking the **Fitting** tab does nothing at all. The page stays on whatever panel was showing.

**What I proved live against the running app (Farmer docked at Jita 4-4, activeShipID `9988400029047`):**
1. **Only Fitting is broken.** Every other tab switches correctly — verified programmatically: `Station ✅, Market ✅, Mail ✅, Contracts ✅, Around Your Ship ✅, Inventory & Ship ✅`, and Industry renders real blueprint data. Fitting fails from **multiple origins** (Station→Fitting and Inventory→Fitting both fail).
2. **`page` never changes.** The Fitting tab never gains `class="active"`; the previously-active tab stays active. So the state assignment is being rolled back or never commits.
3. **Nothing throws.** With persistent `window.onerror`, `unhandledrejection`, and patched `console.error`/`console.warn` installed *before* the click and a 1.2s wait after: **zero captured output.** Not an uncaught exception surfacing normally.
4. **The DOM is fine.** The button is enabled, visible, hit-testable (`elementFromPoint` returns the button itself), same parent `NAV.tabs`, same attributes and delegation as the working tabs. A real click and a programmatic `.click()` both do nothing.
5. **The BFF is fine.** `GET /api/bridge/fitting` → `ok:true`, `errors: {slots:null, shipInfo:null, online:null}` (no failed reads), returning `slots: {type:"list", items:[…]}`, `shipInfo: {type:"dict"/"objectex", entries:…}`, `online: {type:"list", items:[…]}` — i.e. **raw retail shapes**.
6. Statically everything resolves: all four `../bridge/fitting.ts` imports exist (`SLOT_FAMILY_LABELS`, `SLOT_FAMILY_ORDER`, `isFittableRow`, `slotsOfFamily`), and `store.fitting` / `store.inventory` / `store.names` all exist.

**Leading hypothesis:** `<Fitting>`'s creation throws and Svelte 5 rolls the state update back silently. The prime suspect is the `$effect` at `web/src/ui/Fitting.svelte:53`, which does `for (const slot of $fitting.slots)` — if the store's `fitting.slots` is not an iterable array at creation time (e.g. still a raw `{type:"list", items:[…]}` envelope, or `undefined` before the first load), that is a `TypeError: … is not iterable` thrown during component creation. Check the store's initial/default `fitting` slice shape and what `flow.loadFitting` writes into it versus what the component assumes.

**Verify the hypothesis before fixing** — do not just defensively patch. Reproduce the throw (e.g. mount the component against the store's initial state in a test, or temporarily build unminified and read the real stack), then fix the actual cause.

## Objective

1. Find and fix the real root cause so the Fitting tab opens and renders the ship's slots, modules, and resources.
2. **Add a regression test that fails without the fix** — ideally one that exercises the component (or the exact decode/effect path) against the store's *initial* state and the *raw BFF shapes* above, so this class of "renders fine once loaded, explodes on first mount" bug is caught.
3. Audit the sibling panels for the same pattern (an `$effect`/render iterating a slice that may not be an array before its first load) and fix any others you find — Industry/Market/Mail/Contracts were added the same way.
4. **Verify live**: with the operator's EveJS running, load the app, click Fitting, and confirm the panel renders. Report what it shows for Farmer's active ship.

## Invariants

R7d zero visible numeric IDs, R8 responsive reflow, R9a plain player language — all must still hold. Re-run the sweeps.

## Required work

1. Baseline: web `npm test` (expect 761/761). eve.js untouched — this is a web-only fix.
2. Root-cause, fix, regression test, sibling audit, live verification.
3. Update the roadmap (R18 row). Commit; report hash. **Do not push.**

## Definition of done

- Clicking Fitting opens the panel and renders real data for the active ship; a test that fails without the fix now passes; any sibling panels with the same latent bug are fixed; all suites green; `build:web` clean. Committed; hash reported; not pushed.

## Constraints

- Web repo only; eve.js READ-ONLY.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500). You may **read** the live app to verify, but do NOT start/stop/restart either server — ask the orchestrator to rebuild/restart if you need the bundle refreshed, or verify against a build you run separately on another port. Never push.
- A parallel worker (R20) is running a dogma-oracle investigation in a separate area — it touches no `web/src/ui` files. Stage only your files; never `git add -A`.
