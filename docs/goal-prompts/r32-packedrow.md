# Goal R32: The contract detail panel has been getting null

**Issued:** 2026-07-21 by the orchestrator (operator AFK, autonomous). **Status:** Ready. **Web-only, small, fixes a live bug in shipped code.**

Found while scoping the courier bot; it is not a courier problem. **Verified personally by the orchestrator**, both ends:

- **Server emits a packedrow.** `buildContractDetailContractRow` (`eve.js server/src/services/_other/contractProxyService.js:337`) returns `buildPackedRow(CONTRACT_DETAIL_ROW_DESCRIPTOR_COLUMNS, …)` — shape `{type:"packedrow", header, columns, fields}`. It is used for the detail bundle at `:450` and `:491`. List rows are the *other* shape: `buildContractRow` (`:248`) returns `buildKeyVal`.
- **The client cannot read it.** `decodeContractRow` (`web/src/bridge/contracts.ts:107`) reads every field with `readKeyVal`, which gates on `isKeyValValue` (`wire.ts:121-136`, requiring `type === "object" && name === "util.KeyVal"`). A packedrow fails that gate, so every field is `undefined`, `contractID` becomes `0`, and the function **returns `null` at `contracts.ts:108-110`**.
- **`grep -c packedrow web/src/bridge/wire.ts` = 0**, while `fitting.ts`, `inventoryShip.ts`, `rewards.ts` and `src/server.js` all handle it explicitly. The BFF passes `detail.result` through raw (`src/server.js:3700`), so nothing rescues it in between.

**Net effect: `GET /api/bridge/contracts/detail` returns a decodable envelope whose contract row the browser silently drops.** The list works; the detail does not.

## Why no test caught it

`contracts.test.ts` builds its fixture with `keyVal(...)` under a header claiming to test the real wire shapes. It has been asserting against a shape the server does not send for this row. **This is the third case this session where a test's name was truer than its assertion** (the others: `fittingFlow`'s "shows the SERVER'S OWN reason" asserting the `CALL_REFUSED` envelope, and two R30 grep assertions that would have kept passing while testing nothing). Treat the fixture as the bug.

## Objective

1. **Teach the decoder the real shape.** `buildPackedRow` emits `.fields` as a plain name-keyed object, so this is mechanical: read `row.fields[key]` when `row.type === "packedrow"`, else `readKeyVal`. Prefer putting the branch in the shared `wire.ts` helper so the next decoder gets it for free — check how `fitting.ts`/`inventoryShip.ts`/`rewards.ts` already do it and **follow the established pattern rather than inventing a fourth one**.
2. **Fix the fixture, do not weaken the assertion.** The test must drive the shape the server actually emits. Build the fixture from the server's real builder shape; if the existing fixture helper only makes KeyVals, add a packedrow helper beside it.
3. **Sweep for the same class of bug.** This is a decoder/shape mismatch. Check every other decoder that reads a server row against what its handler actually builds — if another one reads `readKeyVal` against a `buildPackedRow` (or vice versa), report it. Do not fix unrelated ones silently; report and fix only what is clearly the same defect.

## Hard rules

- **Do not change the wire.** The server's shape is authoritative and correct; the client is wrong. **Zero eve.js changes.**
- **A 200 is not proof** — nine confirmed cases of the server reporting differently from what it did. This bug is exactly that shape from the other direction: a well-formed response the client throws away.
- Do not "fix" the detail panel by falling back to list data. The detail row carries fields the list does not.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (expect **1253/1253**), `tsc` + `build:web` clean.
2. Fix the decoder + the fixture. Add a test that would fail against the pre-fix decoder — **state that you ran it against the old code and watched it fail**, not just that it passes now.
3. **Verify live**: fetch a real contract detail through the running BFF and show the decoded row with real field values — the proof is a populated row where the client previously had `null`. If the world currently has no contracts, say so plainly rather than inventing a fixture and calling it live verification.
4. Roadmap R32 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The contract detail panel receives a populated row from the real server; a test drives the shape the server actually emits and was watched failing before the fix; and the sweep reports whether any sibling decoder has the same defect.

## Constraints

- Web-only. Another agent has in-flight eve.js destiny/parity work on branch `ReconcileEliteMode` — never revert or clobber it. Never `git add -A`. Never push.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green.
- Servers are up and healthy: :26002 EveJS (PID 52048, detached, clean env), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 is normal). **This goal should not need a server restart** — another worker may be using the live world, so do not restart unless you must, and leave all three healthy if you do. Set no `EVEJS_*` overrides.
- **Browser pane:** screenshots time out and `requestAnimationFrame` never fires because the pane reports `visibilityState === "hidden"`. Expected, not a broken app. `get_page_text`/`read_page` work. Say plainly what you could not see.
