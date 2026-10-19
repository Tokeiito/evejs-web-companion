# Corporation actions in the owner menu

Build 3396210 is the authority for this work. The administration section follows the
fleet/duel entries in `menusvc.CharacterMenu:642-678`. Its callbacks are separate
flows, so the journal divides their implementation into the units below. Existing
Member Details, contact, fleet, warp and private-chat features remain in scope.

## Membership prerequisite

`menucheckers/sessionChecker.py:138-139` defines same-corporation membership as
`ownerID in corp.GetMemberIDs()`. It does not query a target's public corporation
record or infer membership from a contact's scope.

`corporation/bco_members.py:110-151,229-241` keeps IDs from the bound registry's
`GetEveOwners()` reply. Repeated reads use that list. A corporation session change
clears it and primes the new corporation. `OnCorporationMemberChanged` removes an
ID when its old corporation is the current one, or appends it when its new
corporation is the current one. A role-only change does not alter membership.

The installed client's compiled methods confirmed one remote call across two
reads, then a join and departure changed the IDs without another call. This is a
prerequisite for sharing administration actions across Contacts and Member List.
The transport now retains IDs from the existing login/corporation prime in
`pilotCorporationMembers.js`. The page's `flow.corporationMemberIDs()` reads them
through `/api/bridge/corporation/member-ids`. Neither repeated reads nor another
member joining/leaving ask the registry again. A change of the pilot's own
corporation clears the list and runs its native prime once. The explicit raw
`GetEveOwners` RPC and its old decoder still return actual owner rows; IDs do not
manufacture replacement rows with invented names or types. The gateway fallback
reads its actual registry reply, while native connections use the retained state.

Live production transports confirmed the initial `[140000002, 140000003]`, a
notice-appended joining member, departure, and unchanged IDs/call counts for an
actual Director-role notice. The other member's own connection primed each new
corporation. Holding completed real prime replies across an entry replacement
and across two corporation changes on one connection retired the old reads;
fresh membership remained correct. The page also rejects a held HTTP 200 after
changing pilot or after its same pilot changes corporation, before applying late
notices. The compiled native membership methods supply the retention/update rule.

## Native menu gates and callbacks

The compiled `CharacterChecker` methods confirm these gates. “Single” means the
native `_multiSelection` gate; “same corp” uses the retained IDs above. A self
target is allowed unless stated otherwise.

| Action | Gate | Native callback |
|---|---|---|
| View Corporation Member Details | Single, non-NPC, same corp, viewer lacks Director | `ShowCorpMemberDetails(charID)` |
| Edit Corporation Member | Single, non-NPC, same corp, viewer has Director | Same member-details callback |
| Allow Corporation Roles | Single, non-NPC, same corp, self, roles blocked | Confirmation submenu calls `corp.UpdateMember` with final `blockRoles=0` |
| Transfer Corporation Cash | Single, non-NPC, viewer is Accountant | `wallet.TransferMoney(session.corpid, None, charID, None)` |
| Quit Corporation | Self, player corporation, not CEO | Submenu: Remove All Roles; Confirm Quit Corporation |
| Expel Corporation Member(s) | Non-NPC, other member, same corp, viewer has Director | Confirmation submenu selects `KickOut` or `KickOutMultipleMembers` |
| Resign as CEO | Self and CEO | Confirmation submenu calls `corp.ResignFromCEO()` |
| Award Corporation Member Decoration | Non-NPC, player corporation, same corp, Personnel Manager | `AwardDecoration([charID])`, with native menu merge for multiple targets |
| Send Corporation Invitation | Single, non-NPC, Personnel Manager, outside current membership | `corp.InviteToJoinCorp(charID)` |

Sources: `menucheckers/characterCheckers.py:82-102,140-160,245-252,276-279,292-299,332-341,380-389`;
`menusvc.py:642-678,752-758`. View/Edit gate on the session's Director bit,
not an independently inferred CEO flag. The native View action is also available
to a same-corporation ordinary self target in an NPC corporation.

The compiled menu gates have no explicit multi-selection check for Quit, Expel,
Resign or Award. Follow actual menu-merge behavior and each callback's own checks;
do not replace that with a blanket single-selection rule. Expel itself excludes
self, including when evaluating a merged selection.

## Work order

