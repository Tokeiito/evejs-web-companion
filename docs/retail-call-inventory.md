# Courier-path retail call inventory

**Status:** Complete — Goal R0, produced 2026-07-18 by a worker session. This manifest maps every courier-milestone UI action (roadmap §7, the 12 steps) to the exact retail service calls the decompiled EVE client (release V24.01) makes, and cross-checks each against EveJS's `Handle_*` handlers. It is the specification the R1+ bridge and page migrations are built from. See [web-client-scope-and-roadmap.md](web-client-scope-and-roadmap.md) for architecture and rules.

## Test baseline (re-established before this doc; no code changed in either repo)

| Suite | Command | Result |
| --- | --- | --- |
| Web full suite | `npm test` (`node --test`, web repo) | **105 / 105 pass** — matches last-known 105/105 (2026-07-15) |
| EveJS manifest checks | `npm run test:manifest:check` (eve.js) | **3 / 3 pass** — matches last-known 3/3 |
| EveJS courier-relevant focused slice | `npm run test:agent-parity` (eve.js; 6 files) | **5 / 6 files pass; 1 file fails** — `agentMissionRuntime.test.js` has 4 failing assertions (see below) |

Notes on the baseline:
- No single npm script reproduces the exact "65/65 focused" curated selection cited on 2026-07-15, so this run used the manifest checks plus the courier-relevant `test:agent-parity` slice as the focused suite. Counts above are what was actually observed.
- **`agentMissionRuntime.test.js` failures (pre-existing drift in read-only eve.js):** 4 assertions about **remote vs. in-person mission acceptance and courier cargo-staging** — the exact semantics that decide whether a browser (a remote, non-co-located client) may accept/complete a courier mission. Failing assertions (eve.js `server/tests/agentMissionRuntime.test.js`): `:3487` "fetch-family mission payloads … remote-offerable but non-remote-completable journal flags" (`1 !== true`), `:3524` "offered encounter missions are advertised as remotely acceptable" (`1 !== true`), `:3560` "courier missions that stage cargo on accept are not remotely acceptable" (`0 !== false`), `:3594` "a remote accept for an in-person-only courier mission is refused and left offered". Three are int-vs-boolean typing on the journal remote-acceptance flags; one is behavioral. Not fixed here (eve.js is read-only this goal; hardening EveJS parity is out of scope). Flagged for **R4** — see gap G3.
- eve.js worktree carries one **pre-existing, unrelated** working-tree modification (`parity/work-items/GAME-011.json`, combat/module-overload parity prose). It was left untouched and not reverted (roadmap §10). This goal made **no commits to eve.js**.

## Sources and method

- **The spec (client, read-only):** `eve.js/tools/ClientCodeGrabber/Latest` (V24.01, ~12,500 modules, 269 MB). Mined `.py` files only (`.pyc`/`.pyj` are redundant). Every server-crossing call is `sm.RemoteSvc('svc').M(...)` (server tier), `sm.ProxySvc('svc').M(...)` (proxy tier), or a method on a **bound object** returned by a prior server call.
- **The server (read-only):** `eve.js/server/src/services` (~200 service files). A client `sm.RemoteSvc('name')` resolves to the EveJS service registered via `super("name")` (`serviceManager.lookup(name)` → `service.callMethod(method, args, session, kwargs)` → `Handle_<method>`). Bound-object methods dispatch on the OID the creating service returned from `Handle_MachoBindObject`.
- Every call-site line number below was mined from the client; every `Handle_*` line number was verified against the EveJS source.

### Call-tier conventions used in the tables

- **server** — `sm.RemoteSvc('svc').Method(...)`.
- **bound** — a two-step call: a prior server call returns a bound object (a moniker/OID) and the method is invoked on it. The origin call is named in the row. In EveJS these route through the creating service's `Handle_MachoBindObject` and then `Handle_<method>` on that service.
- **client-local** — `sm.GetService(...)` or a client setting; **no wire call**. Listed only when a milestone step needs it, so the bridge knows there is nothing to replay.

## Coverage-gap summary

Legend: **Covered** = a matching `Handle_*` exists and fits the call. **Partial** = handler exists but the courier-relevant behavior is at risk or narrowed. **Missing** = no handler / no server call to build on. **N/A** = retail does no wire call here.

