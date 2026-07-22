# Goal R51: Move ore out of a ship, and stop showing a fake hangar limit

**Issued:** 2026-07-21 (operator's tightening list, items 2 and 5). **Status:** Ready. **Client + BFF only (our `src/server.js`, not the eve.js bridge — the invbroker handlers already exist).**

Two operator items, both in the Inventory panel.

## Item 2 — move ore out of the Ore Hold into the station hangar

The operator: *"We need to be able to move stuff out of cargo on ships. Right now I have ore in the Ore Hold and can't move it into the hanger."*

What exists: `POST /api/bridge/inventory/transfer` moves between places resolved by `resolvePlace` (`src/server.js:1082`), which today documents `{kind:"cargo"}` (the active ship's cargo hold), `{kind:"container", itemID}`, and the hangar. There is a dedicated `/api/bridge/ship/ore-hold` read (`:5303`). The gap is that **the ore hold (and other specialised ship bays) are not addressable as a transfer *source*** — so the UI offers no "move to hangar" from ore-hold items.

Fix it so that, **while docked**, the player can move items out of the active ship's Ore Hold (and cargo, and any specialised bay the ship exposes) into the station hangar:
- Teach `resolvePlace` (or the transfer route) to accept the ship's specialised holds as a source — address a bay by its **flag/family** the way R40's `shipBays` already enumerates them, not by guessing. Ore hold, cargo, and the general bays R40 already reads should all be valid sources.
- Wire the InventoryShip UI to offer the move — a selected ore-hold stack should have a "Move to hangar" action while docked, same affordance the hangar↔cargo move already uses.
- **A 200 is not proof.** The transfer route already judges success by the source giving something up and reports `applied`/`moved`/`reminted`/`declinedSilently` (the R29 new-itemID lesson). Keep that predicate; re-read after the move.

Diagnose the real block first and report it — don't assume. If moving ore-hold→hangar needs only a UI wiring change (the route already supports it), do the minimum; if `resolvePlace` genuinely can't address the ore hold, that's the fix.

## Item 5 — stations have no limit; show "Room used", not "of 1,000,000"

The operator: *"In Hanger Inventory, it shows a limit of '1,000,000 M3' when … stations don't have limits, so we should just show Room Used, but not 'Of'."*

`capacityText` (`web/src/ui/InventoryShip.svelte:172`) always renders `"{used} of {capacity} m³"`. For the **station hangar**, that `capacity` is a phantom (R40 found eve.js's `_calculateCapacity` returns a `1,000,000` default for unmapped flags) — a station hangar has no meaningful limit.

- For the **station hangar**, render **"Room used: {used} m³"** with no "of", and no fill gauge (there's nothing to fill toward).
- **Key on "this is the station hangar," not on sniffing the `1,000,000` sentinel** — the magic number is fragile and could legitimately appear elsewhere. The panel knows structurally which section is the hangar; use that.
- Keep `"{used} of {capacity} m³"` and the gauge for **ship bays** that report a real finite capacity (cargo 350, ore hold 16,000, etc. — those limits are real and useful).

## Hard rules

- **Client + BFF only. No eve.js changes at all** — the invbroker transfer/list/capacity handlers already exist; this is our BFF (`src/server.js`) and web code. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — don't touch eve.js. Never `git add -A`. Never push.
- **Do not chase game mechanics.** If the server refuses a move for a real reason (e.g. a bay that genuinely can't hold that item), surface the refusal in plain language (R31 seam) and move on — don't debug the server's rule.
- **Empty ≠ failed** — a hangar with nothing in it is not an error.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive, ≥40px targets, no horizontal body scroll · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: combined `node --test` (expect **1608/1608**), `tsc` + `build:web` clean.
2. Both items. Tests, watched failing first: an ore-hold stack is a valid transfer source and lands in the hangar (assert against the transfer route's real reported shape, not a 200); the station hangar renders "Room used" with no "of" and no gauge; a ship bay with a real capacity still renders "X of Y". Twelve+ tests here have been caught asserting nothing — if you write a sweep, prove the matcher matches.
3. **Verify live:** with a character docked and ore in the Ore Hold (Farmer's Procurer had ore), move a stack to the hangar and confirm — via the transfer route's authority re-read — the ore left the hold and appears in the hangar. Confirm the hangar shows "Room used" not "of 1,000,000". Keep the session short; leave the character docked.
4. Update `docs/afk-session-log.md` (append your result + any decision) and the roadmap R51 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

While docked, ore (and other bay contents) can be moved into the station hangar, confirmed live by an authority re-read; the station hangar shows room used with no fake limit; real ship-bay limits still show. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — do not chase them.
- Servers: :26002 EveJS (PID 57760), :26500 web (PID 57272, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). You may restart :26002/:26500; own any process; set no `EVEJS_*` overrides; leave all three healthy. **This goal needs no gateway pair, so no EveJS restart should be required.**
- **You are the only build worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (Procurer with an ore hold), `test2` → Test Two. Any password; login returns a `sessionToken`.
- **Browser pane:** SPA at `/`. Screenshots time out and rAF never fires; static geometry IS measurable via `getBoundingClientRect`, but async panel content never flushes past first paint. Drive `AppFlow`/the BFF for behaviour. Say plainly what you could not see.
