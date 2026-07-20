# Bridge wire contract (v1) — whitelisted `callMethod` path

**Status:** Active, established by goal R1 (2026-07-18); extended by goal R2 (persistent browser-backed sessions, same date), goal R3 (2026-07-19, the bound-object bridge — see "Bound-object bridge (R3)"), goal R4 (agents/missions + deferred call responses), goal R5a (2026-07-19, the space bridge — see "Space bridge & session-into-space (R5a)"), goal R5b (2026-07-19, the client-side route solver + browser autopilot decide-loop — see "Client-side route solver & browser autopilot (R5b)"), goal R6 (2026-07-19, courier completion + the Step-12 reward readout — see "Courier completion & reward readout (R6)"), goal R6a (2026-07-19, the Agent Finder — a static agent-list route + client-side jump-distance sort; see "Agent Finder static route (R6a)"), and goal R7 (2026-07-19, Local + Corp chat — presence/read/send for the browser session; see "Local + Corp chat (R7)"). Later goals build on this contract; change it deliberately and update this file with the change.

This is the transport seam that lets the browser drive real EveJS `Handle_*` calls. The unit it mirrors is the retail call tuple **(service, method, args, kwargs)**; the gateway dispatches it through the same seam a retail client hits: `serviceManager.lookup(service).callMethod(method, args, session, kwargs)`.

```
browser --POST /api/bridge/call--> web BFF --POST /_evejs-web/v1/call--> EveJS gateway --callMethod--> Handle_<method>
```

## Gateway route (eve.js)

`POST http://<evejs-host>:26002/_evejs-web/v1/call`

Authorization is the existing gateway rule: tokenless requests are accepted from loopback only; otherwise the `x-evejs-web-token` header (or `Authorization: Bearer`) must match `EVEJS_WEB_GATEWAY_TOKEN`.

### Request body (JSON)

