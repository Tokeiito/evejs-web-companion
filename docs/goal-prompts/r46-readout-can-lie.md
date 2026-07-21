# Goal R46: The lit row can be wrong about what happened

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready — queue behind R45. **Client only; small; fixes shipped behaviour.**

R44 shipped the lit-up ladder and reported the adopt shortcut as "distorted". A follow-up investigation found the distortion is worse than reported: **the readout can state something that did not happen.**

## The defect

`miningBotLoop.ts:709-714`:

```ts
if (lockedTargetIDs.includes(pick.entity.itemID)) {
  return {
    ...runTheLasers(pick.entity, snapshot, plan, "rock-already-locked"),
    takeRock: pick.entity.itemID,
  };
}
```

`rungOverride` does not *annotate* the leaf, it **substitutes** for it (`:745`, applied `:752`/`:765`/`:775`). The decision carries exactly one rung (`:1565 memory.rung = decision.rung`), so:

1. On an adopt tick the panel lights `rock-already-locked` and leaves `equipment-unknown` / `equipment-on` / `mining-running` **dark — on a tick that ran precisely that code.**
2. **Worse: the lit row can be false.** `rock-already-locked` reads *"skip the lock and go straight to the equipment"* (`miningLadder.ts:300`). But when `activeModuleIDs === null` the borrowed action is `wait "unknown module state"` — **the equipment was not switched on, and the only lit row says it was.**
3. The loss is **hand-chosen per call site and asymmetric**: at the other caller (`:643`) `rungOverride` is `null`, so the leaf is reported and "this was the remembered-rock branch" is invisible. There is no `rock-is-locked` row in `MINING_LADDER` at all.

A readout whose whole purpose is *"see why the bot did that"* must not be able to assert something false. This is the same class as the silent-decline bugs we keep finding, pointed at the player instead of the wire.

## The fix

Carry **two** fields instead of one — the caller row *and* the action's own leaf:

```ts
readonly rung: MiningRungID;          // the row that fired
readonly step: MiningStepID | null;   // the action's own leaf; null for simple actions
```

on `MiningDecision` (`:202-221`) and `MiningBotProgress` (`:226-253`). This:

- deletes `rungOverride` (`:745`) and the upward rung substitution (`:861`),
- lights the caller row **and** the leaf simultaneously,
- **makes the `activeModuleIDs === null` lie untellable**,
- and fixes the *other* caller's invisibility for free.

It also removes a second hazard found in grounding: `noYieldCycles` is currently incremented by matching a **wait reason string** (`:1556-1558`, keyed on `reason === "mining"`), i.e. the stall clock behind the two unexpressible rungs is driven by which sub-ladder leaf ran, identified by prose. With a real `step` id available, that coupling can key on the id instead. **Do this only if it is provably behaviour-identical** — the counter's reset sites (`:1104`, `:1124`, `:1548`) must keep working exactly as now. If in doubt, leave the string match and report it.

## Hard rules

- **The loop's decisions must not change** — only what it *reports*. `miningBotLoop.test.ts` must pass **untouched**; if it needs editing, stop and report.
- **Do not build the editor, interpreter, catalogue or storage.** Those are parked (`docs/goal-prompts/parked-node-bot-editor.md`) at the operator's direction.
- **A 200 is not proof** — and neither is a green panel; verify the rung/step pair against real observed states.

## Invariants

**R7d** — neither id may ever render (both are internal; a companion test must prove the sweep's regex actually matches a string containing the id — see the backspace-`\b` history) · **R8** · **R9a** the leaf's sentence stays plain · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1614/1614**, or higher if R45 raised it), `tsc` + `build:web` clean.
2. Make the change. **Watch a test fail first that specifically proves the old readout could lie** — construct the `activeModuleIDs === null` adopt tick and assert the pre-fix code lights a row claiming the equipment was switched on. That test is the point of the goal.
3. **Verify live**: run the mining bot and report a tick where both a caller row and a leaf are lit, with the real state behind it.
4. Roadmap R46 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

Every tick that runs a sub-ladder lights both the row that fired and the leaf inside it; no lit row can assert an action the bot did not take; the loop's behaviour is byte-identical.

## Constraints

- **Client only.** No BFF routes, no gateway pairs, no eve.js changes. Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode` — never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes pass in isolation — do not chase them.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **R45 may have just changed what `/` serves** — take the running state as you find it, own any process you start, leave all three healthy.
- Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. Leave characters docked; release sessions.
- **Browser pane:** the SPA's URL may have moved to `/` with R45. Screenshots time out and rAF never fires; static geometry IS measurable but async panel content never flushes. Drive `AppFlow` directly. Say plainly what you could not see.
