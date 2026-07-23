# Goal R87: Plumbing sweep — Phase-3 WRITES: notifications + calendar + bookmarks (W-NOTIF + W-CAL + W-BM) (21)

**Issued:** 2026-07-22 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE (operator direction) — same as R86.** Educated-guess models/responses from client+server code; SKIP heavy testing (basic tests to keep suite green); only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86 write pattern (`docs/goal-prompts/r86-plumbing-writes-mail.md`): allowlist + **confirm-gated BFF POST route** (no `confirm` ⇒ refused; mirror `requireMailConfirmation`/`TrashItems`) + educated-guess decoder + basic test; **un-stale refusal tests/enumerations (heavy)**; NEVER fire destructive writes live. Not market files (separate session).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**notificationMgr (7)** (`notificationMgrService.js`): `MarkGroupAsProcessed` (:97), `MarkAllAsProcessed` (:112), `MarkAsProcessed` (:122), **`DeleteGroupNotifications`** (:132), **`DeleteAllNotifications`** (:149), **`DeleteNotifications`** (:161), `LogNotificationInteraction` (:173).

**calendarMgr (7)** (`calendarMgrService.js`): `CreatePersonalEvent` (:22), `CreateCorporationEvent` (:42), `CreateAllianceEvent` (:59), `EditPersonalEvent` (:76), **`DeleteEvent`** (:100), `SendEventResponse` (:110), `UpdateEventParticipants` (:127).

**accessGroupBookmarkMgr (7)** (`accessGroupBookmarkMgrService.js`): `AddFolder` (:119), `UpdateFolder` (:149), **`DeleteFolder`** (:183), `BookmarkStaticLocation` (:303), `UpdateBookmark` (:379), **`DeleteBookmarks`** (:413), `MoveBookmarksToFolderAndSubfolder` (:436).

**Bold = destructive** — confirm-gate + reachability/refusal only, NEVER fired live. `CreateCorporationEvent`/`CreateAllianceEvent`/`UpdateEventParticipants` may be role-gated (403 for a normal member is correct). NOTE: `accessGroupBookmarkMgr` reads were wired R65 — reuse its BFF route file/pattern.

## Arg-injection note (flag, don't fix)

Writes that mutate a caller-supplied FOREIGN entity (`DeleteEvent(foreignEventID)`, `DeleteBookmarks(foreignFolder)`, `UpdateEventParticipants` on another's event) are the write-side of the arg-injection class. Note + append to `docs/arg-injection-leak-handoff.md` if clearly unguarded; do NOT block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2284), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** for each allowlisted write (grep each method + the 3 service names across `webGateway*.test.js`). Update the snapshot (isolated runner). Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire destructive writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R87 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The notif/calendar/bookmark writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive write fired live, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 43976 / web BFF 59644 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 21 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged + role-gated 403s, (g) servers healthy + did not push + no destructive write fired.
