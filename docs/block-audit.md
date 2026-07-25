# Bot-block audit — every player action we can reasonably automate (2026-07-24)

The working list of blocks, reconciled against **what the client can actually do
today**. Unlike [block-catalog-brainstorm.md](block-catalog-brainstorm.md) (the
wish-list), every proposed block here is tagged with the concrete bridge call or
existing `ScriptAction` that backs it, so the feasibility tag is grounded, not
guessed.

Legend
- ✅ **shipped** — a block exists today.
- 🟢 **rides verified actions** — composes `ScriptAction`s the runner already
  issues live (`lock` / `activate` / `orbit` / `warp` / `moveItems` …). Low risk;
  the mechanic is proven, only the block wrapper + observe-hint is new.
- 🔌 **write plumbed, unverified** — the BFF write route + bridge ack decoder
  exist, but the memory notes these Phase-3/4 writes are *fast-mode educated
  guesses, never fired live*. Needs one live QA pass before trusting.
- 🛠️ **format / orchestrator work** — no gateway call; new program shape, a new
  condition kind, or a client-only behaviour.
- ❓ **needs research** — the retail path or a missing write is unconfirmed.

Category = the play-loop filter key in `macroCatalogView.ts`
(`movement · combat · mining · hauling · market · missions · industry · ship ·
planets · fleet · flow`).

---

## 1. Shipped today (27 blocks)

| Category | Blocks |
|---|---|
| movement | undock · travel-to-station · warp-to-bookmark |
| mining | mine-at-belt |
| combat | defend-with-drones · hardeners-on · fight-the-rats · warp-to-anomaly |
| hauling | deliver-ore · unload-cargo · salvage-wrecks · loot-wrecks · move-items |
| industry | refine-ore |
| missions | find-distribution-agent · request-mission · accept-mission · load-mission-cargo · travel-to-dropoff · turn-in-mission · return-to-agent · find-combat-agent · fly-to-mission-site |
| ship | refit-ship · repair-ship |
| planets | restart-extractors |
| flow | wait |

Plus the **watches** (interrupts): shield/armor/hull/health/capacitor-below,
hostile-on-grid, with responses pause / dock-and-pause / launch-drones / repair.

---

## 2. Proposed new blocks

### flow — program logic (greenlit: "control flow")
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **branch-lite** — if a check holds, run block A, else B | new `ProgramNode` | 🛠️ | The HRM model is branchless today; needs a `BranchBlock` node + forward-scan handling. One level, no cycles (keeps the livelock proof). |
| **run saved bot as a block** (sub-bots) | new `ProgramNode` + orchestrator | 🛠️ | Inline another saved script as one step. Format + a depth/size cap (no recursion). |
| **named board slots** — "the station block 2 found" | new `Arg` reading the run board | 🛠️ | The board already carries facts across steps; this lets a later block's arg *read* one. |

