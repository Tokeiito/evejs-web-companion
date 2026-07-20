# Goal R14: Inventory depth + corp hangars

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run (after R13 lands). eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

Two backlog items combined because they are the *same* work: both extend the R3 `invbroker` bound-object bridge and the existing Inventory tab, so splitting them would mean two workers fighting over the same files.

## What the research established (verified — build on this)

**Inventory depth is not a new service surface** — it is the same `invbroker` two-step already driven for R3, plus four additions:
- **Split a stack** = a **partial-quantity `Add`** — the `qty` kwarg — both across containers and in place.
- **Re-merge** = **`MultiMerge(ops, sourceContainerID)`** (drag-onto-stack). **Already allowlisted.**
- **Multi-select move** = **`MultiAdd(itemIDs, sourceLocationID, {flag})`**. *Needs allowlisting.*
- **Destroy** = **`TrashItems(itemIDs, locationID)`**, dispatched on the **inventory-manager moniker** `Moniker('invbroker', (stationID, groupStation))` — *not* a per-container binding. *Needs allowlisting.* **Destructive → require explicit confirmation, like the R12 rig destroy (`confirm: true` BFF gate + a two-step UI).**
- **Containers are not special at the protocol level**: bind with the **identical** `GetInventoryFromId(containerItemID)` used for ship cargo, and list contents with **`List()` with NO flag** (retail passes `flag=None`/0 — container contents carry **flagID 0**, not 4/5). Container-ness is a pure **client-side static-data test** on `groupID`/`categoryID` plus `singleton`.
- eve.js already implements `Handle_MultiAdd`, `Handle_MultiMerge`, `Handle_TrashItems`, `Handle_StackAll`, `Handle_GetContainerContents`, `Handle_GetSelfInvItem`.

**Corp hangars are the station hangar with two differences:**
- Bind the corporation's **`officeID`** (not the stationID): `GetInventoryFromId(officeID)`, where the office comes from the corp's office at this station.
- Contents are filtered by a **division flag 115–121** (`flagCorpSAG1..7`), plus **184** (`flagCorpGoalDeliveries`) — instead of flag 4.
- Moving is the ordinary `Add(itemID, sourceLocationID, {qty, flag: <115..121|4>})` on the destination binding.
- **Division names** are seven free-text fields `division1..division7` on the corporation row, read via `corpRegistry(corpID).GetCorporation()`.
- **Access** is a role-mask test against `session.corprole` (a *query* role to see a division, a *take* role to move things out). The client tests it to grey out actions; **eve.js enforces the same masks independently** — so never rely on the client check for safety, and surface the server's refusal verbatim.
- **Every `invbroker` pair needed here is already allowlisted** — only the **office lookup** and the **division-name read** need new entries.
- ⚠ **Known trap: an `officeID` identity mismatch on the eve.js side.** The office identifier you bind must match what the server expects — verify this explicitly with a test rather than assuming; if the bind silently returns an empty inventory, this is the first thing to suspect.

**Shape:** extend the **Inventory tab** (a third container alongside hangar and ship cargo, with a division selector) — *not* a new panel.

## Objective

1. **eve.js (gateway only):** allowlist `invbroker.MultiAdd`, `invbroker.TrashItems`, the corp **office lookup**, and the **corp division-name read** (plus `GetSelfInvItem`/`SetLabel` only if you actually use them). Pairs only, deny-by-default intact, with a test proving non-allowlisted siblings are still refused.
2. **BFF:** routes for split (partial-qty move), multi-move, merge, trash (behind `confirm: true`), container open/list, and the corp-hangar read + moves (division-scoped). Reuse the R3 bind/handle-cache; do not fork a parallel path. Surface handler refusals verbatim — **and remember the R12 lesson: a 200 is not proof the move happened.** Re-read and report what actually applied; if the server declines without a reason, say exactly that rather than inventing one.
3. **Web — Inventory tab:** multi-select rows with a bulk move; split-stack (enter a quantity); open a **container** and browse/move its contents (with a way back out); **Trash** behind a two-step confirm; and a **corp hangar** section with a division picker showing division **names**, moving items both ways, greying out divisions the character lacks the role for while still surfacing the server's refusal if one slips through.

## Invariants

- **R7d** zero visible numeric IDs (items, containers, divisions by **name**; never itemIDs/flagIDs). **R8** responsive/reflow + touch targets — the new container/corp tables reflow to cards like the others. **R9a** plain player language ("Corporation hangar", "Division", not `flagCorpSAG3`).
- Server stays authoritative; the client's role check is cosmetic only.

## Required work

1. **Baseline** (record): web `npm test`; eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the isolated gateway suites (13 after R13) green.
2. Implement 1–3 with tests: gateway allowlist + deny-by-default; BFF tests for split/multi-move/merge/trash-confirm/container-list and the corp bind incl. **an explicit `officeID` identity test**; web tests for multi-select, split entry, container navigation, and the division picker.
3. Update `docs/bridge-wire-contract.md` (the inventory-depth + corp-hangar contract, the flag map, the container `List()`-with-no-flag rule) and the roadmap (R14 row). Commit eve.js and web **separately**; report both hashes. **Do not push.**

## Definition of done

- A docked player can multi-select and move items, split and re-merge stacks, open and work inside containers, trash items behind a confirm, and read/move items in their corp hangar divisions **by name** with role-gated actions. All invariants hold; all baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed separately; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface only**; never modify invbroker, corpRegistry, or any mechanics — call them. eve.js is on branch `ReconcileEliteMode`; commit to the checked-out branch with a **pathspec commit** (other agents have in-flight work), never `git add -A`, never revert them.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If too large for one session, land **inventory depth** first (committed, green), then **corp hangars**, and report the split. Never leave broken or uncommitted work.
