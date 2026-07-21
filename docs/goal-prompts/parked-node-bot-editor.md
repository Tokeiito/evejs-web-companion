# PARKED: the player-programmed bot editor

**Not a goal. Deliberately parked** by the operator on 2026-07-21: *"It might be better to save this for future work where we can brainstorm instead of trying to multitask."* This file exists so the brainstorm starts from what is already known instead of re-deriving it.

## What the operator wants (their framing, confirmed)

> *"We have pre-made actions like flight destination, and can build more, where the player puts in variables where needed, then they can chain them together in a node-like view."*

> *"We would need the actions to be export/import using a JSON format."*

> *"If we need to delay more work because of our limited function calls, then that's fine."*

So: **pre-made actions** (built by us, growing over time), **player-supplied variables**, **chained in a node-like view**, with **JSON export/import** as a first-class requirement — not an afterthought. The operator is explicitly willing to trade speed for getting it right.

Also from the same exchange, on starting requirements:

> *"I was thinking it could be a system part of the bot where we can define starting checks as a 'pre start'. Not needed currently, but will be for player-programmed bots."*

R43 shipped declared requirements per bot (met / not-met / **cannot-tell**, evaluated against fresh authority, cannot-tell never passes). That mechanism is the seed of the player-facing "pre start" block — it already exists and should be reused, not reinvented.

## What is already established

**From the discovery workflow:**
- The row list beats the canvas *as a data model*. But the operator has since confirmed they do want a node-like **view** — so the open question is whether a node view can render a fundamentally ordered, first-match-wins document without implying free-form control flow.
- **The safety property is the whole reason this is viable**: rows have no outgoing edges and order is an array index, so **a cycle is undrawable rather than validated against**. Two-calls-per-tick is likewise unrepresentable because a `Decision` carries exactly one action. Any editor must preserve both *structurally*.
- Slices already delivered: the Bots tab (R43) and lit-up rows (R44). The remaining slices — template registry, saved setups, interpreter, editor — sit behind a decision point.

**From R44, which actually rendered the real ladder (26 rungs: 14 clean, 10 distorted, 2 impossible):**
- **The ladder is not flat.** `travelDecision` is a 5-step sub-ladder reached from **five** rungs; `runTheLasers` is 3 steps from two. A row list has no notion of a *call*; naive rows need a 5×5 cross-product for code written once. **This is the central unsolved design problem.**
- `headHome` is a **latched sentence**, not a boolean — a flag model that loses the reason loses the readout.
- The adopt shortcut **borrows** another sub-ladder's action, so naming one leaves the other's rows dark on a tick that ran them.
- `OUT_OF_VIEW` vs mined-out need **two distinct release verbs**; collapsing them slowly empties a belt that is actually full.
- **`no-yield-haul` / `no-yield-stop` are genuinely unexpressible**: they count ticks where equipment ran **and the hold did not grow** — a firing rule conjoined with an authority *not changing*, across time.
- Not every tick reaches the ladder at all (settle windows, status retries, paused bot), so "which rule fired" is legitimately *none*.

**A sub-ladder design investigation was run** after R44 (composite actions vs named row groups vs phases, judged on whether the cycle property survives). Its output is input for the brainstorm — read it before designing.

## Constraints any design inherits

- **A 200 is not proof.** Every action needs an `issue` and a **separately-sourced** `confirmedBy`; the call's own response is never the evidence.
- **Every branch bounded.** The mission bot destroyed real standings because *one* branch lacked a counter. A player will do worse.
- **Pause rather than guess**, and **cannot-tell never passes**.
- The bot runs in the **browser**; closing the tab closes the client.
- **This environment cannot verify a canvas visually** — screenshots time out, `requestAnimationFrame` never fires, and async panel content never flushes to the DOM. Static geometry *is* measurable. Any interaction-heavy UI is effectively untestable here and would rest on the operator clicking and reporting back.

## The sub-ladder investigation answered its question

Run after R44 (composite actions vs named row groups vs phases; judged on safety, expressiveness, legibility). **Verdict, 2–1: composite actions only — players never compose flights.** The two rejected models failed for reasons worth keeping:

- **Named groups** is the better *idea* and the worse *product*. Its `forward: n` offset is the strongest single mechanism proposed anywhere — **file it for later**. But fall-through re-entry is exponential (~8 groups × 8 rows ≈ 16.7M predicate evaluations in one tick), and decisively, **the real bot never needs fall-through**: `travelDecision` returns on every path including `step === null`, and `runTheLasers` returns on all three. Delete fall-through to fix the freeze and a group *is* a composite action with worse ergonomics and a player-editable warp dead band.
- **Phases is disqualified**, and structurally so: a two-line livelock (`hold>10% → become B` / `hold≤90% → become A`) is unrecoverable because **every bound in this codebase dispatches on `action.kind`, so a tick emitting nothing passes through zero bounds**, and per-phase counters reset on entry so a ping-pong resets its own watchdog.

**The general rule that falls out, and it applies beyond this feature: never ship a primitive where a tick can legally emit no world call.**

**One correction that would have bricked the bot:** a proposed top-level row *"when the belt has no rocks left, stop"* fires on tick one — `candidates.length === 0` is already true while the ship is still warping, because the belt is not on the grid yet. `belt-empty` is not a row; it is the arrival **step** of "go to the belt".

## Open questions for the brainstorm

1. Can a **node-like view** render an ordered, first-match-wins document without implying free-form edges — and if a player draws an edge, what does it mean?
2. What is the minimal way to express a **reusable sub-ladder** (the five callers of `travelDecision`) without reintroducing cycles?
3. What is the **JSON schema**, and what makes it safe to import a file a player did not write? Import is an untrusted-input path: bounds, unknown actions, version skew.
4. Which sub-ladders are **composable by players** and which stay opaque? (The autopilot's warp dead band, jump classifier and two dock counters should almost certainly stay sealed.)
5. How do the **two unexpressible rungs** appear — omitted, or rendered as "this rule is more than one line can say"?
