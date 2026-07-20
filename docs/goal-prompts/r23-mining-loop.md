# Goal R23: The mining loop — and the targeting/activation keystone

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

Today the ship can **move but not act**. We built warp, orbit, approach, align, stop and a HUD — but there is no way to lock a target or turn a module on, so space is inert. This goal fixes that and delivers the first complete economic loop: **mine → haul → refine → sell**.

**Build the targeting + activation layer as a reusable primitive.** Combat (R24) is the same two calls with a different module — do not make it mining-specific.

## Verified research (do not re-derive)

A read-only survey confirmed **mining is fully implemented server-side**, with real world data. Highlights with file:line:

- **Asteroids exist and spawn.** `_local/gameStore/data/asteroidBelts/data.json` holds **40,928** real SDE belts (seeded with `fieldSeed`/`asteroidCount`/`fieldRadiusMeters`). Belt **beacons** spawn as ordinary statics (`space/runtime.js:20780`, `buildStaticAsteroidBeltEntity` at `:9452`) so they are visible system-wide and **warpable**. Individual rocks spawn on scene creation (`runtime.js:38330` → `asteroidService.js:1175 handleSceneCreated` → `populateBeltField :1088` → `buildSystemOreAsteroidEntity :1017`), stamped `kind:"asteroid"`, `miningYieldTypeID`, `slimTypeID` = ore typeID, `beltID`, `staticVisibilityScope:"bubble"`. Gated by `config.asteroidFieldsEnabled`, default **true**.
- **The cycle is real.** `dogmaService.js:7940 Handle_Activate` → `runtime.js:25544 activateGenericModule` → `miningRuntime.js:669 resolveMiningActivation`, which enforces target-required, **target-locked** (`:684`), family/crystal compatibility and **surface range** (`:715-720`). Per-cycle work at `runtime.js:36552` → `miningRuntime.js:846 executeMiningCycle`.
- **Ore really enters cargo.** `miningRuntime.js:982` grants into the ore/gas/ice hold ladder (flags **134/135/181/182**, `miningConstants.js:1-6`), falling back to cargo (flag **5**). A full hold ends the cycle with `stopReason:"cargo"` (`:919-921`, `:930-932`). Yield math is real (waste multiplier/probability, crit chance, efficiency, crystal specialisation `:948-972`); crystals take volatility damage and are destroyed at damage ≥ 1 (`:746-844`).
- **Depletion is real.** `applyMiningDelta` (`miningRuntimeState.js:1397`) decrements `remainingQuantity`; at zero `updateMineableState` (`:943-980`) **clears every locked target, idles mining drones and removes the rock from the scene**. Persisted to `miningRuntimeState`.
- **Reprocessing is real** and is NOT the dead-stub pattern: `reprocessingService.js:549` delegates to the 1277-line `reprocessingRuntime.js`; `reprocessItems` (`:983`) checks the wallet, **debits ISK tax** (`:1083-1105`), consumes inputs and grants mineral outputs. **NPC stations do not gate on a reprocessing plant** (only Upwell structures do, `:312-325`) — so any docked NPC station works.
- **The R11 snapshot already carries asteroids.** `projectSpaceEntity` (`evejsWebGatewayRuntime.js:1234`) passes `kind:"asteroid"`, `typeID` = ore typeID, `name` = ore name ("Veldspar"), `radius`, `position` — **the overview can show rocks with zero gateway change**. It does NOT carry `remainingQuantity`, `beltID` or `miningYieldTypeID`.

### Call tuples

**Needs allowlisting (9–12 pairs):**
| Tuple | Notes |
|---|---|
| `dogmaIM.AddTarget(targetID)` → `[pendingFlag, targetIDList]` | lock |
| `dogmaIM.RemoveTarget(targetID)` · `dogmaIM.GetTargets()` · `dogmaIM.CancelAddTarget(targetID)` | unlock / list / cancel pending |
| `dogmaIM.Activate(moduleItemID, "miningLaser", targetID, repeat)` | `repeat = -1` continuous, `0` = one cycle. Unknown effect names are lowercased (`dogmaService.js:7479`); `MINING_EFFECT_NAMES` = `{mininglaser, miningclouds}` (`miningDogma.js:47`). An empty effect name falls back to `resolveDefaultActivationEffect(typeID)` (`runtime.js:25596`) |
| `dogmaIM.Deactivate(moduleItemID, "miningLaser")` | |
| `miningScanMgr.perform_scan()` → `[[entityID, yieldTypeID, remainingQuantity], …]` | the survey scanner — this is how the player sees how much ore is left |
| `reprocessingSvc` bound via `Moniker('reprocessingSvc', stationID)`, then `GetQuotes(itemRefs)` → `[tax, effByType, quotesByItemID]` and `Reprocess(itemIDs, fromLocationID, ownerID, outputLocationID?, outputFlagID?)` | reprocessing is a **bound object** — reuse the R3 bound-object machinery |

