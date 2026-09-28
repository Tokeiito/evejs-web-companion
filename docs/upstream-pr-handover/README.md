# Upstreaming `tokeiito` to rrfarmer/evejs-web-companion: handover

Written 2026-09-28, at the end of the session that opened the series. **This
directory is fork-only.** It must never ride along in an upstream PR (see
"Excluded from every PR").

It is meant to be self-contained: a new session should need nothing else to
carry the series through review.

---

## 1. Where things stand

**All of `tokeiito`'s work is in upstream PRs.** 25 PRs, `#11`–`#35` on
`rrfarmer/evejs-web-companion`.

- `#11` is open and ready for review. `#12`–`#35` are **drafts**, each stacked
  on the one before it.
- **Nothing is merged yet.** On 2026-09-28 there were no reviews. The only
  comment on #11 is the operator's own ("vibe coded … first from many").
  Don't reply to it or act on it unless the operator asks.
- **Every PR was built and tested on its own branch before it was pushed.**
  That means the Docker `tsc` + Vite build, the web suite and the BFF suite
  (commands in §7).
- **Every local `up/*` branch equals `fork/up/*`.** They were checked on
  2026-09-28.

| Ref | Commit | What it is |
| --- | --- | --- |
| `origin/master` | `8204447` | The vendor's master the whole series is built on. |
| `upstream-base/2026-09` (tag, pushed) | `910d4c1` | `tokeiito` right after it absorbed upstream's 5 commits: the reference tree the series was checked against. |
| `tokeiito` | `d55a0b9` | Current fork integration branch, pushed to `fork`. |

**Remotes:**
- `origin` = `rrfarmer/evejs-web-companion` (the vendor). **Never push here.**
- `fork` = `Tokeiito/evejs-web-companion`.

PRs are opened from `fork` with `--head Tokeiito:<branch>`.

---

## 2. Why so many PRs, and why a stack

The fork diverged by ~470 commits (164 topic merges, +138k lines).

