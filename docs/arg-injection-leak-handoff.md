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

---

## Addendum (R75, 2026-07-22): three unowned INVENTORY reads — `invbroker.GetItem` / `GetItems` / `GetContainerContents`

R75 wired the 8 RB-INV bound reads (`invbroker.GetItem` / `GetItems` / `GetContainerContents` / `ListDroneBay` / `ListFighterBay` / `GetItemDescriptor` / `GetAvailableTurretSlots` / `GetDamageForCrystals`) off the already-wired invbroker manager bind. Five are session-scoped and safe (the bays void their args and read the session's active ship; `GetItemDescriptor` is a static schema; `GetDamageForCrystals` has an explicit `ownerID !== characterID` guard). **Three belong to the same class as the 14 above** — they take a caller item/container id and return the found record's own data with no session check:

| # | Pair | Handler | What leaks / the trusted arg |
|---|---|---|---|
| 15 | `invbroker.GetItem` | `inventory/invBrokerService.js:6621` | caller `itemID` → `_buildContainerItemOverrides` (:5397) → `_buildInventoryItemOverrides` (:5171) copies the record's OWN `ownerID`/`typeID`/`locationID`/`quantity`/`flagID` (:5218-5225, `ownerID: itemRecord.ownerID`); `findShipItemById`/`findItemById` are NOT owner-scoped. **A single foreign item's descriptor (type, owner, location, hull category, quantity).** |
| 16 | `invbroker.GetItems` | `inventory/invBrokerService.js:6655` | caller `[itemIDs]` → `_itemOverridesFromId` (:5869) copies each found record's own `ownerID`/`typeID`/`locationID`/`quantity` verbatim. The batch form of #15 — one call reads N foreign item descriptors. |
| 17 | `invbroker.GetContainerContents` | `inventory/invBrokerService.js:7102` | caller `containerID`. The station / corp-office / own-ship / hangar branches ARE owner-scoped (they filter by the session char / corp). **The leak is the GENERIC-CONTAINER branch** (:7149) `listContainerItems(this._getGenericContainerContentsOwnerID(session, rec), containerID, null)`: `_getGenericContainerContentsOwnerID` returns `null` for a plain container (`containerLocationID>0 && containerFlagID===0 && !ship && !structure`, :477-484), and `listContainerItems(null, …)` (itemStore.js:4387) is **UNFILTERED** — every item in a foreign anchored/jettisoned container. The MOBILE-DEPOT branch (:7143) also passes `null` (gated by `_getMobileDepotCargoAccessError`). |

**The fix (server-side, per handler):** for `GetItem`/`GetItems`, validate each found `record.ownerID` against the session char (`characterBelongsToAccount` / `ownerID === session.characterID`) and return `null` / skip the row when it fails, OR fall back to the session's own item (as dogma's `_findInventoryItemContext` does). For `GetContainerContents`, the generic-container branch must never pass `null` as the owner — filter by the session char, or add a container-access check (retail gates container contents by ownership / anchoring access).

