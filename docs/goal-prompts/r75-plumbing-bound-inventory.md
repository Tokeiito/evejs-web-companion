# Goal R75: Plumbing sweep — Phase-2 bound reads: inventory (RB-INV) (8)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (`docs/plumbing-worklist.md`, RB-INV). These are BOUND reads off the `invbroker` bind — `invbroker.MachoBindObject` / `GetInventory` / `GetInventoryFromId` are ALREADY allowlisted (R37 assets) and the two-step is wired. Inventory files only — not market files (separate session).

## Phase-2 mechanics — reuse the EXISTING invbroker bind

The invbroker two-step already exists in `src/server.js` (R37 assets use `GetInventory`/`ListByFlags` off the bind). Mirror it — these 8 reads dispatch as bound calls against the same `invbroker` bind. Do NOT invent a new mechanism.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

Most of these take an **item / container id**, and `/api/bridge/call` forwards args verbatim — so verify each is session/ownership-scoped under attacker-chosen args. R74 showed dogma's `_findInventoryItemContext` rejects `ownerID !== charID`; check whether invbroker's item reads have the same guard. For EACH id-taking read, read the handler + live-probe with a FOREIGN item/container id (second account `test2` → Test Two): does it return that item/container's contents, or reject/coerce to the session's own? If it returns a foreign item/container's private contents with no ownership check → arg-injection LEAK: **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (do NOT de-allowlist — operator's flag-only decision). If it's session/ownership-scoped, SAFE. **`GetContainerContents(containerID)` is the one to scrutinize hardest** — a foreign container's contents is exactly the leak class.

## This batch — bound READS off the invbroker bind (grep-confirm each `Handle_*` exists in `invBrokerService.js`)

`GetContainerContents` (:7102), `GetItem` (:6621), `GetItems` (:6655), `ListDroneBay` (:8387), `ListFighterBay` (:8393), `GetItemDescriptor` (:8547), `GetAvailableTurretSlots` (:8553), `GetDamageForCrystals` (:6713).

## Traps

- **Args:** `GetItem(itemID)`, `GetItems([itemIDs])`, `GetContainerContents(containerID)` take ids; `GetDamageForCrystals` may take a crystal/turret ref. Capture the retail signature; forward exactly. An argless call that needs an id returns empty/errors — a 200 is not proof.
- **Wire shapes:** item rows are usually PACKEDROWS (reuse the `readRowField`/named-fields pattern); quantities/ids stay as data (R7d); large ids bigint. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — empty drone/fighter bay, no crystals, is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: invbroker already has many allowlisted pairs — grep each method + `invbroker` across `webGateway*.test.js` (esp. `webGatewayFitting`/`webGatewayInventoryDepth`/`webGatewayDronesAndHostiles` enumerations & refusal loops) and un-stale any that must now include your methods; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2105), `tsc` + `build:web` clean.
2. Wire each bound read off the invbroker bind. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, hit each read; capture real bytes; confirm decoders AND run the arg-injection check (foreign item/container id → own/refusal, esp. `GetContainerContents`). Report real shapes, empty-but-legitimate results, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R75 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The invbroker bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF off the invbroker bind, decoded from real bytes with tests, each ownership-checked under arg-injection (session-scoped, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 67492 / web BFF 53200 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two; any password. Use test2 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