**Already allowlisted — reuse, don't re-add:** `beyonce.CmdWarpToStuff` / `CmdOrbit` / `CmdStop` (warp to the belt, orbit the rock); `invbroker.ListByFlags` / `List` / `Add` (read the ore hold, unload to hangar); `dogmaIM.ShipGetInfo` / `ShipOnlineModules` / `SetModuleOnline`.

## Objective

**Slice A — targeting + activation (the keystone), commit first.**
1. Allowlist the targeting and activation pairs; deny-by-default intact, with a test proving non-allowlisted `dogmaIM` siblings are still refused.
2. BFF routes: lock / unlock / list targets, and activate / deactivate a module (optionally against a target, with `repeat`).
3. UI, **generic — not mining-specific**: lock/unlock from an **Around Your Ship** row, a visible **locked-targets list** with each target by name, and per-module activate/deactivate with active state shown. This is the layer combat will reuse.
4. Surface the server's refusals verbatim (out of range, not locked, wrong module) — never guess a reason.

**Slice B — the mining loop, commit second.**
5. Add `remainingQuantity` / `miningYieldTypeID` / `beltID` to the space-snapshot projection so the overview can show a rock's ore type and how much is left.
6. Overview: show asteroids usefully — ore **name**, distance, remaining. Warp-to-belt already works via the beacons.
7. **Ore hold**: display flags 134/135/181/182 (falling back to cargo) with used/total, and unload to the station hangar via the existing `Add`.
8. **Survey scanner**: `miningScanMgr.perform_scan()` results merged into the overview.
9. **Reprocessing** at a docked station: bind `reprocessingSvc`, show `GetQuotes` (**including the ISK tax — it is charged**), and `Reprocess` behind a two-step `confirm: true` gate like R12/R14/R16. Re-read and report what actually happened.

## Invariants

**R7d** zero visible numeric IDs (ore, rocks, modules, stations by **name**) · **R8** responsive reflow + ≥40px targets · **R9a** plain player language ("ore hold", not `flag 134`) · **R18** `panelFirstMount.test.ts` green · **a 200 is not proof** — re-read after every mutation and say plainly when the server declined without a reason.

Server stays authoritative: the browser issues the retail calls and displays what comes back. Never simulate a mining cycle or predict yield locally.

## Required work

1. **Baseline** (record): web `npm test` (expect 834/834); eve.js manifest 3/3, agent-parity 6/6, the gateway suites green. **Note:** `webGatewayEvents` has one known failing case (an upgrade-rejection test invalidated by an earlier authorised auth change) — it is pre-existing for this goal; do not fix it here, just don't add to it.
2. Slice A, commit. Slice B, commit. Tests for the allowlist + deny-by-default, the BFF routes, the ore-hold flag ladder, the scan merge, and the reprocess confirm gate.
3. Update `docs/bridge-wire-contract.md` + the roadmap (R23 row). Commit eve.js and web **separately**; report all hashes. **Do not push.**

## Definition of done

- A player can fly to a belt, **lock an asteroid, turn on a mining laser, watch ore fill the ore hold**, stop when full, dock, unload, reprocess into minerals, and sell. Targeting and module activation exist as a **generic** layer combat can reuse unchanged. All invariants re-proven; suites green. Committed; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface only** (`_secondary/express/*` + tests). Never modify mining, dogma, reprocessing or space mechanics — call them. Branch `ReconcileEliteMode`; pathspec commit; never `git add -A`; other agents have in-flight work there.
- The OPERATOR runs EveJS (:26002) and the market daemon (:40111); the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart any of them. Never push.
- Screenshots have been unavailable to every worker — verify by measurement and **state plainly that you did not visually inspect it**.
