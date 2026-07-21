# Goal R42: Per-tab sessions — ten tabs, ten accounts, ten bots

**Issued:** 2026-07-21 by the orchestrator, at the operator's explicit direction. **Status:** Ready (queue behind R41 — shares `src/server.js`). **Client + bridge.**

The operator wants to run several bots at once:

> *"So I could even have 10 tabs, each a different account logged in running bots."*

They chose this approach after being shown the options.

## The problem, diagnosed

**The server already supports concurrent accounts.** The R39 soak ran Farmer (`rrfarmer`) and Test Two (`test2`) **concurrently for a full hour with no interference**. Session takeover only occurred when two clients drove the *same* character.

**The browser is the blocker.** `setSessionCookie` (`src/server.js:54-62`) issues:

```js
res.cookie(config.sessionCookieName, token, {
  httpOnly: true, sameSite: "lax", secure: false,
  maxAge: config.sessionTtlMs, path: "/",
});
```

Cookies are shared across every tab of a browser profile, so a second tab logging in as another account **overwrites the first tab's session** — all ten tabs collapse onto whichever account logged in last. And a grep confirms **nothing in the BFF reads an `Authorization` header or any non-cookie credential**: the cookie is the only carrier.

## The change

**Move the session token to `sessionStorage` and send it as an `Authorization` header.** `sessionStorage` is per-tab by specification, so each tab holds its own token and ten tabs can hold ten different accounts.

1. **BFF accepts either**, for a migration window: the existing cookie **or** `Authorization: Bearer <token>`. Same token, same `verifySessionToken`, same `req.webSessionID` — this is a change of *carrier*, not of auth. `requireAuth` (`src/server.js:84-104`) is the single choke point; do not scatter the logic.
2. **Login returns the token in the response body** so the client can store it, in addition to (not instead of) setting the cookie during migration.
3. **The client stores it in `sessionStorage`** and attaches the header on every request. `web/src/app/api.ts` funnels requests through helpers (`postJson` and friends) — attach it there, once, not at each call site.
4. **Logout clears both.**

## State this plainly in the code

Moving off `httpOnly` **loses XSS protection for the token**. That is an acceptable trade *here* — this is a local dev emulator whose login already accepts any password for any existing username (`src/server.js:128`, goal R1, mirroring the emulator's `devSkipPasswordValidation`) — but it must be **written down at the change site**, not left implicit. A future reader must not mistake this for a pattern to copy into something exposed.

## Hard rules

- **Do not weaken `verifySessionToken` or the token itself.** Only the transport changes.
- **The SSE/push channel must work per-tab too.** `GET /api/bridge/events` is an `EventSource`, which **cannot set headers**. Determine how it authenticates today and make it work per-tab — a query parameter carrying a session token is the usual answer, but **note that this puts a credential in a URL**, so if you take that route, say so explicitly and keep it out of logs. If you find a better option, take it. **This is the part most likely to be missed** — a per-tab session whose push channel still rides the shared cookie is only half the feature.
- **A 200 is not proof** — ten confirmed patterns.
- **Client + bridge only.** No eve.js source changes are expected; the gateway is unaffected.

## Invariants

**R7d** zero visible numeric IDs · **R8** responsive · **R9a** plain player language · **R18** `panelFirstMount` green.

## Required work

1. Baseline: web `npm test` (**1467/1467** as of R40; take the real number), `tsc` + `build:web` clean.
2. Implement. Tests must cover: header-only auth works; cookie-only still works; both present agree; a bad token is refused; logout clears both; and **two different tokens in flight resolve to two different characters** — that last one is the actual feature.
3. **Verify live, and this is the acceptance test:** two browser tabs (or two isolated request contexts), logged in as **different** accounts, both reading their own character simultaneously without either being logged out. Report the real characters and what each read. Then confirm the **push channel** works for both at once.
4. Roadmap R42 row + `docs/bridge-wire-contract.md` if the contract changes. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

Two tabs, two accounts, both live at once, each with its own working push channel — demonstrated, not asserted. The cookie path still works so nothing regresses mid-migration.

## Constraints

- Never `git add -A`. Never push. Another agent has in-flight destiny/parity work in eve.js on branch `ReconcileEliteMode` — never revert or clobber it.
- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` is GREEN (8/8) and must stay green; a rare time-derived `skillsPanel` countdown flake passes isolated — do not chase it.
- **Fixtures from real captured bytes; watch each new test fail first.** Seven tests here have been caught asserting nothing — three written as ``new RegExp(`\b${id}\b`)`` (template-literal `\b` is BACKSPACE) and one sweeping for a field the BFF strips.
- Servers up: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). Own any process you start; set no `EVEJS_*` overrides; leave all three healthy.
- **Only one worker drives live sessions at a time** — concurrent live workers took each other's sessions during R39/R40. Ironically this goal is *about* that; still, coordinate rather than fight.
- Preserve `_local` gameplay data, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's — leave them.
- **Logins:** `rrfarmer` → Farmer, `test2` → Test Two, plus `test`, `rrfarmerAdmin`, `rrfarmerasdf`. Any password.
- **Browser pane:** the SPA is at **`/dist/`**, not `/` (the root serves the legacy app). Screenshots time out; static geometry IS measurable but **async-loaded panel content never flushes to the DOM**. Two isolated request contexts via `fetch` are a legitimate way to prove this feature.
