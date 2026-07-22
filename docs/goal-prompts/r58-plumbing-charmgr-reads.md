# Goal R58: Plumbing sweep — charMgr social/profile reads

**Issued:** 2026-07-22 (operator's plumbing sweep). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

Second batch of the plumbing sweep. **Follow the PLUMBING CONTRACT in `docs/goal-prompts/r57-plumbing-toplevel-reads.md`** (allowlist pair + BFF passthrough + decoder from real bytes + tests; NO UI, no store, no panel, no tab; update the allowlist snapshot; restart EveJS). R57 landed 5 pairs cleanly with this pattern.

## This batch — `charMgr` top-level READS (verify each handler + binding before adding its pair; skip and report any that's bound or missing)

From the enumeration worklist (`eve.js/server/src/services/character/charMgrService.js`):

- `GetPublicInfo` (`:510`) — the older public-info shape (distinct from `GetPublicInfo3` we already have)
- `GetHomeStationRow` (`:666`) — home station as a row (vs the `GetHomeStation` KeyVal we have)
- `GetCharacterCreationDate` (`:707`)
- `GetSettingsInfo` (`:723`)
- `GetContactList` (`:730`) — contacts / watchlist / blocked
- `GetNote` (`:1040`), `GetOwnerNote` (`:1001`), `GetOwnerNoteLabels` (`:987`) — the character notes cluster
- `GetPaperdollState` (`:700`), `GetCohortsForCharacter` (`:553`), `GetPrivateInfoOnCorpChange` (`:602`) — include if the handler cleanly exists; if any is an edge/empty stub, note it.

**DO NOT WIRE `GetRecentShipKillsAndLosses`** — the allowlist comment (~`:1010`) marks it *"deliberately absent — left for a later goal."* The handler exists, but it is explicitly reserved. Skip it and note that you honoured the reservation.

`charMgr.MachoBindObject`/`ListStations`/`ListStationItems` (assets, R37) and `GetPublicInfo3`/`GetCharacterDescription`/`GetHomeStation`/`GetCloneInfo` (R56) are already allowlisted — do not re-add.

## Traps

- **`charMgr` reads are top-level, but its assets sub-object is bound** — these profile reads should all be top-level; confirm each (a Moniker/bind in the client = bound → defer to a bound batch and note it).
- **Wire shapes vary** (KeyVal / Rowset / list) — decode each against **real captured bytes**, not an assumption.
- **Notes/contacts may be empty** for Farmer — a legitimate empty state, not a bug. Verify the empty path and say so.
- **`GetContactList`** likely returns multiple groups (contacts/watchlist/blocked) — capture the real shape; IDs (contact owner IDs) stay as data for later resolution (R7d), don't force labels here.

## Hard rules

Same as R57: **bridge-only, permit existing handlers only** (never a `Handle_*`); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's staged/untracked destiny work (verify `git status` after); a 200 is not proof; don't chase mechanics. Never `git add -A`; never push.

## Invariants

**R7d** decoder keeps IDs as data for later resolution, doesn't force a label · **R18** `panelFirstMount` unaffected (no panels) — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1717/1717**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip + report any bound/no-handler/reserved. Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new BFF route, capture real bytes, confirm the decoder. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R58 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's `charMgr` read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests — no UI. `GetRecentShipKillsAndLosses` left unwired by policy. Snapshot current. Suite green. Report which pairs landed and which were skipped, with reasons.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner** (bare `node --test` fails a gameStore guard — not real); rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — fifteen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 17812), :26500 web (PID 42388, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS after committing** (restart AFTER editing/BEFORE commit is fine to avoid pulling the other agent's uncommitted work; the running server must serve the committed pairs — verify). Own the process; set no `EVEJS_*` overrides beyond the canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`; leave all three healthy.
- **You are the only BUILD worker** (a read-only enumeration workflow may still be running — it writes nothing). Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI in this goal — verification is BFF routes + decoder tests against real bytes. Say plainly what you could not see.
