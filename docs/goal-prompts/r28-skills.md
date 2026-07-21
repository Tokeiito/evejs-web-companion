# Goal R28: Skills — the character sheet and the training queue

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Ready to run.

Skills are the one major retail system with a **complete server-side implementation and zero client surface.** R9b deleted the legacy UI; nothing replaced it. This goal builds it back properly.

There is a second reason to do this one now. R27 measured our icon cache honestly: **466 of 536 cached icons are skills — 100% coverage of every skill type.** Every other panel (ore hold, market, industry, overview) is at or near **zero** and renders letter tiles. The skills screen is the *only* screen in the app where the icons we already have would actually appear. This feature and our asset cache were made for each other.

## Verified research — the gateway is already done

In `server/src/_secondary/express/evejsWebGatewayRuntime.js` (**read it before designing**):

- Requires `../../services/skills/training/skillQueueRuntime` (:14).
- **Read:** `skillQueueRuntime.getQueueSnapshot(characterID)` (:2075); the character snapshot already carries `skills` (:2089) and `skillQueues` (:2094) table entries, plus `skillPointsPerMinute` (:2008) and `freeSkillPoints` (:2026).
- **Write:** `CHARACTER_COMMAND_TYPES.SAVE_SKILL_QUEUE` = `offline.skill_queue.save` (:812), normalised by `normalizeSkillQueueCommandPayload` (:856) — which enforces `SKILLQUEUE_MAX_NUM_SKILLS` — and exposed as `submitSkillQueueSaveCommand(characterID, envelope)` (:2580). It persists with `gameStore.flushTablesSync(["skillQueues", "skills", "characters"])` (:2140).
- **Refusals are already player-safe:** `PUBLIC_SKILL_QUEUE_ERROR_CODES` (:815) is an 11-code allowlist — `QueueTooManySkills`, `QueueTooLong`, `QueueSkillNotUploaded`, `QueueCannotTrainPastMaximumLevel`, `QueueCannotTrainOmegaRestrictedSkill`, `QueueCannotTrainPreviouslyTrainedSkills`, `QueueCannotPlaceSkillLevelsOutOfOrder`, `QueueCannotPlaceSkillBeforeRequirements`, `UserAlreadyHasSkillInTraining`, `SkillInQueueRequiresOmegaCloneState`, `SkillInQueueOverAlphaSpTrainingSize` — mapped by `mapSkillQueuePublicError` (:1774). A capability flag `skillQueue` (:2210) reports whether the runtime is present.
- **In our BFF, every single `skill` match in `src/server.js` is a comment.** There are no routes. The gap is exactly: BFF routes + web UI.

**Do not reimplement any of this.** SP maths, level thresholds, prerequisite ordering, Omega/Alpha gating and lazy wall-clock settling are the server's. Call them and render what comes back.

## Objective

1. **A Skills panel** — the character sheet half: total SP, free/unallocated SP, skills grouped by their skill group, each showing level (the classic five-square rank), current SP and SP to next level. Use **`TypeIcon`** (R27) — this is where it finally pays off.
2. **The training queue** — what is training now, with a **live** countdown and progress that advances on the clock, then what follows it, with finish times. Reuse the R24/R26 push-channel + settle discipline; do **not** invent a client-side SP simulation to make the bar move — derive the display from `skillPointsPerMinute` and the server's own start/end values, and re-read the authority rather than drifting.
3. **Editing the queue** — add a skill, remove one, reorder. Every edit goes through `SAVE_SKILL_QUEUE` and is **confirmed by re-reading the queue**, never assumed.
4. **Refusals are the feature, not the error path.** All 11 codes above are things a player will actually hit. Each must render as plain language (R9a) explaining what to do — e.g. `QueueCannotPlaceSkillBeforeRequirements` is "You need <prereq> first", not a code.

## Hard rules

- **A 200 is not proof.** Seven confirmed silent-decline cases now, including R25's launch that returned 200 while refusing two of three drones inline. Confirm every queue edit by re-reading `getQueueSnapshot`.
- **Time is the server's.** Never advance SP locally past what the server reports; a countdown may interpolate *between* reads, but a read always wins.
- If you believe you need a **new gateway pair**, you may add it — this is the one area where our surface is genuinely missing. Restrict changes to `server/src/_secondary/express/*` and `server/tests/*`. **Never touch game mechanics.** Another agent has in-flight destiny/parity work — never revert or clobber it; commit by pathspec, never `git add -A`.

## Invariants

**R7d** zero visible numeric IDs (a skill is its name, never a typeID) · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green (add the new panel to it).

## Required work

1. Baseline: web `npm test` (expect **1119/1119**), `tsc` + `build:web` clean. Two known pre-existing eve.js failures — `webGatewayEvents` (upgrade rejection) and `droneRuntimeParity` — **do not touch either.**
2. Build it, with tests driven off synthetic state as `autopilotLoop.test.ts` and `miningBotLoop.test.ts` do: assert grouping, level rendering, countdown derivation, and that **each of the 11 refusal codes renders as player language.**
3. **Verify live** — servers are up (:26002 EveJS, :26500 web, :40111 market daemon RPC); you may restart them, and must leave all three healthy. Read a real character's skills, then **make a real queue edit and prove it survived a re-read.** Report real numbers: SP totals, the skill trained, the queue before and after.
4. **Confirm the icons actually appear** — R27's coverage says they should. Report how many skills on screen got a real icon versus a letter tile. If it is not ~100%, say so.
5. Update the roadmap (R28 row) + `docs/bridge-wire-contract.md` if the contract changes. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player opens Skills, sees what they know and what they are training with a clock that actually moves, and can add/remove/reorder queued skills — with every refusal explained in plain language. Live-verified with a real queue edit that survived a re-read. Suites green. Committed; hashes reported; not pushed.

## Constraints

- Screenshots have been unavailable to every worker — verify by measurement and say plainly what you could not see.
- Never push. Preserve `_local` gameplay data, `data/`, icon caches and manifests.
