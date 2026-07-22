# Goal R77: Plumbing sweep — Phase-2 bound reads: planetary industry (RB-PI) (7)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7 — now also covers `deepEqual`/"exactly-this-set" enumerations, not just refusal lists**) + worklist (`docs/plumbing-worklist.md`, RB-PI). `planetMgr` bound reads (bound to a planetID). The top-level `planetMgr.GetPlanetsForChar`/`GetMyLaunchesDetails` are already wired (R71). Planet files only — not market files (separate session).

## Phase-2 mechanics — RESOLVE the per-planet bind first

`planetMgr` is top-level for the two colony-list reads (R71), but the per-planet reads bind to a **planetID**. Grep how the retail client obtains the planet bind / how the gateway dispatches these (a `MachoBindObject` two-step, a `GetPlanet` moniker, or a top-level `/call` with a planetID arg). Wire whatever the gateway actually dispatches on; mirror the established pattern. Confirm the service string + how the planetID is supplied.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY, HIGH SCRUTINY)

PI colony layout (pins, extractors, routes, resource programs) is **private** — a rival reading your colony is real intel. `/api/bridge/call` forwards args verbatim, so these planetID/ownerID args are prime leak vectors. For EACH read, read the handler + live-probe with a FOREIGN planetID / ownerID (second account `test2` → Test Two 140000002):
- `GetFullNetworkForOwner` — the **"ForOwner" name is a red flag**: does it take an ownerID and return THAT owner's full PI network with no session check? If so → LEAK.
- `GetPlanetInfo` / `GetPlanetResourceInfo` / `GetResourceData` / `GetCommandPinsForPlanet` / `GetExtractorsForPlanet` / `GetProgramResultInfo` — do they verify the planetID's colony belongs to the session char, or return any colony's pins/extractors for an injected planetID?
Farmer owns colony **planetID 40009077** (captured R71). As Farmer, inject a foreign planetID/ownerID; if the handler returns another character's colony data → arg-injection LEAK: **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (append rows; do NOT de-allowlist — operator's flag-only decision). If session/ownership-scoped or the data is static planet geography (GetResourceData may be static per-planet resource distribution, public) → SAFE. Report the guard (or its absence) per read with foreign-id evidence. **Expect some of these to leak** — bound reads with id args have surfaced leaks in every batch (R75 inventory: 3).

## This batch — bound READS (grep-confirm each `Handle_*` exists in `planetMgrService.js`)

`GetPlanetInfo` (:954), `GetPlanetResourceInfo` (:965), `GetResourceData` (:979), `GetFullNetworkForOwner` (:1039), `GetCommandPinsForPlanet` (:1056), `GetExtractorsForPlanet` (:1074), `GetProgramResultInfo` (:1270).

## Traps

- **Args:** each takes a planetID (and `GetFullNetworkForOwner` an ownerID; `GetProgramResultInfo` maybe a program/pin id). Capture the retail signature; forward exactly. Use Farmer's real planetID 40009077 to get populated bytes.
- **Wire shapes:** decode from **real captured bytes** — PI networks are nested (pins, links, routes, extractor heads). IDs/pinIDs stay as data (R7d); quantities/cycle-times may be large → bigint-safe; FILETIMEs (extractor expiry) bigint. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — a planet with no colony, an owner with no PI, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `planetMgr` and un-stale any refusal assertion OR `deepEqual`/"exactly" enumeration; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2136), `tsc` + `build:web` clean.
2. Resolve the planet bind; wire each read per the contract. Tests watched failing first, from real bytes (use Farmer's colony 40009077). Snapshot updated; per-service refusal tests AND enumerations un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read against colony 40009077; capture real bytes; confirm decoders AND run the HIGH-SCRUTINY arg-injection check (foreign planetID/ownerID → own/refusal, esp. `GetFullNetworkForOwner`). Report real shapes, empty-but-legitimate results, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R77 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The PI bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF, decoded from real bytes with tests, each ownership-checked under arg-injection (session-scoped, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests + enumerations un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 60516 / web BFF 52884 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password. Use test2 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
