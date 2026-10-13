# The fleet companion in a fight — a plan

**Status: PLAN, under discussion with the operator, 2026-10-13. Nothing here is
built.** Written against `main` at `99351204`. Every file:line below was read in
the session that wrote this; re-read before relying on one.

This document is the decision tree a companion walks on every tick once this
work lands, with the existing rungs in their places and the new ones marked
**NEW** or **CHANGED**. Its purpose is the one the operator set: cover every
path, and make sure no path leaves a pilot stuck. Section 6 is the audit of
every wait in the tree against that requirement.

Read `decideCompanionStep` in `web/src/nav/fleetCompanionLoop.ts` (L2315) for
the ladder as it stands today; this document is what it becomes.

## 1. Why: where the damage goes today

A companion's fight today is: hold station 2 km off the fleet commander
(`COMPANION_FOLLOW_RANGE_M`, `web/src/nav/chatCommands.ts:398`), lock what the
fleet calls, activate every weapon on it, send the drones. Three things cost
damage, in this order:

1. **Geometry.** The pilot is positioned by where the FC parks, which has
   nothing to do with its own guns. Every weapon is activated with no range test
   (`decideOpenFire`, L3935; recorded as a known gap in
   `docs/fleet-companion-handoff.md:491`). A gun past optimal plus falloff
   cycles, misses every shot, and spends cap and ammo while the readout says
   "firing".
2. **Signature.** The prop mod lights whenever the ship mode is GOTO or FOLLOW
   (`isUnderWay`, L6315). Keep-at-range is `CmdFollowBall`, which is FOLLOW mode
   and stays FOLLOW while holding station (the server only leaves FOLLOW when
   the followed ship vanishes; §7 item 1), so a MWD companion fights with its
   signature bloomed for the whole fight.
3. **Ammo.** The reload rung loads the largest compatible stack and only when a
   gun reads empty (`pickChargeFor`, L6680). Nothing considers the target.

Drones are in reasonable shape (launch, engage the called target, size switch,
hurt-drone rotation, tracking link on) and are not the subject here.

## 2. What the server simulates, and so what pays

Checked in eve.js (`D:\evet`) and its deployed config, 2026-10-13. A tactic only
earns a rung if the server models it.

| Mechanic | On this server | Where |
| --- | --- | --- |
| Turret hit chance | Full TQ formula: transversal, signature, tracking, optimal, falloff | `server/src/space/combat/laserTurrets.js:125-141` |
| Hit-chance floor | `turretHitChanceAdditive: 0.5` — every in-range shot hits at least 50 %, ours and theirs | `config/gameplay.json:19`, `space/runtime/weaponSnapshot.js:113` |
| Missile application | Full TQ formula on target signature and absolute speed, **no floor** | `space/combat/missiles/missileSolver.js:154-224` |
| MWD signature bloom | Implemented (attribute 554); afterburner does not bloom | `space/runtime/propulsionModule.js:385-390` |
| Damage-type resists | Implemented per layer, so ammo type against the rat's resonances matters | `space/combat/damage.js:168-190` |
| NPC movement | Orbit at a fixed per-profile distance, mostly 5 km, not derived from its guns; chase propulsion only if the profile says so | `space/npc/npcBehaviorLoop.js:3893-4045` |
| NPC targeting | Nearest player (with a bias to the current target), retaliate against the last aggressor; drones only for some profiles, switch at most every 60 s | `npcBehaviorLoop.js:3074-3290`, `:1871-1927` |
| Missile rat | Marked by attribute 507 `entityMissileTypeID` | `space/npc/npcEquipment.js:97` |

Consequences:

- **Transversal and signature against turret rats are capped.** The best the
  companion can do is pull their hit chance from 100 % down to the 50 % floor.
  Worth having, not worth flying badly for.
- **Against missile rats there is no floor.** Speed and a small signature pay in
  full, and a lit MWD is a direct damage multiplier for the rat. Afterburner on,
  MWD off, is the whole of the answer.
- **Our own guns are floored too.** Inside reach we hit at least half the time
  regardless of tracking. Outside reach we hit nothing. Range is therefore the
  variable that matters by far the most for our damage, and tracking second.
