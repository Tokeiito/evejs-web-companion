# Goal R39: Leave it running — the bot soak

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready. **Verification-first; fix only what the soak exposes.**

The operator's original ask was a client that can "run mining or courier missions on its own." Both bots exist and both are live-proven — but only briefly:

- **Mining bot (R26):** 2 cycles, 13,747 ore units, 1 haul.
- **Mission bot (R36):** 1 complete mission, +140,250 ISK, zero pauses.

**That is the gap between "it works" and "you can leave it running."** Every interesting failure in an unattended loop is a long-run failure: a belt that runs dry, a rat that arrives mid-haul, a hold that fills on an awkward boundary, an offer that never comes, a route that changes under you, a session that ages out. None of those appear in two cycles.

This goal is mostly **running and watching**, not building. That is deliberate. The two highest-value bugs found this session were both found by running:

- The hold stopped at **15,999.95 / 16,000 m³** — `used >= capacity` was false, so the bot relit the lasers forever and **would never have hauled**.
- The mission bot **flew six jumps home to arrive somewhere it would refuse to work**, because the mission cap was checked after the fly-to-agent rung.

Neither had a failing unit test. Both were obvious within a minute of watching.

## What to do

1. **Soak the mining bot.** Run it unattended for **as long as practical** — target at least 6 cycles or ~45 minutes of wall clock, whichever comes first. Do not babysit it into working; if it pauses, record the reason and let it sit. The point is to observe, not to nurse.
2. **Soak the mission bot.** Same idea: multiple consecutive missions, not one. This exercises the loop-back path R36 proved only by test — accept → deliver → **accept again**.
3. **Record every distinct pause reason**, with how many times each fired and whether the bot recovered. A pause is a success (it refused to guess); an *unbounded repeat* or a *wrong* pause is a bug.
4. **Watch for the failure classes two cycles cannot show:**
   - Belt depletion — what happens when every rock in range is mined out?
   - A hostile arriving **mid-haul** rather than at tick 0.
   - Hold boundaries other than the one already fixed (a partial cycle, a different ore volume).
   - An agent with no offer, or an offer that fails a gate repeatedly — does it back off or spin?
   - Session/token ageing over a long run.
   - The autopilot's own bounds (`MAX_WARP_ATTEMPTS`, `MAX_SILENT_DOCK_ATTEMPTS`) actually being reached.
5. **Fix what the soak exposes**, each with a test you watched fail first. If nothing breaks, **that is the result** — report it plainly and commit nothing. A clean soak is a real outcome; do not invent a fix to have something to commit.

## Rules for the soak itself

- **Do not alter game state to make the run easier.** No `EVEJS_*` overrides — a previous run forced the belt rat spawn chance to 1 and it had to be reset to its 0.25 default. Take the world as it is.
- **A 200 is not proof** (ten confirmed patterns). Where the bot claims progress, spot-check the authority.
- **Report real numbers**: cycles, ore mined, hauls, ISK, LP, standings, wall-clock, and every pause with its count.
- **Leave the world tidy**: characters docked, modules off, drones scooped, nothing locked, sessions released, all three servers healthy.

## Known bad ground — expect, do not fix

- **The eve.js wreck-loot crash** (`scene.sendSlimItemChangesToAllSessions`, called at `nativeNpcWreckService.js:222`, defined nowhere) — looting throws *after* the items move. Out of the authorised footprint. If a bot touches loot, expect this.
- **`getCourierProgress` judges by typeID, not itemID** — pre-existing stock at the dropoff can satisfy the objective. Server-side; **report only.**
- **The package's itemID is not readable by the client**, so an identical stack of the same type *and* quantity is genuinely ambiguous. The mission bot already says so rather than pretending.

## Invariants

If you change anything: **R7d** zero visible numeric IDs · **R8** responsive · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1414/1414**), `tsc` + `build:web` clean.
2. Soak both bots. Report as described.
3. Fix only what broke, with tests watched failing first. **Fixtures from real captured bytes** — this repo has produced six tests that passed or failed while asserting nothing.
4. If you changed anything: roadmap R39 row, commit by pathspec, report hashes. **Do not push.**

## Definition of done

Both bots have been run well past the point already proven, every pause reason is recorded with counts, and any bug the soak exposed is fixed with a test that was watched failing. A clean soak with no fixes is an acceptable and valuable outcome.

## Constraints

- **Client + bridge only.** eve.js changes restricted to `server/src/_secondary/express/*` and `server/tests/*` — never game mechanics. Server defects: **report, do not fix.** Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode` — never revert, stash, checkout-over or clobber it.
- Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green; a time-derived `skillsPanel` countdown test flaked once under load and passes isolated — do not chase it.
- Servers up: :26002 EveJS (detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; leave all three healthy.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them.
- **Useful starting state:** Farmer (`rrfarmer`, any password — `src/server.js:128`) has a Rupture at Perimeter VI - Ytiri Storage and a **Procurer with 2× Strip Miner I** in a Jita hangar. Test Two has a **Badger** (4,095 m³) at Elonaya 60000256, and completed a distribution mission for Antaken Kamola at Muvolailen.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires (`visibilityState === "hidden"`, 0×0 viewport). R37 drove the real Svelte UI via `get_page_text`/`read_page`; R38 could not get past *"Loading…"* because the fetch effects never ran. **Driving the bots through `AppFlow` directly is the reliable path** — R36 did exactly that. Say plainly what you could not see.
