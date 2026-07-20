# Goal R9b: Retire the legacy v1-gateway / eveStore / lease machinery

**Issued:** 2026-07-19 by the orchestrator (Phase 1 cleanup, half B). **Status:** Ready to run. **Web repo only — eve.js untouched.** Runs in parallel with R9a (dev-blurb removal, which owns `web/src/ui/*.svelte`) — **you own `src/` and `test/`; do not touch `web/src/ui/*.svelte`.**

The roadmap has carried "retire the legacy v1-gateway/eveStore machinery" since the migration began. The bridge migration is now complete: the client runs entirely on the bridge + static routes. This goal removes the dead legacy path.

## The surface analysis (done by the orchestrator — verify it yourself before deleting)

**LIVE — the current client calls these; keep all of them working:**
`POST /api/login`, `POST /api/logout`, every `/api/bridge/*` route (select, release, call, agents + `:agentID/action|briefing`, journal, rewards, inventory + move/stack, ship/board, flight status/undock/warp/approach/jump/dock, chat `:channel` + send), every `/api/map/*` (graph, find, resolve/:id, station/:id), `POST /api/names`, `GET /api/agents/find`. Keep `GET /api/health`.

**LEGACY — registered but the current web client never calls them (verified by grepping every `fetch` path in `web/src/`):**
- The whole `GET/POST /api/characters/:characterID/*` family: `status`, `inventory`, `industry`, `market`, `skills` (+ `skills/queue`), `pi` (+ `pi/restart`), `overview`, `events`, and `control/claim|release|renew`.
- `GET /api/characters`, `GET /api/me` — confirm no client use (character selection goes through the **bridge**, `web/src/bridge/characterSelection.ts` → `/api/bridge/call`).
- Their backing modules: `src/eveStore.js` (the emulation/snapshot side), `src/browserLeaseStore.js`, `src/characterEventProxy.js`, `src/marketClient.js`, and the **legacy v1 read helpers in `src/eveGatewayClient.js`** (the `/_evejs-web/v1/...` snapshot calls) — as distinct from the bridge calls (`/call`, `/session/*`, `/bound/*`, `/chat/*`) which STAY.

## ⚠ The critical subtlety — do not break auth

`src/eveStore.js` is **not purely legacy**: `requireAuth` in `src/server.js` calls `store.getAccount(username)` and the login path uses it, and character-ownership checks use `getCharacterForAccount`. **Account/character lookup must survive.** Either keep a slimmed `eveStore` with only the account/character lookup the auth path needs, or extract that into a small module and delete the rest. Deleting `eveStore` wholesale will break login — verify by running the auth tests.

## Objective

Remove the dead legacy path so the repo reflects reality: the client is bridge-only.

1. Delete the legacy routes listed above from `src/server.js` (and any now-dead helpers/middleware they used).
2. Delete/slim the legacy modules (`eveStore` emulation side, `browserLeaseStore`, `characterEventProxy`, `marketClient`, legacy v1 helpers in `eveGatewayClient`), preserving the auth-critical account/character lookup and the entire bridge client.
3. Delete the tests that exclusively covered the removed legacy surface; keep and re-run everything covering the live surface. Do **not** weaken bridge/auth coverage to make the count go down — report exactly which test files/cases you removed and why each was legacy-only.
4. Update `docs/bridge-wire-contract.md` / README / roadmap where they describe the retired machinery.

## Required work

1. **Baseline** (record): `npm test` (expect 358/358). **Independently verify** the live/legacy split above (grep `web/src` for every `fetch` path) before deleting — if you find the client using something I listed as legacy, KEEP it and report the correction.
2. Remove legacy routes + modules + legacy-only tests. Keep the app fully working.
3. **Prove the live surface still works:** `npm test` green (minus legitimately-removed legacy tests), `tsc` + `npm run build:web` clean, and confirm every LIVE route above is still registered (list them from the built `server.js`). Auth/login tests must pass.
4. Update docs + roadmap (R9b row). Commit; report hash + the removed-file/route/test inventory. **Do not push.**

## Definition of done

- The `/api/characters/*` legacy family, `/api/me`, and the legacy modules are gone (or slimmed to only what auth needs); the bridge + static + auth surface is untouched and fully green; login still works. Test count change is fully explained (legacy-only removals). `tsc`/`build:web`/`npm test` green. Committed; hash reported; not pushed.

## Constraints

- **You own `src/` and `test/`.** A parallel worker (R9a) is concurrently editing `web/src/ui/*.svelte` — do NOT touch those, never revert its changes, never `git add -A` (stage only your files). If git reports the index is locked, wait and retry.
- eve.js READ-ONLY / untouched. Operator runs EveJS (:26002); orchestrator runs the web app (:26500) — do NOT start/stop/restart either. Run only `npm test`, `tsc`, `npm run build:web`. Never push.
- If the removal turns out to be riskier than it looks (e.g. a live path secretly depends on a legacy module), STOP, keep the app working, commit what is safely removable, and report the entanglement rather than forcing it.
