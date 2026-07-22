# Handoff: `/api/bridge/call` arg-injection ownership leaks (SERVER-SIDE fix)

**Audience:** a session working on **eve.js server handlers** (`C:\Users\ryanf\Documents\GitHub\eve.js`).
**Status:** flagged, NOT fixed. The web bridge is intentionally left as-is — the 14 pairs stay **pre-plumbed** (allowlisted + routed) so the web client can use them once the server scopes them. **The fix is server-side ownership/visibility checks in the eve.js handlers.** Do NOT change the web allowlist or the BFF for this — that was considered and the decision (operator, 2026-07-22) is to fix it at the handler layer instead.
**Found by:** an adversarial audit of all 292 allowlisted gateway pairs (2026-07-22).

---

## The vulnerability

The web client reaches eve.js through a browser-facing BFF (`evejs-web-poc/src/server.js`). Its primary call path is:

```
POST /api/bridge/call   (src/server.js:281)
  body = { service, method, args, kwargs }
  → gateway.callMethod(service, method, args, kwargs, { ...clientSessionFields, userid }, heldSession)
```

**It forwards the browser's `args` array VERBATIM** for any pair on `WEB_CALL_ALLOWLIST`. The only thing the BFF pins is `userid` (from the signed login session). It does **not** sanitize `args`. This route is a legitimate, actively-used primitive (`web/src/bridge/callMethod.ts`) — it is NOT going away.

**The security invariant this creates:** every allowlisted READ must be safe when called with **attacker-chosen args** — because any logged-in browser can POST `/api/bridge/call` with an arbitrary id in `args`.

**The bug class:** a handler that reads a caller-supplied entity id (`charId`, `corporationID`, `ownerID`, `jobID`, `contractID`, `listID`, `shipID`, …) and returns **that entity's private data with no ownership/visibility check**. Retail EVE enforces these checks server-side; several eve.js handlers are simplified stubs that do not — so a browser can read another player-entity's private data by injecting its id.

The dedicated `/api/bridge/<panel>` routes are mostly safe because the BFF passes a **session-derived or arg-less** id there (e.g. the character-sheet route calls `charMgr.GetCloneInfo` with `[]`, so the handler falls back to the session char). The leak is that `/api/bridge/call` **bypasses those session-scoping routes**. A few routes (contracts, mail-lists) additionally forward a browser query param, so they leak through their own route too — noted per-pair below.

---

## The fix (server-side, per handler)

For each handler below, scope the entity to the caller like retail does. The session is available as the handler's `session` arg (`session.characterID` / `session.charid`, `session.corporationID` / `session.corpid`, `session.userid`). The right shape per handler is one of:
- **Ignore the caller-supplied id and derive the entity from the session** (correct for "my own X" reads).
- **Validate the caller-supplied id against the session** (`characterBelongsToAccount(...)`, corp-role check, contract-party/visibility check, mailing-list-membership check) and return `null`/empty/refuse when it fails.

A good existing pattern to copy: `charService.js` `Handle_GetCharacterToSelect` (~:721) does `if (character && !characterBelongsToAccount(character, requestingUserID)) return null;`.

---

## The 14 confirmed leaks

**Group A — dedicated panel route is already session-scoped; leaks ONLY via `/api/bridge/call` injection.** (Fixing the handler closes it and does not change panel behaviour, since the panels already pass a session id.)

