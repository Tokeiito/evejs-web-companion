# Goal R7c: Names everywhere — replace raw IDs with resolved names across the whole UI

**Issued:** 2026-07-19 by the orchestrator, from operator feedback: "Anywhere we have an ID instead of a name, show the name — ships, items, locations, agent names, whatever you see. High-value display pass." **Status:** Ready to run. **Web-only — no eve.js change** (the resolvers already exist in `src/staticData.js`).

## What exists to build on

`src/staticData.js` already resolves names: `getTypeName(typeID)`, `getTypeGroupName`, `getTypeCategoryName`, `getCorporationName(corpID)`, `getAllianceName(allianceID)`, `getStationName(stationID)`, `getSolarSystemName(systemID)`, `getRegionName`, `getAgentsByID()` (agents carry `ownerName`). gameStore tables present: `itemTypes`, `corporations`, `alliances`, `factions`, `characters`, `agentAuthority`. Existing name routes: `/api/map/resolve/:id`, `/api/map/station/:id`, `/api/map/find`. R7a added a client-side name cache in `flow.ts` for Flight — generalize that pattern.

You may add small missing resolvers to `src/staticData.js` if needed (e.g. `getAgentName(agentID)` from `getAgentsByID`, `getCharacterName(characterID)` from the `characters` table, `getFactionName(factionID)` from `factions`) — still web-repo, no eve.js change. Prefer a name already present in **live** data (e.g. a chat roster member or station guest that already carries a `characterName`) over a static lookup; use static resolution for NPC/type/corp/agent/faction IDs.

You are a worker session. Read FIRST: every `web/src/ui/*.svelte`, `web/src/app/flow.ts` (R7a's flight name cache), `src/staticData.js`, `src/server.js` (the `/api/map/*` routes). Execute exactly this goal, then stop.

## Objective

Everywhere the UI shows a bare numeric **ID**, show the resolved **name** (keep the ID only as a secondary detail or a fallback when unresolved). Do NOT touch `{#each ... (key)}` keys, input `placeholder`s, or `on:click` args — those are internal, not display.

### The resolution mechanism
- Add a **batch name-resolution** BFF route (static, login-gated, mirroring `/api/map/find` — NOT a bridge call): e.g. `POST /api/names` taking `{ items: [{kind, id}] }` with `kind ∈ type | corporation | alliance | faction | character | agent | station | system`, returning `{ names: { "type:34": "Tritanium", ... } }`, over the existing staticData resolvers. Batch so an inventory list of many typeIDs is one round-trip.
- A **client name-cache** in `flow.ts` (generalize the R7a flight cache): components request names by (kind,id); the cache batches unresolved IDs, resolves once, caches (including a definitive "unknown" so it doesn't refetch), and exposes resolved names through the store so components stay pure readers. Never block interactions on resolution (fire-and-forget; show the ID until the name arrives).

### The display sites (from an audit — fix all, then sweep for more)
- **InventoryShip.svelte:** item rows show `{row.typeID}` and `{row.categoryID}` → **type name** + **category name**; the active-ship line `ship {activeShipID}` and the boardable rows → **ship type name** (resolve the ship item's typeID → name). Keep quantities/IDs as secondary.
- **Flight.svelte:** `Active ship {shipID}` → **ship type name** (system/station already resolved by R7a — keep).
- **AgentsMissions.svelte:** `Agent {agentID} (L.. · kind)` and `Conversation · agent {activeAgentID}` and journal `agent {agentID}` → **agent name**; briefing `Cargo type {cargoTypeID}` → **type name**; briefing pickup/destination `station {id} · system {id}` → **station + system names**; LP `corp {issuerCorpID}` → **corp name**; standings `toward {fromID}` → **name** (resolve as corporation/faction/character as applicable); `title {missionTitleID}` → a readable title if resolvable, else leave.
- **StationPanel.svelte:** owner `{bits.ownerID}` → **corp/faction name**; `Station type ID {stationTypeID}` (already shows `stationTypeName` when present — ensure it does); solar system already shows name+ID (fine); guests `{corporationID}` / `{allianceID}` → **corp / alliance names** (guest character already shows name — verify).
- **Chat.svelte:** verify the roster and message senders show **character names**, not IDs (resolve if any ID leaks through).
- **Travel.svelte / AgentFinder.svelte:** mostly resolved already — fix any remaining `System {id}` / `station {id}` fallbacks to attempt resolution first.

## Required work

1. **Baseline** (record): web `npm test` (expect 341/341). No eve.js change (confirm + say so). Never `git add -A`.
2. Build the batch `/api/names` route + client name-cache, then replace every audited raw-ID display (and any others you find). Keep the ID visible only as secondary detail where it's genuinely useful (e.g. the Station panel's raw retail-data section may keep IDs but should add names).
3. **Tests:** a `/api/names` route test (batch resolve across kinds, unknown → graceful, login-gated) + flow tests for the name-cache (batches, caches, doesn't refetch, resolves through the store) + at least one component-level assertion that a previously-ID field now renders a name.
4. **Completeness sweep:** after the fixes, grep every `web/src/ui/*.svelte` for remaining bare-ID displays (`{...ID}`, `type ${...}`, `station ${...}`, `corp ${...}`, `agent ${...}`) and either fix or explicitly justify each remaining one (e.g. a raw-retail-data demo row). List what you deliberately left as ID-only and why.
5. Update `docs/bridge-wire-contract.md` (the `/api/names` route) + README + roadmap (R7c row). Tests green; `build:web` clean; commit web work; report hash. **Do not push.**

## Out of scope

- Any eve.js change. The chat XMPP bridge (R7b, separate). New data not already in gameStore. Icons/images (names only). A field where no name exists in any available data (leave the ID, note it).

## Definition of done

- Across every UI tab, ships/items show **type names**, agents show **agent names**, corps/alliances/factions/characters show **names**, and locations show **station/system names** — with the ID kept only as a secondary detail or unresolved-fallback. Resolution is batched + cached (no per-ID request storms, no refetch loops, never blocks interaction). The completeness sweep is clean or every remaining ID-only field is justified. Tests green; `build:web` clean; eve.js untouched. Committed; hash reported; not pushed.
- Roadmap R7c row Complete with evidence.

## Constraints

- Web repo only; eve.js READ-ONLY. The OPERATOR runs EveJS (:26002); the ORCHESTRATOR runs the web app (:26500). Do NOT start/stop/restart either; run only `npm test` + `npm run build:web`. If you want a live check and EveJS is up you may read via curl, but do not launch servers; fall back to in-process/unit proof. Never push; stage only your files.