1. **D2p18c4a — retained membership, implemented.** The native prime, membership
   notices, role-only stability, pilot/corporation scopes and real delayed-reply
   retirement have been verified live. The page API is ready for the shared menu.
2. **D2p18c4b — shared View/Edit Member Details, implemented.** Contacts/search
   and Member List share the retained-membership and session-Director gate,
   reusing the complete member dialog on desktop and phone.
   `memberDetails.OpenMemberDetails:9-16` maximizes an existing window for the same
   character; for another character it closes that window and opens the new one.
   The installed compiled function confirmed all three cases. Its
   General/Roles/Titles/Summary/Give Shares behavior and save permissions remain.
   `TabGroup._FindAutoSelectTabIDx:649-673` remembers the enabled panel between
   windows; its original compiled function confirmed named/index selection and
   fallback to General. The same target retains its unsaved state without another
   native read; another target replaces it and loads the remembered panel.
   Member reads, titles, summary, Apply reloads and share quantities retain the
   originating pilot, corporation and window lifetime. Caches also distinguish
   pilot/corporation generations. Completed real replies held across replacement
   retire before continuing the old read chain or publishing its cache; a saved
   old model cannot write as another pilot. Live browser evidence includes
   ordinary/self/outsider/multiple gates, corporate Contacts and Member List,
   all panels, actual title/base Apply, window reuse/replacement, phone opening
   and the server's actual Give Shares role refusal. Native retained-ID probes
   also confirmed ordinary self in an NPC corporation remains eligible.