| # | Gap | Steps | Severity | Blocks | Detail |
| --- | --- | --- | --- | --- | --- |
| **G1** | **No server-owned travel/autopilot orchestrator** | 7–9 | **High** | **R5** | EveJS has every atomic travel command (`beyonce.CmdWarpToStuffAutopilot`/`CmdFollowBall`/`CmdStargateJump`/`CmdDock`, `structureJumpBridgeMgr.CmdJumpThroughStructureStargate`), but the 2-second decide-loop that sequences warp→approach→jump→dock lives in the **client** (`autopilot.py AutoPilot.Update`). `beyonceService.js:2901-2902` explicitly treats autopilot navigation as client-local. Per roadmap §7 the browser must not drive movement with timers, so EveJS must gain an authoritative travel job that replays that loop. This is the single largest build item and is expected by the roadmap. |
| **G2** | **Route/destination state is client-only** | 7–8 | **High** | **R5** | `starmap.SetWaypoints` writes the `autopilot_waypoints` char-UI setting and solves the path with the **client-local** `clientPathfinderService` (`starMapSvc.py:2363`). No `RemoteSvc` stores waypoints or destination. The travel job (G1) must own route + pathfinding server-side; there is no retail call to mirror. |
| **G3** | **Courier remote-acceptance semantics partial / failing** | 3, 11 | **High** | **R4** | Accept/decline/complete all route through `agentMgr(bound).DoAction(actionID)` → `agentMissionRuntime.doAgentAction`, which is implemented — but the parity oracle currently fails 4 assertions on whether a cargo-staging courier is remotely acceptable vs in-person-only and on the journal `remotelyAcceptable/Completable` flag types (see baseline). A browser is a remote client, so this is the rule that governs Step 3/11 for it. Resolve in eve.js before R4 is trustworthy. |
| **G4** | **`invbroker.SplitStack` missing** | 5 | Low | — | Right-click **Divide/Split stack** (`invItemFunctions.py:398`, on the manager moniker) has no `Handle_SplitStack`. Low impact: the drag-move path folds a partial quantity into `Add(qty)` / `MultiMerge(op qty)`, so moving a courier package needs no split call. Only an explicit "divide stack" action would fail. |
| **G5** | **`populationCap.MoveCharacterToNewSystem` missing** | 1 | Low | — | Only fires on the congested-system relocation branch (when `GetCharacterLoadSlot` returns >1 slot). Normal single-slot logins never call it. `populationCapService.js` implements only `GetCharacterLoadSlot` + bind plumbing. |
| **G6** | Notification forwarding, not a handler gap | 12 (and 3–11) | Med | R4–R6 | Wallet/LP/standings updates after completion arrive as **server pushes** (`OnAccountChange`, `OnLPChange`, `OnStandingSet`/`OnStandingsModified`), and mission dialogue uses `OnAgentProvisionalResponse`. The reads below are the pull-refreshes issued when a panel (re)opens. The browser-backed session must capture these notifications and the bridge must forward them as browser events (already a roadmap §9 risk row). |

**Minor caveats (non-blocking):** `agentMgr.GetMissionObjectiveInfo`/`GetMissionJournalInfo` ignore the client's optional `charID`/`contentID`/`ignoreLocateCheck` kwargs (fine for own-character courier; would not serve fleet-member reads). `beyonce.CmdTurboDock` missing (GML/admin-only). LP store has a dead-stub `Handle_GetAvailableOffersFromCorp` on the wrong service (`lpService.js:154`), shadowed by the real one on `LPStoreMgr` — harmless. `agentMgr.IsCheatingWithAgent`/`ShouldAlwaysAllowReplay` are `return false` stubs — non-blocking.

**Otherwise: coverage is strong.** Steps 1, 2, 4, 5 (move/stack/merge), 6, 10, and 12 are fully served by existing handlers. The courier loop is buildable; travel (G1/G2) is the real net-new server work, and Step 3/11 remote-acceptance (G3) is the correctness risk.

---

## Step 1 — Log in and select an offline character

