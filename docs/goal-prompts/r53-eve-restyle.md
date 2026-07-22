# Goal R53: Look more like the EVE client — square, condensed, no rounded corners

**Issued:** 2026-07-21 (operator's tightening list, item 6). **Status:** Ready — run LAST of the UI batch so the token flip cascades to R50/R51/R52's new UI. **Client only; CSS-centred.**

The operator: *"Overall, we need to start looking more like the Eve Online client interface. Very condensed, square buttons and no rounded corners."*

This is a **first mechanical pass** toward the EVE aesthetic — three concrete, verifiable changes — **not** a from-scratch reskin. The operator judges the look; your job is the token-level change while preserving every invariant. Do not invent a new visual language or restructure layouts.

## The three changes

1. **No rounded corners.** The design system centralises radius in two tokens at `web/src/styles.css:98-99` (`--radius-frame: 0.5rem`, `--radius-control: 0.375rem`). Set **both to 0**. Then sweep the remaining hardcoded `border-radius` in `styles.css` (0.3rem, 0.4rem, 0.25rem, the `999px` pills, etc. — ~15 sites) and any `rounded-*` Tailwind classes in `.svelte` components to **square** (0 / `rounded-none`). `grep -rn "border-radius\|rounded-" web/src` should come back essentially all-zero after. Square corners everywhere is the operator's explicit ask.
2. **Square buttons.** Buttons read as rectangles/squares, not lozenges — a consequence of (1) plus not being pill-shaped. The `999px` pill (`styles.css:526`) becomes square.
3. **Very condensed.** Tighten the spacing scale — control padding, card padding, gaps, margins — so the UI reads denser and more technical, closer to EVE's information density. Do this at the **token/base-style level** (padding/gap variables and the shared control/card rules), not by editing每 component, so it stays coherent and cascades.

## The one real tension — resolve it explicitly

**R8 requires ≥40px touch targets**, and "very condensed" pulls the other way (EVE's real controls are often smaller). **Keep R8: controls stay ≥40px tall.** Condense *horizontal* padding, gaps, and vertical rhythm between elements — not the tap-target height. A square button can be dense (tight horizontal padding, square corners) and still 40px tall. If you believe genuine EVE density needs sub-40px controls, **do not do it** — leave a note in the report and the AFK log flagging it as an R8-relaxation decision for the operator, and keep ≥40px for now.

## Hard rules

- **Client only.** No BFF, no gateway, no eve.js. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — don't touch eve.js. Never `git add -A`. Never push.
- **Structure and behaviour unchanged** — this is appearance only. No panel logic, no store, no flow changes. If a component needs a class tweak to square a corner, fine; do not refactor it.
- **Theme-aware:** the app already supports light/dark and the four faction themes (Caldari/Amarr/Gallente/Minmatar) — the restyle must not break any of them. Radius/spacing are theme-independent, so this should be safe; verify the theme tokens still apply.

## Invariants

**R7d** unaffected (visual only) · **R8** ≥40px targets **preserved** (see the tension above), no horizontal body scroll · **R9a** unaffected · **R18** `panelFirstMount` green.

## Required work

1. Baseline: combined `node --test` (expect **1625/1625**), `tsc` + `build:web` clean.
2. Flip the radius tokens to 0; sweep remaining radii/`rounded-*` to square; condense the spacing tokens/base styles.
3. **Verify what is machine-verifiable** (the browser pane cannot be seen, so this is how you prove it): via `javascript_tool` + `getComputedStyle` on the running SPA at `/`, assert representative controls/cards report `border-radius: 0px`; via `getBoundingClientRect`, assert interactive targets are still ≥40px tall and the body does not scroll horizontally at 375px and 1280px. A test that greps `styles.css` for residual non-zero radius is reasonable — if you write one, prove the matcher matches a non-zero value so it can actually fail.
4. **State plainly that the *look* was not seen** — you can prove corners are square and targets are sized, but not that it "looks like EVE." That judgment is the operator's.
5. Update `docs/afk-session-log.md` (append result + the R8/density decision) and the roadmap R53 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

Radius tokens are 0, no rounded corners remain, buttons are square, spacing is condensed at the token level, all themes still apply, ≥40px targets preserved, no horizontal overflow, suite green. The subjective "looks like EVE" is left for the operator, with square/condensed proven by computed-style + geometry measurement.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — do not chase them (rerun the suite before assuming a single failure is yours).
- Servers: :26002 EveJS (PID 57760), :26500 web (PID 59260, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **No gateway pair.** You will likely restart :26500 to load the rebuilt CSS for the live computed-style check — own the process, set no `EVEJS_*` overrides, leave all three healthy.
- **You are the only build worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** SPA at `/`. Screenshots time out and rAF never fires; **but `getComputedStyle`/`getBoundingClientRect` via `javascript_tool` DO work on the first-paint DOM** — that's exactly how you verify square corners and target sizes. The look itself cannot be seen. Say so.
