# Goal R38: Player structures have names — find them once, use them everywhere

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready — **research first, then build.** Client + bridge.

R37 shipped Personal Assets and it works, with one honest gap: a player-owned Astrahus renders as **"an unnamed place."** The R37 worker deliberately did not fix it, correctly — a one-off patch on the Assets panel would be the duplicated-mechanic trap. This is that fix, done once.

## What is established

- The structure's name **exists**: the live world holds *"Perimeter - asdf"* for structure `1030000000001` (an Astrahus, typeID 35832, holding Standup Market Hub I, an Astrahus Upwell Quantum Core and a Squall — 282,500 m³).
- **Our two name paths cannot see it.** `/api/names` (`kind:"station"`) returns `null` and `/api/map/resolve/:id` returns `kind:"unknown"`, because **both are static-SDE-backed** and a player structure is **runtime** data.
- **Confirmed by the orchestrator:** structure `1030000000001` appears in `_local/gameStore/gamestore.sqlite` and in **no** static JSON table. `structureProfiles/data.json` has **0 rows**. So this is a static-vs-runtime split, not a missing import.
- The gap is not Assets-specific. Structures are dockable and appear in space, so **Travel, the station/dock panel, the overview, contracts and the map have the same hole** — R30 already made Dock and Set-destination first-class, and a structure is a legal destination.

## What is NOT established — step 1 is yours

**I did not find the canonical runtime structure-name read, and I am not going to guess it.** My briefs have twice asserted a fact that turned out wrong (a refusal returning `false` when it returns `null`; an account having no username when it has one), and both cost a round trip. So:

**Research first, and report before building.** Determine:
1. Which eve.js service/handler returns a player structure's **name** (and ideally its typeID and solar system) for an arbitrary structureID. There are many `Handle_*Structure*` handlers across `officeManagerService`, `invBrokerService`, `marketProxyService`, `miningRuntime` and `sovPlayerDeployment` — find the one that is actually a *name/info* read, not an action.
2. Whether it is on `WEB_CALL_ALLOWLIST` today (**grep it — do not trust comments**).
3. Whether it answers for a structure the character does not own or is not docked at, and what it does when it cannot (empty? error? silently omits the row?).
4. What wire shape it returns. **R32 and R37 both found shape surprises** — `buildPackedRow` vs `buildKeyVal`, and within one service a CRowset with positional rows *and* a plain list with name-keyed rows. Use `readRowField` (`web/src/bridge/wire.ts:219`), which dispatches on shape.

**If no such read exists**, say so plainly and stop — that is a real finding and the goal becomes "report what would be needed," not "invent something."

## Then build: ONE resolution path

- **A single shared resolver**, not a per-panel patch. The existing `/api/names` batch route (`src/server.js:6240`, "resolves in ONE round-trip") is the natural home — extend it to answer for runtime structures rather than adding a parallel endpoint.
- **Every consumer benefits automatically**: Assets, Travel, dock/station displays, the overview, contracts, the map.
- **Unknown must stay honest.** When a name genuinely cannot be resolved, keep R37's behaviour — a plain-language fallback, never an ID (R7d), never a guess. Do not replace "an unnamed place" with a fabricated label.
- **Distinguish "no name" from "the lookup failed"**, per the `worldHasNoContracts` precedent (`src/server.js:3648`).

## Hard rules

- **Client + bridge only.** eve.js changes restricted to `server/src/_secondary/express/*` and `server/tests/*` — **never game mechanics**. Server defects: **report, do not fix.**
- **Minimum allowlist surface.** `charMgr` gained exactly three pairs in R37 with a refusal sweep proving the wider reads stay shut; hold that standard. Justify each pair in a comment. **Restart EveJS after adding pairs.**
- **A 200 is not proof** — ten confirmed patterns.
- **Trust the running authority over files on disk.** R37's worker read `accounts/data.json`, saw only `test`/`test2`, and concluded an account did not exist — the live gateway lists it as `rrfarmer`. The SQLite store is the truth here, and the gateway is the truth above that.

## Invariants

**R7d** zero visible numeric IDs — a structure is its name or an honest fallback, never `1030000000001` · **R8** responsive · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1400/1400**), `tsc` + `build:web` clean.
2. **Report research findings before building.**
3. Build the shared resolver + tests. **Fixtures from real captured bytes**, and **watch each new test fail before trusting it** — this repo has produced six tests that passed or failed while asserting nothing, including `webGatewayServiceCall`'s allowlist pinning test, which was red and unnoticed for six goals.
4. **Verify live**: Farmer (`rrfarmer`, any password — `src/server.js:128` documents that any existing username signs in with any password) has assets in **four** places including the Astrahus. Confirm it now shows a real name, and that at least one other panel benefits.
5. Roadmap R38 row + `docs/bridge-wire-contract.md` for any new pairs. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player-owned structure shows its real name wherever it appears, resolved through one shared path; unresolvable names still degrade honestly; and no numeric ID reaches the screen.

## Constraints

- Never `git add -A`. Never push. Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode` — never revert, stash, checkout-over or clobber it.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green; a time-derived `skillsPanel` countdown test flaked once under load and passes isolated — do not chase it.
- Servers up: :26002 EveJS (detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them. Leave characters where you found them and release sessions.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because it reports `visibilityState === "hidden"` with a 0×0 viewport. Expected. `get_page_text`/`read_page` work — R37 drove the real Svelte UI this way successfully. Say plainly what you could not see.
