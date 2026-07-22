# Goal R74: Plumbing sweep — Phase-2 bound reads: dogma / ship snapshot (RB-DOGMA) (11)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (`docs/plumbing-worklist.md`, RB-DOGMA). These are BOUND reads off `dogmaIM.MachoBindObject` (wired R72, verified SESSION-SCOPED: bound reads resolve the active ship from `_getShipID(session)`, the registered bindParam is inert). Dogma/ship files only — not market files (separate session).

## Phase-2 mechanics — the MachoBindObject two-step (this is the pattern R73 did NOT use)

R73 was a Moniker top-level call. THIS batch is the real bind two-step, exactly like the already-wired `invbroker` reads and R72's `dogmaBindSpec`: (1) `dogmaIM.MachoBindObject` → a BFF-held `boundHandle`; (2) call each bound read against that handle. **Mirror `src/server.js`'s existing `dogmaBindSpec` / `boundCall` (added R72) and the `invbroker` two-step** — do NOT invent a new mechanism. The OID stays gateway-side; the browser never sees it. R72 already proved `dogmaIM` bind → `ShipGetInfo` resolves, so the plumbing works.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

The dogma bind resolves the SHIP from the session, so ship/char reads are session-scoped. **But four reads take an ITEM/TYPE id** — and `/api/bridge/call` forwards args verbatim, so a foreign id could leak. For EACH read, read the handler + live-probe with a FOREIGN id (second account, `test2` → Test Two):
- `ItemGetInfo(itemID)`, `QueryAllAttributesForItem(itemID)`, `QueryAttributeValue(itemID, attrID)`, `GetLayerDamageValuesByItems([itemIDs])` — inject a foreign player's itemID. If the handler returns that item's data with no check that it belongs to / is visible to the session → arg-injection LEAK: **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (do NOT de-allowlist — operator's flag-only decision). If the handler only resolves items in the session's own ship/scene, or the data is static type data, it's SAFE.
- `GetRequiredSkillLevels(typeID)`, `FullyDescribeAttribute(attrID)` — STATIC type/attribute metadata (public, same for everyone) → SAFE, but confirm they're static, not per-owner.
- `GetAllInfo`, `GetTargeters`, `GetCharacterAttributes`, `GetDroneSettingAttributes`, `GetLocationInfo` — session's own ship/char/scene → SAFE, but verify no id override.

## This batch — bound READS off the dogma bind (grep-confirm each `Handle_*` exists in `dogmaService.js`)

`GetAllInfo` (:8802 — full ship+char+module snapshot), `ItemGetInfo` (:9196), `GetTargeters` (:6766), `GetDroneSettingAttributes` (:5301), `GetCharacterAttributes` (:5275), `GetRequiredSkillLevels` (:5305), `GetLayerDamageValuesByItems` (:5418), `QueryAllAttributesForItem` (:9371), `QueryAttributeValue` (:9377), `FullyDescribeAttribute` (:9391), `GetLocationInfo` (:9417).

## Traps

- **`GetAllInfo` is the big one** — a full ship+char+module dogma snapshot (the retail undock bootstrap). Decode from **real captured bytes**; it is large and nested (KeyVal/dict/rowset mix). This is the highest-value read here (a future fitting/ship UI needs it).
- **Args:** the four item reads take an itemID/attrID; capture the retail signature and forward exactly. An argless call that needs an id returns empty/errors — a 200 is not proof.
- **Wire shapes:** attribute values are often **floats**; IDs stay as data (R7d); any large ids/FILETIMEs bigint. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — no targeters, no drones is a real state; verify + assert the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `dogmaIM` and un-stale any refusal assertion (dogmaIM already has many allowlisted pairs — check `webGatewayTargetingActivation`/`webGatewayDronesAndHostiles` enumerations); update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2083), `tsc` + `build:web` clean.
2. Wire each bound read off the dogma bind (mirror `dogmaBindSpec`/`boundCall`). Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, bind dogma, hit each read; capture real bytes; confirm decoders AND run the arg-injection check on the four item reads (foreign itemID → own/scene data or refusal, never the foreign item). Report real shapes, empty-but-legitimate results, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R74 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The dogma bound reads (minus any skipped for no-handler, with reason) are allowlisted (existing handlers), reachable via the BFF off the R72 dogma bind, decoded from real bytes with tests, each ownership-checked under arg-injection (own/scene/static data only, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 54372 / web BFF 72044 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two; any password. Use test2 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
