# Goal R48: Prove the miner actually survives a rat

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready. **Verification-first; fix only what it exposes. Client + bridge only.**

The whole premise of an unattended miner is that it defends itself. R25 built defensive drones and R26 wired them into the mining bot's danger ladder — but **that ladder has never fired against a real rat.** The R39 soak ran an hour and no hostile ever spawned. Everything below is proven only by synthetic state.

The danger ladder, in `web/src/nav/miningBotLoop.ts:544-596`, has three rungs, each unverified live:

1. **`health-floor` (`:545`)** — a health layer below `plan.healthFloor` abandons the belt and docks. *Survival outranks yield.*
2. **`pirate-unknown-health` (`:552`)** — a hostile present *and* the ship's condition unreadable → **pause**, do not guess.
3. **`launch-drones` (`:566-590`)** — a hostile present, health readable → launch the whole drone bay; they auto-engage.

## What to prove, in order

1. **A hostile appears on grid and the bot sees it.** `hostileRows` (`space/overview.ts`) must return it — confirm the snapshot actually carries the rat with `isNpc` set, not just that one is "there".
2. **The `launch-drones` rung fires** and **the drones actually leave the bay.** ⚠ **A 200 is not proof, and this is a measured hazard:** R25 observed a launch returning 200 while inline-refusing two of three drones. Re-read the snapshot and count entities passing `isMyDrone` — report how many bay drones launched vs how many were requested.
3. **The drones engage the rat** — the snapshot's drone rows show an activity/target against the hostile, not merely that they are in space.
4. **The miner survives** — the rat dies, or the bot breaks off. If the rat does enough damage to cross `healthFloor`, prove rung 1 fires and the bot docks. If it never does, say so — do not claim rung 1 fired if it did not.
5. **The `pirate-unknown-health` pause** — hardest to stage live (needs a hostile present while health reads null). If you cannot force it live, prove it stays covered by test and say plainly it was not seen live.

## Spawning the rat — the honest options

Belt rats spawn on **session attach near a belt** at the highsec default chance **0.25** (`config/index.js`, `asteroidBeltNpcRatHighSecChance`). Preferred method: warp a mining-capable character to a belt and re-attach until one rolls — it is only a few attempts at 25%.

**If that is too flaky to get a clean run, you MAY temporarily raise `EVEJS_ASTEROID_BELT_NPC_RAT_HIGHSEC_CHANCE`** for this test — this is the one goal where controlling the spawn is the point. But then, without exception:

- Own the EveJS process you start.
- **Restart EveJS with the override REMOVED at the end**, and **verify the running value is back to the 0.25 default** (an earlier run left it at 1 and it had to be reset — do not repeat that).
- Note in the report exactly what you set, for how long, and the proof it is reset.

Do **not** edit any eve.js source or config file. An env var for the duration of a test, reset after, is the whole allowance.

## Hard rules

- **A 200 is not proof** — eleven confirmed patterns, and the drone launch is a known one. Re-read authority after every action.
- **Client + bridge only.** No eve.js source changes. If you find a mechanism bug, **report it, do not fix it.** If you find a *client* bug (the ladder mis-reads a real snapshot the synthetic tests never exercised), fix it small, with a test watched failing first.
- **Fix only what the live run exposes.** A clean verification with no code change is a full success — do not invent a fix to have something to commit.

## Invariants (if you change anything)

**R7d** · **R8** · **R9a** · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` and BFF `node --test` (expect **1577/1577** combined), `tsc` + `build:web` clean.
2. Stage the fight and prove rungs 1–4 with real numbers; report rung 5's status honestly.
3. If a client bug surfaces, fix it with a test watched failing first. If nothing breaks, report the clean run and commit nothing but the roadmap row.
4. Roadmap R48 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The mining bot has been observed, live, seeing a real rat, launching drones that actually leave the bay and engage it, and either killing it or breaking off — with real numbers for each step and an honest account of anything that could not be staged. The world is left clean and the rat-spawn chance is provably back to default.

## Constraints

- Never `git add -A`. Never push. Another agent has in-flight destiny/parity work in eve.js on branch `ReconcileEliteMode` — never revert, stash, checkout-over or clobber it.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes pass in isolation — do not chase them.
- Servers: :26002 EveJS (PID 62824), :26500 web (the SPA is at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). You may restart :26002/:26500; own any process you start; leave all three healthy.
- **The operator may be reviewing the app.** Prefer `test2` → Test Two for driving if it has a drone-capable hull; otherwise Farmer's **Retriever/Procurer**. Farmer's Procurer had 2× Strip Miner I; a **drone-capable** hull is needed for this test — R26's live run used a **Retriever with drones**, and R25 left an abandoned Ice Harvesting Drone in a belt. Establish which hull actually has a drone bay with drones in it before staging.
- **Only one worker drives live sessions at a time** — you are the only one; keep it that way.
- Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. Leave characters docked, drones scooped, nothing locked, sessions released.
- **Browser pane:** screenshots time out and rAF never fires; static geometry IS measurable but async panel content never flushes. **Drive `AppFlow` / the BFF directly** — this is a live-behaviour goal, exactly what R36/R39 did. Say plainly what you could not see.
