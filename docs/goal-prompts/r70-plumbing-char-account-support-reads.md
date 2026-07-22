# Goal R70: Plumbing sweep — character / account / support reads (16)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready (fire after R69 lands + is verified). **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** un-stale refusal tests) + worklist (`docs/plumbing-worklist.md`). Batches **R-CHAR2 (charUnboundMgr) + R-PET (petitioner) + the charMgr straggler**. Char/account/support files only — **not** market files (separate session).

## ⚠ Ownership-leak check per read (R63, MANDATORY). Verify LIVE; skip+cite any leak.

Several of these could return another entity's data — verify each against a foreign id / second session before allowlisting:
- **`charUnboundMgr.GetCharacterInfo`** — if it takes a **charID** and returns an ARBITRARY character's private info, that's a LEAK (the PUBLIC read is the already-wired `charMgr.GetPublicInfo`). Confirm it's the account's OWN char, or genuinely public. Same scrutiny for `GetCharacterLockType`, `GetCohortsForUser` (account-scoped?).
- **`charMgr.GetRecentShipKillsAndLosses`** — session's own killboard, or does it take a charID and return anyone's? Confirm session-scoped (or that a killboard is public data).
- **`petitioner.GetMyPetitionsEx` / `GetPetitionMessages` / `GetUnreadMessages`** — the session's OWN support tickets. Confirm no foreign-petition access (a ticket id that isn't yours must not return its messages).
- **`petitioner.GetZendeskJwtLink`** — ⚠ returns a **signed JWT / auth link for the session's own support account**. It is session-scoped (fine to plumb) but the token is a CREDENTIAL: the decoder must pass it through WITHOUT logging it, and it must never be cached or exposed cross-session. Treat like a secret. Confirm it is derived from the session, never a caller-supplied identity.

The char-creation helpers (`GetValidRandomName`, `ValidateNameEx`, `GetQAStarterSystemIDs`, `GetNumCharacters`) and `petitioner.GetCategories` / `GetCategoryHierarchicalInfo` / `MayPetition` / `IsZendeskEnabled` are config/account-scoped — low risk, still verify.

## This batch — top-level READS (grep-confirm each `Handle_*` exists + top-level; skip+report any missing/bound)

- **charUnboundMgr** (`eve.js/server/src/services/**/charService.js`): `GetCohortsForUser` (:1191), `GetCharacterLockType` (:1511), `GetNumCharacters` (:1107), `GetCharacterInfo` (:1248), `GetValidRandomName` (:1468), `ValidateNameEx` (:1501), `GetQAStarterSystemIDs` (:1474).
- **petitioner** (`petitionerService.js`): `GetMyPetitionsEx` (:136), `GetCategories` (:158), `GetCategoryHierarchicalInfo` (:163), `GetPetitionMessages` (:219), `MayPetition` (:195), `IsZendeskEnabled` (:103), `GetZendeskJwtLink` (:118), `GetUnreadMessages` (:124).
- **charMgr straggler** (`charMgrService.js`): `GetRecentShipKillsAndLosses` (:559).

## Traps

- **Args:** `GetCharacterInfo(charID?)`, `ValidateNameEx(name)`, `GetValidRandomName(...)`, `GetPetitionMessages(petitionID)` take inputs — capture the retail signature and forward exactly; an argless call that needs an id returns empty silently (a 200 is not proof). For the ownership check, deliberately try a FOREIGN charID/petitionID and confirm it does NOT return that entity's data.
- **Wire shapes vary** — decode from **real captured bytes**. IDs stay as data (R7d); FILETIMEs bigint. `GetZendeskJwtLink` returns a string token — pass through, do not parse/log it.
- **Empty is legitimate** — Farmer having filed no petition (`GetMyPetitionsEx` []), no recent kills/losses, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + service you allowlist and un-stale any refusal assertion (keep still-refused writes asserted); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current count), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each route (real args where needed), capture real bytes, confirm decoders + **ownership-safety on the flagged seams with a foreign-id/second-session cross-check**. Confirm `GetZendeskJwtLink` is session-derived and its token is never logged. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R70 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls (minus any skipped for leak/no-handler/bound, with reason) are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes, market files untouched. `GetZendeskJwtLink` confirmed session-scoped + token not logged. Snapshot current, per-service refusal tests un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift, predates the sweep). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never from a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check. **Log hygiene:** any detached-process log redirection goes to the session scratchpad, NOT the repo root (`logs-bff-*.log` is gitignored but don't add clutter).
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two; any password. Use a second session for the ownership cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
