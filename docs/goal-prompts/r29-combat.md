# Goal R29: PvE combat — but prove the wire first

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Blocked on R28 landing (shares `src/server.js` and the web store). **Scope is NOT settled — slice 0 settles it.**

The operator deferred combat until mining was proven. It is proven (R26 mined unattended for two full cycles). This is the goal that unblocks it.

## Read this first: the research was wrong in ways that matter

A feasibility survey was run, then **adversarially re-verified by two independent skeptics per claim plus a tie-breaking synthesis**. The survey's headline conclusion did not survive. Take the corrected version below, not the optimistic one.

### What survived

- **Activation really is one shared primitive.** `dogmaService.js:7940 Handle_Activate` has exactly one special branch — propulsion (`:7988-7990`). Turrets, launchers, mining lasers and salvagers all take the generic arm at `:8047-8055` → `spaceRuntime.activateGenericModule`. Probe-launcher diversions are `groupID`-gated and a combat launcher matches neither. An **empty effect name resolves the module's own default** (`runtime.js:27342-27350`), so the browser need not know effect names. Allowlist enforcement is a bare key-set (`evejsWebGatewayRuntime.js:941-942`) — `Activate` cannot be narrowed to mining. **Firing needs no new pair.**
- **Rat health is already on the wire and already decoded.** `spaceHealthRatios` (`evejsWebGatewayRuntime.js:1371`) projects onto the base row *before* the kind branch at `:1487-1489` — unconditional. Decoded at `web/src/bridge/space.ts:95-97`. We receive every rat's shield/armor/hull and draw none of it.
- **Weapon banking breaks our existing verification.** `dogmaService.js:7948-7959` silently redirects to the bank master; `activeModuleIDs` carries master keys only (`evejsWebGatewayRuntime.js:1655-1661`). Our BFF's `active: ids.includes(itemID)` (`src/server.js:4729`) therefore returns **false on a successful activation**, and `:4769` reports `stopped:true` while guns still cycle.

### What died

- **"Combat needs ZERO new gateway pairs" is false.** `grep -c Ammo evejsWebGatewayRuntime.js` = **0** (I verified this personally). `dogmaIM.LoadAmmo` (`dogmaService.js:8454`) and `UnloadAmmo` (`:8692`) are refused pre-dispatch. Zero pairs is true **only** for: *missile boat, pre-loaded, single ammo type, no swapping.* Missiles auto-reload server-side (`missileReloads.js:72` → `queueAutomaticModuleReload`); **turrets have no equivalent anywhere in `space/`** and dead-end at `NoCharges` (`runtime.js:13109`) with no client-side fix but docking.
- **A previously-suspected decoder bug is NOT real.** `decodeFittedSlotMap` (`src/server.js:1648`) does coerce a tuple itemID to 0 — but `readFittedItemIDs` (`:1616-1625`) calls `ListByFlags` with 40 concrete integer flags, and the tuple-row builder returns `[]` unless `requestedFlag === null` (`invBrokerService.js:934-940`). The gate cannot open on our path. **Do not "fix" this.** Keep it as a latent constraint.

## Slice 0 — VERIFY THE WIRE. Do this before writing any feature code.

Everything above is a code read. **Nothing has been executed.** Four cheap live probes collapse most of the risk; the answers determine the rest of the goal. Report each result explicitly.

