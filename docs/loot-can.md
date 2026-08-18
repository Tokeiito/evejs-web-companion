# Loot-can feature — jetcan mining/hauling loop

Design doc for a `loot-containers` bot macro, plus a bundled `mine-at-belt`
belt-picker fix. Implemented — typecheck clean, all tests passing (see git
history on this branch for the actual changes).

## Goal

Run miners that jettison ore into a can instead of flying it home themselves,
and a separate hauler bot that sits on the same belt, scoops jetcans as they
fill up, runs to the station when full, drops off, and comes back.

## Existing building blocks

- **Jettison to a can** — the `jettison-cargo` macro (`web/src/bots/botScript.ts:485`,
  spec at `web/src/bots/macroSpecs.ts:204`) dumps the cargo/ore hold into a
  floating jetcan. Wired end to end, dispatches to EveJS for real.
- **Same-belt positioning** — `mine-at-belt`'s belt argument (`BeltArg` in
  `web/src/bots/botScript.ts:166-168`) is typed to support a pinned belt
  (`{mode:"chosen", ref}` — a saved WorldRef), but the runtime currently
  ignores it, so `mine-at-belt` can only ever go to the nearest belt (see
  "Belt picker fix" below — bundled into this same effort). Until that lands,
  the working alternative is `warp-to-bookmark`: point the hauler at the same
  saved bookmark the miners happen to be sitting on.
- **Cargo-full stop condition** — `{kind:"cargo-full", fraction}` already
  exists as a loop `until` condition (`web/src/bots/botScript.ts:308`),
  ready to gate the hauler's "keep scooping until full" loop.
- **Dock → drop off → return** — ordinary, already-used pieces:
  `travel-to-station` / `dock-at-nearest`, `unload-cargo`, then loop back via
  the belt/bookmark arg above.

## The gap: no way to loot a jetcan

`loot-wrecks` is the only "pick up loose loot" macro today, and it doesn't
apply:

- `wrecksOnGrid()` (`web/src/nav/scriptMacros.ts:920`) filters
  `entity.kind === "wreck"` only — cans never enter that code path.
- It's further restricted to *your own* (or corp-owned) wreck by design —
  `isOwnWreck()` (`web/src/nav/scriptMacros.ts:925`), the deliberate
  "no can-flipping" rule, comment: *"A wreck whose owner cannot be read is
  NEVER opened."*
- There's no `lootContainer`-shaped entry in the tick-action union either
  (`web/src/nav/scriptDecide.ts`; `readonly kind: "lootWreck"` at line 77 is
  the only loot-shaped action).

This needs one new macro plus a matching tick action. It does **not** need
new BFF or EveJS server work — that plumbing already exists and already
permits it.

## Server/API foundation

Two existing generic BFF routes, not wreck-specific:

- `GET /api/bridge/inventory/container/:itemID` (`src/server.js:2305`) —
  lists a container's contents by itemID, no ownership assumption baked in.
- `POST /api/bridge/inventory/transfer` (`src/server.js:2357`) — the general
  move; handles `{kind:"container", itemID} → {kind:"cargo"}` via
  `resolvePlace()` (`src/server.js:2205`), the same `Add`/`MultiAdd` retail
  calls the wreck-loot path already uses under the hood.

The EveJS emulator's access rule confirms this is safe to build on:
`Handle_GetInventoryFromId` (`eve.js/server/src/services/inventory/invBrokerService.js:8803`)
gates on `_getSpaceContainerScopeAccessError()` (same file, line 3849), which
only checks **visibility and range** (same scene, ~2,500 m via
`MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS`) — no ownership/theft check at
all. Any character in range of a jetcan — theirs, a fleet-mate's, or a
stranger's — can already list and pull from it through this route. Retail's
can-flipping/suspect mechanic isn't modeled here.

