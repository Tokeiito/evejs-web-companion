# Latest parity review — 2026-07-27

## Verdict

The old “588/588 full parity” statement was too broad. That sweep was complete
against its curated 588-pair inventory, but the inventory itself did not fully
cover `eve.js/tools/ClientCodeGrabber/Latest`.

The checked cross-repo contract currently pins 716 EveJS web-gateway pairs and
351 classified writes. Generic `/api/bridge/call` is read-only; every write must
have a purpose-built BFF route. This is strong coverage, not proof of complete
Latest parity.

## Known Latest-used, EveJS-handled fleet delta

The Fleet Center audit found these calls absent from the web gateway/BFF surface.
They are staged follow-up work, not silently represented as available:

### `fleetObjectHandler` bound methods (15)

1. `GetFleetID()`
2. `ChangeWingName(wingID, name)`
3. `ChangeSquadName(squadID, name)`
4. `SetTakesFleetWarp(value)`
5. `SetAcceptsConduitJumpsValue(value)`
6. `SetAcceptsRegroupValue(value)`
7. `MassMoveMembers(charIDs, wingID, squadID, role)`
8. `DeleteWing(wingID)`
9. `DeleteSquad(squadID)`
10. `SetAutoJoinSquadID(squadID)`
11. `RejectJoinRequest(charID)`
12. `FinishMove()`
13. `GetFleetMaxSize()`
14. `LoadFleetSetup(setupName)`
15. `SetFleetMaxSize(qty)`

### `fleetProxy` methods (2)

1. `UpdateFleetAdvertWithNewLeader(allowedEntitiesInfo)`
2. `UpdateAdvertAllowedEntities(allowedInfoFromStandings)`

Source: `ClientCodeGrabber/Latest/eve/client/script/parklife/fleetSvc.py`.

## Correctness gaps closed in this pass

- Fleet own-membership reads now rebind on every refresh. Create, accept,
  reject, reconnect, leave, disband, and uncertain failures invalidate cached
  fleet handles, preventing both a stale `FleetNotFound` and an old-roster read
  after leaving.
- `RejectInvite` binds the invitation's fleet ID and preserves omitted versus
  explicit `alreadyInFleet`; `Reconnect` binds the saved fleet ID. Both runtime
  checks remain authoritative.
- All 59 exported write-ack decoders now decode the actual plain Express JSON
  envelope; older KeyVal-shaped fixtures had hidden this defect. Genuinely
  marshaled nested results remain strict wire values.
- Dedicated routes now cover `dogmaIM.LoadAmmo`, `dogmaIM.UnloadAmmo`,
  `ship.ScoopDrone`, and
  `structureJumpBridgeMgr.CmdJumpThroughStructureStargate`. Concrete ship and
  inventory locations are server-pinned; the structure destination is resolved
  server-side.
- Session-changing routes separate the 10-second next-mutation cooldown from
  readiness. Dock, undock, gate/structure/fleet jumps, clone jump, and hull swaps
  issue once and wait for authoritative location + scene/ego/ship postconditions.
  Other bridge POST actions are blocked until readiness; ordinary commands are
  allowed as soon as readiness is observed even if the cooldown remains.
  Uncertain timeouts stay latched and cannot repeat the write.
- Clone jump now mirrors retail: a normal hull is left first, the capsule swap is
  observed, the session timer is honored, and CloneJump is then issued once.
  EveJS itself rejects a direct CloneJump unless the active ship is a capsule.
- Fleet notifications invalidate and coalesce into a non-overlapping full roster
  reread. Scanner responses are system-scoped, so an old-system response cannot
  repaint the UI after a jump.
- Bot launch policy includes interrupt actions. Combat interrupts do not
  auto-resume after a process restart, and fleet logistics only targets character
  IDs from the authoritative fleet roster; strangers on grid are never inferred
  to be fleet-mates.

## High-value product work completed

- Activity Center: unread mail, notifications, calendar, and live event tail.
- Fleet Center: named roster/hierarchy/MOTD/join requests plus confirmed
  form/invite/accept/leave flows with mandatory rereads.
- Scanner / Exploration Center: named current-system sites, honest
  empty/unavailable distinction, formation-reference state, and probe reconnect.
  Launch/recover/analyze remain disabled until exact launcher IDs, owned probe
  IDs, and probe geometry exist in authoritative client state.
- Bot Builder: append-only operational block groups and complete presets for
  safe return, mining/hauling, anomaly cleanup, fleet logistics, and
  dock/refit/repair. The current catalog has 43 executable macros, five reusable
  multi-block groups, and nine starter bot recipes.

## Rule for the next feature

Audit that feature's exact Latest call sequence through four separate layers:
Latest call site → EveJS handler → web-gateway allowlist → dedicated BFF/API
route. A match at any one layer is not full wiring.
