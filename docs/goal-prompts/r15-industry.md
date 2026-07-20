# Goal R15: Industry — blueprints, jobs, facilities

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests).

EveJS implements industry for real — `server/src/services/industry/` is ~7,200 lines across four registered services, and `industryManager` genuinely **installs** jobs (consuming materials, charging the wallet, locking/moving the blueprint), **delivers** products, and **cancels**. None of it is stubbed. And the whole retail surface is **top-level calls** — no bound-object work at all, so `POST /api/bridge/call` on the held session already carries it.

## The call surface (verified — build on this)

All `sm.RemoteSvc(...)`, top-level, **no bind step**. **Zero industry pairs are currently allowlisted** — every one you use needs adding.

**`blueprintManager`** — `blueprintSvc.py`
- `GetBlueprintDataByOwner(ownerID, facilityID|None)` → `[list<blueprintInstance>, dict<facilityID→count>]` — **the blueprint-list call; it carries ME/TE/runs directly**
- `GetBlueprintData(blueprintID)` — one blueprint by itemID
- `GetLimits()` → `{maxBlueprintResults: 500}`

**`industryManager`** — `industrySvc.py`
- `GetJobsByOwner(ownerID, includeCompleted)` — `ownerID` is `session.charid` (personal) or `session.corpid` (corp)
- `GetJob(jobID)`, `GetJobCounts(charID)` → `{activityID: usedSlots}`
- `InstallJob(<job dict>)` — **one positional dict**, the shape of `industry.Job.dump()` (`industry/job.py:624-640`)
- `CompleteJob(jobID, solarSystemID)` — this is **delivery**
- `CompleteManyJobs([(jobID, solarSystemID), …])`, `CancelJob(jobID, solarSystemID)`

**`industryMonitor`** — `ConnectJob(<job dict>)` → `(monitorID, availableMaterials)`; `DisconnectJob(monitorID)`

**`facilityManager`** — `facilitySvc.py`
- `GetFacilities()` (region-scoped), `GetFacility(facilityID)`, `GetFacilitiesByID([ids])`
- `GetMaxActivityModifiers()`, `GetFacilityTaxes(facilityID, corpID)`
- `GetFacilityLocations(facilityID, ownerID)` → the input/output hangar choices
- ⚠ **`SetFacilityTaxes` — do NOT allowlist.** It is a corp-admin mutator, out of scope.

**Head start already in the web repo:** `src/staticData.js` exposes `getIndustryBlueprint()` and `getNpcIndustryFacility()`, backed by **5,081 blueprint definitions** with full `activities.{manufacturing, copying, invention, research_material, research_time}` material/time data. Use static data for definitions and names; use the live calls for *the player's* blueprints, jobs, and facility state. Reuse the `requireHeldBridgeSession` + `Promise.allSettled` multi-read pattern from `/api/bridge/inventory`, the `wire.ts` long/packedrow decoders, and the `AppFlow` panel-loader convention.

## Objective — land in two commits

**Slice A (read) — commit this first, green:**
1. Allowlist the read pairs; deny-by-default intact, with a test proving non-allowlisted industry siblings (incl. **`SetFacilityTaxes`**) are refused.
2. BFF reads for: the character's **blueprints** (with ME / TE / runs), their **jobs** (active and completed), **job counts/slots**, and the **facilities** available with their activity modifiers.
3. An **Industry** panel showing blueprints, active jobs (with what they're producing and when they finish), and facilities — everything **by name**.

**Slice B (mutate) — commit second:**
4. Allowlist + BFF routes + UI for **Install job**, **Deliver** (`CompleteJob`), and **Cancel**. Installing **consumes materials and charges the wallet** — gate it behind an explicit `confirm: true` at the BFF plus a two-step UI, exactly like R12's rig destroy and R14's trash, and show the player what it will cost/consume before they confirm.
5. `InstallJob` takes a **single positional dict** — get its shape from `industry/job.py:624-640` and pin it with a test; a malformed payload is the most likely failure.

## Invariants

- **R7d** zero visible numeric IDs — blueprints, products, facilities, activities all by **name** (activity names, not activityIDs). **R8** responsive reflow + touch targets. **R9a** plain player language ("Material efficiency", not `ME`-as-jargon where a full word fits).
- **The R12/R14 lesson applies: a 200 is not proof.** Re-read after every mutation and report what actually applied; if the server declines without a reason, say exactly that rather than inventing one.
- Server stays authoritative — never compute job outcomes locally; show what the handlers return.

## Required work

1. **Baseline** (record): web `npm test` (expect 504/504); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the **15** isolated gateway suites green.
2. Implement Slice A, commit. Then Slice B, commit. Tests for each: gateway allowlist + deny-by-default; BFF read/mutate routes; web tests for the panel, the install confirm gate, and the decoders.
3. Update `docs/bridge-wire-contract.md` (the industry call table + the InstallJob payload shape) and the roadmap (R15 row). Commit eve.js and web **separately**; report all hashes. **Do not push.**

## Definition of done

- A player can see their blueprints (ME/TE/runs), their active and completed jobs, and available facilities — all by name — and can install, deliver, and cancel jobs, with installation gated behind an informed confirmation. All invariants hold; all baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface only**; never modify the industry services — call them. eve.js is on branch `ReconcileEliteMode`; **pathspec commit** (other agents have in-flight work), never `git add -A`, never revert them.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If Slice B proves too large, land Slice A committed and green and report the split precisely. Never leave broken or uncommitted work.