**Why stacked.** Upstream merges big PRs (its own #1, #2 and #6 were epics), but
one 138k-line PR is unreviewable. The work is also deeply interdependent: most
features edit `web/src/app/flow.ts`, `web/src/nav/scriptMacros.ts` and
`web/src/bots/*`. So the series is **one linear stack**. Each `up/NN` branch is
cut from `up/NN-1` (NN=01 from `origin/master`) and adds one coherent feature.

**Why strictly chronological (the lesson that cost the most).** The first plan
grouped by *feature*. That broke three times:
- PR 6's tail needed PR 8's refusal ledger.
- PR 5's window-chrome commits touched windows that only exist after the Fleet
  Companion.
- One mining merge sat 120 positions after the rest.

From PR 8 onwards every PR is a **contiguous run of topic positions**
(line numbers in `topics.txt` = first-parent merges of `tokeiito` since the
merge-base `dc61bd9`). So everything a PR builds on is already below it. PRs 1–7
were built before that rule and are also correct, but out of chronological
order in places.

**Why GitHub shows cumulative diffs.** A PR from a fork can only target an
upstream branch, never another open PR. So each draft shows its parents'
commits too. Every PR body starts with a "Depends on #N" banner and names the
first commit to review.

---

## 3. The series

"Topics" are line numbers in `topics.txt` in this directory (first-parent merges
of `tokeiito`, oldest first).

| PR | Branch | Tip | Topics | What |
| --- | --- | --- | --- | --- |
| #11 | `up/01-bot-library` | `12a55fe` | 2, 6, 11, 12, 81 (+3 strays, §5) | Platform-wide bot library, Bot Manager |
| #12 | `up/02-bot-builder` | `8134d4c` | 3, 4, 5, 7, 8, 9 | Bot Builder rebuilt as plan/watches/inspector; last commit fits it to the format without chat/PvP |
| #13 | `up/03-pilot-hangar` | `99984ad` | 13, 16 | Pilot hangar + squads |
| #14 | `up/04-station-hud` | `51e960c` | 33–35, 39–46 | Station panel, in-space workspace, ship HUD |
| #15 | `up/05-notices` | `09b9b56` | 36–38, 50, 90 | Notice system as centre flash, qty box, scroll colours |
| #16 | `up/06-pve-combat` | `4a8b489` | 10, 14, 15, 51, 52 | fight-back watch, drones by role, no stop in space |
| #17 | `up/07-mining` | `5d8aaf2` | 17 | Ore priority + shared dry-belt memory |
| #18 | `up/08-cargo-bays` | `a0512db` | 18–32 | Bay routing, keep-aboard, refusal ledger |
| #19 | `up/09-server-bots-manager` | `a58e121` | 47–49 | Bot Manager as a global window |
| #20 | `up/10-head-home` | `a4611b2` | 53–55 | Runner faults head home, blind bot docks |
| #21 | `up/11-contracts` | `9b5eb50` | 56 | Contracts offered to you |
| #22 | `up/12-fleet-combat` | `7acb12c` | 57–62 | Kill ladder, fleet primary (squad board), flight recorder |
| #23 | `up/13-bot-fixes` | `6b644cd` | 63–66 | Loot by hand, singleton qty, hangar Stop, unique step ids |
| #24 | `up/14-fleet-finder` | `df5c387` | 67–70 | travel-to-system, join-advertised-fleet (**restores the `text` arg kind**), dock-and-repair, HUD fixes |
| #25 | `up/15-mining-surveyor` | `084dbec` | 71–74 | Ore value, surveyor, typed belts, live training |
| #26 | `up/16-nav-scanner` | `ba9ee94` | 75–80 | Gate arrival re-park, pod, site kinds, compose log cap |
| #27 | `up/17-fleet-companion` | `4dcf8a4` | 82–86 | Fleet Companion **+ chat back over XMPP** (one PR by operator's choice) |
| #28 | `up/18-companion-window` | `d4eef34` | 87–96 minus 90 | Fleet companions window + window chrome everywhere |
| #29 | `up/19-companion-refinements` | `7f92b52` | 97–110 minus 102 | Op roster, shared wrecks, propulsion, flee; Edit opens the bot |
| #30 | `up/20-builder-fixes` | `d09b631` | 111–115 | Watches yield, faster lock, hardener skips |
| #31 | `up/21-drone-boat` | `001a47f` | 116–130 minus 129 | Fight with drones + movement fixes |
| #32 | `up/22-hauler-ore-sites` | `a3c9b21` | 131–133, 135, 136, 138, 141 | Load a hauler, pilot groups, ore-site mining |
| #33 | `up/23-pi-colonies` | `6e6151c` | 134, 137, 139, 140, 142–153 | PI part 1: colonies board, restart, launch, launchers |
| #34 | `up/24-pi-planner` | `106d7fc` | 154–161 | PI part 2: stock, planner, **saved plans DB** |
| #35 | `up/25-pi-server-bots` | `a093c7e` | 162–164 | Server bots: PI corp hangars, 72 h, dock before deadline |

**Excluded outright:**
- Topic 1 (`25358ac`) is already upstream as PR #10.
- 102 (`78aef7c`) is the personal Gitea/hive deploy.
- 129 (`3fe96ff`) is `.claude` hook tooling.
- Also excluded: `44b306a`, a `.claude` hook commit inside topic 128. The
  `.claude/hooks/*` files also rode inside `b0c75b0` (topic 131); they were
  stripped out of that commit and its message.

**Dependencies are strictly linear.** Every PR needs every lower-numbered PR.
The chosen order also means nothing in PR N needs anything above it. The one
exception worth knowing: chat. PR #27 restores chat. Nothing below #27 may use
chat, and nothing below it does.

---

## 4. Decisions, and why

**Settled with the operator:**
1. **Upstream PRs are back on** (2026-09-28). This reverses a 2026-09-05 "no
   vendor PRs" decision; memory `branch-workflow-fork-pr` is updated.
2. **Merge upstream into `tokeiito` first**, then extract. That's
   `upstream-base/2026-09`.
3. **Feature-epic PRs, not ~40 small ones.**
4. **Chat-dependent work goes upstream anyway.** Upstream `e500758` retired
   companion chat, because EveJS v0.12.8 removed the `/_evejs-web/v1/chat`
   routes. The fork already had an XMPP transport (`src/evejsXmppChat.js`) that
   the Fleet Companion takes orders over.
5. **Fleet Companion and XMPP chat are one PR (#27)**, because the companion's
   orders come through chat.
6. **Keep the stray `a29a5f0` in #11** (§5). It was also applied to `tokeiito`.
7. **No history rewrite** of `tokeiito` for the colony-fixture pin id (§8).

**How upstream's 5 commits were absorbed** (on `tokeiito`, merges `54693ed`,
`545354b`, `b79f964`, `910d4c1`):
- **PvP removal `fc0395e` was taken.** `attack-player`, `hunt-player`, the PvP
  engage core, tackle/web module lists and hunt reads are gone. All combat in
  the series is PvE (NPCs), and the combat PR bodies say so.
- **Chat retirement `e500758` was recorded with `-s ours`**, i.e. not taken. In
  the series, #27's first commit restores **only the transport and panel half**:
  the Chat panel, slice, decoders, `api.readChat/sendChat` and
  `/api/bridge/chat/*`. The **bot-format half stays retired**: no `send-chat`
  block, no `players-in-system-above` watch, no `chatChannel` arg. Old documents
  naming those are refused by upstream's own `RETIRED_WEB_COMPANION_*` sets.
- **The ISK wrapping fixes merged cleanly.**

**The generic `text` arg kind was restored in #24.** `join-advertised-fleet`
needs a free-text fleet name, and upstream had deleted `text` along with chat.
`text` is generic, and `chatChannel` stays out. `strip_chat.py` was updated to
no longer strip `text`.

**Player-hull ranking.** #22 removed it with the PvP blocks. #27 brings it back
only as `classifyTargetGroups(…, includePlayerHulls, …)`, where the script
runner always passes `false` and only the companion (tagging tackle) passes
`true`.

**Docs stay in PRs.** Upstream's own `docs/` already holds brainstorms,
handoffs, `goal-prompts/` and a progress log, so design notes ride with their
code. Only fork infra is excluded.

---

## 5. Stray commits in #11 (not from `tokeiito`)

`up/01-bot-library` (#11) carries three commits authored 2026-09-28 15:28 that
were **not** made by the session that built the series. They were already on
the pushed branch. Everything above #11 carries them.

| Commit | What | Outcome |
| --- | --- | --- |
| `a29a5f0` | Inserting a saved bot copies its repeating group's steps (tokeiito left them out) | **Kept** by operator decision. Also applied to `tokeiito` (`c282f20`). |
| `6de5893` | Edit loads the bot it names, via `bots/builderHandoff.ts` | **Superseded in #29.** The fork's own `builderTarget.ts` (`a331bf6`) replaced it and `builderHandoff.ts` was deleted, so there's one mechanism. |
| `12a55fe` | Per-pilot server-bot roster merge (`mergeServerRosters`, `ownerFlow`) | **Superseded in #33.** The fork's own `pilotReach.readServerBots` replaced it (files taken verbatim from `c8744ca`). |

If a reviewer asks why #11 does something #29 or #33 undoes, this is why.

---

## 6. Open items waiting on someone else

- **#34's server-side database.** Saved PI plans live in
  `data/companion.sqlite` (`src/companionDb.js`, `better-sqlite3`), the first
  table the BFF owns.
  - The PR body puts it to the maintainer as a decision.
  - If they refuse, only the plan store, the `/api/pi/plans` routes and the plan
    list's load/save change; plans would move to the browser.
- **Not driven live in this form:** `dock-and-repair` against the real server,
  `join-advertised-fleet` on an approval-gated advert, and the Fleet Companion
  end to end as assembled here. The PR bodies and commit messages say so.

---

## 7. How to verify a branch (the only gates that count)

The host has no `svelte`/`typescript`/`express` in `node_modules`. **Always test
inside the web-build image** (memory `verify-web-build-in-docker`).

```bash
docker build --target web-build -t evejs-web-build-check .
docker run --rm evejs-web-build-check sh -c 'node --test "web/src/**/*.test.ts"'
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "D:/eveoffline/evejs-web-companion/src:/app/src:ro" \
  -v "D:/eveoffline/evejs-web-companion/test:/app/test:ro" \
  -v "D:/eveoffline/evejs-web-companion/contracts:/app/contracts:ro" \
  -v "D:/eveoffline/evejs-web-companion/data:/app/data:ro" \
  -v "D:/eveoffline/evejs-web-companion/scripts:/app/scripts:ro" \
  evejs-web-build-check sh -c 'node --test "test/*.test.js" "src/*.test.js"'
```

- **Build:** the image build runs `tsc` and `vite build`. Exit 0 is required.
  `tsc` does not check `.svelte`, so grep `.svelte` files for anything you
  remove.
- **Web suite:** 0 failures expected (5544 tests on #35).
- **BFF suite:** exactly these **5 failures are the baseline**, and
  `origin/master` fails the same 5:
  - `the roots of the market tree are real, named groups`
  - `a branch has children, and they are sorted for a human`
  - `a group that holds items yields named, tradable types`
  - `a type is only ever listed under its OWN group`
  - `the generic-call write policy covers the complete canonical plumbing inventory`

  Judge by **names, never counts**.
- **Mount the main checkout's `data/`.** A git worktree has no
  `data/icon-cache`, and `createApp` then fails to load and ~45 files "fail".

---

## 8. Hygiene before any push, PR or comment

The operator's global rules (`~/.claude/CLAUDE.md`) apply to every commit
message, PR body and comment.

- **No AI attribution.** Grep for `Co-Authored-By`, `Claude` and 🤖.
- **No real identifiers.** Character, account and item ids, and names from live
  sessions. Use `90000001` (ESI's example) or obviously synthetic values.
  - The `99884000xxxxx` item ids in fixtures are the **vendor's** own test-account
    items, already throughout upstream's tests. They're fine.
  - One new real id was caught: the captured colony fixture's command-centre pin
    id was substituted in #33's history. On `tokeiito` it was fixed
    going forward (`6d5dc83`); per the operator it **remains in `tokeiito`'s
    pushed history**.
- **No references to the operator's private repo or deploy:** grep messages and
  diffs for `evej-hive`, `hive`, `gitea` and `portainer`. One PR-16 message
  cited evej-hive and was rewritten.
- **No incident stories naming containers or dates in shipped comments.** The
  `compose.yaml` log-cap comment was trimmed to its rationale.
- **Fork-only paths never go upstream:** `.claude/`, `.gitea/`,
  `compose.hive.yaml`, `docs/DEPLOYMENT.md`, `graphify-out/`, `.gitattributes`
  and **this directory**.

---

## 9. What to do when review starts

### When a PR merges

It is almost always the lowest open one. Rebase the next branch onto the new
`master` so its diff shrinks to its own commits. Because each branch was cut
from the previous one, use `--onto` with the **old tip of the merged branch**
(table in §3):

```bash
git fetch origin
# #11 (up/01, old tip 12a55fe) merged -> move up/02 onto master:
git rebase --onto origin/master 12a55fe up/02-bot-builder
# then each later branch onto its freshly rebased parent, using the parent's OLD tip:
git rebase --onto up/02-bot-builder 8134d4c up/03-pilot-hangar
# ... and so on down the stack (old tips are in §3)
```

**Record each branch's old tip before rebasing it.** After a squash-merge
upstream, the commits in `master` have new shas, so plain `git rebase
origin/master` would try to re-apply them. `--onto <old-parent-tip>` avoids that.

After each rebase:
1. run §7;
2. `git push --force-with-lease fork up/NN-…`;
3. mark the next PR ready (`gh pr ready N --repo rrfarmer/evejs-web-companion`);
4. drop its "Depends on" banner (`gh pr edit N --body-file …`).

**Ask the operator before every push and every PR state change.**

### When the maintainer asks for a change on PR N

Commit it on `up/NN`, then rebase every branch above it onto its new parent
with the same `--onto` pattern, and re-run §7 on each.

### When upstream `master` moves before #11 merges

Rebase the whole stack bottom-up. Expect conflicts in `flow.ts`,
`scriptMacros.ts` and the bot format.

---

## 10. Conflict patterns you will meet, and the fixes that worked

Most fork commits predate upstream's chat and PvP removal. So even commits that
apply cleanly can re-introduce references to things upstream deleted.

| Symptom | Resolution |
| --- | --- |
| Hunks adding `attack-player`, `hunt-player`, `engagePrey`, `PVP_MACROS`, tackle/web module lists, `huntRoam`, `dscanHitIDs` | Drop them; keep ours. |
| Hunks adding `send-chat`, `players-in-system-above`, `chatChannel`, `ChatChannelArg`, `CHAT_CHANNEL_ARGS`, `DEFAULT_HUNT_*` | Drop them. `strip_chat.py` does the mechanical part. |
| New arg kinds (`oreList`, `bayList`, `itemList`, `system`, …) arriving next to `text`/`chatChannel` | Take theirs, then run `strip_chat.py` (it keeps `text` since #24). |
| `tsc` says `"sendChat"` / `"hunt-player"` is not assignable | A test or comment uses a removed name as an example; swap in a live one (e.g. `createFleet`, `fight-the-rats`). |
| Two sides both append tests at a file's end | Keep both, but **add back the `});`** the join drops (it happened twice). `tsc` catches it. |
| `docs/block-audit.md` mining/combat rows | Take the new mining row; keep upstream's combat row without PvP. |
| A commit that only touches `.claude/` | Drop it (`git rebase -i`, delete the pick line). |

**Helpers in this directory** (copied from the building session):
- `resolve.py FILE show|<o/t/b per hunk>`: per-hunk ours/theirs/both. It splits
  on `\n` only; an early `splitlines()` bug once cut a marker line.
- `resolve_fn.py FILE RULE.py`: resolve every hunk with `def f(ours, theirs, i)`.
- `pickloop.sh PICKFILE`: cherry-pick a list, resumable via `PICKFILE.done`, and
  stop at the first conflict.
- `strip_chat.py FILE…`: remove the chat/hunt vocabulary upstream no longer has.
- `topics.txt`: the 164 first-parent topic merges; its line numbers are the
  "topics" above.

Commit messages were only ever changed with `git filter-branch --msg-filter`
on the unpushed `up/*` range, followed by deleting `refs/original/*`.

---

## 11. Known small gaps (not blocking)

- `web/src/bots/editorOptions.test.ts`'s "every Arg kind has a widget" list does
  not name `text`, though #24 restored the kind. Coverage only; the
  `Record<Arg["kind"], …>` typing still forces a widget and label.
- `docs/skill-plans-brainstorm.md` rides in #18 because the fork committed it
  inside "deliver ore, not the whole ship". The PR body says so.