- **Rats come to us.** They orbit at their profile distance whatever our guns
  want. A companion that wants more range than the rat's orbit has to be faster
  than the rat to keep it, and gets a bounded attempt, not a chase.
- **Positioning may change who gets shot**, since the server scores the
  nearest player. Recorded as a fact and nothing more: the operator ruled that
  aggro cannot be steered reliably in EVE and the plan does not try (§7, item
  4). The flee floors already cover the pilot that ends up holding more than
  it can.

## 3. Decisions already taken by the operator

- **No damage-type hardener matching.** Real fits are omni-resist or already
  specialised for the rats they hunt; there is nothing to pick at runtime.
  Hardeners stay as they are: all on while a hostile is on grid.
- **Ammo by target, yes, with two conditions.** The pilot may simply not carry
  the right type, and most ammo changes range as well as damage. Range is a
  first-class input, never an afterthought.
- **No flicker.** A reload is seconds of zero damage per gun, so a rat drifting
  across a range edge (x, x+1, x) must never toggle ammo. Less damage applied
  beats none applied.
- **Closing in beats reloading** whenever the ship can move.
- **Positioning is a MODE the commander switches on, not the default.**
  (Operator, 2026-10-13.) Today's behaviour — the FC leads the flight and the
  companion holds station — stays the default; the companion flying itself into
  range is a second flight mode, set by a chat command exactly as `targets
  called|all` sets the target mode. The FC decides when formation may break: a
  fleet moving through gates, camping one, or one whose FC wants the aggro,
  stays in the follow mode. See 5.4 and §7 for the verb.
- **Plan first.** No implementation until this document is agreed.

## 4. Inputs the tree needs each tick

What the ladder reads, and whether it already has it. "Dogma route" is
`POST /api/types/dogma`, the static read the companion already uses for threat
and signature (`web/src/nav/ratThreat.ts:77`, `flow.ts` ~L10555); it needs no
live session and is bounded at 500 types × 32 attributes per call.

| Input | Status | Source |
| --- | --- | --- |
| Per-weapon reach and tracking, with the loaded charge | exists | `combatFit`, `web/src/nav/combatFit.ts:16-42`; `obs.combatWeapons` |
| Lock range, drone control range | exists | `obs.maxTargetRangeM`, `obs.droneControlRangeM` |
| Prop module kind (AB vs MWD) | exists | `request.propulsionModules[].kind` |
| Rat threat: scram, scram range, web, ECM | exists | `obs.threatByTypeID` |
| Rat signature and hit points by type | exists | `obs.signatureByTypeID`, `obs.hitPointsByTypeID` |
| Rat position, velocity, max velocity, health ratios | exists | `SpaceEntity` (`web/src/store/types.ts:1705-1822`) |
| Who has this ship locked | exists | `obs.lockedByIDs` |
| **Rat weapon kind: missile (507 present) or turret** | NEW | dogma route, attribute 507 |
| **Rat turret optimal / falloff / tracking (54, 158, 160)** | NEW, confirmed present (§7 item 2) | dogma route |
| **Rat orbit distance and speed (416, 508, 37)** | NEW, confirmed present (§7 item 2) | dogma route; the server's per-profile orbit is the true answer, the attributes are the approximation we can read |
| **Rat resonances (shield 271-274, armour 267-270, hull 109-113)** | NEW | dogma route |
| **Own signature radius and max velocity** | NEW | bound dogma (552, 37), same read `combatFit` makes |
| **Per charge aboard: damage split (114/116/117/118) and the reach it would give the gun** | NEW | dogma route for the charge type; turret reach via `weaponRangeMultiplier` (120) and falloff mult, missile reach via charge velocity × flight time (37 × 281) |
| Current target of each rat | absent, not on the wire | — ; "it is shooting me" is inferred from `lockedByIDs` and our own health trend |

## 5. The tree

One tick is one walk from the root. Nodes are **selector** (first child that
acts wins) unless marked **sequence**. A leaf ends the tick in one of three
ways: **ACT** (one atomic call), **WAIT** (no call, with a named bound), or
**FALL THROUGH** (the next sibling decides). Existing rungs keep their numbers
from `decideCompanionStep`.

