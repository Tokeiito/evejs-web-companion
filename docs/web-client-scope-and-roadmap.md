# EveJS Browser Client: Scope, Research, and Roadmap

**Status:** Planning baseline

**Decision date:** 2026-07-12

**Related repositories:** `eve.js` and `evejs-web-poc`

## 1. Goal

Build a text-first, EVE-style browser interface that can perform as much useful EveJS gameplay as is practical without running the retail EVE client.

The browser application should eventually support most docked character management and a focused logistics gameplay loop. Its first true gameplay milestone is an end-to-end courier mission completed through the browser, including agent interaction, cargo handling, undocking, autopilot travel, docking, delivery, and mission completion.

This is an alternate interface to EveJS, not an independent game simulation. EveJS remains authoritative for all state, validation, movement, transactions, and persistence.

## 2. Scope Decisions

The following decisions replace the broader ambitions considered during the initial brainstorm.

### 2.1 Courier missions only

Combat missions are out of scope.

The browser will support courier missions because they exercise valuable non-combat systems:

- agent conversations and mission offers;
- accepting, declining, and completing missions;
- mission journal and objective status;
- mission cargo creation, movement, and delivery;
- route planning and multi-system travel;
- wallet, loyalty point, and standing rewards.

Combat mission support would require a responsive overview, targeting, module control, drones, damage feedback, NPC threat evaluation, and much tighter real-time interaction. The implementation cost and latency sensitivity are not justified for this project.

### 2.2 Autopilot is the space MVP

Initial browser-controlled space activity is limited to travel required for courier gameplay:

- claim exclusive control of an offline character;
- select or activate a ship while docked;
- undock;
- calculate and display a route;
- warp to gates and stations;
- approach gates or stations when required;
- jump between systems;
- dock at the destination;
- pause safely when travel cannot continue.

The autopilot must run inside EveJS. The browser may start, pause, resume, or abort a travel job, but browser timers and polling must not drive ship movement.

Mining is a possible future space interaction, but it is not part of the current roadmap. It should only be reconsidered after autopilot, browser-owned sessions, live state delivery, and reconnect recovery are reliable.

### 2.3 Advanced gameplay is excluded

The following systems are out of scope for the foreseeable future:

- combat missions and general PvE combat;
- PvP combat;
- manual targeting and combat module control;
- drones and fighters in combat;
- probe scanning, directional scanning, and hacking;
- wormhole exploration;
- abyssal gameplay;
- fleet combat and fleet command;
- sovereignty and structure combat;
- advanced manual flight controls;
- graphical space rendering.

These exclusions do not prevent EveJS itself from supporting the systems. They only define what the browser client will attempt to expose.

## 3. Research Findings

### 3.1 Station gameplay is highly viable

EveJS already has authoritative services or runtime modules for most docked activities. Relevant server implementations include:

- inventory listing, item movement, stacking, splitting, fitting, and trashing in `server/src/services/inventory/invBrokerService.js` and `itemStore.js`;
- ship activation, assembly, fitting, and undocking in `server/src/services/ship/shipService.js`;
- market browsing and buy, sell, modify, and cancel operations in `server/src/services/market/marketProxyService.js`;
- mail read, send, labels, read state, trash, and deletion in `server/src/services/mail/mailMgrService.js`;
- industry job installation, completion, and cancellation in `server/src/services/industry/industryManagerService.js`;
- repair, reprocessing, repackaging, and insurance services;
- contracts, including courier collateral and completion flows;
- character skills, fittings, wallet state, standings, corporations, and planetary interaction.

Most of these features need a safe JSON command/query interface and a browser UI, not a new gameplay implementation.

### 3.2 Agent courier mechanics are viable, but content is incomplete

`server/src/services/agent/agentMissionRuntime.js` already contains:

- agent conversation actions;
- mission offer, accept, decline, and completion state;
- courier and fetch objective evaluation;
- mission cargo grants and consumption;
- remote-completion rules;
- ISK, item, loyalty point, and standing rewards;
- mission journal and objective payload generation.