```json
{
  "service": "charUnboundMgr",
  "method": "GetCharacterSelectionData",
  "args": [],
  "kwargs": null,
  "session": { "userid": 4 }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `service` | string, required | Retail service name (`sm.RemoteSvc('<service>')`). |
| `method` | string, required | Retail method name; dispatches to `Handle_<method>`. |
| `args` | array, optional (default `[]`) | Positional args, retail-shaped. |
| `kwargs` | object or null, optional (default `null`) | Keyword args, retail-shaped. |
| `session` | object, required in practice | JSON **scalars only** (string/number/boolean/null). `userid` (positive integer) is required. |
| `bridgeSessionID` | string, optional (R2) | Opaque persistent-session handle from `session/select`. When present the call runs on the **stored live session** (the `session.userid` must match the session's owner, else `SESSION_NOT_FOUND`); when absent the call runs on a per-call materialized session exactly as in R1. |

**A live session object never crosses HTTP.** The gateway materializes the duck-typed browser-backed session server-side around the supplied scalars — the same plain-object session shape the parity tests hand to `Handle_*` — and attaches a `sendServiceNotification` capture hook.

### The allowlist (deny by default)

Only explicit **(service, method) pairs** dispatch; everything else — including other methods on an allowlisted service, and unknown services — is refused with `CALL_NOT_ALLOWED` **before any service lookup**. Never allowlist a whole service (that would expose destructive siblings like `charUnboundMgr.DeleteCharacter`). The allowlist is scope control, not a security measure (roadmap section 6).

Current pairs (defined in `eve.js` `server/src/_secondary/express/evejsWebGatewayRuntime.js`, `WEB_CALL_ALLOWLIST`):

| service | method | since |
| --- | --- | --- |
| `charUnboundMgr` | `GetCharacterSelectionData` | R1 |
| `charUnboundMgr` | `SelectCharacterID` | R2 (dispatched by `session/select`) |
| `map` | `GetStationInfo` | R1 |
| `station` | `GetGuests` | R2 |
| `stationSvc` | `GetStationItemBits` | R2 |
| `invbroker` | `MachoBindObject` | R3 (bind) |
| `invbroker` | `GetInventory` | R3 (bind) |
| `invbroker` | `GetInventoryFromId` | R3 (bind) |
| `invbroker` | `List` | R3 (bound method) |
| `invbroker` | `Add` | R3 (bound method) |
| `invbroker` | `MultiMerge` | R3 (bound method) |
| `invbroker` | `StackAll` | R3 (bound method) |
| `invbroker` | `GetCapacity` | R3 (bound method) |
| `ship` | `MachoBindObject` | R3 (bind) |
| `ship` | `Board` | R3 (bound method) |
| `agentMgr` | `GetAgents` | R4 (top-level station roster) |
| `agentMgr` | `MachoBindObject` | R4 (bind the agent moniker) |
| `agentMgr` | `DoAction` | R4 (bound: open convo / accept / decline) |
| `agentMgr` | `GetMissionBriefingInfo` | R4 (bound briefing read) |
| `agentMgr` | `GetMissionObjectiveInfo` | R4 (bound courier cargo/pickup/dropoff) |
| `agentMgr` | `GetMissionKeywords` | R4 (bound keyword substitution) |
| `agentMgr` | `GetAgentLocationWrap` | R4 (bound agent-location header) |
| `agentMgr` | `GetStandingGainsForMission` | R4 (bound standing preview) |
| `agentMgr` | `GetMyJournalDetails` | R4 (top-level or bound journal) |
| `ship` | `Undock` | R5a (undock — top-level docked call) |
| `beyonce` | `MachoBindObject` | R5a (bind the remote park) |
| `beyonce` | `CmdWarpToStuffAutopilot` | R5a (bound: warp to a gate/celestial) |
| `beyonce` | `CmdWarpToStuff` | R5a (bound: manual "warp to" with minRange) |
| `beyonce` | `CmdSetSpeedFraction` | R5a (bound: approach speed) |
| `beyonce` | `CmdFollowBall` | R5a (bound: approach/follow) |
| `beyonce` | `CmdStargateJump` | R5a (bound: jump — changes system) |
| `beyonce` | `CmdDock` | R5a (bound: dock — returns to a station) |
| `beyonce` | `CmdOrbit` | R13 (bound: orbit a target at a range) |
| `beyonce` | `CmdAlignTo` | R13 (bound: align — **kwargs only**) |
| `beyonce` | `CmdStop` | R13 (bound: stop — no arguments) |
| `structureJumpBridgeMgr` | `CmdJumpThroughStructureStargate` | R5a (server-tier Upwell jump-gate parity) |
| `account` | `GetCashBalance` | R6 (Step-12 wallet read — personal `GetCashBalance(0)`) |
| `LPSvc` | `GetAllMyCharacterWalletLPBalances` | R6 (Step-12 loyalty-point read) |
| `standingMgr` | `GetCharStandings` | R6 (Step-12 character standings read) |
| `invbroker` | `ListByFlags` | R12 (bound: read what is fitted, per slot flag) |
| `invbroker` | `DestroyFitting` | R12 (bound: **destroy** a rig — irreversible) |
| `dogmaIM` | `ShipGetInfo` | R12 (top-level: the ship's dogma attributes) |
| `dogmaIM` | `ShipOnlineModules` | R12 (top-level: which fitted modules are online) |
| `dogmaIM` | `SetModuleOnline` | R12 (top-level: bring a module online) |
| `dogmaIM` | `TakeModuleOffline` | R12 (top-level: take a module offline) |

R12 adds **no** fit/unfit pair: fitting and unfitting are `invbroker.Add` with a
slot flag, already listed for R3. `dogmaIM.GetAllInfo` is deliberately **not**
listed even though it would serve the same read — it is the session bootstrap
call and fires post-response side effects (`afterCallResponse` → post-GetAllInfo
charge refresh, post-undock dogma multi-event, character dogma state sync), and
a panel refresh must not replay a session bootstrap.

Deny-by-default governs **bound-object methods too**: a method invoked on a bound handle whose `(service, method)` is not on this list is refused with `CALL_NOT_ALLOWED` before the handle's OID is resolved. See "Bound-object bridge (R3)" below.

### Success response (200)

```json
{
  "ok": true,
  "source": "evejs-web-gateway",
  "apiVersion": 1,
  "service": "charUnboundMgr",
  "method": "GetCharacterSelectionData",
  "result": [ "...retail-shaped handler result..." ],
  "notifications": []
}
```

- `result` is the handler's return value, JSON-encoded (see value encoding below). A handler that returns nothing yields `null`.
- `notifications` is the array of notification calls handlers made against the browser-backed session, in order, each as `{ "service", "method", "args", "kwargs" }` (mirroring `ClientSession.sendServiceNotification(serviceName, methodName, payloadTuple, kwargs)`). Returned in the response **for now**; event-channel forwarding is a later goal (G6) — do not build on delivery timing.
- **Persistent sessions (R2)** capture all three ClientSession notification surfaces, tagged by an added `kind` field (entries keep the R1 fields, so R1 consumers are unaffected):
  - `kind: "service"` — `sendServiceNotification(serviceName, methodName, payloadTuple, kwargs)` (fields as above);
  - `kind: "client"` — `sendNotification(notifyType, idType, payloadTuple)` as `{ "service": null, "method": <notifyType>, "idType", "args": <payloadTuple>, "kwargs": null }` (e.g. `OnCharNowInStation` guest-join broadcasts from other sessions);
  - `kind: "sessionchange"` — `sendSessionChange(changes)` as `{ "service": null, "method": "OnSessionChanged", "args": [<changes>], "kwargs": null }`.

  Notifications captured on a persistent session **accumulate between calls** and are **drained on read**: each `/call` (or `session/select`) response returns the whole backlog and clears it.

### Value encoding

Retail-shaped results can contain values plain JSON cannot carry:

- **BigInt** (e.g. `{type:"long", value:<bigint>}` FILETIMEs in cached-call versions) → encoded as a **decimal string** (`"value": "133742..."`). Handlers that used plain numbers still emit numbers; clients must accept both in `long` wrappers.
- **Buffer** (e.g. cached-object pickles) → Node's default JSON form `{"type":"Buffer","data":[...]}`.
- Anything JSON cannot represent after that (circular structures) → the call fails with `CALL_FAILED`.

### Error responses

Standard gateway error envelope:

```json
{ "ok": false, "source": "evejs-web-gateway", "apiVersion": 1, "error": "<CODE>", "message": "<human text>" }
```

| HTTP | `error` | Meaning |
| --- | --- | --- |
| 400 | `CALL_INVALID` | Malformed request: missing/empty service or method, non-array `args`, non-object `kwargs`, non-scalar session field, missing/invalid `userid`, or a non-string/empty `bridgeSessionID`. |
| 403 | `CALL_NOT_ALLOWED` | The (service, method) pair is not on the allowlist. Deny by default; also covers unknown services/methods. |
| 503 | `CALL_SERVICE_UNAVAILABLE` | Pair is allowlisted but the service is not registered in this process (or the runtime predates the bridge). |
| 502 | `CALL_FAILED` | The handler threw a non-refusal error (message carries a truncated detail), or the result was not JSON-serializable. |
| 409 | `CALL_REFUSED` | **R2.** The handler itself refused with a retail user-facing error (a macho-wrapped `UserError`, e.g. "X is already online.", "not available on this account", the browser-pilot control refusal). The `message` is the handler's own text — the gateway never pre-empts or reimplements the check. |
| 404 | `SESSION_NOT_FOUND` | **R2.** The `bridgeSessionID` is unknown, expired (idle TTL already ran the disconnect), released, evicted by a retail takeover, or owned by a different `userid` (deliberately opaque). |
| 404 | `BOUND_HANDLE_NOT_FOUND` | **R3.** The `boundHandle` is unknown on this session, belongs to a different service than requested, or its OID was released/evicted. Handles are confined to the session that minted them (a handle from another session is unknown here). |
| 502 | `BOUND_NO_OBJECT` | **R3.** A bind method dispatched but returned no bound object (no OID substruct). |
| 501 | `CALL_DEFERRED_UNSUPPORTED` | **R4.** A handler returned a deferred call response (`buildDeferredCallResponse`) whose completion genuinely needs a client round-trip the synchronous bridge cannot service (e.g. a still-pending `OnAgentProvisionalResponse` confirmation). Refused as a typed error rather than emitting the broken deferred wrapper as a result. See "Deferred call responses (R4)" below. |
| 502 | `SESSION_SELECT_FAILED` | **R2.** `SelectCharacterID` completed without binding a character to the session (e.g. unknown characterID — the handler logs and returns null on apply-failure). The minted session is discarded. |
| 401 | `UNAUTHORIZED` | Gateway authorization failed (shared with all gateway routes). |
| 503 | `GATEWAY_RUNTIME_NOT_READY` | Gateway runtime not ready (shared with all gateway routes). |

## Persistent browser-backed sessions (R2)

A browser session **is** a client session: `session/select` mints a live session object (the parity-test duck-typed shape), **registers it in EveJS's live session registry**, and dispatches the retail tuple `charUnboundMgr.SelectCharacterID(charID, secondChoiceID, skipTutorial)` on it through the same allowlisted `callMethod` seam. From that point EveJS's own duplicate-login and character-control rules arbitrate it exactly like a retail session (a retail login for the same character is refused "already online", or evicts the browser session when login takeover is enabled — both faithful).

**Design choice (R2):** select is a dedicated route (not a `/call` special case) because minting/releasing a session is bridge-transport lifecycle, not a retail call; the dispatch itself still goes through the allowlist and `callMethod`.

### `POST /_evejs-web/v1/session/select`

Request: `{ "args": [charID, secondChoiceID, skipTutorial], "kwargs": null, "session": { "userid": <accountID>, "userName"?: <string> } }` — the service/method are pinned server-side to `charUnboundMgr.SelectCharacterID` (which must be, and is, on the allowlist).

Success (200): the `/call` envelope plus:

```json
{
  "bridgeSessionID": "<opaque token>",
  "session": {
    "userid": 2, "characterID": 140000003, "characterName": "Test Three",
    "stationID": 60003760, "structureID": null,
    "solarSystemID": 30000142, "corporationID": 98000000, "shipID": 9988400022009
  }
}
```

`shipID` (**R3**) is the docked character's active ship (`session.shipid`, set by `applyCharacterToSession`); the BFF uses it to bind the active ship's cargo with `invbroker.GetInventoryFromId`.

- `bridgeSessionID` is an opaque gateway-minted handle for the stored live session. **It exists only between the gateway and the BFF: the BFF keeps it server-side keyed by its cookie session, and it must never reach browser JS** (same rule as the gateway token).
- `session` echoes the scalar docked-entry state `applyCharacterToSession` put on the live session (where the character is), so the BFF/page need not re-derive it.
- Failures: the handler's own refusals → `CALL_REFUSED` (409); apply-failure → `SESSION_SELECT_FAILED`; in both cases the minted session is discarded and unregistered (nothing leaks).

### Using the session: `POST /call` with `bridgeSessionID`

Subsequent calls carry the handle (plus the normal `session.userid`, which must match). The call dispatches on the stored live session — handlers see the real docked session fields (`stationid`, `charid`, ...) — and the response drains the accumulated notification backlog.

### Ending the session: release, idle TTL, takeover

- `POST /_evejs-web/v1/session/release` with `{ "bridgeSessionID", "session"?: { "userid" } }` → `{ "ok": true, "released": true, "characterID": <id|null> }`. Runs the **same disconnect path a retail socket close runs** (`services/_shared/sessionDisconnect.js`: logoff persistence, guest-list departure, space/trade/chat cleanup, control release) — the character goes offline. Releasing an already-gone session is 404 `SESSION_NOT_FOUND` (the TTL got there first; treat as already released).
- **Idle TTL:** 30 minutes without a call (gateway default, `browserSessionIdleTtlMs`); an unref'd sweep (60s interval) reaps idle sessions through the same disconnect path. Any later use of the handle is `SESSION_NOT_FOUND`.
- **Retail takeover:** if EveJS's own mechanics evict the browser session (login takeover), the store notices the defunct session on next use and reports `SESSION_NOT_FOUND`.
- Gateway shutdown releases all persistent sessions through the same path.

## Bound-object bridge (R3)

Retail drives inventory and ship operations with a **two-step bound-object
(moniker/`MachoBindObject`) call**: a first call returns a *bound object* (a
moniker/OID), and subsequent methods dispatch on that bound object rather than
on the service by name. R3 mirrors this on the persistent session, and R4
(agents are `Moniker('agentMgr', agentID)`) and R5 (travel is
`Moniker('beyonce', solarsystemID)`) reuse the same two routes.

**Handle confinement.** A bind returns an opaque `boundHandle` that the gateway
holds on the persistent session (alongside the bound OID, which is registered
in the shared service manager exactly as `network/packetDispatcher`'s
`_scanAndRegisterOIDs` does after a real `MachoBindObject`). Like the
`bridgeSessionID`, **the bound OID and the boundHandle are gateway↔BFF only —
neither ever reaches browser JS.** The browser refers to inventories and ships
by their game IDs (inventoryID / shipID / itemID); the BFF maps those to the
handles it holds. A handle is confined to the session that minted it: presented
to another session, it is `BOUND_HANDLE_NOT_FOUND`. When the session ends, its
OIDs are released from the service manager.

### `POST /_evejs-web/v1/bound/bind`

Request: `{ "service", "method", "args"?, "kwargs"?, "session": { "userid" }, "bridgeSessionID" }`
— dispatches an **allowlisted bind method** (`invbroker.GetInventory` /
`GetInventoryFromId` / `MachoBindObject`, `ship.MachoBindObject`) on the stored
live session, registers the returned bound OID(s), and mints a handle for the
primary OID.

Success (200): `{ "ok": true, "boundHandle": "<opaque>", "service", "method", "notifications": [...] }`.
The bind's raw result is **not** returned (it carries the OID); only the opaque
handle and the drained notification backlog cross back. Deny-by-default applies
to the bind pair before any service lookup.

### `POST /_evejs-web/v1/bound/call`

Request: `{ "service", "method", "args"?, "kwargs"?, "session": { "userid" }, "bridgeSessionID", "boundHandle" }`
— resolves the handle on **this session only**, enforces the deny-by-default
`(service, method)` allowlist on the **bound method BEFORE resolving the OID**
(a non-allowlisted bound method is refused before any dispatch), sets the
session's `currentBoundObjectID` to the OID so the handler resolves its bound
context exactly as on a socket, and dispatches through the same `callMethod`
seam. The `service` must match the handle's service (else `BOUND_HANDLE_NOT_FOUND`).

Success (200): the `/call` envelope (`result` is the bound method's
retail-shaped return; `notifications` drains the backlog).

### BFF bound-object routes (this repo)

The browser never calls `/bound/*` directly; it hits semantic BFF routes keyed
by game IDs, and the BFF holds the handles (cached per web session by a semantic
key — `hangar:<stationID>`, `cargo:<shipID>`, `ship:<stationID>` — re-binding on
`BOUND_HANDLE_NOT_FOUND`). All require the signed web login session.

- `GET /api/bridge/inventory` → the full Inventory & Ship panel:
  `{ ok, stationID, activeShipID, hangar: { list, capacity, error }, cargo: { shipID, list, capacity, error } }`.
  Binds the station hangar (`invbroker.GetInventory`) and the active-ship cargo
  (`invbroker.GetInventoryFromId`), then `List(flag)` + `GetCapacity(flag)` on
  each. The four reads are independent (`Promise.allSettled`) so one failed read
  never blanks the rest; each container carries its own `error` code. `list` and
  `capacity` are the raw retail-shaped results, decoded browser-side
  (`web/src/bridge/inventoryShip.ts`).
- `POST /api/bridge/inventory/move` `{ itemID, direction: "toCargo"|"toHangar", qty? }`
  → `invbroker.Add(itemID, sourceLocationID, {qty?, flag})` on the **destination**
  binding (retail `Add` carries the source location and destination flag; a
  partial `qty` folds the split into the move — no separate `SplitStack`, gap
  G4).
- `POST /api/bridge/inventory/stack` `{ target: "hangar"|"cargo" }` → `invbroker.StackAll(flag)`.
- `POST /api/bridge/ship/board` `{ shipID }` → `ship.MachoBindObject` then
  `Board(shipID, oldShipID)`; on success the boarded ship becomes the active
  ship the BFF binds cargo against.

Errors pass through with the gateway's status (`CALL_NOT_ALLOWED` → 403,
`BOUND_HANDLE_NOT_FOUND` → 404, `CALL_REFUSED` → 409); a `SESSION_NOT_FOUND`
drops the held bridge session (the page returns to character select). With no
character online the routes answer 409 `NO_LIVE_SESSION`.

## Deferred call responses (R4)

Some retail handlers do not return a value; they return a **deferred call
response** (`buildDeferredCallResponse(startFn)`, `network/callResponseControl.js`)
and let the packet dispatcher drive completion — the handler sends its own
call/error response(s) later, often only after a **client round-trip** (e.g. the
`OnAgentProvisionalResponse` YesNo confirmation `agentMgr.Handle_DoAction` uses
on a **decline**). The gateway previously JSON-serialized that wrapper as a
broken object.

Both dispatch seams (`callServiceMethod` and `callBoundMethod`) now detect
`isDeferredCallResponse(result)` and drive it with a **gateway-side adapter**:
the adapter supplies a fake dispatcher + packet, captures the response(s) the
handler emits, and returns the last non-provisional response as the real result
(with the session's drained notifications). The browser-backed session has no
`sendClientCallRequest`, so a decline degrades to the handler's own
no-client-available fallback and completes synchronously (a direct decline). If
a deferred flow emits only an interim provisional placeholder and no final
response — genuinely still waiting on a client round-trip the synchronous bridge
cannot service — it is refused with `CALL_DEFERRED_UNSUPPORTED` (501) rather than
returned broken. **The in-person courier accept (`DoAction(<accept>)`) is a
synchronous outcome and never takes this path.**

Faithful to retail, the gateway now also invokes `service.afterCallResponse(method,
session, {args, kwargs, result})` after a successful **non-deferred** dispatch (in
a try/catch, mirroring `network/packetDispatcher.js`) so post-response side
effects run — invbroker's docked-fitting bootstrap and deferred session-change
flush, ship's safe-logoff completion. It is skipped for deferred dispatches (as
retail returns before it) and is a no-op for services that do not define it.

## Agent conversation, briefing, and journal (R4)

The agent flow is the retail bound-object two-step reused for `agentMgr`:

- **Roster:** `agentMgr.GetAgents()` (top-level) returns a Rowset of every agent
  (~11k). The retail client filters by station client-side; the BFF does the same
  server-side and returns only the docked station's agents as plain rows
  (`agentID, agentTypeID, divisionID, level, stationID, corporationID,
  missionKind, missionTypeLabel`).
- **Bind:** `agentMgr.MachoBindObject([agentID])` — the agent moniker
  `Moniker('agentMgr', agentID)` — mints a bound handle (held BFF-side).
- **Conversation:** bound `DoAction(actionID)`. `actionID` `null` opens the
  conversation; the result is the marshaled tuple
  `( ( agentSays, availableActions ), lastActionInfo )` where each available
  action is a `(actionID token, buttonType)` tuple. The UI renders a button per
  action (labelled from `buttonType`: 2=Request, 3=Accept, 6=Complete, 9=Decline,
  11=Quit, …) and sends the **token** back as the next `DoAction(actionID)`
  (retail sends the first action-tuple value; the handler normalizes token→button).
- **Accept (in person):** `DoAction(<accept token>)` on a courier the agent
  offers → the mission moves to accepted (synchronous). Decline is the deferred
  outcome above.
- **Briefing reads (bound):** `GetMissionObjectiveInfo` carries the courier
  transport objective — pickup/dropoff location dicts and a cargo dict
  (`typeID`, `quantity`, `volume`), `normalRewards` (ISK, `typeID` 29),
  `bonusRewards` (time bonus), and `loyaltyPoints`; `GetMissionBriefingInfo`
  carries the title, a `Mission Keywords` summary, and the `AcceptTimestamp` /
  `Expiration Time` FILETIME longs. `GetAgentLocationWrap` is the agent-location
  header.
- **Journal:** `agentMgr.GetMyJournalDetails()` (top-level) returns
  `(activeMissions, offeredMissions)`; each mission row is
  `[missionState, _, missionTypeLabel, missionTitleID, agentID, expiry(long),
  bookmarks, _, _, missionID]`.

**Decoder rule:** mission rows carry long-encoded IDs and ISK/LP amounts. The
browser decoders (`web/src/bridge/agents.ts`) decode every numeric with
`unwrapLong` — never `typeof === "number" ? … : 0`. ISK amounts and FILETIMEs
(which can exceed 2^53) are kept as **decimal strings**, not lossy `Number`.

## Space bridge & session-into-space (R5a)

R5a bridges the atomic space-movement calls the retail client's **client-side**
autopilot issues (`autopilot.py`), driven **manually** (one button per move):
undock → warp to a gate → jump → dock. EveJS's existing space handlers stay
authoritative for each move; **no server-side travel job is added** (roadmap
§7). The automated decide-loop + route solver + multi-jump travel panel are
R5b, out of scope here.

**The persistent browser-backed session participates in space across undock,
exactly like a retail socket session — and this needs no new session-carry
code.** `ship.Undock` is a **top-level** call on the docked session:
`Handle_Undock` resolves the ship from the session and runs
`undockSession(session)`, which moves the ship to space, applies the character
to the session (`applyCharacterToSession`), and attaches the session to a space
scene via `spaceRuntime.attachSession` — setting `session._space`. The
persistent session (`materializePersistentBrowserSession`) already carries the
duck-typed fields and all three notification surfaces
(`sendServiceNotification` / `sendNotification` / `sendSessionChange`) plus a
duck `socket`, which is the **same shape the space parity tests hand to
`undockSession`/`dockSession`**. Destiny (graphics) traffic is gated on
`isReadyForDestiny` (a live socket **and** `initialStateSent`), so a
browser-backed session — `initialStateSent:false`, no real destiny socket —
simply receives no destiny frames (graphics are out of scope); the location and
movement state still transition authoritatively.

- **Undock:** `ship.Undock(shipID, ignoreContraband, onlineModules=[])` —
  `onlineModules` is a **kwarg** (never positional). Emits an `OnSessionChanged`
  (drained into the response) the browser can read.
- **Remote park (bound two-step, reuses R3):** the park is the moniker
  `Moniker('beyonce', solarSystemID)` (retail `michelle.GetRemotePark()`), bound
  with `beyonce.MachoBindObject([[solarSystemID, groupStation=5]])`. Its `Cmd*`
  methods dispatch on the in-space session (they read `session._space`, not the
  bound OID): `CmdWarpToStuffAutopilot(destinationID)` (warp to a gate/celestial),
  `CmdStargateJump(fromGateID, toGateID, shipID)` (jump — changes the system
  after a short handoff delay), `CmdDock(stationID, shipID)` (dock — accepts a
  pending dock the sim completes, returning the session to the station).
- **Movement refusals are faithful:** the handler's own refusal (scrambled,
  invalid target, docking-approach, lost control, ship destroyed) surfaces as a
  `CALL_REFUSED` (409) with the handler's user-facing text — never a silent
  no-op or a fake success.

### `POST /_evejs-web/v1/session/flight-status`

Request: `{ "bridgeSessionID", "session"?: { "userid" } }` — a **read-only**
snapshot of the held session's current location and (in space) ship movement
state, drained together with the accumulated notification backlog. Full push
streaming is still G6, so the browser polls this manually between movement
steps ("Refresh flight status").

Success (200): `{ "ok": true, "flight": { inSpace, docked, solarSystemID,
stationID, structureID, shipID, shipMode, shipSpeedFraction },
"notifications": [...] }`. `shipMode`/`shipSpeedFraction` are a best-effort read
of the scene entity (null when docked or the scene is gone). The read touches
only the live session scalars the gateway already holds plus a best-effort
`spaceRuntime.getEntity` (lazy-required, mirroring `teardownBrowserSession`), so
it stays within the `_secondary/express` footprint.

## Ship fitting (R12)

**Fitting is not a dedicated service.** It is the SAME `invbroker` bound-object
two-step the R3 inventory bridge drives, with a **slot flag** instead of the
hangar (4) / cargo (5) flag — so it reuses the bind + handle cache verbatim and
adds no new bind machinery. (`fittingMgr` is saved fitting *templates*, not live
fitting, and is out of scope.)

| action | call |
| --- | --- |
| read the fit | ship binding → `invbroker.ListByFlags([<every slot flag>])` |
| read resources | `dogmaIM.ShipGetInfo()` — **top level**, no bind |
| read online state | `dogmaIM.ShipOnlineModules()` — **top level**, no bind |
| fit a module | ship binding → `invbroker.Add(moduleID, sourceLocationID, {qty:1, flag:<slot>})` |
| unfit a module | hangar/ship binding → `invbroker.Add(moduleID, shipID, {qty:1, flag:4\|5})` |
| online / offline | `dogmaIM.SetModuleOnline([shipID, moduleID])` / `TakeModuleOffline` |
| remove a rig | ship binding → `invbroker.DestroyFitting(rigID)` — **destroys it** |

`sourceLocationID` is the station when fitting from the hangar and the ship when
fitting from its own cargo; the destination is the bound object and is never
repeated in the args. The three `dogmaIM` reads/actions are top-level because
each handler resolves the character's active ship from the **session** itself.

### Slot flags and how the browser addresses a slot

Slot flagIDs (`inventorycommon/const.py`; mirrored by
`server/src/services/fitting/liveFittingState.js` `SLOT_FAMILY_FLAGS`):

| family | flags |
| --- | --- |
| low | 11–18 |
| mid | 19–26 |
| high | 27–34 |
| rig | 92–99 |
| subsystem | 125–132 |
| hangar / cargo / auto-fit | 4 / 5 / **0** |

These are the **server's** ranges. The retail client's own rig and subsystem
lists are narrower (92–94 and 125–128); the server clamps each family to the
ship's real slot count anyway (`getSlotFlagsForFamily("rig", 597, …)` → `[92,93,94]`
for a Punisher), so reading the wider range never invents a slot and never
misses one this server considers legal.

**The browser never sends a flagID.** It addresses a slot by **family + index**
("the third high slot"), and the BFF is the only place that maps that to a flag
— which is what keeps raw flagIDs out of browser JS entirely (R7d). `family:
"auto"` maps to flag 0 (`flagAutoFit`) and lets the **server** pick the slot.

### Dogma attributes the panel reads

From `dogmaIM.ShipGetInfo()`, whose result is
`{type:"dict", entries:[[shipID, util.KeyVal{itemID, invItem, attributes:{attributeID: value}, …}]]}`.
IDs cross-checked against this build's `TYPE_DOGMA.attributeTypesByID` names, not
assumed:

| reading | attribute IDs |
| --- | --- |
| CPU | **48** output / **49** load |
| Powergrid | **11** output / **15** load |
| Capacitor | **482** capacity, **18** charge, **55** recharge time |
| Calibration | **1132** capacity / **1152** used (`upgradeLoad`) |
| Slot counts | **12** low / **13** mid / **14** high / **1137** rig / **1366** subsystem |

⚠ **A docked ship reports 482 and 55 as `null`** and carries its effective
capacitor in **18** (`charge`). The panel therefore reads capacity-**or**-charge;
this is pinned by the gateway suite's `ShipGetInfo` test, and it is the
difference between a working capacitor bar and a blank one in station.

### ⚠ A refusal can be SILENT — never trust a 200

`invbroker`'s fit validation raises a `UserError` for most refusals, but several
branches (notably `SKILL_REQUIRED`) return `null` **without raising**:
`_throwFittingMoveUserError` has no case for them, so `Add` simply does nothing
and the bridge answers 200 with `result: null`. **A successful response is not
proof a fit happened.** Every mutating BFF route below therefore RE-READS the
slots afterwards and reports `applied` — what actually changed, not what was
asked for. A silent decline surfaces to the player as *"The server did not apply
that change, and gave no reason"*: honest, where naming a cause would be a guess.

A thrown refusal is different and better: it carries the **handler's own** reason
(`"You do not have enough CPU to online that module."`,
`NotEnoughCapacitorForOnline`, `CannotOnlineReachedMaxGroupOnline`, …) through as
a typed `CALL_REFUSED` (409), passed to the browser verbatim.

### BFF fitting routes (this repo)

Handles stay server-side; the slot read reuses the **same** `cargo:<shipID>`
bind as the R3 cargo read (one cached handle, not two).

- `GET /api/bridge/fitting` → `{ ok, activeShipID, stationID, slots, shipInfo,
  online, errors: { slots, shipInfo, online } }`. The three reads are independent
  (`Promise.allSettled`), so a failed resource read still shows the fit and vice
  versa. Raw retail-shaped results, decoded browser-side
  (`web/src/bridge/fitting.ts`).
- `POST /api/bridge/fitting/fit` `{ itemID, source: "hangar"|"cargo", family, index? }`
  → `Add` with the resolved slot flag; answers `{ ok, applied }`.
- `POST /api/bridge/fitting/unfit` `{ itemID, destination: "hangar"|"cargo" }`
  → the same `Add` reversed; answers `{ ok, applied }`.
- `POST /api/bridge/fitting/state` `{ itemID, online }` →
  `dogmaIM.SetModuleOnline` / `TakeModuleOffline`.
- `POST /api/bridge/fitting/destroy-rig` `{ itemID, confirm: true }` →
  `invbroker.DestroyFitting`. **Refuses with 400 `CONFIRMATION_REQUIRED` unless
  `confirm === true`**, and with 400 `NOT_A_RIG` for anything not sitting in a
  rig slot on the active ship. This is the second gate behind the UI's own
  two-step confirmation: a rig is destroyed, never returned to the hangar, so
  neither a stray click nor a stray POST can lose one.

Decoded browser side into slots (`FittingSlot` = family + index + the module or
`null`) and resource readings (`FittingResource` = used / total / `known`), with
`known: false` rendering as an unknown bar rather than a misleading `0 / 0`.

## Space snapshot — overview + ship HUD (R11)

The retail client's overview is a **client-side view over one server structure**:
the server enumerates the destiny Ballpark balls paired with their slimItems, and
the client dead-reckons positions locally and re-renders every 0.5–1.0 s.
Distance math, sorting, filtering and naming are all client-side. **So polling
here is faithful, not a compromise** — a ~1 s snapshot poll matches retail's own
re-render cadence, and this feature does **not** depend on the R10 push channel
(the channel carries events, not continuous positions).

The ship HUD is a **different source** from the overview: shield/armor/hull/
capacitor for the **active ship** come from the ship item's dogma-backed state
(retail: `godma.GetItem(shipID)`), not the ballpark. Other entities carry only
their `damageState`-equivalent fractions, which is what each overview row gets.

### `POST /_evejs-web/v1/space/snapshot`

Request: `{ "bridgeSessionID", "session"?: { "userid" } }` — a **read-only**
projection of what the held session can currently see, drained together with the
accumulated notification backlog. Ownership is checked before any space read: an
unknown handle or a foreign `userid` is `SESSION_NOT_FOUND` (404), never another
character's surroundings.

The gateway calls the space runtime and never modifies it:
`getSceneForSession(session)` → `scene.getVisibleEntitiesForSession(session)`
(statics + dynamics, already cloak-filtered) and
`scene.getShipEntityForSession(session)` for the ego ball, with the presentation
fields refreshed before projecting (the same refresh `ensureInitialBallpark` runs
before it builds a slim payload). Ship capacities come from
`space/combat/damage.js` `getEntityMaxHealthLayers(entity)`. Positions are
integrated server-side every tick (`RUNTIME_TICK_INTERVAL_MS = 100`), so each
poll sees a freshly integrated scene without the gateway stepping it. A
proxy-only process or a vanished scene degrades to an empty overview rather than
failing the read.

Success (200): `{ "ok": true, "space": { … }, "notifications": [...] }` where
`space` is:

- `inSpace`, `solarSystemID`, `shipID`, `sampledAtMs` (scene sim time — tells two
  polls apart).
- `entities[]` — one row per visible object: `kind`, `itemID`, `typeID`,
  `groupID`, `categoryID`, `name`, `ownerID`, `radius`, `position {x,y,z}`,
  `velocity {x,y,z}`, `isSelf`, and the remaining-health fractions
  `shieldRatio` / `armorRatio` / `hullRatio` (null for an object with no
  damageable health). Ship/structure rows add `characterID`, `corporationID`,
  `allianceID`, `securityStatus`, `maxVelocity`, `mode`, `targetEntityID`,
  `capacitorRatio`.
- `ship` — the active ship's HUD: `itemID`, `typeID`, `name`, `mode`,
  `maxVelocity`, `position`, `velocity`, the remaining fractions
  `shieldRatio` / `armorRatio` / `hullRatio` / `capacitorRatio`, and the
  capacities behind them (`shieldCapacity`, `armorCapacity`, `hullCapacity`).
  Null when docked or the scene is gone.

**The server never precomputes distance.** It reports positions; the browser
measures from the ship's own position, sorts, filters and caps —
`web/src/space/overview.ts`, exactly the division the retail client uses.

A docked session answers cleanly with `inSpace: false`, `entities: []`,
`ship: null` rather than an error.

## Client-side route solver & browser autopilot (R5b)

R5b automates the R5a atomic moves. It is **web-only — no eve.js/gateway change**:
R5a already allowlisted every atomic call (undock/warp/jump/dock) and added
`flight-status`, which is the whole authoritative surface the loop needs.

**The route solver is client-side (roadmap §7 / G2).** Retail solves routes
locally from its static map DB (`clientPathfinderService`) — there is **no wire
call to the game server for a route**. We mirror that: the browser holds a
system-adjacency graph and runs a pure BFS solver over it
(`web/src/nav/routeSolver.ts`). The graph is **read-only static reference data**
(like station names staying client-local, roadmap §4), served by `src/staticData.js`:

- `GET /api/map/graph` (requires the web login session; **no bridge session**) →
  `{ ok, source:"static-data", systemCount, edgeCount, systems, edges }`. Built by
  `staticData.getSolarSystemGraph()` from the gameStore **`stargates`** table:
  each stargate record is **one directed edge** — `edges` is a flat array of
  `[fromSystemID, toSystemID, fromGateID, toGateID]` where `fromGateID` is the
  source stargate's `itemID` (the autopilot warps to it and jumps **through** it)
  and `toGateID` is its `destinationID` (the gate on the far side). That is
  exactly the pair `beyonce.CmdStargateJump(fromGateID, toGateID, shipID)` (R5a)
  wants, and the same shape `autopilot.py` derives from
  `cfg.mapSolarSystemContentCache[sys].stargates` (`sg.destination`). `systems`
  maps each gate-connected system ID → name (panel readout only). Current data:
  5268 systems / 13978 edges.
- `GET /api/map/resolve/:id` (same auth) → resolves a picked destination (a
  courier destination is a station; the solver routes **systems**) to its solar
  system from static reference data: `{ ok, id, kind:"station"|"system"|"unknown",
  solarSystemID, systemName, stationID, stationName }`. The same client-local
  resolution `select` does for station identity — **not** a route or gateway call.
  R7a also uses this to resolve the **Flight readout's** current system / station
  ID → name (the browser caches resolved names client-side, so the flight-status
  poll doesn't refetch; a definitive `kind:"unknown"` — e.g. a player structure —
  is cached too, a transient failure is not).
- `GET /api/map/find?q=<text>[&kind=system|station][&limit=N]` (same auth; **R7a**)
  → searches the static **solar-system + station** tables by name so a player can
  set a destination by name instead of a raw EVE ID:
  `{ ok, source:"static-data", q, kind, total, capped, limit, count, matches }`,
  each match `{ id, name, kind:"system"|"station", solarSystemID, solarSystemName }`.
  `id` is the ID the client hands to `startRoute`. Matches are ranked by name
  match quality (exact → prefix → substring, then shorter/alphabetical) so a
  search for "Jita" surfaces the **Jita system** ahead of "Jita IV - ..." stations;
  `q` under 2 chars returns nothing (no whole-table dump); capped server-side
  (default 50 / max 200). Read-only static reference data mirroring
  `/api/agents/find` — **NOT a gateway/bridge call**. The client annotates each
  match with jumps-away from the current system using the already-loaded route
  graph (`distancesFrom`, a single BFS), like the Agent Finder.
- `POST /api/names` (same auth; **no bridge session**; **R7c**) → batch-resolves a
  set of `{ kind, id }` refs to display names so a list of many IDs (an inventory
  of typeIDs, a station's guest corps, an agent roster, ...) resolves in **one
  round-trip**. Body `{ items: [{ kind, id }, ...] }` with
  `kind ∈ type | typeGroup | typeCategory | category | corporation | alliance |
  faction | character | agent | station | system | region | owner`; response
  `{ ok, source:"static-data", count, capped, limit, names }` where `names` is
  keyed by `"kind:id"` and each value is the resolved **name string** or **null**
  for a definitive "unknown" (an NPC / type not in the static tables). Every
  requested item is echoed (so the client can cache the outcome for every key,
  including the nulls, and never refetch); duplicate `(kind,id)` pairs resolve
  once; the batch is **capped server-side** (`limit` 500) so an oversized request
  never scans the whole item table. `owner` resolves an ID whose entity type is
  unknown at the call site (a station owner, a standings `fromID`) by trying
  corp → faction → character → alliance in turn. Read-only static reference data
  over `src/staticData.js` `resolveNames` (which layers on the existing
  `getTypeName` / `getStationName` / `getCorporationName` / new `getFactionName` /
  `getCharacterName` / `getAgentName` getters) — mirrors `/api/map/find` and
  `/api/agents/find`, **NOT a gateway/bridge call**. The client name cache lives
  in `app/flow.ts` (`requestNames`): components ask for names by `(kind,id)`; the
  cache batches all unresolved refs raised in one microtask into a single POST,
  caches each result (name or definitive null), pushes them into the store's
  `names` slice for pure-reader components, never refetches a cached key, and
  does **not** cache a transient failure (so it can retry). Fire-and-forget — it
  never throws and never blocks a UI interaction; a component shows the raw ID
  until the name lands.

None of these routes touch a live bridge session or the gateway; they are not a
server-side travel job (the roadmap forbids reintroducing one).

**The decide-loop runs in the BROWSER** (`web/src/nav/autopilotLoop.ts`), a port
of `autopilot.py`'s `AutoPilot.Update`. Each ~2 s tick it reads `flight-status`
and issues **one** atomic call (undock / `CmdWarpToStuffAutopilot` /
`CmdStargateJump` / `CmdDock`) through the R5a BFF flight routes — it never
simulates or predicts position; each move's truth comes from the next
`flight-status`. Loop contract:

- **Truth model — measure, don't guess (R13).** The loop reads the R11 space
  snapshot each tick and computes the **surface distance** to its current target
  the way the server does:

  ```
  surfaceDistance = max(0, distance(a.position, b.position) - a.radius - b.radius)
  ```

  (identical to `services/drone/droneRuntime.js`; the snapshot's `ship` block
  carries the ego `radius` for exactly this). It then runs retail's ladder
  (`autopilot.py:274-404`) **in retail's evaluation order**, on one measurement
  per tick:

  | Measured surface distance | Target | Action |
  |---|---|---|
  | `< 2500 m` (`maxStargateJumpingDistance`) | stargate | **jump** |
  | `< 50000 m` (`maxDockingDistance`) | station/structure | **dock** |
  | `< 150000 m` (`minWarpDistance`) | either | **approach** |
  | otherwise | either | **warp** |

  The close-range rule is per target **kind** — a gate is never docked at and a
  station is never jumped to. Thresholds are strict `<`, so 2500 m exactly
  approaches. A settle window after each warp/jump still lets the transition
  begin before re-deciding (retail's `ignoreTimerCycles`).
- **Measurement is primary; refusals are the backstop.** When the snapshot
  cannot be read, or cannot see the target (off grid, a scene mid-load), the tick
  falls back to the original R5b path — ship **mode** plus the server's own
  **refusals** — so the loop never stalls for want of a measurement. The snapshot
  read is a READ: it starts nothing, it cannot fail a tick, and a rejection just
  costs that cycle its measurement.
- **Never re-issue a running approach.** Retail skips its approach when the ship
  is already `DSTBALL_FOLLOW` on that same target. The loop does the same: it
  remembers what it told the ship to approach and, while the snapshot agrees the
  ship is following that target, it **waits** instead of restarting the move. The
  wait is bounded, so a ship that never closes stops rather than waiting forever.
- **Never act mid-warp.** `DSTBALL_WARP` returns immediately — before any
  measurement is consulted, so even a target measured inside jump range issues
  nothing while the ship is in warp.
- **Approach-then-redock (verified live).** `CmdDock` out of range refuses
  `DockingApproach` and the ship enters a FOLLOW approach; the loop **re-issues
  `CmdDock`** each cycle until `flight-status` shows docked — it does not assume
  one dock call docks.
- **Pause, don't guess.** Any unsafe/blocked refusal that is not the normal
  docking-approach (warp scrambled, gate restricted, invalid target, lost
  control) **pauses** the loop with the handler's own reason. A jump
  "not-close-enough" re-warps to the gate; a lost session unwinds to character
  select.
- **Tab close = client close.** The loop lives in browser JS; closing the tab
  kills it and it simply **stops issuing — no "stop" is sent**. The ship
  completes whatever server-side command was last issued and then sits. After
  **abort/pause the loop never calls the bridge again**. The BFF is a relay +
  session holder and **never advances travel with no client connected**.

## Courier completion & reward readout (R6)

R6 is the courier-milestone capstone. **Complete needs no new call:** completing
a courier is the already-allowlisted synchronous `agentMgr(bound).DoAction(<complete
actionID>)` — the same bound two-step accept uses (R4). The retail `DoAction`
result's `lastActionInfo.missionCompleted` flips to `true` and the mission clears
from the runtime. A courier Complete is a synchronous outcome and never takes the
deferred path; if any completion action were deferred, R4's deferred adapter
already drives it (or refuses `CALL_DEFERRED_UNSUPPORTED`).

**Delivery has no distinct RPC** (inventory Step 10): the courier package is
ordinary inventory (staged in the pickup hangar on accept, loaded into the ship
with the R3 invbroker move — Step 5 — and flown to the dropoff by the R5b browser
autopilot). `DoAction(Complete)` validates delivery server-side (the character is
at the dropoff with the package in the ship hold or the dropoff hangar) and pays
out.

**Step-12 reward reads** are the pull-refreshes a wallet/LP/standings/journal
panel issues after payout. Three are new top-level (non-bound) server-tier reads
(added to the allowlist above); the fourth (the mission journal) was already
allowlisted in R4:

- `account.GetCashBalance(0)` → the personal ISK balance (a plain number, or a
  `{type:"long"}`). Decoded to a bigint-safe decimal string.
- `LPSvc.GetAllMyCharacterWalletLPBalances()` → a CRowset (`objectex2`) of packed
  rows `[issuerCorpID, loyaltyPoints]`. LP kept as decimal strings.
- `standingMgr.GetCharStandings()` → a header/lines Rowset of `[fromID, standing]`
  (standings are small floats).
- `agentMgr.GetMyJournalDetails()` (R4) → after completion the mission is no longer
  in the journal (cleared), the truthful "mission done" signal.

**Decoder rule:** amounts decode long-aware (`unwrapLong`, never
`typeof === "number" ? … : 0`); ISK/LP are decimal strings, standings numbers
(`web/src/bridge/rewards.ts`).

Proven in-process end to end by `eve.js server/tests/webGatewayCourierComplete.test.js`:
in-person accept → deliver the package to the dropoff → `DoAction(Complete)` actually
completes the mission (runtime record cleared, package consumed) and the Step-12
reads reflect the payout (wallet grows, an LP balance for the agent corp appears,
standing toward the corp grows, the mission leaves the journal). Deny-by-default is
re-proven for non-allowlisted `account`/`LPSvc`/`standingMgr` siblings.

## Agent Finder static route (R6a)

The per-station `agentMgr.GetAgents` roster is unreliable for *finding* an agent
to travel to (it returns 0 for a character re-selected directly into a docked
station, and only ever lists the current station). The Agent Finder instead
lists agents from the **static `agentAuthority` reference table**, sorted by
jumps from the player's current system, and sets the R5b browser autopilot to a
chosen agent's station. This is **read-only static reference data served by
`src/staticData.js`** — exactly the pattern of `GET /api/map/graph` (R5b):
**NOT a gateway/bridge call, NOT gameplay SQLite, NOT a server-side travel job.**
Web-only; no eve.js change.

- `GET /api/agents/find` (requires the web login session; **no bridge session**)
  → `{ ok, source:"static-data", kind, level, total, capped, limit, count, agents }`.
  Query params: `kind` (default `courier`; `all`/`any` disables the kind filter),
  `level` (optional, 1..5), `limit` (server result cap, default **500**, clamped
  to `[1, 5000]`). The BFF filters server-side by kind + level, sorts the pre-cap
  match set deterministically by `(level, agentID)`, and returns the first `limit`
  as compact summaries — so the ~11k-agent dataset never crosses the wire whole.
  `total` is the full match count before the cap; `capped` is `total > limit`.
  Each agent summary is `{ agentID, name (ownerName), level, divisionID,
  agentTypeID, missionKind, missionTypeLabel, corporationID, factionID,
  stationID, stationName, solarSystemID, solarSystemName }` — station/system
  **names resolved server-side** via `staticData.getStationName` /
  `getSolarSystemName`. Backed by `staticData.findAgents({ kind, level, limit })`
  reading `_local/gameStore/data/agentAuthority/data.json` (`agentsByID`).

**Kind is classified by `(divisionID, agentTypeID)`, not the raw `missionKind`
(R6b).** The static export stamps `missionKind:"courier"` on special agents too
— Paragon (e.g. "IRIS - Jita" agentID 3020034: `divisionID 37`, `agentTypeID
13`), off-division epic (division 25, type 12), plus career/storyline/event
placeholders in division 22 — none of which are ordinary courier agents. So the
finder classifies each exposed kind by its retail agent division + standard
agent type, and every other `(division, type)` is excluded:

  | kind | division | agentType | real agents (of 10,941) |
  | --- | --- | --- | --- |
  | `courier` | 22 Distribution | 2 basic | 3,725 (was 4,421 by raw missionKind) |
  | `encounter` | 24 Security | 2 basic | 3,655 |
  | `mining` | 23 Mining | 2 basic | 1,371 |
  | `research` | 18 R&D | 4 research | 244 |

  `all`/`any` returns the union of these real mission agents (still excluding the
  specials); a `kind` the finder does not classify matches nothing (an empty
  finder beats a mislabeled Paragon). Every export row is a
  `conversationMetadata.placeholder:true` with empty `missionTemplateIDs` — the
  runnable mission *content* lives in the mission runtime — so the finder filters
  to the right *kind* only, not to guaranteed content.

**Distance is computed client-side.** The route solver gains `distancesFrom(graph,
originSystemID)` (`web/src/nav/routeSolver.ts`): a **single BFS** over the
already-loaded gate graph returning the jump distance to every reachable system
at once (origin → 0; unreachable systems absent from the map → the finder flags
and sorts them last; invalid origin → empty map, never a throw). The finder runs
one BFS from the docked system and looks each returned agent's system up — never
a `solveRoute` per agent. "Set destination" reuses the R5b `startRoute(agent.
stationID)` (route solver + browser autopilot) — no new movement code.

**The finder requests `limit=2000`** (not the server default 500): 2000 fully
covers any single courier level (the largest, L1, is ~1531) so choosing a level
yields the complete, correctly-nearest-sorted set, while staying bounded well
under the 11k dataset; for all-courier (no level) the client renders a capped
page and the UI surfaces `total`/`capped` to prompt for a narrower filter.

## Docked-station-change refresh (R6b)

When the character's **docked station changes on the same live session**
(autopilot arrival, a manual dock, or select), the station-scoped panels — the
Station panel, the Agents & Missions agent list, and the Inventory & Ship panel
— must reflect the new station **without a page reload**. This is a web-side
reactivity concern: the flow already learns the new location from every
flight-status snapshot (manual step, autopilot tick, route-origin read), which
all funnel through one `observeFlightStatus(status)` choke point in
`web/src/app/flow.ts`. That pushes the snapshot to the `flight` slice and then
reconciles the docked station:

- It tracks the station the panels are synced to (`syncedStationID`, anchored on
  select). When a snapshot shows the character **docked at a different station**,
  it relocates once (guarded against re-entry and redundant same-station
  refetches; a lost session still unwinds to character select).
- Relocating applies a `station/relocated` store event — re-pointing the online
  location (`stationID` + `solarSystemID`, so the finder's distance origin and
  the panel header track the new station) and the static station identity — then
  re-runs the docked reads: `refreshStationPanel` always, and `loadAgents` /
  `loadInventory` only if their tab has already loaded (an unopened tab
  re-fetches on open via its own `onMount`). The autopilot tick voids the
  reconcile (the loop must not block on a panel refresh); a manual movement step
  awaits it (its busy state covers the refresh).

- `GET /api/map/station/:id` (requires the web login session; **no bridge
  session**) → `{ ok, source:"static-data", station: <StationStatic> }`. The
  same client-local static identity the select route returns (name / system /
  region / type / operation / security), keyed by station ID, so the flow can
  refresh the Station panel identity after the docked station changes. An unknown
  ID is a `404 STATION_NOT_FOUND`. Read-only static reference data like
  `/api/map/graph` and `/api/map/resolve` — NOT a gateway/bridge call.

## Local + Corp chat (R7)

Retail chat runs over XMPP, and its delivery **deliberately bypasses** the
`sendServiceNotification`/`sendNotification`/`sendSessionChange` surfaces the
bridge drains — so polling the notification drain yields **zero** chat. Chat
**READ** therefore comes from the **backlog store** every channel writes to
(`chatRuntime.getChannelBacklog(roomName)`); there is no RPC that returns
messages. The browser **polls** the read route on a modest interval (~4s) while
the Chat panel is open and stops when it closes (full chat push is G6).

This goal has an operator-authorized broader eve.js footprint: the gateway
runtime/routes **and** a new chat-gateway helper
(`gatewayServices/webChatGatewayService.js`) for the corp session-derived path.
Core chat mechanics (`chatRuntime`/`chatHub`/`xmppStubServer`/`channelRules`
delivery internals) are **not** modified — the helper only *calls* them.

**Presence (a gateway side-effect).** The browser session's `sendSessionChange`
is a capture stub, so retail's auto chat-sync never fires; the gateway syncs
presence explicitly on select and on each read/send:

- **Local** membership is derived live from the session registry
  (`chatRuntime.getVisibleLocalSessions(roomName)`) — the browser session appears
  once it is registered (it is, from select) and docked in the room's system. The
  gateway calls `chatHub.joinLocalChannel(session)` on first sync (emits the
  retail join to other occupants) and `chatHub.moveLocalSession(session,
  prevSystemID)` when the session's solar system changes (a jump/dock). Local room
  = `getLocalChatRoomNameForSolarSystemID(solarSystemID)`.
- **Corp** has no session-derived membership in retail (it is XMPP-only, keyed by
  real XMPP sockets). R7 adds a session-derived corp path mirroring Local: the
  roster is enumerated from `sessionRegistry.getSessions()` filtered by
  `corporationID` (per-character deduped like Local), and `ensureCorpChannel`
  ensures the `corp_<id>` record.

**Retail visibility — the XMPP presence bridge (R7b).** In R7 the web player saw
everyone but *retail could not see the web player*: retail clients render their
Local/Corp roster from **XMPP MUC presence**, generated only for a character
holding a live XMPP socket (`xmppStubServer` `connectedClients`), and the
socketless browser session emits none. R7b closes that gap **server-side, in
`eve.js`** (operator-authorized core-chat change; no web-repo code beyond this
note and the corp emitter reconciliation in the gateway helper):

- `xmppStubServer` subscribes to `chatRuntime.runtimeEmitter` `local-join` /
  `local-leave` / `local-message` and, for a **socketless** author/member (one
  with no `connectedClient`), injects the corresponding synthetic MUC stanza —
  `available` / `unavailable` (+ the Local admin-leave notice) presence, or a
  `groupchat` message — to the room's XMPP occupants, reusing
  `buildRoomPresenceXml` / `deliverRoomMessage`. A `moveLocalSession` therefore
  produces a leave in the old room and a join in the new for XMPP occupants.
- A **retail-join roster seam** in `handleJoinPresence` additionally seeds a
  joining retail client's opening roster with `getVisibleLocalSessions` (Local) /
  session-registry-by-corp (Corp) members that hold no `connectedClient`, so the
  web player is present from the first render.
- **Corp** rides the gateway helper's private `corpChatEmitter`: `syncPresence`
  emits `corp-join`/`corp-leave` on a corp-membership transition and
  `broadcastCorpMessage` emits `corp-message`; `xmppStubServer.subscribeCorpChat-
  Bridge(corpChatEmitter)` (registered by the helper — cycle-free, since
  `xmppStubServer` never requires the helper) injects the matching corp MUC
  stanzas to `corp_<id>` occupants.
- **Guardrails:** every bridge handler dedups by `characterID` and returns before
  any side effect for a character that already holds a live XMPP `connectedClient`
  (retail's own machinery covers those), so **retail↔retail rooms are byte-for-
  byte unchanged**; delayed-local rooms (wormhole/Pochven/nolocal) stay
  hidden-until-you-speak because the runtime only emits a presence-bearing local
  event for them once a member speaks.

Delivery to the browser itself is unchanged (backlog poll); the bridge only makes
the socketless member **visible and audible to retail XMPP clients**.

### `POST /_evejs-web/v1/chat/read`

Request: `{ "bridgeSessionID", "session"?: { "userid" }, "channel": "local"|"corp", "limit"? }`.
Re-syncs presence, then returns the channel's current member roster + recent
backlog for the held session, plus the drained notification backlog.

Success (200): `{ "ok": true, "chat": { "channel", "roomName", "solarSystemID",
"corporationID", "roster": [ { "characterID", "name", "corporationID",
"allianceID", "solarSystemID", ... } ], "messages": [ { "characterID",
"characterName", "message", "createdAtMs", ... } ] }, "notifications": [...] }`.
`roster` rows are `chatRuntime.buildCharacterSummary` shapes; `messages` are the
backlog entries. For Corp with no corporation, `corporationID` is null and the
roster/messages are empty (no throw).

### `POST /_evejs-web/v1/chat/send`

Request: `{ "bridgeSessionID", "session"?: { "userid" }, "channel": "local"|"corp", "message" }`.
Re-syncs presence, then broadcasts: **Local** via
`chatRuntime.broadcastLocalMessage(session, message)`; **Corp** via the
session-derived corp broadcast — `chatRuntime.sendChannelMessage(session,
corp_<id>, message)`, which writes to the `corp_<id>` backlog (the same core
append Local uses) and emits a `corp-message` runtime event — **NOT** an XMPP
send. A channel access failure or mute surfaces as the core handler's own
`CALL_REFUSED` (409); an empty message or unknown channel is `CALL_INVALID`
(400); a corp send with no corporation is `CALL_REFUSED`.

Success (200): `{ "ok": true, "chat": { "channel", "roomName", "sent": true,
"entry": { "characterID", "characterName", "message", "createdAtMs" } },
"notifications": [...] }`.

## Live event channel — the push path (R10 / roadmap G6)

Everything above is **pull**: handler notifications are captured into a
per-session array and drained onto the next call response, and chat is a backlog
poll. R10 adds a real **push** channel alongside them. It is strictly
**additive** — the `notifications` drain on every response is unchanged, so a
browser with no channel behaves exactly as it did before, and a reconnect gap
can never lose data the next response would have carried anyway.

The chain is **gateway WebSocket → BFF → browser SSE**. The `bridgeSessionID`
never leaves the server, exactly as on the request routes.

### `GET /_evejs-web/v1/session-events` (WebSocket upgrade)

Query: `userid`, `bridgeSessionID`, and optionally the resume cursor
`epoch` + `sequence` (both or neither — a half cursor is `INVALID_EVENT_CURSOR`
400, not a fresh subscribe).

Rides the **same** `server.on("upgrade")` seam, `WebSocketServer`, 2 MB frame /
4 MB buffer guards, ping/pong heartbeat, and graceful shutdown as the existing
character-event path (`/events`, keyed by `characterID`). Inbound client
messages are rejected — the channel is strictly server→client.

**Authorization** is resolved *before* the handshake completes, so a refusal is a
readable HTTP status rather than an opened-then-closed socket: the
`bridgeSessionID` must resolve to a live session owned by `userid`. An unknown
**or foreign** handle is opaquely `SESSION_NOT_FOUND` (404); a malformed request
is 400; a not-ready runtime is 503.

> **Upgrade auth matches request auth.** `authorizeGatewayUpgrade` previously
> returned `false` whenever no `EVEJS_WEB_GATEWAY_TOKEN` was configured, while
> `authorizeGatewayRequest` fell back to loopback-allow. That divergence made the
> push channel unreachable in the ordinary token-less local setup even though
> every request route on the same origin worked. Both now use one rule: with a
> token configured, present it; without one, **loopback only**.

**Frames.** Every frame carries `source: "evejs-web-gateway"`, `apiVersion`,
`streamVersion`, and `cursor: { epoch, sequence }`.

- `type: "event"` with `event.kind: "notification"` — one capture from the
  session's `sendServiceNotification` / `sendNotification` / `sendSessionChange`
  stub, in the same shape the drain carries (`kind` is `service` / `client` /
  `sessionchange`).
- `type: "event"` with `event.kind: "chat"` — `{ channel: "local"|"corp",
  roomName, entry }`, sourced by subscribing to `chatRuntime`'s existing
  module-level `channel-message` emitter and routing by room name to each live
  browser session's Local and Corp rooms. `entry` is the **same backlog-entry
  shape the chat READ returns**, so a pushed message and a polled one decode
  identically. Chat mechanics are subscribed to, never modified.
- `type: "snapshot"` — the replay fallback (below).

### Replay or snapshot

Copied from `characterEventRuntime`: a per-process `epoch`, a per-session
monotonic `sequence`, and a bounded history (256 frames). On subscribe:

- **Replayable cursor** (same epoch, within the retained horizon): exactly the
  frames after `cursor.sequence` are delivered, then live delivery continues.
  The subscriber is registered *before* the replay batch drains, so the handoff
  from replay to live is atomic with no gap.
- **Otherwise**: a single `snapshot` frame carrying the current high-water cursor
  and a `reason` — `"no_cursor"` (a fresh subscribe, nothing was missed) or
  `"cursor_not_replayable"` (a gateway restart or a cursor past the horizon).
  A session stream has no separately readable authoritative state to snapshot, so
  the frame's honest content is "resynchronize by reading" — the browser answers
  `cursor_not_replayable` with a chat re-read rather than assuming continuity.

Frames are retained even with no subscriber attached, which is what makes a
reconnect during a brief drop lossless. A consumer whose `onFrame` returns
`false` (the socket overflowed its buffer) is dropped as `consumer_rejected`.
Ending the bridge session (release, idle TTL, retail takeover, shutdown) drops
its stream and closes attached sockets.

### BFF: `GET /api/bridge/events` (SSE)

Same-origin, cookie-authed, routed to the web session's own held bridge session;
409 `NO_LIVE_SESSION` without one, 401 without a login.

The BFF holds **at most one** gateway WebSocket per held bridge session,
regardless of how many browsers attach. It is opened lazily on first attach and
closed when the last browser detaches, so a held session nobody is watching costs
nothing. The BFF remembers the last cursor it saw, so a reconnect resumes from it
and the gateway replays the gap.

Gateway frames are forwarded verbatim. The BFF adds its own status frames —
`{ source: "evejs-web-bff", type: "stream-status", state, detail }` with `state`
one of `connecting` / `live` / `degraded` / `ended` — so the browser knows when
to lean on its polls. A dropped gateway socket is announced as `degraded` and
retried with the cursor; a gateway 404 (the session is gone) is announced as
`ended` and **not** retried, since retrying cannot fix it.

### What stays polled

- **Chat roster** — the channel carries messages, not membership changes.
- **Flight status**, inventory, agents, journal, rewards — all still explicit
  reads. The channel is a liveness signal, not a state replacement.
- **The space snapshot (R11)** — and deliberately so: the retail client
  re-renders its own overview every 0.5-1.0 s, so a ~1 s poll IS the faithful
  cadence, not a fallback the channel replaces.
- **The chat backlog poll itself**, as a safety net: it drops from 4s to 30s
  while the channel is live and snaps back to 4s the moment it is not. It also
  keeps the held bridge session warm against its idle TTL for a player who is
  only watching chat.

The browser side feeds pushed messages into the chat slice (deduplicated against
what a poll already delivered, by author + text + timestamp) and pushed
notifications into a bounded `live` slice — which is where the drained
`notifications` the page used to discard now actually land.

## BFF routes (this repo)

`POST /api/bridge/call` — requires the signed web login session (else 401 `AUTH_REQUIRED`).

Request body: `{ "service", "method", "args"?, "kwargs"?, "session"? }` — same shapes as the gateway route, except identity: **the BFF pins `session.userid` to the logged-in account's `accountID`**; a `userid` supplied by the browser is ignored. Other scalar session fields pass through. **R2:** when this web session holds a persistent bridge session, the BFF attaches its server-held `bridgeSessionID` automatically (one web login is one client session, like retail); a browser-supplied `bridgeSessionID` is ignored. A `SESSION_NOT_FOUND` from the gateway drops the held handle (the page should return to character select) and passes through as 404.

Success response: `{ "ok": true, "service", "method", "result", "notifications" }` (the gateway envelope minus `source`/`apiVersion`). Gateway errors pass through with their status and `error` code (`CALL_NOT_ALLOWED` → 403, `CALL_REFUSED` → 409, etc.); transport failures surface as `EVE_GATEWAY_UNREACHABLE`/`EVE_GATEWAY_TIMEOUT` (502).

### Persistent-session routes (R2)

- `POST /api/bridge/select` with `{ "characterID" }`: validates ownership against the logged-in account, releases any previously held bridge session (character switch), then forwards the retail tuple `[characterID, null, true]` to the gateway's `session/select` with the pinned `userid`. The returned `bridgeSessionID` is stored **server-side only** (keyed by the signed web session); the browser gets `{ "ok": true, "character": {characterID, characterName, stationID, structureID, solarSystemID, corporationID}, "station": <client-local static identity or null>, "notifications": [...] }`. `station` is read-only static reference data (name/system/region/type/operation/security) — the same client-local resolution retail does from its static DB. Handler refusals pass through as `CALL_REFUSED` with the handler's message.
- `POST /api/bridge/release` with `{}`: releases the held bridge session (if any) → `{ "ok": true, "released": <bool> }`. `POST /api/logout` also best-effort releases it.

### Agent routes (R4)

All require the signed web login session and a held bridge session (else 409
`NO_LIVE_SESSION`). The browser addresses agents/missions by game ID; the BFF
holds the bound agent handle (cached per web session under `agent:<agentID>`,
re-binding on `BOUND_HANDLE_NOT_FOUND`).

- `GET /api/bridge/agents` → `{ ok, stationID, agents: [...] }`. Dispatches
  `agentMgr.GetAgents` on the held session and returns the plain agent rows at
  the docked station (decoded + filtered server-side).
- `POST /api/bridge/agents/:agentID/action` `{ actionID?: number|null }` →
  `{ ok, result, notifications }`. Binds the agent and dispatches
  `DoAction([actionID])` on it (the deferred decline is driven to completion by
  the gateway). `result` is the raw retail-shaped DoAction tuple.
- `GET /api/bridge/agents/:agentID/briefing` →
  `{ ok, agentID, briefing, objective, location, errors: {...} }`. Binds the
  agent and reads `GetMissionBriefingInfo` / `GetMissionObjectiveInfo` /
  `GetAgentLocationWrap` (independent `Promise.allSettled`; each carries its own
  error code). Raw results are decoded browser-side.
- `GET /api/bridge/journal` → `{ ok, result }`. Dispatches
  `agentMgr.GetMyJournalDetails` on the held session; raw result decoded
  browser-side.

Errors pass through with the gateway's status; a `SESSION_NOT_FOUND` drops the
held bridge session (the page returns to character select).

### Reward-readout route (R6)

Requires the signed web login session and a held bridge session (else 409
`NO_LIVE_SESSION`). The browser drives Complete through the existing
`/api/bridge/agents/:agentID/action` route (bound `DoAction(<complete actionID>)`)
and refreshes the journal via `/api/bridge/journal`; this route covers the other
three Step-12 reads.

- `GET /api/bridge/rewards` → `{ ok, cash, lp, standings, errors: {...} }`.
  Dispatches `account.GetCashBalance(0)`, `LPSvc.GetAllMyCharacterWalletLPBalances`,
  and `standingMgr.GetCharStandings` as top-level calls on the held session. The
  three reads are independent (`Promise.allSettled`) so one failed read never
  blanks the rest; each carries its own error code. Raw retail-shaped results are
  decoded browser-side (`web/src/bridge/rewards.ts`). A `SESSION_NOT_FOUND` drops
  the held bridge session (the page returns to character select).

### Flight routes (R5a)

All require the signed web login session and a held bridge session (else 409
`NO_LIVE_SESSION`). `ship.Undock` is a top-level call on the held session;
warp/jump/dock go through the beyonce remote-park bound-object two-step — the
BFF holds the bound park handle server-side, cached under `park:<solarSystemID>`
so a jump (which changes the system) rebinds the park for the new system. Each
movement route reads the current flight status first (to resolve the live
system + ship and guard `NOT_IN_SPACE`), and returns the refreshed snapshot.

- `GET /api/bridge/flight/status` → `{ ok, flight, notifications }`. The
  read-only flight snapshot for the status readout + "Refresh flight status".
- `POST /api/bridge/flight/undock` `{}` → `{ ok, flight, notifications }`.
  Dispatches `ship.Undock(shipID, false, onlineModules=[])`; refuses
  `ALREADY_IN_SPACE` if not docked.
- `POST /api/bridge/flight/warp` `{ destinationID, minRange? }` → `{ ok, result,
  flight, notifications }`. Binds the park and dispatches **one of two** warps:
  without `minRange`, `beyonce.CmdWarpToStuffAutopilot([destinationID])` (the
  autopilot's warp); with it, `beyonce.CmdWarpToStuff(["item", destinationID],
  {minRange})` — the right-click "warp to within N" form, where the **subject
  string is positional and the range is a kwarg**. `minRange` must be one of
  retail's offered distances `[0, 10000, 20000, 30000, 50000, 70000, 100000]`
  metres (anything else is `400 INVALID_RANGE`). Retail's own default for that
  menu is **0**, not 10 km.
- `POST /api/bridge/flight/jump` `{ fromGateID, toGateID }` →
  `beyonce.CmdStargateJump([fromGateID, toGateID, shipID])`. The system
  transition completes after a handoff delay; poll flight status to see it.
- `POST /api/bridge/flight/dock` `{ stationID }` →
  `beyonce.CmdDock([stationID, shipID])`. Out-of-range docking refuses with a
  docking-approach reason; poll flight status to confirm the docked state.

#### Flight verbs (R13)

The rest of retail's in-space right-click menu. **Four of the six verbs needed no
new server method** — R5a was already calling them, just with the interesting
argument hardcoded away:

| Verb | Route | Bound dispatch |
|---|---|---|
| Approach | `POST /api/bridge/flight/approach` `{ destinationID, range? }` | `CmdSetSpeedFraction([1.0])` then `CmdFollowBall([destinationID, range])`. **Default 50 m** — retail's *menu* range. The autopilot passes **0**. |
| Keep at range | `POST /api/bridge/flight/keep-at-range` `{ targetID, range? }` | The **same** `CmdFollowBall([targetID, range])` with a non-zero range. Default **1000 m**, floored at **50 m**. |
| Orbit | `POST /api/bridge/flight/orbit` `{ targetID, range? }` | `CmdOrbit([targetID, range])`, default **1000 m**. The range is coerced as the retail client coerces it: **float below 10, int at or above**. |
| Align to | `POST /api/bridge/flight/align` `{ targetID }` | `CmdAlignTo([], {dstID: targetID, bookmarkID: null})` — **kwargs only, never positional**, exactly one non-null. |
| Stop | `POST /api/bridge/flight/stop` `{}` | `CmdStop([], null)` — **no arguments**. In retail this also kills the autopilot; ours is client-side, so the browser aborts its decide-loop *before* issuing the call. |
| Warp at range | `POST /api/bridge/flight/warp` `{ destinationID, minRange }` | See above. |

All of them bind the park for the **current** system, guard `NOT_IN_SPACE`, reject
a missing target with `400 INVALID_TARGET` before dispatching anything, and never
let the bound handle reach the browser.

Errors pass through with the gateway's status; a movement `CALL_REFUSED` (409)
carries the handler's own reason, which the page shows as the last failure. A
`SESSION_NOT_FOUND` drops the held bridge session (the page returns to character
select).

### Space overview route (R11)

- `GET /api/bridge/space/snapshot` → `{ ok, space, notifications }`. Requires the
  signed web login session and a held bridge session (else 409
  `NO_LIVE_SESSION`). A read-only relay of the gateway's projection — the BFF
  interprets nothing; the browser's `web/src/bridge/space.ts` decoder owns that.
  A `SESSION_NOT_FOUND` drops the held bridge session (the page returns to
  character select).

**Polling cadence:** the Overview panel polls this every **1 s** while the ship
is in space and the panel is open. It stops when the panel closes, and the very
next beat after the ship docks stops it too. A read still in flight when the next
beat arrives is **skipped, never queued**, so a slow snapshot cannot pile work up
behind the autopilot's own flight-status reads. The poller issues no movement
call of any kind.

**Row actions reuse the existing atomic moves.** Every row offers *Warp to*,
*Approach*, *Orbit*, *Keep at range* and *Align to*, each posting to the
`/api/bridge/flight/*` verb route above with that row's `itemID` as the target,
plus a panel-level *Stop the ship*. So a player can fly at anything they can see,
through the same server-authoritative handlers the manual Flight tab and the
autopilot already use.

**Ranges are picked once, at panel level** (R13), not per row: a busy grid holds
hundreds of rows, and hanging three range pickers off each of them would be
unusable. The panel carries *Warp to within* (retail's ladder, defaulting to
"as close as it can" = `minRange` 0), *Orbit at* and *Hold at* (defaulting to
1 km), and each row button applies the current choice. Every range renders as a
**distance a player reads** — `500 m`, `2.5 km`, `100 km` — never a raw metre
count and never an identifier (R7d).

### Chat routes (R7)

All require the signed web login session and a held bridge session (else 409
`NO_LIVE_SESSION`). The browser addresses channels by **name** (`local`/`corp`);
the BFF holds the bridgeSessionID server-side. READ is a backlog poll — the Chat
panel polls the open channel every ~4s and stops when closed.

- `GET /api/bridge/chat/:channel` → `{ ok, chat, notifications }`. Reads the
  channel's roster + recent backlog on the held session (gateway `/chat/read`).
  An unknown `:channel` is `400 INVALID_CHANNEL`.
- `POST /api/bridge/chat/:channel/send` `{ message }` → `{ ok, chat, notifications }`.
  Broadcasts to the channel (gateway `/chat/send`). An empty/whitespace message
  is `400 EMPTY_MESSAGE`; a channel access failure / mute / no-corporation is the
  gateway's `CALL_REFUSED` (409).

A `SESSION_NOT_FOUND` from either drops the held bridge session (the page returns
to character select).

The server-side client is `src/eveGatewayClient.js` — since R9b it is the bridge surface plus four v1 reads (`getAccount`, `listCharacters`, `getSnapshot`, `getStatus`/`getGatewayHealth`) and nothing else: `callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID?)`, `selectCharacter(args, kwargs, sessionFields)`, `releaseBridgeSession(bridgeSessionID, sessionFields?)`, `readFlightStatus(bridgeSessionID, sessionFields)` (R5a), `readSpaceSnapshot(bridgeSessionID, sessionFields)` (R11), `readChat(bridgeSessionID, channel, sessionFields, options?)` / `sendChat(bridgeSessionID, channel, message, sessionFields)` (R7), and the R3 bound-object pair `bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID)` / `callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle)`. The TS browser client consumes the BFF routes only and never sees the bridgeSessionID or any boundHandle.

## Login semantics (who-cares, R1)

`POST /api/login` with `{ "username", "password"? }`:

- An **existing** EveJS account username signs in with **any password, including empty or absent** — the password is not checked at all (roadmap section 6). The scrypt web-password store (`src/webAuth.js`, `data/web-users.json`, `npm run webpass`) is bypassed, not deleted.
- Unknown username → **401** `{ "ok": false, "error": "UNKNOWN_EVEJS_ACCOUNT", "message": "Unknown EveJS account." }`.
- Banned account → 403 `ACCOUNT_BANNED`.
- Account auto-create is deferred to R2 (alongside `SelectCharacterID`).

## Reference call

`charUnboundMgr.GetCharacterSelectionData()` (`Handle_GetCharacterSelectionData`, `eve.js` `server/src/services/character/charService.js`) reads `session.userid` and returns the retail 4-tuple `(userDetails, trainingDetails, characterDetails, wars)`; `characterDetails` is a `{type:"list"}` of `util.KeyVal` rows. Proven end to end in-process by `eve.js` `server/tests/webGatewayServiceCall.test.js` and consumed live by the frontend bridge panel (`public/app.js` `loadBridgePanel`).

## Consuming the bridge from TypeScript (R1b)

The browser-side TS client (goal R1b) lives under `web/src/` and consumes `POST /api/bridge/call` exactly as specified above:

- `web/src/bridge/wire.ts` — this contract as types: the call tuple, success/error envelopes, error codes, and the marshaled value encodings (`{type:"long"}` with number **or** decimal-string value, `{type:"list"}`, `{type:"dict"}`, `util.KeyVal`) plus decoding helpers (`readKeyVal`, `unwrapLong`).
- `web/src/bridge/callMethod.ts` — `callMethod(service, method, args, kwargs, options)`; rejects with `BridgeCallError` carrying the wire `error` code and HTTP status (client-side failures use `BRIDGE_NETWORK_ERROR` / `BRIDGE_BAD_RESPONSE`).
- `web/src/bridge/characterSelection.ts` — the reference call typed end to end: the 4-tuple type, `decodeCharacterSelectionData`, and `getCharacterSelectionData()` producing `CharacterSummary` rows (`web/src/store/types.ts`).
- `web/src/store/` — the framework-agnostic client-state store (plain signals): typed `session`/`character`/`feed` slices, `get`/`subscribe` plus per-slice signals for pure readers, `apply(event)` reducers, and the `FeedAdapter`/`FeedSink` seam (`feed.ts`) that hides whether events come from the legacy WS stream or bridge-forwarded notifications.

Build/dev: `npm run build:web` typechecks (`tsc`) and builds `web/` into `public/dist/` (git-ignored), which the existing Express static setup serves at `/dist/` alongside the untouched vanilla app; `npm run dev:web` runs the Vite dev server with `/api` proxied to the BFF (`vite.config.ts`, override target with `EVEJS_WEB_BFF_URL`). TS unit tests are `web/**/*.test.ts`, run natively by the same `npm test` (`node --test`, Node >= 22.18).

### View library (locked by the R2 spike): Svelte 5

R2 replaced the R1b smoke page with the first migrated page — login → character select → docked station panel — and locked **Svelte 5** (`svelte` + `@sveltejs/vite-plugin-svelte` in `vite.config.ts`; no blocker surfaced, plugin v7 supports Vite 8). How it stays thin:

- The signal store's `subscribe` deliberately implements the **Svelte store contract**, so components read slices with plain `$slice` auto-subscription — the store stays framework-agnostic and the view lib is not load-bearing (roadmap section 5).
- Components (`web/src/ui/*.svelte`) are pure readers plus event handlers; all fetch/decode/store logic lives in plain TS (`web/src/app/flow.ts` + `web/src/app/api.ts`), unit-tested under `node --test` without Svelte.
- `web/src/svelte-files.d.ts` shims `.svelte` imports for `tsc` (the Svelte compiler handles `lang="ts"` scripts itself).

R2 page pieces, per the recipe below: `web/src/bridge/stationPanel.ts` (decoders for `GetStationItemBits`, `GetGuests`, and the `GetStationInfo` cached envelope), the `station` slice + `character/online`/`character/offline`/`station/*` feed events, and the flow controller driving login (who-cares) → typed `GetCharacterSelectionData` list → `/api/bridge/select` → docked reads.

R3 page pieces (bound-object bridge): `web/src/bridge/inventoryShip.ts` (decoders for the invbroker `List` packed-row list / empty python set and the `GetCapacity` KeyVal), the `inventory` slice + `inventory/loaded`/`inventory/action-error`/`inventory/cleared` feed events, `app/flow.ts` `loadInventory`/`moveItem`/`stackContainer`/`boardShip`, and `web/src/ui/InventoryShip.svelte`. The browser addresses items/ships by game ID only; the BFF's `/api/bridge/inventory*` and `/api/bridge/ship/board` routes hold the bound-object handles (see "Bound-object bridge (R3)" above).

R4 page pieces (Agents & Missions): `web/src/bridge/agents.ts` (decoders for the `DoAction` conversation tuple, the `GetMissionBriefingInfo`/`GetMissionObjectiveInfo` courier briefing, and the `GetMyJournalDetails` journal — all `unwrapLong`, ISK/FILETIME kept as decimal strings), the `agents` slice + `agents/list`/`agents/conversation`/`agents/briefing`/`agents/journal`/`agents/action-error`/`agents/cleared` feed events, `app/flow.ts` `loadAgents`/`openConversation`/`chooseAction`/`loadBriefing`/`loadJournal`, and `web/src/ui/AgentsMissions.svelte`. The browser addresses agents by game ID; the BFF's `/api/bridge/agents*` and `/api/bridge/journal` routes hold the bound agent handles (see "Agent conversation, briefing, and journal (R4)" above).

R5a page pieces (Flight): `web/src/bridge/flight.ts` (the flight-status decoder — `unwrapLong`-aware IDs, docked/in-space derivation), the `flight` slice + `flight/status`/`flight/action`/`flight/action-error`/`flight/cleared` feed events, `app/flow.ts` `loadFlightStatus`/`undock`/`warpTo`/`jump`/`dock` (each surfaces a movement refusal as a visible reason and re-reads the true state — never a silent no-op), and `web/src/ui/Flight.svelte` (status readout + explicit undock/warp/jump/dock buttons, manual only). The browser picks each gate/destination by game ID (the route solver is R5b); the BFF's `/api/bridge/flight/*` routes hold the beyonce bound park handle (see "Space bridge & session-into-space (R5a)" above). Proven browser-side by `web/src/bridge/flight.test.ts` + `web/src/app/flightFlow.test.ts` and BFF-side by `test/bridgeFlight.test.js`.

R6 page pieces (courier completion + reward readout): the Agents & Missions page
(`web/src/ui/AgentsMissions.svelte`) gains a **courier/level/text agent filter with
a capped render** (default courier-only, first 60 shown with a match count — the
usability fix for Jita 4-4's ~1,700 agents, a pure store/view change), the mission
briefing gains **Load package into ship** (`app/flow.ts` `loadPackageIntoShip` — the
R3 inventory move) and **Set autopilot to dropoff** (`setAutopilotToDropoff` → the
R5b `startRoute(dropoffStationID)`) controls, and Complete (already a conversation
action via `chooseAction`) now also pulls the reward readout. The Step-12 wallet/LP/
standings reads have their own decoder (`web/src/bridge/rewards.ts` — `decodeCashBalance`
/ `decodeLpBalances` / `decodeCharStandings`, all long-aware, ISK/LP as decimal
strings), the `rewards` slice + `rewards/loaded`/`rewards/cleared` feed events,
`app/flow.ts` `loadRewards`, and `app/api.ts` `loadRewards` against the BFF's
`/api/bridge/rewards`. The journal (the fourth Step-12 read) reuses R4's
`loadJournal`. Unit-tested by `web/src/bridge/rewards.test.ts`,
`web/src/app/agentsFlow.test.ts` (Complete → reward pull, load-package-into-ship),
and BFF-side by `test/bridgeRewards.test.js`. See "Courier completion & reward
readout (R6)" above.

R6a page pieces (Agent Finder): the new `finder` store slice + `finder/results`/
`finder/target`/`finder/error`/`finder/cleared` feed events (`AgentFinderRow`/
`AgentFinderTarget`/`AgentFinderState` in `web/src/store/types.ts`), `app/api.ts`
`findAgents` (against `GET /api/agents/find`), `app/flow.ts` `findAgents` (fetch →
annotate each row with jumps from the docked system via `distancesFrom` → sort
nearest-first) and `setDestinationToAgent` (records the target, then reuses R5b
`startRoute(agent.stationID)`), the `distancesFrom` single-BFS helper in
`web/src/nav/routeSolver.ts`, and `web/src/ui/AgentFinder.svelte` (kind/level
server-side filters, client-side text search + nearest-sort + capped render, a
"Set destination" per row, and the current-target readout; a new **Agent Finder**
tab in `App.svelte`). Kind + level re-run the find (server-side); the browser
addresses agents by game ID. Unit-tested by `web/src/nav/routeSolver.test.ts`
(`distancesFrom`), `web/src/app/finderFlow.test.ts` (the finder flow + sort), and
BFF/staticData-side by `test/agentFinder.test.js`. See "Agent Finder static route
(R6a)" above.

R5b page pieces (Travel — browser autopilot): `web/src/nav/routeSolver.ts` (pure client-side BFS route solver over the system-adjacency graph), `web/src/nav/autopilotLoop.ts` (the framework-agnostic decide-loop controller — `createAutopilot(deps)` with `start`/`pause`/`resume`/`abort`/`tick`/`run`; the pure `decideAutopilotAction` maps flight-status → next atomic move), `app/api.ts` `loadSystemGraph`/`resolveDestination`, `app/flow.ts` `startRoute`/`pauseRoute`/`resumeRoute`/`abortRoute` (owns the graph cache + the single controller, wires its deps to the R5a flight routes and the store), the `travel` slice + `travel/planned`/`travel/progress`/`travel/plan-error`/`travel/cleared` feed events, and `web/src/ui/Travel.svelte` (Start/Pause/Resume/Abort + live readout, no map). The route solver + loop are unit-tested (`web/src/nav/routeSolver.test.ts`, `web/src/nav/autopilotLoop.test.ts` — a simulated docked→undock→warp→jump→approach→dock timeline proving each atomic call, approach-then-redock, pause-on-refusal, and no bridge call after abort), the flow by `web/src/app/travelFlow.test.ts`, and the BFF map routes by `test/bridgeMapGraph.test.js`. See "Client-side route solver & browser autopilot (R5b)" above.

R7 page pieces (Chat — Local + Corp): the `chat` store slice (`ChatState`
holding the active tab + per-channel `ChatChannelState`: roster + messages) +
`chat/loaded`/`chat/active`/`chat/error`/`chat/cleared` feed events (cleared on
character offline / logout), the decoder `web/src/bridge/chat.ts` (tolerant,
`unwrapLong`-aware `decodeChatChannel`/`decodeChatChannelName`/`decodeSentMessage`),
`app/api.ts` `readChat`/`sendChat` (against `GET /api/bridge/chat/:channel` +
`POST /api/bridge/chat/:channel/send`), `app/flow.ts` `loadChat`/`sendChatMessage`/
`setChatChannel` (a lost session unwinds to offline; other failures surface
through the chat slice), and `web/src/ui/Chat.svelte` (Local/Corp sub-channel
tabs, roster, message list, send box; polls the open channel every 4s via
`onMount`/`onDestroy` and stops on close). Unit-tested by
`web/src/bridge/chat.test.ts` (decoder), `web/src/app/chatFlow.test.ts` (flow),
and BFF-side by `test/bridgeChat.test.js`. See "Local + Corp chat (R7)" above.

### How to add a page on the new stack (R2+)

1. Mine the page's retail calls (`docs/retail-call-inventory.md`) and get each (service, method) pair allowlisted in eve.js (bridge-goal work, not web-side).
2. Add the wire result type + a decoder next to `web/src/bridge/characterSelection.ts` (copy its pattern: type the tuple/rowset, decode to a plain row type in `web/src/store/types.ts`, tolerate malformed rows, unit-test against a handler-shaped fixture).
3. Add the page's state as a new typed slice in `web/src/store/clientStore.ts` with `FeedEvent` variants in `feed.ts`; pages and the future autopilot loop read via signals/`subscribe`, never write slices directly.
4. Build the view against the store only (view library per the R2 spike), add an entry in `web/index.html` or a new Vite input, and run `npm run typecheck` + `npm test`.
5. There is no legacy path left to delete: goal **R9b** retired the `eveStore` dashboards, the `/api/characters/*` family, the lease/command/event machinery, and their modules. `src/eveStore.js` is now only the account/character lookup the auth path needs (`getAccount`, `listCharactersForAccount`, `getCharacterForAccount`, `getStatus`). Build the page on the bridge; no new features on the v1 gateway.
