# Bridge wire contract (v1) — whitelisted `callMethod` path

**Status:** Active, established by goal R1 (2026-07-18); extended by goal R2 (persistent browser-backed sessions, same date) and goal R3 (2026-07-19, the bound-object bridge — see "Bound-object bridge (R3)"). R4+ builds on this contract; change it deliberately and update this file with the change.

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

The server-side client is `src/eveGatewayClient.js`: `callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID?)`, `selectCharacter(args, kwargs, sessionFields)`, `releaseBridgeSession(bridgeSessionID, sessionFields?)`, and the R3 bound-object pair `bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID)` / `callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle)`. The TS browser client consumes the BFF routes only and never sees the bridgeSessionID or any boundHandle.

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

### How to add a page on the new stack (R2+)

1. Mine the page's retail calls (`docs/retail-call-inventory.md`) and get each (service, method) pair allowlisted in eve.js (bridge-goal work, not web-side).
2. Add the wire result type + a decoder next to `web/src/bridge/characterSelection.ts` (copy its pattern: type the tuple/rowset, decode to a plain row type in `web/src/store/types.ts`, tolerate malformed rows, unit-test against a handler-shaped fixture).
3. Add the page's state as a new typed slice in `web/src/store/clientStore.ts` with `FeedEvent` variants in `feed.ts`; pages and the future autopilot loop read via signals/`subscribe`, never write slices directly.
4. Build the view against the store only (view library per the R2 spike), add an entry in `web/index.html` or a new Vite input, and run `npm run typecheck` + `npm test`.
5. Delete the page's legacy `eveStore`/snapshot path once it renders from retail calls (roadmap section 5) — no new features on the v1 gateway.