3. **D2p18c4c — roles and leaving/expulsion.** Complete both native submenus and
   their callbacks. `base_corporation.RemoveAllRoles:482-487` asks its dialog and
   sends all eight role masks zero, `titleMask=0`, `blockRoles=1`. Allow sends the
   fifteen-position optional update with `blockRoles=0`. `KickOut:397-461` checks
   eligibility, active non-mutual unfinished wars, then the self/other confirmation
   before the write. Multiple expulsion has its own self refusal, results and
   failed-member wording (`461-477`). Read compiled branches and wire recordings
   before implementing; retain exact session-change behavior for leaving.
   Implement this in three reviewable units, in order:
   - **c4c1: Allow Corporation Roles, implemented.** Its single self-target submenu has one
     Confirm action (`menusvc:648-652`), which calls the fifteen-position
     `UpdateMember` with all optional values `None` except final `blockRoles=0`.
     `BaseChecker.GetBlockedRoles:61-62` uses `corp.UserBlocksRoles`, then
     `bco_members.MemberBlocksRoles:262-269` reads the pilot's memoized member.
     Preserve the existing six-second cache and native absence/None-to-zero rule;
     do not infer blocking from a role mask. There is no separate modal or NPC
     corporation exclusion in this action's native gate.
     The original compiled menu, gate, blocked-role reader and forwarding method
     confirmed the submenu and tuple. Corporation Contacts, Contacts search and
     Member List use the shared action. Live desktop/phone verification confirmed
     peer/multiple exclusion, expansion without a write, phone confirmation,
     actual unblock and disappearance after cache expiry. Production AppFlow
     probes confirmed one native member read across repeated menus, no eager
     cache clear, unchanged profile fields and six-second expiry. Old callbacks
     cannot write after pilot/corporation replacement; held actual member and
     successful Allow replies retire without continuing under another pilot.
     No exact Allow callback was found in the recursive Tranquility corpus;
     its compiled tuple and actual native wire establish the implementation.
   - **c4c2: Quit Corporation.** Complete both submenu entries together:
     Remove All Roles, including its native confirmation and exact eight-zero
     mask/title/block tuple; and Confirm Quit, including `CanBeKickedOut`, the
     active-war warning, self confirmation and session-change handling. The
     native gate is self, player corporation, non-CEO; it has no explicit
     multi-selection check. Read actual menu merge before choosing UI behavior.
     **c4c2a, transport prerequisite implemented:** the typed native quit call
     names its originating corporation in HTTP `of`, while its native RPC remains
     `KickOutMember(charID)` on that corporation's registry. Self dispatch uses the
     shared mutation lock and ten-second cooldown, ends the lock when the RPC
     returns, and restores the prior timer on refusal. Original compiled
     `carbon/common/script/sys/sessions.PerformSessionChange:418-501` confirmed
     these rules, including `None` without a corporation change. Actual native
     and gateway quits, a held real native reply, concurrent-write refusal,
     cooldown and refusal rollback were verified. Native dispatch also retains
     the originating corporation generation through asynchronous binding; a
     delayed real bind across an actual join/departure retired the queued write,
     and returning to the same corporation ID did not revive its old generation.
     Old corporation bind replies cannot publish their object into the new cache.
     **c4c2b implemented:** the shared submenu calls `UpdateMember` with
     `[self,None,None,None,0,0,0,0,0,0,0,0,None,0,1]` after
     `ConfirmRemoveAllRoles`. Confirm Quit reads `CanBeKickedOut(self)`, then
     the native retained `GetWars(allianceid or corpid)`, counting nonmutual
     wars whose `timeFinished` is None, including future declarations. The
     active-war Yes/No warning precedes the final OK/Cancel confirmation;
     the native resignation guard covers only that final prompt.
     Pilot/corporation guards survive menus and dialogs. Dispatch retains the
     originating corporation; the successful reply may apply its intended
     corporation change while still rejecting pilot replacement. Session-busy
     refusals use the installed `PerformSessionChangeInProgress` dialog and
     typed `eveSessions.GetReason:170-285` labels, with the native rounded seconds.
     Desktop/390px phone, each Cancel, actual role removal/24-hour stasis refusal,
     a two-war warning from active/future/mutual/finished fixtures, and successful
     native departure were verified. Held actual replies and old confirmations
     retire without subsequent requests after pilot/corporation replacement.
     The compiled merge keeps Quit once for member-list self-plus-peer selection.
     However `userentry._GetMultiMenu:460-541` omits `CharacterMenu` for contact-list
     multiple selection; Contacts therefore omits Quit there. Single contact and
     search menus share it with Member List. Peer, CEO and NPC-self gates remain.
   - **c4c3: Expel Corporation Member(s).** Complete the single and merged
     multiple callbacks together, including authority/eligibility differences,
     war warning, confirmation, self refusal and kicked/notKicked result dialog.
     Multiple expulsion calls `KickOutMembers` directly after the confirmations;
     it does not perform the single-target eligibility read per selected ID.
     **Implemented:** Contacts/search and Member List share the single-target
     submenu; contact-list multiple selection retains its separate contact menu.
     Member List merges eligible nonself member targets, retaining the plural
     callback even when only one target survives. That case uses the single
     named confirmation followed by `KickOutMembers([target])` and its result
     dialog. Quit and Expel share the native war and final-confirmation guard.
     Both kick writes retain their originating corporation through dispatch;
     only single self departure creates a session mutation/cooldown.
     Compiled gates, merge classification/arguments, callback order, self refusal
     and partial-result formatting were checked in the installed Python runtime.
     Live desktop/phone covered single refusal and success, cancellation, merged
     self exclusion, partial/all-failed results, an online expelled recipient's
     corporation change, and read/dialog/result retirement after pilot replacement.
     Actual plural packets contained one ID list and no per-member eligibility
     calls. The native result's kicked/notKicked lists drive the displayed names.
