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

c6b2b2b1 separates the requested identity from the identity assigned by content.
The corporation identity is initially unset for fresh content, becomes requested
after a successful public-info reply, and is retained from existing content until
that reply on same-class history. ShowInfo compares this assigned identity, so
an early duplicate reconstructs but a matching assigned identity does not, even
while later attributes are loading. Retired replies cannot assign a new scope.
Original compiled ShowInfo confirms unset/mismatched identity reconstructs and
matching type/item does not, including an original requested type34.

c6b2b2b2a records the ported corporation chain's history at native lifecycle
boundaries. A new slot is an empty-dict placeholder until normal completion.
Replacing registered work snapshots its assigned identity into that slot before
appending the next one; before assignment this records a None identity tuple.
Close uses with_history=False. Back/Forward snapshot actual assigned content,
advance the history index, and only then attempt reconstruction. The original
compiled stop/HistoryBuffer/ordinary navigation/type lookup confirm that Back
to the None tuple raises TypeNotFoundException locally, leaves displayed content
unchanged, and sends no server call. The compiled default exception handler
logs it with showExceptions=0, without a dialog. The page likewise logs this
specific local error; Forward repairs the old slot from current content before
reconstructing. Branching after Back trims the forward entries.

c6b2b2b2b1 moves the existing corporation coroutine into the per-pilot window
controller. Each scope owns one result signal; the view consumes it and cannot
issue another copy on mount, caption/focus changes or viewport moves. Same-class
history retains the old subject, result and controls until the successful
public-info reply starts the monolith parent. That boundary replaces the body
and resets its scroll once. The existing browser title updates on normal
completion, while the result feeds the new body. Close/reuse/pilot retirement
keep their registered/direct distinctions and cannot resurrect a closed view.

InfoWindow.GetCustomHeaderButtons puts Previous/Next in the chrome. They are now
header icon buttons on desktop, phone and modal windows, so scrolling does not
move them away. Window.ShowLoad/HideLoad1547-1568 and Prepare_LoadingIndicator1110
show a transparent blocking layer over content while the header controls remain
reachable. The ported busy scope similarly makes the body inert and draws its
loading indicator. Its label is the installed client's exact
/Carbon/UI/Controls/Window/Loading (Loading in English). Other panels keep their
existing chrome. Original compiled corporation wrapper, complete monolith body
and ordinary window method confirm old controls/caption at GetPublicInfo, flush
and fresh scroll after the reply, then caption assignment after content work;
UI/service shells record these boundaries, not Blue scheduling or all RPCs.

c6b2b2b2b2 keeps loading at the window while its direct corporation history
coroutine continues. ShowInfo still replaces the content/layout, but the busy
base saves only the latest pending tuple: no history append or new content read.
The new layout stays empty and unassigned. If the old ported coroutine reaches
caption completion, the original window method evaluates the new content's
missing type and throws the native caption exception. It logs by default;
finally clears loading without changing the old caption or draining pending.
A later ShowInfo starts normally; its completion encounters loading and retains
the pending tuple again. The compiled window/base/history/corporation/monolith
methods confirm this transition at service/UI recorder boundaries. Those shells
do not establish every destroyed native widget's continuation or RPC sequence.

c6b2b2b2c1 constructs fresh corporation content only after the successful public
reply starts the monolith. Before that boundary its layout is empty; a normal
public RPC exception propagates to the coroutine's default log rather than
becoming a successful null result. Finally clears loading. Direct history keeps
its old body/caption on that exception, with no reconstruction or later reads.
The failed registered scope remains available for the next stop to snapshot its
unassigned identity, matching the native retained tasklet pointer. Compiled
window/base/corporation methods confirm both exception paths. Native UserError
dialogs and BadArgs, and failures later in construction remain separate.

c6b2b2b2c2a first ports the corporation-record prerequisite. The page's
corp.GetCorporation facade keeps completed rows per pilot, reads its own
corporation from corpRegistry.GetCorporation and others from scalar
corpmgr.GetCorporations, and returns cache hits without another request.
Concurrent misses remain separate native reads. Character reset clears rows;
membership changes discard the new corporation's row. OnCorporationChanged
applies the native add/remove classification and updates cached columns only,
including the full-header gate for new rows. Ticker/UI work following that row
update remains outside this helper. Show Info's standings alliance lookup now
uses this shared record source. Other direct registry consumers retain their
existing explicit reads; this is not a claim of complete native service caches.

