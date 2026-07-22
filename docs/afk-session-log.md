# AFK autonomous session log — 2026-07-21

Operator went AFK granting full autonomy ("use recommended paths, note your decisions"). This is the running record of what landed and every judgment call made without the operator, so it can be reviewed on return. Newest at the bottom of each section.

## The backlog (operator's 7 UI items + the head-start API work)

1. Tabs shown driven by docked/in-space — **R50**
2. Move ore out of a ship's cargo/ore-hold into the station hangar — **R51**
3. Agent Finder: add a "jumps" limit — **R52**
4. Login-default tab bug (Station selected while in space) — **R50**
5. Hangar inventory shows a fake "of 1,000,000 m³" — show "Room used" only — **R51**
6. Look like the EVE client: condensed, square, no rounded corners — **R53** (last, so the token flip cascades to the new UI)
7. Wallet + Corp Wallet tabs — **R50**
- Then: wire the Tier A/B calls from `docs/api-coverage-plan.md` (head start, no UI required).

## Sequencing decision

Builds serialize (they share `flow.ts`, the store, and `src/server.js` — the conflict that has bitten repeatedly). Order: R50 → R51 → R52 → R53 → drone-cap display fix → Tier A/B API wiring. Read-only research (already done: the API catalog) ran in parallel. **Reasoning:** parallel builds on shared files cause merge chaos; serial is slower but clean, and the operator set this to loop precisely so it runs unattended.

## Standing decisions carried in (already resolved with the operator)

- **Server boundary (hard, reinforced 2026-07-21):** web client only; the sole server surface is the thin bridge (`server/src/_secondary/express/*` + tests). We only ever *permit* calls to handlers that already exist — never implement one. A call with no eve.js handler is flagged, not filled.
- **Stop debugging server rules through the client.** Inert belt rats and rock-depletion were server behaviour, not client bugs. Workers are briefed to note-and-move-on on anything that smells like game mechanics.
- **"Must be in station" bot requirement stays advisory, not blocking** (operator confirmed) — the loops resolve docked/undocked themselves, so a hard block would make the launcher narrower than the bot.

## Completed this AFK stretch

**R50 — tabs by state, login-default fix, wallet + corp wallet** (web `062245c`; eve.js `145b65ef`). Items 1, 4, 7. Tab visibility is now a one-place data table (`web/src/ui/tabs.ts`, `where: docked|in-space|both`); the login default derives from the authoritative docked flag (fixes the Station-in-space bug); Wallet renders `account.GetCashBalance`, Corp Wallet renders `account.GetWalletDivisionsInfo`. Tests 1577→1608. Live: personal 115.8B ISK, corp division 1000 = 80,000 ISK, docked flag flips on undock/dock. Verified independently.

**R51 — move ore out of a ship bay, drop the fake hangar limit** (web `30ae9e0`; docs this commit). Items 2 + 5. **The real block for item 2 was in the BFF, not the UI:** `resolvePlace` (`src/server.js`) addressed only hangar/cargo/container/corp, so a ship's specialised bays (ore hold, drone bay, …) could not be named as a transfer **source** — that is why the panel offered no move out of them. Added a `{kind:"shipBay", bay:"<key>"}` place resolving the **active ship's** bay by its bay KEY through **R40's `SHIP_BAYS`** (reuse of the same enumeration `/bays` reads with, not a guess); same bind + source location as `cargo`, only the flag differs, and symmetric (valid as a destination too, no extra code). The browser never sends a flag number. UI: `bayIsActionable` generalised from cargo-only to any present bay of the active ship, each bay addressed via `bayPlace(bay)`; `samePlace`/`placeName`/`rowsOf` learned the kind; `refreshOpenPlaces` (`flow.ts`) re-reads the open ship's bays after a mutation; a bay on a hull you are not flying stays read-only. **Item 5:** the station hangar renders **"Room used: {used} m³"** (new `roomUsedText`) — no "of {capacity}", no gauge — keyed **structurally** on being the station-hangar card, never on sniffing the 1,000,000 phantom; ship bays with a real finite capacity keep "X of Y" + gauge. Tests 1608 → 1615 (+7, three watched RED first). **Live (`rrfarmer` → Farmer's Procurer, docked):** moved a Veldspar stack (85,798) `from:{shipBay:"ore"}` → hangar — `applied:true`, server `OnItemChange` flag **134 → 4**, authority re-read confirms it **left the ore hold** and **appears in the hangar** (flag 4); restored it hangar → `{shipBay:"ore"}` so Farmer's fixture is intact; session released, Farmer left docked. `tsc` + `build:web` clean. Verified through the real BFF+EveJS; the browser paint itself was not seen (pane hidden).

## Decisions made autonomously (recommended paths)

- **R51 station "no limit" keyed structurally, not on the sentinel.** The 1,000,000 m³ is eve.js's `_calculateCapacity` default for the unmapped hangar flag; the operator asked us not to show it. Detection is by **which card is rendering** (the station-hangar card uses `roomUsedText`), not by testing whether the number equals 1,000,000 — the magic value is fragile and could legitimately appear elsewhere. Recommended path taken.
- **R51 `shipBay` made symmetric (source AND destination).** `resolvePlace` handles `from` and `to` identically, so teaching it the bay as a source made it a valid destination for free. Kept it — it required no extra code, exercised the restore leg of the live test, and is the correct general behaviour; the UI still only surfaces the "move out to hangar" affordance the operator asked for.
- **R51 web BFF restarted, EveJS untouched.** The fix is pure BFF+client (no gateway pair), so only the web server (`node src/server.js`, 57272 → 59260) was restarted to load the new `resolvePlace`; EveJS (:26002) was left running. No `EVEJS_*` overrides.

- **R50 corp wallet: wired for real, not placeholdered.** The research found `account.GetWalletDivisionsInfo` has a real handler (`accountService.js:593`), so I added the one allowlist pair (bridge-only, existing handler) rather than shipping a placeholder. Recommended path taken because the data is real and top-level-clean.
- **eve.js gateway pair committed onto the other agent's branch tip by pathspec** (`145b65ef`), committing only our one file and leaving their staged destiny work in the index untouched. This is the established pattern — our gateway commits land wherever eve.js HEAD is; pathspec keeps it isolated. Verified their work intact.

## Open for the operator on return

*(anything that genuinely needs a human call)*