4. **D2p18c4d — CEO resignation.** Read the complete candidate, warning, picker and
   session-change flow (`base_corporation:785+`). It distinguishes a successful
   `None` from a replacement-candidate list. Its default confirmation is No.
   The corpus has a real disband recording; its companion Markdown describes an
   older server state, so inspect current handlers and parity ledgers before
   treating any listed difference as an outstanding defect.
   Read/split: original compiled `base_corporation:780-824` confirms space refusal
   before the CEO check; retained member count; default-No destruction/resignation
   warnings; `PerformSessionChange('corp.resignceo')`; then either completed None or
   a candidate list. An empty list still opens the picker. A choice explicitly
   calls `ResetSessionChangeTimer` before the second guarded RPC. The private
   callback refuses sole-member alliance destruction inside that guarded operation.
   The TQ disband capture (call3275, lines263/790) decodes to bound
   `ResignFromCEO(None)` and a None response; it records no candidate-list case.
   Current server code already implements one-member liquidation and successor
   changes; the companion Markdown's missing-liquidation list is historical.
   - **c4d1: transport prerequisite, implemented.** The typed CEO mutation names
     its originating registry while sending native `ResignFromCEO(None or ID)`.
     It retains the pilot/corporation generation, locks until the actual RPC
     returns, starts the native ten-second cooldown, and restores the timer on
     refusal. Returned successor IDs authorize only their original operation's
     explicit timer reset and retry; another pilot in the same corporation cannot
     use that choice. The sole-member alliance refusal runs inside the guarded
     mutation before RPC, using retained native member IDs without draining notices.
     Actual native and gateway successor handoffs, concurrent-write refusal while
     a native reply was held, cooldown/reset and refusal rollback were verified.
     Funded disposable solo liquidation returned None, paid the exact two-division
     balance and changed the pilot to its NPC corporation. Its native recording
     also exposed wallet shapes and lifecycle ordering fixed in EveJS; the
     original full store is restored after the live walk. No menu is exposed
     until c4d2 supplies the complete callback.
   - **c4d2: complete shared submenu and flow, implemented.** Contacts/search and
     Member List share the self/CEO submenu. Contact-list multiple selection omits
     it; Member List self-plus-peer offers it once. The callback checks space
     before CEO authority, reads retained member IDs, and asks the potential-CEO
     query only for multiple members, using the actual list length. All three
     warnings default to No. None completes; a candidate list, including empty,
     opens the single-choice picker. Unique owner priming preserves duplicate
     rows; stable lowercased ordering follows compiled ListWindow109-204. There
     is no initial choice, OK without a choice stays open with its native error,
     and double-click selects then confirms. Cancel and Escape finish without a
     successor write. The selected retry uses c4d1's operation-specific reset.
     Original pilot/corporation guards survive reads, warnings, naming and both
     mutations; pilot/corporation replacement clears a pending picker, while the
     intended own disband session change is accepted.
     Live desktop/390px phone verified the menu, default-No prompt, initial error,
     empty-selection OK, Cancel and double-click handoff. Native AppFlow walks
     covered merged gates, stale authority, held replies, destruction warnings,
     pilot replacement, alliance no-RPC refusal, cooldown dialog and actual solo
     disband/NPC session. Store and settings are restored after staging. Hidden
     browser screenshots were unavailable; rendered accessibility states and
     measured bounds establish the UI checks. Zero-potential and empty-candidate
     branches follow the original compiled callback, not a captured live EveJS
     case; the server's current fixtures do not produce those lists. Later
     administration units remain required.
