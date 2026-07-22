# Goal R55: Standings page (API head-start, Tier A #2)

**Issued:** 2026-07-21 (operator's API head-start). **Status:** Ready. **Client + bridge.**

Second head-start cluster (`docs/api-coverage-plan.md` Tier A #2). Who the character stands with — NPC corps, factions, agents — and by how much. Cheap because the core read is already wired.

## What already exists

- `standingMgr.GetCharStandings` is **already allowlisted** (`evejsWebGatewayRuntime.js:244`) and **already decoded** — `web/src/bridge/rewards.ts:116` decodes it as a header/lines Rowset with columns `["fromID","standing"]`. Reuse that decode; don't rewrite it.
- The `standingMgr` handlers all exist server-side: `GetCharStandings` (`:197`), `GetCorpStandings` (`:205`), `GetStandingTransactions` (`:213`), `GetStandingCompositions` (`:222`).

## Add (gateway pairs — existing handlers only; restart EveJS after)

- `standingMgr.GetCorpStandings` (`:205`) — the character's corp's standings.
- `standingMgr.GetStandingCompositions` (`:222`) — the breakdown of *why* a standing is what it is (base + skill + effective), if the retail standings panel shows it.
- `standingMgr.GetStandingTransactions` (`:213`) — the standings history/ledger.

`GetCharStandings` is already allowlisted — do not re-add.

## The real work — resolve the entity IDs to names (R7d)

`GetCharStandings` gives `{fromID, standing}`. **`fromID` is an entity ID** (an NPC corporation, faction, or agent) — it **must not render as a number** (R7d). Resolve each `fromID` to a name through the existing `/api/names` batch (`resolveOneName` handles `corporation`/`faction`/`character`/`corporation` kinds). The main effort is: read the standings, batch-resolve the fromIDs to names, and show "Caldari Navy · +5.2", never "1000035 · +5.2".

- The `fromID` kind (corp vs faction vs agent) may not be obvious from the standing row alone. Determine how the retail standings panel classifies them (check `ClientCodeGrabber` standingsPanel), or resolve opportunistically across the plausible kinds and use whichever name resolves. **Report how you resolved the kind** — don't guess silently.
- A standing that cannot be name-resolved must degrade honestly (a plain "Unknown entity" fallback), never leak the ID.

## Build

- BFF: a `/api/bridge/standings` route, independent `Promise.allSettled` reads (char + corp + compositions), empty≠failed.
- Decoder: extend `web/src/bridge/rewards.ts` (or a new `bridge/standings.ts` if cleaner) reusing the existing `GetCharStandings` decode; build any new-shape decode (compositions/transactions) **from real captured bytes**.
- UI: a Standings panel — entity name, standing value (the classic −10..+10 scale, +/- coloured is fine), grouped or sorted sensibly. `panelFirstMount` must include it.

## Hard rules

- **Bridge-only server surface** — permit existing handlers only; eve.js changes restricted to `server/src/_secondary/express/*` + tests, never a `Handle_*`. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — commit the pairs by pathspec onto the tip without disturbing their staged/untracked work (the R50/R54 pattern; verify with `git status` after). Never `git add -A`. Never push.
- **A 200 is not proof** — verify wire shapes against real bytes.
- **Do not chase game mechanics** — if a standing value looks off in a server-owned way, note and move on.

## Invariants

**R7d** — a `fromID` must never render; names only (this is the crux) · **R8** responsive, ≥40px targets · **R9a** plain player language · **R18** `panelFirstMount` green incl. Standings and its empty state.

## Required work

1. Baseline: combined `node --test` (expect **1647/1647**), `tsc` + `build:web` clean.
2. Add the pairs (restart EveJS), the BFF route, the decoders from real bytes, the panel with name resolution. Tests, watched failing first: a standing row resolves to a name (no `fromID` in rendered text — with a companion proving the id-sweep matcher matches); empty standings render honestly; the new decodes handle their real shape.
3. **Verify live:** `rrfarmer` → Farmer, read real standings through the BFF, resolve the fromIDs, and report the actual entities + standings (e.g. "Caldari Navy +x, Guristas −y"). Capture the real bytes for any new-shape decode. Keep the session short.
4. Update `docs/afk-session-log.md` (append result + decisions, esp. how you classified fromID kinds) and the roadmap R55 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

A Standings page shows the character's standings with entities resolved to names (no numeric IDs), the calls allowlisted (existing handlers), decoded from real bytes, empty honest. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — thirteen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 29044), :26500 web (PID 43036, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs, so you MUST restart EveJS after committing them.** Own the process; set no `EVEJS_*` overrides; leave all three healthy.
- **You are the only build worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password; login returns a `sessionToken`.
- **Browser pane:** SPA at `/`. Screenshots time out; static geometry measurable; async panel content never flushes past first paint. Drive `AppFlow`/the BFF for behaviour and capture real bytes there. Say plainly what you could not see.
