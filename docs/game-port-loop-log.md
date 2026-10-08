# Game-port loop log

The journal of the unattended loop described in
[`goal-prompts/game-port-loop.md`](goal-prompts/game-port-loop.md). Newest entry last. Each entry
says what was done, how it was proved, what was committed, and what is next.

## For the operator

Decisions taken in your place, and anything waiting on you. Overrule any of these by saying so.

- *(none yet)*

## Server defects

| Found | Defect | Evidence | Fix (eve.js) | Re-checked |
|---|---|---|---|---|
| 2026-10-08 | `corpRegistry.CanLeaveCurrentCorporation` returns `[0, "CrpAccessDenied", {}]`; the bare `{}` cannot be marshalled, so every client gets None | server log: `[PKT] ERR corpRegistry CanLeaveCurrentCorporation() Cannot marshal value: object {}`; parity report | not yet handed off | |

Candidate, not yet judged: the server answers None, and logs `[PKT] ERR`, whenever a handler or its
marshaller throws. Find out what a real server sends the client in that case (the decompiled
client's handling of a wrapped exception, and `blue`) before calling it a defect.

---

## 2026-10-08 — where the loop starts

Phases 0, 1 and 2 of the plan are done; their status sections in
`game-port-transport-plan.md` say what exists and how it was proved. 20 local commits on `master`,
nothing pushed. The EveJS server is not running. Test characters: `test` / Test Pilot 140000001
(docked, Jita 4-4) and `test2` / Test Two 140000002 (docked, with a staged colony).

### Next

In order. Each line is one unit unless it says otherwise.

1. **Hand off the known server defect** (table above) to a sub-agent; re-run the parity harness
   after the fix and regenerate the report.
2. **The three reader changes Phase 2 decided on**, in the browser, each with a test that fails
   first: `unwrapLong` reads a string of digits; `agents.ts` `seqItems` reads a bare array; byte
   readers (`boundPlanets.ts`, and whatever reads the Proving Grounds dates) read both spellings.
   Then re-run the harness: those nine reads should no longer be a risk to a decoder.
3. **Phase 3, step 1: the `PilotSession` seam as a pure refactor.** Introduce the interface in the
   BFF, implement it on the gateway, and route `heldTopLevelCall`, the bound bind and call,
   select, release and the event stream through it. No behaviour change; the existing suite is
   the proof. This is several units: split it by helper.
4. **Phase 3, step 2: the game-port implementation**, behind the per-pilot setting. Calls first,
   then binds as the retail client binds them (`eveMoniker.py` gives the parameters), then
   notifications and session changes mapped with `bridgeJson.js`. Undock refuses until Phase 4.
5. **Phase 3's check**: one account on the game port, browser unchanged, each docked feature
   exercised; one hosted maintenance flow.
6. **Phase 4 begins with reading `C:\Users\ryanf\Documents\GitHub\destiny`**, CCP's own ballpark,
   and recording a `DoDestinyUpdate` stream. The plan's spike question ("how much simulation is
   needed") changes now that the simulation's source is to hand: the unit is a port, checked
   against the server's snapshot of the same grid.
