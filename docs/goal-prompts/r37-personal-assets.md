# Goal R37: Personal Assets — where your stuff is, and go there

**Issued:** 2026-07-21 by the orchestrator, at the operator's request: *"We need a 'Personal Assets' tab. So we can see where our stuff is, and to be able to set destination to those locations. This is in the real client, so should be easy to implement."* **Status:** Ready. **Client + bridge.**

The operator is right that it exists in the real client — and the emulator already implements it. This is a read-only view plus one already-built action.

## The surface — verified by the orchestrator

`charMgrService.js` delegates a complete global-assets API to `charMgrGlobalAssets.js`:

| Handler | `charMgrService.js` | What it gives |
|---|---|---|
| `Handle_MachoResolveObject` | :454 | resolve the global-assets object |
| `Handle_MachoBindObject` | :464 | **bind it** (our bound-object bridge already does this pattern) |
| `Handle_ListStations` | :491 | **every station where the character has assets** — the whole feature in one call |
| `Handle_ListStationItems` | :495 | what is at one station |
| `Handle_List` | :499 | items |
| `Handle_ListIncludingContainers` | :503 | items with nested containers |
| `Handle_GetAssetWorth` | :507 | total value |

**`charMgr` has ZERO allowlisted pairs today** — `grep 'service: "charMgr"'` on `evejsWebGatewayRuntime.js` returns nothing. So this needs new gateway pairs. That is expected and in scope (the operator authorises client + bridge), but **add only what the feature needs** — the allowlist is deny-by-default and every pair is a deliberate decision. Justify each one in a comment the way the existing entries do.

**Do not reimplement asset aggregation client-side** by walking containers. The server already answers "where is my stuff"; call it.

## Objective

1. **A Personal Assets tab**: the stations where you have items, each expandable to what is there. Show what is worth showing — item name, quantity, and volume where available. Use `TypeIcon` (R27); note the icon cache is sparse, so the named-tile fallback is the common case and must look deliberate.
2. **Set destination from an asset location.** This is the operator's second half and it is **already built** — the autopilot takes a destination and R30 slice A exposed the route graph. Wire it; do not build new navigation.
3. **Distinguish "no assets" from "the read failed."** This codebase has repeatedly conflated the two. `GET /api/bridge/contracts` already sets the precedent with `worldHasNoContracts`, true only when the browse **succeeded and was empty** (`src/server.js:3648`). Do the same here — an empty list and a failed read must not render identically.

## Traps this codebase has already produced — expect them

- **A 200 is not proof.** Ten confirmed patterns. This feature is read-only, so the risk is not silent writes but silently-empty reads.
- **Wire shapes differ per handler.** R32 found the contract detail row is a `buildPackedRow` while list rows are `buildKeyVal`, and the client decoded only KeyVal — so the panel silently got `null`, and the test that should have caught it built its fixture with the wrong shape. **Check what these handlers actually build** (`buildPackedRow` vs `buildKeyVal` vs rowset) before writing the decoder, and use the shared `readRowField` helper (`web/src/bridge/wire.ts:219`) which now dispatches on shape.
- **Bare-string bigints.** R32 also found FILETIMEs arrive as bare decimal strings, not `{type:"long"}`, because the gateway renders every BigInt as a plain string — so every contract date decoded to `null`. If any asset field is a large number or a timestamp, verify how it actually arrives.
- **`GetAgents` was observed returning 0 for a docked station** until the held-station sync was added (`src/server.js:4100`). If an asset read depends on session/location state, sync it first.

## Invariants

**R7d** zero visible numeric IDs — a station is its **name**, never `60000256`; resolve names through the existing `/api/names` path · **R8** responsive, ≥40px targets, no horizontal body scroll (an asset list is wide — this is the invariant most at risk) · **R9a** plain player language · **R18** `panelFirstMount` green with the new panel added.

## Required work

1. Baseline: web `npm test` (expect **1370/1370**), `tsc` + `build:web` clean.
2. Add the minimum gateway pairs, with justification comments. **Restart EveJS after adding them** — a server started before the commit will not have them, and that has already cost one live debugging session.
3. BFF route(s) + decoder + panel + the set-destination wiring.
4. Tests: decode against **real captured bytes**, not hand-built fixtures (this is how R32 and R35 found defects my own briefs had wrong). **Watch each new test fail before trusting it** — four tests in this repo were recently found green while asserting nothing, including three id sweeps written as ``new RegExp(`\b${id}\b`)`` where a template-literal `\b` is the BACKSPACE character.
5. **Verify live**: read a real character's assets and report the actual stations and items. Then set a destination from one and confirm the route starts. Report real numbers.
6. Roadmap R37 row + `docs/bridge-wire-contract.md` for the new pairs. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player opens Personal Assets, sees every station holding their items with what is there, and can set a destination to any of them. Empty and failed reads are distinguishable. Live-verified with real stations and a real route.

## Constraints

- **Client + bridge only.** eve.js changes restricted to `server/src/_secondary/express/*` and `server/tests/*` — **never game mechanics**. If you find a server defect, **report it, do not fix it** (the operator has been explicit). Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode`; never revert, stash, checkout-over or clobber it.
- Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green. A time-derived `skillsPanel` countdown test has been seen flaking once under load; it passes isolated — do not chase it.
- Servers up: :26002 EveJS (detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them. Leave the character docked and sane; release the session.
- **Test Two is docked at Elonaya 60000256 in a Badger**; Farmer has a Rupture at Perimeter VI and a Procurer in a Jita hangar — so there are genuinely multiple asset locations to see.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because it reports `visibilityState === "hidden"` with a 0×0 viewport. Expected, not a broken app. `get_page_text`/`read_page` work for DOM reads. Say plainly what you could not see — especially the R8 width behaviour, which cannot be checked here.
