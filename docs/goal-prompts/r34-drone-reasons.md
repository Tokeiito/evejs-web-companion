# Goal R34: The thirteen sentences the server already wrote for us

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Ready. **Small; BFF + web.**

R33 shipped a client-side *prediction* that a drone is not under this ship's control, and justified it on the grounds that "R31 had nothing to render." That justification was true but the cause was ours: **the server writes a plain-language reason for every drone-order failure, and our BFF throws it away.**

This goal recovers the authoritative reason. It is strictly better than prediction — it covers cases we cannot predict, and it cannot drift from the server's rules.

## The evidence — verified by the orchestrator

- `droneRuntime.js` calls `appendDroneError(response, droneID, "<sentence>")`, writing a **per-drone** message into the call **result** dict, keyed by droneID. Captured live by R33:
  ```
  result: {"entries":[[9988400023314,["CustomNotify",{"entries":[["notify",
     "That drone is not currently under this ship's control."]]}]]]}
  ```
- **`droneOrderRoute` (`src/server.js:5681`) forwards only `outcome.notifications`.** `outcome.result` is dropped.
- The vocabulary is already player-ready — **thirteen distinct sentences**, no codes, no jargon:
  > Drone is too far away to scoop into the bay. · No owned salvageable wreck is available. · That drone cannot currently be scooped into the drone bay. · That drone cannot mine the selected resource. · That drone has no supported engage profile. · That drone has no supported mining profile. · That drone is not currently under this ship's control. · That drone is not in local space. · That target cannot be engaged by drones. · That target cannot be mined or salvaged by drones. · That target cannot be salvaged by drones. · That target is not visible to this drone. · Unable to scoop that drone.

**These are R9a-compliant as written.** Do not paraphrase them. Pass them through.

## Objective

1. **Forward `outcome.result`** from `droneOrderRoute` alongside the notifications, and decode the per-drone dict in the browser.
2. **Report per drone, not per call.** A drone order is a fan-out over several drones exactly like R30's "Mine this" — and R30's live run proved a later success can clear a shared error slot, hiding an earlier refusal. Each drone's outcome must be individually attributable. **Reuse that pattern; do not invent a second one.**
3. **Prefer the server's sentence over the prediction.** Where R33 predicts and the server also answers, the server wins. Keep R33's prediction only where it genuinely fires *before* a call is made (disabling a control) — that is a different job from explaining a call that already failed. State clearly in your report where each mechanism now applies.
4. **Unknown messages must survive.** If the server sends a sentence not in the known set, show it (it is already plain language) rather than swallowing it or replacing it with a generic. Guard only against non-sentences: if what arrives looks like a code or identifier rather than prose, fall back to R31's generic handling.

## Hard rules

- **Do not paraphrase the server's text.** It is the authority and it is already readable. R31's table exists for *codes*; this is prose and needs no translation layer.
- **Do not translate in the BFF.** Forward the raw structure; decode and present in the browser.
- **A 200 is not proof** — nine confirmed silent-decline cases, one of them this exact drone. The presence of a per-drone error means the order did NOT happen for that drone; keep re-reading authority to confirm what did.
- **Do not remove R33's capability preservation:** a group order still acts on every drone it legitimately can.

## Invariants

**R7d** zero visible numeric IDs (the dict is keyed by droneID — that key must never reach the screen) · **R8** responsive · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1274/1274**), `tsc` + `build:web` clean.
2. Implement; test the per-drone attribution, the unknown-sentence pass-through, and that a droneID never renders.
3. **Verify live.** The abandoned `Ice Harvesting Drone II` (`9988400023314`, `controllerID: null`, Perimeter II - Asteroid Belt 1) reproduces one of the thirteen on demand. Report the exact text the player now sees, and confirm it came from the server rather than from R33's prediction. **Leave the drone as found.**
4. Roadmap R34 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A drone order that fails tells the player the server's own reason, per drone, for any of the thirteen cases — not just the one the client can predict. No droneID is visible. R33's disabled-control prediction still works where it applies, and the two mechanisms do not contradict each other.

## Constraints

- **Zero eve.js changes** — the server side is already correct; this is entirely our loss of data. Another agent has in-flight destiny/parity work on branch `ReconcileEliteMode`; never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green.
- Servers up: :26002 EveJS (PID 52048, detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because it reports `visibilityState === "hidden"` with a 0×0 viewport. Expected. `get_page_text`/`read_page` work; anything gated on `visibilityState === "visible"` never runs there. Say plainly what you could not see.
