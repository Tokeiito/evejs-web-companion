# Goal R85: Plumbing sweep — Phase-2 bound reads: fleet (RB-FLEET) (5) — CLOSES Phase-2 reads

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads — the LAST bound-read batch). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (RB-FLEET). These 5 bound reads hang off `fleetObjectHandler.MachoBindObject` (wired R72). **⚠ R72 already FLAGGED this fleet bind as BINDS-ARBITRARY-OID** (`docs/arg-injection-leak-handoff.md`, the fleet addendum): the bind takes `bindParams[0]` as a fleetID with no membership check, so bound reads off it leak any fleet's roster/MOTD/composition via `/api/bridge/call` foreign-fleetID injection. **These 5 reads are EXPECTED to be flagged** — plumb them + flag them (operator flag-only, keep pre-plumbed). Not market files (separate session).

## Phase-2 mechanics — reuse the R72 fleet bind

The fleet bind is wired: `fleetObjectHandler.MachoBindObject` allowlisted R72, and `src/server.js` has `fleetBindSpec()` (binds session-scoped, `args:[]`). Mirror the established two-step (R72 `gatewayBinds`, R74 dogma, R77 planet): bind → `boundHandle` → call each bound read against it via `boundCall(fleetBindSpec(), ...)`. R72 proved these Phase-2 fleet reads are deny-by-default refused until allowlisted; this batch allowlists them.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY, EXPECT FLAGS)

These return the fleet's roster/wings/MOTD/join-requests/composition. Via the dedicated route the BFF binds session-scoped (own fleet, safe). Via `/api/bridge/call` a caller can bind a FOREIGN fleetID (the R72-flagged bind), so the bound reads return that fleet's data. For EACH read: read the handler + confirm whether the bound read honors the caller-bound fleetID (per R72's finding, `fleetRuntime.getWings`/`getMotd`/`getFleetComposition` take a bare fleetID with no membership gate). **Flag each in `docs/arg-injection-leak-handoff.md`** — extend/append to the existing R72 fleet addendum with the specific read pairs (do NOT de-allowlist — operator flag-only). If any read IS session-membership-gated (a pleasant surprise), mark it SAFE with evidence. Report verdict per read.

**Live note:** Farmer is docked and NOT in a fleet, so these reads are empty/null live and the foreign-fleetID leak canNOT be exercised live (no second fleet seeded) — same static-flag confidence as the R72 fleet addendum. Say so plainly. If you can form a fleet cheaply to capture populated bytes, do; otherwise use builder-mirrored fixtures.

## This batch — bound READS (grep-confirm each `Handle_*` exists in `fleetObjectHandlerService.js`)

`GetInitState` (:138), `GetWings` (:152), `GetMotd` (:159), `GetJoinRequests` (:163), `GetFleetComposition` (:169).

## Traps

- **Wire shapes:** decode from **real captured bytes** where possible (empty live for Farmer); fleet/wing/squad/char ids stay data (R7d); MOTD is a string; composition counts are numbers. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — no fleet → empty/null is the real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); flag the leaking reads (keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only** (fleet WRITES are Phase-4); **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `fleetObjectHandler` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration (R72 wired the bind — check its enumerations); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2269), `tsc` + `build:web` clean.
2. Wire each bound read off the R72 fleet bind. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, bind the fleet handler, hit each read (empty live — no fleet); confirm decoders + the empty path. Extend the fleet addendum in the handoff doc with each read's verdict. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R85 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES Phase-2 bound reads (111/111) — the sweep then moves to Phase 3/4 WRITES.**

## Definition of done

The 5 fleet bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF off the R72 fleet bind, decoded from real bytes with tests, each flagged in the handoff doc (or marked SAFE with membership-gate evidence) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green. Phase-2 bound reads complete.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 73516 / web BFF 54464 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