| # | Pair | Handler | What leaks / the trusted arg |
|---|---|---|---|
| 1 | `charMgr.GetCloneInfo` | `character/charMgrService.js:623` | `resolveCharacterInfo(args, session)` takes a caller `charId` → any character's jump clones (station/system), installed implants, home/medical-clone station. |
| 2 | `charMgr.GetHomeStation` | `character/charMgrService.js:659` | caller `charId` → any character's home/medical-clone station (stationID, solarSystemID, region, ownerID). |
| 3 | `charMgr.GetHomeStationRow` | `character/charMgrService.js:666` | delegates to `GetHomeStation` with the caller `charId` — same leak, row shape. |
| 4 | `charMgr.GetPaperdollState` | `character/charMgrService.js:700` | caller `charId` → any character's recustomization/appearance state enum. **Low sensitivity** but unguarded. |
| 5 | `ship.GetShipConfiguration` | `ship/shipService.js:1771` | `const shipID = args.length>0 ? args[0] : this._getShipID(session)` — no ownership check → any ship's SMB / fleet-hangar sharing flags. |
| 6 | `corpmgr.GetAssetInventory` | `corporation/corpmgrService.js:534` | `corporationID = args[0]` drives `listAssetLocations(corporationID, which)`; the session corp is used ONLY for cache metadata → any corp's private office/asset LOCATIONS. |
| 7 | `corpmgr.GetAssetInventoryForLocation` | `corporation/corpmgrService.js:553` | caller `corporationID` + `locationID` → any corp's asset items at a location; no ownership check. |
| 8 | `industryManager.GetJob` | `industry/industryManagerService.js:48` | handler takes NO `session`; caller `jobID` → any installer's full industry job (blueprint, product, runs, installerID, cost). |
| 9 | `industryManager.GetJobCounts` | `industry/industryManagerService.js:97` | caller `installerID` overrides the session → any entity's active job counts per activity. |
| 10 | `industryManager.GetJobsByOwner` | `industry/industryManagerService.js:53` | handler takes NO `session`; caller `ownerID` → any character/corp's full industry job list. |

**Group B — the dedicated route ALSO forwards a browser query param, so it leaks through the panel path too** (fixing the handler is required; a route change alone is insufficient).

| # | Pair | Handler | What leaks / notes |
|---|---|---|---|
| 11 | `contractProxy.GetContract` | `_other/contractProxyService.js:797` | caller `contractID` → full contract detail (items, price, issuer, systems) with no party/visibility check. BFF route `/api/bridge/contracts/detail` passes `req.query.contractID` (`src/server.js:3806`). Retail restricts `GetContract` to a party or a public/visible contract — enforce that. |
| 12 | `contractProxy.GetContractListForOwner` | `_other/contractProxyService.js:742` | caller `ownerID` enumerates that entity's contracts (with item lists), no session check, no search-visibility filter. **No dedicated BFF route exists** (reachable only via `/api/bridge/call`; no panel uses it today). |
| 13 | `mailingListsMgr.GetMembers` | `mail/mailingListsMgrService.js:170` | caller `listID` → full member roster (characterIDs + access levels) for ANY list; no membership check. BFF route `/api/bridge/mail-aux` passes `req.query.listID` (`src/server.js:5169`). Scope to lists the session is a member/operator of. |
| 14 | `mailingListsMgr.GetSettings` | `mail/mailingListsMgrService.js:238` | caller `listID` → full per-list ACL (defaultAccess, access map, cost) for ANY list; no owner/operator check. Same route/param as #13. |

## 3 unresolved — need a live foreign-id probe before classifying

