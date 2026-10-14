<script lang="ts">
  // Mail page (goal R17, Slice A): the inbox, one message's text, and writing
  // to someone.
  //
  // A pure reader of the store's mail slice. Every call lives on the BFF and in
  // app/flow.ts; every identifier is translated to a name in bridge/mail.ts or
  // resolved through the shared name cache before it reaches this file. Nothing
  // here shows a characterID, a messageID or a corporationID (R7d) — a message
  // is identified by who sent it, what it is about and when it arrived.
  //
  // ⚠ THE BODY IS ALREADY PLAIN TEXT. mailMgr.GetBody answers a zlib-DEFLATED
  // buffer; the flow inflates it (bridge/mail.ts, inflateMailBody) so this file
  // never handles a compressed byte.
  //
  // ⚠ THE INBOX IS THE WHOLE MAILBOX. The flow keeps it as the client's mail
  // service does, so there is no paging to build and no "load more".
  import { onMount } from "svelte";
  import {
    MAIL_MAX_BODY,
    MAIL_MAX_TITLE,
    audienceOf,
    checkDraft,
    readFlags,
    MAIL_FOLDER_ALLIANCE,
    MAIL_FOLDER_CORPORATION,
    MAIL_FOLDER_INBOX,
    MAIL_FOLDER_SENT,
    MAIL_FOLDER_TRASH,
    mailsInFolder,
    unreadByLabel,
  } from "../bridge/mail.ts";
  import { MAIL_QUOTE_LABELS, mailBodyLines, mailQuoteMarkup } from "../bridge/mailMarkup.ts";
  import { formatTemplate } from "../bridge/clientWords.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { CharacterMatch } from "../app/api.ts";
  import type { MailHeaderRow } from "../store/types.ts";
  import { resolvedName } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const mail = store.mail;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  /** FmtDate's 'ls' (format.py 93 to 94): this label with the date in it. */
  const DATE_LABEL = "/Carbon/UI/Common/DateTime/DateLongShort";

  /** The client's word for a label, from the player's install; the page's own where there is none to read. */
  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? template : own;
  }

  let busy = $state(false);
  let error = $state("");
  let tab = $state<"inbox" | "compose">("inbox");

  // Compose state. `recipients` holds the chosen people; the id rides along
  // invisibly so SendMail's args[0] can be built, and only the name is shown.
  let recipients = $state<CharacterMatch[]>([]);
  let personQuery = $state("");
  let personMatches = $state<readonly CharacterMatch[]>([]);
  let searched = $state(false);
  let draftTitle = $state("");
  let draftBody = $state("");
  /** The message a reply answers (mailSvc.GetReplyWnd: isReplyTo=msg.messageID), 0 for a new message. */
  let replyTo = $state(0);
  /** The folder shown: a label's bit, all mails (null), or the trash; the inbox first, as the window opens (270). */
  let folder = $state<number | null>(MAIL_FOLDER_INBOX);

  /** The folder words, by their labels (evemail.py GetStaticLabelsGroups; LoadLeftSide; GetPanelLabel). */
  const FOLDER_WORDS = {
    all: "UI/Mail/LabelAllMails",
    inbox: "UI/Mail/LabelInbox",
    sent: "UI/Mail/LabelSent",
    corporation: "UI/Common/Corp",
    alliance: "UI/Common/Groups/Alliance",
    trash: "UI/Mail/LabelTrash",
    labels: "UI/Mail/Labels",
    withCount: "UI/Mail/FolderLabelWithCount",
  } as const;
  /** The window's own folders, in its order: each its place, its word, and the page's own word. */
  const SYSTEM_FOLDERS: readonly (readonly [number | null, string, string])[] = [
    [null, FOLDER_WORDS.all, "All Mails"],
    [MAIL_FOLDER_INBOX, FOLDER_WORDS.inbox, "Inbox"],
    [MAIL_FOLDER_SENT, FOLDER_WORDS.sent, "Sent"],
    [MAIL_FOLDER_CORPORATION, FOLDER_WORDS.corporation, "Corp"],
    [MAIL_FOLDER_ALLIANCE, FOLDER_WORDS.alliance, "Alliance"],
    [MAIL_FOLDER_TRASH, FOLDER_WORDS.trash, "Trash"],
  ];
  const unreadCounts = $derived(unreadByLabel($mail));
  const ownLabels = $derived([...($mail.labels ?? [])].sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase())));
  const shownMessages = $derived(mailsInFolder($mail, folder));

  /** A folder's unread count as the window keeps it: none beside sent or the trash (UpdateCounters). */
  function folderUnread(id: number | null): number {
    return id === MAIL_FOLDER_SENT || id === MAIL_FOLDER_TRASH ? 0 : (unreadCounts.get(id) ?? 0);
  }

  /** GetPanelLabel: the folder's name, and its unread count beside it where it has any. */
  function folderText(name: string, id: number | null): string {
    const count = folderUnread(id);
    return count > 0
      ? formatTemplate(word(FOLDER_WORDS.withCount, "{folderName} ({unreadCount})"), { folderName: name, unreadCount: count }, { nameOf: () => "" })
      : name;
  }

  /** The message a forward forwards (GetForwardWnd: isForwardedFrom=msg.messageID), 0 for none. */
  let forwardFrom = $state(0);
  /** The message quoted, in the mail's markup (GetReplyMessage), sent after what is typed; "" for none. */
  let quote = $state("");

  /** Always a NAME, never an id — and never an id-shaped fallback either. */
  function personName(characterID: number): string {
    return resolvedName($names.resolved, "character", characterID, "someone");
  }

  function ownerName(ownerID: number): string {
    return resolvedName($names.resolved, "corporation", ownerID, "their organisation");
  }

  /** A retail FILETIME as a plain date and time. Never rendered as a number. */
  function whenText(filetime: bigint | null): string {
    if (filetime === null) {
      return "—";
    }
    const unixMs = Number(filetime / 10000n - 11644473600000n);
    if (!Number.isFinite(unixMs) || unixMs <= 0) {
      return "—";
    }
    return new Date(unixMs).toLocaleString();
  }

  /** Who a message went to, in words. */
  function audienceText(header: MailHeaderRow): string {
    const audience = audienceOf(header);
    if (audience.kind === "characters") {
      const shown = audience.characterIDs.slice(0, 3).map(personName);
      const extra = audience.characterIDs.length - shown.length;
      return extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(", ");
    }
    if (audience.kind === "list") {
      return "a mailing list";
    }
    if (audience.kind === "corporation") {
      return `everyone at ${ownerName(audience.ownerID)}`;
    }
    // ⚠ A real shape: the server does not refuse mail addressed to nobody.
    return "nobody";
  }

  const flags = $derived(readFlags($mail.statuses));

  function isUnread(messageID: number): boolean {
    return flags.get(messageID) === false;
  }

  const openHeader = $derived(
    $mail.open === null
      ? null
      : ($mail.messages.find((row) => row.messageID === $mail.open?.messageID) ?? null),
  );

  const draftCheck = $derived(
    checkDraft({
      recipientIDs: recipients.map((person) => person.characterID),
      title: draftTitle,
      body: draftBody,
    }),
  );

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      error = isSessionLost(cause)
        ? "Your session ended. Pick your character again."
        : cause instanceof Error
          ? cause.message
          : String(cause);
    } finally {
      busy = false;
    }
  }

  function searchPeople(): void {
    void run(async () => {
      personMatches = await flow.findCharacters(personQuery);
      searched = true;
    });
  }

  function addRecipient(person: CharacterMatch): void {
    if (!recipients.some((chosen) => chosen.characterID === person.characterID)) {
      recipients = [...recipients, person];
    }
    personQuery = "";
    personMatches = [];
    searched = false;
  }

  function removeRecipient(characterID: number): void {
    recipients = recipients.filter((person) => person.characterID !== characterID);
  }

  /** Opening a message marks it read — the player's own deliberate act. */
  function open(messageID: number): void {
    void run(() => flow.openMail(messageID, isUnread(messageID)));
  }

  function send(): void {
    void run(async () => {
      await flow.sendMail({
        toCharacterIDs: recipients.map((person) => person.characterID),
        title: draftTitle.trim(),
        body: draftBody,
        quote,
        isReplyTo: replyTo,
        isForwardedFrom: forwardFrom,
      });
      const outcome = store.get().mail.lastOutcome;
      if (outcome && outcome.applied) {
        recipients = [];
        draftTitle = "";
        draftBody = "";
        replyTo = 0;
        forwardFrom = 0;
        quote = "";
        tab = "inbox";
      }
    });
  }

  /** The message quoted (GetReplyMessage), its body read as the client reads it; "" where it was not read. */
  async function quoteOf(header: MailHeaderRow): Promise<string> {
    const body = await flow.quotedMailBody(header.messageID);
    if (body === null) {
      return "";
    }
    const status = $mail.statuses.find((row) => row.messageID === header.messageID);
    const nameOf = (kind: Parameters<typeof resolvedName>[1], id: number) => resolvedName($names.resolved, kind, id, "");
    return mailQuoteMarkup(
      {
        subject: header.title,
        senderID: header.senderID,
        senderName: personName(header.senderID),
        automated: status !== undefined && (status.statusMask & 32) === 32,
        sentText: header.sentDate === null ? "" : formatTemplate(word(DATE_LABEL, "{[datetime]datetime}"), { datetime: String(header.sentDate) }, { nameOf }),
        corporationName: header.toCorpOrAllianceID === null ? null : ownerName(header.toCorpOrAllianceID),
        recipients: header.toCharacterIDs.map((id) => ({ id, name: personName(id) })),
        body,
      },
      {
        from: word(MAIL_QUOTE_LABELS.from, "From"),
        sent: word(MAIL_QUOTE_LABELS.sent, "Sent"),
        to: word(MAIL_QUOTE_LABELS.to, "To"),
        bold: (name) => formatTemplate(word(MAIL_QUOTE_LABELS.boldName, "<b>{name}</b>"), { name }, { nameOf }),
      },
      MAIL_MAX_BODY,
    );
  }

  /**
   * Reply (mailSvc.GetReplyWnd): to whoever wrote, or to all (the recipients less the pilot, and the sender); with
   * the client's "Re:" before the subject unless it begins so; answering that message; the message quoted.
   */
  function reply(header: MailHeaderRow, all = false): void {
    void run(async () => {
      const me = $station.online?.characterID ?? 0;
      const people = all ? [...header.toCharacterIDs.filter((id) => id !== me), header.senderID] : [header.senderID];
      recipients = [...new Set(people)].map((id) => ({ characterID: id, name: personName(id) }));
      const re = word(MAIL_QUOTE_LABELS.re, "Re:");
      draftTitle = header.title.startsWith(re) ? header.title : `${re} ${header.title}`;
      draftBody = "";
      replyTo = header.messageID;
      forwardFrom = 0;
      quote = await quoteOf(header);
      tab = "compose";
    });
  }

  /** Forward (mailSvc.GetForwardWnd): to no one yet, "FW:" before the subject, forwarding it, the message quoted. */
  function forward(header: MailHeaderRow): void {
    void run(async () => {
      recipients = [];
      draftTitle = `FW: ${header.title}`;
      draftBody = "";
      replyTo = 0;
      forwardFrom = header.messageID;
      quote = await quoteOf(header);
      tab = "compose";
    });
  }

  onMount(() => {
    flow.requestWords([...Object.values(MAIL_QUOTE_LABELS), DATE_LABEL, ...Object.values(FOLDER_WORDS)]);
    void run(async () => {
      await flow.loadMail();
      await flow.loadMailLabels();
    });
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">Mail</h2>
    <!-- ⚠ THE COUNT LEAVES THE TITLE RATHER THAN GOING WITH IT. A host that
         already says MAIL clips the title, and the unread badge was INSIDE it —
         so the one fact on this strip that changes would have been hidden by
         the rule that hides the word it sat next to. -->
    {#if $mail.unreadCount > 0}
      <p class="stat-line"><span class="badge accent">{$mail.unreadCount} unread</span></p>
    {/if}
    <p class="controls">
      <button type="button" class="primary" disabled={busy} onclick={() => void run(() => flow.refreshMail())}>
        Check for new mail
      </button>
    </p>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $mail.actionError}
    <p class="error">{$mail.actionError}</p>
  {/if}
  {#if $mail.inboxError}
    <p class="error">Your mail could not be loaded just now.</p>
  {/if}

  {#if $mail.lastOutcome}
    {#if $mail.lastOutcome.applied}
      <p class="note">
        Your message was sent to
        {$mail.lastOutcome.recipientCount === 1
          ? "one person"
          : `${$mail.lastOutcome.recipientCount} people`}.
      </p>
    {:else if $mail.lastOutcome.declinedSilently}
      <!-- ⚠ SendMail answers a bare null with no reason. Say exactly that. -->
      <p class="error">
        {$mail.lastOutcome.message ??
          "The server did not send that message, and did not say why."}
      </p>
    {/if}
  {/if}

  <nav class="tabs">
    <button type="button" class:active={tab === "inbox"} onclick={() => (tab = "inbox")}>
      Inbox
    </button>
    <button type="button" class:active={tab === "compose"} onclick={() => (tab = "compose")}>
      Write a message
    </button>
  </nav>

  {#if tab === "inbox"}
    {#if !$mail.loaded}
      <p class="note">Fetching your mail…</p>
    {:else if $mail.messages.length === 0}
      <p class="empty">You have no mail.</p>
    {:else}
      <!-- The window's folders, then the pilot's labels by name (evemail.py LoadLeftSide). -->
      <nav class="mail-folders">
        {#each SYSTEM_FOLDERS as [id, label, own] (label)}
          <button type="button" class:active={folder === id} class:mail-bold={folderUnread(id) > 0} onclick={() => (folder = id)}>
            {folderText(word(label, own), id)}
          </button>
        {/each}
        {#if ownLabels.length > 0}
          <span class="mail-folders-group">{word(FOLDER_WORDS.labels, "Labels")}</span>
          {#each ownLabels as label (label.labelID)}
            <button type="button" class:active={folder === label.labelID} class:mail-bold={folderUnread(label.labelID) > 0} onclick={() => (folder = label.labelID)}>
              {folderText(label.name, label.labelID)}
            </button>
          {/each}
        {/if}
      </nav>
      {#if shownMessages.length === 0}
        <p class="empty">Nothing in this folder.</p>
      {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>From</th>
              <th>Subject</th>
              <th>To</th>
              <th>Arrived</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each shownMessages as header (header.messageID)}
              <tr class:unread={isUnread(header.messageID)}>
                <td data-label="From">{personName(header.senderID)}</td>
                <td data-label="Subject">{header.title || "(no subject)"}</td>
                <td data-label="To">{audienceText(header)}</td>
                <td data-label="Arrived">{whenText(header.sentDate)}</td>
                <td data-label="Status">
                  {isUnread(header.messageID) ? "Unread" : "Read"}
                </td>
                <td data-label="">
                  <div class="row-actions">
                    <button type="button" disabled={busy} onclick={() => open(header.messageID)}>
                      Read it
                    </button>
                    <button
                      type="button"
                      class="minor"
                      disabled={busy}
                      onclick={() => reply(header)}
                    >
                      Reply
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {/if}
    {/if}

    {#if $mail.open !== null}
      <section class="bulk">
        <h2>{openHeader ? openHeader.title || "(no subject)" : "Message"}</h2>
        {#if openHeader}
          <p class="note">
            From {personName(openHeader.senderID)}, to {audienceText(openHeader)},
            {whenText(openHeader.sentDate)}.
          </p>
        {/if}
        {#if $mail.open.unreadable}
          <!-- The body arrived but would not inflate. Say so; show no garbage. -->
          <p class="error">This message arrived damaged and cannot be read.</p>
        {:else}
          <!-- The body's markup as the client's reading pane shows it: its lines, and in them runs as marked. -->
          <div class="mail-body">
            {#each mailBodyLines($mail.open.body) as line, place (place)}
              <p class="mail-line">{#each line as run, at (at)}<span
                    class:mail-bold={run.bold}
                    class:mail-italic={run.italic}
                    class:mail-underline={run.underline || run.link !== null}
                    title={run.link ?? undefined}>{run.text}</span>{/each}</p>
            {/each}
          </div>
        {/if}
        {#if $mail.open.markedRead === null}
          <p class="note">
            This message could not be marked as read just now, so it may still
            show as unread.
          </p>
        {/if}
        <p class="controls">
          {#if openHeader}
            <button type="button" disabled={busy} onclick={() => reply(openHeader)}>
              Reply
            </button>
            <button type="button" class="minor" disabled={busy} onclick={() => reply(openHeader, true)}>
              Reply to all
            </button>
            <button type="button" class="minor" disabled={busy} onclick={() => forward(openHeader)}>
              Forward
            </button>
          {/if}
          <button type="button" class="minor" disabled={busy} onclick={() => flow.closeMail()}>
            Close
          </button>
        </p>
      </section>
    {/if}
  {:else}
    <section class="bulk">
      <h2>Write a message</h2>

      <p class="controls">
        <label>
          Who to write to
          <input
            type="search"
            bind:value={personQuery}
            placeholder="Search by name"
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                searchPeople();
              }
            }}
          />
        </label>
        <button type="button" disabled={busy || personQuery.trim().length < 2} onclick={searchPeople}>
          Find them
        </button>
      </p>

      {#if personMatches.length > 0}
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr>
                <th>Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each personMatches as person (person.characterID)}
                <tr>
                  <td data-label="Name">{person.name}</td>
                  <td data-label="">
                    <div class="row-actions">
                      <button type="button" disabled={busy} onclick={() => addRecipient(person)}>
                        Add
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if searched && personQuery.trim().length >= 2}
        <p class="empty">Nobody by that name.</p>
      {/if}

      {#if recipients.length > 0}
        <p class="note">
          Sending to:
          {#each recipients as person (person.characterID)}
            <button
              type="button"
              class="minor"
              disabled={busy}
              onclick={() => removeRecipient(person.characterID)}
            >
              {person.name} ✕
            </button>
          {/each}
        </p>
      {/if}

      <p class="controls">
        <label>
          Subject
          <input type="text" maxlength={MAIL_MAX_TITLE} bind:value={draftTitle} />
        </label>
      </p>
      <p class="controls">
        <label class="grow">
          Message
          <textarea rows="8" maxlength={MAIL_MAX_BODY} bind:value={draftBody}></textarea>
        </label>
      </p>
      {#if quote !== ""}
        <!-- The message quoted, sent below what is typed, as the client's editor holds it. -->
        <div class="mail-body mail-quote">
          {#each mailBodyLines(quote) as line, place (place)}
            <p class="mail-line">{#each line as run, at (at)}<span
                  class:mail-bold={run.bold}
                  class:mail-italic={run.italic}
                  class:mail-underline={run.underline || run.link !== null}
                  title={run.link ?? undefined}>{run.text}</span>{/each}</p>
          {/each}
        </div>
      {/if}

      {#if !draftCheck.ok && (recipients.length > 0 || draftTitle !== "" || draftBody !== "")}
        <p class="error">{draftCheck.message}</p>
      {/if}

      <p class="controls">
        <button type="button" disabled={busy || !draftCheck.ok} onclick={send}>
          Send it
        </button>
        <button
          type="button"
          class="minor"
          disabled={busy}
          onclick={() => {
            recipients = [];
            draftTitle = "";
            draftBody = "";
            replyTo = 0;
            forwardFrom = 0;
            quote = "";
            tab = "inbox";
          }}
        >
          Never mind
        </button>
      </p>
    </section>
  {/if}
</section>

<style>
  /* Message text keeps the sender's own line breaks and never runs off the
   * side of a phone. */
  .mail-body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .mail-line {
    margin: 0;
    min-height: 1lh;
  }
  .mail-quote {
    opacity: 0.8;
  }
  .mail-folders {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .mail-folders button.active {
    text-decoration: underline;
  }
  .mail-folders-group {
    margin-left: 0.5rem;
    opacity: 0.8;
  }
  .mail-bold {
    font-weight: 700;
  }
  .mail-italic {
    font-style: italic;
  }
  .mail-underline {
    text-decoration: underline;
  }
  /* An unread row reads as unread without relying on colour alone. */
  tr.unread td {
    font-weight: 600;
  }
  .badge {
    font-size: 12px;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 0;
    border: 1px solid var(--color-line-strong);
    vertical-align: middle;
  }
  label.grow {
    flex: 1 1 100%;
  }
  textarea {
    width: 100%;
    font: inherit;
    min-height: 8rem;
  }
</style>