5. **D2p18c4e — decorations.** Read the complete award window, menu merge, available
   decorations and write before exposing either single or multiple award actions.
   Read/split: compiled `CharacterChecker.OfferAwardCorpMemberDecoration:95-102`
   excludes NPC targets, an NPC pilot corporation and nonmembers, then uses
   `SessionChecker.IsPersonnelManager:92-93` (the Personnel Manager bit, without
   a separate Director alternative). Self is allowed. Compiled menu merge treats
   the award caption as a multi-function and passes one list of eligible IDs.
   Contact-list multiple selection still has its separate userentry branch.
   `menuFunctions.AwardDecoration:54-73` reads `GetAllCorpMedals(session.corpid)`,
   raises `MedalCreateToAward` for no options, primes recipient names, and opens
   ordered1 generic ListWnd with the medal titles/IDs, Name header and a hint of
   the first five recipients followed by `, ...` where longer. Picker Cancel
   stops; a choice calls `medals.GiveMedalToCharacters`.
   Compiled `medals.GiveMedalToCharacters:93-124` checks Director OR Personnel
   Manager, asks NamePopup for an empty reason (maximum200), stops on empty/Cancel,
   and calls `corporationSvc.GiveMedalToCharacters(medalID, recipientIDs, reason)`.
   A server `ConfirmGivingMedal*` error uses its actual cost, amount and localized
   recipient count in a Yes/No prompt with suppressYes; only Yes retries with
   fourth argument True. `NotEnoughMoney` is shown; other errors propagate.
   No fixed price or unconditional confirmation is inferred from that wrapper.
   - **c4e1: native award contract and server audit, implemented.** Decoded the recorded
     GetAllCorpMedals cached-object read and verify current native catalogue,
     recipient-list write and received-medal readback with disposable fixtures.
     Examine cache invalidation and recipient live updates against
     `medals.OnMedalIssued:139-145` and DecorationsPanel's update consumer;
     fix/commit any actual native mismatch before exposing the action. Exact
     award/confirmation/notice bytes are not in the current recording corpus.
     Actual native Python-list recipients previously became recipient0; Unicode
     title/description/reason became `[object Object]`. EveJS now decodes both
     native values and sends successful-write creation and recipient refreshes.
     Fresh native single/both-member awards preserved accented text, reached the
     intended recipients, and refreshed the cached catalogue through the existing
     native-consumer invalidation helper. The browser read is not exposed yet;
     its allowlist correctly refused the first BFF probe. No live browser refresh
     is claimed here. Exact notice arguments/masks/fanout remain unrecorded;
     implementation uses the minimum consumed by the original handlers, not a
     claim of captured Tranquility bytes. Full disposable store was restored.
     Existing server assertions and harness inputs now name native list/Unicode
     values and the original refresh consumers; they were updated, not run.
   - **c4e2: complete shared award UI, implemented.** Includes the gates/merge, no-medals
     refusal, ordered single-choice medal picker, recipient hint, reason prompt,
     all cancellations, conditional confirmation/retry and errors together.
     Preserve originating pilot/corporation through reads, dialogs and dispatch;
     update the recipient's live view from native notices. Verify single/self/
     multiple targets, Director-versus-personnel gates, each cancellation and
     actual award/recipient effects on desktop/phone, with native wire and full
     store/settings restoration. No partial menu or placeholder is exposed.
     Contacts/search offer the single action; Member List merges eligible IDs
     into one call, including self. Contact-list multiple selection omits it.
     The ordered picker starts unselected, retains the native selection error,
     accepts double-click and cancels with Cancel/Escape. NamePopup requires a
     reason and limits it to200 UTF-16 units, as the installed Python27 runtime
     confirms. A top-level corporationSvc write carries only the native scalar
     medal ID, Python recipient list and Unicode reason (optional fourth True
     after server-requested confirmation). The originating corporation is private
     BFF context, checked again at the actual send; it never becomes a native
     argument or changes this RemoteSvc into a moniker call.
     Actual empty-catalogue refusal, single/self/merged awards, role128 award,
     revoked-role refusal, cancellations, held-read/pilot replacement, wrong-origin
     no-RPC refusal and recipient cache invalidation were verified. Desktop and
     390px phone screenshots/AX/bounds verify both prompts and merged menu. The
     existing BFF notice consumer refreshes a recipient's GetMedalsReceived cache;
     this owner action does not add a Character Sheet decorations panel.
     ConfirmGivingMedal*/NotEnoughMoney branches follow the original compiled
     callback, including actual error values and suppressYes; the current server
     did not produce those errors, so no live fee/retry case is claimed. Full
     store/preferences restored. Other corporation and character panels remain.