The audit could not statically decide these; probe each with a foreign id (log in a second account, call via `/api/bridge/call` with another entity's id) and confirm whether the returned data is private:
- `standingMgr.GetStandingCompositions` (`standingMgrService.js:222`) — caller `fromID`/`toID`; are player-set standings private or semi-public?
- `standingMgr.GetStandingTransactions` (`standingMgrService.js:213`) — caller `fromID`/`toID`; do rows carry private data (messages/amounts)?
- `structureAssetSafety.GetWrapNames` (`structureAssetSafetyService.js:208`) — caller `wrapIDs`; wrap names are likely benign/generic — confirm.

---

## How to verify a fix

1. Log in **two** accounts (`rrfarmer` → Farmer 140000005; `test2` → Test Two). BFF `:26500`, gateway `:26002`; any password.
2. As account A, `POST /api/bridge/call` with `{service, method, args:[<account B's id>]}`. **Before the fix:** returns B's private data. **After the fix:** returns A's own data / `null` / a refusal — never B's private record.
3. Confirm the corresponding panel still works (it passes a session-scoped id, so a correct fix leaves it unchanged).

**Reproduction of the canonical case (`ship.GetShipConfiguration`):** as Farmer, `POST /api/bridge/call {service:"ship", method:"GetShipConfiguration", args:[<Test Two's shipID>]}` → today returns Test Two's ship config. A fix should make `args[0]` be ignored or validated against the session.

---

## What the web side is NOT doing (deliberate)

- The 14 pairs stay on `WEB_CALL_ALLOWLIST` and keep their BFF routes — **pre-plumbed** so the web UI can consume them the moment the handlers are scoped. Do not de-allowlist them as part of this work.
- No BFF-level guard/denylist was added (considered and declined in favour of the handler fix).
- The 217 other allowlisted reads were audited and are safe (session-scoped, ownership-checked, or genuinely public/global data — map/market/lookups/public info/system-keyed public state); the 58 writes/binds are out of this audit's scope.

---

## Addendum (R72, 2026-07-22): a BINDS-ARBITRARY-OID gateway — `fleetObjectHandler.MachoBindObject`

R72 wired five gateway-**bind** reads (the Phase-2 prerequisites): `skillMgr2.GetMySkillHandler`, `dogmaIM.MachoBindObject`, `entity.MachoBindObject`, `scanMgr.GetSystemScanMgr`, `fleetObjectHandler.MachoBindObject`. Four are session-derived or session-scoped and safe (the bind target comes from the session, not from caller args). **One is not**, and belongs to the same class as the 14 above — the leak lives on the *bound read*, not the bind:

| Gateway | Handler | Classification |
|---|---|---|
| `fleetObjectHandler.MachoBindObject` | `fleets/fleetObjectHandlerService.js:106` | **BINDS-ARBITRARY-OID.** `Handle_MachoBindObject` takes `bindParams[0]` as the `fleetID` (fallback `session.fleetid`) with **no membership check** and stores it in the bound context (`_rememberBoundContext`). The Phase-2 bound reads honor it via `_resolveFleetIDFromSession` (fleetObjectHandlerService.js:35), and `fleetRuntime.getWings` / `getMotd` / `getFleetComposition` (fleetRuntime.js:1163-1200) take a **bare `fleetID`** and return that fleet's roster (member characterIDs, ship types, locations, MOTD) with **no gate** — `ensureFleetExists` even fabricates an empty fleet for an unknown id. |

**Why it is still wired:** the bind is exactly how retail's fleet two-step works — it is a prerequisite for any RB-FLEET read. The BFF binds it **session-scoped** (`fleetBindSpec()` passes `args: []` → the session's own `fleetid`), so the dedicated `/api/bridge/gateway-binds` route does not leak. **But** `POST /api/bridge/call` forwards `args` verbatim (server.js:281), so a logged-in browser can `POST /api/bridge/call {service:"fleetObjectHandler", method:"MachoBindObject", args:[[<rival fleetID>]]}` to mint a handle bound to a foreign fleet; the leak then fires on the Phase-2 bound read off that handle (currently all refused by deny-by-default — none are allowlisted yet).

**The fix (do it BEFORE any RB-FLEET bound read is allowlisted):** one of —
- Make `Handle_MachoBindObject` **validate `bindParams[0]` against the session's own fleet** (`fleetRuntime.getFleetForCharacter(session.characterID)`), ignoring / refusing a foreign fleetID; **or**
- Scope each Phase-2 bound read (`GetWings`/`GetMotd`/`GetFleetComposition`/…) to a fleet the session is a **member** of (`fleet.members.has(session.characterID)`), returning `null`/empty otherwise.

Either closes it; the first is cleaner (one place). Until then, **do not allowlist any `fleetObjectHandler` bound read.**

**Verified LIVE (2026-07-22, rrfarmer → Farmer 140000005):** the bind returns a handle session-scoped through the BFF; a bound `GetFleetID`/`GetFullState` off the handle is refused `CALL_NOT_ALLOWED` (deny-by-default holds). The foreign-fleetID injection path was **not** exercised live (no second fleet seeded) — it is a static reading of the handler, same confidence level as the 14 above.
