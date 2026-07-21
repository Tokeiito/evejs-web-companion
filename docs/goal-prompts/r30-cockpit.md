# Goal R30: Stop making the player leave the cockpit

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** BLOCKED until R29 lands — slices A and B touch `web/src/app/flow.ts`, which R29 owns. **Web-only.**

The operator has raised this twice, most recently: *"I still don't like having to go between multiple tabs to warp, mine, etc."* Three designers worked from opposing priorities, three judges scored them, and a tie-breaker adjudicated. This is the result.

## The finding that changes the framing

**Leaving "Around Your Ship" stops the data feed.** `Overview.svelte:720-721` is the *only* call site of `startSpacePolling`/`stopSpacePolling`, which flips the `spacePanelOpen` flag that gates `shouldPoll` in `flow.ts:1903,1915-1916`. Leave the panel and the snapshot, lock list, gauges, distances and hostile list all freeze. The single exception is that a running autopilot writes into the same slice (`flow.ts:2523-2535`).

So switching to Travel to set a destination **actively stops the cockpit updating**. The complaint is not only ergonomic — the app punishes the switch it forces. Fixing the poll is worth doing even if no pixel moves.

**The app also instructs the player to switch, in its own copy, four times** — `Overview.svelte:744` ("Undock on the Flight tab"), `Overview.svelte:1112` ("Turn equipment on in the Fitting tab first"), `Mining.svelte:183-184`, `MiningBot.svelte:361`. **Deleting each of those strings is an acceptance test for the slice that makes it false.**

## The correction to my earlier framing

`Overview.svelte` is **already a partial cockpit** — 1,437 lines, nine sections, and it embeds `MiningBot` deliberately outside the in-space guard. This goal is not building a cockpit from nothing; it decides what joins the one that exists and what gets cut. Two structural gaps drive most of the friction: Overview **never shows location** (system, docked-vs-in-space, last failure live only in `Flight.svelte:156-175`), and its per-row commands are **grid-local only** — there is no Jump button on a stargate row at all, so the moment a destination is off-grid the player is pushed out.

## Approach: context-driven actions, edited in place

Bring the action to where the player already is, rather than dissolving Overview. This won on feasibility for a concrete reason: `overviewActions.test.ts` and `dronePanel.test.ts` (~1,000 lines of real guarantee) **import and render `Overview.svelte` as their unit under test**. Splitting it detonates both suites at the import line, in the same commit as a layout rewrite, before anything can be seen working. Push logic into pure modules (`space/gateLinks.ts`, `space/rowActions.ts`) exactly as `space/overview.ts` already established.

## Slices — each lands and is provable on its own

- **A — Gate jump.** Expose `nearbyGates(systemID)` on `AppFlow`, wrapping the already-cached `routeGraph` (`flow.ts:2493-2502`; `routeSolver.ts:37,54-55` expose `destinationGateID`/`systemName`/`neighbors`). Add one **Jump to {System}** button on the stargate row. No layout change, no test breakage. Deletes the only place a flying player must type raw gate IDs (`Flight.svelte:222-242`).
- **B — The poll.** Turn `spacePanelOpen: boolean` into a **ref count** (`spaceViewers: number`), keeping `startSpacePolling`/`stopSpacePolling` as claim/release; add `&& document.visibilityState === "visible"`; have Overview, Travel, Flight, Mining and MiningBot each claim on mount. **Do NOT** replace the gate with a global "in space" test — that polls while the player sits in Market and makes `startSpacePolling` a lying no-op. `spaceFlow.test.ts:323` pins the old semantics and must become a refcount assertion **in the same commit**. Land this LAST of A/B/C, rebased on R29.
- **C — Flight strip.** A three-line header in Overview: *where* (system · in space/docked at · active ship); *doing* (bot/autopilot narration passed through, never synthesized for manual play); *wrong* (first non-null of `flight.actionError`, `travel.failureReason`, `bot.failureReason`, `targeting.actionError`). One primary button: **Undock** when docked, **Stop** in space.
- **D — Selection bar**, deleting the per-row `.row-actions` block. The big one; see risk 1.
- **E — Contextual verbs:** Mine this, Haul now, module online/offline via `flow.setModuleOnline`.
- **F — Collapses/reorder** (drones, ranges) + a synthetic *"Somewhere else…"* destination row whose verb is **Set destination**, with results in component-local `$state` (matching the documented decision to keep search results out of the store).