The web login is who-cares by policy (roadmap §6); the retail calls below are the character-selection + docked-entry surface EveJS must serve once a character is chosen.

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Char-select screen builds its list | server | `charUnboundMgr.GetCharacterSelectionData` | `()` → `(userDetails, trainingDetails, characterDetails, wars)` | `loginCharacterselection/charselData.py:31` (UI `…/charSelection/characterSelection.py:316`) | `charService.js:595` — **Covered** |
| Lapsed-sub warning on refresh | server | `charUnboundMgr.GetCharOmegaDowngradeStatus` | `()` | `…/charSelection/characterSelection.py:301` | `charService.js:1253` — **Covered** |
| Click a character slot (pre-login guard) | server | `multiLoginBlocker.Login` | `Login(computerhash)` | `…/charSelection/characterSelection.py:624` | `multiLoginBlockerService.js:161` — **Covered** |
| Confirm selection → query load slot | bound (`populationCap`) | `populationCap→binding.GetCharacterLoadSlot` | `(charID)`; origin `Moniker('populationCap',(charID,groupCharacter))` at `characterSelection.py:749` | `…/charSelection/characterSelection.py:750` | `populationCapService.js:159` — **Covered** |
| Congested-system relocation (only if >1 slot) | bound (`populationCap`) | `populationCap→binding.MoveCharacterToNewSystem` | `(charID, selectedSolarSystemID, slotKey)` | `…/charSelection/characterSelection.py:758` | **Missing (G5)** — only the congested branch |
| Pre-select lock check | server | `charUnboundMgr.GetCharacterLockType` | `(charID)` | `…/charSelection/characterSelection.py:695` | `charService.js:1511` — **Covered** |
| **Bring the offline character online** | server | `charUnboundMgr.SelectCharacterID` | `(charID, secondChoiceID, skipTutorial)` via `PerformSessionChange('charsel',…)` | `…/charSelection/characterSelection.py:713` (char-create path `ccSvc.py:186`) | `charService.js:1258` — **Covered** (ownership + deletion-queue + character-control preflight, then session change) |
| Docked entry: station info | server | `map.GetStationInfo` | `()` (all-station table by `stationID`) | `eve/client/script/ui/services/uisvc.py:246` (`station/base.py:185`) | `mapService.js:601` — **Covered** |
| Docked entry: station item bits | server | `stationSvc.GetStationItemBits` | `()` → `Row(ownerID,itemID,operationID,stationTypeID)` | `eve/client/script/ui/station/base.py:575` | `stationService.js:106` — **Covered** (`StationSvcAlias extends StationService`, `super("stationSvc")`) |
| Docked entry: station guests | server | `station.GetGuests` | `()` → `[(charID,corp,alliance,warFaction)]` | `eve/client/script/ui/station/base.py:103` (`stationController.py:48`) | `stationService.js:123` — **Covered** (`super("station")`) |

Character-management (delete) calls exist on the same screen but are tangential to courier Step 1 and all covered: `charUnboundMgr.DeleteCharacter` (`charService.js:1462`), `PrepareCharacterForDelete` (`:1447`), `CancelCharacterDeletePrepare` (`:1456`).

Client-local only (no wire call): `jumpQueue.PrepareQueueForCharID`/`GetPreparedQueueCharID`, and `sessionMgr.PerformSessionChange` orchestration. After `SelectCharacterID`, the station/hangar view and guest panel load in response to a **server-pushed** `OnSessionChanged` carrying `stationid`/`locationid` — the entry reads above are triggered by that push (G6).

---

## Step 2 — View available agents and open an agent conversation

