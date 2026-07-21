# Goal R41: Planetary Interaction — the last thing the old app has that we don't

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready — **research first, then build.** Client + bridge.

## The finding that prompted it

`:26500` serves **two** apps:

- **`/`** → `public/index.html`, the **legacy** app (`app.js`, `public/styles.css`) — **6 tabs**: overview, inventory, market, industry, skills, **pi**.
- **`/dist/`** → the **Svelte SPA**, `public/dist/index.html` — **18 panels**: station, inventory, fitting, industry, market, mail, contracts, assets, agents, finder, flight, overview, mining, skills, travel, chat, and the two bots.

`src/server.js:6869-6872` mounts `express.static(public)` and a catch-all that returns `public/index.html`, so **the root is the legacy app** and everything built this session lives under `/dist/`.

The SPA is a near-superset of the legacy app with exactly **one** exception: **Planetary Interaction.** `grep` finds no PI panel in `web/src/ui/`, and **zero** `/api/bridge/pi*` routes in the BFF.

So PI is the last gap. Closing it makes the legacy app fully redundant, which is a decision for the operator — **this goal does NOT change what `/` serves.** Do not touch the static mount or the catch-all.

## What is already known

- **A write path exists at the gateway**: `normalizePiRestartCommandPayload` (`evejsWebGatewayRuntime.js:1910`), `mapPiRestartPublicError` (`:1951`), wired as a character command at `:2458-2459`, with its own public error allowlist `PUBLIC_PI_RESTART_ERROR_CODES` (`:994`) — `CannotManagePlanetWithoutCommandCenter`, `PinDoesNotExist`, `PinDoesNotHaveHeads`, `CannotPlaceHeadTooFarAway`.
- **No planet READ pairs are allowlisted.** `grep 'service: "planet…"'` on the allowlist returns nothing.

**This is the same shape R28 found for skills**: the write existed, the reads did not, and the whole feature was one small allowlist addition away. R28 shipped with exactly one new pair.

## Research first — report before building

I have **not** located the read surface and am not guessing it. My briefs have been wrong three times this session by asserting surface I had not personally found, and each cost a round trip. Determine:

1. Which eve.js service serves planets/colonies — the handler that returns a character's planets, and the one that returns a colony's pins/links/routes. (`planetMgr`? `planetor`? something else — enumerate, do not assume.)
2. **Allowlist status — grep it yourself**, do not trust comments.
3. What the **legacy app** already calls. `public/app.js` has a working PI tab; it is a live, working reference for which calls actually answer. **Read it before designing.** That is the cheapest possible research and nobody has used it.
4. Wire shapes. R32 found a `packedrow` where the client expected `KeyVal`; R37 found **two different shapes from one service** (a positional CRowset and a name-keyed list). Use `readRowField` (`web/src/bridge/wire.ts:219`), which dispatches on shape.
5. Whether the restart-extractors command is reachable and worth wiring, or read-only is the right first slice.

**If the read surface does not exist, say so plainly and stop.** That is a real finding.

## Then build

A **Planets** panel: the character's colonies, and for a selected colony what is there and what it is doing. Scope it to what the reads actually support — **read-only is an acceptable and good first slice**; the operator values incremental proven progress over big drops.

- Use **`TypeIcon`** (R27). The icon cache is now **7,535 files / 2,047 distinct images** after the operator's scrape, so real art is the common case; the named-tile fallback must still work (`data/` is gitignored).
- **Distinguish "no colonies" from "the read failed"** — the `worldHasNoContracts` precedent (`src/server.js:3648`).
- If you wire the restart command, its four refusal codes are already player-safe; render them through R31's seam (`web/src/bridge/refusals.ts`) and **do not paraphrase** — R34 established that server prose passes through unchanged.

## Hard rules

- **Client + bridge only.** eve.js changes restricted to `server/src/_secondary/express/*` and `server/tests/*` — never game mechanics. Server defects: **report, do not fix.**
- **Minimum allowlist surface, justified per pair.** Precedent: R37 added three `charMgr` pairs with a refusal sweep proving wider reads stay shut; R38 added exactly one and **declined** the convenient batch read because it leaked owner-only data. **Restart EveJS after adding pairs.**
- **A 200 is not proof** — ten confirmed patterns.
- **Do not change what `/` serves.** Retiring the legacy app is the operator's call, not this goal's.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green with the new panel added.

## Required work

1. Baseline: web `npm test` (expect **1467/1467**), `tsc` + `build:web` clean.
2. **Report research findings before building.**
3. Build + tests. **Fixtures from real captured bytes**; **watch each new test fail first**. Seven tests in this repo have been caught passing or failing while asserting nothing — including three sweeps written as ``new RegExp(`\b${id}\b`)`` (a template-literal `\b` is the BACKSPACE character) and, in R40, a `flagID` sweep against a field the BFF strips. When you write an id sweep, add a companion test proving the regex matches a string that *does* contain the id.
4. **Verify live.** Log in as `rrfarmer` (any password — `src/server.js:128`) or `test2`. Report the actual colonies found, or state plainly that the character has none.
5. Roadmap R41 row + `docs/bridge-wire-contract.md` for new pairs. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The SPA shows a player's planets with real data, or the goal reports with evidence that the read surface does not exist. Either way the legacy app's last exclusive feature is understood.

## Constraints

- Never `git add -A`. Never push. Another agent has in-flight destiny/parity work in eve.js on branch `ReconcileEliteMode` — never revert, stash, checkout-over or clobber it.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green; a time-derived `skillsPanel` countdown test flakes rarely under load and passes isolated — do not chase it.
- Servers up: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **Only ONE worker should drive live sessions at a time.** Two concurrent live workers caused real session takeovers during R39/R40 ("another client took over"). If you need a live session and something else is running, say so rather than fighting for it.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them. Leave characters docked and sane; release sessions.
- **Browser pane:** the SPA is at **`/dist/`**, not `/`. Screenshots time out and `requestAnimationFrame` never fires (`visibilityState === "hidden"`). Static/first-paint geometry IS measurable via `javascript_tool` + `getBoundingClientRect` + `resize_window` — but **async-loaded panel content never flushes to the DOM** (measured: the inventory fetch returned 200 three times while the panel stayed at "Loading…"). For panel behaviour, render through Svelte's server generator or drive `AppFlow` directly. Say plainly what you could not see.
