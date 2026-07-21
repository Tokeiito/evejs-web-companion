# Goal R35: Prove the distribution-mission rail, and fix the three predicates that lie

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous; operator clarified the ask is **distribution missions from an agent**, NOT player contracts). **Status:** Ready. **Client + bridge only.**

## Why this goal exists

A survey of the courier-*contract* system found a permanently empty world. **Distribution missions are the opposite** — the machinery is populated, the surface is already allowlisted, and the client is already built. What is missing is (a) proof it works on the live rail, and (b) three predicates in shipped client code that report success they did not verify.

### The data (probed, not inferred)

- `agentAuthority/data.json`: **10,941 agents, 4,421 with `missionKind: "courier"`** (1,531 at L1).
- `missionAuthority/data.json`: **2,878 missions, 616 courier** with populated `courierMission`.
- `listMissionIDsForAgent` over all 4,421 courier agents: **4,421 resolve a non-empty pool, 0 empty** (typical pool 237).
- `pickMissionForAgent` sampled over 600 courier agents: **600/600** returned a courier mission with no dungeon → `OBJECTIVE_TYPE_TRANSPORT`.
- **4,387/4,421** resolve a dropoff station distinct from pickup.
- The strict `productionMissionPolicy.json` golden gate (only 5 combat missions) applies **only** to `missionKind === "encounter"` (`missionAuthority.js:614`, applied at `:840` and `:5615`). **Couriers fall straight through to the full pool.**

### Surface: nothing new is needed

`WEB_CALL_ALLOWLIST` already carries **nine `agentMgr` pairs** (`evejsWebGatewayRuntime.js:223-231`): `GetAgents`, `MachoBindObject`, `DoAction`, `GetMissionBriefingInfo`, `GetMissionObjectiveInfo`, `GetMissionKeywords`, `GetAgentLocationWrap`, `GetStandingGainsForMission`, `GetMyJournalDetails` — plus payout reads, the inventory surface, `ship.Board`/`Undock`, and the beyonce/autopilot set. **Zero new gateway pairs and zero new BFF routes for the happy path.** The BFF routes, decoders, flow functions and UI all exist (R4/R6/R6a/R6b).

## Part 1 — Prove the rail (do this FIRST)

**Every roadmap row for this milestone says "in-process end-to-end; live spot test pending orchestrator."** It has been declared buildable, never observed. Settle that before building anything on top.