```
TICK
├─ R0  Capsule?                       → decideShipLost (existing)
├─ R1  In warp?                       → WAIT until landed (existing)
├─     Bookkeeping: standing chat orders, area job, stop (existing, no call)
├─ R2  Supervision                    → abandonment protocol when unsupervised (existing)
├─ R3  Tank up                        → hardeners on, layer repairers (existing, unchanged)
├─ R3b Propulsion                     → CHANGED, see 5.1
├─ R4  Tackled → tag / call out       (existing)
├─ R5  Flee                           (existing; two floors)
├─ R5b Leave the station              (existing)
├─ R6  Drones                         (existing; takes the band from 5.4 as its ceiling)
├─     Stop order's one call          (existing)
├─     Destination trip               (existing)
├─ R6b Ammo                           → CHANGED, see 5.2
├─ R7  Fleet orders                   → target selection existing; lockThenEngage CHANGED, see 5.3
├─ R7b Lock-ahead                     (existing)
├─ R8  Combat positioning             → NEW, see 5.4
├─ R8b Salvage / loot                 (existing; may not move while R7 or R8 holds navigation)
├─     Standing-order readout         (existing)
├─ R9  Follow the FC                  → CHANGED, see 5.5
└─     Dry-guns readout / Standing by (existing)
```

The three things that must be true of the ordering, and are:

- Everything that keeps the pilot alive (R2–R5) is above everything that
  makes it shoot (R6b–R8), so a dying pilot leaves before it repositions.
