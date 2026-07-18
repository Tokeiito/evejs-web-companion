# Bridge wire contract (v1) — whitelisted `callMethod` path

**Status:** Active, established by goal R1 (2026-07-18). R2+ builds on this contract; change it deliberately and update this file with the change.

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
| `session` | object, required in practice | JSON **scalars only** (string/number/boolean/null). `userid` (positive integer) is required. Later fields (`characterID`/`charid`, `stationid`, ...) ride the same object as R2+ needs them. |

**A live session object never crosses HTTP.** The gateway materializes the duck-typed browser-backed session server-side around the supplied scalars — the same plain-object session shape the parity tests hand to `Handle_*` — and attaches a `sendServiceNotification` capture hook.

### The allowlist (deny by default)

Only explicit **(service, method) pairs** dispatch; everything else — including other methods on an allowlisted service, and unknown services — is refused with `CALL_NOT_ALLOWED` **before any service lookup**. Never allowlist a whole service (that would expose destructive siblings like `charUnboundMgr.DeleteCharacter`). The allowlist is scope control, not a security measure (roadmap section 6).

Current pairs (defined in `eve.js` `server/src/_secondary/express/evejsWebGatewayRuntime.js`, `WEB_CALL_ALLOWLIST`):

| service | method | since |
| --- | --- | --- |
| `charUnboundMgr` | `GetCharacterSelectionData` | R1 |
| `map` | `GetStationInfo` | R1 |

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
- `notifications` is the array of `sendServiceNotification` calls the handler made against the browser-backed session, in order, each as `{ "service", "method", "args", "kwargs" }` (mirroring `ClientSession.sendServiceNotification(serviceName, methodName, payloadTuple, kwargs)`). Returned in the response **for now**; event-channel forwarding is a later goal (G6) — do not build on delivery timing.

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
| 400 | `CALL_INVALID` | Malformed request: missing/empty service or method, non-array `args`, non-object `kwargs`, non-scalar session field, or missing/invalid `userid`. |
| 403 | `CALL_NOT_ALLOWED` | The (service, method) pair is not on the allowlist. Deny by default; also covers unknown services/methods. |
| 503 | `CALL_SERVICE_UNAVAILABLE` | Pair is allowlisted but the service is not registered in this process (or the runtime predates the bridge). |
| 502 | `CALL_FAILED` | The handler threw (message carries a truncated detail), or the result was not JSON-serializable. |
| 401 | `UNAUTHORIZED` | Gateway authorization failed (shared with all gateway routes). |
| 503 | `GATEWAY_RUNTIME_NOT_READY` | Gateway runtime not ready (shared with all gateway routes). |

## BFF route (this repo)

`POST /api/bridge/call` — requires the signed web login session (else 401 `AUTH_REQUIRED`).

Request body: `{ "service", "method", "args"?, "kwargs"?, "session"? }` — same shapes as the gateway route, except identity: **the BFF pins `session.userid` to the logged-in account's `accountID`**; a `userid` supplied by the browser is ignored. Other scalar session fields pass through.

Success response: `{ "ok": true, "service", "method", "result", "notifications" }` (the gateway envelope minus `source`/`apiVersion`). Gateway errors pass through with their status and `error` code (`CALL_NOT_ALLOWED` → 403, etc.); transport failures surface as `EVE_GATEWAY_UNREACHABLE`/`EVE_GATEWAY_TIMEOUT` (502).

The server-side client is `src/eveGatewayClient.js` `callMethod(service, method, args, kwargs, sessionFields)`. R1b's TS browser client consumes this same BFF route.

## Login semantics (who-cares, R1)

`POST /api/login` with `{ "username", "password"? }`:

- An **existing** EveJS account username signs in with **any password, including empty or absent** — the password is not checked at all (roadmap section 6). The scrypt web-password store (`src/webAuth.js`, `data/web-users.json`, `npm run webpass`) is bypassed, not deleted.
- Unknown username → **401** `{ "ok": false, "error": "UNKNOWN_EVEJS_ACCOUNT", "message": "Unknown EveJS account." }`.
- Banned account → 403 `ACCOUNT_BANNED`.
- Account auto-create is deferred to R2 (alongside `SelectCharacterID`).

## Reference call

`charUnboundMgr.GetCharacterSelectionData()` (`Handle_GetCharacterSelectionData`, `eve.js` `server/src/services/character/charService.js`) reads `session.userid` and returns the retail 4-tuple `(userDetails, trainingDetails, characterDetails, wars)`; `characterDetails` is a `{type:"list"}` of `util.KeyVal` rows. Proven end to end in-process by `eve.js` `server/tests/webGatewayServiceCall.test.js` and consumed live by the frontend bridge panel (`public/app.js` `loadBridgePanel`).