The main mission risk is authored content coverage. The current mission status reports show very limited exact/log-backed mission content, especially above Level 1. The browser can expose whatever courier missions EveJS can currently issue, including placeholder-backed workflows, but browser development does not solve missing mission content.

### 3.3 Autopilot is currently a client-side state machine

The recovered client implementation at:

```text
C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest\eve\client\script\parklife\autopilot.py
```

shows that retail autopilot repeatedly examines route state, session safety, ballpark state, ship mode, distance, gate metadata, and jump state. It then chooses among:

- warp to the next gate or destination;
- approach a nearby target;
- jump through a gate;
- dock at the final station;
- wait for a session transition or ballpark update;
- stop when a restriction or error prevents travel.

EveJS already implements the required low-level operations through `beyonceService.js`, `shipService.js`, `space/runtime.js`, and `space/transitions.js`. The missing piece is an authoritative server-side travel orchestrator that performs the client autopilot loop without relying on a retail client.

### 3.4 Space transitions expect a player session

Undocking, docking, jumping, movement, visibility, and notifications use a session object. The current live session registry treats a TCP socket as proof that a session is alive.

A browser pilot therefore cannot be implemented as a collection of disconnected HTTP calls. EveJS needs a transport-neutral player session abstraction and a browser session adapter that can:

- hold character, ship, corporation, location, and system context;
- attach to and detach from space scenes;
- receive session changes and gameplay notifications;
- translate relevant notifications into browser events;
- remain alive while the browser reconnects;
- participate in the same online-character and duplicate-login rules as a retail client.

### 3.5 The recovered client is a parity reference

The recovered client code should be used to identify workflows, call ordering, arguments, safety checks, confirmation paths, and expected state changes. It should not be copied into the browser application or used as the production runtime.

For each browser workflow:

1. Locate the client UI action and its remote service calls.
2. Locate the corresponding EveJS handlers and underlying runtime functions.
3. Extract or reuse a protocol-independent domain command.
4. Define a typed JSON request and response.
5. Compare behavior with existing parity tests or a captured retail-client call sequence.
6. Add browser-level integration coverage for the complete workflow.

## 4. Required Architecture

```mermaid
flowchart LR
    Browser[Browser UI] --> BFF[Web backend]
    BFF -->|Authenticated HTTP| Gateway[EveJS web gateway]
    Gateway --> Lease[Character lease]
    Gateway --> Commands[Serialized command queue]
    Commands --> Services[Existing EveJS domain services]
    Services --> Memory[Authoritative in-memory state]
    Services --> Space[Space runtime]
    Memory --> Persistence[EveJS SQLite persistence]
    Gateway --> Events[Sequenced WebSocket events]
    Events --> Browser
```

### 4.1 State ownership

- The web application must not read or write gameplay SQLite directly.
- All gameplay reads and writes go through authenticated HTTP requests to EveJS.
- EveJS reads and mutates its authoritative in-memory state.
- EveJS alone decides when state is flushed to SQLite.
- The gateway token is server-to-server and is never exposed to browser JavaScript.

### 4.2 Commands, queries, and events

The EveJS gateway should expose three interfaces:

- **Queries:** versioned JSON projections for characters, inventory, missions, routes, ships, station services, and live travel state.
- **Commands:** validated mutations carrying a character lease, idempotency key, expected state version, and typed payload.
- **Events:** a sequenced WebSocket stream with snapshots and reconnectable deltas.

The gateway should call shared domain functions. It should not invoke `Handle_*` methods directly because those handlers accept retail protocol shapes and may emit TCP-specific notifications.

### 4.3 Exclusive character control

The character has one authoritative control state:

| State | Permitted writer |
| --- | --- |
| Offline | Short companion commands, subject to validation |
| Retail client online | Retail client only |
| Browser pilot active | Commands carrying the active browser lease |

Starting browser pilot mode claims a lease and marks the character online. A retail client login must not run concurrently. It should either reject the login or explicitly terminate the browser lease before attaching the retail session.

Commands are serialized per character to prevent overlapping inventory, market, mission, and travel mutations.

## 5. Autopilot Travel Job

The server-side travel job owns route execution and recovery.

