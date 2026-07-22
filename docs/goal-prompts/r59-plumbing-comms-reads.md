# Goal R59: Plumbing sweep — comms reads (mail aux, notifications, calendar)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and the canonical worklist (`docs/plumbing-worklist.md`). Batches R-MAILAUX + R-NOTIF + R-CAL. **One-line-grep-confirm each `Handle_<Method>` exists before adding its pair** (the worklist cites are third-hand).

## This batch — top-level READS

**Mail aux** (existing `mailMgr` reads SyncMail/GetMailHeaders/GetBody are already allowlisted — these are the labels + mailing lists):
- `mailMgr.GetLabels` (`mailMgrService.js:398`)
- `mailingListsMgr.GetJoinedLists` (`mailingListsMgrService.js:118`), `GetInfo` (`:124`), `GetMembers` (`:170`), `GetSettings` (`:238`)

**Notifications** (`notifications/notificationMgrService.js`):
- `notificationMgr.GetByGroupID` (`:75`), `GetAllNotifications` (`:61`), `GetUnprocessed` (`:89`)

**Calendar:**
- `calendarMgr.GetResponsesForCharacter` (`calendarMgrService.js:150`), `GetResponsesToEvent` (`:156`)
- `calendarProxy.GetEventList` (`calendarProxyService.js:13`), `GetEventDetails` (`:20`) — **⚠ `calendarProxy` is a `ProxySvc` binding; confirm the proxy dispatch path answers via plain `/call` before adding these two. If it needs a different seam, defer them and note it.**

## Traps (per the worklist + this sweep's history)

- **Verify binding per call** — a Moniker/ProxySvc in the client ≠ plain top-level. `calendarProxy` is the flagged one.
- **Wire shapes vary** (KeyVal / Rowset / list / CachedMethodCallResult) — decode each from **real captured bytes**, not an assumption. R58 found a `CachedMethodCallResult` nesting the payload in a substream and an opaque py2 buffer — expect surprises; use `readRowField`/`readRowsetRows` (now in `wire.ts`) for Rowsets, bigint-tolerant path for longs.
- **Empty is legitimate** — no notifications, no mailing lists, no calendar events for Farmer is a real state, not a bug. Verify the empty path and say so.
- **IDs stay as data** (R7d) — a sender/event/owner ID is a numeric field for later resolution, never forced into a label, never dropped.

## Hard rules

Same as the sweep: **bridge-only, permit existing handlers only** (never a `Handle_*`); skip+report any bound/no-handler/ProxySvc-needs-different-seam call; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics. Never `git add -A`; never push. **Reads only — no writes this pass** (mail/notif/cal all have write siblings; leave them for the writes phase).

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1752/1752**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new BFF route, capture real bytes, confirm the decoder. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R59 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests — no UI, no writes. Snapshot current. Suite green. Report which landed / which skipped (with reasons, esp. `calendarProxy` binding).

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — sixteen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 60744), :26500 web (PID 73304, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS so the running server serves the committed pairs** (detached `Start-Process` with canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, per the process-ownership trap; restart after edit / before commit to avoid pulling the other agent's uncommitted work — verify the pairs are live). Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI in this goal — verification is BFF routes + decoder tests against real bytes. Say plainly what you could not see.
