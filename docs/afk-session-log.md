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

*(appended as each lands)*

## Decisions made autonomously (recommended paths)

*(appended as each is made)*

## Open for the operator on return

*(anything that genuinely needs a human call)*