6. **D2p18c4f — recruitment invitations, implemented.** Native `InviteToJoinCorp` asks
   `ConfirmSendInviteToJoinCorp`, then calls bound `InsertInvitation(charID)`.
   The recipient acceptance/decline/session behavior and required notices are
   ported from the recorded applied path and compiled direct-invitation consumers.
   Read/split: compiled `CharacterChecker.OfferSendCorpInvite:332-341` rejects
   multiple selection, NPC targets, missing Personnel Manager and current members.
   It has no separate NPC-pilot-corporation gate. `base_corporation:1145-1149`
   asks OK/Cancel with charID and sends nothing on Cancel; OK calls the current
   registry. No merged invitation action or extra warning is inferred.
   The web app's My Applications panel is now ported. Native
   `ApplicationsWindow:50-90,95-151,231-301` hides top filters and invite button
   in myView, flattens all of `GetMyApplications`, primes corporation names,
   sorts newest first and retains expanded application per myView. It receives
   `OnCorporationApplicationChanged`. `bco_applications:22-95` keeps the personal
   dictionary across corporation changes and updates application rows from those
   notices. The BFF now retains the original login dictionary and native rows,
   amends it behind in-flight reads, and clears it only with the character session.
   Compiled `CorpApplicationEntry:594-644,686-778` offers Accept for statuses6/8;
   ended statuses2/3/4/7 have only Show Info. The direct invitation's Decline
   button calls status3 without a prompt. The context-menu item labelled Decline
   calls WithdrawMyApplication instead: WithdrawApplication Yes/No, then status7.
   This difference is in the original compiled method and must be preserved.
   `bco_applications.UpdateApplicationOffer:141-143` uses a temporary named lock,
   sends seven arguments including default empty customMessage and None date,
   and has no PerformSessionChange cooldown. Preserve the row's applicationText
   type; the recorded acceptance forwards Unicode (`0x2e` PyWStringUTF8), as
   supplied by the native application row, rather than newly entered text.
   The companion and raw `Archive/Applying and accepting a corp invite` capture
   concern applied0 -> corporation-accepted6 -> applicant-accepted2, not direct8.
   Historical gaps in its companion are not evidence against current handlers.
   No direct InsertInvitation packet was found by the recursive corpus search.
   - **c4f1: native contract audit, implemented.** Verified direct invitation8, button rejection3,
     context withdrawal7 and acceptance2 on disposable native sessions, including
     active/history reads, packed rows, persistent/live notices and post-join
     membership/session effects. Compare the recorded acceptance path only where
     applicable; fix/commit any proven server mismatch before UI work.
     Actual direct decisions return None, remove the active row and retain ended
     history. NPC acceptance sends sparse client member change, corpid/hqID
     session change, full member changes and application2 before the None reply.
     Applied0/accepted6/joined2 was also verified with accented text. Structured
     TQ decoding and CCP blue DBRow Read/Get exposed an additional row mismatch:
     status must be UI1/17, responseText STR129, and applicationText explicitly
     Unicode. EveJS327cc6de3 fixes the shared builder. The same persisted native
     application changed from bytes to Unicode after restart, with no data repair,
     then completed0/6/2. Fresh direct8/3/7/2 rows use the corrected types too.
     Native type139 invite receipts supply corpID consumed by the formatter;
     notificationCenter356-362 opens My Applications for types139/18/17/142.
     Direct notification bytes remain unrecorded. Full store restored byte-exact.
   - **c4f2: complete recipient My Applications panel, implemented.** Recruitment
     exposes it for NPC and player corporations. Entries show the native logo,
     corporation, status/date and expandable label text, newest first; one entry
     expands at a time, retained per character. Personal filters/Invite stay hidden.
     The retained historical-view setting still reads GetMyOldApplications;
     ordinary views use the native personal dictionary, including ended rows
     received during this session. The Python27 strip character sets were measured
     in the installed runtime (Unicode differs from JavaScript trim).
     Accept6/8 sends2 immediately; the invitation button sends3; its menu's Decline
     and other active rows' Withdraw ask WithdrawApplication then send7 on Yes.
     Ended rows offer only Show Info. The temporary decision lock has no invented
     session cooldown. All seven native arguments preserve the original row's
     Unicode text, empty byte customMessage and None date. The private originating
     registry fence is separate from the target corporation argument and never
     goes on the wire. Native corporation/version and pilot dispatch checks fence
     late requests; an intended own join keeps the personal panel alive.
     Types139/18/17/142 open this panel from popups and Activity; served requests
     are consumed. Self application notices reload the docked station's offices
     (base_corporation_ui204-209 / OfficesPanel46-72), including a queued reload.
     Cold-started live browser/390px checks saw8→3,8→7 with No/Yes,8→2 and0→6→2,
     expanded Unicode text, NPC access, retained ended rows and actual joins.
     An actual type139 popup opened the second recipient's panel; a persistent
     type18 entry opened the first's. AppFlow verified cancelled/stale-pilot
     withdrawals, history setting and wrong originating registry refusal.
     The wire recording has one personal prime per selected BFF session and the
     native seven arguments for every decision. The sender unit below completes
     the shared invitation action.
   - **c4f3: complete shared send action, implemented.** The character owner menu
     exposes SendCorpInvite for a single non-NPC character outside retained
     GetMemberIDs, with Personnel Manager bit128. There is no separate NPC-pilot
     corporation gate and no merged action. Contacts/search distinguish character
     owners by eveowners type; Member List omits the action for current members.
     ConfirmSendInviteToJoinCorp receives charID and OK/Cancel; Cancel sends
     nothing, OK sends bound InsertInvitation(charID), with the originating
     registry/pilot fence through dispatch. Live role0 omitted the action and
     Personnel-only128 offered it; stored Director1 expanded to an effective mask
     containing Personnel128, so it also offered it by that same native bit check.
     AppFlow verified the full target/multiple/membership gates, Cancel, replaced
     pilot and wrong originating-registry refusal. Browser Corporation Contacts,
     personal Contacts and search offered the action; Member List omitted it and
     mixed ContactMultiple had only its native Edit/Remove. Desktop OK sent one
     argument and the actual NPC recipient's browser showed Directly Invited,
     then its Decline retained Invitation Rejected. Desktop/390px Cancel added
     no RPC. Native recording contains exactly the two confirmed sends (AppFlow
     and browser), both bound and scalar, plus the recipient row/139 notification.
     No direct TQ invitation packet was found; only the companion mentions this
     separate path. Full store/settings restoration is recorded in the journal.
