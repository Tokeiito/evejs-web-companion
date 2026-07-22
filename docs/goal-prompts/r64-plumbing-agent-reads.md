# Goal R64: Plumbing sweep — agent/mission reads

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and worklist (`docs/plumbing-worklist.md`). Batch R-AGENT (`agent/agentMgrService.js`). Chosen to avoid the market decoder (a separate session is fixing it) — this batch touches agent files only.

## ⚠ Ownership-leak check — apply to EVERY read (R63 lesson)

R63 found that `GetMyCharacterStructures` — which the orchestrator labelled "safe" — actually leaked a *different* corp's structure reinforcement calendar (it returns dockable, not owned, structures). **The orchestrator's "safe" hints are hints, not guarantees.** For each read below, capture what it returns **live** and confirm it exposes only (a) the session's own data or (b) genuinely public data. If a read returns another entity's private data, **skip it and cite the reason.** For this batch the risk is low (agent data is public NPC info; the mission journal is the char's own) — but verify, don't assume.

## This batch — top-level READS (`agentMgr`; grep-confirm each `Handle_*` exists + top-level)

- `GetAgentStaticInfo` (:697), `GetSolarSystemOfAgent` (:678), `GetAgentByID` (:1113) — public NPC-agent info; take an `agentID` arg (forward it).
- `GetMissionJournalInfo` (:828) — the character's own mission journal.
- `GetCompletedCareerAgentIDs` (:683), `GetMyEpicArcStatus` (:730) — the character's own progress.
- `GetEntryPoint` (:900), `GetInfoServiceDetails` (:871), `GetDungeonShipRestrictions` (:891) — mission/dungeon detail reads; may take args (agentID / missionID). Forward as the retail signature shows.

`agentMgr.MachoBindObject`/`DoAction`/`GetMissionBriefingInfo`/`GetMissionObjectiveInfo`/`GetMissionKeywords`/`GetAgentLocationWrap`/`GetStandingGainsForMission`/`GetMyJournalDetails` are already allowlisted (R4/R6/R29) — don't re-add.

## Traps

- **Args:** most of these take an `agentID` (or missionID); capture the retail signature from `ClientCodeGrabber` and forward — a zero-arg call returns nothing. Use a real agent Farmer has interacted with (the R6 courier agent 3008416, or the mission-bot's Antaken Kamola) for the live capture.
- **Wire shapes vary** — decode from **real captured bytes** (`readRowField`/`readRowsetRows` as needed); IDs stay as data (R7d); longs bigint-safe.
- **Empty is legitimate** — no epic-arc progress, no completed career agents is a real state.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**ownership-leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1905/1905**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions (leak / no-handler / bound). Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route (real agentID where needed), capture real bytes, confirm decoders + ownership-safety. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R64 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's agent/mission read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes. Snapshot current. Suite green. Report which landed / skipped with reasons.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **A separate session may be editing `web/src/bridge/` market files** — this batch touches agent files only; do not touch the market decoder/panel.
- **Watch new tests fail first** — twenty+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 72216), :26500 web (PID 42612, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker in THIS session** (a separate operator session is fixing the market decoder — stay off market files). Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