**A + B + C is roughly half the complaint gone in three small commits.** Prefer that over a big drop.

## Non-negotiables

- **Stop is never disabled.** Use a per-concern busy set (`"move" | "lock" | "module" | "drone" | "hold" | "route"`) and render each error **at the control that caused it**. A single busy flag greys out Stop mid-fight. Write the exemption as a comment saying *do not clean this up*.
- **Never synthesize narration for manual play.** Pass through the bot/autopilot's own `{phase, action, why}`; do not invent one for hand-flying. Synthesized text makes inferred and authority-sourced values indistinguishable — precisely what `cycleProgressPercent` (`Overview.svelte:330-381`) already refuses to do.
- **Selection never silently retargets.** If the selected row leaves the snapshot, say *"That is no longer around your ship"* and clear it. Tested.
- **An unavailable action states its reason.** "Haul now" with no station on grid renders disabled **with the honest reason**, never greyed silently and never guessed.
- **Rejected, do not implement:** hiding the tab bar in space; a chat unread badge (`LiveState` cannot source it); derived activity modes; hysteresis timers; any `{#if}` swap driven by inferred state; "Mine this" as a single unreported fan-out.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets, no horizontal body scroll · **R9a** plain player language · **R18** `panelFirstMount` green.

## Risks and how to bound them

1. **The Overview test suites grep source text** — `class="row-actions"` (`overviewActions.test.ts:327`), an exact `/flow\.dockAt\(row\.itemID\)/` (`:503`), and occurrence *counts* (`:404`). Slice D changes all of these. **The fix is never to weaken an assertion:** re-point each at `space/rowActions.ts` and assert the genericity claim on returned data rather than on a regex over markup, in the same commit. If the answer looks like deleting an assertion, the slice is wrong.
2. **`position: fixed` has zero precedent in `styles.css`** (no `sticky`, no `fixed`, no `overflow-y`; `#app` capped at `72rem`). A bottom bar will occlude the last grid row, invisibly at desktop width. Ship the sticky-top desktop bar in D; do the fixed-bottom mobile bar as a follow-up with `body { padding-bottom }`, verified at 375px.
3. **`flow.ts` concurrency** — rebase on R29 before slice B.

## Required work

1. Baseline: web `npm test` (**1160/1160** at R28), `tsc` + `build:web` clean.
2. Implement A, B, C first; commit each separately. Then D–F if time allows.
3. **No new server surface.** Every verb maps to an existing `AppFlow` method (`warpTo:338`, `stopShip:355`, `lockTarget:374`, `activateModule:378`, `unloadMiningHolds:395`, `jump:448`, `dockAt:464`, `startRoute:483`, `setModuleOnline:212`, `undock:333`). `nearbyGates` exposes an already-cached closure over static reference data. If you think you need a server change, stop and report why.
4. Roadmap R30 row. Commit by pathspec; report hashes. **Do not push.**

## Verify LIVE — this goal cannot be proven by tests alone

1. **The poll keeps running:** fly, switch to Travel, set a destination, come back — distances/gauges/locks must have kept *moving*, not jumped. Then background the tab 30 s and confirm it stops and resumes cleanly.
2. **Jump to {System} against the real emulator** — the graph's `destinationGateID` must be the gate the server actually accepts. Static reference data can be stale in a way no fixture test catches.
3. **"Mine this" with 2+ miners** — each module must report individually, including a silent decline. A 200 is not proof.
4. **375 px:** the bar must not cover the last row, and the body must not scroll horizontally.
5. **"Haul now" disabled with no station on grid states why.**

## Constraints

- Servers: leave all three healthy; own any process you start. Never push. Never `git add -A`. Another agent has in-flight eve.js destiny work — never revert or clobber it.
- Screenshots have been unavailable to every worker — say plainly what you could not see.
