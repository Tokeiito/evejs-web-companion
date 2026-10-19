# Information windows: native policy and remaining port

Read against build3396210 on2026-10-19. Authority is
`eve/client/script/ui/shared/info/infosvc.py` and its original `.pyc`,
`infoWindow.py`, `baseInfoWindow.py` and systemmenu's window settings. Recursive
Tranquility searches for useexistinginfownd/addNewWindow/traversingHistory found
no exact capture; these are local window-policy observations, not recorded user
gestures against Tranquility.

## Owner menu targets (c6a)

`User.ShowInfo`549-552 and menusvc's character entry579-580 pass the actual
cfg.eveowners type and owner ID. GetMenuFromItemIDTypeID2281-2297 includes Show
Info for corporation/alliance/faction owners as well. Explicit Show Info ignores
the configured double-click action. Original compiled User.ShowInfo confirmed
type2 corporation, type30 faction, type16159 alliance and a character's own type.

The shared Contacts menus previously omitted info for non-character owners and
their handler assumed character. They now expose typed owner information in
personal/organization Contacts and owner search. The guarded owner dispatcher is
also used by default double-click. `eveCfg.LoadEveOwners`548-584 preloads faction,
NPC corporation and NPC character rows locally, with type30/2/1373 respectively.
The BFF's ownerType name lookup now resolves those local types; player owner
types continue to use the existing native GetMultiOwnersEx cache. No new RPC is
introduced for a known NPC/faction type.

## Window manager (c6b1, implemented)

The global subject and single TabID have been replaced by a synchronous command
bus and a window registry owned by each pilot's AppFlow. The native policy below
governs independently retained content, history and geometry. The asynchronous
reconstruction work described after it remains a separate required unit.

- `ShowInfo`412-454 creates if `new`, account `useexistinginfownd` is false
  (default1), or Shift is held; addNewWindow also forces creation. A modal
  forces creation and ShowModal, except the progress modal skips ShowModal.
- `_GetInfoWindowClass`205-209 separates ship-category windows from ordinary
  InfoWindow. Character/corporation content classes share the ordinary bucket;
  faction/alliance/type/place legacy content does too. They are not separate
  buckets for each owner or subject.
- Windows register in creation order231-236. The compiled ShowInfo chooses the
  newest matching bucket window when reusing. It overwrites an earlier
  last-active candidate; `_GetLastActive(typeID)` also receives a different key
  from `_SetLastActive(window class)`. Do not substitute a preferred “most
  recently focused” algorithm.
- Different subject or params reconstruct and maximize in the native code. Current
  browser openers carry no params/rec/abstractinfo; their native values are None.
  Duplicate modern
  character/corporation/ship content with matching params does neither here.
  Legacy content reconstructs even for a duplicate. Reused content may change
  between modern character/corporation and legacy content; branchHistory is
  false for a duplicate or traversingHistory.
- Each browser window retains its own content component, scroll position,
  history and geometry. App keeps the components mounted between pilot switches;
  a portal moves them onto the active cockpit surface. Inactive pilots' windows
  stay hidden. Ordinary windows and info windows share the desktop focus order.
  Minimized instances remain reachable in the desktop strip and phone selector.
  Character replacement, release, logout and confirmed connection loss clear
  that pilot's registry (DoSessionChanging390-396). Current content is the page's
  existing sections; native content tabs and additional rec/abstractinfo/params
  callers remain part of those content ports.
- The account checkbox uses
  UI/SystemMenu/GeneralSettings/Windows/TryUseExistingInfoWin,
  settings.user.ui.useexistinginfownd (systemmenu2427-2430). The native checkbox,
  Shift gestures and explicit new/addNewWindow requests are implemented. Owner
  helpers capture Shift before the page's asynchronous cfg read. Every current
  showInfo caller uses the same bus; synchronous multi-member requests retain
  their order. Obsolete global-target/repeat-raises/tab assertions and the unused
  sameSubject helper were removed; content render fixtures now own their signal.

Original compiled ShowInfo and its original bucket/registration helpers were
executed in the installed Python27 runtime. They confirmed default newest-window
reuse, duplicate modern no-op, changed params, new/addNewWindow/preference/Shift,
ordinary/progress modal behavior, duplicate legacy reconstruction, the separate
ship bucket, history branch suppression and the unknown-faction prompt.
The ignored journal retains the oracle output and live evidence for each unit.

Content class selection now reads the installed client's type/category data and
the original idCheckers ranges, with cfg owner groups for old dynamic IDs. A
ship category wins before owner classification; type-only corporation info is
legacy content. The original requested type is retained through history even
when the rendering subject is normalized to a character/corporation. Native
type0/group0 is valid client data; the BFF preserves zero owner types so a
generic non-owner stays legacy rather than becoming a character. No EveJS fix
was needed for that row. The compiled ID helpers and actual client tables,
AppFlow/native reads, desktop/390px controls and native account replacement
verified these paths.

