# Goal R84: Plumbing sweep — Phase-2 bound reads: allianceRegistry batch B (contacts / applications / bills) (7)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads — allianceRegistry split 2 of 2, CLOSES allianceRegistry). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (RB-ALLYREG). **Continues R83's allianceRegistry work (corpRegistry pattern)** — read `docs/goal-prompts/r83-plumbing-bound-alliance-a.md`. Not market files (separate session).

## The established registry pattern (R80–R83 — follow it)

Dispatch TOP-LEVEL (`heldTopLevelCall("allianceRegistry", <method>)`); handlers derive the alliance from the session; **do NOT allowlist `allianceRegistry.MachoBindObject`**. Reads are session-alliance-scoped or public and SAFE; only an explicit allianceID/charID-arg read that returns another entity's private data leaks. R83's 8 were all safe (7 public, 1 session-scoped).

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

`/api/bridge/call` forwards args verbatim. This batch is more PRIVATE-leaning than R83 (contacts, applications, bills = alliance-internal). For EACH read: read the handler + live-probe (inject a foreign allianceID via `/api/bridge/call`). Watch especially:
- **`GetBills` / `GetBillBalance`** — alliance financials are PRIVATE; if a caller allianceID returns another alliance's bills → LEAK.
- **`GetAllianceContacts` / `GetApplications` / `GetBulletins`** — alliance-internal; confirm they derive the alliance from the session and ignore an injected allianceID (or are exec-role-gated).
- `GetCapitalSystemInfo` / `GetPrimeTimeInfo` — alliance config; may be semi-public — confirm.
Any read returning another alliance's private data for an injected id → **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (append rows; do NOT de-allowlist — operator flag-only). Report verdict + foreign-id evidence per read. Note role-gating (exec-role 403 for a normal member is CORRECT). NOTE: Farmer's corp (98000001) is **alliance-less** (R83) — most of these will be empty/null for Farmer; use foreign alliance 99000000 (Elysian) / Test Two's corp 98000000 to capture populated shapes AND to probe the leak (as Farmer, inject 99000000).

## This batch — bound READS (grep-confirm each `Handle_*` exists in `allianceRegistryRuntime.js`)

`GetAllianceContacts` (:553), `GetApplications` (:432), `GetBulletins` (:714), `GetBills` (:895), `GetBillBalance` (:913), `GetCapitalSystemInfo` (:866), `GetPrimeTimeInfo` (:851).

## Traps

- **Args:** `GetBills`/`GetBillBalance`/`GetCapitalSystemInfo` may take an allianceID; `GetApplications` the alliance's incoming corp applications — capture the retail signature; forward exactly; inject a foreign allianceID for the leak probe.
- **Wire shapes:** decode from **real captured bytes**; bill ISK amounts bigint; FILETIMEs (due dates, applications, prime hour) bigint; ids stay data (R7d); prime-time hour a small int. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — Farmer alliance-less → all empty/null; assert it. Populated shapes from the foreign alliance where possible (noted plainly if only fixture-mirrored).

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed) / role-gated (note the 403); DO NOT allowlist `allianceRegistry.MachoBindObject`; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `allianceRegistry` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2253), `tsc` + `build:web` clean.
2. Wire each read top-level per the R83 pattern (no `MachoBindObject`). Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read; capture real bytes; confirm decoders AND the arg-injection check (inject foreign alliance 99000000 → own/empty/refusal, esp. `GetBills`/`GetBillBalance`). Report real shapes, empty-but-legitimate results, and every leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R84 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES allianceRegistry (15/15); only the flagged fleet reads (5) remain in Phase-2.**

## Definition of done

The 7 allianceRegistry-B bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers, `MachoBindObject` NOT among them), reachable via the BFF, decoded from real bytes with tests, each ownership-checked under arg-injection (session-alliance-scoped/public/role-gated, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green. allianceRegistry complete.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 65880 / web BFF 29776 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001), `test2` → Test Two (140000002, corp 98000000); any password. Use test2 / foreign alliance 99000000 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
