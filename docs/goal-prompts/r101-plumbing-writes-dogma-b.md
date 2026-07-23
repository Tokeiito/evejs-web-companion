# Goal R101: Plumbing sweep — Phase-4 bound WRITES: dogma batch B (link/unlink + probes + drones + implants/booster) (WB-DOGMA split 2 of 2) (11) — CLOSES WB-DOGMA

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R100.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). **Continues R100's dogma work** — read `docs/goal-prompts/r100-plumbing-writes-dogma-a.md`. Not market files (separate session).

## ⚙ SERVER PROTOCOL (operator owns EveJS) — DO NOT restart EveJS (:26002) OR the web BFF (:26500)

Verify WITHOUT a running-server smoke: allowlist via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`, routes/decoders + refuse-without-confirm via web `node --test` UNIT tests. NO live smoke, NO `Start-Process`, NO server restart. New pairs go live when the operator next restarts EveJS. State this in your report.

## Phase-4 two-step — off the dogmaIM bind (same as R100)

BOUND writes off `dogmaIM.MachoBindObject`. R100 added `dispatchBoundDogmaWrite` → `boundCall(dogmaBindSpec(), method, args, null)` in `src/server.js` — reuse it. Do NOT add a new bind pair.

## This batch — WRITES (grep-confirm each `Handle_*` exists in `dogmaService.js`)

`PeelAndLink` (:7009), `UnlinkModule` (:7035), `LinkAllWeapons` (:7054), `UnlinkAllModules` (:7088), **`DestroyWeaponBank`** (:7113, destructive), `LaunchProbes` (:8427), `ChangeDroneSettings` (:5282), **`InjectSkillIntoBrain`** (:9425, CONSUMES a skillbook), **`InjectImplant`** (:9430, installs an implant), **`DestroyImplant`** (:9456, destroys an implant), **`UseBooster`** (:9481, CONSUMES a booster).

**Bold = destructive/consumable** — confirm-gate + never-fire (you're not firing anything anyway this batch — no live server). The rest are module-link/unlink + probe-launch + drone-settings (reversible in-space ops).

## Arg-injection note (flag, don't fix)

R100 flagged `LinkWeapons`/`MergeModuleGroups` (#39-40) for taking a caller `shipID` with no ownership gate — the sibling link/unlink writes here (`PeelAndLink`/`UnlinkModule`/`LinkAllWeapons`/`UnlinkAllModules`) likely share that pattern. READ each quickly: does it take a caller `shipID`/`moduleID` and act on a foreign ship with no session gate? If unguarded → append to `docs/arg-injection-leak-handoff.md`. The implant/booster/skill writes act on the session char (verify). Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write. **NO server restart.**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2422), `tsc` + `build:web` clean.
2. Wire each write off the dogmaIM bind (reuse `dispatchBoundDogmaWrite`/`dogmaBindSpec`): allowlist + confirm-gated BFF POST route + educated-guess decoder + basic UNIT test. **Un-stale ALL refusal tests/enumerations** (grep each method + `dogmaIM` across `webGateway*.test.js` — `webGatewayTargetingActivation` `listedDogma` deepEqual + refusal loops; `webGatewayDronesAndHostiles` for `ChangeDroneSettings`/`LaunchProbes`). Update the snapshot.
3. **Verify via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js` + web `node --test` — NO server restart, NO live smoke.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R101 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES WB-DOGMA (22/22).**

## Definition of done

The 11 dogma-B writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers) off the dogmaIM bind, reachable via confirm-gated BFF routes, decoded (educated-guess), with basic unit tests — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`), snapshot current, no UI, market files untouched, NO server restarted. WB-DOGMA complete.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** temp files → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. No live login needed (no smoke this batch).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) which of the 11 writes landed / skipped (missing-handler reason) + the bind mechanism, (b) confirm-gate + how refuse-without-confirm is UNIT-tested, (c) which refusal tests/enumerations you un-staled, (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged (esp. the link/unlink shipID pattern), (g) confirmation you did NOT restart EveJS or the web BFF + did not push.