Architecture: `sm.GetService('agents')` is **client-local**. The wire object is the **agent moniker** `agents.GetAgentMoniker(agentID)` → `eveMoniker.GetAgent(agentID)` → `Moniker('agentMgr', agentID)` (`eveMoniker.py:157`). Every conversation/mission action is a single `moniker.DoAction(actionID)` — there is **no** `RemoteAcceptMission`/`CompleteMission`/`DeclineMission` method in V24.01. All agent handlers are in `agent/agentMgrService.js`; the runtime is `agent/agentMissionRuntime.js`; bound agentID resolves via `_resolveBoundAgentID(session)` (`agentMgrService.js:562`).

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Populate agent list (Agency / station agents) | server | `agentMgr.GetAgents` | `().Clone()` → rowset(agentID, agentTypeID, divisionID, level, stationID, corporationID, isLocator…) | `eve/client/script/ui/station/agents/agents.py:92` | `agentMgrService.js:638` — **Covered** |
| Acquire the agent bound object | (bind) | `agents.GetAgentMoniker` → `Moniker('agentMgr', agentID)` | `(agentID[, stationID])` | `agents.py:316-323`; `eveMoniker.py:151-157` | routes to `Handle_MachoBindObject` `agentMgrService.js:628` — **Covered** |
| Open the agent conversation | bound (`agentMgr`) | `agentMgr(bound).DoAction` | `DoAction(None)` → `((agentSays, availableActions), lastActionInfo)` | `agents.py:675-686` → `agentDialogueWindow.py:183,402-403,428` (new UI `evemissions/client/missioncontroller.py:257,262`) | `agentMgrService.js:748` — **Covered** |
| Disabled-missions / support reads | server | `agentMgr.GetDisabledMissions` / `GetCompletedCareerAgentIDs` / `GetSolarSystemOfAgent` | `()` / `(agentIDs)` / `(agentID)` | `agents.py:359` / `:219` / `:801` | `agentMgrService.js:693` / `:683` / `:678` — **Covered** |

---

## Step 3 — Request and accept a courier mission

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Click Request / View / **Accept** / Decline button | bound (`agentMgr`) | `agentMgr(bound).DoAction` | `DoAction(actionID)` — server-assigned per-conversation action id (Accept/Decline/Request/View); button consts `agentConst.py:19-37` | `agentDialogueWindow.py:387-392` → `:427-428` | `agentMgrService.js:748` → `agentMissionRuntime.doAgentAction` — **Partial (G3)**: remote-accept semantics fail 4 parity assertions |
| Decline an un-accepted offer from the journal | bound (`agentMgr`) | `agentMgr(bound).RemoveOfferFromJournal` | `()` | `missionentry.py:75` → `agents.py:782-783` | `agentMgrService.js:856` — **Covered** |

`DoAction` decline triggers a client confirmation round-trip (server push `OnAgentProvisionalResponse`, `agentMgrService.js:755-809`) before the decline commits — the bridge must forward that provisional notification (G6).

---

## Step 4 — Read the mission briefing (cargo, pickup, destination, reward, time bonus)

All reads are on the agent bound object (Step 2 moniker).

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Briefing header (title, times, image) | bound (`agentMgr`) | `agentMgr(bound).GetMissionBriefingInfo` | `()` → dict by `agentMissionBriefing*` (missionID, titleID, briefingID, declineTime, expirationTime, acceptTimestamp…) | `agents.py:749-750`; `agentDialogueWindow.py:234`; `missioncontroller.py:285` | `agentMgrService.js:819` — **Covered** |
| Objectives + **courier cargo/pickup/dropoff** + rewards + **time bonus** | bound (`agentMgr`) | `agentMgr(bound).GetMissionObjectiveInfo` | `()` (also `(charID, contentID)` / `ignoreLocateCheck=True` variants) → transport/fetch tuples: pickup, dropoff, `cargo{typeID,quantity,volume,hasCargo,locationID}`, `normalRewards`, `bonusRewards`(time-bonus interval), `collateral`, `loyaltyPoints` | `agentDialogueWindow.py:222,431`; `missioncontroller.py:252`; `jobboard/…/job.py:413,473` | `agentMgrService.js:837` — **Covered** (ignores optional `charID`/`contentID`/`ignoreLocateCheck` — own-char only; minor caveat) |
| Standing gains preview | bound (`agentMgr`) | `agentMgr(bound).GetStandingGainsForMission` | `(missionID)` | `missioncontroller.py:224` | `agentMgrService.js:880` — **Covered** |
| Briefing message keyword substitution | bound (`agentMgr`) | `agentMgr(bound).GetMissionKeywords` | `(contentID)` | `agents.py:626-634` | `agentMgrService.js:846` — **Covered** |
| Agent-location header | bound (`agentMgr`) | `agentMgr(bound).GetAgentLocationWrap` | `()` | `agentDialogueWindow.py:276` | `agentMgrService.js:863` — **Covered** |

