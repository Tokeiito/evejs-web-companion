# Goal R25: Drones + hostile awareness — survive the belt

**Issued:** 2026-07-20 by the orchestrator (operator AFK, autonomous). **Status:** Ready to run. eve.js changes are **gateway/interface only**.

The mining loop works, but **warping to a belt is literally a spawn roll for a pirate that will attack you.** This goal lets a miner see the threat and survive it. It is also the prerequisite for any unattended bot (R26) — a bot that cannot defend itself just dies politely.

## Verified research — build on this, do not re-derive

**Rats are real, and arrival triggers them.** `space/npc/beltRatRuntime.js` — `maybeSpawnForBeltArrival` (:1156), `spawnBeltRatGroup` (:1073). Trigger is **player arrival, not a timer**: `runtime.js:36117` (attach), `:36363`, and `:41420` (**warp completion**). Config `asteroidBeltNpcRatsEnabled` defaults true and is explicitly `true` in `evejs.config.local.json:220`. Roll: **highsec 0.25 / lowsec 0.35 / nullsec 0.45**, spawn distance **30 km**, max 1 group per belt, respawn cooldown 20 min. Belt rats pass no behaviour overrides, so they take defaults: **auto-aggro ON**, and the arriving player is the preferred target (`npcBehaviorLoop.js:2978`, `:1456`).

**Drone control is real** — and note the service split: **commands go through `entity`, launch goes through `ship`.** Neither service has *any* allowlist entry today.

| Tuple | Purpose |
|---|---|
| `("ship", "LaunchDrones", [[(itemID, qty), …], whoseBehalfID, ignoreWarning])` | launch from bay |
| `("entity", "CmdEngage", [[droneIDs], targetID])` | attack |
| `("entity", "CmdReturnBay", [[droneIDs]])` | recall (scoop is automatic within **2500 m**) |
| `("entity", "CmdMineRepeatedly", [[droneIDs], targetID])` | **mining drones — real, and free yield for our loop** |
| `("ship", "ScoopDrone", [[objectIDs]])` | manual scoop |

⚠ **`CmdAssist`, `CmdGuard`, `CmdUnanchor` are client-only — NO server handler exists.** Do not build on them.

**Server behaviour that changes the design:**
- **Idle combat drones AUTO-ENGAGE whatever shoots your ship** — `noteIncomingAggression` (`droneRuntime.js:3823`), fired from `runtime.js:16612`, requires `behaviorSettings.aggressive`, which **defaults true** (`:134`). **So the minimum viable defense is simply launching them.** `CmdEngage` is for *choosing* a target, not for being defended.
- `CmdEngage` does **not** require the ship to have the target locked.
- Launch enforces **drone bay flag 87**, `maxActiveDrones` (attr **352**) and `droneBandwidth` (attr **1271**) — surface these, don't reimplement them.
- Damage runs the **same** weapon pipeline modules use (`tickDroneCombat` :3914) — real kills, real killmails. Recall/scoop is automatic once commanded.
- `droneControlRange` (attr 458) is **not enforced** — a known divergence, harmless here.

**Already available — reuse, add nothing:**
- **Drones in space**: the snapshot already projects `kind: "drone"` with `ownerID`. Mine = `kind === "drone" && ownerID === myCharacterID`.
- **Drone bay**: `invbroker` `MachoBindObject` / `GetInventoryFromId` / `ListByFlags([87])` — **all three already allowlisted**.
- **Live drone state**: `OnDroneStateChange` / `OnDroneActivityChange` already ride the existing push channel (the notification sink is generic — no server change).

## Slice A — drone control (commit first)

1. Allowlist: `ship.LaunchDrones`, `entity.CmdEngage`, `entity.CmdReturnBay`, `entity.CmdMineRepeatedly`, and `ship.ScoopDrone` if you use it. Deny-by-default intact, with a test proving non-allowlisted `entity`/`ship` siblings are refused (**including `CmdAssist`/`CmdGuard`**, which would otherwise look plausible).
2. BFF routes for launch / engage / recall / mine-with-drones, on the held session.
3. UI in **Around Your Ship**: a **Drones** section showing what is in the bay (by name) and what is in space (by name, with what it is doing), **Launch**, **Engage** (against the locked target — reuse the R23 auto-target default), **Recall**, and for mining drones **Mine this rock**. Show `maxActiveDrones` / `droneBandwidth` limits and let the server refuse rather than pre-guessing.

## Slice B — hostile awareness (commit second)

4. **Identify hostiles in the snapshot.** Determine from the runtime how a belt rat is distinguishable from a player ship and from your own drones (kind, ownerID, an NPC/faction marker — read the projection and the entity fields; add a projected field ONLY if genuinely required, gateway-side).
5. **Warn the player.** A hostile in the overview must be obvious — visually distinct and sorted/surfaced, not a row among ninety. When one appears while you are mining, the panel should say so plainly ("A pirate has arrived").
6. **Show that you are under attack.** The HUD already has shield/armor/hull; make a dropping shield legible at a glance. Do not invent a damage log we cannot source.

## Invariants

**R7d** zero visible numeric IDs (drones, rats, ore by name) · **R8** responsive · **R9a** plain player language ("Pirate", not "NPC entity kind") · **R18** panelFirstMount green · **a 200 is not proof** — re-read after every action; drone state has an authoritative read and a push event, use them.

## Required work

1. Baseline: web `npm test` (expect 995/995); eve.js gateway suites green. Note the known `webGatewayEvents` upgrade-rejection failure is **pre-existing — do not touch it**.
2. Slice A, commit. Slice B, commit. Tests for the allowlist + deny-by-default, the BFF routes, drone identification (mine vs other), and hostile identification.
3. **VERIFY LIVE.** The orchestrator now has permission to control both servers, so a live check is expected: restart EveJS if your gateway change needs loading, then confirm launch/recall actually works against the running world. Report exactly what you observed. If you restart anything, leave both servers running and healthy.
4. Update `docs/bridge-wire-contract.md` + the roadmap (R25 row). Commit eve.js and web separately; report hashes. **Do not push.**

## Definition of done

- A miner can launch drones, see them in space by name, engage a target, and recall them; hostiles are clearly distinguishable and surfaced when they arrive; and the auto-engage behaviour means an attacked miner is defended without any further clicks. Live-verified. All invariants re-proven; suites green. Committed; hashes reported; not pushed.

## Constraints

- eve.js **gateway/interface only** (`_secondary/express/*` + tests); never modify drone, NPC or space mechanics — call them. Branch `ReconcileEliteMode`; pathspec commit; never `git add -A`; another agent has in-flight destiny work — leave it alone.
- Screenshots have been unavailable to every worker — verify by measurement and say plainly what you could not see.
