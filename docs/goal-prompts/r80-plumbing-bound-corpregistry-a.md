# Goal R80: Plumbing sweep — Phase-2 bound reads: corpRegistry batch A (member/info core) (11)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads — corpRegistry split 1 of 3). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** — refusal lists AND `deepEqual`/"exactly" enumerations) + worklist (`docs/plumbing-worklist.md`, RB-CORPREG). `corpRegistry` bound reads (bound to a **corpID** via `eveMoniker.GetCorpRegistry`). **corpRegistry is 34 reads — this is batch A (11); B and C follow.** Not market files (separate session).

## Phase-2 mechanics — RESOLVE the corpRegistry bind first (corpID-keyed)

`corpRegistry` is bound to a corpID (`eveMoniker.GetCorpRegistry(corpID)`). Grep how the gateway dispatches these reads — a `MachoBindObject`/moniker two-step keyed on corpID, or a top-level `/call` where the corpID is derived from the session vs supplied in args. Wire whatever the gateway actually dispatches on; mirror the established pattern (R74 dogma two-step, R77 planet two-step, R73/R76/R78/R79 top-level). **Confirm exactly how the corpID reaches the handler** — this is the crux of the ownership check.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read — MAXIMUM SCRUTINY (R63 + the 2026-07-22 audit)

This is the highest-leak-risk batch so far. A corp's member roster, tracking (last-login, location), titles, contacts, and bulletins are **private corp intel**. `/api/bridge/call` forwards args verbatim, so if the corpID (or a memberID) is caller-supplied and the handler doesn't verify it against `session.corporationID` / corp roles, an injected foreign corpID leaks that corp's private data. **Expect MANY of these to leak** (the pattern: every id-arg bound batch has flagged leaks; corp reads bound to a foreign corpID are the textbook case).

For EACH read: read the handler + live-probe. Log in `test2` → Test Two (140000002, corp **98000000**); as Farmer (corp **98000001**) inject Test Two's corpID (and memberIDs) via `/api/bridge/call` and see whether you get **corp 98000000's** private member/tracking/title/contact/bulletin data. If yes → arg-injection LEAK: **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (append rows; do NOT de-allowlist — operator's flag-only decision). If the handler derives the corp from `session.corporationID` and ignores a foreign corpID (or role-gates it) → SAFE. `GetEveOwners` (name resolution) is likely PUBLIC → verify. Report the verdict + foreign-corpID evidence per read. **Note per read whether it's role-gated** (director/accountant) — a 403/role-refusal for a normal member is correct server behavior, not a wiring bug.

## This batch — bound READS (grep-confirm each `Handle_*` exists in `corpRegistryRuntime.js`)

`GetInfoWindowDataForChar` (:2960), `GetEveOwners` (:1329), `GetMember` (:1935), `GetMembersPaged` (:1911), `GetMembersByIds` (:1924), `GetMemberTrackingInfo` (:2086), `GetMemberTrackingInfoSimple` (:2101), `GetTitles` (:2110), `GetLabels` (:1419), `GetCorporateContacts` (:1350), `GetBulletins` (:1524).

## Traps

- **Args:** most take a corpID and/or memberID(s). `GetMembersByIds([ids])`, `GetMember(memberID)`, `GetMemberTrackingInfo(...)` — capture the retail signature; forward exactly. Use Farmer's own corp 98000001 for populated bytes, then inject Test Two's corp 98000000 for the leak probe.
- **Wire shapes:** member rows are usually rowsets/dicts of KeyVals; member tracking carries FILETIMEs (last login, bigint) + locationIDs (R7d); shares/roles are bitmask numbers (may be large → bigint). Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — a small corp with few members/titles/bulletins is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed) / role-gated (note the 403); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `corpRegistry` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration (corpRegistry already has `GetCorporation` allowlisted — check its enumerations); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2182), `tsc` + `build:web` clean.
2. Resolve the corpRegistry bind; wire each read per the contract. Tests watched failing first, from real bytes (Farmer corp 98000001). Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read against own corp; capture real bytes; confirm decoders AND the MAXIMUM-SCRUTINY arg-injection check (inject Test Two's corp 98000000 → own/refusal, never corp 98000000's private data). Report real shapes, empty-but-legitimate results, role-gated 403s, and every leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R80 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 11 corpRegistry-A bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF off the corpRegistry bind, decoded from real bytes with tests, each ownership-checked under arg-injection (session-corp-scoped/public/role-gated, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 3316 / web BFF 11912 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001), `test2` → Test Two (140000002, corp 98000000); any password. Use test2's corp for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