---

## Step 5 — Move mission cargo into the active ship

The invbroker **two-step** binding is the core pattern. `inventoryMgr.GetInventory*/…` returns an inventory **binding** (an OID); the mutation (`Add`/`MultiAdd`/`MultiMerge`/`StackAll`) is dispatched on that binding. The destination inventory + item flag are captured server-side at bind time (`Handle_MachoBindObject` reads `bindParams[0]=inventoryID`, `bindParams[1]=flag`), so on the wire the mutation args do **not** repeat the destination — it is the bound OID.

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Open station hangar (bind) | bound (`invbroker`) | `invbroker(mgr)→binding.GetInventory` | `(containerHangar, None)`; mgr = `Moniker('invbroker',(stationID,groupStation))` | origin `invCache.py:528`; ctrl `invControllers.py:1153` | `invBrokerService.js:5933` — **Covered** |
| List hangar contents | bound (`invbroker`) | `invbroker→binding.List` | `(flag=flagHangar)` | `invCache.py:1138`; ctrl `invControllers.py:108` | `invBrokerService.js:6265` — **Covered** |
| Open active-ship cargo (bind) | bound (`invbroker`) | `invbroker(mgr)→binding.GetInventoryFromId` | `(itemid=shipID, passive=0, locationID=session.stationid)` | origin `invCache.py:559`; ctrl `invControllers.py:638` | `invBrokerService.js:6082` — **Covered** |
| List cargo contents | bound (`invbroker`) | `invbroker→binding.List` / `ListByFlags` | `(flag=flagCargo)` / `(flags=[…])` | `invCache.py:1138` / `:1174` | `invBrokerService.js:6265` / `:6401` — **Covered** |
| **Drag ONE item hangar→cargo** | bound (`invbroker`) | `invbroker→binding.Add` | `(itemID, sourceLocationID=stationid, qty=quantity [partial ⇒ split], flag=flagCargo)`; dest = bound OID | ctrl `invControllers.py:213`; wire `invCache.py:1020` | `invBrokerService.js:7286` — **Covered** (split folds into `qty`; no separate Split call on drag path) |
| Drag MULTIPLE items | bound (`invbroker`) | `invbroker→binding.MultiAdd` | `(itemIDs[], sourceID=stationid, flag=flagCargo)` | ctrl `invControllers.py:558`; wire `invCache.py:1058` | `invBrokerService.js:7679` — **Covered** |
| Drop onto an existing stack (merge) | bound (`invbroker`) | `invbroker→binding.MultiMerge` | `(ops=[(srcItemID,destItemID,qty)], sourceContainerID)` | ctrl `invControllers.py:335`; wire `invCache.py:1124`; UI `item.py:1075` | `invBrokerService.js:7242` — **Covered** |
| Stack All (cargo) | bound (`invbroker`) | `invbroker→binding.StackAll` | `(flag=flagCargo)` | ctrl `invControllers.py:387`; wire `invCache.py:1093` | `invBrokerService.js:7185` — **Covered** |
| Right-click **Divide/Split** stack | server (mgr moniker) | `invbroker(mgr).SplitStack` | `(stationID, itemID, qty, ownerID)` | `menuSvcExtras/invItemFunctions.py:398` | **Missing (G4)** — no `Handle_SplitStack` (low impact for courier) |

Bind plumbing is covered by `invBrokerService.js` `Handle_MachoBindObject` (`:8598`); row-header/priming reads `GetItemDescriptor` (`:8547`) and `GetSelfInvItem` (`:6734`) are covered.

---

## Step 6 — Verify the active ship has sufficient cargo capacity

**Retail does no wire call here.** The client reads capacity locally: `sm.GetService('invCache').GetInventoryFromId(shipID).GetCapacity(flagCargo)` (`invCache.py:1224`) returns `Row(capacity, used)` where `capacity` = the ship's `attributeCapacity` **dogma attribute** (`clientDogmaIM.py:90`, static fallback `evetypes.GetCapacity(typeID)`) and `used` = a client-side sum of item volumes over the locally-cached cargo list. Example call site `dna.py:134`.