```mermaid
stateDiagram-v2
    [*] --> Docked
    Docked --> Undocking
    Undocking --> InSystem
    InSystem --> WarpingToGate
    WarpingToGate --> ApproachingGate
    ApproachingGate --> Jumping
    Jumping --> InSystem
    InSystem --> WarpingToStation: final system
    WarpingToStation --> ApproachingStation
    ApproachingStation --> Docking
    Docking --> Docked
    Docked --> Completed: destination reached
    InSystem --> Paused: unsafe or blocked
    Jumping --> Paused: transition failure
    Paused --> InSystem: resume
    Paused --> [*]: abort
```

Each travel job records:

- character and ship IDs;
- destination station or solar system;
- complete route and current route index;
- current state and last confirmed location;
- active target gate or station;
- timestamps, retry counts, and last error;
- initiating browser lease;
- whether docking at the final destination is required.

Travel must pause instead of guessing when the ship is scrambled, the route is invalid, a gate is unavailable, a session transition times out, the ship is destroyed, the character loses control, or EveJS restarts without enough state to resume safely.

## 6. Courier Mission MVP

The MVP is complete only when a player can perform this workflow without opening the retail client:

1. Log in with an EveJS account and select an offline character.
2. View available agents and open an agent conversation.
3. Request and accept a courier mission.
4. See the mission briefing, cargo, pickup, destination, reward, and time bonus.
5. Move mission cargo into the active ship when required.
6. Verify the active ship has sufficient cargo capacity.
7. Claim browser pilot control and start the route.
8. Undock and travel through every required gate using server autopilot.
9. Dock at the destination station.
10. Deliver the required cargo.
11. Complete the mission through the agent interface.
12. Observe updated wallet, loyalty points, standings, inventory, and journal state.

The browser should show a compact live travel panel with the current system, next system, target gate or station, travel state, remaining jumps, elapsed time, and actionable failure reason. A map or rendered space scene is not required.

## 7. Delivery Phases

### Goal-mode execution strategy

Each Goal-mode run should implement one independently verifiable unit. A goal must leave both repositories in a working state, update this roadmap with its status and evidence, and stop before beginning the next goal.

Every goal prompt should include:

- one concrete objective;
- explicit in-scope and out-of-scope work;
- required cutover or removal behavior;
- a definition of done;
- targeted verification commands or test expectations;
- instructions to preserve unrelated worktree changes;
- instructions to commit each repository's completed work while forbidding push unless separately requested.

Phase 0 is divided into the following sequential goals:

| Goal | Status | Scope | Depends on | Exit condition |
| --- | --- | --- | --- | --- |
| 0A | Complete | Explicit EveJS runtime-context injection and versioned web-gateway shell | Existing Express secondary | Every web operation uses the authenticated v1 gateway backed by live context, and unversioned routes are absent |
| 0A.1 | Complete | Authoritative gateway runtime façade and fail-closed hardening | 0A | Proxy-only or incomplete mounts cannot load or touch gameplay state; authenticated non-health v1 routes return stable runtime-not-ready responses |
| 0B | Complete | Exclusive character leases and transport-neutral online presence | 0A.1 | Offline, retail-client, and browser-pilot ownership states are authoritative inside EveJS |
| 0C | Complete | Per-character command queue, idempotency, and state-version preconditions | 0B | Duplicate or overlapping web commands cannot apply a mutation twice |
| 0D | Pending | Sequenced browser event stream and reconnect snapshots | 0C | The browser can disconnect and resume from a known event sequence |
| 0E | Pending | Narrow versioned query projections replacing broad snapshots | 0A, 0D | Required pages read bounded DTOs instead of the full character snapshot |
| 0F | Pending | EveJS-backed web authentication and removal of duplicate gameplay credentials | 0E | The web backend authenticates through EveJS and never receives direct database authority |

### Goal 0A execution status — Complete

**Completed:** 2026-07-15