**Verified LIVE (2026-07-22, cross-account, Farmer 140000005 vs Test Two 140000002):**
- **`GetItem`(`9988400091900` = Test Two's Capsule) → LEAK confirmed:** Farmer received `{typeID: 648, ownerID: 140000002, locationID: 60000004, categoryID: 6}` — Test Two's own ship descriptor, not Farmer's.
- **`GetItems`(`[9988400091900]`) → LEAK confirmed:** returned the same foreign descriptor row.
- **`GetContainerContents`(Test Two's ship `9988400091900`) → owner-scoped, empty** (the ship branch filters by Farmer's char); **(Test Two's station `60000004`) → empty** (station branch owner-scoped). The generic flagID-0-container / mobile-depot leak branch was **NOT exercised live** — no foreign anchored/jettisoned container or mobile depot is seeded in this world (both accounts are docked; Test Two is in a bare Capsule). It is a **static reading of the handler**, same confidence level as the fleet addendum above. Kept flagged because the code path returns unowned contents with no check.
- The five safe reads were confirmed session-scoped live: `ListDroneBay([Test Two's shipID])` still returned Farmer's OWN 7-drone bay (args ignored); `GetAvailableTurretSlots([foreign])` ignored the arg; `GetDamageForCrystals([foreign itemID])` returned an empty dict (ownerID guard dropped it).

**What the web side is doing (deliberate):** the three pairs stay on `WEB_CALL_ALLOWLIST` + reachable via `/api/bridge/bound-inventory` (which issues session-scoped default args, so THAT route does not leak) — pre-plumbed so the web UI can consume them once the handlers are scoped. The leak is via `/api/bridge/call`'s verbatim arg forwarding, exactly as for the 14 above. Not de-allowlisted (operator's flag-only decision).

---

## Addendum (R77, 2026-07-22): three PLANETARY-INDUSTRY colony reads — `planetMgr.GetFullNetworkForOwner` / `GetCommandPinsForPlanet` / `GetExtractorsForPlanet`

R77 wired the 7 RB-PI bound reads (`planetMgr.GetPlanetInfo` / `GetPlanetResourceInfo` / `GetResourceData` / `GetFullNetworkForOwner` / `GetCommandPinsForPlanet` / `GetExtractorsForPlanet` / `GetProgramResultInfo`) off a `planetMgr.MachoBindObject` planetID bind. Four are safe: `GetPlanetInfo` scopes its colony body to `session.characterID` (the geography is public), and `GetPlanetResourceInfo` / `GetResourceData` / `GetProgramResultInfo` read only static per-planet resource geography / a computed extractor estimate (no colony ownership). **Three belong to the same class as the pairs above** — they return another character's private colony layout for a caller-chosen planetID/ownerID with no session check. PI colony layout (pins, links, routes, extractor programs) is private operational intel.

| # | Pair | Handler | What leaks / the trusted arg |
|---|---|---|---|
| 18 | `planetMgr.GetFullNetworkForOwner` | `planet/planetMgrService.js:1039` | caller `(planetID, ownerID)` → `planetRuntimeStore.getColony(planetID, ownerID)` (planetRuntimeStore.js:3259) keyed on the CALLER-SUPPLIED `(planetID, ownerID)` with **no session check**. Returns `[pins, links]` where pins are FULL `buildPinRow` rows — extractor cycle/heads/expiry, factory schematicID, storage `contents`, plus every link. **Another character's complete colony layout.** The "ForOwner" name is the tell; retail itself uses it cross-owner (`planetSvc.py GetColonyForCharacter` → `foreignColoniesByPlanet`). |
| 19 | `planetMgr.GetCommandPinsForPlanet` | `planet/planetMgrService.js:1056` | caller `planetID` → `listColoniesForPlanet(planetID)` (planetRuntimeStore.js:3314) iterates **ALL** colonies on the planet (no session filter) and returns a dict `{ownerID -> command-pin KeyVal{pinID,typeID,ownerID,lat,long}}`. Reveals every character with a colony on the planet + their command-center id/position. |
| 20 | `planetMgr.GetExtractorsForPlanet` | `planet/planetMgrService.js:1074` | caller `planetID` → same `listColoniesForPlanet(planetID)` across ALL owners → a list of extractor summaries `{pinID,typeID,ownerID,lat,long}`. The extractor counterpart of #19 (lower sensitivity than the full network — surface positions retail renders on the planet — but still cross-owner colony presence). |

**The fix (server-side, per handler):** `GetFullNetworkForOwner` must validate the caller `ownerID` against `session.characterID` (return `[[],[]]` for a foreign owner), OR resolve the colony from the session char and ignore the caller ownerID. `GetCommandPinsForPlanet` / `GetExtractorsForPlanet` should filter `listColoniesForPlanet` to the session char's own colony (or gate cross-owner surface data behind whatever visibility rule retail actually applies — the emulator currently applies none).

**Verified LIVE (2026-07-22, cross-account, Farmer 140000005 owns colony planetID 40009077 vs Test Two 140000002):**
- **`GetFullNetworkForOwner`(`40009077, 140000005`) from a Test Two session → LEAK confirmed:** Test Two received Farmer's complete **4-pin network + 3 links** (command / factory / extractor+heads / spaceport), not an empty result.
- **`GetCommandPinsForPlanet`(`40009077`) from Test Two → LEAK confirmed:** returned a dict keyed by **`140000005`** (Farmer) with his command pin `{pinID: 9988400018024, typeID: 2524, lat/long}`.
- **`GetExtractorsForPlanet`(`40009077`) from Test Two → LEAK confirmed:** returned Farmer's extractor `{pinID: 1054656331525, typeID: 2848, ownerID: 140000005}`.
- **The four safe reads** were confirmed live: `GetPlanetInfo`(`40009077`) as Test Two returned the planet geography with **NO colony body** (session-scoped to Test Two, who owns none); `GetPlanetResourceInfo`/`GetResourceData`/`GetProgramResultInfo` read the same static resource field for everyone.

**What the web side is doing (deliberate):** the three pairs stay on `WEB_CALL_ALLOWLIST` + reachable via `/api/bridge/bound-planet` (which defaults `ownerID` to the session's own char, so THAT route reads only the caller's own colony and does not leak). The leak is via `/api/bridge/call`'s verbatim arg forwarding (and the route's optional `?ownerID` override, used above to prove the leak), exactly as for the pairs above. Not de-allowlisted (operator's flag-only decision).

---

## Addendum (R79, 2026-07-22): two small-service-tail reads — `warRegistry.GetWarNegotiation` + `corpStationMgr.DoStandingCheckForStationService`

R79 wired the 8 RB-WARREG / RB-SCAN / RB-PITAX / RB-CORPSTN "small-service tail" bound reads (`scanMgr.GetFullState` / `GetScanTargetID`; `warRegistry.GetWars` / `GetNegotiations` / `GetWarNegotiation` / `IsAllianceOrCorpLocal`; `planetOrbitalRegistryBroker.GetTaxRate`; `corpStationMgr.DoStandingCheckForStationService`). Six are session-scoped or genuinely public and SAFE: `GetFullState` voids its args and returns the session's OWN system scan; `GetScanTargetID` derives the system from the session (siteID is a site within it); `GetWars` is public per-owner war-report data (same class as the already-allowlisted `warsInfoMgr.GetWarsByOwnerID`); `GetNegotiations` scopes to the session corp/alliance and ignores args; `IsAllianceOrCorpLocal` is a constant; `GetTaxRate` is the public per-customs-office tax float. **Two belong to the same class as the pairs above** — they take a caller-supplied id and return/evaluate another entity's private data with no session check:

| # | Pair | Handler | What leaks / the trusted arg |
|---|---|---|---|
| 21 | `warRegistry.GetWarNegotiation` | `corporation/warRegistryService.js:255` | `Handle_GetWarNegotiation(args)` takes NO `session`; `getNegotiationRecord(args[0])` → `buildWarNegotiationPayload` returns the negotiation's PRIVATE terms — `iskValue` (the surrender / ally-offer ISK amount), `description` (a free-text message), `ownerID1`/`ownerID2`, `declaredByID`/`againstID`, `negotiationState`, and the created/accepted/declined/retracted FILETIMEs — for ANY caller-supplied `warNegotiationID`. A surrender or ally offer is private between the warring parties; retail keeps it to the negotiation participants. `GetNegotiations` (the list form) is correctly session-scoped (`resolveWarEntityID(session)`), which is the tell that the single-record read is the unguarded path. |
| 22 | `corpStationMgr.DoStandingCheckForStationService` | `corporation/corpStationMgrService.js:183` | the handler reads `characterID = args[1] || session.characterID`, then drives `getCharacterEffectiveStanding(characterID, stationOwnerID)` + `getCharacterRecord(characterID).securityStatus` off that CALLER-supplied charID. A foreign `args[1]` turns the read into a STANDING / SECURITY-GATE ORACLE for another character: it returns `null` when that char PASSES the station-service gate and throws a typed `CustomNotify` naming which threshold FAILS ("standings too low" / "security too low" / "security too high"). Security status is already public, so the private bit leaked is a boolean oracle on a foreign char's standing toward the station owner. Lower sensitivity than the reads above (a boolean, not the value) but UNOWNED. |

**The fix (server-side, per handler):** `GetWarNegotiation` must validate the negotiation's `ownerID1`/`ownerID2` (or its war's parties) against the session's `resolveWarEntityID(session)` and return `null` for a negotiation the session is not a party to. `DoStandingCheckForStationService` must ignore a caller-supplied `args[1]` and always evaluate the SESSION's own char (`session.characterID`), never a foreign charID.