| UI action / trigger | Tier | Service.Method | Args | Client file:line | EveJS coverage |
| --- | --- | --- | --- | --- | --- |
| Read cargo-hold capacity / used | client-local | `invCache.GetInventoryFromId(shipID).GetCapacity` | `(flagCargo)` → `Row(capacity, used)` | `invCache.py:1224` (cargo branch `:1280-1290`) | **N/A** — no wire call. If the bridge wants a server-authoritative number, `invbroker.GetCapacity` exists (`invBrokerService.js:7168`). Otherwise the bridge needs the ship's `attributeCapacity` dogma value + the cargo item list (both delivered by the `Board` response and inventory load). |

---

## Step 7 — Take browser control and start the route (board ship, undock, set destination)

"Take browser control" is web-side (lease machinery, roadmap §5). The server-crossing parts are boarding the ship and undocking; setting the route has **no** wire call.

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| **Board / make-active** a ship in the station hangar | bound (`ship`) | `ship→binding.Board` | `(shipID, session.shipid)` → shipState tuple; origin `eveMoniker.GetStationShipAccess()` = `Moniker('ship',(stationid,groupStation))` (`eveMoniker.py:52`) via `PerformSelectiveSessionChange('board',…)` | `eve/client/script/dogma/clientDogmaLocation.py:243` | `shipService.js:1666` — **Covered** (`args[0]=shipID`, `args[1]=oldShipID`; `MakeShipActive` is client-local and wraps this) |
| Board a stored ship from a Ship Maintenance Array (in-space alt) | bound (`ship`) | `ship→binding.BoardStoredShip` | `(structureID, shipID)` | `menuFunctions.py:218` (`menusvc.py:3190`) | `shipService.js:1602` — **Covered** |
| **Undock** from the station | bound (`ship`) | `ship→binding.Undock` | `(shipID, ignoreContraband, onlineModules=onlineModules)` via `PerformSessionChange('undock',…)`; origin `gameui.GetShipAccess()` = `Moniker('ship',(stationid,groupStation))` (`base.py:490`) | `eve/client/script/ui/station/base.py:498` (from `undockingSvc.py:125`) | `shipService.js:1720` — **Covered** (`onlineModules` must be kwarg, not positional) |
| Undock from a player structure (alt) | server | `structureDocking.Undock` | `(session.structureid, shipID, ignoreContraband=…)` | `…/services/structure/structureDocking.py:36` | `structureDockingService.js:162` — **Covered** |
| Set destination / waypoints | client-local | `starmap.SetWaypoints` → `SetCharUiSetting('autopilot_waypoints', …)` + `UpdateRoute()` | waypoints list | `…/ui/shared/maps/starMapSvc.py:2363` | **N/A / Missing (G2)** — no wire call; route solved by client-local `clientPathfinderService`. Bridge/travel-job must own route state. |

---

## Step 8 — Undock and travel through every required gate (server-owned autopilot)