The original compiled None continuation confirms why this precedes c2b:
the parent assigns identity and constructs a fresh scroll, then the description
builder retries public info and obtains corporation shares through that cache.
Two None replies still perform the shares lookup before AttributeError on the
None record; loading clears, caption/history do not complete, tasklet remains.
A valid second record continues after replacing its shares with the row value.
These UI/service recorder boundaries do not establish all ancillary reads.
c2b now follows that None continuation. Identity assignment replaces history's
old scroll/body before the second public reply, but the visible content stays
empty until description work succeeds. The shares lookup uses the shared
corporation record cache, with its existing scope/pilot guard. A second None
still evaluates that lookup before throwing AttributeError; no attributes,
caption or normal history completion follows. A valid retry copies the row's
shares into the public record and continues the existing attribute chain.
Successful malformed records without corporationID also fail before visible
construction rather than completing a null result. The visible-construction
scope event is separate from identity assignment. These boundaries cover the
ported coroutine; full native partial widgets and ancillary calls remain below.

The corporation public-info server correction (EveJS 3858f28f6) removes its
integer friendlyFire field. The original compiled UpdateDataCorp checks integer
values before its friendly-fire branch: the captured old reply rendered `1`
and skipped the aggression lookup. The captured corrected reply uses the native
missing-field default `0.0` and takes GetAggressionSettings/GetCorpFriendlyFireStatus.
Tranquility's decoded public replies in Applying and accepting a corp invite.txt
(323/650) also omit that field. The stored corporation setting and corporation
row remain unchanged. The browser continues reading the aggression settings and
shows the resulting status; this correction does not complete later-read error
handling or the rest of the native public-info payload audit.

EveJS c5dbe704e also sends public shares as the byte string recorded in those
two Tranquility replies. Executing the original compiled UpdateDataCorp and
numericFormatters.FormatNumeric wrapper with the captured old integer entered
the C++ numeric formatter with grouping enabled and zero decimal places. The
captured corrected reply contains Python str '1000': the same native code keeps
literal row text '1000' and does not call the numeric formatter for shares.
The C++ formatter remains a boundary; its glyph output was not measured here.
Live browser information shows 1000 and no console errors. The controlled
first-public-None continuation still replaces public shares with numeric 1000
from the existing own-corporation row cache. Stored and corporation-row shares
remain numeric; the browser's existing number/string distinction is unchanged.

c3a routes propagated native UserError refusals through the existing per-pilot
dialog handler, preserving the message key and dict. Ordinary propagated errors
keep the existing log, and expected scope/pilot retirement stays
quiet. The game-port adapter now promotes only the original UserError guid
exceptions.UserError and its eveexceptions.UserError package alias; ordinary
decoded remote exception classes remain CALL_FAILED without dialog metadata.
Previously any decoded exception with a reason was promoted. The original
compiled UserError constructor, window method and exception handler distinguish
the dialog from ordinary logging. A propagated refusal leaves the failed
registered scope/history uncompleted; loading still clears in finally.

Native BadArgs is a separate framework path: compiled execution calls ShowError,
skips base/history completion, clears loading and then clears the tasklet pointer/
focuses. Executing the whole original corporation module with its original
infoConst star import supplies no BadArgs global; the normal builtin mangler
does not install one either. A missing owner at update_window_icon raises
NameError in that execution. Imported services/UI bases are boundary shells;
this does not rule out an unobserved runtime injection in a full client session.
The original show_error, primitive Hide/state and IsVisible methods also confirm
that errorPar is parented under the topParent it just hid, so its logical
visibility is false. hide_error restores the parent and closes that panel.
These measurements do not justify inventing a visible corporation error panel
or treating a remote UserError as BadArgs.
Native missing-message and destroyed-window exception suppression also remain
with that error/widget work; this is not the complete native exception handler.

Corporation aggression/enlistment RPC failures now propagate to the same window
error handler. An aggression failure prevents enlistment; either failure skips
normal caption/history completion and clears loading in finally, retaining the
failed registered scope. Original compiled window/monolith/UpdateDataCorp
execution confirms the header precedes those reads and the main tabs are not
constructed after either failure. The browser no longer reports a missing
corporation record for that unfinished body. None/malformed attribute answers need their own native
consumer checks; propagating RPC exceptions does not establish those cases.

The controller now publishes a distinct corporation header stage before those
attribute reads. It contains only the identified public record; the completed
stage adds aggression, enlistments and its read time. A later failure retains
the header stage. The view can therefore keep the corporation's existing header
fields visible while loading or after failure, without showing Description,
Attributes or Standings before the main tabs would be constructed. Caption and
history completion still wait for the coroutine's successful end. Scope/pilot
retirement guards publication as well as dispatch. Original compiled layout,
reconstruction and primitive visibility methods confirm that topParent is visible
while the new scroll and edit remain hidden before and after an attribute error.
This ports the existing header presentation's lifetime; complete native header
widgets, ancillary read order/caches and failures during later caption work
remain separate.

