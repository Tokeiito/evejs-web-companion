# Goal R73: Plumbing sweep — Phase-2 bound reads: skills (RB-SKILL) (13)

**Issued:** 2026-07-22 (plumbing sweep, **Phase-2 bound reads — first batch**). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7** un-stale refusal tests) + worklist (`docs/plumbing-worklist.md`, RB-SKILL). These reads hang off the **skill handler** gateway wired in R72 (`skillMgr2.GetMySkillHandler`, session-derived). Skill files only — not market files (separate session).

## Phase-2 mechanics (READ FIRST — different from Phase-1)

R72 wired `skillMgr2.GetMySkillHandler`, which returns a **Moniker** for service **`skillHandler`** bound to `session.characterID` (verified R72: `Moniker("skillHandler", null, 140000005, null)`, session-derived). The Phase-2 skill reads (`GetSkills`, `GetSkillQueue`, …) are calls the retail client issues **against that moniker** — confirm the exact wire path before wiring:
- **Grep how the moniker resolves.** The HANDLERS live in `skillMgrService.js` (`Handle_GetSkills` :317 etc.), but the client/gateway may address service **`skillHandler`** (the moniker name) OR **`skillMgr`**. The allowlist pair must name **whatever service string the gateway dispatch actually sees from the client** — determine it (grep the moniker/monikerService resolution + how `invbroker` bound reads or `agentMgr` bound reads are addressed for the pattern). Wire the pair under the correct service name; if it's a bound two-step (like `invbroker`), mirror that; if the moniker rides top-level `/call` with service `skillHandler`, wire `{skillHandler, <method>}`.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

The moniker binds to `session.characterID`, so these SHOULD be the session's own skills — but **`/api/bridge/call` forwards args verbatim** (`src/server.js:281`), so verify each read is session-scoped **under attacker-chosen args**: does the handler derive the character from the session/moniker, or does it read a caller-supplied `charID` from `args`? For EACH read, read the handler + live-probe: call it as Farmer, then attempt it with a FOREIGN charID injected via `/api/bridge/call` and confirm it returns FARMER's skills (or refuses), never the foreign char's. If any returns a foreign char's skills → it's an arg-injection leak: **keep it plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (per the operator's flag-only decision — do NOT de-allowlist). Skills are private (SP, queue, implants, attributes) — this matters.

## This batch — bound READS off the skill handler (grep-confirm each `Handle_*` exists in `skillMgrService.js`)

`GetSkills` (:317), `GetAllSkills` (:322), `GetAttributes` (:312), `GetSkillHistory` (:280), `GetSkillChangesForISIS` (:297), `GetRespecInfo` (:421), `GetFreeSkillPoints` (:469), `GetBoosters` (:448), `GetImplants` (:453), `CheckInjectionConstraints` (:541), `GetSkillPoints` (:302), `GetDiminishedSpFromInjectors` (:552), `GetSkillQueue` (:275).

## Traps

- **Wire the gateway dependency first** if not already reachable: the BFF needs to obtain the skill-handler moniker (via `GetMySkillHandler`, allowlisted R72) before/while issuing these reads. Mirror how R72's `gatewayBinds` / the `invbroker` two-step or `agentBindSpec` obtains and uses a handle.
- **Args:** `CheckInjectionConstraints`/`GetDiminishedSpFromInjectors` take input (skill type / injector count); `GetSkillHistory` may paginate. Capture the retail signature; forward exactly.
- **Wire shapes:** decode from **real captured bytes**. SP counts are **bigint** (a maxed char exceeds 2^53 — keep as data, never through Number); IDs stay as data (R7d); FILETIMEs bigint. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — an empty skill queue, no boosters/implants, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + service you allowlist and un-stale any refusal assertion; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs/SP kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2066), `tsc` + `build:web` clean.
2. Resolve the moniker/service-name wire path; wire each bound read per the contract. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, obtain the handler, hit each read; capture real bytes; confirm decoders AND run the arg-injection ownership check (foreign-charID injection → own skills or refusal). Report real shapes, empty-but-legitimate results, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R73 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The skill bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF off the R72 skill-handler gateway, decoded from real bytes with tests, each ownership-checked under arg-injection (own skills only, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green. First Phase-2 batch — establishes the bound-read pattern for RB-DOGMA/RB-SCAN/RB-INV/etc.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 51216 / web BFF 33432 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two; any password. Use a second session for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