Live browser checks covered two Shift-opened owner windows, independent resize
and movement, newest-created reuse after older focus, Back/Forward between
character/corporation content, duplicate modern minimized no-op, preference-off
duplicates, and both entries of a multi-member info action. Phone selectors keep
each instance reachable. Account settings are separate, persist across reloads
and fit390px. Actual wire counts stayed unchanged through focus, minimize,
viewport changes and background-pilot switching. A real native login replacing
the account cleared both final-build info windows and returned the pilot offline.

## Asynchronous reconstruction (c6b2, split; c6b is not complete)

Original compiled methods were executed in the installed Python27 runtime. The
oracle controls tasklet entry/kill observations; that DLL lacks _stackless and
cannot reproduce the Blue scheduler. The observed rules are:

- Ordinary InfoWindow._ReconstructInfoWindow95-122 sets isLoading through its
  content reconstruction and clears it in finally. OnBack/OnForward61-73 ignore
  input while loading. Base.ReconstructInfoWindow45-55 retains only the latest
  pending request while that flag is true, without appending history or starting
  another tasklet. The ordinary method invokes the base completion while still
  loading: the retained request is requeued there and remains pending after the
  outer finally. Do not invent an automatic drain after clearing the flag.
- ShipInfoWindow's compiled reconstruction never accesses isLoading. Its history
  uses Base.ReconstructInfoWindow without the ordinary history guard. Do not
  infer an ordinary loading flag or busy queue for ships from the base alone.
- Base.Close98-105 and change_info_content37-40 kill the registered reconstruction
  tasklet. Same-content ordinary NavigateHistory75-86 instead invokes
  _ReconstructInfoWindow directly, with no registered tasklet. A blanket policy
  that cancels every read on close would overstate these native methods.
- Ordinary ShowInfo reuse calls change_info_content +ConstructLayout45-49,
  creating fresh content. Same-class history instead reconstructs the existing
  content; InfoWindowMonolith.ReconstructSubContainer897-902 flushes the main
  content and creates new Scroll/EditPlainText controls on every reconstruction.
  InfoWindow.GetHistoryData132-138 retains identity, not a scroll offset.
  Focus, minimize and pilot switching do not rebuild content. A duplicate modern
  ShowInfo does not reconstruct. Ship controls require their separate reading.

c6b2a ports ordinary content replacement and scroll reset on reconstruction. Each
window's chrome and geometry remain retained.

c6b2b1 scopes the existing corporation public-info/attribute read chain to its
reconstruction. Close and reuse retire its registered read, and dispatch checks
run inside the shared request lane as well as between phases. An in-flight
native reply still passes through the pilot's notification sink; retiring one
window does not cancel the shared transport or another window. Same-content
ordinary history has an unregistered scope, matching NavigateHistory's direct
call. Pilot retirement invalidates every scope. UpdateDataCorp1226-1233's existing
friendly-fire and enlistment reads now run in their native sequence. The original
compiled attribute method confirms aggression before enlistments, with no later
call after interruption. This does not claim the complete corporation header,
service caches, native content tabs or all its data reads have been ported.

c6b2b2a marks the ported corporation public-info/attribute coroutine busy until
its finally, and ignores Previous/Next while that scope is busy, as ordinary
OnBack/OnForward61-73 do. History controls retain their history-enabled state;
the click is ignored. Completion and registered retirement clear the flag;
other windows' work does not. Ship history has no ordinary loading guard.
This boundary covers the currently scoped corporation chain only.

Required c6b2b2b work remains: native content identity/history timing, other
ordinary headers' loading and complete reconstruction boundaries, pending-load
semantics, and retirement of other content-owned continuations. A newly found
corporation timing detail matters: original InfoContentBase.__init__ sets type
and item to None; CorporationInfoWindow.reconstruct_info_window49-51 waits for
GetPublicInfo before its parent assigns identity. Original compiled constructors
and method confirm that None identity at the public-info boundary. The page
still records requested identity immediately. Audit duplicate ShowInfo and
history placeholders during that interval before changing them. Read
each native content class's order and spawned/shared work first. Do not impose
ordinary loading on ships or an automatic pending drain unsupported by the
compiled methods. Existing tickets alone drop displayed stale results; actual
held native replies must verify every continuation newly placed under a scope.
The current sections are not complete native content/asynchronous parity.

The Corporation window, the rest of its panels, and Phases5/6 remain unfinished.
