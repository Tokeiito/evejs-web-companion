# Goal R54: Wallet ledger — transactions + journal (API head-start, Tier A #1)

**Issued:** 2026-07-21 (operator's API head-start: *"start setting up ALL calls … get a head start on the API calls"*). **Status:** Ready. **Client + bridge.**

First cluster of the API-coverage head-start (`docs/api-coverage-plan.md`). Extends the Wallet tab R50 built (balance + corp divisions) with the **ledger** — what money moved and why. Chosen first because it (a) completes a feature the operator can see, (b) is all top-level/`account`, and (c) forces the **Rowset + bare-string-bigint decode** once, a pattern the rest of the head-start reuses.

## The calls (all top-level `account`, handlers confirmed to exist)

Add these gateway pairs (each with a justification comment; **restart EveJS after**):
- `account.GetJournal` — handler `accountService.js:636`, returns a **Rowset**; rows carry big `refID`/`ownerID`/`amount` → the bare-string-bigint hazard.
- `account.GetTransactions` — handler `:666`, market-transaction ledger (Rowset).
- `account.GetEntryTypes` (`:574`) and/or `account.GetKeyMap` (`:559`) — the ref-type → label map, so a journal row reads "Agent Mission Reward", not a code. Add whichever the retail wallet actually uses (check the client's journal panel in `ClientCodeGrabber` if unsure).

`account.GetCashBalance` (personal) and `GetWalletDivisionsInfo` (corp) are already allowlisted from R50 — do not re-add.

## Traps (from the coverage plan — treat as real, they recur)

- **`account` corp-vs-personal is arg-position-driven, not method-driven.** `GetJournal`/`GetTransactions` branch on an `isCorpWallet` positional (`args[3]`) plus an accountKey — pass the wrong args and you silently read the personal wallet instead of a corp division, no error. Wire the personal ledger with the personal args; if you also expose the corp ledger, pass the corp args explicitly and test both resolve to different data.
- **Rowset + bare-string bigints.** Decode rows through the shared `readRowField` (R32, `web/src/bridge/wire.ts`) — the same helper that handles packedrow/KeyVal — and use the **bigint-tolerant** number path (R32 found FILETIMEs and large IDs arrive as bare decimal strings, not `{type:"long"}`; `toFiletime`/the ISK bigint path in `web/src/ui/isk.ts` are the precedents). Amounts are ISK — render bigint-safe, never through `Number`.
- **Data seeding may be sparse.** Farmer has 115.8B ISK so almost certainly has history, but if the journal/transactions come back **empty, that is a legitimate state, not a bug** (the `worldHasNoContracts` pattern) — render "no entries yet" honestly and say so in the report. Verify the decoder against whatever real bytes exist and state plainly if you could only verify the empty path.

## Build

- BFF: extend `/api/bridge/wallet` (or add `/api/bridge/wallet/journal` + `/transactions` — your call; keep it consistent with R50's route) with independent `Promise.allSettled` reads so one failing read doesn't blank the others (R50's pattern). Empty ≠ failed.
- Bridge decoder: `web/src/bridge/wallet.ts` gains journal/transaction row decoding built **from real captured bytes**, not a hand-guessed shape.
- UI (this cluster earns it, since the Wallet tab exists): a ledger view on the Wallet panel — date, amount (ISK, +/- coloured is fine), and the human ref-type label. **R7d:** a journal row shows names/labels, never a raw `refID`/`ownerID`. Keep it simple; the operator will refine.

## Hard rules

- **Bridge-only server surface.** Only permit calls to handlers that **already exist** (they do — cited above). eve.js changes restricted to `server/src/_secondary/express/*` + tests; **never** a `Handle_*` implementation. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — commit the allowlist pairs by pathspec onto the tip without disturbing their staged work (the R50 pattern). Never `git add -A`. Never push.
- **A 200 is not proof** — verify the wire shape against real bytes; re-read.
- **Do not chase game mechanics.** If the ledger content looks odd in a way that's the server's business, note and move on.

## Invariants

**R7d** zero visible numeric IDs (ISK amounts and dates are fine; refIDs/ownerIDs are not — resolve to names/labels) · **R8** responsive, ≥40px targets · **R9a** plain player language (ref-types as words) · **R18** `panelFirstMount` green (Wallet panel with a ledger, incl. the empty case).

## Required work

1. Baseline: combined `node --test` (expect **1629/1629**), `tsc` + `build:web` clean.
2. Add the pairs (restart EveJS), the BFF reads, the decoder from real bytes, and the ledger view. Tests, watched failing first: the journal Rowset decodes (bigint-safe, no `Number` overflow); a ref-type resolves to a label; empty ledger renders "no entries"; no `refID`/`ownerID` reaches rendered text.
3. **Verify live:** log in `rrfarmer` → Farmer, read the real wallet journal/transactions through the BFF, and report the actual entries (or state plainly they're empty and you verified the empty path). Capture the real Rowset bytes to build the decoder against — do not guess the shape. Keep the session short.
4. Update `docs/afk-session-log.md` (append result + decisions) and the roadmap R54 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The Wallet tab shows the personal ledger (journal + transactions) with amounts bigint-safe and ref-types as words; the calls are allowlisted (existing handlers only) and decoded from real bytes; empty is honest; no numeric IDs leak. Suite green. This proves the head-start pattern for the rest of `docs/api-coverage-plan.md`.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — rerun the suite before assuming a single failure is yours.
- **Watch new tests fail first** — thirteen+ tests here have been caught passing while asserting nothing; if you write an id sweep, prove the matcher matches.
- Servers: :26002 EveJS (PID 57760), :26500 web (PID 59260, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs, so you MUST restart EveJS** (a server started before the commit won't have them). Own the process; set no `EVEJS_*` overrides; leave all three healthy.
- **You are the only build worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (115.8B ISK — has ledger history), `test2` → Test Two; any password; login returns a `sessionToken`.
- **Browser pane:** SPA at `/`. Screenshots time out; static geometry measurable; async panel content never flushes past first paint. Drive `AppFlow`/the BFF for behaviour and capture real bytes there. Say plainly what you could not see.
