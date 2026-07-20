# Goal R17: Mail + Contracts (the last two backlog items)

**Issued:** 2026-07-20 by the orchestrator. **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests). This completes the next-phase backlog.

Both areas are **top-level calls** (no bound-object step), so `POST /api/bridge/call` on the held session already carries them — the only eve.js edit is adding allowlist pairs. EveJS implements both deeply. **Land MAIL first** (the research's own recommendation — it is clean and fully functional), then contracts.

## Slice A — MAIL (`mailMgr`), commit first

Client service: `sm.RemoteSvc('mailMgr')`. Mailing lists are a *separate* service (`mailingListsMgr`) — **out of scope**.

- **Inbox is a two-call DELTA SYNC, not a list call.** `("mailMgr","SyncMail",[firstID,lastID])` where the two are the min/max messageID already cached client-side, or **`[null, 0]` for a cold start**. Returns `{newMail:[headerRows], oldMail:[headerRows], mailStatus:[statusRows]}`.
- Header fields: `messageID, senderID, toCharacterIDs, toListID, toCorpOrAllianceID, title, sentDate`. ⚠ **`toCharacterIDs` is a comma-joined STRING, not a list** — split on `,`. `sentDate` is a FILETIME long. Status rows carry `statusMask` + `labelMask`.
- For any messageID present in `mailStatus` but not cached: `("mailMgr","GetMailHeaders",[[messageID, …]])`.
- **Read a body:** `("mailMgr","GetBody",[messageID, shouldMarkAsRead])` (1/0). ⚠ **The return is a zlib-DEFLATED buffer, not text.** Over the bridge a Node Buffer serializes as `{type:"Buffer", data:[…]}`, so **the BFF must `zlib.inflateSync(Buffer.from(result.data))`** and hand the browser plain text — do **not** attempt to decompress in the browser. Passing `shouldMarkAsRead=1` also fires an `OnMailUpdatedByExternal` push to the character's other sessions.
- **Send:** `mailMgr.SendMail` (retail wraps it in a CSPA-charged action that retries with an extra kwarg when a CSPA cost applies — mine the exact signature from `mailSvc.py:965` / `eveMisc.py:89-101` and pin it with a test).
- **Allowlist: none of `SyncMail`, `GetMailHeaders`, `GetBody`, `SendMail` are present** — add what you use.

**UI:** a **Mail** panel — inbox list (sender **by name**, subject, date), read a message body, mark read, and compose/send to a character by name. Unread count visible.

## Slice B — CONTRACTS (`contractProxy`), commit second

⚠ **Use `contractProxy`. `contractMgr` is a dead service that returns empty everything** and is never called by the retail client — picking it yields a silently empty page that looks like our bug.

⚠ **Expect an empty browse, and say so in the UI.** There is **no NPC/seed contract generator anywhere in the repo**, so `SearchContracts` legitimately returns nothing until a contract is created. The panel must make that clear ("no public contracts exist in this world yet") rather than looking broken. **This is expected, not a defect — do not go hunting for a bug.**

- **Browse:** `("contractProxy","SearchContracts",[],{…})` — **kwargs-only, no positional args**. For couriers: `contractType: 3`, `availability: 0` (public), `startNum: page*100`, omit the rest. Returns `{contracts:[{contract,items,bids}], numFound, searchTime, maxResults}`; page size **100** both sides.
- **My contracts:** `("contractProxy","GetContractListForOwner",[ownerID, filtStatus, contractType, issuedBy],{num, startContractID})` — **the server reads only args[0..2]** and ignores the rest. Siblings, all implemented: `GetMyCurrentContractList(isAccepted, forCorp)`, `GetMyExpiredContractList(forCorp)`, `CollectMyPageInfo()`, `GetLoginInfo()` (the summary: `assignedToMe`/`needsAttention`/`inProgress`).
- **Details:** `("contractProxy","GetContract",[contractID])` → the detail bundle with items and route endpoints.
- **Allowlist: none of these are present** — add what you use.
- **Auctions/bids are stubbed** server-side (`PlaceBid`→null, `GetMyBids`→empty) — do not build bidding.

**UI:** a **Contracts** panel — browse public courier contracts (with the empty-world note), your own contracts (issued/accepted/expired) with status, and a contract's details incl. items and start/end locations **by name**. Accepting a contract is a **stretch goal only if the signature is clean** — it moves items and ISK, so it must sit behind a two-step `confirm: true` gate like R12/R14/R16; if anything is ambiguous, leave it out and report rather than guess.

## Invariants

- **R7d** zero visible numeric IDs (senders, items, stations, systems by **name**; ISK as decimal strings). **R8** responsive reflow + touch targets. **R9a** plain player language.
- **A 200 is not proof** — re-read after any mutation and report what actually applied; if the server declines without a reason, say exactly that.

## Required work

1. **Baseline** (record): web `npm test` (expect 651/651); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the **17** isolated gateway suites green.
2. Slice A, commit. Slice B, commit. Tests: gateway allowlist + deny-by-default (**including `contractMgr` refused by name** and the mailing-list service absent); BFF routes incl. **a test pinning the zlib body inflation** and the `[null,0]` cold-start sync; web tests for the inbox delta, the compose path, and the contracts panels.
3. Update `docs/bridge-wire-contract.md` (both call tables, the zlib rule, the empty-browse note) and the roadmap (R17 row + strike the backlog items). Commit eve.js and web **separately**; report all hashes. **Do not push.**

## Definition of done

- A player can read their inbox, open a message, and send mail — all by name; and can see their contracts and a (correctly-empty-for-now) public courier browse, with details by name. All invariants hold; baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed; hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface only**; never modify `mailMgrService.js`, `contractProxyService.js`, or any mechanics — call them. Branch `ReconcileEliteMode`; **pathspec commit**, never `git add -A`, never revert other agents' in-flight work (if the shared tree fails to load mid-run, that is their mid-save state — re-check, don't "fix" their file).
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either; run only tests + builds. Never push.
- If Slice B is too large, land Slice A committed and green and report the split. Never leave broken or uncommitted work.
