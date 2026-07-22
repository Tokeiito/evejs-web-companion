# Goal R71: Plumbing sweep — Phase-1 data-read finisher (PI + asset-safety + strays) (9)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads — the last DATA batch of Phase-1). **Status:** Ready (fire after R70 lands + is verified). **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** un-stale refusal tests) + worklist (`docs/plumbing-worklist.md`). Batches **R-PITOP + R-SAFETY + strays** (`GetNearbyJumpBridges`, `beyonce.GetFormations`, `ship.GetShipConfiguration`). Closes Phase-1 top-level DATA reads; the gateway-bind reads (skillMgr2/dogmaIM/entity/scanMgr/fleetObjectHandler) are R72, next.

## ⚠ Ownership-leak check per read (R63, MANDATORY). Verify LIVE; skip+cite any leak.

**One read here is in the exact category R63 SKIPPED — treat it as guilty until proven innocent:**
- **`structureDirectory.GetNearbyJumpBridges`** — R63 SKIPPED `GetStructures` / `GetMyCharacterStructures` because they leaked rival corps' structure fuel/reinforce/vulnerability. The **"my access"** variant `GetJumpBridgesWithMyAccess` is already wired (R63). `GetNearbyJumpBridges` may return **ALL nearby jump bridges regardless of access** — i.e. rival corps' private infrastructure locations/state. If it exposes any bridge the session has no access to (beyond a name+position already on the public map), that is a LEAK → **skip + cite**, exactly as R63 did. Only wire it if it returns solely public map data or bridges the session can use.
- **`planetMgr.GetPlanetsForChar` / `GetMyLaunchesDetails`** — the session's own PI colonies/launches. Confirm session-scoped (does `GetPlanetsForChar` take a charID that could select another char's colonies? verify with a foreign id).
- **`structureAssetSafety.GetItemsInSafetyForCharacter` / `GetItemsInSafetyForCorp` / `GetStructuresICanDeliverTo`** — the session's own asset-safety items / deliverable structures. Confirm own-only (a corp asset-safety read must be role/corp-scoped to the session, not arbitrary).
- **`ship.GetShipConfiguration`** — the session's own active ship config. Confirm session-scoped. `beyonce.GetFormations` / `structureAssetSafety.GetWrapNames` are config/lookup — low risk, still verify.

## This batch — top-level READS (grep-confirm each `Handle_*` exists + top-level; skip+report any missing/bound)

- **planetMgr** (`planetMgrService.js`): `GetPlanetsForChar` (:942), `GetMyLaunchesDetails` (:1296). *(These are the TWO top-level PI reads; the per-planet reads are bound — Phase-2.)*
- **structureAssetSafety** (`structureAssetSafetyService.js`): `GetItemsInSafetyForCharacter` (:182), `GetItemsInSafetyForCorp` (:191), `GetWrapNames` (:208), `GetStructuresICanDeliverTo` (:219).
- **structureDirectory** (`structureDirectoryService.js`): `GetNearbyJumpBridges` (:612) — ⚠ leak-gate above.
- **beyonce** (`beyonceService.js`): `GetFormations` (:1752).
- **ship** (`shipService.js`): `GetShipConfiguration` (:1771).

## Traps

- **Args:** `GetPlanetsForChar(charID?)`, `GetItemsInSafetyForCharacter`/`ForCorp` may take an id — capture the retail signature and forward exactly; deliberately try a FOREIGN id for the ownership check. An argless call that needs an id returns empty silently (a 200 is not proof).
- **Wire shapes vary** — decode from **real captured bytes**. IDs stay as data (R7d); ISK/volume bigint-safe; FILETIMEs bigint. PI/asset-safety reads may be CRowset/dict via cachedMethodCall — carry a LOCAL unwrap (the `starmap.ts`/`characterProfile.ts` pattern); **do NOT import from `web/src/bridge/market*.ts`** (separate session owns it).
- **Empty is legitimate** — Farmer having no PI colony, no asset-safety items, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + service you allowlist and un-stale any refusal assertion (keep still-refused writes asserted); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current count), `tsc` + `build:web` clean.
2. Wire each read per the contract; **skip + cite `GetNearbyJumpBridges` if it leaks** (and any other exception). Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each route (real args where needed), capture real bytes, confirm decoders + **ownership-safety with a foreign-id/second-session cross-check on the flagged seams**. Report real shapes + empty-but-legitimate results, and the explicit `GetNearbyJumpBridges` leak verdict. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R71 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls (minus any skipped for leak/no-handler/bound, with reason — expected: `GetNearbyJumpBridges` may be skipped) are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green. **This closes Phase-1 top-level DATA reads.**

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift, predates the sweep). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never from a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check. **Log hygiene:** detached-process log redirection goes to the session scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two; any password. Use a second session for the ownership cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
