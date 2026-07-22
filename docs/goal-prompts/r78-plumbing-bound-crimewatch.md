# Goal R78: Plumbing sweep — Phase-2 bound reads: crimewatch / security status (RB-CRIME) (4)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** — refusal lists AND `deepEqual`/"exactly" enumerations) + worklist (`docs/plumbing-worklist.md`, RB-CRIME). `crimewatch` bound reads (bound Moniker, `CharGetCrimewatchLocation`). Crimewatch files only — not market files (separate session).

## Phase-2 mechanics — RESOLVE the crimewatch bind first

`crimewatch` is a bound service (worklist: "bound Moniker (CharGetCrimewatchLocation)"). Grep how the retail client obtains the crimewatch moniker/bind and how the gateway dispatches these reads — a top-level `Get*`/`CharGet*` returning the moniker, or a `MachoBindObject` two-step. Wire whatever the gateway actually dispatches on; mirror the established pattern (R73 skillHandler moniker, R74 dogma two-step, R76 jumpCloneSvc top-level, R77 planetMgr two-step). Confirm the exact service string.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

`/api/bridge/call` forwards args verbatim. Verify each under attacker-chosen args:
- `GetMySecurityStatus`, `GetClientStates`, `GetSecurityStatusTransactions` — the SESSION's own security status / criminal-flag states / sec-change history. Confirm session-derived (no charID override); `GetSecurityStatusTransactions` history is private.
- `GetCharacterSecurityStatus(charID)` — takes a charID → returns that char's security status. **In EVE a character's security status is PUBLIC** (rendered on every overview), so returning any char's sec status is likely SAFE/public — but CONFIRM the handler returns ONLY the public sec-status float, not private crimewatch state (timers, kill rights, suspect/criminal flags tied to that char). If it exposes private per-char crimewatch state for a foreign charID → LEAK: **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (do NOT de-allowlist — operator's flag-only decision). Report the guard/scoping per read with a foreign-charID cross-check.

## This batch — bound READS (grep-confirm each `Handle_*` exists in `crimewatchService.js`)

`GetClientStates` (:56), `GetMySecurityStatus` (:82), `GetCharacterSecurityStatus` (:98), `GetSecurityStatusTransactions` (:116).

## Traps

- **Args:** `GetCharacterSecurityStatus(charID)` takes a charID; the others are session-scoped/argless. Capture the retail signature; forward exactly. For the ownership check, probe `GetCharacterSecurityStatus` with a foreign charID (expected public) and confirm the others reject/ignore a foreign charID.
- **Wire shapes:** sec status is a **float** (−10.0..+5.0); transaction rows carry FILETIMEs (bigint) + sec deltas (floats); IDs stay as data (R7d). Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — no recent sec transactions, clean criminal state is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `crimewatch` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2152), `tsc` + `build:web` clean.
2. Resolve the crimewatch bind; wire each read per the contract. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests + enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read; capture real bytes; confirm decoders AND the arg-injection check (`GetCharacterSecurityStatus` foreign charID → public-only; others session-scoped). Report real shapes, empty-but-legitimate results, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R78 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The crimewatch bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF, decoded from real bytes with tests, each ownership-checked under arg-injection (session-scoped/public, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 66764 / web BFF 52236 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password. Use test2 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
