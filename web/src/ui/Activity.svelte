<script lang="ts">
  // A read-only, player-facing digest across existing companion sources. The
  // panel never receives notification/calendar mutators and never renders the
  // internal IDs, service names, method names or live payloads it joins on.
  import { onMount } from "svelte";
  import {
    calendarResponseText,
    filetimeToUnixMs,
    liveActivityTitle,
  } from "../bridge/activity.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { corporationApplicationNotification } from "../bridge/corporationApplications.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { CONTACT_NOTIFICATION_LABELS } from "../bridge/contactNotifications.ts";
  import { notificationSubjectWording, notificationWording, type NotificationFormats } from "../bridge/notificationFormats.ts";
  import type { Notification } from "../bridge/notifications.ts";
  import type { ActivityNotificationRow } from "../store/types.ts";
  import {
    SKILL_HISTORY_OWN_ACTION_WORDS,
    SKILL_HISTORY_WORD_LABELS,
    skillHistoryActionLabel,
  } from "../bridge/skillHistoryPanel.ts";
  import { SKILL_NAME_AND_LEVEL_LABEL, type SkillNotification } from "../bridge/skillNotifications.ts";
  import { resolvedName } from "../store/names.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let {
    store,
    flow,
    showMail,
    openApplications,
  }: {
    store: ClientStore;
    flow: AppFlow;
    showMail?: () => void;
    openApplications?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const activity = store.activity;
  // svelte-ignore state_referenced_locally
  const mail = store.mail;
  // svelte-ignore state_referenced_locally
  const live = store.live;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;

  let refreshError = $state("");

  const responsesByEvent = $derived(
    new Map(
      $activity.calendarResponses.status === "ready"
        ? $activity.calendarResponses.value.map((response) => [
            response.eventID,
            response.status,
          ] as const)
        : [],
    ),
  );

  const liveTail = $derived([...$live.notifications].slice(-8).reverse());

  /** A line of the recent notifications: the server's, or the skill history's, which have no sender and no seen. */
  interface ListedNotification {
    readonly key: string;
    readonly applicationTarget?: boolean;
    readonly title: string;
    /** Its body as the client words it, as plain text; null where the page cannot be sure of it. */
    readonly body: string | null;
    readonly senderID: number | null;
    readonly processed: boolean | null;
    readonly created: bigint | null;
  }

  /** The client's word for a label, from the player's install; the page's own where there is none to read. */
  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? template : own;
  }

  /** The skill notification's header, '%s - %s' (skillHistoryProvider.py 40 to 42). */
  function skillNotificationTitle(notification: SkillNotification): string {
    const action = word(skillHistoryActionLabel(notification.eventTypeID), SKILL_HISTORY_OWN_ACTION_WORDS[notification.eventTypeID] ?? "Unknown");
    const skill = formatTemplate(
      word(SKILL_NAME_AND_LEVEL_LABEL, "{[item]skill.name} {amount}"),
      { skill: notification.skillTypeID, amount: notification.level },
      { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "Unknown skill") },
    );
    return plainText(`${action} - ${skill}`);
  }

  /**
   * How the client words each kind of notification, as its own code answers (bridge/notificationFormats.ts); none
   * until the BFF has answered, or where it cannot read them. A notification's subject is the client's where the
   * page can be sure of it, and the page's own word for its kind where not.
   */
  let formats = $state<NotificationFormats | null>(null);
  const asNotification = (row: ActivityNotificationRow): Notification => ({
    notificationID: row.notificationID,
    typeID: row.typeID ?? 0,
    senderID: row.senderID,
    receiverID: row.receiverID ?? 0,
    processed: row.processed,
    created: row.created,
    data: row.data ?? null,
  });
  function subjectOf(row: ActivityNotificationRow): string | null {
    return formats === null ? null : notificationSubjectWording(asNotification(row), formats, $words.templates, (kind, id) => resolvedName($names.resolved, kind, id, "")).subject;
  }
  function bodyOf(row: ActivityNotificationRow): string | null {
    if (formats === null) return null;
    const markup = notificationWording(asNotification(row), formats, $words.templates, (kind, id) => resolvedName($names.resolved, kind, id, ""), "body").markup;
    return markup === null ? null : plainText(markup).trim();
  }
  // The words of the subjects and bodies shown, and the names they are filled with, asked for.
  $effect(() => {
    const known = formats;
    if (known === null || $activity.notifications.status !== "ready") return;
    const labels = new Set<string>(Object.values(CONTACT_NOTIFICATION_LABELS));
    for (const row of $activity.notifications.value) {
      for (const part of ["subject", "body"] as const) {
        const wording = notificationWording(asNotification(row), known, $words.templates, (kind, id) => resolvedName($names.resolved, kind, id, ""), part);
        for (const label of wording.labels) labels.add(label);
        if (wording.refs.length > 0) flow.requestNames(wording.refs);
      }
    }
    flow.requestWords([...labels]);
  });

  // The recent notifications as the client's center lists them: the skill history's and the server's together,
  // the newest first (notificationUI.py 326 to 336), as many as the panel shows.
  const listed = $derived.by((): readonly ListedNotification[] => {
    const all: ListedNotification[] = [];
    if ($activity.notifications.status === "ready") {
      for (const notification of $activity.notifications.value) {
        all.push({
          key: `n${notification.notificationID}`,
          // notificationCenter.py356-362: these four open MY_APPLICATIONS.
          applicationTarget: corporationApplicationNotification(notification.typeID ?? 0),
          title: subjectOf(notification) ?? notification.title,
          body: bodyOf(notification),
          // A sender of nought is none (the client's None: its new-mail notification of a list's own mail has none).
          senderID: notification.senderID > 0 ? notification.senderID : null,
          processed: notification.processed,
          created: notification.created,
        });
      }
    }
    if ($activity.skillNotifications.status === "ready") {
      $activity.skillNotifications.value.forEach((notification, place) => {
        all.push({ key: `s${place}`, title: skillNotificationTitle(notification), body: null, senderID: null, processed: null, created: BigInt(notification.logDate) });
      });
    }
    return all
      .map((line, place) => ({ line, place }))
      .sort((left, right) => {
        const a = left.line.created;
        const b = right.line.created;
        if (a === b) return left.place - right.place;
        if (a === null) return 1;
        if (b === null) return -1;
        return a > b ? -1 : 1;
      })
      .slice(0, 20)
      .map(({ line }) => line);
  });

  function ownerName(ownerID: number, fallback: string): string {
    return resolvedName($names.resolved, "owner", ownerID, fallback);
  }

  function whenText(filetime: bigint | null): string {
    const unixMs = filetimeToUnixMs(filetime);
    return unixMs === null ? "Time not available" : new Date(unixMs).toLocaleString();
  }

  function receivedText(unixMs: number): string {
    return Number.isFinite(unixMs) && unixMs > 0
      ? new Date(unixMs).toLocaleString()
      : "Time not available";
  }

  function eventResponse(eventID: number): string {
    if ($activity.calendarResponses.status !== "ready") {
      return "Response unavailable";
    }
    return calendarResponseText(responsesByEvent.get(eventID));
  }

  async function refresh(): Promise<void> {
    refreshError = "";
    try {
      await flow.loadActivity();
    } catch (cause) {
      if (!isSessionLost(cause)) {
        // Detailed failures already live on the independent read arms. This is
        // only an unexpected whole-flow failure, so do not leak an error code.
        refreshError = "Activity could not be refreshed just now.";
      }
    }
  }

  onMount(() => {
    flow.requestWords([...SKILL_HISTORY_WORD_LABELS, SKILL_NAME_AND_LEVEL_LABEL]);
    void flow.notificationFormats().then((read) => {
      formats = read;
    });
    void refresh();
  });