The corporation service's scalar aggression read now shares its native raw-reply
cache across information windows. base_corporation256-261 and ExpiringDict use
100000 entries and 600 seconds of client wall time. A hit does not renew its age;
an age of exactly 600 seconds expires it. Completed None replies are cached,
RPC failures are not, and overlapping misses issue separate reads. At capacity
the native dictionary removes its oldest slot before every assignment, including
an overwrite; a live surviving key keeps its position. Contains/get also retain
their separate age checks, including the native KeyError at a crossed boundary.

The cache is per pilot here and clears with character/session teardown, with a
generation guard before storing late replies. A registered tasklet's retirement
prevents cache publication; an unregistered history continuation may fill it after
its view closes. Corporation membership changes do not clear it. The crimewatch
service's own corporation-registry settings and notices are separate: no extra
invalidation is inferred from them. The bulk aggression caller and complete
service lifetime remain separate port work.

The information window now stops on explicit None attribute answers. The original
GetCorpFriendlyFireStatus calls IsFriendlyFireLegalAtTime on its raw argument:
None raises AttributeError, including repeated attempts served from the raw
aggression cache. UpdateDataCorp iterates the enlistment answer directly: None
raises TypeError, and its uncached helper reads again on the next construction.
Both leave the header visible, main content hidden, loading cleared and caption/
history uncompleted. They use ordinary exception logging, without a UserError
dialog. The checks distinguish actual None from other malformed values; remaining
object-state and iterable behavior needs its own original-client consumer audit.
Controlled None deliveries after actual successful replies establish these
boundaries, not a naturally recorded server failure.

For the canonical crimewatch.corp_aggression.settings.AggressionSettings object,
missing state fields also stop construction. Original compiled settings methods
and GetCorpFriendlyFireStatus raise AttributeError for _disableAfter first, then
_enableAfter, including an enable field missing beside a future disable time.
blue/src/Marshal.cpp ReadInstance explains the state boundary: __new__ followed
by a dict update, without __init__ supplying missing fields. The consumer probe
installs that state explicitly; it does not execute the native unmarshalling.
The browser now preserves these errors after caching the raw reply. Repeated
constructions stop before enlistment, retain the header and old caption, clear
loading, and use ordinary exception logging. Controlled field removal after real
200 replies proved the failure and cached repeat in the browser, with exactly
PublicInfo, Aggression, PublicInfo on the wire; an unmodified reply after pilot
cache reset completes PublicInfo, Aggression, Enlistment and all existing rows.
Tranquility's recorded canonical states have both keys. These missing-field
checks do not establish other classes, non-dict states, or malformed time values.

Numeric and boolean enlistment answers now raise TypeError before construction
can complete. The original compiled UpdateDataCorp directly iterates them and
raises for int, long, float and bool, including zero and False; the helper does
not cache the answer. Actual-success response replacements with those scalars
reproduce the stopped header/old-caption state and ordinary error logging.
Browser retries issue enlistment again, retain cached aggression, and recover
immediately with the unmodified iterable reply. TCP confirms three public and
enlistment reads with one aggression read across two failures and recovery.
The diagnostic intentionally omits a Python type name: the current bridge loses
some int/long/integral-float distinctions. Native exception type and completion
order are preserved; numeric diagnostic identity needs transport type retention.
Other iterable answers and their owner lookups remain separate port work.

Empty dictionaries, byte strings and Unicode strings now produce an empty
faction list, retaining the NoFwFactionsPermitted row. Original UpdateDataCorp
with compiled Recordset.Get confirms these empty iterables perform no faction
owner lookup and still build the same row as empty list/tuple/set. Controlled
replacement after actual successful replies verifies all six empty forms;
the browser displays Permitted Faction Enlistments: None for the empty dict,
with normal public/aggression/enlistment order and no console errors. Nonempty
iterables still need the native int(key), owner-cache/Prime failure and ordering
port; no general dict or string iteration behavior is claimed by this change.

Required work remains: other ordinary headers' loading/completion and content-
owned continuations, complete RPC/error handling, widget lifetime after close
and retained dead tasklet pointers. Complete native content tabs, ancillary header/
relationship read order, service caches and native caption formatting remain
content-port work; browser title text and initial title behavior are unchanged.
Read each native content class's order and spawned/shared work first. Do not impose
ordinary loading on ships or an automatic pending drain unsupported by the
compiled methods. Existing tickets alone drop displayed stale results; actual
held native replies must verify every continuation newly placed under a scope.
The current sections are not complete native content/asynchronous parity.

The Corporation window, the rest of its panels, and Phases5/6 remain unfinished.