1. **Fire a real turret and a real missile launcher** through `/api/bridge/modules/activate` with an **empty** effect name at a locked rat. Does it land? What exactly returns on `NO_AMMO`? Nothing in either repo exercises this today.
2. **Does an NPC shooting us produce `OnDamageMessage` in the browser?** The synthesis claims no NPC emits damage (nothing under `space/npc/` fires). **I believe that is unproven**: the emitters are in `space/runtime.js` (`:17021`, `:17785`, `:17977`) and `notifyWeaponDamageMessages` notifies the *target's* session as well as the attacker's, so an NPC firing through `activateGenericModule` may well notify its victim. **Settle it by watching the SSE stream while a rat shoots you.** This decides whether an "under attack" indicator is possible at all, or whether `healthIsDropping` (`web/src/space/overview.ts:329`) remains the only honest signal. Note the existing comment at `overview.ts:323` ("this client has NO damage log to read") is **at minimum wrong about outgoing damage** — our own hits do emit. Correct it to whatever you actually observe.
3. **Loot one NPC wreck** via `/api/bridge/inventory/transfer` with no `qty`. Expect the route to report `applied:false, declinedSilently:true` **on success**, because loot MINTS a new row (`itemStore.js:2593`) and destroys the wreck item (`nativeNpcWreckService.js:408`) while `src/server.js:1202/1211` judges by destination membership. Confirm, then fix the predicate to judge by the **source shrinking** (`splitApplied` at `:1206-1210` already does this).
4. **Try an ammo-type swap via `invbroker.Add`.** Expect 200 + null body + the old charge still loaded (`invBrokerService.js:1828-1829` declines, `:7484` → `CHARGES_USE_LOAD_AMMO`, → `return null` at `:7498`; that error string has exactly one hit in the tree — produced, never mapped).

**If slice 0 shows turret ammo or ammo-switching is needed, you may add `dogmaIM.LoadAmmo`/`UnloadAmmo` to the allowlist** — restricted to `server/src/_secondary/express/*` and `server/tests/*`, never game mechanics. **Restart EveJS after adding pairs**; a stale server is a recurring failure mode here (R23's pairs existed in code but not in the running process, and cost a live debugging session).

## Then build

A **weapons rack** (activate/deactivate per weapon, with state that survives banking), **rat health bars** (data already arriving), a **damage log** if and only if slice 0 proves the notification arrives — a new `case` in `applyPushedNotification` (`web/src/app/flow.ts:653-663`, which today handles only `OnGodmaShipEffect`/`OnItemsChanged`), and a **wreck/loot panel** composing the two existing inventory routes.

## Hard rules

- **A 200 is not proof** — seven confirmed silent-decline cases, and slice 0 items 3 and 4 are two more. Confirm every action against an authoritative re-read.
- **Verify activation by set-delta on `activeModuleIDs`, never by ID equality** — weapon banking makes equality wrong. This is a real bug in `src/server.js:4729`/`:4769` today.
- **Do not derive running damage totals from `live.notifications`** — the push channel is lossy by design (`sessionEventStream.js:203-205` trims, `clientStore.ts:446` caps at 50). Reconcile against an authoritative read, as `flow.ts:658-662` already does for the ore hold.
- **Beware the phantom full shield:** NPCs spawn `shieldCharge: 1` unconditionally (`nativeNpcService.js:1372-1377`) and `spaceHealthRatios:1381` has no capacity guard, so a shield-less rat reads 1.0 until first damage then snaps to 0. Do not gate anything on "shields stripped".
- **No absolute HP for non-ego rows** — capacities exist only in `projectActiveShipStatus:1646-1648`. Time-to-kill for a rat is not computable from the wire. Do not fake it.
- **Loot range is not enforced server-side** (no distance check in `nativeNpcWreckService.js`). Retail requires 2,500 m. Do not build a UI that assumes the server will refuse.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline the web suite; `tsc` + `build:web` clean. Known pre-existing eve.js failures — `webGatewayEvents`, `droneRuntimeParity` — **do not touch**.
2. **Slice 0 first, reported explicitly, before feature code.**
3. Build; test off synthetic state as `autopilotLoop.test.ts` / `miningBotLoop.test.ts` do. Pin the banking set-delta and the loot success-predicate as regression tests.
4. Live-verify: kill at least one rat and loot its wreck. Report real numbers.
5. Roadmap R29 row + `docs/bridge-wire-contract.md` if the contract changes. Commit by pathspec; report hashes. **Do not push.**

## Constraints

- Another agent has in-flight eve.js destiny/parity work — never revert or clobber it. Never `git add -A`. Never push.
- Servers: leave all three healthy. **If you restart EveJS, own the process** — do not rely on one started by another agent's shell (that killed it mid-run on 2026-07-21).
- Screenshots unavailable; verify by measurement and say plainly what you could not see.
