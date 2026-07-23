# Goal R82: Plumbing sweep — Phase-2 bound reads: corpRegistry batch C (kills / settings / checks) (11)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads — corpRegistry split 3 of 3, CLOSES corpRegistry). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (RB-CORPREG). **Continues the R80/R81 corpRegistry pattern** — read those two goal prompts + their log entries. Not market files (separate session).

## The established corpRegistry pattern (from R80/R81 — follow it)

Dispatch TOP-LEVEL (`heldTopLevelCall("corpRegistry", <method>)`); handlers derive the corp from `resolveCorporationID(session)` (session-only); **do NOT allowlist `corpRegistry.MachoBindObject`**. Reads are session-corp-scoped and SAFE; only a read taking an explicit corpID/charID/ownerID in args and deriving another entity from it leaks (R80 flagged `GetInfoWindowDataForChar`, R81 flagged `GetShareholders`).

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

`/api/bridge/call` forwards args verbatim. For EACH read: read the handler + live-probe (as Farmer corp 98000001, inject Test Two's corp 98000000 / char 140000002). Watch especially:
- **`GetRecentKills` / `GetRecentLosses`** — do they take a caller corpID and return that corp's killboard? (Corp kills/losses are semi-public in EVE, but confirm whether the handler returns another corp's private board for an injected corpID → if it exposes more than public killboard data, flag.)
- **`CharGetAllyBaseCost`** — may take a target/defender id (war ally cost) → verify it's a public cost calc, not private data.
- `GetAggressionSettings`, `GetStructureReinforceDefault`, `DoesMyCorpAcceptStructures`, `DoesCorpRestrictCorpMails`, `CanLeaveCurrentCorporation`, `CanBeKickedOut`, `GetSuggestedTickerNames`, `GetSuggestedAllianceShortNames` — session-corp settings/checks/name-suggestions → verify they ignore an injected corpID (the `Suggested*` reads likely take no corp at all).
Any leak → **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (append rows; do NOT de-allowlist — operator flag-only). Report verdict + foreign-id evidence per read.

## This batch — bound READS (grep-confirm each `Handle_*` exists in `corpRegistryRuntime.js`)

`GetRecentKills` (:2922), `GetRecentLosses` (:2941), `GetAggressionSettings` (:2615), `GetSuggestedTickerNames` (:2497), `GetSuggestedAllianceShortNames` (:2503), `GetStructureReinforceDefault` (:2691), `DoesMyCorpAcceptStructures` (:2659), `DoesCorpRestrictCorpMails` (:2675), `CanLeaveCurrentCorporation` (:2743), `CanBeKickedOut` (:2760), `CharGetAllyBaseCost` (:2716).

## Traps

- **Args:** `GetRecentKills`/`GetRecentLosses` (corpID?), `CharGetAllyBaseCost` (target id?) — capture the retail signature; forward exactly; inject a foreign id for the leak probe. Most of the Does*/Can*/Suggested* reads are argless or session-only.
- **Wire shapes:** kill/loss rows carry FILETIMEs (bigint) + ISK values (bigint) + type/char ids (R7d); Does*/Can* are booleans; ally base cost is ISK (bigint); Suggested* are string lists. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — no recent corp kills/losses, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed) / role-gated (note the 403); DO NOT allowlist `corpRegistry.MachoBindObject`; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `corpRegistry` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2221), `tsc` + `build:web` clean.
2. Wire each read top-level per the R80/R81 pattern (no `MachoBindObject`). Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read; capture real bytes; confirm decoders AND the arg-injection check (inject corp 98000000 → own/refusal). Report real shapes, empty-but-legitimate results, and every leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R82 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES corpRegistry (34/34); next is `allianceRegistry`.**

## Definition of done

The 11 corpRegistry-C bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers, `MachoBindObject` NOT among them), reachable via the BFF, decoded from real bytes with tests, each ownership-checked under arg-injection (session-corp-scoped/public, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green. corpRegistry complete.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 71740 / web BFF 22340 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001), `test2` → Test Two (140000002, corp 98000000); any password. Use test2's corp for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
