# Goal R47: Identify a miner by its group, not by guessing at its name

**Issued:** 2026-07-21 by the orchestrator (autonomous). **Status:** Ready. **Client only.**

## The current state

`looksLikeMiningEquipment` (`web/src/space/rowActions.ts:253`) decides whether a module is a mining laser by **pattern-matching its display name**:

```ts
/miner|mining|strip|harvest|deep core/i.test(label) && !/upgrade|rig|processor/i.test(label)
```

R43 made it slot-aware (`highSlotMiningModules`, `:370` — high slots only, flags 27–34), which removed the decoys that motivated the negative half. But the positive half is still a guess over English text, and it gates:

- what the **mining bot switches on** (`:336`), and
- whether a bot is **allowed to start at all** (R43's preflight).

## The authoritative signal exists, with no new route

**Verified live by the orchestrator** against the running BFF:

```
17482 → "Strip Miner I"   typeGroup: "Strip Miner"    typeCategory: "Module"
 1230 → "Veldspar"        typeGroup: "Veldspar"       typeCategory: "Asteroid"
 2488 → "Warrior II"      typeGroup: "Combat Drone"   typeCategory: "Drone"
```

`POST /api/names` already answers `typeGroup` and `typeCategory` — `resolveOneName` (`src/staticData.js:912-915`) maps them to `getTypeGroupName` / `getTypeCategoryName`. **No BFF route and no gateway pair is needed.**

⚠ **The request shape is `{ items: [{ kind, id }] }`** — objects, not strings, and the body key is `items`, not `keys`. The orchestrator got this wrong four times in a row while probing; read `resolveNames` (`src/staticData.js:948-965`) rather than inferring it.

## What to build

Replace the name guess with a **group** test, for both call sites at once.

- **Derive the mining group set; do not invent it.** Enumerate the actual `typeGroup` values of real mining modules from the SDE/static data rather than writing a plausible list. Strip Miner is one; there are others (ordinary mining lasers, ice harvesters, gas harvesters, deep core). **A guessed list is the same failure in a new costume.** Report the set you derived and how.
- **Keep the high-slot filter.** Group and slot are complementary: slot removes low-slot upgrades and rigs structurally; group removes the English-language guess. Keep both.
- **`cannot tell` still applies.** The group arrives asynchronously through `/api/names`, exactly as the label does. A module whose group has not resolved yet is **unknown**, not "not a miner" — `unnamedOnlineModules` (`rowActions.ts:380`) already encodes this reasoning for labels; the group needs the same treatment. **A preflight must never start a bot on an unresolved group.**

## The property that must not break

R43 established: **the preflight's set must remain a subset of what the loop would switch on.** A requirement that says *"yes, you have a miner"* about a module the loop will not activate makes the bot start and immediately pause — the exact failure the check exists to prevent. A test pins this today. **Move both call sites together, keep that test green, and do not weaken it.**

## Hard rules

- **The bot's behaviour may change only in the direction of correctness.** If the group test admits or rejects a module the name test did not, that is expected — but **report every such difference explicitly**, with the module and why. A silent behaviour change here is a bot that stops mining with a hull that used to work.
- **`miningBotLoop.test.ts` must keep passing.** If a case genuinely changes meaning, say so and explain rather than editing it quietly.
- **A 200 is not proof** — ten confirmed patterns.

## Invariants

**R7d** zero visible numeric IDs · **R8** · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1575/1575**) and BFF `node --test` (expect **1577/1577**); `tsc` + `build:web` clean.
2. Derive the group set, move both call sites, keep the subset test green.
3. Tests: a Strip Miner is a miner **by group**; a low-slot mining upgrade and a mining rig are excluded **by slot**; an unresolved group is `cannot tell` and does not start a bot; the subset property holds. **Watch each fail first** — twelve tests in this repo have been caught passing while asserting nothing.
4. **Verify live, briefly**: Farmer's Procurer carries 2× `Strip Miner I` at high slots 27/28. Confirm the group path finds exactly those two, and that the preflight still clears the bot. Release the session promptly.
5. Roadmap R47 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A mining module is identified by what the game says it is, not by what its name looks like; slot and group are both applied; unresolved groups still refuse to start a bot; and the preflight remains a subset of the loop.

## Constraints

- **Client only.** No BFF routes, no gateway pairs, no eve.js changes. Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode` — never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes pass in isolation — do not chase them.
- Servers: :26002 EveJS, :26500 web (restarted; the SPA is at **`/`** and missing `/assets/*` now correctly 404). :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **The operator may be reviewing the app.** Prefer not to restart :26500; if you must, say so. Keep any live session short and release it.
- Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's.
- **Browser pane:** screenshots time out and rAF never fires; static geometry IS measurable but async panel content never flushes. Drive `AppFlow` directly. Say plainly what you could not see.