### market — the transaction loop — ✅ SHIPPED 2026-07-24
Correction to the earlier read: general `placeMarketBuyOrder` / `placeMarketSellOrder`
routes DO exist (the R16 market panel's own writes, escrow-verified) — so a general
buy AND a general sell are both buildable, not just PLEX.
| Block | Backing | Status | Notes |
|---|---|---|---|
| **buy-item** (N units, up to price P each) | `placeMarketBuyOrder` | ✅ | One-shot order; server confirm-gated; spends ISK. Flag for one live QA. |
| **sell-item** (all of item X, at ≥ price P) | `placeMarketSellOrder` per stack | ✅ | Lists each hangar stack; the stack leaving the hangar is the confirm. |
| **wallet-below / wallet-above** watch | `loadWallet` (per-tick when watched) | ✅ | New condition kinds carrying absolute ISK; a wallet-watching bot pays for the read, others don't. |
| **restock to N** before undock | buy + `moveItems` | 🟢 | Composable by the player today (buy + move); a dedicated block is a nicety. |
| sell/update PLEX | `PlacePlexSellOrder` / `ModifyPlexCharOrder` | 🔌 | PLEX-specific; skipped (general sell covers the need). |

### fleet — logistics & support — ✅ SHIPPED 2026-07-24
The fleet-roster read is decoder-only (not wired to api/flow), but it isn't needed:
the space snapshot already carries every ship's owner + health each tick, and players
are FRIENDLY in this world — so "the most-hurt friendly ship on grid" targets fleet-mates
without a roster read.
| Block | Backing | Status | Notes |
|---|---|---|---|
| **remote-rep** (rep the most-hurt friendly) | snapshot filter + `lock` + `activate` | ✅ | Reactive; done when everyone on grid is full. Reps resolved by group name (`/remote shield|armor/i`). |
| **orbit-and-boost** (stay on a mate, keep repping) | `orbit` + remote-rep core | ✅ | Sustained logistics loop; a watch or the player stops it. |
| **remote cap transfer** | `lock` + `activate` | 🟢 | Same pattern with a cap transmitter — a quick follow-up. |
| **create-fleet** (form up, become boss) | `fleet/create` + `bound-fleet` read | ✅ | Argless; done once `inFleet` reads true. |
| **invite-to-fleet** (invite a known pilot) | `fleet/invite` (inviteeCharID) | ✅ | Picks from the local known-pilots roster; requires being in a fleet. |
| **join-fleet** (accept a pending invite) | `fleet/invite/accept` + `bound-fleet` read | ✅ | Reactive — keeps accepting until `inFleet` true (bounded). The multibox alt-fleeting loop: char 1 create+invite, alts join. |
| **warp to a fleet member** | fleet-warp / warp-to-member | ❓ | Deferred — the write is unconfirmed. |
| fleet **broadcast / kick / make-leader** | `boundFleetWrites` | 🔌 | *Educated-guess, never fired live*; low bot value — deprioritised. |

⚠ create/invite/join WRITES are fast-mode decoders never fired live — the `bound-fleet` READ that gates/confirms them IS verified live (FleetNotFound → a real "not in a fleet"). Owed one live QA pass, which the multibox alts make testable.

### combat — module & targeting primitives
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **launch / recall drones** (standalone) | `launchDrones` / `recallDrones` | 🟢 | Exists as an interrupt response; a plain block is trivial. |
| **mining drones on a rock** | drones/mine route | 🔌 | Route exists; widen the drone-engage path to ore. |
| **orbit / keep-at-range a target** | `orbit` | 🟢 | Generic positioning block. |
| **speed module on/off** (AB/MWD) | `activate` / `deactivate` | 🟢 | On while closing, off in orbit / cap-starved. |
| **overheat a rack** | — | ❓ | Only if the heat path is in eve.js. |
| **reload / load a charge** | — | ❓ | Charge-swap write unconfirmed. |

### hauling — cargo & logistics
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **jettison / jetcan** | `decodeJettisonAck` (CmdJettison) | 🔌 | Ack decoder exists; pairs with jetcan-mining. |
| **stack & tidy hangar** | stack-all | 🔌 | Small quality-of-life block. |
| **pickup run** (collect item X across stations → deliver) | travel + `moveItems` | 🛠️ | Multi-stop; composes existing travel + move with a station list. |

### mining — extras
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **mine biggest rocks first** | `decodeSurveyResults` (survey scan) | 🔌 | Survey read exists; feed the rock-picker by volume. |
| **mine across belts / the constellation** | belt rotation + travel | 🛠️ | Rotate belts across systems (deferred in the shipped mine block). |
| **ice / gas variant** | module-group picker widening | 🔌 | Mostly the equipment picker recognising ice/gas harvesters. |

### industry
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **install a manufacturing job** | `decodeJob` / `decodeJobs` writes | 🔌 | Blueprint + materials at station. |
| **deliver finished jobs** | `decodeCompleteManyJobsAck` | 🔌 | Collect completed job output. |
| **build-from-minerals loop** | refine + install + deliver | 🛠️ | Composes the above with refine-ore. |

### ship & fitting
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **board ship by name** | `boardShip` action (exists) | 🟢 | The reship primitive without a full fitting. |
| **insure the ship** | insurance bridge | 🔌 | One-shot docked action. |

### movement
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **dock at the nearest station** | dock (panic already computes nearest) | 🟢 | Promote the safety-floor's own "nearest station" to a block. |

### planets
| Block | Backing | Tag | Notes |
|---|---|---|---|
| **collect PI → haul home** | launchpad / customs-office chain | ❓ | Extractor restart shipped; the *collect + haul* chain needs the pickup write path researched. |

### awareness — new conditions & one response
| Item | Backing | Tag |
|---|---|---|
| conditions: local-count-above-N · targeted-by-a-player · drone-health-low · cargo-full (generic) · missions-completed≥N | reads mostly exist | 🛠️ |
| **alert the player** response (browser notification / sound) | client-only | 🛠️ |

---

## 3. Recommended build order

1. **market: buy-item + restock + wallet watches** — the greenlit transaction
   loop; the one general market write (`BuyMultipleItems`) plus two new condition
   kinds. Ship behind a confirm; flag for one live QA.
2. **fleet: remote-rep + orbit-and-boost** — greenlit and 🟢 (rides verified
   `lock`/`activate`/`orbit`); the real value is the logistics loop. Defer
   fleet-warp (❓) and fleet management (low value).
3. **flow: branch-lite + named board slots** — greenlit control flow; the
   deepest change (touches the forward scan), so it lands after the additive
   blocks prove the pipeline extensions. Sub-bots follow branch-lite.
4. **combat primitives + dock-at-nearest + jettison** — small 🟢 blocks that fill
   obvious gaps and unlock jetcan mining / better ratting safety.
5. **mining survey-picker + industry jobs** — 🔌 blocks gated on one live QA each.

**Do not build without new BFF work:** general sell-orders / update-orders for
arbitrary items (only PLEX is plumbed), overheat, charge reload, PI collect-haul,
fleet-warp.
