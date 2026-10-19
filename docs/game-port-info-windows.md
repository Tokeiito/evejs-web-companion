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

## Asynchronous reconstruction (c6b2, next; c6b is not complete)

Read and execute the original InfoWindow.OnBack/OnForward61-73,
InfoWindow.change_info_content37-40, BaseInfoWindow.ReconstructInfoWindow45-55
and _stop_reconstruct_thread65-75. Ordinary history ignores input while loading;
changing content or closing a window retires its reconstruction thread. Ship
history uses the base reconstruction path and its pendingLoadData handling.

The page currently discards stale displayed results with per-component tickets,
but that alone does not stop later RPCs inside an old asynchronous read. Port
the per-window loading, cancellation and pending-reconstruction rules with real
held native replies, without cancelling another window's reads or shared caches.
Prove rapid reuse, close, history while loading, independent simultaneous reads,
pilot retirement and the actual call order before advancing to other Members
panels. This is required follow-up, not a declaration of complete info parity.

The Corporation window, the rest of its panels, and Phases5/6 remain unfinished.
