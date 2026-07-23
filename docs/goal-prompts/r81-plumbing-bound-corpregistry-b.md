# Goal R81: Plumbing sweep — Phase-2 bound reads: corpRegistry batch B (shares / applications / welcome mail) (12)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads — corpRegistry split 2 of 3). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** — refusal lists AND `deepEqual`/"exactly" enumerations) + worklist (RB-CORPREG). **Continues R80's corpRegistry work — read `docs/goal-prompts/r80-plumbing-bound-corpregistry-a.md` and the R80 log entry for the ESTABLISHED PATTERN.** Not market files (separate session).

## The established corpRegistry pattern (from R80 — follow it)

R80 proved: corpRegistry reads dispatch **TOP-LEVEL** (`heldTopLevelCall("corpRegistry", <method>)`), the handlers derive the corp from `resolveCorporationID(session)` (session-only), and **`corpRegistry.MachoBindObject` is deliberately NOT allowlisted** so no browser can bind a foreign corp. Result: reads are session-corp-scoped and SAFE; only a read that takes an explicit **charID/shareholderID/ownerID in args** and derives another entity from it leaks. **Do the same here: wire these top-level, do NOT allowlist `MachoBindObject`, and flag only the explicit-id-arg reads.**

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

`/api/bridge/call` forwards args verbatim. For EACH read: read the handler + live-probe (as Farmer, corp 98000001; inject Test Two's corp 98000000 / shareholder / char 140000002 via `/api/bridge/call`). Watch especially:
- **`GetSharesByShareholder(shareholderID)`** — if it takes a caller shareholderID and returns that holder's shareholdings in any corp with no session check → LEAK.
- `GetShareholders`, `GetApplications`, `GetAllianceApplications`, `GetPendingAutoKicks`, `GetMemberIDsByQuery`, `GetMemberIDsWithMoreThanAvgShares`, `GetNumberOfPotentialCEOs`, `GetCorpWelcomeMail` — should derive the corp from `session.corporationID` → verify they ignore an injected corpID.
- `GetMyApplications` / `GetMyOldApplications` — the session char's own applications → verify session-derived.
Any leak → **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (append rows; do NOT de-allowlist — operator's flag-only decision). Note role-gating (director/accountant reads may 403 for a normal member — correct, not a bug). Report verdict + foreign-id evidence per read.

## This batch — bound READS (grep-confirm each `Handle_*` exists in `corpRegistryRuntime.js`)

`GetShareholders` (:2189), `GetSharesByShareholder` (:2175), `GetMemberIDsByQuery` (:2072), `GetMemberIDsWithMoreThanAvgShares` (:2818), `GetPendingAutoKicks` (:2067), `GetNumberOfPotentialCEOs` (:2105), `GetApplications` (:1667), `GetMyApplications` (:1642), `GetMyOldApplications` (:1657), `GetOldApplications` (:1673), `GetAllianceApplications` (:2380), `GetCorpWelcomeMail` (:1816).

## Traps

- **Args:** `GetSharesByShareholder(shareholderID)`, `GetMemberIDsByQuery(...)` take ids/queries — capture the retail signature; forward exactly; inject a foreign id for the leak probe. Applications may be empty for a small corp.
- **Wire shapes:** shares are bitmask/large numbers (bigint); applications carry FILETIMEs (bigint) + applicant charIDs (R7d); welcome mail is a string. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — no shareholders beyond the CEO, no pending applications, no welcome mail set, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed) / role-gated (note the 403); DO NOT allowlist `corpRegistry.MachoBindObject`; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `corpRegistry` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2201), `tsc` + `build:web` clean.
2. Wire each read top-level per the R80 pattern (no `MachoBindObject`). Tests watched failing first, from real bytes (Farmer corp 98000001). Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read; capture real bytes; confirm decoders AND the arg-injection check (inject corp 98000000 / foreign shareholder → own/refusal). Report real shapes, empty-but-legitimate results, role-gated 403s, and every leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R81 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 12 corpRegistry-B bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers, `MachoBindObject` NOT among them), reachable via the BFF, decoded from real bytes with tests, each ownership-checked under arg-injection (session-corp-scoped/role-gated, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 51716 / web BFF 57020 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001), `test2` → Test Two (140000002, corp 98000000); any password. Use test2's corp for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
