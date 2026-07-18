# Goal R1b: Web stack scaffold (TS + Vite + client-state store skeleton)

**Issued:** 2026-07-18 by the orchestrator session. **Depends on:** R1 complete (the bridge route and `docs/bridge-wire-contract.md` must exist). **Status:** Ready after R1.

You are a worker session. Read `docs/web-client-scope-and-roadmap.md` (source of truth, especially §5 "Web app tech stack"), `docs/bridge-wire-contract.md` (produced by R1), and the R1 roadmap-row evidence first. Execute exactly this goal, then stop.

## Objective

Lay the TypeScript + Vite foundation the R2–R6 page migrations will use — **foundation only, zero page migration**:

1. **Vite + TypeScript build** living alongside the existing vanilla app: dev/build npm scripts, output served by the existing Express static setup (or a clearly-documented dev-proxy arrangement). The existing `public/app.js` app keeps working untouched.
2. **Framework-agnostic client-state store skeleton** in TS (plain signals — no view library): typed store shape for session/character context, a subscribe/read API for future pure readers (UI pages and, later, the autopilot loop), and a feed adapter interface that hides the event transport (legacy WS stream now, bridge notifications later — roadmap §5).
3. **Browser-side TS `callMethod` client** typed as `(service, method, args, kwargs)` per `docs/bridge-wire-contract.md`, calling R1's BFF proxy route. Type the reference call (`charUnboundMgr.GetCharacterSelectionData`) end to end as the worked example.
4. **Unit tests** for the store skeleton and the TS client (stubbed fetch). Web `npm test` runs them alongside the existing 105+.

## Repositories

- **Web client (commit here):** `C:\Users\ryanf\Documents\GitHub\evejs-web-poc` (branch `master`).
- **eve.js: READ-ONLY.** This goal makes zero eve.js changes.

## Out of scope

- Migrating any existing page; choosing/adding the view library (Svelte 5 vs SolidJS is the R2 spike).
- Any eve.js change. Any new gateway/bridge capability or whitelist entry.
- Rewriting `public/eventClient.js` / `public/commandClient.js` / `public/mutationScope.js` — the store only defines the adapter interface; wiring the legacy stream into it can be a minimal proof, not a migration.
- Auth/security work (roadmap §6).

## Definition of done

- `npm run dev` / `npm run build` (or equivalently named scripts) work; the built TS output is loadable alongside the untouched vanilla app.
- Store skeleton + TS `callMethod` client exist, typed, with passing unit tests; web `npm test` fully green.
- A short "how to add a page on the new stack" note (10 lines is fine) appended to `docs/bridge-wire-contract.md` or a sibling doc, so the R2 worker starts fast.
- Roadmap R1b row set to Complete with evidence. Web repo committed; hash reported; **not pushed**.

## Constraints

- Preserve all unrelated worktree changes. Never start or stop servers/processes you did not start (ports 443, 26000, 26001, 26002, 26003, 26500, 40110 are others'). Do not delete or rewrite web `data/`, icon caches, manifests, or ignored credentials. Commit every piece of work; never push.
