# Goal R57: Plumbing sweep — top-level reads (fittings, kill rights, LP)

**Issued:** 2026-07-22 (operator: *"go and do all plumbing, so we can set up the UI easier later"*). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

First batch of the plumbing sweep. The operator wants the **API calls wired** — reachable and decodable — so building UI later is easy. **No panels, no tabs, no store slices** this pass; just the pipe.

## THE PLUMBING CONTRACT (every batch in this sweep follows this — reads)

For each read call:
1. **Allowlist pair** in `eve.js/server/src/_secondary/express/evejsWebGatewayRuntime.js`, existing handler only, with a one-line justification comment.
2. **BFF passthrough** in `src/server.js` — a `GET /api/bridge/<name>` route that issues the held-session call and returns the raw result envelope (independent `Promise.allSettled` if a route batches several reads; empty≠failed).
3. **Bridge decoder** in a `web/src/bridge/<name>.ts` — built **from REAL captured bytes**, not a guessed shape (my briefs have guessed wrong repeatedly; capture the truth). Use `readRowField` (R32) for Rowset/packedrow, the bigint-tolerant path for large IDs/FILETIMEs.
4. **Unit tests** for the decoder (watched failing first), against the real captured shape. A BFF-route test if practical.
5. **NO UI, NO store slice, NO panel, NO tab.** The decoder + route are the deliverable. UI comes in a later goal.
6. **R7d at the decoder level:** the decoder must expose names/labels or leave IDs as fields a future UI will resolve — but do not build rendering here. Just don't lose the data.

Then update `webGatewayServiceCall.test.js`'s allowlist snapshot (isolated runner) and restart EveJS.

7. **Un-stale every per-service refusal test (MANDATORY — a whole R67 batch was spent cleaning this up).** The central snapshot is NOT the only place that asserts what's refused. Several `server/tests/webGateway*.test.js` files (e.g. `webGatewayContracts`, `webGatewayAgentMgr`, `webGatewayCourierComplete`, `webGatewayMail`) carry their OWN hardcoded "these methods are refused / this service is out of slice" lists. For **every** method/service you allowlist, `grep -rn "<Method>"` and `grep -rn "<serviceName>"` across `server/tests/webGateway*.test.js`; if any test asserts it refused/out-of-slice, update that assertion (remove the now-allowed READ; keep the still-refused WRITES asserted — never weaken a still-valid refusal). Run every affected file via the isolated runner and confirm green before committing. Skipping this leaves the suite RED and silently claims "bridge-only held" while a test is failing.

## This batch — top-level READS (all handlers confirmed to exist)

- **`charFittingMgr.GetFittings`** — the saved fitting library (distinct from our active-ship fit). Handler in `eve.js/server/src/services/fitting/charFittingMgrService.js` (`super("charFittingMgr")`). Top-level.
- **`bountyProxy.GetMyKillRights`** — `eve.js/server/src/services/bounty/bountyProxyService.js:500`. Top-level.
- **`LPSvc.GetLPExchangeRates`**, **`LPSvc.GetAvailableOffersFromCorp`**, **`LPSvc.GetLPsForCharacter`** — the LP store reads (we already have `GetAllMyCharacterWalletLPBalances` allowlisted). Handlers in `eve.js/server/src/services/corporation/lpService.js`. Top-level.

**Verify each handler exists and its real binding before adding the pair** — if any turns out to be bound, or the handler isn't there, skip it and report rather than guessing. Confirm `charFittingMgr` vs `corpFittingMgr` vs `allianceFittingMgr` (three distinct services — this batch is the CHAR one only).

## Traps (from `docs/api-coverage-plan.md`)

- **Bound vs top-level is per-service.** These are believed top-level; confirm each (a Moniker in the client = bound). A bound call needs the `MachoBindObject` two-step, not plain `/call` — if one is bound, defer it to the bound-reads batch and note it.
- **Rowset / bare-string bigint / CRowset** — decode against the real shape; don't assume.
- **Data seeding may be sparse** — an empty LP-offer list or no saved fittings is a legitimate state, not a bug. Verify the empty path and say so if that's all the data there is.

## Hard rules

- **Bridge-only server surface — PERMIT existing handlers only.** eve.js changes restricted to `server/src/_secondary/express/*` + tests; NEVER a `Handle_*` implementation. If a call has no handler, skip and report (do not fill the gap). Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — commit pairs by pathspec onto the tip without disturbing their staged/untracked work; verify `git status` after. Never `git add -A`. Never push.
- **A 200 is not proof** — verify wire shapes against real bytes.
- **Do not chase game mechanics.**

## Invariants

**R7d** the decoder must not force an ID into a would-be label (leave IDs as data for later resolution) · **R18** `panelFirstMount` unaffected (no new panels) — must stay green.

## Required work

1. Baseline: combined `node --test` (expect **1694/1694**), `tsc` + `build:web` clean.
2. Wire each read per the contract. Tests watched failing first. Update the allowlist snapshot (isolated runner: `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`).
3. **Verify live:** `rrfarmer` → Farmer, hit each new BFF route, capture the real bytes, confirm the decoder matches. Report the real shapes and any empty-but-legitimate results. Keep the session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; add the roadmap R57 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls are allowlisted (existing handlers), reachable via BFF routes, and decoded from real bytes with tests — no UI. The allowlist snapshot is current. Suite green. Report exactly which pairs landed and any that were skipped (bound / no-handler) with the reason.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; `webGatewayServiceCall` needs the ISOLATED runner (bare `node --test` on it fails a gameStore guard — not a real failure); rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — fourteen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 51788), :26500 web (PID 51096, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs, so you MUST restart EveJS after committing them.** Own the process; set no `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker** (a read-only enumeration workflow is also running — it touches nothing). Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password; login returns a `sessionToken`.
- **Browser pane:** SPA at `/`; async panel content never flushes — but this goal has no UI, so verification is purely the BFF routes + decoder tests against real bytes. Say plainly what you could not see.
