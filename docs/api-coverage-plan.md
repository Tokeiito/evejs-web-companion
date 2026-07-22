# API coverage plan — retail client calls we can pre-wire

**Source:** a read-only cross-reference of the decompiled retail client (`eve.js/tools/ClientCodeGrabber/Latest`) against our gateway allowlist (`evejsWebGatewayRuntime.js`), our BFF routes (`src/server.js`), and eve.js's own service handlers (`eve.js/server/src/services/`). Produced 2026-07-21 at the operator's direction to "set up ALL calls even before we show them, to get a head start."

**Reading key per pair:** allowlist? · eve.js handler? · BFF/bridge wired? · **top-level** (plain `/call`) vs **bound** (`MachoBindObject` two-step).

**The gating fact is the eve.js handler.** A retail call is only wireable if eve.js implements it. Coverage turned out unusually broad — nearly every high-value cluster is implemented server-side; the gap is almost entirely our allowlist + BFF + decoders.

## Corp wallet (answered for R50)

- **`account.GetWalletDivisionsInfo`** — top-level, handler `accountService.js:593`, returns clean `list<KeyVal{key, balance}>` (no Rowset). **Not allowlisted.** This is the corp-wallet read. Verified by the orchestrator.
- Ledger: `account.GetTransactions` (`:666`), `account.GetJournal` (`:636`) — both have corp branches keyed on `args[3]`. Journal is a **Rowset** with big `refID`/`amount` → bare-string-bigint hazard.
- ⚠ `account` corp-vs-personal is **arg-position-driven**, not method-driven — misordering silently reads the personal wallet. And corp balance **data seeding is unverified** — an empty result may be legitimately empty, not a bug.

## Tier A — implemented AND backs a feature we already partly have (cheapest, highest value)

1. **Personal wallet page** — `account.GetCashBalance` (✅ allowlisted, already read in market/rewards composites) + add `GetTransactions`, `GetJournal`, `GetEntryTypes`/`GetKeyMap` (to label journal ref-types). Promote the balance read to a real `/api/bridge/wallet`.
2. **Standings page** — `standingMgr.GetCharStandings` (✅ allowlisted, `rewards.ts` already decodes the shape) + add `GetStandingCompositions`, `GetStandingTransactions`, `GetCorpStandings`.
3. **LP store / balances** — `LPSvc.GetAllMyCharacterWalletLPBalances` (✅ allowlisted) + add `GetLPExchangeRates`, `GetAvailableOffersFromCorp`, `TakeOffer` (write → confirm-gate).

## Tier B — the head-start batch (implemented; no UI yet; safe to pre-wire allowlist + BFF + decoder)

4. **Corp wallet** — `account.GetWalletDivisionsInfo` (+ corp branch of `GetTransactions`/`GetJournal`). Top-level. *(R50 does the division-balances tab.)*
5. **Character sheet** — `charMgr.GetCharacterDescription`, `GetPublicInfo3`, `GetPrivateInfo`, `GetHomeStation`, `GetCloneInfo`, `GetRecentShipKillsAndLosses` — all top-level; bind path already proven by `personalAssets.ts`.
6. **Jump clones** — `jumpCloneSvc.MachoBindObject` + `GetCloneState` (+ `GetShipCloneState`/`GetStationCloneState`, `GetPriceForClone`, `ValidateInstallJumpClone`). **BOUND**, Moniker over station/structure/system. `GetCloneState` returns `KeyVal(clones=Rowset, implants=Rowset, timeLastJump)` — bound + Rowset in one call. Writes (`CloneJump`, `InstallCloneInStation`, `DestroyInstalledClone`, `SetJumpCloneName`) behind a `confirm:true` gate like `TrashItems`.
7. **Saved fitting library** — `charFittingMgr.GetFittings` (+ `SaveFitting`/`UpdateFitting`/`DeleteFitting`). Top-level. Distinct from our current `/api/bridge/fitting`, which is the *active-ship* fit. ⚠ `charFittingMgr` / `corpFittingMgr` / `allianceFittingMgr` are three distinct services — don't cross them.
8. **Kill rights + security status** — `bountyProxy.GetMyKillRights` (top-level) and `crimewatch.GetMySecurityStatus` (**BOUND**). Same char-sheet panel, two binding models.
9. **Corp overview** — `corpRegistry.GetMembersPaged`, `GetMemberTrackingInfo`, `GetTitles`, `GetShareholders`, `GetBulletins` (**BOUND**, Moniker(corpID); `GetCorporation` already allowlisted).

Lower-priority-but-implemented, unwired: fleet (`fleetMgr`/`fleetProxy`), sovereignty (`sovMgr`), certificates (`certificateMgr`), insurance (`insuranceSvc`), wars (`warsInfoMgr`), ESS (`essMgr`).

## Tier C — retail calls it, eve.js does NOT implement (server work; out of our scope)

No high-value cluster was found entirely unimplemented — coverage is broad. Confirmed absences are all deliberate allowlist siblings (`entity.CmdAssist`/`CmdGuard`/`CmdUnanchor`). **The long tail was not sampled** — `structureAssetSafety`, `moonExtractions`, `pvpFilamentMgr`, `abyssalMgr`, etc. need their own pass before anyone trusts "eve.js implements everything."

## Traps (this codebase's recurring wire hazards, per cluster)

- **Bound vs top-level** is per-service and sometimes per-panel: `jumpCloneSvc`, `crimewatch`, `corpRegistry` are bound; `bountyProxy`, `account`, `standingMgr`, `charFittingMgr` are top-level.
- **Rowset / bare-string-bigint:** `account.GetJournal`, `jumpCloneSvc.GetCloneState` — use `readRowField` (R32) and the bigint-tolerant decode (R32 found FILETIMEs arrive as bare decimal strings).
- **Service-name near-misses:** `standingMgr` vs `standing2`; the three `*FittingMgr` services; `charMgr` (top-level reads) vs its bound assets sub-object.
- **Arg-position corp/personal branching** on `account.*` — silent wrong-wallet reads.
- **Data seeding** unverified for corp wallet, corp members, etc. — render legitimately-empty honestly (the `worldHasNoContracts` pattern), never as an error.

## How to consume this

Each Tier A/B item is a self-contained goal: add the allowlist pair(s) with a justification comment (restart EveJS after), a BFF passthrough route, a bridge decoder built from **real captured bytes**, and — only when we choose — a panel. Wiring the call without UI is explicitly wanted. Keep each batch small and verify the wire shape live before trusting the decoder.
