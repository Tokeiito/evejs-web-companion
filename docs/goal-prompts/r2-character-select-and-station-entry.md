# Goal R2: Character select → SelectCharacterID → docked station entry (the spot-test milestone)

**Issued:** 2026-07-18 by the orchestrator session. **Depends on:** R1 + R1b complete (bridge route, wire contract, TS/Vite scaffold, signal store). **Status:** Ready to run.

**Re-scoped from the original R2** (character sheet/skills): the operator's first live spot test is *log in → character-selection UI → bring the character online → see the station you're docked in*. This goal builds exactly that critical path on the new stack. The character-sheet/skills page migration moves to a later goal.

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md` (source of truth), `docs/bridge-wire-contract.md` (the wire contract + "how to add a page"), `docs/retail-call-inventory.md` Step 1 tables (char select + docked entry calls). Execute exactly this goal, then stop.

## Objective

1. **eve.js (gateway/interface files + their tests ONLY):** extend the bridge with a **persistent browser-backed session**, so `charUnboundMgr.SelectCharacterID` can bring a character online and subsequent calls run on that live session. Allowlist additions (pairs only): `charUnboundMgr.SelectCharacterID`, `stationSvc.GetStationItemBits`, `station.GetGuests`.
2. **web:** the first real page on the new stack (this is the view-library spike — Svelte 5 is the roadmap's recommendation; lock it unless you hit a concrete blocker, and record the choice): login form → character-selection UI → click a character → docked **station panel** (station name/info, services bits, guests).
3. The whole flow proven by in-process tests end to end; the live run is the operator's spot test (their test character is **Farmer** — tests use fixtures, never that live data).

## Verified background facts

- R1's `/call` route materializes a session **per call**. `Handle_SelectCharacterID` (`character/charService.js:1258`) does ownership + deletion-queue + character-control preflight, then `applyCharacterToSession` (`characterState.js:3946`) and `characterControlRuntime.recordRetailSessionStarted` — it needs a session that **persists after the call** and that carries the parity-test session shape (the 500+ tests under `server/tests/` show the fields and function hooks handlers expect, e.g. `sendServiceNotification`, and session-change machinery may call more — mirror what the parity tests that exercise `Handle_SelectCharacterID` provide).
- Retail call shape (inventory Step 1): `SelectCharacterID(charID, secondChoiceID, skipTutorial)` via `PerformSessionChange('charsel', …)`.
- Docked-entry reads (inventory Step 1, all already Covered): `map.GetStationInfo` (already whitelisted), `stationSvc.GetStationItemBits` (`stationService.js:106`), `station.GetGuests` (`stationService.js:123`). In retail these fire in response to the pushed `OnSessionChanged`; for this goal the page may simply issue them after select-character succeeds (G6 owns push forwarding).
- The character-control runtime treats a started session as the character's controlling client and rejects concurrent retail login — that is the faithful behavior we want; a browser session **is** a client session.

## Design constraints (gateway persistent session)

- Keep it inside `_secondary/express` runtime memory: a session store keyed by an opaque `bridgeSessionID` the gateway mints (e.g. on select-character), mapped to the materialized live session object. `POST /call` accepts an optional `bridgeSessionID` and then uses the stored session instead of materializing one; the BFF keeps the `bridgeSessionID` server-side in its own cookie session — **it must never reach browser JS** (same rule as the gateway token).
- Sessions must end: an idle TTL (generous — this is a dev emulator) plus an explicit release route; on expiry/release, run the same disconnect path a retail socket close runs (`services/_shared/sessionDisconnect.js` — *calling* existing mechanics is bridge glue and allowed; modifying them is not) so the character goes offline and control releases cleanly.
- Notifications captured on the persistent session accumulate; return them on each `/call` response (drain-on-read is fine). Streaming/push is G6, not here.
- `SelectCharacterID` while another client controls the character must surface the handler's own refusal (e.g. control-runtime error) as a typed wire error — do not pre-empt or reimplement the check.

## Required work

1. **Baseline** (record): web `npm test` (expect 142/142); eve.js `npm run test:manifest:check` (3/3), `npm run test:agent-parity` (6/6), and `node scripts/Tests/run-isolated-tests.js server/tests/webGatewayServiceCall.test.js server/tests/webGatewayV1.test.js` (green). eve.js worktree carries other agents' in-flight parity work — leave every bit of it alone; stage only your own files.
2. **eve.js:** persistent-session store + `/call` integration + select/release routes (or select via `/call` with session-minting — your call, document it in the wire contract); the three allowlist pairs; in-process tests (model: `server/tests/webGatewayServiceCall.test.js` + whatever parity test already exercises `Handle_SelectCharacterID` with a fixture world): prove select-character brings the fixture character online on a persistent session, docked reads work on that session, a second select for a retail-controlled character is refused, and release/TTL runs the disconnect path (character offline afterward). Commit early, small, gateway files + tests only. Report hash. **Never push.**
3. **web BFF:** extend `src/eveGatewayClient.js` + `/api/bridge/*` routes for select/release with the `bridgeSessionID` held server-side in the cookie session; login response unchanged.
4. **web page (new stack, under `web/`):** add the view library (Svelte 5 recommended — this is the spike; keep it thin), then build: login form (who-cares semantics, reuse `/api/login`) → character list (typed reference call / login payload) → select → station panel (station name/type from `GetStationInfo`, services from `GetStationItemBits`, guests from `GetGuests`). New store slices + feed events per the "how to add a page" recipe. Serve at `/dist/` like the R1b smoke page. The vanilla app stays untouched and working.
5. **Update `docs/bridge-wire-contract.md`** with the persistent-session contract (routes, `bridgeSessionID` handling, TTL/release, error codes) and the view-lib decision.
6. **Spot-test instructions** for the operator: a short "Spot test (R2)" section in `README.md` — start EveJS + `npm start`, open `/dist/`, log in with the account that owns their test character (any password), click the character, see the station panel. Note anything the operator should expect (e.g. first-paint refresh).
7. Tests green everywhere; commit web work; update roadmap R2 row to Complete with evidence (in-process; live spot test = operator's). Report both hashes.

## Out of scope

- Character sheet/skills page (later goal). Undock/travel (R5), agents (R4), inventory (R3).
- Notification push/streaming (G6). Account auto-create (only if trivially needed for fixtures — not for the operator flow; their account exists).
- Deleting legacy vanilla pages or v1-gateway machinery (R6). Auth/security hardening (roadmap §6).

## Definition of done

- eve.js: persistent browser session lifecycle (mint → use → release/TTL→disconnect) proven in-process with fixtures; the exact five allowlist pairs (two from R1 + three new) and deny-by-default still enforced; footprint = `_secondary/express` + gateway tests; baselines non-regressed. Committed; hash reported; not pushed.
- web: at `/dist/`, login → character select → station panel works against a stubbed/in-process backend in tests; view lib locked and recorded; wire contract + README spot-test section updated; all web tests green. Committed; hash(es) reported; not pushed.
- Roadmap R2 row Complete with evidence phrasing "in-process end-to-end; live spot test pending operator".

## Constraints

- eve.js coordination: other agents are active — small early self-contained commit; stage only your files; never clobber or revert anything of theirs; if your target files have their work in flight, pause and surface it in your report.
- Never start or stop servers/processes you did not start (ports 443, 26000-26003, 26500, 40110 are others'); npm test scripts and Vite builds are fine; leave no dev server running.
- Preserve `_local` gameplay data, web `data/`, icon caches, manifests, ignored credentials. Commit each repo separately; never push.