EveJS now creates one frozen runtime-context boundary containing the live `serviceManager`, passes that exact context through the secondary-service loader and existing Express secondary service, and mounts every web endpoint exclusively under `/_evejs-web/v1`. The health route reports API version 1, gateway capabilities, and sanitized runtime-dependency readiness without exposing the manager, request credentials, or other internal objects. A namespace guard returns a gateway-shaped 404 for unversioned and unknown `/_evejs-web` paths before they can reach the generic proxy fallback.

The web backend requires the v1 gateway for account, character, snapshot, skill queue, PI, status, and market behavior. It validates the gateway source and API version on every response and does not retain unversioned aliases, compatibility retries, or a local gameplay-runtime fallback.

Files changed in EveJS:

- `server/index.js`
- `server/src/runtimeContext.js`
- `server/src/secondaryServiceLoader.js`
- `server/src/_secondary/express/server.js`
- `server/src/_secondary/express/evejsWebGateway.js`
- `server/src/_secondary/express/webCompanionBridge.js` (removed)
- `server/tests/planetRestartExtractors.test.js`
- `server/tests/runtimeContextPropagation.test.js`
- `server/tests/webGatewayV1.test.js`

Files changed in the web app:

- `src/eveGatewayClient.js`
- `src/eveBridgeClient.js` (removed)
- `src/eveQueueService.js` (removed)
- `src/eveStore.js`
- `src/marketClient.js`
- `src/server.js`
- `public/app.js`
- `scripts/check.js`
- `test/eveGatewayClient.test.js`
- `test/eveBridgeClient.test.js` (removed)
- `.env.example`
- `README.md`
- `docs/progress.md`
- `docs/goal-prompts/phase-0a-runtime-context-and-gateway.md`
- `package.json`
- `docs/web-client-scope-and-roadmap.md`

Verification evidence:

- EveJS syntax checks passed for all seven scoped source and test files.
- `npm run test:isolated -- server/tests/runtimeContextPropagation.test.js server/tests/webGatewayV1.test.js server/tests/planetRestartExtractors.test.js` passed 13 of 13 tests across three isolated files.
- `npm run test:manifest:check` passed 3 of 3 tests.
- Web-app syntax checks passed for the gateway client, store, market, server, frontend, check script, and focused test.
- `npm test` passed 9 of 9 gateway-only client tests, including the complete v1 URL matrix, rejection of unversioned configuration before fetch, strict failure behavior, source/version validation, ready and not-ready runtime states, and server-side-token handling.
- `npm run check` passed against the temporary live gateway and exercised status, account, character, and character-snapshot reads exclusively through v1.
- A temporary instance of the existing Express secondary service on `127.0.0.1:27602`, using an injected real `ServiceManager`, returned `200` for authenticated v1 health and `401` without the token. The web client's strict `getStatus()` path verified the v1 status and health endpoints over HTTP; all 11 removed unversioned route shapes and an unknown v1 route returned gateway-shaped `404` responses, while malformed JSON and an oversized payload returned versioned `400` and `413` envelopes. The temporary process was stopped and the port was confirmed free afterward.
- `git diff --check` passed in both repositories.

Consciously deferred to later goals: character leases and online-status changes (0B); command execution, serialization, idempotency, and state versions (0C); WebSockets and event streaming (0D); narrow query projections and removal of broad snapshots (0E); and EveJS-backed web authentication (0F). Proxy-only startup remains supported and reports the v1 gateway as present but its EveJS runtime dependency as not ready because that mode intentionally has no live gameplay `serviceManager`.

Goals 0B through 0F should receive their own reviewed prompts after the preceding goal is complete. Do not pre-implement later goals during an earlier run merely because their future interfaces are known.

### Goal 0A.1 execution status — Complete

**Completed:** 2026-07-15

The gateway route module no longer imports `gameStore`, skill-queue runtime, PI runtime, online presence, or the market runtime. The full EveJS startup path constructs a frozen authoritative gateway façade with those live dependencies and injects it through the runtime context. A proxy-only or incomplete mount therefore exposes only authenticated health with `runtime.ready: false`; every authenticated non-health v1 route returns the stable `503 GATEWAY_RUNTIME_NOT_READY` envelope before any façade method can run. Health becomes ready only when the façade contract and every reported dependency are present.

