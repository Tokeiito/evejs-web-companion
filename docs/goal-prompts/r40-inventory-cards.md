# Goal R40: Inventory — ships apart from things, and a hangar you can look at

**Issued:** 2026-07-21 by the orchestrator, at the operator's direct request. **Status:** Ready. **Client-first; bridge only if a bay cannot be read today.**

The operator's words:

> *"Ships and items (not the items in a ship) needs to be separate cards. SO we will have two: Ships (then click on ship to show cargos, some ships have multiple cargo bays) and then hanger inventory."*
> *"Make the regular hanger inventory a grid of icons with their name and amount underneath."*

## Where it stands today

`web/src/ui/InventoryShip.svelte` is **778 lines** and renders the station hangar as **one reflow table** (`:432-472`) mixing ships and everything else. A ship row already offers "board" (`isBoardableShip`) and a container row already offers "open" (`isOpenableContainer`, `web/src/bridge/inventoryShip.ts:164`) — so the *concepts* exist; they are just flattened into one list.

## What to build

### Card 1 — Ships

Only ships. Selecting one reveals **its bays**, and a ship can have several.

**Bays are inventory flags**, the same mechanism Fitting already uses for slots. `invbroker.ListByFlags` is **already allowlisted** (`evejsWebGatewayRuntime.js:176`), `/api/bridge/inventory/container/:itemID` (`src/server.js:1062`) already binds and lists an arbitrary itemID, and `/api/bridge/ship/ore-hold` (`:5144`) already reads the ore hold specifically. A drone-bay flag is already known to the BFF (`src/server.js:5586`).

**Determine the real bay set rather than assuming it.** Establish which flags a given hull actually exposes (cargo hold, ore hold, drone bay, fleet hangar, ammo/charge bays, ship maintenance bay…) and how to tell which exist for a hull versus which are simply empty. **An absent bay and an empty bay must not render identically** — that distinction has bitten this codebase repeatedly (`worldHasNoContracts` exists for exactly this reason, `src/server.js:3648`).

Show each bay with its **used / capacity**, so the player can see at a glance where there is room. The Procurer (2× Strip Miner I, 16,000 m³ ore hold) and the Badger (4,095 m³) are good test hulls; Farmer has the Procurer and a Rupture, Test Two has the Badger.

### Card 2 — Hangar inventory, as a grid

Everything that is not a ship, as a **grid of icons with the name and amount underneath** — not a table.

- Use **`TypeIcon`** (R27). **The icon cache was just expanded from 536 to 7,535 files and from 25 to 2,047 distinct images** — Ship, Drone and Module coverage is now 100%, Charge 99.9%, Asteroid 99.1%, Material 96.9%. So real art is the common case now, but **keep the named-tile fallback working** — it is still what a missing icon must produce, and `data/` is gitignored so a fresh clone has none of it.
- **Amount is part of the tile**, under the name, per the operator.
- **R8 is the invariant most at risk.** A grid must reflow, never scroll the page body sideways, and keep ≥40px touch targets. State plainly that you could not see it at any width — the browser pane cannot composite.
- **Do not lose existing capability.** Selection, bulk actions, merge/stack, trash-arming and the corp/division hangar all already work in this panel. A grid that drops them is a regression. If some action does not fit the grid idiom, say so and keep it reachable.

## Hard rules

- **A 200 is not proof** — ten confirmed patterns. Any read that can silently return empty must distinguish empty from failed.
- **Prefer client-only.** If every bay is readable through existing routes, add **no** bridge surface. If a bay genuinely cannot be read, add the minimum, justify each pair in a comment, and **restart EveJS after adding pairs**. R37 added exactly three `charMgr` pairs and proved the wider reads stay shut with a refusal sweep; R38 added exactly one and declined `GetStructures` because it leaked owner-only data. Hold that standard.
- **Client + bridge only.** eve.js changes restricted to `server/src/_secondary/express/*` and `server/tests/*` — never game mechanics. Server defects: **report, do not fix.**

## Invariants

**R7d** zero visible numeric IDs — an icon `src` may contain a typeID (asset paths are exempt), rendered *text* may not · **R8** responsive, ≥40px targets, no horizontal body scroll · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (**1416/1416** as of R39's decline fix; take the real number — a concurrent worker may have raised it), `tsc` + `build:web` clean.
2. Build both cards. Keep the panel's existing actions working.
3. Tests: bay enumeration including a hull with only a cargo hold *and* one with an ore hold; absent-vs-empty bay; the grid rendering name + amount; the fallback tile with the cache absent; and an R7d sweep over the new markup. **Build fixtures from real captured bytes** and **watch each new test fail first** — this repo has produced six tests that passed or failed while asserting nothing, including three id sweeps written as ``new RegExp(`\b${id}\b`)`` where a template-literal `\b` is the BACKSPACE character.
4. **Verify live**: read a real hangar and a real multi-bay ship, and report the actual bays, capacities and contents.
5. Roadmap R40 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The Inventory tab shows ships and things as two cards; a ship opens to reveal its bays with used/capacity; the hangar is a grid of icons captioned with name and amount; every action that worked before still works; and absent bays are distinguishable from empty ones.

## Constraints

- **A concurrent worker is finishing R39** (a small change to `web/src/nav/miningBotLoop.ts` + its tests, plus a roadmap row). Do not touch that file. **Expect the roadmap doc to be edited by both of you — re-read it immediately before writing your row** and never `git add -A`; pathspec only.
- Another agent has in-flight destiny/parity work in eve.js on branch `ReconcileEliteMode` — never revert, stash, checkout-over or clobber it. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green; a time-derived `skillsPanel` countdown test flaked once under load and passes isolated — do not chase it.
- Servers up: :26002 EveJS (detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them.
- **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002). Any password works (`src/server.js:128`). Farmer is docked at Perimeter VI - Ytiri Storage with ore still aboard; Test Two at Muvolailen X - Moon 3. Leave characters docked and sane; release sessions.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires (`visibilityState === "hidden"`, 0×0 viewport). R37 drove the real Svelte UI via `get_page_text`/`read_page`; R38 could not get past *"Loading…"* because fetch effects never ran. Driving `AppFlow` directly is the reliable path. **Say plainly that layout and appearance were not seen** — for a grid, that is the central caveat.
