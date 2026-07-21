# Goal R49: Stop tracking rock depletion — the server removes depleted rocks

**Issued:** 2026-07-21 by the operator, verbatim: *"the server removes rocks that are depleted. You don't need to track that."* **Status:** Ready. **Client only.**

The mining bot currently monitors `remainingQuantity` to decide when a rock is empty. It should not. Depletion is server-owned: when a rock is mined out, **the server removes it from the grid** (observed live in R44 — a rock went 146,253 → 535 units, then the server deleted it; it never reaches 0 on-grid). The client reacts to what is on field, it does not predict depletion.

## Remove

1. **`rockHasOre` and its uses in decisions.** `web/src/nav/miningBotLoop.ts:400-401` (`remainingQuantity === null || > 0`), and its two call sites:
   - `:687` — the **`rock-mined-out` rung** (`:687-694`). Delete the rung. A locked rock that is gone is already handled by `rock-out-of-view` (`:679-685`), which fires when the rock is no longer in the snapshot — the reactive path that actually runs.
   - `:725` — the depletion filter in **rock selection**. Pick the nearest mineable rock **on the grid**; do not filter by an ore count.
2. **The `remainingQuantity === 0` gate in `rowActions.ts:165`** (the overview verb's "mined out" state) — same reasoning; a rock the server still shows is mineable.
3. **The "units left" readout** (`:844-846`) — this exists only because the bot was tracking the count. Remove it; the readout should not display a depletion number the bot no longer uses.

## The machinery this touches — handle honestly, do not leave dead code

- **`exhaustedRockIDs`.** Today it is fed by `dropRock("it was mined out")` (the controller exhausts a rock when `dropRock !== OUT_OF_VIEW`). Removing the mined-out branch means **nothing feeds `exhaustedRockIDs` anymore** — so it becomes dead state. **Remove it too**, unless there is a genuinely *reactive* reason to blacklist a rock (e.g. a rock that repeatedly refuses to lock — but that is a lock-failure concern the loop already bounds separately, not depletion). If you keep any blacklist, it must key on an observed refusal, never on a predicted ore count. Report what you did and why.
- **The two `dropRock` verbs.** R44 found `OUT_OF_VIEW` and mined-out must not be *collapsed* (collapsing them blacklists a full belt). Removing the mined-out verb entirely is a different change — after it, `dropRock` has one meaning: "the rock I was on is gone from the grid, pick another." Confirm that simplification reads cleanly and the controller's `dropRock(decision.dropRock !== OUT_OF_VIEW)` call is updated so it never blacklists on the remaining path.

## The reactive model the bot should follow (nothing new — just what remains)

- **In space, no rock locked** → lock the nearest mineable rock on the grid.
- **Rock locked, lasers idle** → activate on it.
- **The locked rock leaves the grid, or the lock drops** → pick the next rock. (This is depletion, handled reactively — the server took the rock.)
- **The server refuses activation** → react to the refusal (already handled).
- **No mineable rocks on the grid** → pause with a plain reason.

## Hard rules

- **Client only.** No BFF routes, no gateway pairs, no eve.js changes. Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode` — never revert or clobber it. Never `git add -A`. Never push.
- **A 200 is not proof** — the reactive re-reads (lock lost, rock gone) stay exactly as strict as they are.
- **`isMineableRock` stays** — identifying that an entity *is* an asteroid is field observation, not depletion tracking. Only the *how much ore* logic goes.

## Invariants

**R7d** · **R8** · **R9a** plain player language (the "mined out" sentences go with the rung) · **R18** `panelFirstMount` green.

## Required work

1. Baseline: combined `node --test` (expect **1579/1579**), `tsc` + `build:web` clean.
2. Remove the depletion logic and any state it orphaned. Update `miningBotLoop.test.ts` — tests that asserted the `rock-mined-out` rung or the units readout are testing removed behaviour; rewrite them to the reactive truth (a locked rock leaving the grid → pick another), do not just delete coverage. **Watch new/changed tests fail against the old code first** where it makes sense.
3. **Verify live** — this is the point of the goal. Mine a real rock to depletion and confirm: the server removes it, the bot sees it leave the grid, and it picks the next rock **without** ever consulting an ore count and without getting stuck. Report the real sequence — rock present → mining → rock gone → next rock locked. Use the operator's rat-free method if needed; keep the session short; leave the character docked.
4. Roadmap R49 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The mining bot holds no ore-count logic. It mines what it locks and reacts when the server removes the rock, proven live through at least one real depletion → next-rock transition. No dead depletion state remains. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` countdown flakes pass in isolation — do not chase them.
- Servers: :26002 EveJS (PID 62824), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). You may restart :26002/:26500; own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **Only one worker drives live sessions at a time — that is you.** **Logins:** `rrfarmer` → Farmer (Procurer, 2× Strip Miner I, drone bay of Warrior IIs), `test2` → Test Two. Any password; login returns a `sessionToken`.
- Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them. Leave characters docked, nothing locked, sessions released.
- **Browser pane:** screenshots time out and rAF never fires; static geometry IS measurable but async panel content never flushes. Drive `AppFlow` directly. Say plainly what you could not see.
