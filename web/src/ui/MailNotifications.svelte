<script lang="ts">
  // The mail window's Communications tab (item 81, its fifth part), as the retail client makes it
  // (neocom/notifications.py NotificationForm; notificationSvc.py; evemail.py 92 to 104 puts it beside the mail):
  //
  //   the left side   the Unread group, then every group by its words (GetStaticLabelsGroups), each with its unread
  //                   count (UpdateCounters); the group last shown kept (mail_lastnotification), else the first;
  //   the list        a group's notifications (GetByGroupID; the Unread group's, GetUnprocessed), those of a type in
  //                   communications, with Status, Sender, Subject, Received, and for the Unread group the Group
  //                   Name; each entry's hint its body cut at a hundred characters (LoadGroupFromNode);
  //   reading         an entry clicked is read at once, a selection moved by the keys after a second; reading one
  //                   not read marks it read (MarkAsProcessed, a list), its text the client's (GetReadingText);
  //   menus           an entry's: Mark as Read, Delete (GetEntryMenu); a group's: Mark All as Read, Delete all
  //                   (StaticMenu); the window's two buttons the same for all; each asked with the client's dialog
  //                   where it asks (prompt_player_fsd_dialog), and the whole read again after (OnNotificationsRefresh).
  //
  // A subject and a body are the client's words where the page can be sure of them (notificationFormats.ts); a
  // subject it cannot word is the page's own word for the kind, a body it cannot word is said to be so.

  import { onDestroy, onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { mailBodyLines } from "../bridge/mailMarkup.ts";
  import { notificationTitle } from "../bridge/activity.ts";
  import { notificationWording, type NotificationFormats } from "../bridge/notificationFormats.ts";
  import {
    DELETE_INTERVAL_MS,
    NOTIFICATIONS_MAX_UPDATED,
    OWNER_SYSTEM,
    READ_DELAY_MS,
    notificationGroupOrder,
    notificationHint,
    unreadCountsByGroup,
  } from "../bridge/notificationWindow.ts";
  import type { Notification } from "../bridge/notifications.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import { resolvedName } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  const words = store.words;
  const names = store.names;

  /** The window's words, by their labels (neocom/notifications.py; notificationSvc.GetReadingText; evemail.py 103). */
  const WORDS = {
    markAllAsRead: "UI/Mail/Notifications/MarkAllAsRead",
    deleteAll: "UI/Mail/Notifications/DeleteAll",
    unread: "UI/Mail/Unread",
    read: "UI/Mail/Read",
    status: "UI/Mail/Status",
    sender: "UI/Mail/Sender",
    subject: "UI/Mail/Subject",
    received: "UI/Mail/Received",
    groupName: "UI/Mail/Notifications/GroupName",
    noNotifications: "UI/Mail/Notifications/NoNotifications",
    groupUnread: "UI/Mail/Notifications/GroupUnreadLabel",
    markAsRead: "UI/Mail/Notifications/MarkAsRead",
    delete: "UI/Mail/Notifications/Delete",
    tooMany: "UI/Mail/Notifications/TooManySelected",
    moreTrail: "UI/Common/MoreTrail",
    readingText: "UI/Mail/NotificationText",
    date: "/Carbon/UI/Common/DateTime/DateLongShort",
    yes: "UI/Common/Buttons/Yes",
    no: "UI/Common/Buttons/No",
  } as const;
  /** The client's dialogs the window asks with (DeleteAll, MarkAllRead, DeleteAllFromGroup; notificationSvc.MarkAllReadInGroup). */
  const DIALOGS = ["EvemailNotificationsDeleteAll", "EvemailNotificationsMarkAllRead", "EvemailNotificationsDeleteGroup", "EvemailNotificationsMarkGroupRead"] as const;

  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? template : own;
  }
  const nameOf = (kind: Parameters<typeof resolvedName>[1], id: number) => resolvedName($names.resolved, kind, id, "");

  let formats = $state<NotificationFormats | null>(null);
  const groups = $derived(formats?.groups ?? null);
  /** The group shown (the left side's selected), and its notifications as last read. */
  let shownGroup = $state<number | null>(null);
  let shown = $state<readonly Notification[] | null>(null);
  /** The unread notifications (notificationSvc.unreadNotifications), for the counts and for what may be marked read. */
  let unread = $state<readonly Notification[]>([]);
  /** The entries selected, by notification, and the one the reading pane shows. */
  let selected = $state<readonly number[]>([]);
  let anchor = $state<number | null>(null);
  let viewing = $state<Notification | null>(null);
  let menu = $state<{ readonly kind: "entry"; readonly notificationID: number } | { readonly kind: "group"; readonly groupID: number } | null>(null);
  let confirming = $state<{ readonly dialog: (typeof DIALOGS)[number]; readonly act: () => Promise<void> } | null>(null);
  let busy = $state(false);
  let error = $state("");
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDeleted = 0;

  const order = $derived(groups === null ? [] : notificationGroupOrder(groups, groupWords));
  const counts = $derived(groups === null ? new Map<number, number>() : unreadCountsByGroup(unread, groups));
  const unreadIDs = $derived(new Set(unread.map((notification) => notification.notificationID)));
  const inUnreadGroup = $derived(groups !== null && shownGroup === groups.unread);

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      error = isSessionLost(cause) ? "Your session ended. Pick your character again." : cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  /** A group's words: the Unread group's, or its label's (groupNamePaths). */
  function groupWords(groupID: number): string {
    if (groups !== null && groupID === groups.unread) return word(WORDS.unread, "Unread");
    const label = groups?.names.get(groupID);
    return label === undefined ? "" : word(label, "…");
  }

  /** GetPanelLabel (415 to 419): the group's words, with its unread count where it has any. */
  function groupLabel(groupID: number): string {
    const count = counts.get(groupID) ?? 0;
    const name = groupWords(groupID);
    return count > 0 ? plainText(formatTemplate(word(WORDS.groupUnread, "{groupName} · {unreadCount}"), { groupName: name, unreadCount: count }, { nameOf })) : name;
  }

  const isRead = (notification: Notification): boolean => notification.processed || !unreadIDs.has(notification.notificationID);

  function part(notification: Notification, which: "subject" | "body"): string | null {
    return formats === null ? null : notificationWording(notification, formats, $words.templates, nameOf, which).markup;
  }
  /** A subject's markup: the client's where the page can be sure of it, else the page's own word for the kind. */
  const subjectMarkup = (notification: Notification): string => part(notification, "subject") ?? notificationTitle(notification.typeID);
  const senderOf = (notification: Notification): number => (notification.senderID === -1 ? OWNER_SYSTEM : notification.senderID);
  /** LoadGroupFromNode (175 to 179): the sender's name, none where there is no sender. */
  const senderName = (notification: Notification): string => (senderOf(notification) > 0 ? resolvedName($names.resolved, "owner", senderOf(notification), "") : "");

  /** FmtDate(created, 'ls'), as the list and the reading pane write the date. */
  function dateText(created: bigint | null): string {
    return created === null ? "" : plainText(formatTemplate(word(WORDS.date, "{[datetime]datetime}"), { datetime: String(created) }, { nameOf }));
  }

  /** The Unread group's Group Name column (181 to 188): the words of the type's group, none where it has none. */
  function typeGroupWords(notification: Notification): string {
    const groupID = groups?.typeGroup.get(notification.typeID);
    const label = groupID === undefined ? undefined : groups?.names.get(groupID);
    return label === undefined ? "" : word(label, "");
  }

  /** GetReadingText (439 to 452): the client's words for the subject, the sender, the date and the body. */
  function readingMarkup(notification: Notification): string {
    return formatTemplate(
      word(WORDS.readingText, "{subject}<br>{sender}<br>{date}<br><br>{body}"),
      { subject: subjectMarkup(notification), sender: senderName(notification), date: dateText(notification.created), body: part(notification, "body") ?? "" },
      { nameOf },
    );
  }

  // The words and names the shown entries and the reading pane ask for.
  $effect(() => {
    const known = formats;
    if (known === null) return;
    const labels = new Set<string>();
    for (const notification of [...(shown ?? []), ...unread]) {
      for (const which of ["subject", "body"] as const) {
        const wording = notificationWording(notification, known, $words.templates, nameOf, which);
        for (const label of wording.labels) labels.add(label);
        if (wording.refs.length > 0) flow.requestNames(wording.refs);
      }
    }
    if (labels.size > 0) flow.requestWords([...labels]);
  });

  function cancelReadTimer(): void {
    if (readTimer !== null) clearTimeout(readTimer);
    readTimer = null;
  }

  function clearReading(): void {
    cancelReadTimer();
    viewing = null;
  }

  /** The unread notifications read again (UpdateCounters: GetAllUnreadCount). */
  async function loadUnread(): Promise<void> {
    if (groups === null) return;
    unread = await flow.notificationsOfGroup(groups.unread, true);
  }

  /** LoadGroupFromNode (159 to 223): the group kept as the last shown, its notifications read, the reading pane cleared. */
  async function showGroup(groupID: number): Promise<void> {
    if (groups === null) return;
    shownGroup = groupID;
    menu = null;
    flow.keepNotificationGroupShown(groupID);
    const found = await flow.notificationsOfGroup(groupID, groupID === groups.unread);
    if (shownGroup !== groupID) return;
    shown = found;
    selected = [];
    anchor = null;
    clearReading();
  }

  /** LoadLeftSide (92 to 112), as the window opens and at OnNotificationsRefresh: the counts, then the group last shown, else the first. */
  async function loadLeftSide(): Promise<void> {
    if (groups === null) return;
    await loadUnread();
    const last = flow.notificationGroupShown();
    await showGroup(last !== null && order.includes(last) ? last : (order[0] ?? groups.unread));
  }

  onMount(() => {
    flow.requestWords([...Object.values(WORDS), ...DIALOGS.flatMap((name) => [`dialog:${name}/title`, `dialog:${name}/body`])]);
    void run(async () => {
      formats = await flow.notificationFormats();
      if (groups === null) {
        error = "The client's notification groups could not be read, so this tab cannot be shown.";
        return;
      }
      flow.requestWords([...groups.names.values()]);
      await loadLeftSide();
    });
  });

  onDestroy(cancelReadTimer);

  /**
   * MarkAsRead (form 275 to 279; notificationSvc.py 241 to 260): those given that are unread, a hundred at most, marked
   * read (MarkAsProcessed); nothing asked where none is unread. Their entries shown read.
   */
  async function markRead(notificationIDs: readonly number[]): Promise<void> {
    const toMark = [...new Set(notificationIDs.filter((id) => unreadIDs.has(id)))];
    if (toMark.length < 1) return;
    if (toMark.length > NOTIFICATIONS_MAX_UPDATED) {
      error = tooMany(toMark.length);
      return;
    }
    await flow.markNotificationsRead(toMark);
    unread = unread.filter((notification) => !toMark.includes(notification.notificationID));
    shown = (shown ?? []).map((notification) => (toMark.includes(notification.notificationID) ? { ...notification, processed: true } : notification));
  }

  function tooMany(num: number): string {
    return plainText(formatTemplate(word(WORDS.tooMany, "At most {max} at a time; {num} are chosen."), { num, max: NOTIFICATIONS_MAX_UPDATED }, { nameOf }));
  }

  /** LoadReadingPane (297 to 305): the entry's text shown, and the entry marked read where it is not. */
  function loadReading(notification: Notification): void {
    cancelReadTimer();
    viewing = notification;
    if (!isRead(notification)) void run(() => markRead([notification.notificationID]));
  }

  /** MsgScrollSelectionChange (327 to 333): the first selected read after a second, where it is not the one shown. */
  function readAfterAWhile(notification: Notification): void {
    cancelReadTimer();
    if (viewing?.notificationID === notification.notificationID) return;
    readTimer = setTimeout(() => {
      readTimer = null;
      loadReading(notification);
    }, READ_DELAY_MS);
  }

  /** An entry clicked: the scroll's selection (one, or more with Ctrl and Shift), and LoadReadingPaneFromNode: read, but not with Shift. */
  function clicked(event: MouseEvent, notification: Notification, place: number): void {
    menu = null;
    const list = shown ?? [];
    const id = notification.notificationID;
    if (event.shiftKey && anchor !== null) {
      const [from, to] = anchor < place ? [anchor, place] : [place, anchor];
      selected = list.slice(from, to + 1).map((each) => each.notificationID);
    } else if (event.ctrlKey || event.metaKey) {
      selected = selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];
      anchor = place;
    } else {
      selected = [id];
      anchor = place;
    }
    if (!event.shiftKey) loadReading(notification);
  }

  /** The keys on the list: up and down move the selection (read after a second), Delete deletes it (DeleteFromKeyboard). */
  function keyed(event: KeyboardEvent): void {
    const list = shown ?? [];
    if (event.key === "Delete") {
      event.preventDefault();
      // DeleteFromKeyboard (335 to 343): a second press within DELETE_INTERVAL is not heeded (the client sounds uiwarning03).
      if (Date.now() - lastDeleted < DELETE_INTERVAL_MS) return;
      lastDeleted = Date.now();
      const chosen = list.filter((each) => selected.includes(each.notificationID));
      void run(() => deleteEntries(chosen));
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (list.length < 1) return;
    const at = anchor ?? -1;
    const next = Math.max(0, Math.min(list.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    anchor = next;
    selected = [list[next]!.notificationID];
    readAfterAWhile(list[next]!);
  }

  /** GetEntryMenu (252 to 273): on the selection where the entry is in it, else on the entry alone. */
  const menuEntries = (notificationID: number): readonly Notification[] => {
    const list = shown ?? [];
    const chosen = selected.includes(notificationID) ? list.filter((each) => selected.includes(each.notificationID)) : list.filter((each) => each.notificationID === notificationID);
    return chosen;
  };

  function openEntryMenu(event: MouseEvent, notification: Notification): void {
    event.preventDefault();
    menu = { kind: "entry", notificationID: notification.notificationID };
  }

  /**
   * DeleteNotifications (form 345 to 368; notificationSvc.py 312 to 321): a hundred at most deleted; their entries
   * taken off, the reading pane cleared where it showed one, and the entry now where the first was selected (and read
   * after a second).
   */
  async function deleteEntries(chosen: readonly Notification[]): Promise<void> {
    menu = null;
    if (chosen.length < 1) return;
    if (chosen.length > NOTIFICATIONS_MAX_UPDATED) {
      error = tooMany(chosen.length);
      return;
    }
    const list = shown ?? [];
    const ids = chosen.map((each) => each.notificationID);
    const first = Math.min(...chosen.map((each) => list.findIndex((entry) => entry.notificationID === each.notificationID)).filter((at) => at >= 0));
    await flow.deleteNotifications(ids);
    const left = list.filter((each) => !ids.includes(each.notificationID));
    shown = left;
    unread = unread.filter((each) => !ids.includes(each.notificationID));
    if (viewing !== null && ids.includes(viewing.notificationID)) clearReading();
    if (left.length < 1) {
      selected = [];
      anchor = null;
      return;
    }
    const at = Math.min(Number.isFinite(first) ? first : 0, left.length - 1);
    selected = [left[at]!.notificationID];
    anchor = at;
    readAfterAWhile(left[at]!);
  }

  /** The whole read again, as OnNotificationsRefresh has the window do (LoadLeftSide). */
  async function refreshed(): Promise<void> {
    await loadLeftSide();
  }

  /** MarkAllRead (form 238 to 241; notificationSvc.py 229 to 239): asked; nothing where none is unread. */
  function markAllRead(): void {
    menu = null;
    confirming = {
      dialog: "EvemailNotificationsMarkAllRead",
      act: async () => {
        if (unread.length < 1) return;
        await flow.markAllNotificationsRead();
        await refreshed();
      },
    };
  }

  /** DeleteAll (form 233 to 236; notificationSvc.py 300 to 310): asked, then every notification deleted. */
  function deleteAll(): void {
    menu = null;
    confirming = {
      dialog: "EvemailNotificationsDeleteAll",
      act: async () => {
        await flow.deleteAllNotifications();
        await refreshed();
      },
    };
  }

  /** MarkAllReadInGroup (notificationSvc.py 213 to 227): nothing where none of the group is unread; else asked. */
  async function markGroupRead(groupID: number): Promise<void> {
    menu = null;
    const ofGroup = await flow.notificationsOfGroup(groupID, false);
    if (!ofGroup.some((each) => unreadIDs.has(each.notificationID))) return;
    confirming = {
      dialog: "EvemailNotificationsMarkGroupRead",
      act: async () => {
        await flow.markNotificationGroupRead(groupID);
        await refreshed();
      },
    };
  }

  /** DeleteAllFromGroup (form 243 to 246; notificationSvc.py 287 to 298): asked; nothing where the group has none. */
  function deleteGroup(groupID: number): void {
    menu = null;
    confirming = {
      dialog: "EvemailNotificationsDeleteGroup",
      act: async () => {
        const ofGroup = await flow.notificationsOfGroup(groupID, false);
        if (ofGroup.length < 1) return;
        await flow.deleteNotificationGroup(groupID);
        await refreshed();
      },
    };
  }

  function dialogText(which: "title" | "body"): string {
    const waiting = confirming;
    if (waiting === null) return "";
    return plainText(word(`dialog:${waiting.dialog}/${which}`, which === "title" ? "Go ahead?" : ""));
  }

  function confirmed(): void {
    const waiting = confirming;
    confirming = null;
    if (waiting !== null) void run(waiting.act);
  }
</script>

<section class="mail-notifications">
  <p class="controls">
    <button type="button" class="minor" disabled={busy || groups === null} onclick={markAllRead}>{plainText(word(WORDS.markAllAsRead, "Mark everything read"))}</button>
    <button type="button" class="minor" disabled={busy || groups === null} onclick={deleteAll}>{plainText(word(WORDS.deleteAll, "Delete everything"))}</button>
  </p>
  {#if error !== ""}
    <p class="error">{error}</p>
  {/if}
  {#if confirming !== null}
    <!-- The client's dialog to be sure of it: its title, its question, yes and no. -->
    <div class="notifications-confirm" role="alertdialog" aria-label={dialogText("title")}>
      <strong>{dialogText("title")}</strong>
      <p>{dialogText("body")}</p>
      <p class="controls">
        <button type="button" disabled={busy} onclick={confirmed}>{plainText(word(WORDS.yes, "Yes"))}</button>
        <button type="button" class="minor" onclick={() => (confirming = null)}>{plainText(word(WORDS.no, "No"))}</button>
      </p>
    </div>
  {/if}
  {#if groups !== null}
    <div class="notifications-body">
      <!-- The left side (GetStaticLabelsGroups): Unread, a gap, then the groups; a group's menu (StaticMenu) on its right click. -->
      <ul class="notification-groups">
        {#each order as groupID, place (groupID)}
          <li class:gap={place === 1}>
            <button
              type="button"
              class="group"
              class:active={shownGroup === groupID}
              class:has-unread={(counts.get(groupID) ?? 0) > 0}
              disabled={busy}
              onclick={() => void run(() => showGroup(groupID))}
              oncontextmenu={(event) => {
                event.preventDefault();
                menu = groupID === groups.unread ? null : { kind: "group", groupID };
              }}>{groupLabel(groupID)}</button>
            {#if menu?.kind === "group" && menu.groupID === groupID}
              <span class="menu" role="menu">
                <button type="button" role="menuitem" class="minor" disabled={busy} onclick={() => void run(() => markGroupRead(groupID))}>{plainText(word(WORDS.markAllAsRead, "Mark everything read"))}</button>
                <button type="button" role="menuitem" class="minor" disabled={busy} onclick={() => deleteGroup(groupID)}>{plainText(word(WORDS.deleteAll, "Delete everything"))}</button>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="notification-main">
        {#if shown === null}
          <p class="note">Fetching…</p>
        {:else if shown.length === 0}
          <p class="note">{plainText(word(WORDS.noNotifications, "Nothing in this group."))}</p>
        {:else}
          <!-- The list (LoadGroupFromNode): its columns, each entry's hint its body; Ctrl and Shift select more; a right click its menu. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div class="notification-list" tabindex="0" role="listbox" aria-multiselectable="true" onkeydown={keyed}>
            <div class="row head">
              <span>{plainText(word(WORDS.status, "Status"))}</span>
              <span>{plainText(word(WORDS.sender, "From"))}</span>
              <span>{plainText(word(WORDS.subject, "Subject"))}</span>
              <span>{plainText(word(WORDS.received, "When"))}</span>
              {#if inUnreadGroup}<span>{plainText(word(WORDS.groupName, "Group"))}</span>{/if}
            </div>
            {#each shown as notification, place (notification.notificationID)}
              {@const body = part(notification, "body")}
              <div
                class="row entry"
                class:unread={!isRead(notification)}
                class:selected={selected.includes(notification.notificationID)}
                role="option"
                tabindex="-1"
                aria-selected={selected.includes(notification.notificationID)}
                title={body === null ? undefined : notificationHint(body, word(WORDS.moreTrail, "…"))}
                onclick={(event) => clicked(event, notification, place)}
                onkeydown={() => {}}
                oncontextmenu={(event) => openEntryMenu(event, notification)}>
                <span>{isRead(notification) ? plainText(word(WORDS.read, "Read")) : plainText(word(WORDS.unread, "Unread"))}</span>
                <span>{senderName(notification)}</span>
                <span>{plainText(subjectMarkup(notification))}</span>
                <span>{dateText(notification.created)}</span>
                {#if inUnreadGroup}<span>{typeGroupWords(notification)}</span>{/if}
              </div>
              {#if menu?.kind === "entry" && menu.notificationID === notification.notificationID}
                {@const chosen = menuEntries(notification.notificationID)}
                <div class="menu" role="menu">
                  {#if chosen.some((each) => !isRead(each))}
                    <button type="button" role="menuitem" class="minor" disabled={busy} onclick={() => { menu = null; void run(() => markRead(chosen.filter((each) => !isRead(each)).map((each) => each.notificationID))); }}>{plainText(word(WORDS.markAsRead, "Mark read"))}</button>
                  {/if}
                  <button type="button" role="menuitem" class="minor" disabled={busy} onclick={() => void run(() => deleteEntries(chosen))}>{plainText(word(WORDS.delete, "Delete"))}</button>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
        <!-- The reading pane (LoadReadingPane): the client's reading text, its lines and runs as the mail's are shown. -->
        <div class="notification-reading" aria-live="polite">
          {#if viewing !== null}
            {#each mailBodyLines(readingMarkup(viewing)) as line, place (place)}
              <p class="reading-line">{#each line as segment, at (at)}<span class:bold={segment.bold} class:italic={segment.italic} class:underline={segment.underline || segment.link !== null} title={segment.link ?? undefined}>{segment.text}</span>{/each}</p>
            {/each}
            {#if part(viewing, "body") === null}
              <p class="note">The page cannot word this one's text yet.</p>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .mail-notifications {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0;
  }
  .error {
    color: var(--color-danger, #e06c6c);
    margin: 0;
  }
  .note {
    color: var(--color-muted);
    margin: 0.3rem 0;
  }
  .notifications-confirm {
    border: 1px solid var(--color-row-line);
    padding: 0.5rem 0.7rem;
  }
  .notifications-confirm p {
    margin: 0.3rem 0;
  }
  .notifications-body {
    display: grid;
    grid-template-columns: minmax(9rem, 13rem) minmax(0, 1fr);
    gap: 0.7rem;
    min-height: 0;
  }
  .notification-groups {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .notification-groups li.gap {
    margin-top: 0.75rem;
  }
  .group {
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    padding: 0.25rem 0.4rem;
    color: inherit;
    cursor: pointer;
  }
  .group.active {
    background: var(--color-row-line);
  }
  .group.has-unread {
    font-weight: 700;
  }
  .menu {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--color-row-line);
  }
  .notification-main {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .notification-list {
    max-height: 22rem;
    overflow: auto;
    outline: none;
  }
  .row {
    display: grid;
    grid-template-columns: 4.5rem minmax(6rem, 1fr) minmax(10rem, 2.5fr) 9rem;
    gap: 0.5rem;
    padding: 0.25rem 0.3rem;
    border-bottom: 1px solid var(--color-row-line);
    font-size: 13px;
  }
  .row:has(> span:nth-child(5)) {
    grid-template-columns: 4.5rem minmax(6rem, 1fr) minmax(10rem, 2.5fr) 9rem 7rem;
  }
  .row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.head {
    color: var(--color-muted);
    font-size: 12px;
  }
  .row.entry {
    cursor: default;
  }
  .row.entry.unread {
    color: var(--color-text-bright);
    font-weight: 600;
  }
  .row.entry.selected {
    background: var(--color-row-line);
  }
  .notification-reading {
    border-top: 1px solid var(--color-row-line);
    padding-top: 0.4rem;
    min-height: 6rem;
  }
  .reading-line {
    margin: 0;
    min-height: 1.2em;
    overflow-wrap: anywhere;
  }
  .bold {
    font-weight: 700;
  }
  .italic {
    font-style: italic;
  }
  .underline {
    text-decoration: underline;
  }
  @media (max-width: 640px) {
    .notifications-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