The client autopilot (`autopilot.py AutoPilot.Update`) is a 2-second loop that decides warp vs approach vs jump each tick and issues the atomic commands below. The **remote park** is `michelle.GetRemotePark()` → `Moniker('beyonce', solarsystemID)` (`michelle.py:1709`, `eveMoniker.py:141-144`), so every `park.Cmd*` is a **bound call to `beyonce`** → `ship/beyonceService.js`.

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Warp to next gate/celestial (autopilot) | bound (`beyonce`) | `beyonce.CmdWarpToStuffAutopilot` | `(destinationID)` | `autopilot.py:465` | `beyonceService.js:2958` — **Covered** |
| Warp to (manual "Warp to") | bound (`beyonce`) | `beyonce.CmdWarpToStuff` | `(subject, itemID, minRange=warpRange)` | `menuSvcExtras/movementFunctions.py:452` (`michelle.py:733,737`) | `beyonceService.js:2527` — **Covered** |
| Approach (autopilot: set speed + follow) | bound (`beyonce`) | `beyonce.CmdSetSpeedFraction` + `beyonce.CmdFollowBall` | `(1.0)`; `(destinationID, 0.0)` | `autopilot.py:451`, `:454` | `beyonceService.js:2483`, `:2454` — **Covered** |
| Approach (manual) | bound (`beyonce`) | `beyonce.CmdFollowBall` | `(targetID, approachRange)` | `movementFunctions.py:302` | `beyonceService.js:2454` — **Covered** |
| **Stargate jump** (autopilot) | bound (`beyonce`) | `beyonce.CmdStargateJump` | `(destID, theJump.toCelestialID, session.shipid)` via `PerformSessionChange('autopilot',…)` | `autopilot.py:358` | `beyonceService.js:3012` — **Covered** |
| Stargate jump (manual menu) | bound (`beyonce`) | `beyonce.CmdStargateJump` | `(stargateID, beaconID, session.shipid)` | `stargate/client/gateJumpSvc.py:124` | `beyonceService.js:3012` — **Covered** (both arg shapes → `(fromStargateID,toStargateID,requestedShipID)`) |
| Jump through an Upwell **jump gate** | server | `structureJumpBridgeMgr.CmdJumpThroughStructureStargate` | `(destID)` via `PerformSessionChange('autopilot',…)` | `autopilot.py:349` (alt `menusvc.py:2106`) | `structureJumpBridgeMgrService.js:633` — **Covered** |
| *(orchestration of the above)* | — | *client-side loop `AutoPilot.Update` / `NavigateSystemTo`* | — | `autopilot.py:274`, `:488` | **Missing (G1)** — no server travel job replays this loop |

`menusvc.GetCloseAndTryCommand` (`menusvc.py:3698`) is just the client-side `autoPilot.NavigateSystemTo` loop issuing the bound `beyonce` calls until in range; no extra wire call.

---

## Step 9 — Dock at the destination station

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Dock at the NPC station (autopilot final / manual) | bound (`beyonce`) | `beyonce.CmdDock` | `(itemID, session.shipid)` via `GetMenuService().Dock(destID)` → `RealDock` → `PerformSessionChange('dock',…)` | `autopilot.py:396`; `movementFunctions.py:517`; `menusvc.py:2981` | `beyonceService.js:2973` — **Covered** (dock check → `acceptDocking`, else docking-approach) |
| Dock at a player structure (alt) | server | `structureDocking.Dock` | `(structureID, session.shipid)` | `…/services/structure/structureDocking.py:69` | `structureDockingService.js:119` — **Covered** |

---

## Step 10 — Deliver the required cargo

For a courier mission there is **no distinct delivery RPC**. The cargo is ordinary inventory (moved in Step 5 / carried in the ship); the client only reads cargo/dropoff state and lets the Complete action (Step 11) validate delivery server-side.

| UI action / trigger | Tier | Service.Method | Args | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Check the package is at the drop-off | bound (`agentMgr`) | `agentMgr(bound).GetMissionObjectiveInfo` / `GetMissionJournalInfo` | `()` → `cargo['hasCargo']`, dropoff `locationID`; `is_dropoff_complete = at_dropoff and has_cargo` | `missioncontroller.py:318-336`; `CheckCourierCargo`→`GetMissionJournalInfo()` `agents.py:755-762` | `agentMgrService.js:837` / `:828` — **Covered** (delivery finalized by `DoAction(complete)`) |

---

## Step 11 — Complete the mission through the agent interface

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Click **Complete Mission** | bound (`agentMgr`) | `agentMgr(bound).DoAction` | `DoAction(actionID)` — Complete / CompleteRemotely action (`agentConst.py:24-25`); returns `lastActionInfo['missionCompleted']=True` + reward payload | `agentDialogueWindow.py:428`; `missioncontroller.py:257` | `agentMgrService.js:748` → `agentMissionRuntime.doAgentAction` — **Partial (G3)**: remote-complete flagged by the same failing assertions |

---

## Step 12 — Observe updated wallet, loyalty points, standings, journal

The actual bump after completion arrives via **server push** (G6); the calls below are the pull-refreshes issued when a wallet/standings/journal panel (re)opens.

