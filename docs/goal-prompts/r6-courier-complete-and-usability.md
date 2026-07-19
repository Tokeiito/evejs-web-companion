# Goal R6: Complete a courier end-to-end + agent-list usability

**Issued:** 2026-07-19 by the orchestrator session. **Depends on:** R2–R5b complete and live-validated (login, station, inventory/ship move+board, agentMgr accept, bound-object bridge, and the browser autopilot — Farmer was autonomously flown Maurasi→Jita and docked). **Status:** Ready to run.

This is the **courier milestone capstone**: tie the built pieces into a full courier run and add the last new gameplay (deliver + complete), plus the one usability fix the live test surfaced. When this lands, a player can complete a courier mission entirely in the browser (roadmap §7).

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md` (§6 milestone, §7), `docs/bridge-wire-contract.md`, and `docs/retail-call-inventory.md` **Steps 5, 10, 11, 12**. Execute exactly this goal, then stop.

## Live-test findings this builds on (from the orchestrator)

- **Live courier accept is reachable**: Farmer is docked at Jita 4-4 (station 60003760), which has 882 courier agents (e.g. L1 courier agent 3008416). The R4 accept flow + R5b autopilot both work live.
- **Usability blocker**: the Agents & Missions page renders **all** ~1,678 station agents as buttons, which strains the browser and makes picking a courier agent impractical. Fix this (below) — it's needed to drive the milestone.
- Courier delivery has **no distinct RPC** (inventory Step 10): the mission cargo is ordinary inventory (moved to the ship via R3), and `DoAction(Complete)` at the destination agent validates delivery + pays out.

## Objective

1. **Agent-list usability (web):** filter the agent roster — at minimum a **courier-only toggle** and a level/text filter, and cap the rendered list (e.g. show the first N with a count and a search box) so the page stays responsive with ~1,700 agents. Keep it a pure store/decoder + view change; no gateway change.
2. **Mission cargo + briefing (web, mostly built):** after accepting a courier, read `GetMissionObjectiveInfo` (already allowlisted) to show the courier package (typeID, qty, volume), pickup, **dropoff station**, reward, collateral. Provide a control to move the mission package into the active ship (reuse the R3 inventory move) and a one-click "set autopilot to the dropoff" (reuse R5b: resolve the dropoff station → Start route).
3. **Deliver + complete (the new gameplay):** at the destination, `DoAction(<complete actionID>)` on the bound agent completes the mission; then show the updated wallet / loyalty points / standings / journal (Step 12 reads — `account.GetCashBalance`, `LPSvc.GetAllMyCharacterWalletLPBalances`, `standingMgr.GetCharStandings`, `agentMgr.GetMyJournalDetails`; add any not already allowlisted, deny-by-default, pairs only). Complete is a synchronous `DoAction` like accept; if any completion action is deferred, the R4 deferred adapter already handles it.
4. Prove the full accept→cargo→(autopilot)→complete path in-process with a deterministic courier fixture; the orchestrator live-tests the end-to-end run.

## Required work

1. **Baseline** (record): web `npm test` (expect 267/267); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the six gateway suites green. Leave other agents' eve.js work alone; stage only your files; never `git add -A`.
2. **eve.js (only if new allowlist pairs are needed for Step 12 reads/complete):** add them (pairs only, deny-by-default) with a gateway test; footprint = `_secondary/express` + tests. If the Step 12 reads and Complete are already covered by the existing allowlist, make **no** eve.js change and say so. Commit separately if you do; report hash; do not push.
3. **web:** the agent-list filter; the mission cargo/briefing panel with move-to-ship + set-autopilot-to-dropoff; the Complete action + post-completion wallet/LP/standing/journal readout. New store slices/decoders as needed (long-aware; ISK/LP as decimal strings). Robust reads (`Promise.allSettled`) + session-loss unwind. Serve at `/dist/`.
4. **Deterministic test:** a fixture courier mission (agent + package + dropoff) proving accept → package identified → (cargo move) → Complete actually completes the mission (journal shows completed / mission cleared) and the reward/LP/standing reads reflect the payout. Deny-by-default intact.
5. **Update `docs/bridge-wire-contract.md`** (completion + Step 12 reads) and **README** (Spot test R6: the full courier run — pick a courier agent, accept, load the package, autopilot to the dropoff, Complete, see the reward). Update the roadmap R6 row to Complete with evidence.
6. Tests green; commit web; report all hashes. **Do not push.**

## Out of scope

- Combat/encounter missions. Multi-leg/loop missions beyond a single courier. Retiring the legacy v1-gateway/eveStore machinery — that's a separate cleanup goal (R7); do not delete it here.
- Notification push/streaming (G6) beyond draining into responses. Auth/security hardening.

## Definition of done

- The agent roster is usable (courier filter + capped render) with ~1,700 agents. After accepting a courier, the browser shows the package + dropoff, can move the package into the ship and set the autopilot to the dropoff, and **Complete** finishes the mission with the reward/LP/standing/journal updating — proven end-to-end in-process against a deterministic courier fixture. Deny-by-default intact; baselines non-regressed. Committed; hashes reported; not pushed.
- Roadmap R6 row Complete with evidence "in-process end-to-end; live spot test pending orchestrator".

## Constraints

- eve.js coordination: other agents active — small self-contained commit if any; stage only your files; never clobber/revert their work.
- A live EveJS (:26002) + web app (:26500) are running (orchestrator's); Farmer is docked at Jita 4-4. Do NOT touch those processes; run only npm test + Vite builds; leave nothing new running.
- Preserve `_local` gameplay data, web `data/`, icon caches, manifests, ignored credentials. Commit each repo separately; never push.
- If R6 exceeds one session, land the agent-list filter + the Complete flow (with the fixture test) and commit, then report the split for the cargo/autopilot glue. Never leave broken/uncommitted work.