Character-scoped routes now require positive integer `accountID` and `characterID` values. Missing or invalid identity returns `400`, unknown characters return `404`, and ownership mismatch returns `403`; the former zero-ID bypass is gone. Skill-queue and PI mutations still reject online characters before mutation. Unversioned paths remain absent. The web backend propagates `GATEWAY_RUNTIME_NOT_READY` without retry, alternate routes, or gameplay-persistence access.

Implementation evidence:

- EveJS: `server/index.js`, `server/src/runtimeContext.js`, new `server/src/_secondary/express/evejsWebGatewayRuntime.js`, refactored `server/src/_secondary/express/evejsWebGateway.js`, and focused updates in `server/tests/webGatewayV1.test.js` and `server/tests/planetRestartExtractors.test.js`.
- Web app: `src/eveGatewayClient.js` preserves the complete sanitized readiness dependency map, and `test/eveGatewayClient.test.js` proves runtime-not-ready propagation performs exactly one v1 request with no fallback.
- Proxy-only coverage asserts that mounting the route module does not place `gameStore`, skill queue, PI, online-presence, or market runtime modules in `require.cache`.
- Focused EveJS isolated tests passed 16 of 16 tests across `webGatewayV1`, `runtimeContextPropagation`, and `planetRestartExtractors`; web gateway-client tests passed 10 of 10. Syntax and diff checks passed in both repositories.

Character leases and new presence semantics were consciously deferred from 0A.1 to Goal 0B; their completed implementation is recorded below. Command queues, idempotency, state versions, WebSockets, narrow projections, authentication redesign, and new gameplay/UI work remain in their later goals.

### Goal 0B execution status — Complete

**Completed:** 2026-07-15

EveJS now owns the single authoritative character-control model with exactly three public states: `offline`, `retail_client`, and `browser_pilot`. Retail control continues to derive from the existing session registry rather than a second retail-presence store. Browser control is a focused in-memory lease runtime with an injectable clock, randomness, and timers; cryptographically random opaque credentials; a 60-second default TTL; automatic expiry; and claim, renew, and release operations. EveJS retains only the SHA-256 digest of each lease secret, status projections never include credentials, and a fresh runtime starts without leases.

Retail selection, logout, socket disconnect, character clearing, same-socket character changes, closing-socket races, and retail takeover now update that authority through one lifecycle. A closing indexed socket remains authoritative until canonical cleanup, auxiliary cleanup failures cannot strand retail control, and late stale-session events do not create false online edges. Browser-pilot presence feeds online status, corporation-member status, and true social online/offline transitions without constructing a TCP session, joining chat or guest lists, or attaching to space. Character deletion, skill-queue writes, and PI restarts fail closed unless the authority reports `offline`.

The injected v1 gateway façade declares character control as a required dependency and exposes ownership-checked status, claim, renew, and release operations. Status includes only `online`, `controlState`, `transport`, and sanitized lease-expiry metadata; only a successful claim response sent to the web backend contains credentials. Stable conflicts distinguish retail control, browser control, expired credentials, invalid credentials, and unavailable authority. Proxy-only mounts remain authenticated health-only and do not import gameplay runtimes.

Signed web sessions now contain independent cryptorandom session IDs, and the BFF uses that authenticated ID as the controller identity without forwarding the raw cookie. Lease credentials remain in a backend-only, session-and-character-keyed memory store; expiry timers and lazy pruning erase expired secrets while a bounded, secret-free marker preserves the distinct expired-lease error. Authenticated BFF status, claim, renew, and release routes expose only the transport-neutral projection, validate ownership before credential use, and clear invalid or expired local state. Logout best-effort releases every unexpired lease held by that signed session, clears local credentials regardless of release failures, and relies on the EveJS TTL after crashes.

Implementation evidence:

- EveJS: new `server/src/services/online/characterControlRuntime.js`; lifecycle and presence integration in `sessionRegistry`, `characterState`, `charService`, `sessionDisconnect`, `authenticationService`, `onlineStatusRuntime`, `corpMemberQueryState`, and `characterDeletionRuntime`; and v1 façade/route changes in `evejsWebGatewayRuntime` and `evejsWebGateway`.
- EveJS tests: new focused runtime and lifecycle suites plus expanded duplicate-login, logout, online-status, deletion, gateway, skill-queue, and PI coverage.
- Web app: new `src/browserLeaseStore.js`; signed-session, gateway-client, store, server/BFF, frontend error, and test-runner updates; and focused session, store, route, credential-expiry, and gateway-client tests.