**Container entity classification.** Jetcans arrive in the space snapshot as
`kind: "container"`, distinct from `kind: "wreck"` — no new `SpaceEntity.kind`
value or server work is needed. Traced end to end: eve.js's
`getRuntimeInventoryEntityKind()` (`eve.js/server/src/space/runtime.js:22157`)
classifies every space-backed inventory item by its type's groupName —
`groupName === "wreck"` → `"wreck"`; `groupName.includes("container") ||
groupName === "spawn container"` → `"container"` (lines 22246-22249). A
jetcan is a plain jettisoned-cargo container item, landing in the generic
container branch. That `kind` is stamped in `buildRuntimeInventoryEntity()`
(`runtime.js:22403`/`:22456`), copied verbatim onto the overview row by
`projectSpaceEntity()`
(`eve.js/server/src/_secondary/express/evejsWebGatewayRuntime.js:4608`), and
decoded with zero remapping by the BFF client (`web/src/bridge/space.ts:85`).
So `wrecksOnGrid()`'s `kind === "wreck"` filter (`scriptMacros.ts:921`) just
needs a sibling filter on `kind === "container"`.

One adjacent classification path was checked and ruled out as a concern: a
salvaged wreck's `kind` does *not* flip to `"container"` in a way that would
cause double-scooping of an unrelated wreck. The `runtime.js:22157` branch
that would key off a "wreck already marked salvaged" flag
(`evejsSalvage.salvaged`, `runtime.js:21957-21960`) has zero writers anywhere
in eve.js — unreachable. The actual salvage mechanic,
`replaceInventoryWreckWithLootContainer()`
(`eve.js/server/src/space/modules/salvagerRuntime.js:1037-1081`), despawns
the original wreck and, only if loot is left over, spawns a genuinely new
`"Cargo Container"` item. That new item legitimately gets `kind: "container"`
through the ordinary branch, and `loot-containers` picking it up (per the
"no ownership filter" decision below) is correct behavior, not a bug.

## Design decisions

- **Macro id**: `loot-containers` — kebab-case, matching the `MacroID`
  convention (`loot-wrecks`, `mine-at-belt`, `warp-to-bookmark`, …).
- **No ownership/fleet allowlist.** This is an emulator for bot development,
  not a production client protecting real players from can-flipping, and the
  server enforces no ownership/theft rule on containers (see above). The
  hauler scoops any container on grid.

  For reference, two existing precedents exist in the codebase for "who is
  safe to interact with" — `isOwnWreck()` (`scriptMacros.ts:924-932`, a
  static owner/corp check used by `loot-wrecks`) and `fleetMatesOnGrid()`
  (`scriptMacros.ts:1816-1840`, an authoritative live-roster check used by
  `remote-rep`/`orbit-and-boost`) — but `loot-containers` needs neither.
- **Multi-can behavior**: nearest-first, one container looted per tick,
  looping every tick until the grid is drained — mirrors `loot-wrecks`
  exactly (see Implementation checklist).
- **Bundle the `mine-at-belt` belt-picker fix into this same effort** (see
  "Belt picker fix" below), rather than deferring it. `loot-containers`
  doesn't strictly need it — cans are found via grid entities, not belt refs
  — but it's the same "pin a grid-local place" mechanism the "same-belt
  positioning" building block above wants, and leaving it broken means two
  miners and a hauler still can't be pointed at the same non-nearest belt.
- **Close the pre-existing `flow.ts` dispatch-test gap for both `lootWreck`
  and the new `lootContainer` action** (see "Test coverage" below), rather
  than carrying the gap forward untouched.

## Implementation checklist

Every step has a `loot-wrecks` counterpart cited as the literal template to
copy.

1. **New tick action** — `{ kind: "lootContainer", containerID: number }` in
   `web/src/nav/scriptDecide.ts`, sibling to `{ kind: "lootWreck"; wreckID:
   number }` at line 77.
