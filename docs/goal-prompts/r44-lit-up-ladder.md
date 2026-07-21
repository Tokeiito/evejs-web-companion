# Goal R44: Show the ladder, and light up the rung that fired

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready. **Client only; small; instrumentation, not behaviour.**

This is **slice 2** of the player-authored-bot discovery the operator commissioned, which called it *"the highest value-per-hour in this whole discovery."*

## What and why

Render the **existing, hand-written** mining ladder as a list of rows, and light up the row that fired this tick, live. **No editor. No interpreter. No storage. No new runtime.**

Two outcomes, and both are wins:

1. The bots stop being black boxes. A player watching a bot sees *which rule* fired and why — which is the single best thing you can give someone deciding whether to trust an unattended process.
2. **If the ladder does not render as clean rows, the vocabulary hypothesis is falsified for two days' work** instead of after a six-week editor build. That is the real reason to do this first.

`decideMiningAction` (`web/src/nav/miningBotLoop.ts:414-667`) is already an ordered ladder — its own doc comment at `:400-412` is a numbered list of rungs, and the code is guarded returns, first match wins. This goal makes that structure visible; it does not create it.

## The rule

**The loop's behaviour must not change.** This is instrumentation. `MiningDecision` (`:199-206`) gains a rung identifier; nothing else about the decision changes. If you find yourself restructuring a rung to make it renderable, **stop** — that is the falsification signal, and reporting it is the valuable outcome, not working around it.

`miningBotLoop.test.ts` must pass **unchanged**. If a test needs editing to accommodate this, that is also a signal worth reporting rather than absorbing.

## The rungs that will resist — the actual experiment

The discovery identified these. They are the test; do not smooth them over.

- **`headHome` is a latched sentence, not a boolean** (`MiningDecision:203`, set `:388`, consumed `:439`). A row model that assumes flags are booleans loses the reason.
- **The adopt shortcut** (`:655`) returns an action **plus** a memory write in the same tick. A row that is "one condition, one action" cannot express it without a bookkeeping tail.
- **`OUT_OF_VIEW` (`:587`) vs mined-out (`:594`)** need two *distinct* release verbs. Collapsing them recreates a bug that slowly empties a belt that is actually full.
- **`noYieldCycles` (`:123`, `:549`) genuinely does not fit.** It counts ticks where the lasers ran **and the hold did not grow** — a firing row conjoined with an authority *not changing*. Every row-shaped approximation is looser than the code. **Do not force it.** Render it honestly as something the row model cannot express, and say so.

**Report, per rung: rendered cleanly / rendered with distortion / could not be rendered.** That table is the deliverable — more valuable than the UI itself.

## What to build

- Each rung gets a stable identifier and a plain-language name (R9a — a player reads *"the hold is full, so head home"*, never `HEAD_HOME` or a line number).
- The bot's readout shows the ladder in order, with the rung that fired this tick marked, and the existing `why` sentence still shown.
- Reuse the existing readout components (`MiningBot.svelte`); **do not fork them** — R43 established that a forked readout drifts and then lies.
- Rungs never reached this tick should be visibly *not* fired, not hidden — seeing what did **not** fire is most of the value.

## Invariants

**R7d** zero visible numeric IDs — a rung identifier is internal and must never render · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1582/1582**), `tsc` + `build:web` clean.
2. Add the rung identifier and the renderer. **`miningBotLoop.test.ts` must pass untouched.**
3. Tests: every rung's identifier is distinct; the fired rung matches the action taken for a representative set of synthetic states; no identifier reaches rendered text. **Watch each new test fail first** — ten tests in this repo have been caught asserting nothing.
4. **Verify live**: run the mining bot and report the actual sequence of rungs that fired, in order, with the real state that drove each. That sequence *is* the proof the instrumentation is honest.
5. Roadmap R44 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player watching the mining bot sees which rule fired and why, the loop behaves exactly as before, and the per-rung table says plainly which rungs the row model can and cannot express.

## Constraints

- **Client only.** No BFF routes, no gateway pairs, no eve.js changes. Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode` — never revert or clobber it. Never `git add -A`. Never push.
- **Do NOT build the editor, the interpreter, the catalogue, or storage.** Those are later slices behind a decision point that this goal exists to inform. Scope creep here destroys the experiment's value.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; a rare time-derived `skillsPanel` flake passes isolated — do not chase it.
- Servers up: :26002 EveJS (PID 62824), :26500 web (PID 60856), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **Only one worker drives live sessions at a time.**
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's — leave them. Leave characters docked and sane; release sessions.
- **Logins:** `rrfarmer` → Farmer (Procurer, 2× Strip Miner I at high slots 27/28, 16,000 m³ ore hold), `test2` → Test Two. Any password. Login also returns a `sessionToken` for `Authorization: Bearer` if you want isolated contexts (R42).
- **Browser pane:** the SPA is at **`/dist/`**, not `/`. Screenshots time out and rAF never fires; static geometry IS measurable but **async panel content never flushes**. Drive `AppFlow` directly to prove behaviour. Say plainly what you could not see.