**Verified LIVE (2026-07-22, cross-account, Farmer 140000005 / corp 98000001 vs Test Two 140000002 / corp 98000000):**
- **`GetWarNegotiation`(`1` / `1000000`)** returned `null` from BOTH sessions — this world seeds **no war and no negotiation** (Farmer's corp 98000001 and Test Two's corp 98000000 are both in no war; `GetWars` / `GetNegotiations` are empty for both). The leak path could NOT be exercised live for lack of a seeded negotiation; it is a **static reading of the handler** (no `session` param, no ownership check), the same confidence level as the R72 fleet / R75 inventory / R77 planet addenda above.
- **`DoStandingCheckForStationService`(`[1]` / `[1, 140000002]` / `[1, 140000005]`)** returned `null` (PASS) uniformly from both sessions and for own AND injected foreign charID — Farmer's and Test Two's stations expose no station service with a non-zero `minimumStanding`, so the oracle did not differentiate live. The handler nonetheless evaluates the injected `args[1]` char's private standing (static reading); flagged conservatively.
- **The six safe reads** were confirmed live cross-account: `GetFullState` returned each session's OWN system scan (Farmer system 30000144 → one structure site; GM Elysian system 30000140 → one anomaly; Test Two system 30002780) — args are voided, no foreign-system path; `GetWars([98000000])` from Farmer returned an empty PUBLIC dict; `GetNegotiations([98000000])` ignored the injected owner and returned the session's own empty list; `GetTaxRate` returned the public `0.05` for any id.

