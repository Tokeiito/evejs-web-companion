# Goal R72: Plumbing sweep — gateway-bind reads (the Phase-2 prerequisites) (5)

**Issued:** 2026-07-22 (plumbing sweep — CLOSES Phase-1 top-level reads). **Status:** Ready (fire after R71 lands + is verified). **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (`docs/plumbing-worklist.md`, "Gateway MachoBindObjects wired as top-level reads"). These 5 pairs each return a **bound-object reference (Moniker / boundHandle), not entity data** — they are the two-step gateways every Phase-2 bound-read batch hangs off. Wiring them now unblocks Phase-2.

## What makes this batch DIFFERENT (read carefully)

Unlike every prior read batch, these calls **do not return decodable rows/dicts** — they return a **bound-object handle** (an OID/moniker the client then calls bound methods on). The **deliverable is the allowlist pair + a BFF passthrough that returns the handle envelope intact**, NOT a rich field decoder. The pattern ALREADY EXISTS and works: `invbroker.MachoBindObject` / `GetInventory` / `GetInventoryFromId` are allowlisted and the two-step is wired — **mirror that exact pattern** (the `MachoBindObject` step returns `{boundHandle / OID}`; a follow-up `/call` uses it). `agentMgr.MachoBindObject`, `ship.MachoBindObject`, `charMgr.MachoBindObject`, `beyonce.MachoBindObject`, `reprocessingSvc.MachoBindObject` are also already allowlisted — same shape.

## This batch — top-level gateway reads (grep-confirm each `Handle_*` exists + top-level; skip+report any missing)

- **skillMgr2** (`skillMgr2Service.js`): `GetMySkillHandler` (:8) — returns a **Moniker** for the session's own skill handler; the gateway all RB-SKILL (Phase-2 skills) reads hang off. NOT a MachoBindObject — a `GetXxx` that returns a bound-object reference. Capture the returned moniker/OID.
- **dogmaIM** (`dogmaService.js`): `MachoBindObject` (:9601) — binds the ship/location dogma manager; gateway for RB-DOGMA (GetAllInfo, etc.).
- **entity** (`entityService.js`): `MachoBindObject` (:25) — binds an in-space entity; gateway for WB-ENTITY drone commands (Phase-4) + entity reads.
- **scanMgr** (`scanMgrService.js`): `GetSystemScanMgr` (:1534) — returns the session's system scan-manager bound object; gateway for RB-SCAN.
- **fleetObjectHandler** (`fleetObjectHandlerService.js`): `MachoBindObject` (:106) — binds the fleet object; gateway for RB-FLEET.

## ⚠ Safety focus for a BIND gateway (different from a data read)

A bind gateway does not itself return sensitive fields — but **what it lets you bind matters**. For each, verify with the handler + a live check:
- **Does the bind validate the requested OID/target against session access**, or will it bind an ARBITRARY entity's manager (which would let a Phase-2 bound read pull a rival's data)? The safe shape: `GetMySkillHandler`/`GetSystemScanMgr` derive the target from the **session** (own skills / own system); `MachoBindObject` binds an OID the session must already have access to. If any of these binds an arbitrary foreign OID with no access check, **flag it** (still wire the gateway if the bind is how retail works, but NOTE that the Phase-2 bound reads off it MUST each get a hard R63 ownership check — the leak risk lives on the bound read, not the bind).
- **Do NOT wire any bound METHOD in this batch** — only the gateway pair. The bound reads are Phase-2 (RB-SKILL/RB-DOGMA/RB-SCAN/RB-FLEET), each its own batch with its own ownership check.
- Confirm the **two-step actually works live**: bind → get a handle → a trivial follow-up bound call resolves against it (don't build out the full bound surface — just prove the handle is usable, so Phase-2 can rely on it).

## Traps

- **The BFF passthrough must return the handle/OID envelope intact** (the `invbroker.MachoBindObject` route is the template) — do not "decode" it into fields; a later Phase-2 batch consumes the handle. IDs/OIDs stay as data (R7d), bigint-tolerant.
- **`GetMySkillHandler` is the odd one** — a `GetXxx` returning a moniker, not a `MachoBindObject`. Capture whatever reference it returns; confirm a subsequent `skillMgr.GetSkills`-style bound call could resolve against it (you may prove reachability without wiring the Phase-2 pair).
- A bind may fail if the target isn't present (no fleet → `fleetObjectHandler` bind may error/empty; not in space → `entity` bind may have nothing to bind). Empty/again-legitimate — report it.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads/gateways only — NO bound methods, NO writes**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + service you allowlist and un-stale any refusal assertion (keep still-refused writes/binds asserted); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** OIDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current count), `tsc` + `build:web` clean.
2. Wire each gateway pair per the contract (mirror `invbroker.MachoBindObject`); skip+report exceptions. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, bind via each gateway, confirm a valid handle comes back and the two-step resolves; report the handle shape + which binds are access-gated vs bind-arbitrary-OID (flag the latter for Phase-2). Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R72 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 5 gateway pairs (minus any skipped/no-handler, with reason) are allowlisted (existing handlers), reachable via BFF, each returning a usable bound handle proven by a live two-step — no bound methods wired, no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green. **This CLOSES Phase-1 top-level reads; the next batches are Phase-2 bound reads hanging off these gateways.**

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift, predates the sweep). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never from a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check. **Log hygiene:** detached-process logs go to the scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes against real bytes. Say plainly what you could not see.
