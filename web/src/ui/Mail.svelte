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
    isTrashed,
    MAIL_FOLDER_ALLIANCE,
    MAIL_FOLDER_CORPORATION,
    MAIL_FOLDER_INBOX,
    MAIL_FOLDER_SENT,
    MAIL_FOLDER_TRASH,
    mailsInFolder,
    mailsOfList,
    unreadByList,
    MAIL_LABEL_MAX,
    MAILING_LIST_NAME_MAX,
    unreadByLabel,
  } from "../bridge/mail.ts";
  import { MAIL_QUOTE_LABELS, mailBodyLines, mailQuoteMarkup } from "../bridge/mailMarkup.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
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
  /** The mailing list shown in place of a folder (evemail.py LoadMailinglistMails), or null. */
  let viewingList = $state<number | null>(null);

  /** The folder words, by their labels (evemail.py GetStaticLabelsGroups; LoadLeftSide; GetPanelLabel). */
  const FOLDER_WORDS = {
    all: "UI/Mail/LabelAllMails",
    inbox: "UI/Mail/LabelInbox",
    sent: "UI/Mail/LabelSent",
    corporation: "UI/Common/Corp",
    alliance: "UI/Common/Groups/Alliance",
    trash: "UI/Mail/LabelTrash",
    labels: "UI/Mail/Labels",
    lists: "UI/Mail/MailingLists",
    addList: "UI/Mail/AddMailingList",
    createOrJoin: "UI/Mail/CreateOrJoinML",
    listName: "UI/Mail/MailingListName",
    join: "UI/Mail/Join",
    create: "UI/Mail/Create",
    nameTooLong: "UI/Mail/NameIsTooLong",
    leaveList: "UI/Mail/LeaveMailingList",
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
  const shownMessages = $derived(viewingList !== null ? mailsOfList($mail, viewingList) : mailsInFolder($mail, folder));
  const listUnread = $derived(unreadByList($mail));
  /** The lists joined, by name (GetMaillistSubContent). */
  const joinedLists = $derived([...($mail.lists ?? [])].sort((left, right) => left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase())));

  let addingList = $state(false);
  let listNameInput = $state("");

  /**
   * MailinglistWnd's Join and Create (evemail.py 2897 to 2919): an empty name refused (LookupStringMinimum), a
   * made one over sixty refused (UI/Mail/NameIsTooLong); then asked, and the window put away where it was done.
   */
  function addList(create: boolean): void {
    const name = listNameInput;
    labelNote = "";
    if (name.trim() === "") {
      labelNote = filledWord("dialog:LookupStringMinimum/body", "Please type in at least {minimum} character", { minimum: "1" });
      return;
    }
    if (create && name.length > MAILING_LIST_NAME_MAX) {
      labelNote = word(FOLDER_WORDS.nameTooLong, "The name is too long.");
      return;
    }
    void run(async () => {
      const listID = create ? await flow.createMailingList(name) : await flow.joinMailingList(name);
      if (listID !== null) {
        listNameInput = "";
        addingList = false;
      }
    });
  }

  /** Who sent a mail: a list's own mail named by the list (mailSvc.py 1145 to 1146), anyone else by name. */
  function senderName(header: MailHeaderRow): string {
    if (header.toListID !== null && header.senderID === header.toListID) {
      const list = ($mail.lists ?? []).find((each) => each.listID === header.toListID);
      if (list !== undefined) return list.displayName;
    }
    return personName(header.senderID);
  }

  /** The words of a folder's writes, by their labels (evemail.py StaticMenu), and the dialogs' answers. */
  const FOLDER_WRITE_WORDS = {
    markAll: "UI/Mail/MarkAllAsReadWithFolderName",
    trashAll: "UI/Mail/TrashAllWithFolderName",
    all: "UI/Common/All",
    restoreAll: "UI/Mail/RestoreAll",
    emptyTrash: "UI/Mail/EmptyTrash",
    yes: "UI/Common/Buttons/Yes",
    no: "UI/Common/Buttons/No",
  } as const;
  /** The client's dialogs to be sure of a folder's write, by their names. */
  const FOLDER_DIALOGS = ["EvemailMailMarkAllRead", "EvemailMailTrashAll", "EvemailMailRestoreAll", "EvemailMaillDeleteAll", "EvemailMailReadLabelGroup", "EvemailMailTrashLabelGroup"] as const;

  /** A folder's write waiting on the pilot's yes: the client's dialog, what fills it, and what it does. */
  let confirming = $state<{ readonly dialog: string; readonly args: Record<string, string>; readonly act: () => Promise<void> } | null>(null);

  /** The folder shown, by name (its word, or its label's name). */
  const folderName = $derived(
    folder === null || SYSTEM_FOLDERS.some(([id]) => id === folder)
      ? (() => {
          const found = SYSTEM_FOLDERS.find(([id]) => id === folder);
          return found ? word(found[1], found[2]) : "";
        })()
      : (ownLabels.find((label) => label.labelID === folder)?.name ?? ""),
  );

  /** A client's template filled, the page's own words where the install has none. */
  function filledWord(label: string, own: string, args: Record<string, string>): string {
    return plainText(formatTemplate(word(label, own), args, { nameOf: () => "" }));
  }

  /** One of the waiting dialog's two texts, filled. */
  function dialogText(part: "title" | "body"): string {
    const waiting = confirming;
    if (waiting === null) {
      return "";
    }
    return filledWord(`dialog:${waiting.dialog}/${part}`, part === "title" ? "Are you sure?" : "", waiting.args);
  }

  /** The words of the labels' writes, by their labels (ManageLabelsBase; GetMsgMenu; mailSvc.py 1290 to 1317). */
  const LABEL_WORDS = {
    manage: "UI/Mail/ManageLabels",
    name: "UI/Mail/LabelName",
    create: "UI/Mail/Create",
    rename: "UI/Mail/LabelRename",
    typeNew: "UI/Mail/LabelTypeNew",
    tooLong: "UI/Mail/LabelTooLong",
    assign: "UI/Mail/AssignLabel",
    remove: "UI/Mail/LabelRemove",
    assigned: "UI/Mail/LabelAssigned",
    removed: "UI/Mail/LabelRemoved",
    corp: "UI/Mail/LabelCorp",
    alliance: "UI/Mail/LabelAlliance",
    delete: "UI/Mail/Delete",
    ok: "UI/Common/Buttons/OK",
    cancel: "UI/Common/Buttons/Cancel",
  } as const;
  /** The client's dialogs of the labels' writes, by their names. */
  const LABEL_DIALOGS = ["DeleteMailLabel", "MailLabelNameExists", "LookupStringMinimum"] as const;

  let managingLabels = $state(false);
  let newLabelName = $state("");
  let renaming = $state<{ readonly labelID: number; name: string } | null>(null);
  /** What the last label's write said (the client's note after an assignment or a removal), or a refusal. */
  let labelNote = $state("");

  /**
   * GetAllLabels(assignable=1) (mailSvc.py 681 to 710): the system's that may be given (the inbox, the
   * corporation's and the alliance's, by the client's own names) and the pilot's own, each by its bit and name.
   */
  const assignableLabels = $derived([
    { labelID: MAIL_FOLDER_INBOX, name: word(FOLDER_WORDS.inbox, "Inbox") },
    { labelID: MAIL_FOLDER_CORPORATION, name: word(LABEL_WORDS.corp, "Corp") },
    { labelID: MAIL_FOLDER_ALLIANCE, name: word(LABEL_WORDS.alliance, "Alliance") },
    ...ownLabels.map((label) => ({ labelID: label.labelID, name: label.name })),
  ]);

  /**
   * GetAssignLabelMenu and GetRemoveLabelMenu: the labels a message lacks, or has, sorted as the client sorts them,
   * the system's by "  " and their bit (so first, by bit) and the pilot's own by name.
   */
  function labelsFor(messageID: number, has: boolean): readonly { labelID: number; name: string }[] {
    const mask = $mail.statuses.find((row) => row.messageID === messageID)?.labelMask ?? 0;
    const system = new Set([MAIL_FOLDER_INBOX, MAIL_FOLDER_CORPORATION, MAIL_FOLDER_ALLIANCE]);
    const key = (label: { labelID: number; name: string }) => (system.has(label.labelID) ? `  ${label.labelID}` : label.name.toLowerCase());
    return assignableLabels
      .filter((label) => ((mask & label.labelID) === label.labelID) === has)
      .sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));
  }

  /** A message given a label, or one taken off it, and the client's note of it. */
  function labelMessage(messageID: number, labelID: number, give: boolean): void {
    const label = assignableLabels.find((each) => each.labelID === labelID);
    if (label === undefined) {
      return;
    }
    void run(async () => {
      const count = give ? await flow.assignMailLabel([messageID], labelID) : await flow.removeMailLabel([messageID], labelID);
      if (count > 0) {
        labelNote = filledWord(give ? LABEL_WORDS.assigned : LABEL_WORDS.removed, give ? "The label \"{labelName}\" has been assigned to {numMails} mails" : "The label \"{labelName}\" has been removed from {numMails} mails", { labelName: label.name, numMails: String(count) });
      }
    });
  }

  /**
   * The labels window's Create (CreateLabel, 1563 to 1580): the name trimmed, refused where a label has it (by the
   * client's own words), where it is empty, or where it is over forty; then made.
   */
  function createLabel(): void {
    const name = newLabelName.trim();
    labelNote = "";
    if (assignableLabels.some((label) => label.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === word(FOLDER_WORDS.sent, "Sent").toLowerCase()) {
      labelNote = filledWord("dialog:MailLabelNameExists/body", "This label name already exists", {});
      return;
    }
    if (name.length < 1) {
      labelNote = filledWord("dialog:LookupStringMinimum/body", "Please type in at least {minimum} character", { minimum: "1" });
      return;
    }
    if (name.length > MAIL_LABEL_MAX) {
      labelNote = word(LABEL_WORDS.tooLong, "Label name is too long.");
      return;
    }
    void run(async () => {
      if ((await flow.createMailLabel(name)) !== null) {
        newLabelName = "";
      }
    });
  }

  /** RenameLabelFromUI (1290 to 1299): a new name, trimmed; nothing done where it is empty. */
  function renameLabel(): void {
    const waiting = renaming;
    renaming = null;
    const name = waiting === null ? "" : waiting.name.trim();
    if (waiting === null || name === "") {
      return;
    }
    void run(() => flow.renameMailLabel(waiting.labelID, name));
  }

  /** The pilot's yes: the write done. */
  function confirmed(): void {
    const waiting = confirming;
    confirming = null;
    if (waiting !== null) {
      void run(waiting.act);
    }
  }

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

  /** The words of a message's writes, by their labels (evemail.py GetMsgMenu). */
  const WRITE_WORDS = {
    read: "UI/Mail/MarkAsRead",
    unread: "UI/Mail/MarkAsUnread",
    trash: "UI/Mail/Trash",
    restore: "UI/Mail/Restore",
    delete: "UI/Mail/Delete",
  } as const;

  /** Whether a message is in the trash, as its status says. */
  function inTrash(messageID: number): boolean {
    const status = $mail.statuses.find((row) => row.messageID === messageID);
    return status !== undefined && isTrashed(status);
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
      return ($mail.lists ?? []).find((list) => list.listID === header.toListID)?.displayName ?? "a mailing list";
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
    flow.requestWords([
      ...Object.values(MAIL_QUOTE_LABELS), DATE_LABEL, ...Object.values(FOLDER_WORDS), ...Object.values(WRITE_WORDS), ...Object.values(FOLDER_WRITE_WORDS),
      ...FOLDER_DIALOGS.flatMap((dialog) => [`dialog:${dialog}/title`, `dialog:${dialog}/body`]),
      ...Object.values(LABEL_WORDS),
      ...LABEL_DIALOGS.flatMap((dialog) => [`dialog:${dialog}/title`, `dialog:${dialog}/body`]),
    ]);
    void run(async () => {
      await flow.loadMail();
      await flow.loadMailLabels();
      await flow.loadMailingLists();
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
    <!-- The labels window (evemail.py ManageLabelsBase): a new label by name, and each of the pilot's own renamed or deleted. -->
    <p class="controls">
      <button type="button" class="minor" onclick={() => (managingLabels = !managingLabels)}>{word(LABEL_WORDS.manage, "Manage Labels")}</button>
      <!-- The mail window's Add Mailing List (evemail.py 237): MailinglistWnd, a name, Join or Create. -->
      <button type="button" class="minor" onclick={() => (addingList = !addingList)}>{word(FOLDER_WORDS.addList, "Add Mailing List")}</button>
    </p>
    {#if addingList}
      <section class="bulk mail-add-list">
        <h3>{word(FOLDER_WORDS.createOrJoin, "Create or Join Mailing List")}</h3>
        <p class="controls">
          <label>
            {word(FOLDER_WORDS.listName, "Mailing List Name")}
            <input type="text" maxlength={MAILING_LIST_NAME_MAX} bind:value={listNameInput} />
          </label>
          <button type="button" disabled={busy} onclick={() => addList(false)}>{word(FOLDER_WORDS.join, "Join")}</button>
          <button type="button" class="minor" disabled={busy} onclick={() => addList(true)}>{word(FOLDER_WORDS.create, "Create")}</button>
        </p>
      </section>
    {/if}
    {#if labelNote !== ""}
      <p class="note">{labelNote}</p>
    {/if}
    {#if managingLabels}
      <section class="bulk mail-labels">
        <h3>{word(LABEL_WORDS.manage, "Manage Labels")}</h3>
        <p class="controls">
          <label>
            {word(LABEL_WORDS.name, "Label Name")}
            <input type="text" maxlength={MAIL_LABEL_MAX} bind:value={newLabelName} />
          </label>
          <button type="button" disabled={busy} onclick={createLabel}>{word(LABEL_WORDS.create, "Create")}</button>
        </p>
        <ul class="mail-label-list">
          {#each ownLabels as label (label.labelID)}
            <li>
              {label.name}
              <button type="button" class="minor" disabled={busy} onclick={() => (renaming = { labelID: label.labelID, name: label.name })}>{word(LABEL_WORDS.rename, "Rename")}</button>
              <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "DeleteMailLabel", args: { labelName: label.name }, act: () => flow.deleteMailLabel(label.labelID) })}>{word(LABEL_WORDS.delete, "Delete")}</button>
            </li>
          {/each}
        </ul>
        {#if renaming !== null}
          <p class="controls">
            <label>
              {word(LABEL_WORDS.typeNew, "Type a new label name.")}
              <input type="text" maxlength={MAIL_LABEL_MAX} bind:value={renaming.name} />
            </label>
            <button type="button" disabled={busy} onclick={renameLabel}>{word(LABEL_WORDS.ok, "OK")}</button>
            <button type="button" class="minor" onclick={() => (renaming = null)}>{word(LABEL_WORDS.cancel, "Cancel")}</button>
          </p>
        {/if}
      </section>
    {/if}
    {#if confirming !== null}
      <!-- The client's dialog to be sure of it: its title, its question, yes and no. -->
      <div class="mail-confirm" role="alertdialog" aria-label={dialogText("title")}>
        <strong>{dialogText("title")}</strong>
        <p>{dialogText("body")}</p>
        <p class="controls">
          <button type="button" disabled={busy} onclick={confirmed}>{word(FOLDER_WRITE_WORDS.yes, "Yes")}</button>
          <button type="button" class="minor" onclick={() => (confirming = null)}>{word(FOLDER_WRITE_WORDS.no, "No")}</button>
        </p>
      </div>
    {/if}
    {#if !$mail.loaded}
      <p class="note">Fetching your mail…</p>
    {:else}
      <!-- The window's folders, then the pilot's labels by name (evemail.py LoadLeftSide), whatever the mailbox holds. -->
      <nav class="mail-folders">
        {#each SYSTEM_FOLDERS as [id, label, own] (label)}
          <button type="button" class:active={viewingList === null && folder === id} class:mail-bold={folderUnread(id) > 0} onclick={() => { folder = id; viewingList = null; }}>
            {folderText(word(label, own), id)}
          </button>
        {/each}
        {#if ownLabels.length > 0}
          <span class="mail-folders-group">{word(FOLDER_WORDS.labels, "Labels")}</span>
          {#each ownLabels as label (label.labelID)}
            <button type="button" class:active={viewingList === null && folder === label.labelID} class:mail-bold={folderUnread(label.labelID) > 0} onclick={() => { folder = label.labelID; viewingList = null; }}>
              {folderText(label.name, label.labelID)}
            </button>
          {/each}
        {/if}
        {#if joinedLists.length > 0}
          <span class="mail-folders-group">{word(FOLDER_WORDS.lists, "Mailing Lists")}</span>
          {#each joinedLists as list (list.listID)}
            {@const unread = listUnread.get(list.listID) ?? 0}
            <button type="button" class:active={viewingList === list.listID} class:mail-bold={unread > 0} onclick={() => (viewingList = list.listID)}>
              {unread > 0 ? filledWord(FOLDER_WORDS.withCount, "{folderName} ({unreadCount})", { folderName: list.displayName, unreadCount: String(unread) }) : list.displayName}
            </button>
          {/each}
        {/if}
      </nav>
      <!-- The folder's own writes (evemail.py StaticMenu), each asked to be sure of in the client's words. -->
      <p class="controls mail-folder-actions">
        {#if viewingList !== null}
          <!-- A list's own menu (evemail.py MaillistMenu): its owner's delete, and its by-list writes, are to come. -->
          {@const shownList = ($mail.lists ?? []).find((each) => each.listID === viewingList)}
          {#if shownList !== undefined && !shownList.isOwner}
            <button type="button" class="minor" disabled={busy} onclick={() => { const id = shownList.listID; viewingList = null; void run(() => flow.leaveMailingList(id)); }}>
              {word(FOLDER_WORDS.leaveList, "Leave Mailing List")}
            </button>
          {/if}
        {:else if folder === MAIL_FOLDER_TRASH}
          <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "EvemailMailRestoreAll", args: {}, act: () => flow.restoreAllMail() })}>
            {word(FOLDER_WRITE_WORDS.restoreAll, "Restore All")}
          </button>
          <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "EvemailMaillDeleteAll", args: {}, act: () => flow.emptyMailTrash() })}>
            {word(FOLDER_WRITE_WORDS.emptyTrash, "Empty Trash")}
          </button>
        {:else if folder === null}
          <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "EvemailMailMarkAllRead", args: {}, act: () => flow.readAllMail(null) })}>
            {filledWord(FOLDER_WRITE_WORDS.markAll, "Mark All as Read ({folderName})", { folderName: word(FOLDER_WRITE_WORDS.all, "All") })}
          </button>
          <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "EvemailMailTrashAll", args: {}, act: () => flow.trashAllMail(null) })}>
            {filledWord(FOLDER_WRITE_WORDS.trashAll, "Trash All ({folderName})", { folderName: word(FOLDER_WRITE_WORDS.all, "All") })}
          </button>
        {:else}
          {@const labelID = folder}
          <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "EvemailMailReadLabelGroup", args: { labelName: folderName }, act: () => flow.readAllMail(labelID) })}>
            {filledWord(FOLDER_WRITE_WORDS.markAll, "Mark All as Read ({folderName})", { folderName })}
          </button>
          <button type="button" class="minor" disabled={busy} onclick={() => (confirming = { dialog: "EvemailMailTrashLabelGroup", args: { labelName: folderName }, act: () => flow.trashAllMail(labelID) })}>
            {filledWord(FOLDER_WRITE_WORDS.trashAll, "Trash All ({folderName})", { folderName })}
          </button>
        {/if}
      </p>
      {#if $mail.messages.length === 0}
        <p class="empty">You have no mail.</p>
      {:else if shownMessages.length === 0}
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
                <td data-label="From">{senderName(header)}</td>
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
                    <!-- The mail window's menu of a message (GetMsgMenu): read or not, and trash; restore and delete in the trash. -->
                    {#if isUnread(header.messageID)}
                      <button type="button" class="minor" disabled={busy} onclick={() => void run(() => flow.markMail([header.messageID], true))}>
                        {word(WRITE_WORDS.read, "Mark as Read")}
                      </button>
                    {:else}
                      <button type="button" class="minor" disabled={busy} onclick={() => void run(() => flow.markMail([header.messageID], false))}>
                        {word(WRITE_WORDS.unread, "Mark as Unread")}
                      </button>
                    {/if}
                    {#if inTrash(header.messageID)}
                      <button type="button" class="minor" disabled={busy} onclick={() => void run(() => flow.restoreMail([header.messageID]))}>
                        {word(WRITE_WORDS.restore, "Restore")}
                      </button>
                      <button type="button" class="minor" disabled={busy} onclick={() => void run(() => flow.deleteMail([header.messageID]))}>
                        {word(WRITE_WORDS.delete, "Delete")}
                      </button>
                    {:else}
                      <!-- GetAssignLabelMenu and GetRemoveLabelMenu: the labels it lacks, and those it has. -->
                      {@const lacking = labelsFor(header.messageID, false)}
                      {@const having = labelsFor(header.messageID, true)}
                      {#if lacking.length > 0}
                        <select aria-label={word(LABEL_WORDS.assign, "Assign Label")} disabled={busy} onchange={(event) => { const select = event.currentTarget; labelMessage(header.messageID, Number(select.value), true); select.value = ""; }}>
                          <option value="">{word(LABEL_WORDS.assign, "Assign Label")}</option>
                          {#each lacking as label (label.labelID)}
                            <option value={label.labelID}>{label.name}</option>
                          {/each}
                        </select>
                      {/if}
                      {#if having.length > 0}
                        <select aria-label={word(LABEL_WORDS.remove, "Remove Label")} disabled={busy} onchange={(event) => { const select = event.currentTarget; labelMessage(header.messageID, Number(select.value), false); select.value = ""; }}>
                          <option value="">{word(LABEL_WORDS.remove, "Remove Label")}</option>
                          {#each having as label (label.labelID)}
                            <option value={label.labelID}>{label.name}</option>
                          {/each}
                        </select>
                      {/if}
                      <button type="button" class="minor" disabled={busy} onclick={() => void run(() => flow.trashMail([header.messageID]))}>
                        {word(WRITE_WORDS.trash, "Trash")}
                      </button>
                    {/if}
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
  .mail-confirm {
    border: 1px solid currentColor;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
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