**What the web side is doing (deliberate):** the two pairs stay on `WEB_CALL_ALLOWLIST` + reachable via `/api/bridge/bound-small-services` (which issues session-scoped default args — the standing check runs for the session's own char with no charID arg, and `?warNegotiationID` defaults to 0 → `null`, so THAT route does not leak). The leak is via `/api/bridge/call`'s verbatim arg forwarding, exactly as for the pairs above. Not de-allowlisted (operator's flag-only decision).

---

## Addendum (R80, 2026-07-22): one cross-character corp-identity read — `corpRegistry.GetInfoWindowDataForChar`

R80 wired the 11 RB-CORPREG batch-A bound reads (`corpRegistry.GetMembersPaged` / `GetMembersByIds` / `GetMember` / `GetMemberTrackingInfo` / `GetMemberTrackingInfoSimple` / `GetTitles` / `GetLabels` / `GetCorporateContacts` / `GetBulletins` / `GetEveOwners` / `GetInfoWindowDataForChar`). corpRegistry is retail-bound per corp (`eveMoniker.GetCorpRegistry(corpID)`) but the gateway dispatches these TOP-LEVEL; **ten are SESSION-CORP-SCOPED and SAFE** — every handler resolves its corp from `resolveCorporationID(session)` (or, for `GetEveOwners`, `resolveBoundCorporationID` with NO bind wired → session corp), IGNORING any caller-supplied corpID, and a foreign memberID simply misses the session corp's member table. `corpRegistry.MachoBindObject` is NOT allowlisted, so a browser cannot bind a foreign corp. **One belongs to the same class as the pairs above** — it takes a caller-chosen charID and returns the corp derived from THAT char:

| # | Pair | Handler | What leaks / the trusted arg |
|---|---|---|---|
| 23 | `corpRegistry.GetInfoWindowDataForChar` | `corporation/corpRegistryRuntime.js:2960` | `characterID = resolveCharacterID(session, args)` takes `args[0]` as a caller-chosen charID (fallback session char), then derives the corp from `getCharacterRecord(charID).corporationID` with **no session check** and returns a KeyVal of `corpID` / `allianceID` / `factionID` / the char's corp `title` PLUS `title1..title16` (the corp's full title-scheme NAMES). A foreign charID turns it into a cross-corp identity + title-scheme oracle. **Lower sensitivity** than the reads above — `corpID`/`allianceID`/`factionID`/the char's own title are retail-PUBLIC info-window fields (you see them opening anyone's character info) — but the full 16-title NAME dump of the foreign corp is more than the public info window shows, and the read is UNOWNED. Flagged conservatively. |