- Everything a human ordered (R7's align, travel, warp) is above the pilot's
  own positioning (R8), so an order is never fought by the autopilot.
- Everything that moves the ship on its own (R8, R8b, R9) is at the bottom, and
  R8 is the only one of them that may move while a target call stands.

### 5.1 R3b Propulsion (CHANGED)

The question this rung answers stays "do I want to burn now?"; what changes is
who answers it. Today: `propsHeld ?? isUnderWay(obs)`. After:

```
wantBurn =
  propsHeld !== null          → propsHeld              (chat `props on` / `props off` wins)
  else R8 says "closing a gap" → true, module by kind  (see below)
  else travelling, not in a fight (GOTO, or FOLLOW with no hostile on grid
       and no engaged target)  → true
  else                         → false                 (holding station, in the band, orbiting)
```

Module by kind while hostiles are on grid:

| Rats on grid shoot with | AB | MWD |
| --- | --- | --- |
| turrets only | yes while closing | no (bloom halves nothing, costs cap, sig) |
| any missile rat (507) | yes while closing **and** while orbiting at range | never |
| unreadable (dogma did not arrive) | yes while closing | no |
| no hostiles | existing travel rule | existing travel rule |

Everything downstream of the question (scram, unknown kind, cap floor, which
module, one call then fall through) stays in `nav/propulsion.ts` unchanged.

**Why FOLLOW no longer means burn.** A companion keeping station on the FC is in
FOLLOW mode for the whole fight. Reading that as travelling is the bug §1 names.
The travel rule keeps FOLLOW only when nothing hostile is on grid, which is the
"keeping up with an FC pulling away" case the rung was written for.

### 5.2 R6b Ammo (CHANGED; was Reload)

```
Ammo (sequence per gun, one call per tick, banked guns as one)
├─ gun empty?
│   ├─ ranked charge aboard   → ACT load it            (existing path, new ranking)
│   └─ nothing compatible     → existing guess rule, 3 attempts, then dry-guns readout
└─ gun loaded, target engaged?
    ├─ swap not earned        → FALL THROUGH
    └─ swap earned            → ACT reload ranked charge, stamp cooldown
```

**Ranking a charge** for a gun against the engaged target:

1. **Reach first.** Charges that keep the target inside the gun's reach *with
   hysteresis* outrank every charge that does not. A charge whose reach puts
   the target within `RANGE_HYSTERESIS_M` (2 km, `kiteBand.ts:127`) of the edge
   counts as out of reach for the purpose of swapping INTO it, and as in reach
   for the purpose of staying ON it.
2. **Then damage through resists.** Among in-reach charges, the one whose
   damage split applied to the target's resonances for the layer currently
   being hit is highest. The layer is the first of shield / armour / hull whose
   ratio is below 1.
3. **Then the largest stack**, ties on the lower item id (existing rule).

**A swap is earned** only when all of the following hold:

- the ranked charge has differed from the loaded one for `AMMO_SWAP_PERSIST_TICKS`
  consecutive ticks (proposal: 5 ticks ≈ 10 s);
- no swap has happened on this gun within `AMMO_SWAP_COOLDOWN_MS` (proposal:
  60 s), and at most one swap per target;
- the loaded charge is NOT applying (target outside its reach by more than the
  hysteresis), OR the gain through resists exceeds `AMMO_SWAP_MIN_GAIN`
  (proposal: 25 %) and the target's remaining hit points exceed what the gun
  would deal during the reload's silence;
- R8 cannot close the gap instead (the ship is leashed, slower than the rat, or
  its closing budget is spent). **Closing beats reloading.**

**The preferred swap moment** is the lock-ahead tick: when R7b has the next
target pre-locked and the current one is nearly dead, the ranking is run against
the NEXT target, so the gun comes up already loaded for it. Mid-target swaps are
the exception, gated as above.

**Missiles follow the same rule**, with reach = charge velocity × flight time.

**Readout.** "Only Antimatter aboard" / "Loading Thermal for the Guristas
cruiser" / "Keeping Antimatter: it still reaches". The operator must be able to
tell the three apart.

### 5.3 R7 Fleet orders → lockThenEngage (CHANGED)

Target selection is unchanged: tag, then Target broadcast or chat, then free
fire by the kill order. What changes is firing:

```
lockThenEngage(target)
├─ not locked
│   ├─ lock pending < 10 s    → WAIT (standing)                      (existing)
│   └─ else                   → ACT lock                             (existing)
└─ locked
    ├─ a weapon in reach of it not yet firing at it → ACT activate   (CHANGED: in reach only)
    ├─ a weapon firing at it that is now out of reach by > hysteresis → ACT deactivate it
    └─ else → WAIT (standing), engagedTargetID set; readout "N of M guns in reach"
```

"In reach" is `distance ≤ reachM(weapon, loaded charge)` from `combatFit`,
surface-to-surface as the server measures it. A weapon with unreadable reach
fires as it does today — the gate fails open, because a gun that might hit beats
a gun that certainly does not.

The standing decision carries `engagedTargetID` down to R7b and R8, as it does
today for R7b. A pilot whose guns are ALL out of reach is still "engaged": R8 is
what fixes that, and if R8 cannot, the drones still fight and the readout says
why the guns are silent.

### 5.4 R8 Combat positioning (NEW)

The rung that turns "shoot the called target" into "be where the called target
can be shot". It issues at most one movement order and re-issues only when the
answer moves by more than the hysteresis.

**The flight mode gates the whole rung.** `flightMode` is a standing chat order
beside `targetMode` and `propsHeld` in the ladder memory: `follow` (default;
the FC leads, this rung never acts) or `auto` (this rung positions the ship).
Set by chat, carried across supervisor changes like the other standing orders,
and reset to `follow` on a resumed run for the reason `followRangeM` is (the
line that set it is long out of the chat window, L8990). The range gate (5.3)
and the ammo rung (5.2) apply in BOTH modes; what differs in `follow` is that
"closing beats reloading" has no closing to offer, so a longer charge is the
only lever and the readout says "at formation, N of M guns reach".

```
Position (sequence)
├─ flightMode !== "auto"?                         → FALL THROUGH (the FC leads; R9 holds station)
├─ no engagedTargetID from R7?                    → FALL THROUGH (nothing to position for)
├─ R7 holds navigation (align / travel / warp order standing)? → FALL THROUGH
├─ not in space, in warp, snapshot unreadable?    → FALL THROUGH
├─ compute the WANTED HOLD (below)
├─ hold unreachable and closing budget spent?     → WAIT (standing): "cannot get there", guns that reach fire
├─ current order already holds this anchor at a range within hysteresis? → WAIT (standing): "in position"
└─ else                                           → ACT orbit / keepAtRange / approach, stamp it
```

**The wanted hold**, by what the ship fights with. A hull is a *gun boat* if
`combatWeapons` is non-empty, else a *drone boat* if it carries combat drones,
else it has nothing to position for and falls through (a logi orbits whoever
it is repairing under the existing Heal rung and holds station otherwise).

```
floorM   = largest scram reach among rats on grid that scram + THREAT_BUFFER_M   (kiteBand; 0 when none scram)
leashM   = distance from the FC's ship this pilot may stray while fighting      (§7, default below)
ceilingM = min(longest weapon or drone reach, lock range, leashM) - LEASH_BUFFER_M

gun boat   : wantM = optimal of the SHORTEST gun that can reach at all, clamped into [floorM, ceilingM]
             order = ORBIT target at wantM            (transversal against turret rats; speed against missile rats)
drone boat : wantM = kiteBand(...).holdM              (existing arithmetic; floor, else ceiling when nothing scrams)
             order = KEEP AT RANGE target at wantM    (drones do the flying; no transversal needed)
empty band : floorM > ceilingM → hold at ceilingM, say so (existing kiteBand behaviour: "no room to kite, fighting at X")
```

**The leash.** The FC must stay reachable: a companion that wanders 60 km from
its commander is not a companion. Proposal: `leashM` defaults to the pilot's own
lock range, and chat `leash N km` overrides it (same shape as `follow N km`).
When the target is further from the FC than the leash allows, the wanted hold is
the point on the FC–target line at the leash edge, held as KEEP AT RANGE on the
**FC** at `leashM`; whatever guns reach from there fire, and the readout says
"at the leash, N of M guns reach". ⚠ Open: §7.

**Can the hold be held?** Rats orbit at their profile distance and some are
faster than us. If the rat's max velocity (attribute 37) exceeds ours and its
orbit (416, or observed distance) is inside `wantM`, the hold is unreachable:
accept the rat's distance as the hold (`wantM = max(observed distance, floorM)`)
so the short guns fire, and let R6b consider a shorter charge. A hold that is
reachable but not yet reached gets a **closing budget** of `MAX_CLOSE_TICKS`
(60 ticks ≈ 2 min, `droneBoatLadder.ts:147`); when spent, the current distance
becomes the hold and the readout says so. The budget resets on a new target.

**Re-issue rule.** The order is re-sent only when the anchor changes, or
`|currentHoldM − wantM| > RANGE_HYSTERESIS_M`, or the server reports the order
refused (bounded by the existing 3-refusal / backoff shape every other order
uses). Every re-aim stops the ship and turns it, so a wobble must not re-aim.

**Who to anchor on.** The engaged target, always. The band is one rock in a
field of them (kiteBand's own warning); holding 20 km off the primary says
nothing about the scrammer behind us. That approximation is the one a human
makes and is accepted here. The sticky-anchor rule of the drone-boat ladder
(keep the held anchor unless the band now names a scrammer and the held one is
not) is reused unchanged.

**What this changes for the pilot's position after the fight:** see 5.5.

### 5.5 R9 Follow the FC (CHANGED)

Unchanged rule: when nothing above acted and a commander is on grid, keep at
`followRangeM` on them. Two changes:

- **R8's orders clear the follow latch.** `followAnchorID` /
  `followRangeIssuedM` say "already holding this station, nothing to send"
  (L6974). The clearing already exists and is in the right place: the wrapper
  `decideCompanionAction` (L2271-2290) drops the latch on every action in
  `changesShipMovement` (approach, align, warp, dock, loot and salvage moves all
  go through it today) — **except `keepAtRange`**, which it exempts because that
  action IS the follow. R8 breaks that exemption: a keep-at-range on a RAT would
  be kept as if it were the formation order, R9 would read the untouched FC
  anchor as "already holding", and the pilot would sit where the fight ended,
  reporting "Following: holding station", for the rest of the run. Two changes,
  both in the wrapper and neither in R8 or R9:
  1. the `keepAtRange` exemption applies only when its `targetID` is the FC
     anchor R9 issued (`memory.followAnchorID`); any other keep-at-range clears
     the latch like every other move;
  2. `orbit` does not exist in the action vocabulary (L924-1000) and must be
     added, to the vocabulary, to the BFF issue switch, and to
     `changesShipMovement`, or it would slip past the wrapper the same way.
  With both, the first quiet tick after a fight re-issues the formation order
  and the pilot comes home. The operator confirmed this must be fixed
  (2026-10-13).
- **Follow is not a burn.** See 5.1; the FOLLOW mode it produces no longer
  lights the prop mod on its own while hostiles are on grid.

## 6. The stuck-path audit

Every WAIT in the tree, what bounds it, and how the pilot leaves it. A wait with
no bound is a bug in this plan.

| Where | Waiting for | Bound | Exit |
| --- | --- | --- | --- |
| R1 in warp | the server to land the warp | the server; `landing-plan-stale` is a known server fault (re-log clears) | `inWarp` false |
| R2 supervision unreadable | the roster read | run deadline (`maxRuntimeMinutes`) | roster readable |
| R7 lock pending | the lock timer | `LOCK_LANDING_WAIT_MS` 10 s, then `MAX_REFUSED_LOCK_ATTEMPTS` 3, then give-up on that ship | locked, or `lockGaveUpOn` and R7 falls through |
| R7 standing, all guns out of reach | R8 to move the ship | R8's own bounds below; drones fight meanwhile | a gun comes into reach, or target dies |
| R8 closing | the ship to reach the hold | `MAX_CLOSE_TICKS` 60, then current distance becomes the hold | in position, or budget spent (readout) |
| R8 hold unreachable (rat faster, inside) | nothing | none needed: the hold is redefined to the rat's distance the same tick | immediate |
| R8 at the leash | the FC to move or the target to come closer | none needed: guns that reach fire; it is a position, not a wait | target in reach, or fight ends |
| R8 empty band | nothing | holds at the ceiling, says so | immediate |
| R8 order refused | the server | 3 refusals then `COMPANION_RETRY_BACKOFF_TICKS` (existing shape) | accepted, or retried after backoff |
| R8 order uncertain (no answer) | the resend wait | `COMPANION_RESEND_WAIT_TICKS` 2 | re-sent |
| R6b swap not earned | persistence / cooldown | by construction; the loaded charge keeps firing meanwhile | ranking stable for N ticks and cooldown over |
| R6b nothing compatible | nothing | 3 guesses then the dry-guns readout; drones and other guns unaffected | operator loads ammo |
| R3b held back by cap floor | capacitor | the cap recharges; the floor gates lighting only, never stopping | ratio above floor |
| R9 follow refused / uncertain | the server | existing 3 refusals / backoff / 30 session deferrals | re-issued |
| R9 FC not on grid | a commander to arrive | none: falls through to "Standing by", which is the honest readout | FC lands |
| R5 flee, scrammed | the scrammer to die or the pilot to break tackle | R4 letters / broadcasts the scrammer; `COMPANION_ESCAPE_RETRY_BACKOFF_TICKS`; the second floor warps regardless of drones | warp accepted |

Paths that were stuck BEFORE this plan and are fixed by it:

- Guns cycling for ever on a target they cannot reach (fixed by 5.3 + 5.4).
- A pilot left where the fight ended because the follow latch still said
  "holding station" (fixed by 5.5). Not a bug today: every current mover goes
  through `changesShipMovement` and clears the latch. It becomes one the moment
  R8 issues a keep-at-range or an orbit on a rat, so it is a precondition of
  R8's branch, with a test that a keep-at-range on a non-FC target clears the
  latch.

Paths this plan deliberately does NOT add:

- No chase. A rat that out-runs the companion is fought from where the
  companion can be, with the drones and whatever guns reach.
- No second anchor. One rock in the field.
- No ammo swap to fix a rat that moves 500 m. Hysteresis + persistence +
  cooldown + "closing beats reloading".

## 7. Open before design, and the live checks

1. ~~**Does `ship.mode` read FOLLOW while holding station on the FC?**~~
   **SETTLED BY CODE 2026-10-13: yes, for the whole fight.** The question was
   whether the server ever drops a following ship back to STOP once it is at
   range, which would have made §1 item 2 a non-issue. It does not:
   `advanceFollowMovement` (`D:\evet\server\src\space\destiny\simulation\movement.js:1022`)
   leaves FOLLOW only when the followed entity vanishes, and the three other
   STOP transitions in that file are the orbit, the warp and the missile. The
   BFF names the mode from the same ball (`src/gamePort/spaceProjection.js:207`).
   So a companion keeping station is FOLLOW from the order to the end of the
   fight, `isUnderWay` reads it as travelling, and the prop mod stays lit. No
   live sighting needed; 5.1 stands as written.
2. ~~**Do rat types carry the weapon, speed, orbit and resist attributes?**~~
   **SETTLED 2026-10-13 inside the running BFF container**, through the same
   `readTypeAttributes` the dogma route serves. Every rat type probed (Sansha
   and Blood Raider frigates to battleships) carries 54/158/160, 37, 247, 416,
   508, 552, the three HP attributes and all twelve resonances; the missile rat
   among them carries 507 and the turret rats do not. The host probe failed only
   because the static tables live in the image. §4's "to confirm" rows are
   confirmed.
3. ~~**The leash default.**~~ **DECIDED 2026-10-13: the pilot's lock range,
   as the ship and its skills give it, read once and cached.** That is already
   how the companion holds it: `readCompanionFitFacts` (`flow.ts:9730`) reads
   `fit.stats.targeting.maxTargetRange` off the fit at START, with skills
   applied server-side, into `companionTargeting`, and every tick reads the
   cached value as `obs.maxTargetRangeM`. The leash reuses that field and adds
   no read. Unreadable (a fit that said nothing) means no leash, the same
   "unreadable is no gate" reading free fire gives it.
4. ~~**Aggro doctrine.**~~ **DROPPED 2026-10-13.** The operator's words: there
   is no such thing as pulling aggro in EVE, or not reliably, and it cannot
   work while the FC warps to the site with or ahead of the fleet. §2's note on
   nearest-player targeting stays as a server fact; nothing in the tree is
   built on it.
5. **Orbit vs keep-at-range for gun boats under the 50 % floor.** Orbit buys
   transversal worth at most half the incoming turret damage and costs some of
   our own tracking. Keep-at-range is simpler and loses that half. Proposal is
   orbit; a live comparison on the same site decides.
6. **Hysteresis and persistence numbers** in 5.2 and 5.4 are proposals.
7. ~~**The flight-mode verb.**~~ **DECIDED 2026-10-13: `flight follow` /
   `flight auto`**, mirroring `targets called` / `targets all` (a mode, not an
   order; `chatCommands.ts:180`). It collides with none of the existing verbs
   (`align destination follow jump loot props salvage stop target targets travel
   warp`); `follow` alone stays `follow N km`.
8. **What `auto` does with no target.** Proposal: nothing — R8 falls through
   and R9 holds station as today, so `auto` only ever differs while a target
   is engaged, and the pilot is always back in formation between fights.

## 8. Delivery

One patch branch off `vendor` per item, each with its own live sighting before a
PR, in this order (each later item depends on an earlier one's symbols):

| # | Branch | Contents | Depends on |
| --- | --- | --- | --- |
| 1 | `fix/companion-props-not-while-holding-station` | 5.1 travel rule (FOLLOW with hostiles on grid is not travelling); no new data | — |
| 2 | `feat/companion-fight-in-reach` | 5.3 range gate + deactivate out-of-reach guns; 5.4 R8 with the leash behind the `flight` mode verb; `orbit` action; 5.5 latch clear; new dogma fetch for 507/37/416/508 | 1 |
| 3 | `feat/companion-prop-by-rat-weapon` | 5.1 module-by-kind table (AB vs missile rats) | 2 (needs 507) |
| 4 | `feat/companion-ammo-by-target` | 5.2 ranking + earned swaps; resonances and charge dogma fetch | 2 (reach arithmetic) |
| 5 | `feat/companion-utilities` | web / painter / tracking computer on the engaged target via `combatUtilities.ts` | 2 |

Items 2 and 4 share the "would this charge keep the target in reach" arithmetic;
the symbol lives in item 2 and item 4 imports it, which is why 4 follows 2
rather than being folded into it (two PRs upstream can review separately; one
would be too large).

Gates per branch, as for every companion patch: `tsc`, the web-build image, the
file's own tests, then a live fight with the flight recorder on. The PR body
says what was exercised live and shows the recorder's evidence.
