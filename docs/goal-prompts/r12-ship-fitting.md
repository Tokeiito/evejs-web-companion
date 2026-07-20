# Goal R12: Ship fitting — view the fit, fit/unfit modules, CPU / powergrid / capacitor

**Issued:** 2026-07-19 by the orchestrator (Phase 4). **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

Fitting gates almost every other activity (you can't meaningfully mine, fight, or run harder missions unfitted). This goal makes the browser able to view a ship's fitting, fit and unfit modules, bring them online/offline, and see CPU / powergrid / capacitor / calibration.

## What the research established (verified — build on this, don't rediscover it)

**Fitting is not a dedicated service — it is the `invbroker` bound-object bridge you already built in R3, with a slot flag instead of flag 4/5.**

- **Fit a module:** bind `("invbroker","GetInventoryFromId",[shipID],{passive:0})` → call `("invbroker","Add",[moduleItemID, sourceLocationID],{qty:1, flag:<slotFlagID>})`. `sourceLocationID` is the station ID when fitting from the hangar, the ship ID when fitting from its own cargo. Destination is the bound OID, never repeated in args. (Retail path: `fittingSlotController.py:192` → `clientDogmaLocation.py:669-673 TryFit` → `invCache.py:1020`.) `flag=0` (`flagAutoFit`) is legal — the server picks the slot.
- **Unfit:** the same `Add`, reversed. Docked → bind `("invbroker","GetInventory",[stationID])`, call `("invbroker","Add",[moduleID, shipID],{flag:4})`. In space → ship binding with `{flag:5}`. (`fittingSlotController.py:217-243`.)
- **Rigs cannot be unfitted** — they route to `("invbroker","DestroyFitting",[moduleID])` on the ship binding (`fittingSlotController.py:245-265`). Treat destroying a rig as a **destructive action requiring explicit confirmation in the UI.**
- **Multi-fit:** `("invbroker","MultiAdd",[itemIDs[], sourceID],{flag})`.
- **Online/offline:** a separate `dogmaIM` bound two-step — `SetModuleOnline` / `TakeModuleOffline`.
- **Read the fit + attributes:** `dogmaIM.ShipGetInfo()` / `GetAllInfo()` deliver the ship's dogma attributes wholesale.
- **`fittingMgr` is NOT live fitting** — it is saved fitting templates. Out of scope.

**Slot flagIDs** (`inventorycommon/const.py`): low **11–18**, mid **19–26**, high **27–34**, rig **92–99**, subsystem **125–132**, hangar **4**, cargo **5**, auto-fit **0**. Server mirror: `server/src/services/fitting/liveFittingState.js:46-59` (`SLOT_FAMILY_FLAGS`, `SHIP_FITTING_FLAG_RANGES`). ⚠ **Known divergence:** the server allows rigs 92–99 and subsystems 125–132, while the retail client's lists are only 92–94 and 125–128 — prefer the **server** ranges and note the difference.

**Dogma attribute IDs** (`dogma/const.py`): CPU output **48**, CPU load **49**, CPU per-module **50**; PG output **11**, PG load **15**, PG per-module **30**; capacitor capacity **482**, charge **18**, recharge **55**; calibration used/capacity **1152 / 1132**, rig cost **1153**; slot counts low/mid/high/rig/subsystem **12 / 13 / 14 / 1137 / 1366**; module online flag **2**; turret/launcher hardpoints left **102 / 101**.

**Allowlist status:** the `dogmaIM` pairs are **not** allowlisted, and only *some* `invbroker` pairs are. Adding the needed (service, method) pairs to the deny-by-default allowlist in `evejsWebGatewayRuntime.js` is in-footprint. Server handlers for all of this already exist and are complete (including CPU/PG gating at online time) — **call them, never change them.**

## Objective

1. **eve.js (gateway only):** allowlist the pairs this needs (`dogmaIM` ShipGetInfo/GetAllInfo/SetModuleOnline/TakeModuleOffline, plus any missing `invbroker` pairs incl. `DestroyFitting`/`MultiAdd` if you use them) — pairs only, deny-by-default intact, with a gateway test proving non-allowlisted siblings are still refused.
2. **BFF:** routes for reading the fitting (slots + fitted modules + the resource attributes) and for the actions (fit / unfit / online / offline / destroy-rig), on the held session, reusing the R3 bound-object machinery and its handle caching. Typed errors surface the handler's own refusal reason (e.g. insufficient CPU/PG at online time) — never guess.
3. **Web — Fitting panel:** show the ship's slots grouped by family (high / mid / low / rig / subsystem) with **what's fitted in each, by name**; show **CPU, powergrid, capacitor, and calibration** as used/total with bars; offer **Fit** (from hangar/cargo), **Unfit**, and **Online/Offline** per module, plus a confirmed **destroy** path for rigs. Empty slots are visible as empty.
4. Reuse the existing inventory reads to populate "what can I fit" from the station hangar / ship cargo.

## Invariants (must all still hold)

- **R7d — zero visible numeric IDs.** Modules, ship, and slots are named, never raw itemIDs/typeIDs/flagIDs. Re-run the ID sweep and prove it.
- **R8 — responsive.** Any table reflows to stacked cards on phones (`reflow` + `data-label` + `overflow-x-auto`); touch-sized actions.
- **R9a — plain player language.** No bridge/dogma jargon in UI text (say "Powergrid", not `attributePowerOutput`).
- Server stays authoritative: the browser issues the retail calls and shows what the handlers return; it never simulates fitting validity locally beyond disabling obviously-impossible actions.

## Required work

1. **Baseline** (record): web `npm test` (expect 381/381); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the **11** isolated gateway suites green.
2. Implement 1–4 with tests: a gateway test for the new allowlist pairs (and deny-by-default still refusing siblings), BFF route tests (fit/unfit/online/offline, and a refusal surfacing its reason), and web tests for the slot grouping, resource math display, and action wiring.
3. Update `docs/bridge-wire-contract.md` (the fitting contract + the flag/attribute mapping you used) and the roadmap (R12 row). Commit eve.js and web **separately**; report both hashes. **Do not push.**

## Definition of done

- A docked player can open Fitting, see every slot and what's in it **by name**, see CPU / powergrid / capacitor / calibration used vs total, and fit / unfit / online / offline modules — with refusals showing the server's own reason. Rig destruction is confirmed, never accidental. All invariants verified. All baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed separately; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface files only**. Never modify dogma, `liveFittingState.js`, invbroker, or any game-mechanics code — call them. eve.js is on branch `ReconcileEliteMode` (contains all prior bridge work); commit to the checked-out branch, stage only your files, never `git add -A`, never revert other agents' in-flight work.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If too large for one session, land the **read path** (allowlist + fitting read + panel showing the fit and resources) first, committed and green, then the mutating actions — and report the split precisely. Never leave broken or uncommitted work.
