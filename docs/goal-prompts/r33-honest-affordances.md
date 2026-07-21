# Goal R33: Never offer a control that cannot work

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Ready. **Web-only, small.**

R30 established the rule for one control — *"an unavailable action renders disabled WITH the honest reason, never greyed silently and never guessed."* R31 established it for refusals already received. This goal applies the same principle to the case we keep re-discovering: **a control we render that the server can never honour.**

## The case that prompted it — verified live

A live run found an abandoned `Ice Harvesting Drone II` (`controllerID: null`, shield 0 / armor 25%) sitting in Perimeter II - Asteroid Belt 1. `POST /api/bridge/drones/recall` answered **200** and the drone did not move across 24 s of polling. **That is the ninth confirmed silent-decline case on this server.**

The BFF is honest — `droneOrderRoute` (`src/server.js:5705`) re-reads and still reports the drone in space. The **UI** is not: `Overview.svelte:2326` renders a per-drone Recall button and `:2359` a recall-all, and **neither consults `controllerID`**, which `web/src/bridge/space.ts:118` already decodes. So the player is offered a button that cannot work, presses it, and gets nothing — no movement, no sentence.

**Verify this yourself before building.** Confirm `controllerID` is the right discriminator (a drone you do not control vs one you do) rather than assuming — a drone may also be un-recallable for reasons other than ownership, and guessing the reason is worse than not naming it.

## Objective

1. **Fix the drone case.** A drone that cannot be recalled must not present a live Recall button. Render it disabled **with a plain sentence** saying why (R9a — plain player language, no codes, no jargon). Reuse R31's refusal vocabulary and R30's per-concern busy/disabled pattern rather than inventing a third mechanism.
2. **Sweep for siblings.** Find other controls we render unconditionally that the server can refuse structurally — i.e. where the client already holds the field that predicts the refusal and simply does not read it. Report every instance found. Fix the ones that are clearly the same defect; report the rest rather than silently changing behaviour.
3. **Do not over-correct into guessing.** If the client cannot tell whether an action will work, **leave the control enabled** and let the server refuse — R31 now renders that refusal in plain language, which is the honest path. A disabled control asserting a reason we cannot source is worse than an enabled one that gets a real answer. Say which side of that line each case falls on and why.

## Hard rules

- **Never invent a reason.** Pause-rather-than-guess applies to prose. If the field predicts refusal, name it; if it does not, do not.
- **Do not remove capability.** The recall-all button must still recall everything it legitimately can — disabling one drone must not disable the group action for the others.
- **A 200 is not proof** — nine confirmed cases now. This goal does not relax any post-hoc verification; a control that IS enabled must still confirm by re-reading authority.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (**1253/1253** as of R30; may be higher if R32 landed first — take the real number), `tsc` + `build:web` clean.
2. Verify the discriminator, implement, and test: a non-recallable drone renders disabled with a reason; a recallable one is unaffected; the group action still works for the rest.
3. **Verify live.** The abandoned `Ice Harvesting Drone II` (`9988400023314`, Farmer's, in Perimeter II - Asteroid Belt 1) is a real, reproducible instance — it was deliberately left in place. Confirm the button is now honest about it. **Leave the drone as found**; do not attempt to clean it up.
4. Roadmap R33 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

No control in the in-space panel invites an action the client already knows the server will refuse; each such control explains itself in a sentence; and controls whose outcome the client genuinely cannot predict are left enabled to receive a real, now-readable refusal.

## Constraints

- Web-only. **Zero eve.js changes** — another agent has in-flight destiny/parity work on branch `ReconcileEliteMode`; never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green.
- Servers up: :26002 EveJS (PID 52048, detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). You may restart :26002/:26500; own any process you start, set no `EVEJS_*` overrides, leave all three healthy.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because it reports `visibilityState === "hidden"` with a 0×0 viewport. Expected. `get_page_text`/`read_page` work for DOM reads; anything gated on `visibilityState === "visible"` (the space poll) never runs there. Say plainly what you could not see.