**The fix (server-side):** either scope the title-name dump to the caller's own corp (return `title1..16` only when `characterRecord.corporationID === session.corporationID`, blanking them for a foreign char), or validate the caller `charID` against the session and return only the genuinely-public info-window fields for a foreign char. The public fields (corpID/allianceID/factionID/the char's own title) can stay cross-character; the corp's private title scheme should not.

**Verified LIVE (2026-07-22, cross-account, Farmer 140000005 / corp 98000001 vs Test Two 140000002 / corp 98000000):**
- **`GetInfoWindowDataForChar`(`140000002`) from a Farmer session → cross-corp confirmed:** Farmer received `{corpID: 98000000, allianceID: 99000000, factionID: 500001}` — Test Two's corp + alliance, not Farmer's. The `title1..16` scheme came back EMPTY (corp 98000000 seeds no named titles this world), so the sensitive title-name payload was empty live; the corpID/allianceID cross-corp derivation is nonetheless confirmed and the title-name dump path is unguarded (static reading, same confidence level as the addenda above).
- **The ten safe reads** were confirmed SESSION-CORP-SCOPED live by injecting Test Two's corp 98000000 / member 140000002 as Farmer: `GetMemberTrackingInfo([98000000])` / `GetTitles([98000000])` / `GetLabels([98000000])` / `GetBulletins([98000000])` / `GetCorporateContacts([98000000])` all returned Farmer's OWN corp 98000001 data (args ignored); `GetMembersPaged(98000000)` returned an empty page of the OWN corp with the true total 2 (args[0] is a PAGE, not a corpID); `GetMember(140000002)` → `null`; `GetMembersByIds([140000002])` → empty list; `GetEveOwners(98000000)` returned the OWN corp's owner rows. Cross-checked against Test Two's own session (corp 98000000 = {Test Two 140000002, Test Three 140000003}), confirming Farmer never received corp 98000000's roster/titles/tracking.