Verification evidence:

- Every changed JavaScript file in both repositories passed `node --check`, and `git diff --check` passed in both repositories.
- `npm run test:isolated -- server/tests/characterControlRuntime.test.js server/tests/characterControlLifecycle.test.js server/tests/webGatewayV1.test.js server/tests/characterDuplicateLogin.test.js server/tests/onlineStatusService.test.js server/tests/planetRestartExtractors.test.js server/tests/runtimeContextPropagation.test.js server/tests/authenticationServiceParity.test.js server/tests/sessionRegistryIndex.test.js server/tests/corpAuditMemberParity.test.js server/tests/characterDeletionParity.test.js` passed 60 of 60 tests across 11 isolated files.
- `npm run test:manifest:check` passed 3 of 3 tests, and the web app's full `npm test` passed 29 of 29 tests.
- A final ephemeral cross-stack process used temporary ports `51478` (real EveJS gateway), `51481` (web BFF), and `51491` (proxy-only gateway). The BFF traversed the authenticated real gateway and live authority for offline status, claim, renew, release, and final offline status. The signed session ID—not the raw cookie—reached EveJS as controller identity; credentials stayed in backend memory; no status or browser response exposed a lease ID, secret, controller ID, or credentials object; and release cleared the backend store.
- In the same smoke, unauthenticated full-gateway health returned `401`, authenticated health reported ready with character control, proxy-only health reported `ready: false` with every dependency false, and proxy-only status and claim returned `503 GATEWAY_RUNTIME_NOT_READY`. All three listeners were closed, the test authority was shut down, and the process confirmed zero live listening server handles.

The command work deferred from Goal 0B is now completed in Goal 0C below. Persistent leases, browser space sessions, WebSockets/event replay, travel jobs, broad snapshot replacement, authentication redesign, and substantial UI work remain outside Goal 0B.

### Goal 0C execution status — Complete

**Completed:** 2026-07-15

EveJS now owns one in-memory FIFO command lane per character while allowing different characters to execute independently. Every admitted command uses a strict five-field envelope containing an opaque client command ID, the exact displayed state version, the BFF-supplied controller ID, an explicit registered type, and a normalized typed payload. State versions combine a random runtime epoch with a monotonic per-character revision, advance when an admitted handler starts or character control changes, and make every pre-restart version stale. Completed receipts are globally bounded, contain only normalized fingerprints and sanitized outcomes, and are consulted before stale-version checks so identical in-flight or completed retries cannot rerun a mutation. Command-ID reuse with different normalized data is a stable conflict, and receipt eviction remains safe because the character revision does not roll back.

Authorization is rechecked inside each character lane. Offline companion commands require authoritative `offline` control immediately before invocation, while the runtime also supports browser-pilot commands that validate the active lease at their lane turn. No browser gameplay command was registered in this goal. Skill-queue save and PI extractor restart are now the two strict offline command types; their existing URLs call only the queued façade and retain no direct mutation or precheck bypass. Successful handlers synchronously verify durable flush results. Unexpected post-admission failures are cached and exposed only as canonical `CHARACTER_COMMAND_UNAVAILABLE` 503 outcomes, while narrow allowlists preserve safe skill-queue and PI domain errors. Existing snapshots, mutating-page DTOs, and character-control status now carry the authoritative state version.

The web BFF accepts only a browser command ID, expected version, and typed endpoint payload, then injects the verified signed session ID as controller identity. It never forwards the raw cookie and never exposes the controller, gateway token, lease credentials, command fingerprint, or runtime queue state. Gateway network and 503 retries reuse one byte-identical serialized EveJS envelope. Post-command DTOs come from a fresh authoritative snapshot and retain only sanitized command result metadata.

