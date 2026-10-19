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
   - **c4d2: complete shared submenu and flow.** Preserve self/CEO gates and the
     contact-multiple caller distinction. Use the native retained member IDs for
     `len(GetMembers())`; request `GetNumberOfPotentialCEOs` only on the many-member
     branch and use the actual returned list's length. Implement every warning,
     refusal, cancellation, both mutations and the successor picker together.
     Compiled `ListWindow:109-204` sorts case-insensitively and stably when ordered1,
     starts with no selection and the one-choice error, keeps OK open without a
     choice, and confirms on double-click. Owner priming deduplicates IDs while
     candidate rows retain the returned entries. Hold the original pilot/corporation
     across all dialogs, sorting/naming and dispatch; accept intended own changes.
     Verify desktop/phone, candidate cancel/choice, native session-busy behavior,
     alliance/space refusal and actual disband/role/session effects, with full
     store/settings restoration. Keep every later administration unit in scope.
5. **D2p18c4e — decorations.** Read the complete award window, menu merge, available
   decorations and write before exposing either single or multiple award actions.
6. **D2p18c4f — recruitment invitations.** Native `InviteToJoinCorp` asks
   `ConfirmSendInviteToJoinCorp`, then calls bound `InsertInvitation(charID)`.
   Complete the actual acceptance/decline/session behavior and notices required by
   its existing UI, using recordings and compiled code as available.
7. **D2p18c4g — corporation cash from the shared menu.** Reuse the existing wallet
   transfer machinery only after comparing its corporate-source, recipient,
   division and authority behavior with this exact native entry point.

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
