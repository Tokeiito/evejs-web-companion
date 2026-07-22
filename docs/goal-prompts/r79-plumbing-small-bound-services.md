# Goal R79: Plumbing sweep — Phase-2 bound reads: the small-service tail (wars / scan / PI-tax / corp-station) (8)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** — refusal lists AND `deepEqual`/"exactly" enumerations) + worklist (`docs/plumbing-worklist.md`: RB-WARREG, RB-SCAN, RB-PITAX, RB-CORPSTN). **Clears the entire small-service tail of Phase-2 in one batch** — four distinct bound services, 8 reads. After this only the big corp/alliance batches + the flagged fleet reads remain. Not market files (separate session).

## Four services — resolve each bind (grep the pattern per service; mirror R73–R78)

For EACH service, first grep how the gateway dispatches its reads (top-level `/call` on the service string, a Moniker, or a `MachoBindObject` two-step) and confirm the exact allowlist service string, then wire the reads. `scanMgr`'s gateway (`GetSystemScanMgr`) is ALREADY wired (R72) — reuse it.

1. **RB-SCAN — `scanMgr` bound (off the R72 `GetSystemScanMgr` bind):** `GetFullState` (`scanMgrService.js:1569`), `GetScanTargetID` (:1660). Session's OWN system scan manager (R72 verified `GetSystemScanMgr` is session-derived) → expected SAFE; verify the bound reads don't take a foreign system/probe id.
2. **RB-WARREG — `warRegistry` bound (Moniker `eveMoniker.GetWar`, keyed on an owner):** `GetWars` (`warRegistryService.js:169`), `GetNegotiations` (:177), `GetWarNegotiation` (:255), `IsAllianceOrCorpLocal` (:157). War declarations are largely PUBLIC, but **surrender/ally negotiations may be private** — verify. If bound to a caller-supplied ownerID that returns a foreign owner's private negotiations → flag.
3. **RB-PITAX — `planetOrbitalRegistryBroker` bound (solarSystemID):** `GetTaxRate` (`planetOrbitalRegistryBrokerService.js:45`). A planet's customs-office tax rate is PUBLIC (everyone pays it) → expected SAFE; confirm it's public per-system data, not owner-private.
4. **RB-CORPSTN — `corpStationMgr` bound (stationID):** `DoStandingCheckForStationService` (`corpStationMgrService.js:183`). A standing-gate check for a station service → returns whether the SESSION passes the gate; verify it's session-scoped (does it leak another char's standing? probe a foreign charID if it takes one).

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

`/api/bridge/call` forwards args verbatim. For EACH of the 8 reads, read the handler + live-probe with a foreign id (second account `test2` → Test Two 140000002 / its corp 98000000): does it return the SESSION's own / genuinely public data, or another entity's private data for an injected id? Any leak → **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (append rows; do NOT de-allowlist — operator's flag-only decision). Report the verdict + evidence per read. (Wars/negotiations and the corp-station standing check are the likeliest to leak; scan/tax likely public/session.)

## Traps

- **Args:** `GetScanTargetID`, `GetWarNegotiation(warID/ownerID)`, `GetTaxRate(solarSystemID)`, `DoStandingCheckForStationService(stationID, …)` take ids — capture the retail signature; forward exactly. A 200 with empty data on a needed id is not proof.
- **Wire shapes:** decode from **real captured bytes**; war ISK/tax rates bigint/float-safe; FILETIMEs bigint; IDs stay as data (R7d). Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — Farmer's corp (98000001) is in NO war (R66 confirmed none seeded), no active scan while docked, are real states; verify + assert the empty paths. Populated war/scan shapes (which this world may not produce) → fixtures mirroring the server's builders, noted plainly.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: for each method + each of the four services, grep every `webGateway*.test.js` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2165), `tsc` + `build:web` clean.
2. Resolve each of the four binds; wire all 8 reads per the contract. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read; capture real bytes; confirm decoders AND the arg-injection check per read (foreign id → own/public or refusal). Report real shapes, empty-but-legitimate results, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R79 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 8 small-service bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF, decoded from real bytes with tests, each ownership-checked under arg-injection (session-scoped/public, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green. **This clears the Phase-2 small-service tail; only corp/alliance + fleet remain.**

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 71576 / web BFF 13968 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password. Use test2 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