The browser creates command IDs with secure `crypto.randomUUID()`, retains the exact serialized request after an uncertain network, 503, or malformed-success outcome, rejects concurrent use of the same record, and retries only that same envelope. A response can settle the request only when its typed skill or PI dashboard is complete, belongs to the expected character, pairs matching top-level and dashboard versions, carries a version different from the submitted precondition, and contains the command-specific result marker. Character, page, authentication, view-load, and semantic skill-draft generations prevent delayed completions from overwriting another view or deleting a replacement request. Same-view races reconcile through a latest-only post-settlement reload; changed skill drafts survive, definitive remote domain failures refresh the advanced version, and mismatches reload without discarding the unsaved queue. Logout keeps login unavailable until the response clearing the old session cookie has settled.

Files changed in EveJS:

- `server/src/services/online/characterCommandRuntime.js` (new)
- `server/src/services/online/characterControlRuntime.js`
- `server/src/_secondary/express/evejsWebGatewayRuntime.js`
- `server/src/_secondary/express/evejsWebGateway.js`
- `server/tests/characterCommandRuntime.test.js` (new)
- `server/tests/webGatewayV1.test.js`
- `server/tests/planetRestartExtractors.test.js`

Files changed in the web app:

- `public/commandClient.js` (new)
- `public/mutationScope.js` (new)
- `public/app.js`
- `public/index.html`
- `src/eveGatewayClient.js`
- `src/eveStore.js`
- `src/server.js`
- `test/commandClient.test.js` (new)
- `test/mutationScope.test.js` (new)
- `test/eveStoreCommandDtos.test.js` (new)
- `test/frontendCommandUi.test.js` (new)
- `test/eveGatewayClient.test.js`
- `test/eveStoreControl.test.js`
- `test/serverCharacterControl.test.js`
- `docs/web-client-scope-and-roadmap.md`

Verification evidence:

- Every changed or new JavaScript file passed `node --check`: seven files in EveJS and thirteen files in the web app.
- `npm run test:isolated -- server/tests/characterCommandRuntime.test.js server/tests/characterControlRuntime.test.js server/tests/characterControlLifecycle.test.js server/tests/webGatewayV1.test.js server/tests/planetRestartExtractors.test.js server/tests/runtimeContextPropagation.test.js server/tests/skillQueueAndPlanParity.test.js` passed 59 of 59 tests across seven isolated files.
- `npm run test:manifest:check` passed 3 of 3 tests.
- The web app's full `npm test` passed 68 of 68 tests, including exact-body retry, malformed-success retention, concurrent submission, BFF envelope injection, fresh post-command DTOs, delayed navigation/auth/refresh races, renderer-safe DTO validation, version mismatch draft preservation, and logout-cookie serialization.
- A final ephemeral cross-stack process used `127.0.0.1:58496` for the real EveJS gateway with the actual command runtime and `127.0.0.1:58497` for the actual web BFF with its default store. The first EveJS success was changed to a wire 503; the BFF retried one byte-identical body (SHA-256 `a7a5ccc3bddd33982d077f791a8daeed39f49ff5abb54e551dca99d69cc57569`), the completed receipt replay returned 200 at `smoke-epoch-final.1`, and the handler mutation count remained exactly one. The nested Eve command had exactly the required five keys, used the signed session controller rather than the raw cookie, and returned a paired complete skill DTO without credentials, controller data, token material, or fingerprints.
- Both smoke listeners were closed, the command runtime was shut down, no listeners remained on either port, and the process reported zero live listening `Server` handles.
- A final independent review found no remaining high- or medium-severity Goal 0C issues after the error-sanitization, malformed-response, authentication, delayed-completion, draft-preservation, and reconciliation regressions were addressed.
- `git diff --check` passed in both repositories.

Consciously deferred: command lanes and receipts remain process memory only; the random epoch safely rejects pre-restart versions but cannot replay a receipt across restart. The browser retains an uncertain envelope only for the current application lifetime, so a hard reload requires the user to inspect fresh state before deliberately issuing a new command. Replayed terminal 503 receipts remain unavailable by design rather than risking a duplicate mutation. Concrete browser-pilot gameplay commands, persistent command queues, WebSockets and event replay (Goal 0D), narrow query projections replacing broad snapshots (Goal 0E), EveJS-backed authentication (Goal 0F), travel jobs, and additional gameplay/UI commands remain outside Goal 0C.