| UI action / trigger | Tier | Service.Method | Args (call-site shapes) | Client file:line | EveJS `Handle_*` / verdict |
| --- | --- | --- | --- | --- | --- |
| Personal ISK balance | server | `account.GetCashBalance` | `(0)` personal / `(1, accountKey=…)` corp | `…/neocom/wallet/walletSvc.py:41,48,158` | `accountService.js:537` — **Covered** |
| **Wallet journal** (mission ISK reward entry) | bound (`account`) | `account.GetTransactions` | `(accountingKeyCash, year, month, False)` | `…/services/accountsvc.py:116` | `accountService.js:666` — **Covered** |
| Journal ref-type names | bound (`account`) | `account.GetEntryTypes` | `()` | `…/services/accountsvc.py:89` | `accountService.js:574` — **Covered** |
| Corp wallet divisions header | bound (`account`) | `account.GetWalletDivisionsInfo` | `()` | `…/services/accountsvc.py:135` | `accountService.js:593` — **Covered** |
| **LP balance** for the mission's corp | server | `LPSvc.GetAllMyCharacterWalletLPBalances` | `()` → `[issuerCorpID, amount]` | `…/neocom/wallet/loyaltyPointsWalletSvc.py:31` | `lpService.js:93` — **Covered** |
| Corp LP balances | server | `LPSvc.GetAllMyCorporationWalletLPBalances` | `()` | `…/neocom/wallet/loyaltyPointsWalletSvc.py:37` | `lpService.js:100` — **Covered** |
| LP store offers for the corp | server | `LPStoreMgr.GetAvailableOffersFromCorp` | `(corpID)` | `…/station/loyaltyPointStore/lpStoreSvc.py:98` | `lpStoreMgrService.js:520` — **Covered** (dead stub on `LPSvc:154` is shadowed) |
| Standings toward agent/corp/faction | server | `standingMgr.GetCharStandings` / `GetCorpStandings` / `GetNPCNPCStandings` | `()` | `…/services/standingsvc.py:119` / `:126` / `:115` | `standingMgrService.js:197` / `:205` / `:192` — **Covered** |
| **Post-completion standing-gain history** | server | `standingMgr.GetStandingTransactions` | `(fromID, toID)` e.g. `(agentCorpID, charid)` | `…/services/standingsvc.py:178` | `standingMgrService.js:213` — **Covered** |
| Standing tooltip breakdown | server | `standingMgr.GetStandingCompositions` | `(fromID, toID)` | `…/services/standingsvc.py:283` | `standingMgrService.js:222` — **Covered** |
| Mission journal (Neocom) | server | `agentMgr.GetMyJournalDetails` | `()` → `[activeMissions, offeredMissions,…]`; per-agent bound variant at `journal.py:325` | `…/ui/shared/neocom/journal.py:312,331` | `agentMgrService.js:710` — **Covered** |

Corrections to prior assumptions: the standings RPC service is **`standingMgr`** (not `standing2`/`charMgr GetMyStandings`, which do not exist in the client). There is no session-field balance; `GetCashBalance` is authoritative. Market transactions (`marketProxy.CharGetTransactions`, `marketSvc.py:23`) belong to the market tab, not the reward path.

---

## Appendix — courier-path service-name → EveJS file map

Client `sm.RemoteSvc('name')` (or bound moniker service) → EveJS file registered via `super("name")`:

| Client service | EveJS file (`server/src/services/…`) |
| --- | --- |
| `charUnboundMgr` | `character/charService.js` |
| `charMgr` | `character/charMgrService.js` |
| `multiLoginBlocker` | `login/multiLoginBlockerService.js` |
| `populationCap` | `populationCap/populationCapService.js` |
| `map` | `map/mapService.js` |
| `station` / `stationSvc` | `station/stationService.js` (+ `StationSvcAlias`) |
| `agentMgr` | `agent/agentMgrService.js` (runtime `agent/agentMissionRuntime.js`) |
| `invbroker` | `inventory/invBrokerService.js` |
| `ship` | `ship/shipService.js` |
| `beyonce` (remote park) | `ship/beyonceService.js` |
| `structureJumpBridgeMgr` | `structure/structureJumpBridgeMgrService.js` |
| `structureDocking` | `structure/structureDockingService.js` |
| `account` | `account/accountService.js` |
| `LPSvc` | `corporation/lpService.js` |
| `LPStoreMgr` | `evermarks/lpStoreMgrService.js` |
| `standingMgr` | `character/standingMgrService.js` |
