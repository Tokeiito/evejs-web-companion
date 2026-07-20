# Goal R16: Market — browse orders, see your orders/transactions, place and manage orders

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

**This is the first feature that spends the player's ISK.** EveJS's market is real: `marketProxyService.js` (~4,265 lines) does reads, order placement, cancel and modify, backed by real `debitCharacterWallet`/`creditCharacterWallet`, escrow records, broker fees, an SCC surcharge, and skill-gated order limits. Treat every write as irreversible-with-consequences.

## Verified research — three traps first

1. ⚠ **The `market` service is a DEAD STUB.** `marketService.js` returns empty rowsets for every method. The real service is **`marketProxy`** (`sm.ProxySvc('marketProxy')`). Picking the wrong one yields a **silently empty market page that looks like our bug**.
2. ⚠ **`marketQuote` (`svc.marketQuote`) is client-local only — it has NO server handler.** Caching, sorting, jump distances, skill limits, best-bid matching all live in the client. **The browser must implement that logic itself**; do not go looking for a server call.
3. ⚠ **There is an external market daemon on TCP `127.0.0.1:40111`.** If market reads come back empty or error, check whether it is running *before* suspecting our code.

**Reads** — all `marketProxy`, all positional, no kwargs. **Zero market pairs are allowlisted; add what you use:**
`StartupCheck([])` · `GetOrders([typeID])` ← the orders-for-a-type read · `GetCharOrders([])` · `GetMarketOrderHistory([])` · `CharGetTransactions([fromDate])` · `GetCharEscrow([])` · `GetOldPriceHistory([typeID])` / `GetNewPriceHistory([typeID])` · `GetHistoryForManyTypeIDs([typeIDs])` · `GetStationAsks([])` / `GetSystemAsks` / `GetRegionBest`.
- **Do NOT allowlist `GetCorporationOrders`** (corp scope, out of slice).
- **Skip PLEX entirely** (`GetPlexOrders`/`GetPlexBest`/`GetPlexHistory`) — special global-market path.

**Writes** — exact positional signatures:
- `PlaceBuyOrder([stationID:int, typeID:int, price:float, quantity:int, orderRange:int, minVolume:int, duration:int, useCorp:bool, expectedBrokersFee])`. The retail client **rounds price to 2dp and rejects `price > MAX_ORDER_PRICE` before sending** — do the same.
- `PlaceMultiSellOrder([itemList, useCorp:bool, duration:int, expectedBrokersFee])`; each `itemList` entry must carry `{itemID, typeID, stationID, price, quantity}`.
- `CancelCharOrder([orderID, regionID])` — **the server ignores `regionID`** and reads only `args[0]`.
- `ModifyCharOrder([orderID, newPrice, bid, stationID, solarSystemID, oldPrice, range, volRemaining, issueDate])` — **the server reads only `args[0]` and `args[1]`** and re-derives the rest, but the trailing args must still be sent.

`account.GetCashBalance` is already allowlisted — use it for the wallet readout.

**`expectedBrokersFee` is computed by the client and sent.** We must compute it as faithfully as we can — but **the server's actual charge is authoritative**. Never present our computed figure as the real cost: show it as an estimate, and after the order lands report what the server actually charged (re-read the wallet).

## Objective — land in two commits

**Slice A (read) — commit first, green:**
1. Allowlist the read pairs (not `GetCorporationOrders`, no PLEX); deny-by-default intact, with a test proving non-allowlisted `marketProxy` siblings — **including `GetCorporationOrders` by name** — are refused.
2. BFF reads: orders for a chosen type, the character's own orders, transactions, escrow, and price history. Wallet balance alongside.
3. A **Market** panel: pick an item (reuse the existing name search / `/api/names`), see buy and sell orders **by station name** with price/quantity/range, plus tabs for **My orders**, **Transactions**, and **Escrow**. Sorting/filtering is ours to implement (that's `marketQuote`'s job, client-side).

**Slice B (write) — commit second:**
4. Allowlist + BFF + UI for **place buy**, **place sell**, **cancel**, **modify**. **Every write is behind `confirm: true` at the BFF plus a two-step UI** that shows: the item, price × quantity, the **estimated** broker's fee, and the player's current ISK. After it lands, **re-read the wallet and orders and report what actually happened**, including the real amount charged.
5. Enforce the client-side guards retail enforces (2dp price rounding, `MAX_ORDER_PRICE` rejection) *before* dispatch.

## Invariants

- **R7d** zero visible numeric IDs — items, stations, systems by **name**; ISK/prices formatted as decimal strings, never raw longs. **R8** responsive reflow + touch targets (order books are tables — they must reflow). **R9a** plain player language.
- **A 200 is not proof** (R12/R14/R15 lesson) — re-read and report what actually applied; if the server declines without a reason, say exactly that.
- **Money honesty:** never show an invented cost as fact. Estimates are labeled estimates; actuals come from re-reading the wallet.

## Required work

1. **Baseline** (record): web `npm test` (expect 572/572); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the **16** isolated gateway suites green.
2. Slice A, commit. Slice B, commit. Tests: gateway allowlist + deny-by-default (incl. `GetCorporationOrders`); BFF read/write routes incl. **the exact positional shapes above pinned by tests**; web tests for the order-book rendering, the client-side guards, and the confirm gate.
3. Update `docs/bridge-wire-contract.md` (the market call table, the write signatures, the daemon dependency, the `market`-vs-`marketProxy` trap) and the roadmap (R16 row). Commit eve.js and web **separately**; report all hashes. **Do not push.**

## Definition of done

- A player can browse an item's order book by station name, see their own orders / transactions / escrow and their ISK, and place, cancel, and modify orders — each write behind an informed two-step confirm, with the **server's actual charge** reported afterward. All invariants hold; baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface only**; never modify `marketProxyService.js` or any mechanics — call them. Branch `ReconcileEliteMode`; **pathspec commit**, never `git add -A`, never revert other agents' in-flight work (the shared tree occasionally has mid-save breakage from them — if the tree fails to load, re-check rather than "fixing" their file).
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If Slice B is too large, land Slice A committed and green and report the split. Never leave broken or uncommitted work.