The copy/paste prompt for the first run is maintained in [`goal-prompts/phase-0a-runtime-context-and-gateway.md`](goal-prompts/phase-0a-runtime-context-and-gateway.md).

### Phase 0: Gateway foundation

- Replace broad snapshots with versioned query projections.
- Add EveJS-backed web authentication and scoped sessions.
- Introduce character leases and transport-neutral presence.
- Add per-character command serialization and idempotency.
- Add a sequenced WebSocket event stream.
- Pass EveJS runtime and service context into the web gateway.

### Phase 1: Station command coverage

- Inventory move, split, stack, trash, and container operations.
- Ship selection, activation, assembly, fitting, and cargo capacity.
- Mail read, write, read-state, trash, and delete.
- Market buy, sell, modify, cancel, order history, and transactions.
- Industry completion and installation controls.
- Repair, reprocessing, repackaging, and insurance.

Only the inventory and ship operations required by the courier MVP block later phases. The remaining station features can continue incrementally.

### Phase 2: Courier agent interface

- Agent lookup and availability.
- Conversation and action rendering.
- Courier-only mission filtering.
- Mission briefing, objectives, journal, cargo, rewards, and completion.
- Explicit rejection of unsupported combat mission workflows in the browser.

### Phase 3: Browser pilot session

- Claim and release browser control.
- Attach a browser session to EveJS presence and space runtime.
- Undock, receive live state, warp, approach, jump, and dock.
- Recover browser event delivery after a temporary disconnect.
- Block concurrent retail-client control.

### Phase 4: Server autopilot

- Route calculation and destination selection.
- Persistent travel-job state machine.
- Gate and station resolution from authoritative scene data.
- Session-change waiting, retries, pause reasons, resume, and abort.
- Final-station docking.

### Phase 5: End-to-end courier release

- Integrate agent, inventory, ship, travel, wallet, standing, and journal state.
- Add a deterministic test courier mission and route fixture.
- Add integration tests for successful travel, browser reconnect, server restart, blocked travel, lease conflict, and mission completion.
- Add player-facing error recovery and audit history.

### Post-MVP

- Expand station gameplay based on actual usage.
- Improve courier contracts and corporation logistics.
- Add route preferences and avoidance rules.
- Consider mining only after a separate viability review.

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Space code assumes a TCP client session | Introduce a narrow player-session contract and a browser adapter; do not fake a socket throughout the codebase. |
| Browser disconnect interrupts travel | Keep the travel job in EveJS and allow the UI to reconnect to its event sequence. |
| Duplicate commands after retries | Require idempotency keys and persist recent command outcomes. |
| Retail client and browser mutate together | Enforce an authoritative character lease inside EveJS. |
| Autopilot repeats a jump or inventory action | Record confirmed transition state and make each state action idempotent. |
| Mission content is missing or placeholder-backed | Start with one deterministic courier fixture, then expose only supported courier missions. |
| Polling creates lag or stale state | Use server timestamps, snapshots, and sequenced event deltas rather than rapid polling. |
| Gateway bypasses domain rules | Reuse or extract the same domain commands used by retail protocol handlers. |

## 9. Explicit Non-Goals for the MVP

- No combat missions.
- No combat controls.
- No graphical space scene.
- No player-written automation or scripting interface.
- No multi-character simultaneous piloting.
- No advanced exploration, fleet, sovereignty, or structure gameplay.
- No direct gameplay database access from the web process.
- No requirement to reproduce every retail client confirmation or animation.

## 10. Definition of Success

The project has crossed from companion application to browser-playable EveJS when one player can complete a courier mission entirely through the browser, while EveJS remains the sole authority, the character cannot be controlled concurrently by the retail client, and travel safely survives ordinary browser disconnects.

Everything beyond that result is incremental station coverage, courier depth, reliability, and usability rather than a prerequisite for proving the concept.
