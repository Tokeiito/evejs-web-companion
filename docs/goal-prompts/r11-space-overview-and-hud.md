# Goal R11: Space overview + ship HUD

**Issued:** 2026-07-19 by the orchestrator (Phase 3). **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

In space the player is currently blind: they can only warp to IDs something else hands them (a route gate, a station, an agent's location). This goal gives them **an overview of what is actually around the ship** — with warp-to/approach on any entry — and a **real shield / armor / hull / capacitor HUD**.

## What the research established (verified — build on this)

**Retail is a client-side view over one server structure.** The overview enumerates the `destiny.Ballpark` ("michelle") balls paired with their slimItems; the server pushes ball add/remove/state and the client **dead-reckons positions locally and re-renders every 0.5–1.0 s**. Distance math, sorting, filtering, and naming are all client-side. The HUD is a *different* source: shield/armor/hull/cap for the **active ship** come from dogma (`godma.GetItem(shipID)`), not the ballpark; other entities' damage bars come from ballpark `damageState` fractions.

**⇒ Polling is faithful here, not a compromise.** A ~1 s snapshot poll matches retail's own re-render cadence. **This goal does NOT require the R10 push channel** — build it on request/response, exactly like `readFlightStatus` does (hold session → reach into the space runtime → return JSON).

**EveJS server-side surface (all authoritative, in-process):**
- `server/src/space/runtime.js:22958` **`getVisibleEntitiesForSession(session, now)`** — statics + dynamics, cloak-filtered. **This is the one call an overview read needs.**
- Façade a gateway should call: `runtime.js:36897` `getSceneForSession(session)`, `:36930` `getEntity(session, entityID)`. Also `:23142` `getShipEntityForSession(session)` (the ego ball), `:23093` `getEntityByID`.
- **Call before reading** (exactly as `ensureInitialBallpark` does at `runtime.js:31894-31900`): `runtime.js:6775` `refreshEntitiesForSlimPayload(entities)` and `:5790` `refreshShipPresentationFields(entity)`.
- Entity shapes: static `runtime.js:9109 buildStaticCelestialEntity` → `{kind, itemID, typeID, groupID, categoryID, itemName, ownerID, radius, position:{x,y,z}, velocity}`; ship `runtime.js:18200-18260 buildShipEntityCore` adds `slimName, characterID, corporationID, allianceID, securityStatus, maxVelocity, capacitorChargeRatio (:18327), mode/warpState, targetEntityID`.
- Positions are integrated server-side every tick — `SolarSystemScene.tick` (`runtime.js:33785`), `RUNTIME_TICK_INTERVAL_MS = 100` (`:601`).
- Field parity for the projection: `server/src/space/destiny.js:1090` `buildSlimItemDict(entity)`.
- Health: `server/src/space/combat/damage.js:81` **`getEntityMaxHealthLayers(entity)`** → `{shield, armor, structure}` capacities; live ratios live on `item.conditionState` (`damage`, `armorDamage`, `shieldCharge`, `charge`, all 0–1) and ship `capacitorChargeRatio`.

## Objective

1. **eve.js (gateway only):** a space-snapshot read for the held bridge session — mirror the `readFlightStatus` pattern. Return, for the session's current system: the visible entities (itemID, typeID, group/category, name, ownerID, radius, position, velocity, and where present the ship-ish fields incl. `damageState`-equivalent health ratios), plus the **active ship's** shield/armor/hull/capacitor (max layers + current ratios). Refresh presentation fields before projecting. Add the route + allowlist as the other bridge reads do. Deny-by-default rules and the session/ownership checks apply.
2. **BFF:** a read-only route (e.g. `GET /api/bridge/space/snapshot`) on the held session, same shape/handling as the other bridge reads (typed errors, session-loss unwind).
3. **Web — Overview:** a panel listing what's around the ship: **name, type, group** (names, never IDs — R7d), and **distance** computed **client-side** from the positions (like retail), sortable by distance and filterable (at minimum by category/group and a text filter), capped/virtualized enough to stay responsive. Each row offers **Warp to** and **Approach**, reusing the existing R5a atomic moves (`warpTo` / the approach used by the autopilot) — so a player can finally warp to *anything* they can see, not just route gates.
4. **Web — HUD:** shield / armor / hull / capacitor for the active ship as labeled percentage bars, visible while in space.
5. **Polling:** poll the snapshot ~1 s while in space and the panel is open; stop when docked or the tab is closed. Do not block the autopilot loop. (R10's push channel exists but is **not** required — if wiring it is trivial you may layer it later; polling is the contract here.)

## Invariants (must all still hold)

- **R7d — zero visible numeric IDs.** The overview is exactly where IDs would leak: show resolved **names/types** (use the existing name cache / `resolveNames`), never raw itemIDs/typeIDs. Re-run the ID sweep and prove it clean.
- **R8 — responsive.** The overview is a data table: it must reflow to stacked cards on phones like the others (`reflow` + `data-label` + `overflow-x-auto`), touch-sized actions.
- **R9a — plain player language.** No bridge/implementation jargon in the UI text.
- Movement authority stays server-side; the browser only issues the existing atomic moves.

## Required work

1. **Baseline** (record): web `npm test` (expect 353/353); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the 10 isolated gateway suites green.
2. Implement 1–5 with tests: a gateway test that the snapshot returns the session's visible entities + ship health (and refuses a foreign/unknown session), BFF route tests, and web tests for distance sorting/filtering, the warp-to/approach wiring, and the HUD ratios.
3. Update `docs/bridge-wire-contract.md` (the snapshot contract + polling cadence) and the roadmap (R11 row). Commit eve.js and web **separately**; report both hashes. **Do not push.**

## Definition of done

- While in space, the player sees a live overview of surrounding entities **by name** with distances, can **warp to or approach any of them**, and sees real shield/armor/hull/capacitor. Polling ~1 s, stopping when docked. All invariants (R7d/R8/R9a) verified. All baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed separately; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface files only**. Do NOT modify `space/runtime.js`, `destiny.js`, combat, or any game-mechanics code — **call** them, never change them. eve.js is currently on branch `ReconcileEliteMode` (it contains all prior bridge work); commit to the checked-out branch, stage only your files, never `git add -A`, and never revert the other agents' in-flight work.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If too large for one session, land the **gateway snapshot read + its tests** first (committed, green), then the BFF/UI, and report the split precisely. Never leave broken or uncommitted work.
