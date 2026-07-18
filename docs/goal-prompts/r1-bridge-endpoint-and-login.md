# Goal R1: Thin bridge endpoint + who-cares web login

**Issued:** 2026-07-18 by the orchestrator session. **Amended (v2)** the same day after review: the TS + Vite scaffold moved to its own goal (R1b); the allowlist seed, session wire contract, login semantics, and DoD were sharpened. **Status:** Ready to run.

You are a worker session. Read `docs/web-client-scope-and-roadmap.md` (source of truth) and `docs/retail-call-inventory.md` (the courier call spec, produced by R0) first. Execute exactly this goal, then stop.

## Objective

Stand up the transport seam that lets the browser drive **real EveJS `Handle_*` calls**:

1. Extend the **existing** EveJS web gateway with a **deny-by-default, whitelisted** `(service, method, args, kwargs) → callMethod` invocation path, executed against a **gateway-materialized browser-backed session**. This is the *only* eve.js edit in the whole roadmap — gateway/interface files (plus their test) only, **no game-mechanics change**.
2. **Who-cares web login**: any password — including empty — logs into an **existing** EveJS account (see login semantics below).
3. **Prove it end to end** with in-process tests, and via the live app if a server happens to be running.

The TS + Vite scaffold and client-state store are **not** in this goal (they are Goal R1b). All web-side code in R1 stays plain CommonJS/vanilla, consistent with the existing BFF.

## Repositories

- **Web client (commit here):** `C:\Users\ryanf\Documents\GitHub\evejs-web-poc` (branch `master`).
- **EveJS server — WRITABLE THIS GOAL, gateway files + their test ONLY:** `C:\Users\ryanf\Documents\GitHub\eve.js` (branch `main`). **Other agents are actively working this repo.** Keep your change small, land it as an early self-contained commit, keep the worktree otherwise clean.
- **Decompiled retail client (spec, read-only):** `C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest`.

## Verified background facts (from R0 + orchestrator review)

- **Dispatch seam:** `serviceManager.lookup(service).callMethod(method, args, session, kwargs)` → `Handle_<method>(args, session, kwargs)` (`server/src/services/baseService.js`, `serviceManager.js`).
- **Sessions are duck-typed:** handlers accept a plain object with the right fields. The parity tests under `server/tests/` invoke `Handle_*` with hand-built plain-object sessions and no socket.
- **The web gateway already exists:** `server/src/_secondary/express/evejsWebGateway.js` (+ `evejsWebGatewayRuntime.js`), HTTP/WS on **:26002** at `/_evejs-web/v1` — a secondary Express interface, entirely separate from machoNet (:26000). `serviceManager` is already a declared gateway dependency (`evejsWebGateway.js:71`). **Model for your new test: `server/tests/webGatewayV1.test.js`** (in-process gateway tests already exist). New tests must follow `doc/TEST_RULEBOOK.md`; run `npm run test:manifest:check` after adding the test file.
- **The BFF already talks to the gateway:** `src/eveGatewayClient.js` (CommonJS; `EVEJS_GATEWAY_URL` default `http://127.0.0.1:26002/_evejs-web/v1`; optional `EVEJS_WEB_GATEWAY_TOKEN`). Existing web login: `src/webAuth.js` + `/api/login` in `src/server.js`. Event stream client: `public/eventClient.js`.
- **Reference end-to-end call (safe, read-only, courier-path):** `charUnboundMgr.GetCharacterSelectionData()` → `Handle_GetCharacterSelectionData` at `character/charService.js:595`. **It reads `session.userid`** (`charService.js:604`) — your browser-backed session must carry it. (`map.GetStationInfo` → `map/mapService.js:601` is the approved second whitelist entry.)

## The allowlist (read carefully — this was a review blocker)

- The allowlist is a set of explicit **(service, method) pairs**. **Never whitelist a whole service.** Concrete hazard: service-granular whitelisting of `charUnboundMgr` would expose `Handle_DeleteCharacter` / `Handle_PrepareCharacterForDelete` — destructive mutations in a goal whose proof is read-only.
- **R1 seed = exactly these read-only pairs:** `charUnboundMgr.GetCharacterSelectionData` and `map.GetStationInfo`. Nothing else. Later goals extend the list pair-by-pair from the inventory's step tables (not from its appendix, which maps services to files without methods).
- The allowlist is **scope control** (keep the bridge narrow and faithful), **not** a security measure — no auth hardening (roadmap §6).

## The session wire contract (review blocker — build it exactly this way)

- A live session object cannot cross HTTP. **The gateway materializes the browser-backed session server-side.** The BFF sends only JSON: the account/character identifiers and session fields (`userid`, and later `characterID`/`charid`, `stationid`, …). The gateway builds the duck-typed session object around them — including a `sendServiceNotification` capture hook — and passes it to `callMethod`.
- Captured notifications: return them in the call response (a `notifications` array) for now; full event-channel forwarding is R4/G6 — do not build it out here.
- **Document the request/response schema** (route, JSON fields, error shape, notification array) in a short new file `docs/bridge-wire-contract.md` in the web repo. R2+ builds on this contract; it must be written down, not implied by code.

