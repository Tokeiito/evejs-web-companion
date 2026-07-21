# Goal R31: The server's refusal, in the player's language

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Ready. **Web-only, small, fixes a standing invariant violation.**

R9a — *plain player language, never codes or jargon* — is one of our four standing invariants, and we are currently violating it in the one place the player is most likely to look: the moment something is refused.

## The evidence

`flightErrorReason` (`web/src/app/flow.ts:1808`) passes the server's raw refusal text straight through, and every flight verb interpolates it into a player-facing message — `flow.ts:2032`, `:2175`, `:2205`, `:2283` and more, in the shape `` `${label} refused: ${flightErrorReason(error)}` ``.

So the player can be shown, verbatim:

```
Jump refused: 101,UI/Menusvc/MenuHints/NotWithingMaxJumpDist
```

That is a client resource key with a numeric prefix and a typo CCP shipped (`Withing`, sic — see the note already at `autopilotLoop.ts:681`). R29 confirmed this class of string is live: an out-of-range jump was refused with exactly that text. R30's new **Jump to {System}** button makes it far more reachable than before, because jumping is now one click from the cockpit rather than a raw-ID form.

This is pre-existing convention, not R30's fault. It is now worth fixing on its own.

## Objective

**A single translation seam** that turns a server refusal into a sentence a player understands, used by every verb that can be refused.

1. **Find the real vocabulary first.** Do not guess the code list. Search eve.js for the refusal strings actually produced (`UI/Menusvc/MenuHints/*`, `UserError` names, the `CALL_REFUSED` messages our BFF forwards) and enumerate what can actually reach the client. R28 established the pattern: its skill-queue table is *exactly* the gateway's own 11-code allowlist, asserted by test. Do the same here — a table derived from the server's real vocabulary, not invented.
2. **Translate what you know; degrade honestly for what you do not.** A recognised refusal becomes plain language ("That gate is too far away to jump to — get closer first."). An **unrecognised** one must NOT be dumped raw at the player. Show a plain fallback and keep the raw text available for diagnosis (a detail/title attribute, a console line, or a collapsed "technical detail" — your call, but the player-facing sentence must be clean).
3. **Never invent a reason.** If the server's meaning is unclear, say something true and non-specific rather than a confident guess. Pause-rather-than-guess applies to prose too.
4. **Keep the refusal attached to the control that caused it** — R30 slice C established the per-concern busy set and errors rendered at their control. Do not regress that into a global banner.

## Hard rules

- **Do not swallow refusals.** The player must still learn that the action did not happen. This goal changes the *wording*, never the *fact*.
- **Do not translate in the BFF.** The raw server text is the authority and must keep flowing over the wire unchanged; translation is a browser-side presentation concern. (If you find a reason this must move server-side, stop and report rather than adding gateway surface.)
- **A 200 is not proof** — eight confirmed silent-decline cases now. This goal does not relax any post-hoc verification.

## Invariants

**R9a** is the point of the goal — prove it with a sweep asserting no rendered refusal contains a resource path (`UI/`), a bare numeric code prefix, camelCase identifiers, or `CALL_REFUSED`. **R7d** zero visible numeric IDs · **R8** responsive · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1205/1205**), `tsc` + `build:web` clean.
2. Build the seam + the table derived from eve.js's real vocabulary. Test each mapping, and test the unknown-refusal fallback explicitly.
3. **Verify live** — provoke at least two real refusals end to end (an out-of-range jump is easy and confirmed to produce the bad string; a second of your choosing) and report the exact before/after text the player sees.
4. Roadmap R31 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A player who is refused reads a sentence, not a resource key; an unfamiliar refusal still reads as a sentence, with the raw text recoverable but not in their face; and a test makes the regression impossible.

## Constraints

- **Web-only. Zero eve.js changes** — another agent has in-flight destiny/parity work on branch `ReconcileEliteMode`; never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is now GREEN (8/8) and must stay green.
- Servers are up: :26002 EveJS (PID 52048, detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 is normal). You may restart :26002/:26500 and must leave all three healthy. Do **not** set any `EVEJS_*` gameplay env overrides.
- **Verifying UI in the browser pane:** screenshots time out and `requestAnimationFrame` never fires, because the pane reports `document.visibilityState === "hidden"`. This is expected. `get_page_text` and `read_page` DO work — verify by reading the DOM, and say plainly that appearance/layout was not seen. Note anything gated on `visibilityState === "visible"` (the space poll, since R30 slice B) will never run in that pane.