1. **Run the existing gateway-level end-to-end test** `eve.js server/tests/webGatewayCourierComplete.test.js` (2 tests): accept in person → stage cargo → deliver → `DoAction(Complete)` → record cleared, package consumed, wallet grows, LP appears, standing grows. ⚠ `seedCourierWorld` (`:208`) writes and `flushTablesSync`es the real `characters`/`items`/`missionRuntimeState`/`lpWallets` tables and restores in `t.after`. **Run it against a throwaway store directory** (R32's worker did exactly this) so `_local` is provably untouched, and verify `_local` afterwards.
2. **One real manual courier run on the live server.** Dock somewhere with courier agents, find one, Request → Accept, read the briefing, load the package, fly, deliver, Complete. Report real numbers: agent, mission, cargo type/quantity/volume, pickup, dropoff, jumps, reward, LP, standing delta.
3. **Capture the raw `GetMyJournalDetails` immediately before and after Complete**, and the raw `DoAction` result for a **refused** Complete (press it docked at the wrong station). These two captures decide the bot's entire success predicate — get the bytes, do not infer.

## Part 2 — Fix the three predicates that lie

All three are in **our** code. Fix all three; each needs its own test.

1. **`chooseAction` does not check whether the mission completed.** `web/src/app/flow.ts:3723-3728` clears the briefing and pulls rewards on a COMPLETE press **regardless of outcome**. The truthful signal is `lastActionInfo.missionCompleted === true`, set solely by `buildCompletedConversation` (`agentMissionRuntime.js:6719-6721`); a refused Complete returns `buildAcceptedConversation` with `missionCompleted: false`. The decoder already reads it (`web/src/bridge/agents.ts:148`) and the UI already gates on it (`AgentsMissions.svelte:264`) — **only the flow ignores it.**
2. **`loadPackageIntoShip` picks the wrong stack.** `flow.ts:3748` does `.find(row => row.typeID === cargoTypeID)` — the *first* hangar stack of that type, which may be the player's own goods and may be the wrong quantity. Select by the mission's actual item, and by quantity.
3. **The move is unverified.** `POST /api/bridge/inventory/move` (`src/server.js:770-779`) returns `{ok:true}` with **no re-read**. `POST /api/bridge/inventory/transfer` already exists and does it properly — reporting `applied`/`moved`/`reminted`/`declinedSilently` and judging by the **source giving something up** (the R29 new-itemID lesson, `docs/bridge-wire-contract.md:684-694`). **Re-point the courier path at `/transfer`.**

## The traps (confirmed by reading; treat as real)

- **`doAgentAction` returns `success: true` on EVERY branch** (`agentMissionRuntime.js:6725-7092`) — unavailable agent, refused remote accept, quit on a non-accepted mission, Complete at the wrong station, and the terminal fallthrough all answer 200 with a conversation. **Judge only by `lastActionInfo` and the returned `actions` list.**
- **Journal disappearance is ambiguous.** `completeMission` **deletes** `missionsByAgentID[agentID]` (`:6059`) and pushes to `history`, which `getJournalDetails` (`:6121-6148`) **never surfaces**. Quit, decline and expire delete identically. So **complete/quit/decline/expire are indistinguishable — all four are "the row is gone."** `AGENT_MISSION_STATE.COMPLETED = 4` (`agents.ts:260`) is effectively unreachable. **Never infer success from a missing row.**
- **Remote accept is silently refused for couriers** — `missionGrantsItemsOnAccept` is true for every transport mission, so `DoAction(AcceptRemotely)` returns the *offered* conversation with 200. **Accept must be in person.**
- **Standing gate:** `canUseAgent` false → `buildIdleConversation` (`:6578`) returns a message and **zero actions**. Detect `actions.length === 0`; do not retry.
- **The dropoff is not nearby.** `resolveDropoffStation` (`:1100`) takes the corp's **lowest-`solarSystemID`** station, and every agent of a corp routes to the same one. Expect long, possibly lowsec-crossing routes.
- **Cargo may not fit** — median 0.1 m³ but up to **4,000 m³**. Check `invbroker.GetCapacity` (allowlisted) **before** accepting.
- **`getCourierProgress` judges by typeID, not itemID** (`:2524-2588`) — pre-existing stock of the cargo type at the dropoff can make `objectiveCompleted` true without hauling anything. Server-side; **mark it, do not fix it.**
- **Chain fragments:** the pool is full of "(2 of 5)" missions whose `nextMissionIDs` drive `advanceConversationMission`. Note whether a chain is entered.

## Hard rules

- **Client and bridge only.** If you find a server-side defect (e.g. `getCourierProgress`), **report it — do not fix it.** The operator has been explicit.
- **A 200 is not proof** — nine confirmed silent-decline cases, and `doAgentAction` above is a tenth pattern.
- **Watch every new test fail** before trusting it. Four tests in this repo were recently found green while asserting nothing — including three id sweeps using ``new RegExp(`\b${id}\b`)``, where a template-literal `\b` is the BACKSPACE character. Prefer fixtures built from **real captured bytes**.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1300/1300**), `tsc` + `build:web` clean.
2. Part 1, reported with real captures. Then Part 2, each fix with its own test.
3. Roadmap R35 row + `docs/bridge-wire-contract.md` if the contract changes. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The distribution-mission rail is observed working live end to end with real numbers; the raw before/after journal and refused-Complete captures are recorded; and the three lying predicates are fixed and tested. This unblocks the mission bot (a later goal) — **do not build the bot here.**

## Constraints

- **Zero eve.js source changes.** Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode`; never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green.
- Servers up: :26002 EveJS (detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. Leave the character docked and sane; release the session. **Two untracked files `icon-typeids*.txt` in the repo root are the orchestrator's — leave them.**
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because it reports `visibilityState === "hidden"` with a 0×0 viewport. Expected. `get_page_text`/`read_page` work. Say plainly what you could not see.