7. **D2p18c4g — corporation cash from the shared menu.** Reuse the existing wallet
   transfer machinery only after comparing its corporate-source, recipient,
   division and authority behavior with this exact native entry point.
   Read/split complete: compiled CharacterChecker292-300 allows a single non-NPC
   character, including self, only with Accountant256 (not Junior or a take bit).
   menusvc652-653 opens TransferMoney(session.corpid, None, charID, None).
   walletSvc142-151 closes the previous transfer window and opens the new one;
   it adds no active-division chooser, authority read or confirmation here.
   TransferMoneyWnd108-123 reads fresh GetCorpWealth(None) before capturing
   session.corpAccountKey. The source division is a label, not a selector. This
   character-recipient entry has no destination-division combo. Amount starts
   at0.1, has two decimal places and a wealth maximum; reason has40 characters.
   Confirm138-155 sends GiveCashFromCorpAccount(toID, float(amount), capturedKey,
   toAccountKey=None, reason=originalEditValue). None is successful; an exception
   leaves the window open. No second confirmation is present.

   The original compiled methods executed in the installed Python27 runtime
   confirm those gates/call arguments, the None-before-active-key read, and the
   native quirk: OnCorpAccountChangedClient updates a corporate transfer's
   maximum for any corporation division, without filtering its captured key.
   The captured source key must not be silently rebound when the active division
   changes. walletSvc80-119 first checks corporation wallet access and the
   event division's take bit, obtains the previous one-minute cached wealth,
   updates that cache, then emits the client event. That cache/event consumer
   is missing from the current personal-only transfer machinery.

   Recursive TQ search found the Archive/Open Wallet - Plex - Corp Wallet -
   Corp Transfers capture. Its companion was read to the end before the raw
   packets. Decoding1804-1824 shows (2124510715,100.0,1000), keyword None/empty
   reason, corporation then personal OnAccountChange before a None reply.
   GetCashBalance(1, accountKey=None) is also recorded, with active key1000.
   No alternate-active-key default is established by that recording; the other
   corpus accountKey1002 matches are membership notices, not wallet reads.
   Historical companion claims of lighter role validation are not evidence
   against the current source-division validator.

   - **c4g1: native corporation cash contract audit/fix, implemented.** Actual
     native sessions exposed two retail-client defects. With active1001 and
     balance50.25 there, None read the empty master division; walletSvc156-164,
     TransferMoneyWnd108-123 and CorpISKTab34/50 consume this as active-division
     wealth. EveJS118c86baf resolves missing/None corporate keys from the session,
     preserving explicit keys, personal reads and authority. A raced amount50
     against source49 returned None without a debit, which compiled Confirm
     falsely calls successful. EveJS780fa9f82 raises wrapped NotEnoughMoney with
     amount50/balance49; the native re-check saw unchanged balances/no notices.
     Both fixes are pushed. These default-key and exact error payloads are
     inferred from native consumers/existing wallet error convention; they are
     not captured from TQ for an alternate active division or a shortfall.
     Live ordinary reads were denied, Junior/Accountant reads permitted,
     Accountant without Take denied a debit, and Take2 permitted its own read.
     Explicit captured1001 still debited after active changed to1000, including
     a self transfer. Success remained None, corporation cash2 then personal
     cash notices before the reply, matching the applicable recorded order.
   - **c4g2: complete corporation wealth cache/event foundation, implemented.**
     Fresh GetCashBalance(1, accountKey=None/explicit) never fills the one-minute
     notice cache. Only native UserError becomes0; session/transport failures
     propagate. The compiled methods confirm strict >MIN expiry and timestamp
     after the read. Own corporation cash/cash2..cash7 notices pass wallet access
     and the division's take bit, read the old cached wealth, update, then emit
     local OnCorpAccountChangedClient balance/key/difference. Accountant/Junior
     read authority alone does not pass this notice gate. Pending reads/events
     keep the captured pilot/corporation; per-key cache survives ordinary corpid
     changes as native WalletSvc does, and clears on character reset/logoff.
     Actual AppFlow/native wire verified separate fresh/cached calls, cached
     delta1.25 with no RPC, cold notice explicit read followed by delta0,
     foreign-division omission, real elapsed-minute expiry, delayed old-read
     retirement, reset on same-pilot replacement, native refusal-to0 and genuine
     missing-session error propagation. No cash action is exposed yet.
   - **c4g3: complete shared TransferMoney window and character menu action,
     implemented.** Contacts/search and Member List offer native single-character
     Accountant cash, including self. One window per pilot replaces the previous
     transfer, displays the source corporation/division or personal owner and
     recipient with64px pictures, and uses original labels/amount/reason/OK/Cancel.
     The corporate fresh None read precedes active-key capture. The key remains
     captured; any eligible division's client event updates its maximum. Personal
     OnAccountChange updates only a personal transfer. Background pilots retain
     hidden window edits; pilot replacement/logoff retires them, corporation
     replacement retires a corporate source while leaving personal cash intact.

     Native numeric-field compiled methods prove that SetMaxValue leaves old text
     untouched and GetValue reads it without reclamping. Typing cuts decimal text
     (2.559 ->2.55, preserving2.55); its upper bound is applied during input,
     focus loss repairs only the lower bound. Confirm reads that field value,
     so a raced/other-division maximum can still produce a genuine shortfall.
     Reason is40 characters and < > entities, nonempty typed Unicode on the wire.
     The corporate RPC has the native three arguments, float amount and None/
     reason keywords. Private originating-corporation metadata is checked against
     the native version through final BFF dispatch and is not a native argument.
     None success says TransferSuccessful and closes; UserError retains the
     window under the native refusal dialog. Cancel sends nothing; no extra
     confirmation or division selector is inserted. Existing personal Give Money
     now uses this same window and its original GiveCash three-argument call.

     Actual AppFlow verified ordinary/Junior/take-only omission, Accountant offer
     without take then native debit refusal, target/self/multiple gates, Cancel,
     replacement, wrong origin, Unicode/2.55 and both success/refusal paths.
     Browser Corporation Contacts, search and Member List opened the window;
     Member List self was allowed and multiple omitted. Desktop other-division
     notice allowed100 while captured1001 held47.45, which raised the real native
     NotEnoughMoney and retained the window. Its subsequent2.55 succeeded. Phone
     fields/buttons fit and2.559 became2.55; Cancel left wire count unchanged.
     Personal browser Give Money succeeded. Final build retained5/reason edits
     while switching to a second account's pilot, hid the background window, and
     restored those edits on switching back. All pilots/settings/store restored
     as recorded in the journal. Generic wallet deposit/destination-corporation
     selection remains its own entry point.

Configured double-click-to-chat and simultaneous information windows remain after
these administration units. The rest of the Corporation window and Phases 5/6 are
still required; this contract does not declare them complete.

## Evidence and limits

Recursive recording searches include the corporation creation, role-receipt and
CEO-disband captures. `GetEveOwners()` is recorded with no arguments on the bound
corporation object in multiple corpus captures. A recording of an unrelated login does
not prove a particular menu click or all administration flows. Search again for
each newly discovered call/notice before its source implementation.

The original compiled Python-2.7 methods were executed in the installed retail
runtime for eleven gate combinations, membership retention/notice mutation and
the member-window reuse cases. These are native-code observations, not a run of
this repository's tests. No product UI changed in the sizing unit. Later units
require cold-started servers, actual wire and browser/phone verification where
visible, captured-pilot retirement checks, full store/settings restoration, and
commits pushed in each affected repository.
