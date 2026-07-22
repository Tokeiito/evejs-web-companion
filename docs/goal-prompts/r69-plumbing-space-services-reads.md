# Goal R69: Plumbing sweep — in-space info-service reads (sov / ESS / pvp-filament / fleet ads) (18)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready (fire after R68 lands + is verified). **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** un-stale refusal tests) + worklist (`docs/plumbing-worklist.md`). Batches **R-SOV + R-ESS + R-PVP + R-FLEETADS**. These are solar-system / character info-service reads — not market files (separate session).

## ⚠ Ownership-leak check per read (R63, MANDATORY). Verify LIVE; skip+cite any leak.

Most of these are public/system-scoped (sovereignty, incursion-adjacent, fleet ads everyone can see). But three seams could leak and MUST be verified against an un-owned entity before allowlisting:
- **`pvpFilamentMgr.GetCharacterStatistics`** — does it take a **charID** and return an ARBITRARY character's abyssal stats, or only the session's own? If it accepts a foreign charID and returns their private stats → LEAK, skip + cite. (`GetLeaderboard` is public ranking — safe, verify.)
- **`essMgr.GetMainBankTheftsForClientSolarSystem` / `GetReserveBankTheftsForClientSolarSystem`** — ESS theft records. If they name other characters/corps' private data beyond what the in-space ESS broadcast already makes public, treat with care; a read is safe only if it returns genuinely public game data OR the session's own. Verify what an un-involved session sees.
- **`fleetProxy.GetMyFleetFinderAdvert`** — the `My` prefix is NOT proof (R63); confirm it returns only the session's own advert, not another fleet's.

## This batch — top-level READS (grep-confirm each `Handle_*` exists + top-level before wiring; skip+report any missing/bound)

- **sovMgr** (`sovMgrService.js`): `GetSovStructuresInfoForLocalSolarSystem` (:29), `GetSovStructuresInfoForSolarSystem` (:43, takes systemID), `GetSystemSovereigntyInfo` (:51), `GetInfrastructureHubInfo` (:56), `GetSovHubFuelAccessGroup` (:61), `IsOnLocalSovHubFuelAccessGroup` (:72).
- **essMgr** (`essMgrService.js`): `GetDataForClientSolarSystem` (:194), `IsClientLinkedToReserveBank` (:205), `GetMainBankTheftsForClientSolarSystem` (:314), `GetReserveBankTheftsForClientSolarSystem` (:325).
- **pvpFilamentMgr** (`pvpFilamentMgrService.js`): `GetAllEvents` (:113), `GetActiveEvents` (:118), `GetMostRecentEvent` (:123), `GetNextEventDate` (:128), `GetLeaderboard` (:133), `GetCharacterStatistics` (:139).
- **fleetProxy** (`fleetProxyService.js`): `GetAvailableFleetAds` (:15), `GetMyFleetFinderAdvert` (:39).

## Traps

- **Args:** `GetSovStructuresInfoForSolarSystem(systemID)`, `GetInfrastructureHubInfo`/`GetSystemSovereigntyInfo` (systemID?), `GetCharacterStatistics(charID?)` — capture the retail signature and forward exactly; an argless call that needs an ID returns empty silently (a 200 is not proof).
- **Wire shapes vary** — decode from **real captured bytes**. IDs stay as data (R7d); any ISK (ESS bank balances, theft amounts) bigint-safe; FILETIMEs (event dates) bigint. Sov/ESS reads may return CRowset/dict via `buildCachedMethodCallResult` — double-unwrap as the shape dictates.
- **Empty is legitimate** — no active abyssal event, no ESS theft, no fleet ads, Farmer's system having no sov structure is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + service you allowlist and un-stale any refusal assertion (keep still-refused writes asserted); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current count), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each route (real args where needed), capture real bytes, confirm decoders + **ownership-safety on the three flagged seams**. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R69 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls (minus any skipped for leak/no-handler/bound, with reason) are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift, predates the sweep). `webGatewayServiceCall` needs the **isolated runner**; the isolated runner reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web (SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never from a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check — do not trust a stale PID.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