</script>

<section class="panel" aria-busy={$activity.loading}>
  <header class="panel-head">
    <h2 class="panel-title">Activity Center</h2>
    <!-- ⚠ THE SUBTITLE WENT, THE COUNTS DID NOT. "A read-only overview of what
         needs your attention" only restated what the title bar and the Mail /
         Recent notifications sections below already say - the panel-never-
         describes-itself rule. The two badges are different: they are live
         counts, not description, so they stayed, moved from `.controls` into
         `.stat-line` on the strip's left. Their conditions are unchanged. -->
    {#if ($activity.unprocessedCount.status === "ready" && $activity.unprocessedCount.value > 0) || $mail.unreadCount > 0}
      <p class="stat-line">
        {#if $activity.unprocessedCount.status === "ready" && $activity.unprocessedCount.value > 0}
          <span class="badge accent">{$activity.unprocessedCount.value} new notices</span>
        {/if}
        {#if $mail.unreadCount > 0}
          <span class="badge accent">{$mail.unreadCount} unread mail</span>
        {/if}
      </p>
    {/if}
    <p class="controls">
      <button type="button" class="primary" disabled={$activity.loading} onclick={() => void refresh()}>
        {$activity.loading ? "Refreshing…" : "Refresh"}
      </button>
    </p>
  </header>

  {#if refreshError}
    <p class="error">{refreshError}</p>
  {/if}
  {#if !$activity.loaded}
    <p class="note">Loading your recent activity…</p>
  {:else if $activity.loading}
    <p class="note">Refreshing while the last good activity stays visible…</p>
  {/if}

  <div class="activity-grid">
    <section class="activity-card">
      <h3>Mail</h3>
      {#if $activity.mailError}
        <p class="error">{$activity.mailError}</p>
      {:else if !$mail.loaded}
        <p class="note">Mail has not been read yet.</p>
      {:else if $mail.unreadCount === 0}
        <p class="empty">No unread mail.</p>
      {:else}
        <p class="summary">
          <strong>{$mail.unreadCount}</strong>
          {$mail.unreadCount === 1 ? "message is" : "messages are"} waiting for you.
        </p>
        {#if showMail}
          <button type="button" class="minor" onclick={showMail}>Open Mail</button>
        {/if}
      {/if}
    </section>

    <section class="activity-card notifications">
      <h3>Recent notifications</h3>
      {#if $activity.unprocessedCount.status === "error"}
        <p class="error">{$activity.unprocessedCount.error}</p>
      {/if}
      {#if $activity.notifications.status === "error"}
        <p class="error">{$activity.notifications.error}</p>
      {:else if $activity.notifications.status === "unavailable"}
        <p class="note">Recent notifications are unavailable in this response.</p>
      {/if}
      {#if $activity.skillNotifications.status === "error"}
        <p class="error">{$activity.skillNotifications.error}</p>
      {/if}
      {#if listed.length > 0}
        <ol class="activity-list">
          {#each listed as notification (notification.key)}
            <li class:unread={notification.processed === false}>
              <div class="row-main">
                {#if notification.applicationTarget && openApplications}<button type="button" class="minor" onclick={openApplications}>{notification.title}</button>{:else}<strong>{notification.title}</strong>{/if}
                <span class="meta">
                  {#if notification.senderID !== null}
                    From {ownerName(notification.senderID, "Notification sender")} ·
                  {/if}
                  {whenText(notification.created)}
                </span>
                {#if notification.body !== null && notification.body !== ""}
                  <!-- Its body as the client words it (FormatNotifications), folded away as the page's own. -->
                  <details class="activity-body">
                    <summary>Read</summary>
                    <p>{notification.body}</p>
                  </details>
                {/if}
              </div>
              {#if notification.processed !== null}
                <span class="badge" class:accent={!notification.processed}>
                  {notification.processed ? "Seen" : "Unread"}
                </span>
              {/if}
            </li>
          {/each}
        </ol>
      {:else if $activity.notifications.status === "ready"}
        <p class="empty">No recent notifications.</p>
      {/if}
    </section>

    <section class="activity-card calendar">
      <h3>Upcoming calendar</h3>
      {#if $activity.calendarResponses.status === "error"}
        <p class="error">{$activity.calendarResponses.error}</p>
      {:else if $activity.calendarResponses.status === "unavailable"}
        <p class="note">Your calendar responses are unavailable.</p>
      {/if}
      {#if $activity.calendarEvents.status === "error"}
        <p class="error">{$activity.calendarEvents.error}</p>
      {:else if $activity.calendarEvents.status === "unavailable"}
        <p class="note">Upcoming events are unavailable in this response.</p>
      {:else if $activity.calendarEvents.value.length === 0}
        <p class="empty">No upcoming events this month or next.</p>
      {:else}
        <ol class="activity-list">
          {#each $activity.calendarEvents.value as event (event.eventID)}
            <li>
              <div class="row-main">
                <strong>{event.title}</strong>
                <span class="meta">
                  {whenText(event.eventDateTime)}
                  · hosted by {ownerName(event.ownerID, "Calendar host")}
                </span>
              </div>
              <span class="response">
                {#if event.importance > 0}<span class="badge warn">Important</span>{/if}
                <span class="badge">{eventResponse(event.eventID)}</span>
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <section class="activity-card live-activity">
      <h3>Live activity</h3>
      {#if liveTail.length === 0}
        <p class="empty">Live session activity will appear here as it arrives.</p>
      {:else}
        <ol class="activity-list compact">
          {#each liveTail as notification, index (`${notification.receivedAtMs}:${index}`)}
            <li>
              <div class="row-main">
                <strong>{liveActivityTitle(notification)}</strong>
                <span class="meta">{receivedText(notification.receivedAtMs)}</span>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>

  {#if $activity.refreshedAtMs !== null}
    <p class="refreshed note">Last refreshed {new Date($activity.refreshedAtMs).toLocaleString()}.</p>
  {/if}
</section>

<style>
  /* ⚠ `.panel-head > div` and `.subtitle` used to style the title+blurb
     wrapper this strip no longer has (see the panel-head comment above) -
     removed rather than left to style nothing. Do not add them back for a
     future subtitle; the rule they'd support is the one that just got
     deleted. */
  .activity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 0.7rem;
  }
  .activity-card {
    min-width: 0;
    margin: 0;
  }
  .notifications,
  .calendar {
    grid-column: span 2;
  }
  .activity-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .activity-list li {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.7rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--color-row-line);
  }
  .activity-list li:last-child {
    border-bottom: 0;
  }
  .activity-list li.unread strong {
    color: var(--color-text-bright);
  }
  .row-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row-main strong {
    overflow-wrap: anywhere;
  }
  .meta {
    color: var(--color-muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .activity-body summary {
    color: var(--color-muted);
    font-size: 12px;
    cursor: pointer;
  }
  .activity-body p {
    margin: 0.3rem 0 0;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .response {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.3rem;
  }
  .summary strong {
    color: var(--color-text-bright);
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
  }
  .refreshed {
    margin-bottom: 0;
    text-align: right;
  }
  @media (max-width: 52rem) {
    .notifications,
    .calendar {
      grid-column: auto;
    }
  }
  @media (max-width: 640px) {
    .activity-list li {
      flex-direction: column;
    }
    .response {
      justify-content: flex-start;
    }
  }
</style>
