# Goal R50: Tabs by state — docked vs in-space, fix the login default, add the wallets

**Issued:** 2026-07-21 by the operator. **Status:** Ready. **Client + bridge. Three operator items in one subsystem (the nav).**

The operator is pivoting to **tightening and EVE-faithful UI**. Stop treating server rules as client bugs — if something looks like a game-mechanics issue, note it and move on; do not chase it. This goal is three of their listed items, all in the tab bar (`web/src/ui/App.svelte`).

## Item 1 — which tabs show, driven by docked / in-space

Today `App.svelte` renders a **flat 18-button nav** (`:69-121`) with no gating. The operator: *"refactor down to 'what tabs should be displayed', and it's really just based on 'Docked' or 'Undocked' + both have overlap."*

Make tab visibility a function of state. Define three sets as **data** (a small table, easy to adjust — the operator will tweak it):

- **In-space only:** `flight`, `overview`, `mining`, `travel`, `bots`
- **Docked only:** `station` (services), `fitting`
- **Both:** `inventory`, `market`, `industry`, `contracts`, `assets`, `agents`, `finder`, `skills`, `planets`, `mail`, `chat`, and the new `wallet` / `corpWallet`

That partition is a sensible EVE-like default, not gospel — implement it so changing which set a tab is in is a one-line data edit, not surgery. The docked/in-space signal already exists (`flight.docked` / `inSpace` in the store; `station.online`). Use the authoritative flag, don't infer.

## Item 4 — the login-default bug (fix this even if you do nothing else)

`page` is `$state("station")` (`App.svelte:41-60`) — hardcoded. So on first login **the Station tab is selected even when the character is in space**. The operator hits this every session.

The initial selection must **derive from actual state**: docked → `station`, in space → `overview` (or another sensible in-space default). And when the player **docks or undocks mid-session**, if the currently-selected tab is no longer in the visible set, fall back to that state's default rather than showing a blank/again-station panel. Reuse the authoritative docked flag; do not guess from stale data.

## Item 7 — Wallet and Corp Wallet tabs

Two tabs are missing.

- **Wallet (personal):** the data is already here — `account.GetCashBalance` is allowlisted and the BFF already calls it (`src/server.js:2611`, `:4230`). A Wallet panel showing the balance (and, if cheaply available, recent transactions) needs **no new gateway pair** for the balance itself. Money is ISK — render it as ISK, R9a plain, never a raw number ID.
- **Corp Wallet:** likely needs a call we don't have. `corpRegistry.GetCorporation` is allowlisted (corp *info*, not the wallet). **Check ClientCodeGrabber (`C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest`) and the eve.js services for the corp-wallet read** (corp account/division balances). If it needs a new gateway pair, add the **minimum** with a justification comment (precedent: R37/R38 added exactly what was needed and declined wider reads), restart EveJS, and prove it. **If the corp-wallet read genuinely does not exist or is not reachable, ship the personal Wallet tab and render Corp Wallet as an honest "not available yet" placeholder — do not fake it, and report exactly what is missing.**

## Hard rules

- **A 200 is not proof** — re-read authority; empty must be distinguishable from failed (`worldHasNoContracts` precedent).
- **Client + bridge only.** eve.js changes restricted to `server/src/_secondary/express/*` + tests. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — never revert or clobber it. Never `git add -A`. Never push.
- **Do not chase game-mechanics behaviour.** If a wallet number or a docked flag looks "wrong" in a way that is the server's business, report it and move on.

## Invariants

**R7d** zero visible numeric IDs (ISK is a currency amount, fine; a characterID/corpID is not) · **R8** responsive, ≥40px targets, no horizontal body scroll · **R9a** plain player language · **R18** `panelFirstMount` green — **add the new Wallet/Corp Wallet panels to it**, and the first-mount test must cover the docked *and* in-space default selection.

## Required work

1. Baseline: combined `node --test` (expect **1577/1577**), `tsc` + `build:web` clean.
2. Implement all three items. Tab sets as data; initial + on-dock/undock selection derived from the authoritative flag; the two wallet tabs.
3. Tests, watched failing first where it applies: the in-space default is not `station`; a docked default is `station`; a now-hidden selected tab falls back on state change; the visible tab set matches the state; the Wallet panel renders the balance; Corp Wallet renders data or an honest placeholder. **Twelve tests in this repo have been caught passing while asserting nothing** — if you write an id/tab sweep, include a companion proving the matcher matches.
4. **Verify live:** log in **in space** and confirm the default tab is an in-space one (not Station) and only the right tabs show; dock and confirm the set switches and selection falls back sanely; open Wallet and read the real ISK balance. Keep the session short; leave the character docked.
5. Roadmap R50 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

Tabs shown are driven by docked/in-space with an adjustable data table; first login selects a tab that matches where the character actually is; docking/undocking re-selects sanely; a Wallet tab shows real ISK and a Corp Wallet tab shows real data or an honest placeholder with the missing call named. Live-verified. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8) must stay green; rare time-derived `skillsPanel`/`planetsPanel` flakes rerun green — do not chase them.
- Servers: :26002 EveJS (PID 62824), :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **If you add a gateway pair you must restart EveJS** — own the process; set no `EVEJS_*` overrides; leave all three healthy.
- **Only one BUILD worker runs at a time — you are it.** A read-only research agent is also running; it will not touch your files.
- Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password; login returns a `sessionToken` for `Authorization: Bearer`.
- **Browser pane:** the SPA is at **`/`**. Screenshots time out and rAF never fires; static geometry (which tabs render at which viewport, ≥40px) IS measurable via `javascript_tool` + `getBoundingClientRect`; but async panel *content* never flushes past first paint. Drive `AppFlow` for behaviour. Say plainly what you could not see.
