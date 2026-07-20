# Goal R13: Flight fidelity — distance-driven autopilot + the missing flight verbs

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

Browser flight works but is *unlike* the retail client in two ways: it lacks align / orbit / keep-at-range / stop / warp-at-range, and its autopilot **guesses and reacts to refusals** instead of measuring distance. Retail measures every tick and decides correctly the first time. R11's space snapshot now gives us the data to do the same.

## What the research established (verified — build on this, don't rediscover it)

**The flight verbs** — all on the bound `beyonce` park we already use:

| Verb | Tuple | Allowlist |
|---|---|---|
| Approach | `("beyonce","CmdFollowBall",[targetID, 50])` — retail's **menu** approach uses **50 m**; only the autopilot uses `0.0` | already allowed |
| **Keep at range** | `("beyonce","CmdFollowBall",[targetID, range])` — *same method*, non-zero range; default **1000 m**, floored at 50 m | **already allowed — we just hardcode 0.0** |
| **Orbit** | `("beyonce","CmdOrbit",[targetID, range])` — default **1000 m**; range coerced `float if <10 else int` | **needs adding** |
| **Align to** | `("beyonce","CmdAlignTo",[],{dstID: targetID, bookmarkID: null})` — **kwargs only, never positional**; exactly one non-null | **needs adding** |
| **Stop** | `("beyonce","CmdStop",[],null)` — in retail this **also kills the autopilot** (`CancelSystemNavigation` before, `SetOff` after) | **needs adding** |
| **Warp at range** | `("beyonce","CmdWarpToStuff",["item", itemID],{minRange: <metres>})` | **already allowed — pass the kwarg** |

Warp ranges (retail's right-click menu): **`[0, 10000, 20000, 30000, 50000, 70000, 100000]`**. Retail's *default* "Warp to" is **0**, not 10 km. Valid `subject` strings incl. `item`, `bookmark`, `coords`. Server handlers for all of the above already exist in `beyonceService.js` — **call them, never change them.**

**The autopilot decision ladder** (`autopilot.py:274-404`), in evaluation order, measured once per tick as `shipDestDistance = GetSurfaceDist(ship.id, destID)`:
- **`< 2500 m`** (`maxStargateJumpingDistance`) and target is a gate → **jump** (also for Upwell jump gates)
- **`< 50000 m`** (`maxDockingDistance`) and target is a station/structure → **dock**
- **`< 150000 m`** (`minWarpDistance`) → **approach**, but **skip if already `DSTBALL_FOLLOW` on that same target** (never re-issue a running approach)
- otherwise → **warp**
- Never act mid-warp (`ship.mode == DSTBALL_WARP` → return) — the loop already does this; keep it.

**Surface distance** = `max(0, distance(a.position, b.position) - a.radius - b.radius)`. EveJS computes it identically at `services/drone/droneRuntime.js:1600` — match that formula exactly.

**The data is already there:** `/api/bridge/space/snapshot` (R11) returns each entity's `position` and `radius` plus the ship's own. `web/src/nav/autopilotLoop.ts` currently carries a comment disclaiming distance awareness — that is now stale and should be replaced by real measurement.

## Objective

1. **eve.js (gateway only):** allowlist `beyonce.CmdOrbit`, `beyonce.CmdAlignTo`, `beyonce.CmdStop` — pairs only, deny-by-default intact, with a test proving non-allowlisted `beyonce` siblings are still refused.
2. **BFF:** routes for orbit, align, stop, keep-at-range, and **warp-at-range**. Stop hardcoding `0.0`: approach takes a range (default 50 m), keep-at-range takes a range (default 1000 m), warp takes an optional `minRange`. `CmdAlignTo` must send **kwargs**, never positional.
3. **Autopilot loop — measure, don't guess.** Feed the R11 snapshot into `autopilotLoop.ts` and gate on real surface distances with the thresholds above, in retail's evaluation order. Keep the existing safety behavior: never act mid-warp; never re-issue a running approach; still **pause rather than guess** on an unexpected refusal. The existing refusal handling stays as a backstop — measurement is the primary path, refusals the fallback. Remove/replace the stale "no distances" comment.
4. **Web UI:** on Overview rows (and the Flight tab) offer **Warp to** with a range choice (`0 / 10 / 20 / 30 / 50 / 70 / 100 km`), **Orbit**, **Keep at range**, **Align to**, **Approach**, and **Stop**. Stop should also stop the autopilot, matching retail.

## Invariants

- **R7d** zero visible numeric IDs (ranges are distances, not IDs — display them as `10 km`, never raw metres where a player expects km). **R8** responsive/reflow + touch targets. **R9a** plain player language.
- Movement authority stays server-side: the browser measures only to *decide which authoritative call to make*; it never simulates or predicts position.

## Required work

1. **Baseline** (record): web `npm test` (expect 422/422); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the **12** isolated gateway suites green.
2. Implement 1–4 with tests: gateway allowlist test (+ deny-by-default siblings refused); BFF route tests incl. `CmdAlignTo` kwargs shape and range pass-through; and **autopilot loop tests driving the decision ladder off synthetic distances** — assert jump/dock/approach/warp are chosen at the right thresholds, that a running approach is not re-issued, and that mid-warp does nothing.
3. Update `docs/bridge-wire-contract.md` (the flight verb table + thresholds) and the roadmap (R13 row). Commit eve.js and web **separately**; report both hashes. **Do not push.**

## Definition of done

- The player can align, orbit, keep at range, stop, approach, and **warp to a chosen range** on anything in the overview; the autopilot decides jump/dock/approach/warp from **measured surface distance** at retail's thresholds rather than from refusals, while keeping its pause-don't-guess safety. All invariants hold; all baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed separately; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface only**; never modify `beyonceService.js`, the space runtime, or any mechanics — call them. eve.js is on branch `ReconcileEliteMode`; commit to the checked-out branch, stage only your files (other agents have in-flight work — a pathspec commit is the safe form), never `git add -A`, never revert them.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If too large for one session, land the **verbs** (allowlist + BFF + UI actions) first, committed and green, then the autopilot measurement rewrite — and report the split. Never leave broken or uncommitted work.
