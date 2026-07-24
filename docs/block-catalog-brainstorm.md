# Block catalog brainstorm — "play the whole game" (2026-07-24)

Every block a player might want, by category, toward fully automated gameplay.
Legend: ✅ shipped · 🔌 plumbed (the BFF call exists; the block is wiring) ·
🛠️ needs BFF work · ❓ retail path needs research. Blocks compose on the run
BOARD (facts published for later blocks) exactly like the mission set does.

## 1. Module & ship-state primitives (the combat foundation)
- 🔌 **Run the shield booster / armor repairer / hull repairer** — activate-by-GROUP
  (like miners/salvagers), with a cap floor: run while capacitor > X%, off below.
- 🔌 **Run the hardeners / damage controls** — set-and-forget actives, on at combat start.
- 🔌 **Speed module (AB/MWD) on/off** — on while closing distance, off in orbit/cap-starved.
- 🔌 **Power modules up/down** (`setModuleOnline` exists) — offline the salvager, online the gun.
- ❓ **Reload ammo / load a charge** — pick charge type per module (crystals, ammo).
- ❓ **Overheat a rack** — if the heat path is even in eve.js.
- 🔌 **Cap-stable watchdog** (interrupt): capacitor-below-X% → response (new CONDITION, not a block).

## 2. Targeting & combat
- 🔌 **Lock the nearest rat / lock by name / lock weakest** — lockTarget + pick rules.
- 🔌 **Engage with guns** — activate every weapon-group module on the locked target
  (the mine block's ladder pointed at a rat; weapon groups by name like miners).
- 🔌 **Fight until the grid is clear** — the full loop: lock → guns + drones → next
  target → done when no hostiles (defend-with-drones grown up).
- 🔌 **Primary-target rules** — nearest / smallest (frigates first) / the one shooting me.
- 🔌 **Flee if…** (interrupt responses): warp to safe/home when targeted-by-player,
  when local spikes, when drones lost, when cap dies.
- ✅ Drone attack/recall exist; add **mining drones on a rock** (route exists: drones/mine).

## 3. Fitting & ship management (docked)
- 🔌 **Fit the ship from a saved fitting** — `inventory/fit-fitting` + `strip-fitting`
  routes exist. Args: fitting name. The "reship" primitive.
- 🔌 **Board ship X** — board-by-name from the hangar (openShip/board path exists).
- ❓ **Repair ship/modules/drones** at the station repair shop.
- ❓ **Insure the ship.**
- 🔌 **Stack & tidy the hangar** (stack-all exists).
- ❓ **Buy missing fitting modules** off market (composes with §5's buy block).

## 4. Cargo & logistics
- ✅ unload-cargo, hangar→ore-hold move (UI), mission load/unload.
- 🔌 **Move N of item X to place Y** — the generic transferItems block (args: item picker,
  qty, source, destination). The one block that makes ad-hoc logistics scriptable.
- 🔌 **Pickup run** — visit stations A,B,C (multi-system travel exists), collect all of
  item X from each hangar into cargo, deliver to D.
- ❓ **Accept + haul courier CONTRACTS** (contracts are read-only at the gateway today).
- ❓ **Jettison / jetcan** (CmdJettison?), abandon-loot route exists.

## 5. Market & trade
- 🔌 **Buy X (up to price P)** — market writes are plumbed (orders, escrow verified).
- 🔌 **Sell everything of type X (min price P)** / **Sell all minerals**.
- 🔌 **Restock ammo/drones to N** before undock (buy + move to cargo/bay).
- 🔌 **Update my orders** (station-trading tick: re-price to top of book with a floor).
- 🔌 **Wallet conditions** (watch: wallet-above/below — condition kind, reads exist).

## 6. Missions & agents (beyond distribution)
- ✅ The 7 distribution blocks.
- ❓ **Combat mission runner** — accept security mission, warp to the encounter
  (mission bookmarks/coords path needs research), clear pockets (§2 blocks), loot/
  salvage (✅), turn in. The big one.
- 🔌 **Mining mission variant** (same agent flow, ore objective).
- 🔌 **Spend LP in the loyalty store** (rewards/LP reads exist; store write ❓).
- 🔌 **Standings guard** — decline-rate limiter already exists conceptually (gateOffer);
  add faction-standing floor condition.

## 7. Mining extras
- ✅ mine/haul/refine loop, belt rotation partial.
- 🔌 **Mine the biggest rocks first** (survey scan read exists — feed the picker).
- 🔌 **Mine the constellation** — rotate BELTS ACROSS SYSTEMS (travel + mine compose).
- ❓ **Ice / gas variants** (module groups differ; likely just picker widening).
- ❓ **Compress the ore** (if a compression service exists in eve.js).
- 🔌 **Jetcan mining** pairs with ❓ jettison.

## 8. Planetary Industry (R41 planets slice exists)
- ❓ **Restart the extractors** — the operator's ask; needs the PI program-install write.
- ❓ **Collect the launchpad → customs office → haul PI goods home** chain.
- 🔌 **PI status watch** — extractor-expired condition (colony reads exist) → alert/act.

## 9. Industry & science (R15 slice: blueprints/jobs/facilities + action writes)
- 🔌 **Install a manufacturing job** (blueprint + materials at station).
- 🔌 **Deliver finished jobs.**
- 🔌 **Build-from-minerals loop** — refine (✅) → install → deliver → repeat.
- ❓ Copying/invention/reactions — depends what the world supports.

## 10. Travel & positioning
- ✅ Multi-system travel/home. 
- 🔌 **Dock at the nearest station** (panic already computes it — make it a block).
- ❓ **Warp to a safe spot / bookmark** (bookmark reads? BookmarkNotAvailable refusal
  exists, so bookmarks are in the protocol).
- 🔌 **Warp to an anomaly** — the system-scan gateway bind exists (R72) → scan results
  as warp targets. Opens ratting/anomaly loops.
- ❓ **Avoidance routing** (route solver exists; add avoid-list arg).
- ❓ **Jump clones.**

## 11. Awareness & alerts (mostly new CONDITIONS + responses, not blocks)
- 🔌 Conditions: **local count above N**, **player on grid**, **targeted by a player**,
  **cap below X**, **ammo empty**, **drone health low**, **cargo full generic**,
  **wallet above/below**, **time-elapsed** (wait ✅ covers), **missions completed ≥ N**.
- 🛠️ **Alert the player** response — browser notification/sound when a watch fires
  (client-only; no gateway work).
- 🔌 **Chat watch** — local/corp chat reads exist; condition on hostile-in-local by standings ❓.

## 12. Program flow & composition
- ✅ Repeat loop, until/watches, wait.
- 🛠️ **Run saved bot X as a block** — sub-scripts: compose whole bots ("Mining day" =
  run "Belt loop" then "Refine day"). Format + orchestrator work, no gateway.
- 🛠️ **Skip-next-if / branch-lite** — the HRM model is deliberately branchless; a
  bounded "do block A else B on condition" needs a format decision.
- 🛠️ **Named board slots** — let a block's arg read "the station block 2 found".

## 13. Fleet & multi-character
- 🔌 Fleet reads are bound (R72); writes ❓ — form fleet, invite, fleet-warp, boosts.
- ❓ Multi-account orchestration (Orca + barges) — a BFF-level feature, not a block.
- **Operator direction (2026-07-24): players on grid are FRIENDLY in this world** —
  no PvP-flee default. New fleet-support block ideas: ❓ **warp to fleet member**,
  ❓ **remote-repair a fleet member's shields/armor**, ❓ **remote capacitor
  transfer**, ❓ **stay-and-boost** (orbit the fleet member and keep remote reps
  cycling on whoever's hurt) — the logistics-pilot loop.

## Operator decisions (kickoff, 2026-07-24)
- Build order: the recommended ladder (§1+§11 → fight-until-clear → anomaly ratting →
  fit/board/restock → move-items → research items).
- BFF: FULL autonomy including restarts (accepting the session drop each restart).
- Format: sub-bot blocks, branch-lite, and named board slots are all approved.
- PvP: players are friendly (dev world) — combat blocks ignore players; fleet-support
  blocks above are wanted instead.

## Shipped by the catalog loop (2026-07-24)
✅ repair watch (thermostat: on hurt / off cap-starved / off healed) + capacitor-below
condition + Watch Capacitor · ✅ hardeners-on · ✅ fight-the-rats (concentrated fire,
NPC-only per operator decision) · ✅ warp-to-anomaly (scanner read + new warp-scan
BFF route → the ratting loop) · ✅ refit-ship (board-right-hull + FitFitting by
name, fitting picker) · ✅ move-items (generic N-of-X from/to hangar-cargo-orehold)
· ✅ warp-to-bookmark (new warp-bookmark BFF route; name-matched, in-system) ·
✅ find-combat-agent + fly-to-mission-site ("Agent Missions" folder auto-pick,
prefers the coordinates bookmark) + accept gate made mission-kind-aware → the FULL
security-mission chain is wireable · ✅ restart-extractors (UserUpdateNetwork
INSTALLPROGRAM 13 on each expired ECU, same resource, server-clock expiries — the
PI ask). Two BFF restarts performed under the full-autonomy grant.

## Suggested build order (value ÷ effort)
1. **Module primitives + conditions** (§1, §11 conditions) — unlocks combat AND safer
   mining (rep-when-shot), nearly all 🔌.
2. **Fight-until-clear** (§2) — with §1 done, this is the defend block grown up; with
   the system-scan warp (§10) it becomes an anomaly-ratting loop.
3. **Fit-from-saved + board-ship + restock** (§3, §5) — the "reship and go" morning block.
4. **Generic move-items block** (§4) — one block, endless logistics scripts.
5. **Combat missions** (§6) — the flagship; needs the encounter-warp research first.
6. **PI restart** (§8) — high player value; gated on the PI write being plumbed.