**What the web side is doing (deliberate):** the pair stays on `WEB_CALL_ALLOWLIST` + reachable via `/api/bridge/corp-char-info` (which defaults `charID` to the session's own char, so THAT route reads only the caller's own info window and does not leak; the `?charID` override was used above to prove the leak). The leak is via `/api/bridge/call`'s verbatim arg forwarding (and the route's optional `?charID` override), exactly as for the pairs above. Not de-allowlisted (operator's flag-only decision).

---

## Addendum (R81, 2026-07-22): one cross-corp share-ledger read — `corpRegistry.GetShareholders`

R81 wired the 12 RB-CORPREG batch-B bound reads (`corpRegistry.GetShareholders` / `GetSharesByShareholder` / `GetMemberIDsByQuery` / `GetMemberIDsWithMoreThanAvgShares` / `GetPendingAutoKicks` / `GetNumberOfPotentialCEOs` / `GetApplications` / `GetMyApplications` / `GetMyOldApplications` / `GetOldApplications` / `GetAllianceApplications` / `GetCorpWelcomeMail`). Same top-level dispatch as batch A; `corpRegistry.MachoBindObject` is STILL NOT allowlisted, so a browser cannot bind a foreign corp. **Eleven are SESSION-CORP / SESSION-CHAR-SCOPED and SAFE** — every handler resolves its corp from `resolveCorporationID(session)` (or its char from `resolveCharacterID(session, [])`), ignoring any caller-supplied id. **One belongs to the same class as the pairs above** — the LIST form of the shares read takes a caller-chosen corpID and returns that corp's ledger with no session check. ⚠ Note the asymmetry: the brief flagged **`GetSharesByShareholder`** as the highest-risk read, but the eve.js implementation reinterprets its `args[0]` as a company-vs-personal **1/0 flag** (not a shareholder lookup) and derives both corp and shareholder from the session — it is SAFE. The unguarded read is its sibling **`GetShareholders`**:

| # | Pair | Handler | What leaks / the trusted arg |
|---|---|---|---|
| 24 | `corpRegistry.GetShareholders` | `corporation/corpRegistryRuntime.js:2189` | `corporationID = normalizePositiveInteger(args[0], resolveCorporationID(session))` takes `args[0]` as a caller-chosen corpID (fallback session corp), then returns `runtime.shares` for THAT corp — a Rowset of `[shareholderID, corporationID, shares]` per holder — with **no session/role check**. A foreign corpID turns it into a cross-corp share-ledger oracle: who owns shares in any corp and how many. Corp shareholdings are private corp intel (retail gates the shareholder list to corp directors). The single-record sibling `GetSharesByShareholder` is correctly session-scoped (corp + shareholder both from the session; `args[0]` is only a company/personal flag) — that asymmetry is the tell that the LIST form is the unguarded path. |

**The fix (server-side):** `Handle_GetShareholders` must ignore a caller-supplied `args[0]` and always read `resolveCorporationID(session)` (as its `GetSharesByShareholder` sibling and the whole rest of the batch already do), OR validate `args[0] === session.corporationID` and refuse/empty otherwise, plus the retail director-role gate.

**Verified LIVE (2026-07-22, cross-account, Farmer 140000005 / corp 98000001 vs Test Two 140000002 / corp 98000000):**
- **`GetShareholders([98000000])` from a Farmer session → LEAK confirmed:** Farmer received `[[98000000, 98000000, 1000]]` — corp 98000000's ledger (Test Two's corp holds its own 1000 shares), NOT Farmer's corp 98000001. Bidirectionally confirmed: **`GetShareholders([98000001])` from a Test Two session** returned Farmer's `[[98000001, 98000001, 1000]]`. Each session's OWN `GetShareholders([])` returns only its own corp's ledger, so the injected corpID is what redirects it. The route `/api/bridge/corp-shares?corpID=98000000` reproduced the leak through the dedicated route's optional `?corpID=` override.
- **The eleven safe reads** were confirmed live by injecting corp 98000000 as Farmer: `GetSharesByShareholder([140000002])` returned Farmer's OWN personal row `[140000005, 98000001, 0]` (the foreign id failed the `===1` flag test and fell to the session char; `[1]` → the corp's own `[98000001, 98000001, 1000]`); `GetMemberIDsByQuery([98000000,…])` / `GetNumberOfPotentialCEOs([98000000])` returned Farmer's OWN members `[140000005, 998830009]`; `GetMemberIDsWithMoreThanAvgShares` / `GetPendingAutoKicks` / `GetApplications` / `GetMyApplications` / `GetMyOldApplications` / `GetAllianceApplications` all returned Farmer's OWN (empty) results; `GetOldApplications([98000000])` returned Farmer's OWN corp 98000001 archived application (char 998830009, status 2 — `corporationID: 98000001` in the row, never 98000000); `GetCorpWelcomeMail([98000000])` returned Farmer's OWN (unset) mail. Every session-scoped read ignored the injected corpID.

**What the web side is doing (deliberate):** the pair stays on `WEB_CALL_ALLOWLIST` + reachable via `/api/bridge/corp-shares` (which defaults `corpID` to the session's own corp when `?corpID=` is omitted, so THAT route reads only the caller's own ledger and does not leak; the `?corpID=` override was used above to prove the leak). The leak is via `/api/bridge/call`'s verbatim arg forwarding (and the route's optional `?corpID=` override), exactly as for the pairs above. Not de-allowlisted (operator's flag-only decision).