2. **New macro decider** `loot-containers` in `web/src/nav/scriptMacros.ts`,
   mirroring `lootWrecks` (lines 1041-1084) line for line:
   - Source from `kind === "container"` grid entities — sibling filter next
     to `wrecksOnGrid()`'s `kind === "wreck"` check (line 920-921), no
     ownership filter.
   - Nearest-first pick, `mem`-tracked "looted" set, `{kind:"done"}` once
     none remain — same shape as lines 1051-1056.
   - Range check against `LOOT_RANGE_M` (the existing constant, line 916 —
     reuse it as-is, it's the same server-side
     `MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS` limit, not
     wreck-specific), with the identical approach-then-loot pattern at lines
     1060-1073: `{kind:"approach", targetID}` when out of range, gated by a
     `mem.approaching` re-entrancy guard so approach isn't re-issued every
     tick.
3. **New dispatch case** in `web/src/app/flow.ts`, sibling to the
   `"lootWreck"` case at lines 6461-6477:
   ```ts
   case "lootWreck": {
     const contents = await api.openContainer(action.wreckID, callOptions);
     const rows = decodeInventoryRows(contents.list);
     if (rows.length > 0) {
       await api.transferItems(
         rows.map((row) => row.itemID),
         { kind: "container", itemID: action.wreckID },
         { kind: "cargo" },
         null,
         callOptions,
       );
     }
     return;
   }
   ```
   `"lootContainer"` needs the identical body with `action.containerID` in
   place of `action.wreckID` — same `api.openContainer`/`api.transferItems`
   calls, no new API client code needed. The container itemID needs no extra
   resolution: `SpaceEntity.itemID: number` (`web/src/store/types.ts:1465`)
   is a plain top-level field on every entity, wrecks and containers alike.
4. **Macro registration** — six files, each with a concrete `loot-wrecks`
   entry to copy the shape of:
   - `MacroID` union — `web/src/bots/botScript.ts:451` (add
     `| "loot-containers"` beside `| "loot-wrecks"`).
   - `MACRO_IDS` array — `web/src/bots/botScript.ts:511`.
   - Arg spec — `web/src/bots/macroSpecs.ts:76`:
     `"loot-wrecks": { args: [], untilRequired: false }` — zero args, same
     for `loot-containers` (whole-grid macro, nothing to configure).
   - Catalog entry — `macroCatalogView.ts:233-238` (`entry()` helper at line
     130 — id/category/does/needs, params auto-derived from the spec).
     `loot-containers`' description should *not* copy `loot-wrecks`'
     "yours only"/anti-theft language — that's the opposite of the decided
     behavior.
   - `scriptText.ts` — two separate switch cases: short form (line 95,
     `"Loot your wrecks"`) and long form (line 404, `"Loot your own wrecks on
     this grid"`). Same wording caveat as above.
   - `runPolicy.ts:106`: `"loot-wrecks": policy(["inventory"])` — same
     policy for `loot-containers`.
   - Decider registry — `web/src/nav/scriptMacros.ts:3117`:
     `"loot-wrecks": lootWrecks,` in the `SCRIPT_MACROS` map — add
     `"loot-containers": lootContainers,`.
   - `web/src/ui/BotBuilder.svelte` — no entry needed. `loot-wrecks` has zero
     matches in this file; a zero-arg macro needs no editor block, the
     generic add/list UI handles it via the catalog entry alone.
5. **Belt picker fix** — see its own section below.
6. **Tests** — see "Test coverage" below.

## Belt picker fix (bundled into this PR)

Two related gaps, both confirmed by reading the code:

- **No standalone "fly to an asteroid belt" macro exists**, at the backend
  or UI level. The full `MacroID` union
  (`web/src/bots/botScript.ts`, around lines 436-481) has nothing named
  `travel-to-belt` or similar; `mine-at-belt`
  (`web/src/bots/macroSpecs.ts:27-35`) is the only belt-aware macro, and it's
  the mining loop itself, not a general travel step. The `WorldEntity` union
  (`web/src/bots/botScript.ts:80`) does include `"belt"` as a valid
  `WorldRef` target, so the type system has room for one — nothing currently
  turns that into a standalone travel block. (Out of scope here; noted for
  future reference.)
