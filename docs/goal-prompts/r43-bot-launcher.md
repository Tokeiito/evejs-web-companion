# Goal R43: One place to start a bot

**Issued:** 2026-07-21 by the orchestrator, at the operator's request. **Status:** Ready (queue behind R41/R42 — shares the web store). **Client only; small.**

> *"we will need a button or tab somewhere for a user to initiate the different bots we create."*

Two bots exist and both are live-proven, but each is reachable only from inside the panel it happens to live in. There is no single place a player goes to say "run something."

## What exists

- **`web/src/nav/miningBotLoop.ts`** + `web/src/ui/MiningBot.svelte` — embedded inside `Overview.svelte`, deliberately outside the in-space guard so the readout survives docking. Live-proven: 59m40s, 2 hauls, 311,464 ore units, zero pauses.
- **`web/src/nav/missionBotLoop.ts`** + `web/src/ui/MissionBot.svelte` — live-proven: 3 consecutive missions, +420,750 ISK, +639 LP, zero pauses.
- Both are plain browser `while` loops with an injected `sleep`, started through `AppFlow` (`startMiningBot` / `startMissionBot` and their pause/resume/stop siblings). **No new engine is needed — this is presentation.**

## A live bug this goal must fix

**Two bots can drive one ship today.** Verified by the orchestrator:

```
flow.ts:3706   startMissionBot → miningBot?.stop()     ✓
flow.ts:3744   startMiningBot  → autopilot?.abort()    ✗ never stops missionBot
```

Mutual exclusion is two hand-written lines and they are **asymmetric**. Start the mining bot while the mission bot is running and both loops keep ticking, each issuing movement and module calls against the same ship. Neither knows about the other.

**Fix it declaratively, not with a third hand-written line.** A single `runningBotID` in the store, with starting any bot stopping whatever else holds it, makes the property structural instead of something each new bot must remember to re-implement. A fourth bot would otherwise need three more lines and get one of them wrong.

Pin it with a test: starting each bot while each other bot runs must leave exactly one running.

## What to build

**A Bots panel** — one place listing every bot the client can run, each with what it needs before it can start, Start/Pause/Stop, and its live readout.

- **Do not duplicate the loops or their readouts.** Reuse `MiningBot.svelte` and `MissionBot.svelte` as components. If they need to be usable in two places, make that explicit rather than forking them — a forked readout will drift and then lie.
- **Say why a bot cannot start**, in plain language, rather than disabling silently. R30 and R33 both established this: an unavailable control states its reason. The mining bot needs a belt, a station and mining modules; the mission bot needs an agent station. Reuse `refusals.ts` wording where it fits; **do not invent a third mechanism**.
- **Show what is currently running**, so a player who has left a bot going and switched panels can find it again.
- The panel must survive docking/undocking the way the mining bot readout already does.

## Deliberately NOT in this goal

- No new bot. No changes to either loop's logic.
- **No visual/node-based bot authoring.** That is under separate discovery at the operator's request; this goal must not pre-empt its design decisions. Keep the panel a *launcher*, not an editor.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets, no horizontal body scroll · **R9a** plain player language · **R18** `panelFirstMount` green with the new panel added.

## Required work

1. Baseline: web `npm test` (take the real number — R41/R42 may have raised it), `tsc` + `build:web` clean.
2. Build the panel; wire it into the SPA's navigation.
3. Tests: each bot appears; a bot that cannot start says why; a running bot's state shows; the panel renders with an empty store (R18). **Watch each new test fail first.**
4. **Verify live**: start a bot from the new panel and confirm it actually runs — a launcher that renders but does not launch is the failure mode here. Then stop it cleanly.
5. Roadmap R43 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player opens one panel, sees every available bot, understands why any of them cannot start, and can start, watch and stop one from there — verified by actually starting one.

## Constraints

- **Client only.** No BFF routes, no gateway pairs. If you think you need either, stop and report why.
- Never `git add -A`. Never push. Another agent has in-flight destiny/parity work in eve.js on `ReconcileEliteMode` — never revert or clobber it.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; a rare time-derived `skillsPanel` flake passes isolated — do not chase it.
- Servers up: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **Only one worker drives live sessions at a time.**
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's — leave them. Leave characters docked and sane; release sessions.
- **Logins:** `rrfarmer` → Farmer (Procurer with 2× Strip Miner I, ore hold 16,000 m³), `test2` → Test Two (Badger). Any password.
- **Browser pane:** the SPA is at **`/dist/`**, not `/`. Screenshots time out and rAF never fires; static geometry IS measurable but **async panel content never flushes**. Drive `AppFlow` directly to prove the launch actually works. Say plainly what you could not see.
