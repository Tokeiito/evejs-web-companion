# Goal R1: Thin bridge endpoint + who-cares web login

**Issued:** 2026-07-18 by the orchestrator session. **Status:** Ready to run.

You are a worker session. Read `docs/web-client-scope-and-roadmap.md` (source of truth) and `docs/retail-call-inventory.md` (the courier call spec, produced by R0) first. Execute exactly this goal, then stop.

## Objective

Stand up the transport seam that lets the browser drive **real EveJS `Handle_*` calls**, and put the web app on the TypeScript + Vite foundation the R2–R6 migration will use. Concretely:

1. Extend the **existing** EveJS web gateway with a **deny-by-default, whitelisted** `(service, method, args, kwargs) → callMethod` invocation path, executed against a **browser-backed session**. This is the *only* eve.js edit in the whole roadmap — interface/gateway files only, **no game-mechanics change**.
2. **Who-cares web login**: any username + any password logs in (matching the emulator, roadmap §6).
3. **Prove it end to end**: after login, the browser drives at least one real, whitelisted, **read-only** `Handle_*` call through the gateway and renders the live result.
4. Establish the web-app **TS + Vite scaffold** and a **framework-agnostic client-state store skeleton** — foundation only: no page migration, existing `app.js` keeps working, and the view library (Svelte vs Solid) stays deferred to the R2 spike.

## Repositories

- **Web client (commit here):** `C:\Users\ryanf\Documents\GitHub\evejs-web-poc` (branch `master`).
- **EveJS server — WRITABLE THIS GOAL, gateway/interface files ONLY:** `C:\Users\ryanf\Documents\GitHub\eve.js` (branch `main`). **Other agents are actively working this repo.** Keep your change small and confined to the web gateway, land it as an early self-contained commit, and keep the worktree otherwise clean so you stay out of their way.
- **Decompiled retail client (spec, read-only):** `C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest`.
- **The call spec / whitelist source:** `docs/retail-call-inventory.md` — its appendix maps the courier-path client service names to EveJS files; seed the allowlist from there.

## Verified background facts (from R0)

- **Dispatch seam:** `serviceManager.lookup(service).callMethod(method, args, session, kwargs)` → `Handle_<method>(args, session, kwargs)` (`server/src/services/baseService.js`, `serviceManager.js`). This one call is the entire retail dispatch below the wire protocol.
- **Sessions are duck-typed:** handlers accept a plain object with the right fields (`characterID`/`charid`, `shipid`, `stationid`, `sendServiceNotification`, …). The 500+ parity tests under `server/tests/` invoke `Handle_*` directly with hand-built plain-object sessions and no socket. A browser-backed session is exactly such an object.
- **The web gateway already exists:** `server/src/_secondary/express/evejsWebGateway.js` (+ `evejsWebGatewayRuntime.js`), HTTP/WS on **:26002** at `/_evejs-web/v1`. It is a **secondary Express interface, entirely separate from the machoNet game server (:26000)** that retail clients use. Today it serves broad `/snapshot` + `eveStore` emulation — **not** a `callMethod` path.
- **The BFF already talks to it:** `src/eveGatewayClient.js` (`EVEJS_GATEWAY_URL`, default `http://127.0.0.1:26002/_evejs-web/v1`; optional `EVEJS_WEB_GATEWAY_TOKEN`). Existing web login is `src/webAuth.js` (a separate, ignored password store); leases `src/browserLeaseStore.js`; event stream `src/eventClient.js`.
- **Reference end-to-end call (safe, read-only, courier-path):** `charUnboundMgr.GetCharacterSelectionData()` → `character/charService.js:595`, returns the account's character list. Ideal R1 proof: who-cares login → gateway `callMethod` → render the real character list. (`map.GetStationInfo` is a fine alternative.)

## Required work