- **`mine-at-belt` only ever goes to the nearest belt — no picker exists,
  and the runtime ignores a chosen belt even where the types support one:**
  - *Type level* — `BeltArg` (`botScript.ts:166-168`) genuinely supports
    `{mode:"chosen", ref}`.
  - *Spec level* — `mine-at-belt`'s arg spec (`macroSpecs.ts:27-35`) marks
    `belt` as `required: true`.
  - *UI level* — `BotBuilder.svelte` hardcodes every `mine-at-belt` step, on
    add or macro-switch, to `{ belt: { kind: "belt", belt: { mode:
    "nearest" } } }` (lines 94-95 and 331-336); its inline editor (lines
    1115-1125 and 1265-1273) only renders a "stop when …" condition selector
    and a "nearest rock / biggest rock" selector — never a belt picker.
    Contrast `travel-to-station`'s real `<StationPicker>` (line 1129) or
    `warp-to-bookmark`'s saved-spot `<select>` (lines 1183-1186).
  - *Runtime level — the real blocker.* `mineAtBelt`'s decider
    (`scriptMacros.ts:225`) takes its step as `_step` — underscore-prefixed,
    deliberately unused — and never reads `_step.args.belt`. When there are
    no rocks in range it always does
    `snapshot.entities.filter((e) => /belt/i.test(e.name ?? ""))` and picks
    the nearest one (lines 240-241): a hardcoded nearest-belt-by-name-regex
    scan, full stop.
  - *Why `StationPicker` isn't the model* — its own file comment
    (`web/src/ui/StationPicker.svelte:4-6`) explains stations are picked by
    a galaxy-wide name search because station IDs are global, "unlike
    belts, which are grid-local and resolve to 'nearest' at run time." A
    belt picker needs a saved-spot-style `<select>`, not a live search.

**Resolution mechanism.** `warp-to-bookmark` is *not* the right template for
resolving a chosen belt ref, despite the superficial similarity — worth
calling out explicitly since it's an easy mistake to make. `warpToBookmark`
(`scriptMacros.ts:1479-1527`) resolves `step.args["bookmark"]` — a
`{kind:"bookmark", bookmarkID, name}` arg — by matching against
`obs.bookmarks` (a live saved-spot list), then emits
`{kind:"warpBookmark", bookmarkID}`. That's bookmark-list matching, a
different arg shape from `BeltArg`'s `{mode:"chosen", ref}`, where `ref` is a
`WorldRef` (`entity`/`id`/`name`/`systemName`, `botScript.ts:93-113`) — belt
refs are never bookmarks. Its `<select>` UI (`BotBuilder.svelte:1183-1186`)
is still a fine *shape* model for the picker itself, just not its resolution
logic.

The correct resolution template is `resolveStationRef()`
(`scriptMacros.ts:144-159`) / `stationTarget()` (`scriptMacros.ts:165-169`)
— what `travel-to-station` uses to resolve a `WorldRef` off a step arg. It
can't be copied as-is, though: it trusts `ref.id` directly, which only works
because station IDs are globally stable. Belt IDs are grid-local, not
globally stable, so a belt ref has to be re-resolved on the current grid
instead of trusted by ID — using the *existing* nearest-belt fallback
already inside `mineAtBelt` (`scriptMacros.ts:240-241`): match `ref.name`
against `snapshot.entities` (the same belt-regex filter already used for
"nearest") on the current grid, then warp to that matched entity's live
itemID via the generic `{kind:"warp", targetID}` tick action
(`scriptDecide.ts:55`) — not `warpBookmark`, and not `warpScan` either
(`warpScan`/`api.warpToScanSite`, `scriptMacros.ts:1300` / `flow.ts:6397`, is
scanner/anomaly-directory-specific and unrelated to belts).

