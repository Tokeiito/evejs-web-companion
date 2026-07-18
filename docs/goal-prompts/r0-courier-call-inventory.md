# Goal R0: Courier-path retail call inventory

**Issued:** 2026-07-18 by the orchestrator session. **Status:** Ready to run.

You are a worker session. Read `docs/web-client-scope-and-roadmap.md` in this repository first — it is the source of truth. Execute exactly this goal, then stop.

## Objective

Produce a checked-in manifest that maps every courier-path UI action to the exact retail service calls the EVE client makes, cross-checked against EveJS's server handlers. This manifest is the specification the R1+ bridge and pages will be built from.

## Repositories

- Web client (commit here): `C:\Users\ryanf\Documents\GitHub\evejs-web-poc` (branch `master`)
- EveJS server (READ-ONLY this goal): `C:\Users\ryanf\Documents\GitHub\eve.js` (branch `main`)
- Decompiled retail client (the spec, read-only): `C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest`

## Verified background facts (2026-07-18)

- The decompiled client expresses every server call as `sm.RemoteSvc('<service>').Method(*args, **kwargs)` (server tier) or `sm.ProxySvc('<service>').Method(...)` (proxy tier). `sm.GetService(...)` is client-local and never crosses the wire. Mine the `.py` files only (`.pyc`/`.pyj` are redundant binaries).
- EveJS dispatches retail calls via `serviceManager.lookup(service).callMethod(method, args, session, kwargs)` → `Handle_<method>(args, session, kwargs)`, implemented across ~200 service files under `eve.js\server\src\services\`.
- Some client flows call methods on **bound objects** returned by a service (e.g. inventory bindings from `invbroker`); EveJS's `packetDispatcher.js` auto-registers returned OIDs. Record these two-step patterns explicitly — the bridge must support them.
- Retail autopilot is a client-side loop: `Latest\eve\client\script\parklife\autopilot.py`. Its server calls (warp, approach, jump, dock) are exactly what the server-owned travel job must issue.

## Required work

1. **Re-establish the test baseline** before any changes: run the EveJS focused test suite and the web full test suite (do not start the game server or web server). Record the counts in the manifest header. Last known: EveJS 65/65 focused + 3/3 manifest checks, web 105/105, on 2026-07-15.
2. **Mine the decompiled client** for the call sequences behind each courier-path area, following the 12-step milestone in roadmap section 7:
   - character select and entering the station view (e.g. `charMgr`, `charUnboundMgr`, character/station info calls);
   - station hangar and assets (`invbroker` and its bound inventory objects; item move/stack/split);
   - ship selection, boarding/activation, cargo capacity;
   - agent discovery, conversation, courier mission offer/accept/decline/complete (`agentMgr` and mission/journal services);
   - undock, warp, approach, jump, dock (autopilot.py's call set; `beyonce`/ship/station services);
   - post-completion state: wallet, loyalty points, standings, journal.
3. **For each mined call**, record: tier (RemoteSvc/ProxySvc/bound object), service name, method name, argument names/shapes as visible at the call site, client source file and line, what UI action triggers it, and its position in the flow.
4. **Cross-check EveJS coverage**: for each (service, method), find the matching `Handle_<method>` in `eve.js\server\src\services\` and record file:line, or mark it missing/partial. Flag any gap that blocks R1–R6.
5. **Write the manifest** to `docs/retail-call-inventory.md` in the web repo, organized by the 12 milestone steps, with a summary table of coverage gaps at the top.
6. **Update the roadmap**: set the R0 row to Complete with a one-line evidence pointer to the manifest.

## Out of scope

- Any change to `eve.js` (read-only this goal).
- Any change to web application code (`src/`, `public/`) — this goal is docs only.
- Implementing the bridge, login changes, or any UI work.
- Exhaustively inventorying non-courier services (mail, market, fitting, chat, ...) — note them only if they appear inside courier flows.

## Definition of done

- `docs/retail-call-inventory.md` exists, covers all 12 milestone steps, and every entry carries a client file reference and an EveJS coverage verdict.
- Test baseline counts recorded; both repos left in working state; eve.js worktree untouched.
- Roadmap R0 row updated. Web repo committed (single commit for this goal). Commit hash reported. **Do not push.**

## Constraints

- Preserve all unrelated worktree changes in both repos; never reset or revert anything.
- Never start or stop servers or processes you did not start; ports 443, 26000, 26001, 26002, 26003, 26500, 40110 belong to other processes.
- Do not delete or rewrite `_local` gameplay data, web `data/`, icon caches, manifests, or ignored credentials.
- Security hardening is out of scope by policy (roadmap section 6) — do not raise or fix security findings.