## Login semantics (who-cares, precisely)

- `/api/login` accepts an existing EveJS account username with **any password, including empty** — the password is not checked at all. The scrypt check is **bypassed, not deleted**: leave `src/webAuth.js`, `data/web-users.json`, and `npm run webpass` in place and untouched (data-preservation rule); a deprecation comment is fine.
- **Unknown usernames: return a clear 401** ("unknown EveJS account") in R1. Account auto-create (the `devAutoCreateAccounts` analogue) is deferred to R2 alongside `SelectCharacterID` — do not add account-creation routes to eve.js here.

## Required work

1. **Baseline first** (record counts): web `npm test` (expect 105/105); eve.js `npm run test:manifest:check` (expect 3/3) and `npm run test:agent-parity` (expect 5/6 files — **4 known pre-existing `agentMissionRuntime.test.js` failures; do not fix them, a separate G3 goal owns that**). Confirm both worktrees start clean; note (and don't touch) anything already in flight.
2. **eve.js — the gateway `callMethod` path (do this first; commit it early and small):**
   - In `evejsWebGateway.js` (+ runtime as needed): a route taking `(service, method, args, kwargs)` + session-fields JSON; allowlist check on the (service, method) pair (deny by default); materialize the browser-backed session; `serviceManager.lookup(service).callMethod(method, args, session, kwargs)`; return the result + captured notifications.
   - **An eve.js in-process test** (model: `server/tests/webGatewayV1.test.js`): drives `charUnboundMgr.GetCharacterSelectionData` through the new path with a plain browser-backed session, asserts a real result, asserts an off-allowlist call (e.g. `charUnboundMgr.DeleteCharacter`) is refused, and asserts an unknown service/method is refused. The footprint rule is: **`_secondary/express` files + this test file under `server/tests/` — nothing else.**
   - Commit in eve.js — separate, early, tightly scoped (e.g. `feat(web-gateway): whitelisted callMethod bridge path`). Report the hash. Do **not** push.
3. **web — who-cares login + BFF bridge client:**
   - Rework `/api/login` per the login semantics above; resolve the account and its characters via the gateway.
   - Extend `src/eveGatewayClient.js` (or a CommonJS sibling) with a `callMethod(service, method, args, kwargs, sessionFields)` client for the new route, and expose a thin BFF API route the frontend can call (R1b's TS client will consume this same route later).
   - After login, the existing vanilla frontend drives the reference call and renders the live character-selection result (a minimal panel/section is enough).
   - Web-side tests: the callMethod client against a stubbed gateway; the login-accepts-anything and unknown-username-401 behaviors. "Existing app keeps working" is proven by `npm test` staying green — do not start servers (port 26500 belongs to other processes).
4. **Commit the web work.** Report hash(es). Do **not** push.
5. **Update the roadmap:** set the R1 row to Complete with evidence phrased as "in-process end-to-end test; live browser round-trip [demonstrated / not available this session]". Report both repo hashes.

## Out of scope

- TS, Vite, the client-state store (R1b). Any page migration or view library (R2).
- Bringing a character online (`SelectCharacterID`), account auto-create, station/inventory/agent/travel flows — R2+.
- Notification event-channel forwarding build-out (G6), autopilot/travel (R5).
- Fixing the 4 known `agentMissionRuntime.test.js` failures (separate G3 goal).
- Any game-mechanics change in eve.js. Auth hardening or security gates (roadmap §6).

## Definition of done

- **eve.js:** gateway exposes the deny-by-default whitelisted `callMethod` path against a gateway-materialized browser-backed session; off-allowlist and unknown calls are refused; the in-process test proves the reference call end to end; footprint = `_secondary/express` + the one test file; **no regressions vs the recorded baseline** (manifest 3/3; agent-parity still 5/6 with the same 4 known failures). Committed separately, early; hash reported; not pushed.
- **web:** any password (incl. empty) logs into an existing account; unknown username → 401; the BFF `callMethod` client + route work against a stubbed gateway in tests; the vanilla frontend renders the reference call's live result when a server is available; `docs/bridge-wire-contract.md` exists; web `npm test` green (105 + your new tests). Committed; hash(es) reported; not pushed.
- Roadmap R1 row set to Complete with the evidence phrasing above. Both repo hashes reported.

## Constraints

- **eve.js coordination (other agents are active):** small, early, self-contained commit; never revert, reset, or clobber others' work or uncommitted changes; if a file you need has someone's work in flight, pause and surface it. Commit eve.js and web **separately**; **never push**.
- Preserve all unrelated worktree changes in both repos.
- Never start or stop servers/processes you did not start; ports 443, 26000, 26001, 26002, 26003, 26500, 40110 belong to other processes.
- Do not delete or rewrite `_local` gameplay data, web `data/`, icon caches, manifests, or ignored credentials.
- Security hardening is out of scope by policy (roadmap §6); the allowlist is not a security control.
