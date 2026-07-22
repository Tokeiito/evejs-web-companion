# Goal R56: Character sheet (API head-start, Tier B #5)

**Issued:** 2026-07-21 (operator's API head-start). **Status:** Ready. **Client + bridge.** Capstone of this AFK stretch's head-start.

The biggest core EVE feature still entirely missing: who this character is. All reads are top-level on `charMgr` and the handlers exist; the bind path is proven by `personalAssets.ts`. Scope to a coherent, landable "who / where's home / clones" batch — **not** every char-sheet sub-panel.

## Add (gateway pairs — existing handlers only; restart EveJS after)

- `charMgr.GetPublicInfo3` (`charMgrService.js:516`) — name, corp, alliance, security status.
- `charMgr.GetCharacterDescription` (`:617`) — the bio text (pure string, no ID resolution — easiest).
- `charMgr.GetHomeStation` (`:659`) — home station.
- `charMgr.GetCloneInfo` (`:623`) — clone + implants.

The assets `charMgr` pairs (`MachoBindObject`/`ListStations`/`ListStationItems`) are already allowlisted — do not re-add. Leave `GetRecentShipKillsAndLosses`, `GetPrivateInfo` for a later goal.

## The R7d work — resolve, or omit; never leak an ID

These reads carry IDs. **Show only what resolves to a name/label; never render a raw ID (R7d).**
- **Resolvable via the existing `/api/names`** (kinds: `corporation`, `alliance`, `station`, `character`, `type`): corporationID, allianceID, home stationID, implant typeIDs. Resolve these and show names.
- **NOT in `/api/names`** (bloodline/race/ancestry, security-status is a float not an ID): security status is a plain number, show it. Bloodline/race/ancestry have **no name path** — either find an existing static resolver in `src/staticData.js` (check first) or **omit them from the display** and report that you did. Do not render a bloodlineID as a number to satisfy "completeness."
- An ID that genuinely can't resolve degrades to a plain fallback ("Unknown"), never the number.

## Build

- BFF: a `/api/bridge/character-sheet` route, independent `Promise.allSettled` reads (public info + description + home station + clone info), empty≠failed.
- Decoders: a new `web/src/bridge/characterSheet.ts`, each read's shape decoded **from real captured bytes** (these will be a mix of KeyVal / objectex / Rowset — do not assume; capture and decode against the truth, as R54/R55 did — my briefs have guessed shapes wrong twice, so trust the bytes).
- UI: a Character Sheet panel — name, security status, corp (name), alliance (name) if any, home station (name), bio text, and clones/implants (implant names) if the shape is clean. `panelFirstMount` includes it. Add a `characterSheet` tab to the tab table (`web/src/ui/tabs.ts`, `where: "both"`).

## Hard rules

- **Bridge-only server surface** — permit existing handlers only; eve.js changes restricted to `server/src/_secondary/express/*` + tests, never a `Handle_*`. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` (currently tractor-beam) — commit the pairs by pathspec onto the tip without disturbing their staged/untracked work; verify `git status` after (the R50/R54/R55 pattern). **Also bring `webGatewayServiceCall`'s allowlist snapshot current** with your new pairs (R55 just repaired it; keep it green) — that test is the allowlist's own pin. Never `git add -A`. Never push.
- **A 200 is not proof** — verify wire shapes against real bytes.
- **Do not chase game mechanics** — if a value looks odd in a server-owned way, note and move on.

## Invariants

**R7d** — no raw ID renders; names/labels or omit (the crux) · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green incl. Character Sheet + its empty/loading state.

## Required work

1. Baseline: combined `node --test` (expect **1669/1669**), `tsc` + `build:web` clean.
2. Add the pairs (restart EveJS; update the snapshot test), the BFF route, decoders from real bytes, the panel. Tests, watched failing first: each read decodes its real shape; corp/alliance/station/implant IDs resolve to names; an unresolvable ID falls back without leaking; the R7d sweep (with a matcher-proof companion) finds no ID in rendered text; empty renders honestly.
3. **Verify live:** `rrfarmer` → Farmer, read the real character sheet through the BFF, and report the actual values — name, security status, corp name, home station name, bio, clone/implant names. Capture the real bytes for each decode. Note plainly anything you had to omit (e.g. bloodline) and why. Keep the session short.
4. Update `docs/afk-session-log.md` (append result + decisions, esp. what you omitted and the real shapes found) and the roadmap R56 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A Character Sheet page shows who Farmer is with every ID resolved to a name or honestly omitted (no numeric IDs), the calls allowlisted (existing handlers), decoded from real bytes, empty honest, the snapshot test current. Suite green. This, with R54 (wallet ledger) and R55 (standings), is a solid Tier-A/B head-start; the rest of `docs/api-coverage-plan.md` remains for the operator to prioritize.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — rerun the full suite before assuming a single failure is yours. **Note:** `webGatewayServiceCall.test.js` needs the **isolated runner** (`npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`) — a bare `node --test` on it fails with a gameStore-isolation guard, which is NOT a real failure.
- Servers: :26002 EveJS (PID 67948), :26500 web (PID 39024, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs, so you MUST restart EveJS after committing them.** Own the process; set no `EVEJS_*` overrides; leave all three healthy.
- **You are the only build worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password; login returns a `sessionToken`.
- **Watch new tests fail first** — thirteen+ tests here have been caught passing while asserting nothing; every id sweep needs a companion proving the matcher fires.
- **Browser pane:** SPA at `/`. Screenshots time out; static geometry measurable; async panel content never flushes past first paint. Drive `AppFlow`/the BFF and capture real bytes there. Say plainly what you could not see.
