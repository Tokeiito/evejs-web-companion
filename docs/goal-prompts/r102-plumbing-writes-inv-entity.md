# Goal R102: Plumbing sweep — Phase-4 bound WRITES: inventory + drone commands (WB-INV + WB-ENTITY) (11)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R101.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Not market files (separate session).

## ⚙ SERVER PROTOCOL (operator owns EveJS) — DO NOT restart EveJS (:26002) OR the web BFF (:26500)

Verify via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js` + web `node --test` UNIT tests. NO live smoke, NO `Start-Process`, NO server restart. New pairs go live when the operator next restarts EveJS. State this in your report.

## Phase-4 two-step — two binds

- **WB-INV → off the `invbroker` bind** (the R75 inventory READS use the invbroker bind two-step in `src/server.js`). Mirror that bind spec.
- **WB-ENTITY → off the `entity` bind** (`entity.MachoBindObject` wired R72; the R72 gateway-binds work established it). Mirror the established bound-call pattern (like `dispatchBoundDogmaWrite`).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**invbroker (7)** (`invBrokerService.js`): `SetLabel` (:6194), **`StripFitting`** (:6762, destructive — unfits a ship), `FitFitting` (:8031), `AssembleCargoContainer` (:8418), `BreakPlasticWrap` (:8424), `DeliverToCorpHangar` (:8430), `DeliverToCorpMember` (:8541).

**entity (4)** (`entityService.js`): `CmdReturnHome` (:68), `CmdSalvage` (:80), **`CmdAbandonDrone`** (:88, abandons a drone), `CmdReconnectToDrones` (:92).

**Bold = destructive/consequential** — confirm-gate + never-fire (you're not firing anything anyway — no live server). The rest are inventory-label/fit/container + drone commands.

## Arg-injection note (flag, don't fix)

The R75 inventory READS flagged `GetItem`/`GetItems`/`GetContainerContents` (#15-17) for caller-item-id-without-ownership. The WRITES here (`SetLabel`/`StripFitting`/`FitFitting`/`DeliverTo*`) likely take a caller itemID/shipID — READ each quickly: does it mutate a foreign item/ship with no session-ownership gate? If unguarded → append to `docs/arg-injection-leak-handoff.md` (write-side). entity drone commands act on the session's own drones (verify). Don't block (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write. **NO server restart.**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2433), `tsc` + `build:web` clean.
2. Wire each write off its bind (invbroker / entity): allowlist + confirm-gated BFF POST route + educated-guess decoder + basic UNIT test. **Un-stale ALL refusal tests/enumerations** (grep each method + `invbroker`/`entity` across `webGateway*.test.js` — `webGatewayDronesAndHostiles` has an `entity.*` refusal loop; `webGatewayInventoryDepth`/`webGatewayFitting`/`webGatewayCorpHangar` may name invbroker writes). Update the snapshot.
3. **Verify via isolated eve.js test + web `node --test` — NO server restart.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R102 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 11 inventory/entity writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers) off the invbroker/entity binds, reachable via confirm-gated BFF routes, decoded (educated-guess), with basic unit tests — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`), snapshot current, no UI, market files untouched, NO server restarted.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** temp files → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. No live login needed (no smoke this batch).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) which of the 11 writes landed / skipped (missing-handler reason) + the bind mechanism per service, (b) confirm-gate + how refuse-without-confirm is UNIT-tested, (c) which refusal tests/enumerations you un-staled, (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) confirmation you did NOT restart EveJS or the web BFF + did not push.
