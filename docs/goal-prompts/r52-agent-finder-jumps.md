# Goal R52: Agent Finder — a "within N jumps" limit

**Issued:** 2026-07-21 (operator's tightening list, item 3). **Status:** Ready. **Client only; small.**

The operator: *"ON Agent Finder: add another limit of 'jumps'."*

## What exists

`web/src/ui/AgentFinder.svelte` already has kind + level filters (server-side re-find) and a text search (client-side). **Jumps are already computed:** `flow.ts` runs a client-side BFS (`distancesFrom`) over the stargate graph from the current system, and every finder row carries a `jumps` field (`flow.ts:4011`, `null` when unreachable), with the list already sorted nearest-first (`:4109`). So the data is there — this is one more client-side filter over rows we already hold.

## What to build

Add a **"within N jumps"** limit to the finder — a small numeric input (or a few presets like 5 / 10 / 30, your call — the operator said "a limit," so a bounded number field is fine). It filters the rendered rows to those whose `jumps` is non-null and `<= N`. Sit it alongside the existing filters.

- **Client-side only** — like the text search, it filters the already-fetched, already-jump-counted rows. It must **not** trigger a server re-find (kind/level do that; jumps does not).
- **Unreachable agents (`jumps === null`)** are excluded when a jumps limit is active — you cannot fly there, so "within N jumps" cannot include them. Say so plainly if it matters (R9a); don't render a blank.
- **Same-system agents are 0 jumps** and always pass a limit ≥ 0.
- **An empty/blank limit means no jumps filter** (show all, as today) — the filter is opt-in.
- Interacts cleanly with the existing text search and the render cap: apply the jumps filter, then the text filter, then the cap, so the cap counts what actually matches.

## Hard rules

- **Client only.** No BFF routes, no gateway pairs, no eve.js changes. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — don't touch eve.js. Never `git add -A`. Never push.
- **Do not chase game mechanics.** This is a filter over existing data.

## Invariants

**R7d** zero visible numeric IDs (a jump count is a count, not an ID — fine) · **R8** responsive, ≥40px targets · **R9a** plain player language ("within 10 jumps", not jargon) · **R18** `panelFirstMount` green.

## Required work

1. Baseline: combined `node --test` (expect **1615/1615**), `tsc` + `build:web` clean.
2. Add the filter. Tests, watched failing first: an agent 12 jumps away is hidden at limit 10 and shown at limit 30; an unreachable agent is hidden when a limit is active and shown when it isn't; a same-system agent passes; blank limit shows all; the jumps filter does not re-find (no server call). Put the pure filter logic where it's unit-testable (the finder's derivation), not buried in markup.
3. **Verify live if practical:** load the finder for a character and confirm the count of agents shrinks as the jumps limit tightens, matching their real distances. If the finder needs a docked/agent-station context that's awkward to stage, prove it by test and say so. Keep any session short.
4. Update `docs/afk-session-log.md` (append result + any decision) and the roadmap R52 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The Agent Finder has a "within N jumps" limit that filters client-side over the already-computed distances, excludes unreachable agents when active, and is opt-in. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — do not chase them.
- Servers: :26002 EveJS (PID 57760), :26500 web (PID 59260, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **No gateway pair, no restart needed.** Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **You are the only build worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password; login returns a `sessionToken`.
- **Watch new tests fail first** — thirteen+ tests here have been caught passing while asserting nothing.
- **Browser pane:** SPA at `/`. Screenshots time out; static geometry IS measurable; async panel content never flushes past first paint. Drive `AppFlow` for behaviour. Say plainly what you could not see.
