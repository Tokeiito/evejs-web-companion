# The Bot Builder — brainstorm result and proposed design

**Produced 2026-07-23**, the brainstorm that `docs/goal-prompts/parked-node-bot-editor.md` parked itself waiting for. Inputs: the parked doc, the R43/R44/R46 record, the sub-ladder investigation verdict, and a 12-agent design workflow (six code readers, three independent designers, three adversarial critics). This is a **design**, not a goal prompt — slices at the end propose how it becomes goals.

**The ask (operator):** players build their own bots from a library of pre-made macros — from "Undock" up to "warp to nearest asteroid belt" — strung together with loops and checks (DO WHILE / DO UNTIL against conditions like ORE BAY FULL or SHIELDS DEPLETED), in a dedicated **Bot Builder** tab with a Human Resource Machine feel. JSON import/export is first-class. Scripts persist per player. A runner executes them in the browser alongside the built-in bots.

---

## Operator decisions (2026-07-23)

The six §11 questions are answered; they are folded into the sections below and summarised here as the authoritative record.

1. **Loop count is the player's — `forever` is allowed.** A loop block repeats a set number of times *or* forever, both shown on the row. Forever is safe here in a way a raw retry would not be: every *action* inside a lap stays bounded (macro counters, the per-step tick cap, the streaks), so an unbounded count of *successful* laps runs nothing unbounded — only the lap count is open, and it is stated on screen.
2. **A dry belt moves to the next belt; it does not stop.** `mine-at-belt` in nearest mode, on a confirmed belt-empty *after arrival*, rotates to the next belt in the system rather than pausing. (The hand-written bot's "do not wander" was right for a single chosen belt; a player bot handed "the nearest belt" should keep working the field.) Bounded: once every belt in the system has been visited and found empty, it pauses with a plain reason. Belt-empty stays a macro *outcome* checked only when armed — the tick-one trap does not reopen.
3. **The "safety floor" is the ship-health cut-off.** It is the fraction of ship health (the lowest of shield/armor/hull) below which the bot breaks off and docks — survival outranks yield, because unattended means nobody is watching the shield bar. Confirmed behaviour: **dock at home and pause.** It is interrupt row 0; threshold editable, row not deletable.
4. **The library is per account.** Alts share one library; scripts key on `accountID`. This makes runtime-bound world slots (nearest belt, unbound-until-verified stations) the norm rather than the exception, since two of your characters rarely sit in the same place.
5. **Hostile handling becomes a player interrupt with a choice.** "A pirate shows up" is an interrupt whose response the player picks: **launch drones and keep working**, or **run for the station (dock and pause)**. This lifts the danger handling currently sealed inside the mining bot up to a row that guards *every* step, hauling included. The drone response inherits the existing bound (three launch attempts, then head home); the run response is the safety-floor response reused.
6. **The HRM column stands for v1.** No node-graph skin yet; revisit after v1 ships.

---

## 1. The program model

Three shapes were designed and attacked:

- **(a) A pure ladder** — rows of *when THIS, do THAT*, first-match-wins, the loop implicit in the tick. It is exactly what the loops are inside, and it is the model that produced the belt-empty trap: top-level condition rows fire out of context, and writing "mine, haul, repeat" as a correct priority ladder takes exactly the skill the hand-written bots embody. Rejected as the *player-facing* model.
- **(c) A literal HRM VM** — program counter plus jump labels. Backward jumps make a cycle drawable again, and a jump chain is a tick that legally emits no world call — the precise primitive the phases model was disqualified for. Restrict jumps to forward-only and (c) collapses into (b) with worse ergonomics. Rejected.
- **(b) A sequential step list of composite macros, with an always-watched interrupt list pinned above it.** Chosen.

**The chosen shape.** A script is:

1. **Interrupts ("Always watching")** — an ordered short list of *if CONDITION → respond* rows checked every tick before anything else. Row 0 is always the built-in safety floor (§4). The operator's SHIELDS DEPLETED lives here, because it must be watched during *every* step, not just one.
2. **Steps** — an ordered list of nodes, each either:
   - a **macro step** — one composite macro with bound parameters, optionally (or, for open-ended macros like *Mine at a belt*, **mandatorily**) carrying an `until` condition: *"Mine at Belt II **until** the ore hold is nearly full"*. This is the operator's DO UNTIL. DO WHILE is the same thing wearing the negated condition — the UI offers both words, the JSON stores one form.
   - a **loop block** — a *Repeat* wrapping a body of macro steps: *"Repeat up to 50 times: [mine until full, deliver the ore]"* or *"Repeat forever"*, with an optional until of its own. **The repeat choice is a required, visible field** — a bounded count (1–500) or forever (decision 1); either way the actions inside stay bounded. One nesting level; loop bodies hold steps only.
3. A program **runs once, top to bottom, then stops** with "your program finished." "Go again" is an explicit outer loop block — which may repeat a set number of times **or forever** (decision 1), its choice shown on the row.

**Why this is still the ladder underneath.** Each tick compiles to: interrupt rows first (ordered, first-match-wins), then the active step's macro decides — which is a ladder whose one live row moves forward as steps complete. The step pointer is memory *about the program*, not about the world (the same class as `headingHome`), and the world is re-read from authority every tick, exactly as the three shipping loops do.

**Tick semantics (the load-bearing part):**

- **Forward-only scan, each node consulted at most once per tick.** When a step's `until` is met or a macro reports done, the pointer advances and the next node is consulted *in the same tick*. A loop whose until is already met on entry is **consumed** (skipped) and the scan continues. If the scan reaches the end of the program, the program is finished — stop, with the sentence. Structurally there is no way to spin: within a tick the scan terminates at the array end, and every macro's decide is **total** — it always returns exactly one action, `wait` included, always with a `why`.
- **The one backward edge** is a loop block re-entering its body, counted against `maxRepeats`. A loop pass in which **no world call was issued** increments a *hollow pass* counter; two consecutive hollow passes pause with "this loop is doing nothing" — the structural answer to the no-emit livelock the phases model died of ("never ship a primitive where a tick can legally emit no world call"). Bounds continue to dispatch on `action.kind`; `wait` carries its own streak counter.
- **One call per tick** holds because only the first non-advance decision executes; everything after it waits for the next tick.

**The belt-empty class, kept out of reach.** Player conditions are evaluated only when the active macro reports itself **armed** — *Mine at a belt* arms after belt arrival; travel macros are never armed. Arrival is not a condition; it stays a sealed step inside travel ("belt-empty is not a row; it is the arrival step"). Every macro ships an `untilArmed` function and a mandatory *still-warping* test fixture — that test convention is what stops a future macro from silently recreating the trap.

## 2. Conditions

Small catalog, tri-state everywhere (`met / not-met / cannot-tell`), computed from that tick's **fresh reads**, never the store. Partitioned **structurally by site** — the type system, not review, keeps grid reads out of `until` slots:

| Condition | Player wording | Derived from | Where allowed |
|---|---|---|---|
| `ore-hold-at-least(f)` | "the ore hold is nearly full (N%)" | `destinationHold` + the `holdShouldHaul` fraction rule; **cap 0.9** — the mixed-hold "does one more unit fit" question stays unanswerable | until + interrupt |
| `hold-empty` | "the hold is empty" | same holds read, items empty confirmed | until |
| `shield-below(f)` / `armor-below(f)` / `hull-below(f)` / `health-below(f)` | "shields drop below N%" | `snapshot.ship.*Ratio` / `lowestHealth` | until + interrupt |
| `hostile-on-grid` | "a pirate shows up" | `hostileRows(snapshot)` | **interrupt only** — it is a *grid* read, false-or-unknowable mid-warp; `DO WHILE no hostiles` would be trivially true in warp |
| `missions-completed-at-least(n)` | "N missions done" | runner-counted (balance-diff-confirmed completions) | until (ships with the mission macro, slice E) |

Thresholds are player parameters clamped on parse (fractions 0.05–0.95; ore-hold ≤0.9; floors have a floor — a `shields below 0%` import never fires and is clamped up with a spoken warning).

**Cannot-tell semantics, per site** (unknown never falls through to "fine" — anywhere):

- **At an `until`:** cannot-tell = *not met* — unknown never advances the program. A **cannot-tell streak counter** (~15 consecutive ticks ≈ 30 s) pauses with "I could not read ⟨thing⟩ for half a minute", so the bot never grinds blind.
- **At an interrupt:** cannot-tell does not fire the row (no spurious emergency dock), the same streak pause applies — the dead-man switch cannot silently rot. The hand-written rule survives verbatim on top: **hostile on grid + health unreadable → pause immediately**, no streak.
- **At pre-start:** cannot-tell blocks. R43's `evaluateRequirements` is reused unchanged.

## 3. Macro catalog v1

Macros are the **composite actions** the sub-ladder verdict demanded — players never compose flights; warp dead band, jump classifier, dock counters, settle ticks all stay sealed inside. Each macro is a module in `web/src/nav/macros/` re-hosting the **existing, live-proven** decide code — not rewrites, and nothing from the ~300 never-fired fast-mode writes:

| Macro | Player name | Params | Implemented by | Completes when | Sealed inside |
|---|---|---|---|---|---|
| `undock` | Leave the station | — | `api.undock` | flight status says in space | 3 attempts; "already in space" benign |
| `travel-to-station` | Fly to a station and dock | station | `startRoute`/`dockAt` ladder | docked at that station | the whole flight ladder: warp dead band, jump handoff, warp 3 / dock 30 / silent-dock 10, approach cycles |
| `mine-at-belt` | Mine at a belt | belt (picked **or "nearest"**), equipment | the mining rungs: travel-to-belt, lock ladder, `runTheLasers`, drone defence | **never on its own — requires an `until`** (outcome `belt-empty` at arrival is a macro outcome, not a condition) | lock 3/rock + blacklist, activate 3, launch 3 → heads home, **no-yield 90**, adopt-if-locked, close-in 300 |
| `deliver-ore` | Haul the ore home | station | travel + `unloadMiningHolds` | hold **re-read empty** | dock counters, unload 3 |
| `run-mission-once` | Do one mission | agent, max jumps, max volume | the whole mission cycle | one completion confirmed (`missionCompleted === true` + balance diff) | decline counter 3 **cleared only by an accept**, fresh actionIDs, in-person accept — **slice E, after its own live QA; it is the standings-destroyer wrapped in the least observable macro** |

"**Warp to nearest asteroid belt**" (operator's named example) is the `mine-at-belt` belt slot in **nearest mode**: at runtime, once in space, the macro picks the nearest `/belt/i` entity from a fresh snapshot (the same derivation the MiningBot picker uses live); none visible → pause with a sentence. Nearest mode is also what makes scripts **authorable while docked** and **shareable across worlds** — no grid needed at edit time, no baked-in id. On a **belt mined dry** (confirmed empty after arrival), nearest mode rotates to the next belt in the system rather than pausing (decision 2), remembering which it has emptied this pass; once every belt has been visited and found empty it pauses with a plain reason — a finite, bounded rotation.

Every macro declares its R43 requirements (with catalog-owned severity — `in-space` stays *advisory* because the ladder undocks itself; the "narrower than the bot" bug stays fixed) and the union over a script's macros **is** the script's pre-start. There is no player-authored prestart list — it is derived, so it cannot be wrong.

**Travel drivers — the one-hull rule.** Single-system movement runs **inline** in the runner's own tick (the mining bot's `travelDecision` pattern — no second driver exists). Multi-system travel delegates to the shared autopilot exactly as the mission bot does, under the mission bot's discipline: the runner issues **nothing** while its delegated flight runs, and pause/stop/interrupt paths all call `stopTravel()` — pinned by a test (paused script ⇒ autopilot not running), because the critique correctly named this convention the likeliest silent-gap bug.

## 4. Safety that cannot be edited away

Safety is **structural — unrepresentable in the file — not validated**. None of this is in the schema, so no import can strip it:

1. **Interrupt row 0: the safety floor.** `health below f → dock at home and pause`. Threshold editable 5–95% (default 50%); the row is **not deletable** and the response not weakenable in v1. R39 proved one unbounded branch destroys real assets while looking busy; a hull loss is the unrecoverable version.
2. **Hostile + unreadable health → pause immediately** (sealed, shown as fine print under the mine step).
3. **All macro-internal counters** (§3 table), the 0.9 hold cap, the cannot-tell and wait streaks, the hollow-pass loop guard, required `maxRepeats`.
4. **A per-step tick cap** (default ~1 h; the mission macro declares its own larger cap so legitimate missions don't trip it): any step still running past its cap pauses naming the step — the R39 lesson applied structurally, so even a future macro-internal counter gap cannot run overnight.
5. **Interrupt responses latch.** When an interrupt fires it latches a response state (the `headingHome` pattern — a latched sentence, not a flag): the row stays lit, the condition is not re-read while responding, the flight home runs under the sealed travel composite with its own bounds, and arrival pauses with the interrupt's own sentence. This is why "health stays below the floor all the way home" does not re-fire anything, and why `homeStation` is a **required script field** — every bot names its home before it can save.

**The two unexpressible rungs, honestly.** The no-yield counters (equipment ran ∧ the hold did not grow, across time) live **inside `mine-at-belt`'s macro memory** — not expressible as a row, not removable, reset when the pointer leaves the step. The panel renders the R44 wording permanently under the mine step: *"This step also watches for mining that earns nothing (about 3 minutes) — that rule is more than one line can say."*

## 5. The runner

`web/src/nav/scriptRunner.ts` — the fourth instance of the proven controller shape: `start(frozenDoc)/pause/resume/stop/tick/run/snapshot`, runToken, 2000 ms cadence, status re-check after every await, SETTLE_* per action kind, `isSessionLost` unwind, null-never-`[]`. Deps built by `makeScriptRunnerDeps()` in flow.ts straight against the api layer (bots must see refusals); each tick reads only the active macro's declared read set plus the interrupt conditions' set, in one parallel batch.

**botRegistry integration.** One new union member: `BotID = "mining" | "mission" | "custom"`. The compiler then forces its stopper into `createShipClaim`'s record and its status reader into `botStatus`; exclusion against the built-ins and `runningBotID` come free, and a paused script still holds the ship. **Custom-vs-custom** is not covered by the claim walk (it skips self) — it is covered the same way mining-vs-mining already is: there is exactly **one** runner controller, and `start()` bumps the runToken and resets memory, superseding any prior run. That property gets pinned by extending the R43 exclusion test: *starting script B while script A runs leaves exactly one loop ticking* — alongside each built-in pairing.

**Start** mirrors `startMiningBot`: clear start-error → `autopilot?.abort()` → `claimShip("custom")` → derive requirements from the doc's macros + slot checks → `evaluateRequirements` against **fresh reads** (cannot-tell blocks) → `custom-bot/started` → `start(Object.freeze(structuredClone(doc)))` → `void run()`. Feed events `custom-bot/started|progress|start-error|cleared`, slice `store.customBot`; the progress snapshot carries **required** fields `{status, stepPath, macroPhase, why, failureReason, caution}` — the R46 rule (the row tried and the thing done, both mandatory, so the readout cannot quietly lie or go dark; `stepPath: null` renders "waiting between actions", never a stale lit row).

## 6. The JSON format

`web/src/bots/botScript.ts` (types) + `web/src/bots/scriptCodec.ts` (decode / encode / migrate) + tests. One envelope, versioned by integer:

```jsonc
{
  "format": "evejs-bot-script",
  "version": 1,
  "name": "Belt runner",
  "notes": "Mines until 90% then hauls.",
  "home": { "entity": "station", "id": 60000004, "name": "Home Station" },
  "interrupts": [
    { "id": "i0", "builtIn": "safety-floor",
      "when": { "kind": "health-below", "fraction": 0.5 }, "respond": "dock-and-pause" },
    { "id": "i1", "when": { "kind": "shield-below", "fraction": 0.3 }, "respond": "dock-and-pause" }
  ],
  "steps": [
    { "id": "s1", "kind": "loop", "maxRepeats": 50,
      "body": [
        { "id": "s2", "kind": "macro", "macro": "mine-at-belt",
          "args": { "belt": { "mode": "nearest" },
                    "equipment": { "kind": "typeGroup", "groupID": 17482, "label": "Strip Miners" } },
          "until": { "kind": "ore-hold-at-least", "fraction": 0.9 } },
        { "id": "s3", "kind": "macro", "macro": "deliver-ore",
          "args": { "station": { "entity": "station", "id": 60000004, "name": "Home Station" } } }
      ] }
  ]
}
```

- **World references are `{entity, id|null, name|null}`; the id is a hint, never trusted.** On import every ref is unbound until verified, and binding requires the id to resolve **to the stored name** for this character's world — an id that exists but resolves elsewhere shows both names and stays unbound (the "same number, different world" spoof). Unbound slots render as *"Pick your own belt — this script was written around **Aunia III – Belt 1**"* and are a **blocking** pre-start verdict (requirement source `"script"`, alongside `ship`/`plan`). No resolve-by-name magic. Labels are display hints only; once bound, everything on screen re-resolves through `store/names.ts` (R7d; unresolved renders `—`, never the number). Equipment is by **typeGroup** (R47), never a name regex.
- **Import is untrusted input**, validated in the bridge-decoder style — field-by-field explicit reads, own-properties only (`__proto__`/`constructor` are just unknown keys, refused), one plain refusal sentence per failure, **no import-with-holes** (a script with a silently missing action is a different program): byte cap **before** `JSON.parse` (48 KB, one number shared with the BFF quota under the 64 KB `express.json` cap); format/version gates; unknown top-level keys, macros, conditions, and param keys refuse — quoting at most a sanitized, length-capped token; every number `Number.isFinite`, out-of-range **clamped to the same bounds the panels use, with a spoken warning** ("Health floor 240% was brought back to 95%"); ≤32 nodes / ≤64 total steps / nesting ≤1 / `maxRepeats` 1–500, required. Adversarial fixtures: 10 MB string, depth-100 nesting, `maxRepeats: -1`, `1e999`, `__proto__`, version 999, unknown macro, and a golden `decode(encode(doc))` round-trip. **Decode-on-read everywhere** — bytes from the BFF or localStorage are as untrusted as a paste.
- **Version skew:** older files migrate stepwise on read and re-save at the current version; a **newer** file refuses plainly ("made with a newer version of this app"). The migration table starts empty — the version gate ships in v1, the first migration function ships with v2.
- **Export:** stable key order, `JSON.stringify(..., null, 2)`, filename `bot-script.belt-runner.json`. Storage metadata (ids, account/character) is stripped; what remains that a player might not expect is world names only.

## 7. Persistence

**Recommendation: the BFF JSON table is the library; localStorage is the draft.** localStorage alone fails the ten-tabs/ten-accounts model (one shared origin store, `localhost` vs `127.0.0.1` split, clear-site-data loss). The BFF knows `req.account` on every authed request, can check character ownership without a live session (`getCharacterForAccount`), and already owns an atomic write pattern (`webAuth.js` tmp+rename into `config.dataDir`).

- **Store:** `data/bot-scripts.json` (web-repo-owned — never eve.js's `gamestore.sqlite` or its stale `data/*.json`; storing player documents through an invented gateway pair would break the 1:1 retail bridge). Shape `{scripts: {[scriptID]: {scriptID, accountID, characterID, rev, updatedAt, doc}}}`, `crypto.randomUUID()` ids. A JSON file, not SQLite: single-process synchronous BFF, tiny data, zero new dependencies.
- **Keying: per account** (decision 4) — alts share one library. Scripts embed world bindings, but nearest-mode and unbound-until-verified slots carry the cross-character case, so a script written by one character binds cleanly for another. Character ownership is not required to browse; `req.account` on every authed request is the key.
- **Routes** (house style — GET/POST only, `{ok:true}` envelopes, registered **above** the order-load-bearing static/catch-all block):
  `GET /api/botscripts?characterID=` (metadata list) · `GET /api/botscripts/:scriptID` · `POST /api/botscripts` (create) · `POST /api/botscripts/:scriptID` (update with `baseRev`; mismatch → 409 "changed in another tab — reload it, or save yours as a copy") · `POST /api/botscripts/:scriptID/delete`.
  Quotas: 50 scripts/character, 48 KB/doc, plain-sentence refusals. BFF validation is envelope-lite (size, format, version, name) — the TS codec can't run there; the browser's decode-on-read is the real gate, and only the browser executes scripts.
- **Drafts:** localStorage `evejs.botdraft.<characterID>.<scriptID|"new">`, debounced ~1 s autosave; "Unsaved changes" badge; undo = "Revert to saved copy". BFF down ⇒ builder still works from drafts, library pane shows an `.error` (not `.empty`), Run works from the in-memory doc.
- **Running copies:** the runner executes the frozen clone from `start()`; edits never hot-swap a running program. Panel sentence: "The bot is running an older copy of this script. Stop and start it to use your changes."

## 8. The UI

**Tab:** `botBuilder`, `where: "both"` — three edits per tabs.ts convention (union, TABS row, PanelHost branch) plus the first-mount sweep. `"both"` is load-bearing twice: the run readout lives in this tab across dock/undock (`resolvePage` would bounce a docked-only tab to `overview` mid-run), and PanelHost staying mounted is what lets editor state survive the shell switch — the likeliest switch being the safety floor's own emergency dock. The **Bots launcher stays a launcher** (its no-editor source sweep keeps passing): it gains one card per saved, startable script — name, advisory checklist, Start, "Open in Bot Builder".

**Editor: three panes, all buttons, zero drag-drop, zero canvas** (drag-drop and canvas are unverifiable in this environment and worse on touch; order is an array index, rows have no edges, a cycle stays undrawable):

```
web/src/ui/BotBuilder.svelte              panel root; mode: library | edit | import-review | run
web/src/ui/botbuilder/ScriptLibrary.svelte  saved scripts + templates + import/export entry
web/src/ui/botbuilder/MacroPalette.svelte   left: the instruction palette
web/src/ui/botbuilder/ProgramColumn.svelte  centre: "Always watching" + numbered steps
web/src/ui/botbuilder/ProgramRow.svelte     one row — also the lit row at runtime
web/src/ui/botbuilder/StepInspector.svelte  right: parameters for the selected row
web/src/ui/botbuilder/ImportReview.svelte   the pre-save review screen
web/src/ui/botbuilder/RunReadout.svelte     phase / why / pause / stop header
```

Pure modules, each with a node --test file: `web/src/bots/scriptEdit.ts` (insert/move/duplicate/delete as pure array ops), `web/src/bots/scriptText.ts` (**every** on-screen sentence — step sentences, condition sentences, validation sentences; the R9a register in one place), `web/src/bots/macroCatalogView.ts` (palette names, "what it does", "what it needs", which picker each param takes).

- **Palette:** cards with plain names and Add buttons; Add inserts after the selected row.
- **Program column:** pinned **"Always watching"** section (interrupts, with the safety-floor row visibly permanent) above numbered **Steps**; loop blocks indent their body one level and wear their `maxRepeats` on the header row. Per-row Move up / Move down / Duplicate / Delete buttons (≥40 px, `aria-label`s); selection by click, `aria-selected`. The two sections also carry the two timing models honestly: *always watching* vs *checked when the step gets there*.
- **Inspector:** reuses the shipping pickers — station select (docked-from + known stations), agent finder, equipment checkboxes over `activatableModules`, clamped number inputs. The belt slot defaults to **"the nearest belt when it gets there"** (which is what makes docked authoring work — the MiningBot picker's live-grid derivation can't run in a station); a specific belt is offerable when in space, and an unbound "pick later" renders the script-source requirement.
- **Validation:** `validateScript` returns `{path, sentence}[]`; problem rows wear `.badge.bad` + the sentence; header says "3 things to fix before this can start". **Problems block starting, not saving.** Start is a `canStart` gate with the reason printed.
- **Run experience:** the program column **is** the readout — lit row via `stepPath` (mark, `aria-current="step"`, lit three ways), interrupts light and stay lit while their latched response flies home, every other row dimmed "not this time", the macro's `macroPhase`+`why` sentence indented under the lit row ("Flying to the belt — closing in, 42 km to go"), pauses in the amber block with the full sentence. A running script's rows are read-only with one sentence: "This script is running. Stop it to edit, or duplicate it to keep working."
- **Import/export:** paste-textarea and show-JSON-textarea are the **primary, testable** paths; file input and Blob download are enhancements on top. Import always lands on **ImportReview** before anything is saved: name, step count, macros used (known / "not a macro this client knows" badges), every clamp spoken ("will be adjusted: 900% → 95%"), every unbound world slot listed, newer-version refusal. Collision → auto-suffix "(2)", never overwrite.
- **Templates:** "New from template" ships bundled JSONs (`web/src/bots/templates/*.json`) decoded through the same codec (a template can never rot invalid), with unbound slots — so the cross-world import UX is exercised by every player who clones one. The mining template is labeled honestly: *"A simpler version of the built-in bot, made from the same pieces"* — the 26-rung ladder (two rungs unexpressible) is not claimed.

**Test manifest:** pure tests for codec (adversarial fixtures), edit ops (edge no-ops, fresh ids), scriptText (a sentence for every macro/condition, no digit-only tokens), arming (every macro × still-warping fixture), decide (interrupt precedence, forward scan, hollow-pass guard, until-met-on-tick-one, empty-program), bounds. SSR tests in the botsPanel pattern (real store + fixtures + Proxy fakeFlow + `visibleText()`): first-mount empty render, library rows, palette blurbs, problem sentences, Start-disabled reason, lit row on `custom-bot/progress`, paused reason, import review badges, R7d sweep with real ids, source sweeps (no `draggable`/`ondrop`/`contenteditable`/`<canvas>`, min-height 40 px, two-step delete). The kinetic *feel* rests on the operator clicking — that ceiling is real and stated.

## 9. Obstacles (the honest list)

1. **`untilArmed` is per-macro judgment** — every future macro/condition pairing must decide when player conditions become meaningful; a wrong default silently recreates the belt-empty trap. Mitigation: the mandatory still-warping fixture per macro, and the structural until/interrupt partition.
2. **The second flight driver.** Delegated multi-system travel means pause/stop/interrupt must all `stopTravel()` — precedented (mission bot) but convention. Pinned by tests; the structural fix (autopilot inside the claim) is filed as future work.
3. **Custom-vs-custom exclusion** rides on the single-controller supersede property, not the claim walk — must stay pinned by the extended exclusion test forever.
4. **`run-mission-once`** is an hour of behaviour behind one lit row and the standings-destroyer lives inside it — deferred to its own slice with its own live QA and a larger step cap.
5. **The codec cannot run on the BFF** (TS web vs JS server) — server validation stays envelope-lite; a hostile direct POST can occupy quota with bytes every client refuses. Accepted for a local PoC.
6. **Live verification ceiling:** node --test proves parser/decide/bounds/arming; SSR proves render; a player script actually mining end-to-end needs a live session driven through `AppFlow`, and the visual feel needs the operator.
7. **Editing while docked** constrains slot UX forever (no live grid) — nearest-mode and unbound slots carry it, but every new macro param must answer "how is this picked from a station?"
8. **Scale of new surface:** ~6 new pure modules, a runner, a three-pane panel, BFF routes. The slices below keep each landing separately verifiable.

## 10. Proposed slices

- **A — the language, no UI.** `botScript.ts`, `scriptCodec.ts` (+ adversarial fixtures), `scriptText.ts`, macro modules for `undock` / `travel-to-station` / `mine-at-belt` / `deliver-ore`, `decideScriptAction` with interrupts/arming/hollow-pass/streaks, all under node --test. Definition of done: the golden doc round-trips and every trap fixture refuses or clamps with its sentence.
- **B — the runner, launched blind.** `scriptRunner.ts`, `BotID "custom"` (compiler-forced wiring), flow lifecycle + feed events + slice, derived preflight. Live-verified by driving `AppFlow` directly with a hand-authored doc: the golden script mines, hauls, finishes; pause stops the autopilot; script-B-supersedes-A test green.
- **C — the Bot Builder tab.** Library, palette, program column, inspector, run readout, templates; SSR manifest above; first-mount sweep extended. Operator clicks it for feel.
- **D — import/export + the BFF library.** ImportReview, paste/file paths, `/api/botscripts` routes + `data/bot-scripts.json`, drafts, quotas, rev conflict sentence.
- **E — the mission macro** (+ `missions-completed-at-least`), gated on its own live QA, decline counter watched specifically.

## 11. Open questions for the operator

**All six were answered on 2026-07-23 — see "Operator decisions" at the top. Kept here for the record.**

1. **Run forever?** v1 bounds every loop (`maxRepeats` ≤ 500 — at a couple of minutes per lap that is comfortably overnight). Should a true *forever* switch exist for player scripts, or is the visible bound the feature?
2. **Belt runs dry mid-until:** advance to the next step with whatever's aboard (matches the hand-written bot) or pause and tell you? Recommended: advance if the hold has anything, pause if empty.
3. **After the safety floor docks you:** pause forever (recommended v1) or a later "resume once repaired" option?
4. **Library scope:** per character (recommended — scripts embed world bindings) or per account so alts share?
5. **Player-editable hostile response:** may players add "a pirate shows up → dock and pause" as an interrupt, or does hostile handling stay entirely sealed inside `mine-at-belt` (drones + heads-home)? Both are safe; it changes how much the palette teaches.
6. **The node-like view:** this design is an ordered list with loop blocks — edges stay undrawable on purpose. Is a purely cosmetic node *skin* later (cards + fixed top-to-bottom connectors, still no free edges) worth pursuing, or does the HRM column satisfy the ask?

## Appendix — the parked doc's five questions, answered

1. **Can a node-like view render an ordered, first-match-wins document without implying free-form edges?** Yes, by not being a canvas: an ordered column with pinned interrupts and indented loop blocks. If a player could draw an edge it would mean nothing — so they can't. A cosmetic skin later stays possible (§11.6).
2. **Minimal reusable sub-ladder expression?** None. Sub-ladders stay sealed composites (the 2–1 verdict); reuse is the macro catalog. `forward: n` stays filed.
3. **The JSON schema, and what makes hostile imports safe?** §6 — envelope + strict codec + byte-cap-before-parse + clamp-with-spoken-warning + no-import-with-holes + name-verified binding + decode-on-read; safety is structural (not representable), not validated.
4. **Composable vs sealed?** The table in §3 — players compose macros, conditions, thresholds, order; flights, counters, dead bands, arming, and the safety floor's existence are sealed.
5. **The two unexpressible rungs?** Inside `mine-at-belt`'s memory, non-removable, rendered permanently as the R44 "more than one line can say" caveat (§4).
