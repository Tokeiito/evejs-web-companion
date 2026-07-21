# Goal R36: The distribution-mission bot

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Ready — R35 proved the rail. **Client only; zero new bridge surface.**

The operator asked for a client that can "run mining or courier missions on its own." The **mining bot** (R26) is done and ran unattended for two cycles. This is the other half — and the operator has clarified it means **distribution missions from an NPC agent**, not player contracts.

**R35 observed the whole rail live, twice**: agent Antaken Kamola (3008416) → *"Tidings of Conflict (1 of 2)"* → Reports ×1 → Muvolailen 60000004 → Elonaya 60000256 → **6 jumps** → **+140,250 ISK**, LP 0 → 213 → 426, standing 0 → 0.18 → 0.357. Everything below is measured, not assumed.

## Build it as the fourth instance of the same pattern

`web/src/nav/autopilotLoop.ts` and `web/src/nav/miningBotLoop.ts` are the pattern: a browser-side decide-loop that reads authoritative state each tick, issues **at most one** atomic call, never simulates, and **pauses rather than guesses**. R26 shares `decideCloseIn` with the autopilot rather than copying it. **Do the same — a new ladder over the same discipline.** It runs in the browser: closing the tab is closing the client.

## The ladder

Each tick, read state and pick ONE action:

1. **No mission** → find a usable courier agent at the current station; if none, pause with a plain reason (do not wander).
2. **Agent available, no offer** → Request.
3. **Offer in hand** → **gate before accepting**: cargo volume vs `invbroker.GetCapacity`, and route length. Accept only if both pass; otherwise Decline (or leave it) with a stated reason.
4. **Accepted, package not aboard** → load it from the pickup hangar.
5. **Package aboard, not at dropoff** → fly the route (reuse the autopilot ladder wholesale).
6. **At dropoff with package** → unload, then Complete.
7. **Complete confirmed** → read rewards, then loop.
8. Anything unclear → **pause with a reason**. Never fabricate progress.

Every branch bounded, as R13/R24/R26 bound warp, jump, dock and hold-full.

## What R35 established — do not re-derive, do not contradict

- **`missionCompleted` is `null` on a refusal, NOT `false`.** A refused Complete returns HTTP 200, `ok:true`, an **empty actions list**, and `missionCompleted: null`. **`=== true` is the only safe test**; `!== false` reports refusals as success. Already fixed in `chooseAction` (`flow.ts:3739`) — the bot must use the same test.
- **`doAgentAction` returns `success: true` on every branch** (`agentMissionRuntime.js:6725-7092`). Judge only by `lastActionInfo` and the returned `actions` list.
- **Action tokens are re-minted across a move.** Observed 815/816 → 819/820 → 821/822 for the same agent. **Never cache an actionID** across a warp, jump or dock — re-open the conversation and re-read.
- **An empty actions list is not exclusively the standing gate.** It is also location-dependent and *recovers* — the same agent offered Complete+Quit at the dropoff after offering nothing at the pickup. So do not treat "no actions" as terminal; treat it as "not here, not now."
- **The refusal is not silent.** It carries `OnMissionsUpdated` with `info: ["TransportItemsPresent","3814","60000256","1"]`, on a channel the BFF already forwards. Prefer that over guessing.
- **Journal disappearance is ambiguous.** `completeMission` deletes the row (`:6059`); `history` is never surfaced. Complete, quit, decline and expire are all "the row is gone." **Never infer success from a missing row.**
- **Accept must be in person** — remote accept is silently refused for couriers (200 + the *offered* conversation).
- **The dropoff is not nearby.** `resolveDropoffStation` takes the corp's **lowest-`solarSystemID`** station, and every agent of a corp routes to the same one. The live run was 6 jumps. **Cap jumps before accepting** and refuse rather than committing to a route the player did not sanction — especially one crossing lowsec.
- **Chain fragments are normal.** The live mission was "(1 of 2)" and completing it advanced to 58608. Surface that the bot has entered a chain; do not hide it.
- **Cargo volume**: median 0.1 m³, max 4,000 m³. Check capacity **before** accepting, never after.

## Known bad ground — handle, do not fix

- **`getCourierProgress` judges by typeID, not itemID** (server-side, marked in R35, **do not fix**): pre-existing stock of the cargo type at the dropoff can satisfy the objective without hauling. Because courier cargo is ordinary market goods, this is reachable in normal play.
- **The package's itemID is not readable by the client.** A player stack of identical type *and* quantity is genuinely indistinguishable from the package. R35's `loadPackageIntoShip` now matches on type **and quantity**; that is the best available and it is not perfect. **Do not pretend otherwise in the UI** — if the bot cannot be sure it loaded the right stack, say so.
- **`lastActionInfo.loyaltyPoints` read 0 on a completion that paid 213 LP.** Do not use it as the reward readout; read the actual LP balance.

## UI

A **Mission bot** control beside the mining bot: Start / Pause / Stop, and a live readout of what it is doing and **why** — current agent, mission name, cargo, destination, jumps remaining, ISK/LP earned this run, and the reason if it paused. The player must always be able to interrogate the last decision.

## Hard rules

- **A 200 is not proof** — ten confirmed patterns now. Confirm every action against an authoritative re-read.
- **The server owns the rules.** Do not reimplement standing gates, volume maths or route legality. Issue the call, read the refusal, render it through R31.
- **Zero new gateway pairs and zero new BFF routes.** Everything is already allowlisted (nine `agentMgr` pairs, the inventory surface, board/undock, the beyonce/autopilot set). If you believe you need new surface, **stop and report** — the point of this goal is composition.
- **Watch every new test fail before trusting it.** Four tests in this repo were recently found green while asserting nothing. Prefer fixtures built from **real captured bytes** — that practice is exactly what caught the `null`-vs-`false` divergence above.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1305/1305**), `tsc` + `build:web` clean.
2. Implement with tests driven off synthetic state, as `autopilotLoop.test.ts` and `miningBotLoop.test.ts` do: assert each rung fires at the right state, that the capacity and jump gates refuse correctly, that a refused Complete does NOT advance, that a re-minted actionID is re-read rather than cached, and that **no branch can repeat unboundedly**.
3. **Verify live — at least one complete unattended mission**, start to paid. Report real numbers: agent, mission, cargo, route, jumps, ISK, LP, standing. Then report every pause reason the bot hit.
4. Roadmap R36 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player picks an agent station, presses Start, and the client runs distribution missions unattended — requesting, gating, accepting, loading, hauling, delivering and collecting — pausing with a readable reason on anything it cannot handle. Live-verified for at least one full mission. Bounded everywhere.

## Constraints

- **Client only. ZERO eve.js source changes** — if you find a server defect, report it. Another agent has in-flight destiny/parity work on `ReconcileEliteMode`; never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green.
- Servers up: :26002 EveJS (detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` in the repo root are the orchestrator's — leave them. Leave the character docked and sane; release the session.
- **Test Two is docked at Elonaya 60000256 in a Badger** (4,095 m³, bought live for 1,549,142 ISK in R35) — a usable starting point.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because it reports `visibilityState === "hidden"` with a 0×0 viewport. Expected. `get_page_text`/`read_page` work. Say plainly what you could not see.
