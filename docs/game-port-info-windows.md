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

## Window policy (c6b, not implemented yet)

This is one complete window-management unit rather than a collection of extra
Show Info buttons. The existing global subject and one TabID cannot express it.

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
- Different subject or params reconstruct and maximize. Duplicate modern
  character/corporation/ship content with matching params does neither here.
  Legacy content reconstructs even for a duplicate. Reused content may change
  between modern character/corporation and legacy content; branchHistory is
  false for a duplicate or traversingHistory.
- Each window retains its own content, selected tabs, history and placement.
  Closing/minimizing/reopening must preserve the native selection and history
  rules. Read BaseInfoWindow.ReconstructInfoWindow/GetHistoryData and both
  modern/legacy history navigation before building that part. Inactive pilot
  windows must not become the active pilot's global subject; character logoff
  clears info windows (DoSessionChanging390-396).
- The account checkbox uses
  UI/SystemMenu/GeneralSettings/Windows/TryUseExistingInfoWin,
  settings.user.ui.useexistinginfownd (systemmenu2427-2430). Provide Shift and
  explicit new/addNewWindow openers, and retain independently reachable windows
  on phone as well as desktop. Audit all current showInfo callers and the old
  ShowInfo target/panel tests against these native rules in the same unit.

Original compiled ShowInfo and its original bucket/registration helpers were
executed in the installed Python27 runtime. They confirmed default newest-window
reuse, duplicate modern no-op, changed params, new/addNewWindow/preference/Shift,
ordinary/progress modal behavior, duplicate legacy reconstruction, the separate
ship bucket, history branch suppression and the unknown-faction prompt.
The ignored journal retains the oracle output and live evidence for each unit.

The Corporation window, the rest of its panels, and Phases5/6 remain unfinished.
