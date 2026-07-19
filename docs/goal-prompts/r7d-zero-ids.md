# Goal R7d: Zero visible IDs — names only, strip every numeric ID from the UI

**Issued:** 2026-07-19 by the orchestrator, from operator feedback. **Status:** Ready to run. **Web-only — no eve.js change.** R7c resolved names but left numeric IDs as "secondary detail." The operator wants **NO numeric game IDs visible anywhere** — names only. This is a strict cleanup pass; be exhaustive.

The rule: **a player never sees a raw numeric game ID.** Show the resolved name. If a field is an ID with *no* resolvable name and no player value, **remove the field/row/column** rather than show the number. Keep IDs only where they are genuinely required as *interactive input* (the Flight/Travel manual-entry inputs and their placeholders, and `{#each (key)}` keys / `onclick` args — those are internal, never rendered as data).

You are a worker session. Read FIRST: every `web/src/ui/*.svelte`, `web/src/app/flow.ts` (the R7c name cache — reuse it), `web/src/store/names.ts`, `src/staticData.js`. Execute exactly this goal, then stop.

## The exact leaks the operator reported (fix all, verbatim from their screen)

**StationPanel.svelte**
- `Station ID 60000004` row → **remove** (the station name is already the panel header).
- `Station type: Caldari Trading Station (typeID 1531)` → drop `(typeID 1531)` → just `Caldari Trading Station`.
- `Solar system: Muvolailen (ID 30002780)` → drop `(ID 30002780)` → just `Muvolailen`.
- `Owner: 1000002 · CBD Corporation` → drop the `1000002 · ` → just `CBD Corporation`.
- `Station item ID 60000004` row → **remove**.
- `Operation ID 26` row → **remove** (no name, no player value).
- `Station type: 1531 · Caldari Trading Station` (services section) → drop `1531 · ` → just `Caldari Trading Station`.
- Guests: ensure Corporation/Alliance columns show **names** (or blank), never IDs.

**InventoryShip.svelte**
- The **`Item` column** shows the raw itemID (`9988400022011`) → **remove that column** (Type name is the item's identity; the itemID stays internal for move/board onclick). Columns become Type / Cat / Qty / Action (adjust headers/colspans).
- `Active ship cargo Algos (ship 9988400022011)` → drop `(ship 9988400022011)` → `Active ship cargo Algos`.
- Any other `ship {id}` / itemID render → name only.

**Flight.svelte**
- `Active ship: Algos (9988400022011)` → drop `(9988400022011)` → `Algos`.
- `Solar system: Muvolailen (30002780)` → drop `(30002780)` → `Muvolailen`.
- The Location line already reads by name — verify no ID tail.

**Chat.svelte**
- Channel header `Local · local_30002780` → resolve to the **system name**: `Local · Muvolailen` (use the name cache for the local room's solar system). Corp header → `Corp · <corp name>` (not `corp_<id>`). If a name isn't available yet, show just `Local` / `Corp` — never the raw room string.

**Travel.svelte / AgentFinder.svelte / AgentsMissions.svelte**
- Sweep for any `System {id}` / `station {id}` / `(ID …)` / `agent {id}` / `corp {id}` / `type {id}` still rendering and make it name-only (resolve via the cache; drop the numeric tail).

## Required work

1. **Baseline** (record): web `npm test` (expect 355/355). No eve.js change (confirm). Never `git add -A`.
2. Apply every fix above, then **exhaustively sweep** EVERY `web/src/ui/*.svelte` for any remaining rendered numeric ID. Search patterns to grep and eliminate from *rendered* markup (not keys/placeholders/onclick): `(ID`, `(typeID`, `(ship`, `ID {`, `{...ID}` shown as text, `· ${...ID}`, `${...ID} ·`, `system ${`, `station ${`, `corp ${`, `agent ${`, `type ${`, `local_`, `corp_`, and any `<td>{...ID}` / `<dd>{...ID}`. For each hit, convert to a name or remove. **The final report MUST list, per component, that zero numeric game IDs render** (show the grep result proving it).
3. **Tests:** update/extend component or flow tests so a previously-ID field asserts a **name and no numeric ID** renders; keep the R7c name-cache tests green. Add a guard test if practical (e.g. the inventory row renders the type name, not the itemID).
4. Update the roadmap (R7d row). Tests green; `build:web` clean; commit web work; report hash. **Do not push.**

## Out of scope

- eve.js changes. The developer-facing description blurbs at the top of each tab (method names like `stationSvc.GetStationItemBits`) — leave those for now (a separate decision); this pass is about **numeric game IDs in data fields**.
- Responsive/mobile layout (separate track).

## Definition of done

- No `web/src/ui/*.svelte` renders a raw numeric game ID as data — every station/type/corp/alliance/character/agent/ship/item/system reads as a **name** (or the field is removed when nameless). The operator's listed leaks are all gone. A grep sweep in the report proves zero rendered numeric IDs per component. Tests green; `build:web` clean; eve.js untouched. Committed; hash reported; not pushed.
- Roadmap R7d row Complete.

## Constraints

- Web repo only; eve.js READ-ONLY. Operator runs EveJS (:26002); orchestrator runs the web app (:26500). Do NOT start/stop/restart either; run only `npm test` + `npm run build:web`. Never push; stage only your files.
