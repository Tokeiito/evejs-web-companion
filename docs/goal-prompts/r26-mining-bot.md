# Goal R26: Automated play — a mining bot that can be left running

**Issued:** 2026-07-20 by the orchestrator (operator AFK, autonomous, operator-requested: *"maybe start on even automated play like a bot so our client can run mining or courier missions on its own"*). **Status:** Ready to run.

Every piece of the mining loop now works and is proven live: warp, lock, activate, ore into the hold, depletion, dock, unload, reprocess, and drones that auto-defend. This goal composes them into a loop the player can start and walk away from.

## The architecture is already decided — this is the fourth instance of it

`web/src/nav/autopilotLoop.ts` is the pattern: a browser-side decide-loop that reads authoritative state each tick, issues **at most one** atomic call, never simulates or predicts, and **pauses rather than guesses**. R13 made it measure distances; R24 gave it a Dock ladder and bounded every branch. **Build the bot the same way — a new ladder over the same discipline, not a new paradigm.** Reuse the loop's proven parts (settle ticks, attempt bounds, mid-warp waits, session-loss unwind) rather than re-deriving them.

**It runs in the browser.** Closing the tab is closing the client: the bot stops, the ship finishes whatever server command was last issued, and sits. That is faithful, and it is the honest boundary — the BFF must never drive the loop with no client attached.

## The ladder

Each tick, read state (flight status, space snapshot, ore hold, targets, drones) and pick ONE action:

1. **Danger first.** If a hostile is present (R25's `isNpc`) → ensure drones are launched (they auto-engage). If ship health falls below a safety floor → **abort and dock**; survival outranks yield.
2. **Docked with ore** → unload to the station hangar, then undock.
3. **Docked and empty** → undock and head for the belt.
4. **In space, hold full** (or the cycle stopped and the hold cannot take another cycle) → dock at the chosen station.
5. **In space, no rock locked** → pick the nearest mineable rock with ore remaining and lock it.
6. **In space, rock locked, lasers idle** → activate mining modules on it.
7. **Rock depleted / lock lost** → pick the next rock.
8. **No rocks left in range** → pause with a plain reason (do not wander).
9. Otherwise → wait.

**Every branch must be bounded** the way R13/R24 bound warp, jump and dock — a decision that cannot make progress pauses with a reason. Nothing may repeat unboundedly.

## Hard rules

- **A 200 is not proof.** This server has six confirmed cases of returning success without acting — including, from R25, a *launch* that returns 200 while refusing two of three drones inline. Every action is confirmed by re-reading the authority (`GetTargets` for locks, `activeModuleIDs` for modules, the hold for ore, the snapshot for drones).
- **Never fabricate progress.** If the bot cannot tell whether something happened, it says so and pauses — it does not assume.
- **The server owns the rules.** Do not reimplement range checks, bandwidth limits, or yield maths. Issue the call and read the refusal.
- **Safety floor is not optional.** Unattended play means nobody is watching the shield bar.

## UI

A **Mining bot** control (in Around Your Ship, or its own small panel): pick the belt/station, **Start / Pause / Stop**, and a live readout of what it is doing and why — current step, current rock, ore this run, cycles completed, and the reason if it paused. The player must always be able to see *why* it did the last thing it did; a bot you cannot interrogate is one you cannot trust.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive · **R9a** plain player language · **R18** panelFirstMount green.

## Required work

1. Baseline: web `npm test` (expect 1047/1047). Two known pre-existing eve.js failures — `webGatewayEvents` (upgrade rejection) and `droneRuntimeParity` (2 cases, mechanics, another agent's area) — **do not touch either**.
2. Implement with tests driven off **synthetic state**, exactly as `autopilotLoop.test.ts` drives the flight ladder: assert each rung fires at the right state, that a full hold ends mining, that a depleted rock advances to the next, that a hostile triggers drones, that the safety floor docks, and that **no branch can repeat unboundedly**.
3. **Verify live** — you may start/stop/restart both servers (the operator granted this). Run the bot against the real world for at least one full cycle: undock → belt → lock → mine → ore in hold. Report exactly what you observed, with real numbers. Leave both servers running and healthy, and leave the character in a sane state (docked, bot stopped).
4. Update the roadmap (R26 row) + `docs/bridge-wire-contract.md` if any contract changes. Commit; report hashes. **Do not push.**

## Definition of done

- A player picks a belt, presses Start, and the client mines unattended: locking rocks, running lasers, defending itself, hauling when full, unloading, and coming back — pausing with a readable reason on anything it cannot handle. Live-verified for at least one full cycle. Bounded everywhere. Suites green. Committed; hashes reported; not pushed.

## Constraints

- Prefer **web-only**. Everything needed is already allowlisted (targeting, activation, drones, flight, inventory, ore hold, dock). If you believe you need a new eve.js pair, stop and report why rather than adding one — the point of this goal is composition, not new surface.
- Screenshots have been unavailable to every worker — verify by measurement and say plainly what you could not see.
