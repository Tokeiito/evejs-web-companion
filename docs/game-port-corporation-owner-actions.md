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
2. **D2p18c4b — shared View/Edit Member Details.** Add the shared owner action to
   Contacts/search and Member List, reusing the existing complete member dialog.
   `memberDetails.OpenMemberDetails:9-16` maximizes an existing window for the same
   character; for another character it closes that window and opens the new one.
   The installed compiled function confirmed all three cases. Preserve its
   General/Roles/Titles/Summary/Give Shares behavior and save permissions.
3. **D2p18c4c — roles and leaving/expulsion.** Complete both native submenus and
   their callbacks. `base_corporation.RemoveAllRoles:482-487` asks its dialog and
   sends all eight role masks zero, `titleMask=0`, `blockRoles=1`. Allow sends the
   fifteen-position optional update with `blockRoles=0`. `KickOut:397-461` checks
   eligibility, active non-mutual unfinished wars, then the self/other confirmation
   before the write. Multiple expulsion has its own self refusal, results and
   failed-member wording (`461-477`). Read compiled branches and wire recordings
   before implementing; retain exact session-change behavior for leaving.
4. **D2p18c4d — CEO resignation.** Read the complete candidate, warning, picker and
   session-change flow (`base_corporation:785+`). It distinguishes a successful
   `None` from a replacement-candidate list. Its default confirmation is No.
   The corpus has a real disband recording; its companion Markdown describes an
   older server state, so inspect current handlers and parity ledgers before
   treating any listed difference as an outstanding defect.
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