1. **Baseline first** (record counts): web `npm test`; EveJS `npm run test:manifest:check` plus a focused slice. eve.js is writable now, so confirm a clean starting point and note anything already in flight (do not touch it).
2. **eve.js — the gateway `callMethod` path (do this first; commit it early and small):**
   - In `evejsWebGateway.js` (+ runtime), add a route that takes `(service, method, args, kwargs)`, resolves the service via `serviceManager.lookup`, checks `(service, method)` against an **explicit allowlist (deny by default)**, and invokes `service.callMethod(method, args, browserSession, kwargs)`; return the marshaled result. If a handler emits `sendServiceNotification`, capture it on the session and forward it over the gateway's existing event channel where practical; otherwise record the gap for R4/G6 (do not build notification forwarding out fully here).
   - Seed the allowlist from the manifest appendix (the courier-path services), at minimum the reference call. **The allowlist is scope-control** (keep the bridge narrow and faithful), **not** a security measure — do not add auth hardening (roadmap §6).
   - **Interface-only:** do not modify any `Handle_*` or other game-mechanics/service logic. The change lives entirely in `_secondary/express`. Retail clients on machoNet (:26000) must be provably unaffected.
   - Commit in eve.js — separate, early, tightly scoped (e.g. `feat(web-gateway): whitelisted callMethod bridge path`). Report the hash. Do **not** push.
3. **web — who-cares login + browser-backed session:**
   - Accept any username + any password. Resolve the EveJS account + character mapping (via the gateway) and construct a **browser-backed session object** (duck-typed) that the gateway uses for `callMethod`. Reuse `webAuth.js` / `browserLeaseStore.js` where sensible.
4. **web — transport client + end-to-end proof:**
   - Add a `callMethod` client (extend `src/eveGatewayClient.js` or a sibling) that hits the new gateway route. After login, drive the reference call and render the real result. This is the DoD proof (see the note on test level below).
5. **web — TS + Vite scaffold (foundation only, no migration):**
   - Add Vite + TypeScript (dev/build scripts). Author the new `callMethod` client and a **framework-agnostic client-state store skeleton** (plain signals) in TS. Do **not** migrate existing pages and do **not** add the view library — that is the R2 spike. The existing vanilla `public/app.js` keeps working.
   - Add/adjust tests for the `callMethod` client and who-cares login.
6. **Commit the web work** (a single web commit is fine, or a few focused ones). Report hash(es). Do **not** push.
7. **Update the roadmap:** set the R1 row to Complete with a one-line evidence pointer. Report both repo hashes.

### Proving end-to-end without starting servers

You may **not** start servers/processes you did not start (ports below belong to others), and the live browser round-trip needs EveJS reachable on :26002. So make the **primary DoD proof an automated test** at the tightest honest level:
- An **eve.js-side test** that drives the reference real `Handle_*` through the new gateway invocation function with a plain browser-backed session and the allowlist enforced (no socket — same style as the parity tests); assert a real result and that an off-allowlist call is refused.
- A **web-side test** of the `callMethod` client against an in-process / stubbed gateway.
- If the EveJS server is already running on :26002 (started by others), also demonstrate the live browser round-trip — but treat that as a bonus, not a requirement.

## Out of scope

- Any game-mechanics change in eve.js (`Handle_*` / service logic). Gateway/interface files only.
- Bringing a character online (`SelectCharacterID`) and the station / inventory / agent / travel flows — R2+.
- Migrating existing pages to the new stack or choosing the view library — R2.
- Notification-forwarding build-out (G6), autopilot/travel (R5).
- Auth hardening, token schemes, security gates (roadmap §6).

## Definition of done

- **eve.js:** the web gateway exposes a deny-by-default whitelisted `callMethod` path against a browser-backed session; off-allowlist calls are refused; no game-mechanics files touched; EveJS focused/manifest tests still pass (retail path unaffected). Committed separately, early, tightly scoped; hash reported; not pushed.
- **web:** any username + any password logs in; an automated test drives the reference real `Handle_*` end to end through the gateway (and the browser renders it live if a server is available); TS + Vite scaffold + client-state store skeleton in place with the existing app still working; tests green. Committed; hash(es) reported; not pushed.
- Roadmap R1 row set to Complete with an evidence pointer. Both repo hashes reported.

## Constraints

- **eve.js coordination (other agents are active here):** keep the change small and confined to the gateway/interface; land it as an **early, self-contained commit** and keep the eve.js worktree otherwise clean so you are out of others' way; **never revert, reset, or clobber** others' work or uncommitted changes; if a file you need has others' work in flight, pause and surface it rather than overwrite. Commit eve.js and web **separately**; report both hashes; **never push**.
- Preserve all unrelated worktree changes in both repos.
- Never start or stop servers/processes you did not start; ports 443, 26000, 26001, 26002, 26003, 26500, 40110 belong to other processes.
- Do not delete or rewrite `_local` gameplay data, web `data/`, icon caches, manifests, or ignored credentials.
- Security hardening is out of scope by policy (roadmap §6) — do not raise or fix security findings, and do not treat the allowlist as a security control.
