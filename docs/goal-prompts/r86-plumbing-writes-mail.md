# Goal R86: Plumbing sweep — Phase-3 WRITES: mail + mailing lists (W-MAIL + W-MLIST) (16)

**Issued:** 2026-07-22 (plumbing sweep, **Phase-3 top-level WRITES — first writes batch**). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES MODE (operator direction 2026-07-22): GO FAST. This is plumbing that will be implemented/QA'd correctly later.** Use EDUCATED GUESSES for models/responses from the client + server code (writes usually return `null`/a simple ack/the updated state — don't exhaustively capture real bytes). **SKIP heavy testing** — basic tests to keep the suite green, but do NOT do the reads-era fail-first-every-assertion + live-trigger-and-reread grind. **Only plumb writes whose server `Handle_*` EXISTS** — grep-confirm each; if the handler is missing, SKIP + report (we have all the client calls, but only implement what the server has).

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) + worklist (`docs/plumbing-worklist.md` W-MAIL + W-MLIST + the WRITES CONTRACT section). Not market files (separate session).

## The WRITES contract (SAFETY — keep even in fast mode)

1. **Allowlist pair** (existing `Handle_*` only). 2. **BFF POST route with a CONFIRM-GATE** — mirror the existing `TrashItems`/`dockAt` write pattern in `src/server.js`: the route REFUSES unless the browser passes an explicit `confirm` (no confirm ⇒ 4xx refusal, no dispatch). 3. **Educated-guess response decoder** (usually a pass-through ack / null). 4. **Basic test** (keep the suite green; a route-refuses-without-confirm test + a decoder shape test is enough — no exhaustive fail-first). 5. Update the `webGatewayServiceCall` snapshot + **un-stale refusal tests** (see below). 6. **NEVER FIRE the destructive/financial happy-path on the live world** — verify only that the route is reachable and refuses without confirm; do NOT actually delete mail / empty trash. Safe/reversible writes (MarkAsRead, labels) MAY be triggered-and-reverted if trivial, but it's optional in fast mode.

## ⚠ STEP-7 IS NOW HEAVY (writes were asserted-REFUSED across the suite)

The reads sweep kept writes refused, so many `server/tests/webGateway*.test.js` files assert these mail/mailingLists WRITES are refused (`webGatewayMail`, `webGatewayServiceCall` deny-lists, per-service refusal loops, `deepEqual` enumerations). For EVERY write you allowlist: `grep -rn "<Method>"` + `grep -rn "mailMgr"`/`"mailingListsMgr"` across all `webGateway*.test.js`; **remove the now-allowlisted write from every refusal assertion / add it to every allowed-surface enumeration**, and confirm each affected file green via the isolated runner. This is the bulk of the work now — do NOT skip it (a stale refusal = RED suite).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report any missing)

**mailMgr (13)** (`mailMgrService.js`): `MoveToTrash` (:220), `MoveFromTrash` (:231), `MarkAsRead` (:190), `MarkAsUnread` (:205), **`DeleteMail`** (:387, destructive), **`EmptyTrash`** (:376, permanent-delete), `CreateLabel` (:408), `EditLabel` (:427), `DeleteLabel` (:435), `AssignLabels` (:440), `RemoveLabels` (:454), `MarkAllAsRead` (:331), `MoveAllToTrash` (:242).

**mailingListsMgr (3)** (`mailingListsMgrService.js`): `Join` (:143), `Leave` (:151), `Create` (:132).

**Bold = destructive** — confirm-gate + reachability/refusal only, NEVER fired live.

## Arg-injection note (flag, don't fix)

A write that mutates a caller-supplied FOREIGN entity (e.g. `DeleteMail(someoneElsesMailID)`, `Join(listID)` for a list you're not invited to) is the write-side of the arg-injection class. In fast mode: note it in the return report + append to `docs/arg-injection-leak-handoff.md` if clearly unguarded, but do NOT block on exhaustive proof — the server-side fix + QA come later. Keep it plumbed (operator flag-only).

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive/financial live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2279), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** for each allowlisted write (heavy). Update the snapshot (isolated runner). Restart EveJS; smoke-check each route refuses-without-confirm (reachability + refusal path — do NOT fire destructive writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R86 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The mail/mailingLists writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive write fired live, no UI, market files untouched. Fast mode: educated guesses OK, heavy live-verification skipped (QA later).

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 17220 / web BFF 37664 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 16 writes landed / skipped (missing-handler reason), (b) the confirm-gate pattern used + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled (the heavy part), (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no destructive write fired.