Three coordinated changes, all needed together:

1. A saved-spot-style UI picker for `mine-at-belt` in `BotBuilder.svelte`,
   modeled on `warp-to-bookmark`'s `<select>` (lines 1183-1186) for UI shape
   only — not its resolution logic.
2. `mineAtBelt`'s decider (`scriptMacros.ts:225`) actually branching on
   `_step.args.belt.mode` instead of ignoring the step, replacing the
   always-nearest scan (lines 240-241) with a mode check.
3. Resolving a `{mode:"chosen", ref}` WorldRef to a warp target using
   `resolveStationRef`/`stationTarget` (`scriptMacros.ts:144-169`) as the
   arg-pulling shape template, combined with the grid-local name-match scan
   at `scriptMacros.ts:240-241` for the belt-specific lookup, emitting
   `{kind:"warp", targetID}` (`scriptDecide.ts:55`).

## Test coverage

**Decider tests.** `web/src/nav/scriptMacros.test.ts:268-294` covers
`lootWrecks` with two tests, both calling the decider directly
(`SCRIPT_MACROS["loot-wrecks"]!`) against hand-built
`entity()`/`snapshot()`/`obs()` fixtures — plain function calls, no mocking
framework:
- Lines 268-282: only-your-wrecks filtering, farthest-picked-when-it's-the-
  only-option, and `{kind:"done"}` once the grid is empty.
- Lines 284-294: approach-when-out-of-range, and that a wreck already marked
  "looted" in `mem` is never reopened.

`loot-containers` tests should mirror this file/shape exactly: same two test
shapes, `kind: "container"` fixtures instead of `kind: "wreck"`, and the
ownership-filtering assertions dropped (no filter, per the design decision
above).

**Dispatch tests.** `web/src/app/lootDispatchFlow.test.ts` covers the
`flow.ts` `"lootWreck"`/`"lootContainer"` dispatch cases directly (the actual
`api.openContainer`/`api.transferItems` call sequence), which previously had
no direct coverage — those two API methods were only tested generically
elsewhere (`web/src/app/inventoryDepthFlow.test.ts`). It drives a real
`startCustomBot` script (the general `MacroID`/`BotScript` runner) over a
faked `fetch` and asserts on the actual `openContainer`/`transferItems`
request bodies that come out the other side, for both a `loot-containers`
step (any container, no ownership check) and a `loot-wrecks` step (an owned
wreck), closing the gap for both actions as decided above.

Note: `web/src/app/botFlow.test.ts` is *not* the right vehicle for this,
despite an early version of this doc assuming otherwise — it only drives
`startMiningBot`, a separate hardcoded mining ladder that never issues
`lootWreck`/`lootContainer` at all. The dispatch switch these actions go
through only runs via `startCustomBot`, reached through
`makeScriptRunnerDeps().issue`.

## Code comment conventions

New code should match the pattern already established across the files this
work touches:
- Terse, "why not what" comments only where something would otherwise
  surprise a reader — e.g. `LOOT_RANGE_M`'s margin-under-retail-limit
  reasoning, `isOwnWreck()`'s "A wreck whose owner cannot be read is NEVER
  opened" rule, `fleetMatesOnGrid()`'s "presence, corporation, and alliance
  are not membership" rationale, `StationPicker.svelte`'s note on why belts
  can't use the same picker.
- No docstring blocks, no comments that restate what a well-named
  function/variable already says.
- The `"lootContainer"` dispatch case and `loot-containers` decider don't
  need new explanatory comments where they're identical in shape to their
  wreck counterparts — the shape itself is the precedent. A comment is
  warranted only at actual divergence points, most notably wherever the "no
  ownership filter" decision is encoded: a future reader could otherwise
  mistake the missing filter for an oversight rather than a deliberate
  emulator-vs-production call.
