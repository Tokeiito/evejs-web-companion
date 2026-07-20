# Goal R24: The in-space cockpit — smart Dock, live hold, cycle times, and a warp-loop bugfix

**Issued:** 2026-07-20 by the orchestrator, from operator requirements. **Status:** Queued behind R23 (needs its targeting/activation layer). eve.js changes are **gateway/interface only**.

Operator's ask: a Dock command that closes the distance itself; a more compact in-space screen with a **live** ship inventory; module **cycle times**; and proof that mining works end to end — target, mine, depletion, activate/stop, cargo full, and specialty ore holds. Combat is explicitly out of scope.

## Slice A — fix the warp dead band (do this FIRST; it is a live bug)

R13's ladder warps at `surfaceDist >= 150,000`, but the server **silently refuses** warps that are too short and R13 has no bound on the warp branch, so the loop can spin forever.

- `CmdWarpToStuffAutopilot` returns **200/null without warping**: `warpCommands.js:250-255` yields `WARP_DISTANCE_TOO_CLOSE`, and `beyonceService.js:1693 _throwWarpFailureUserError` handles only criminal/bubble/scramble/immobile — everything else hits `default: break` (`:1713`) and throws nothing.
- Server refuses when `centreDist - stopDistance < MIN_WARP_DISTANCE_METERS (150000)` (`warpState.js:236`), with `stopDistance = targetRadius + minimumRange + 2*shipRadius` (`warpState.js:632-633`); the BFF's null-`minRange` path sends `minimumRange: 10000` (`beyonceService.js:2984`).
- Browser surface distance = `centreDist - shipRadius - targetRadius`, so **warp is refused whenever `surfaceDist < 160000 + shipRadius`** — a ~10 km dead band above our 150 km threshold.

**Fix all three of these:**
1. Make the loop's warp decision agree with the server's actual gate (account for `minimumRange` and ship radius, or send `minRange: 0` on the autopilot warp so the profile matches retail's `WarpToItem(warpRange=0)`).
2. **Bound the warp branch** — an attempt counter like the jump branch has, so no decision can ever repeat unboundedly. A loop that cannot make progress must pause with a reason, never spin.
3. Add a regression test that puts a target inside the dead band and asserts the loop does **not** issue warp repeatedly.

## Slice B — the smart Dock command

Retail sequences this client-side; there is exactly one server call.

- `menusvc.py:2981 Dock` → `DockStation` → `GetCloseAndTryCommand(itemID, RealDock, interactionRange=2500)` → `autopilot.py:503 __NavigateSystemTo`, re-armed every 2000 ms, evaluating: **in warp → do nothing**; **within 2500 m surface → fire Dock and stop**; **> 150 km → warp**; **< 150 km → approach**; else give up with a reason.
- ⚠ **The dock gate is 2,500 m SURFACE distance, not 50,000.** `runtime.js:7563 canShipDockAtStation` uses `DEFAULT_STATION_DOCKING_RADIUS = 2500` against `distance - shipRadius - stationInteractionRadius`. 50,000 (`maxDockingDistance`) is only the outer autopilot's hand-off trigger.
- Server `Handle_CmdDock` (`beyonceService.js:2994`) when out of range **starts the approach AND refuses** with `DockingApproach` (`:3013-3025`). Nothing auto-docks on arrival — the client must re-issue.
- ⚠ **`CmdDock` can return 200/null without docking** (`beyonceService.js:3031-3042`): `WARP_LANDING_PENDING`, `STATION_NOT_FOUND`, `SHIP_IMMOBILE`, `DOCKING_APPROACH_REQUIRED` all reach the browser as `ok:true`. **Never treat a 200 as docked — confirm from flight status.**

Build a **Dock** action (on the Overview row for a station, and as a panel action) that runs this ladder to completion, reports which phase it is in, and stops with the server's own reason if it cannot proceed. Reuse the R13 measurement plumbing; do not fork a second autopilot.

## Slice C — module cycle times

- **Base duration is free today.** Attribute **73** (`duration`, ms) is populated: Miner I/II = **15000**, Modulated Strip Miner II = **45000**; effect **67 `miningLaser`** points at `durationAttributeID: 73`. And `src/staticData.js:389-406` **already exports `getTypeDogma` / `getTypeDogmaAttribute` and nothing calls them** — `getTypeDogmaAttribute(482, 73)` returns 15000 right now, zero server calls.
- **Effective** duration (skills/bonuses) is computed server-side but there is still no allowlisted call returning per-module effective attributes (the same wall blocking DPS). So: show base duration, and if you find an existing retail call that exposes effective per-module attributes, report it — do not invent one.
- Show a **cycle progress indicator** for an active module. Seed it from the duration you actually have and **label it honestly** if it is base rather than skill-adjusted. If the server emits cycle start/end events, prefer those over a local timer; if it does not, say so.

## Slice D — the in-space screen: compact overview + LIVE inventory

- **Compact the Overview.** Denser rows, less chrome, the essentials first (name, type/ore, distance, and remaining for asteroids). It is the primary in-space instrument — it should read at a glance while things are happening.
- **Live ship inventory.** Mining emits a real notification: `miningRuntime.js:982-1000` grants ore then calls `syncMinedOreChangesToSession` (`:994-999`), producing **`OnItemsChanged`** — a *captured* surface, so the **R10 push channel (gateway WS → BFF SSE) should already carry it**. Verify that end to end and drive the hold display from it. Only fall back to polling if the notification genuinely does not arrive, and say which you used.
- Show the **specialty holds** properly: flags **134 Mining (attr 1556)**, **135 Gas (1557)**, **181 Ice (3136)**, **182 Asteroid (3227)**, plus **cargo 5 (attr 38)**. A ship *has* a hold iff the attribute is populated — Venture/Retriever/Skiff/Hulk differ from a Mammoth by **data, not special-casing**. Show used/total per hold that exists; do not render holds a ship lacks. Numeric IDs live in `services/inventory/specialShipHoldRegistry.js`.

## Slice E — prove the mining loop (the acceptance criteria)

Demonstrate, with tests and a live run if the operator's servers allow: **lock an asteroid → activate the laser → ore accrues in the correct hold → the rock's remaining quantity drops → depletion clears the lock and removes the rock → a full hold stops the cycle** (`stopReason: "cargo"`) → deactivate works. Report what is observable to the client for each step, and mark anything that is *not* observable rather than faking it.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive · **R9a** plain language · **R18** panelFirstMount green · **a 200 is not proof** — this goal has three separate confirmed instances of the server returning success without acting, so re-read and confirm state after every action.

## Constraints

- eve.js **gateway/interface only** (`_secondary/express/*` + tests); never modify mining/dogma/space mechanics. Branch `ReconcileEliteMode`; pathspec commit; never `git add -A`.
- **R23 was editing `evejsWebGatewayRuntime.js` concurrently — re-verify the allowlist state before adding anything**, and build on whatever targeting/activation layer R23 actually landed rather than duplicating it.
- OPERATOR runs EveJS (:26002) + market daemon (:40111); ORCHESTRATOR runs the web app (:26500) — do not start/stop/restart any of them. Never push. Screenshots have been unavailable to every worker — verify by measurement and say plainly what you could not see.
