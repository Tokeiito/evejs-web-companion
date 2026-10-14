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
    MAILING_LIST_MEMBER_DEFAULT,
    MAILING_LIST_MEMBER_MUTED,
    MAILING_LIST_MEMBER_OPERATOR,
    MAILING_LIST_MEMBER_OWNER,
    MAILING_LIST_MEMBERS_PER_PAGE,
    mailingListMembersShown,
    type MailingListMember,
    type MailingListMemberAction,
    type MailingListMemberFilter,
    type MailingListSettings,
    MAILING_LIST_ALLOWED,
    MAILING_LIST_BLOCKED,
    type OwnerMatch,
    MAIL_MAX_TAGGED_BODY,
    MAILS_PER_PAGE,
    mailLabelText,
    mailRecipientOf,
    mailRowState,
    mailsNewestFirst,
  } from "../bridge/mail.ts";
  import { MAIL_QUOTE_LABELS, mailBodyLines, mailMarkupOfTyped, mailQuoteMarkup } from "../bridge/mailMarkup.ts";
  import { pyIntDictOrder } from "../bridge/pyDict.ts";
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
  /** The mailing list written to (the compose window's toListID), or null. */
  let toList = $state<number | null>(null);
  /** The list written to while the pilot has it joined, as ValidateReceivers keeps it (evemail.py 2198 to 2201). */
  const composeList = $derived(toList === null ? undefined : ($mail.lists ?? []).find((list) => list.listID === toList));
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
    sendToList: "UI/Mail/SendMailToList",
    deleteList: "UI/Mail/DeleteMailingList",
    mailEntry: "UI/Mail/MailEntry",
    ml: "UI/Mail/ML",
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
  /** The page of the folder shown (the window's startPos), the first as a folder is shown; newest first, thirty to a page. */
  let mailPage = $state(0);
  const sortedMessages = $derived(mailsNewestFirst(shownMessages));
  const mailPages = $derived(Math.max(1, Math.ceil(sortedMessages.length / MAILS_PER_PAGE)));
  const pageShown = $derived(Math.min(mailPage, mailPages - 1));
  const pageMessages = $derived(sortedMessages.slice(pageShown * MAILS_PER_PAGE, (pageShown + 1) * MAILS_PER_PAGE));
  /** The Sent folder names a mail's recipient where any other names its sender (RefreshMsgScrollHeaders, evemail.py 656 to 672). */
  const inSent = $derived(viewingList === null && folder === MAIL_FOLDER_SENT);
  const statusByID = $derived(new Map($mail.statuses.map((status) => [status.messageID, status] as const)));
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

  /** A list by its name, as the lists service keeps it: joined, or named before (GetDisplayName); null for one not yet named. */
  function listName(listID: number): string | null {
    return (($mail.lists ?? []).find((list) => list.listID === listID) ?? $mail.externalLists.find((list) => list.listID === listID))?.displayName ?? null;
  }

  /** Who sent a mail: a list's own mail named by the list (mailSvc.py 1145 to 1146), anyone else by name. */
  function senderName(header: MailHeaderRow): string {
    if (header.toListID !== null && header.senderID === header.toListID) {
      const name = listName(header.toListID);
      if (name !== null) return name;
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
  const FOLDER_DIALOGS = ["EvemailMailMarkAllRead", "EvemailMailTrashAll", "EvemailMailRestoreAll", "EvemailMaillDeleteAll", "EvemailMailReadLabelGroup", "EvemailMailTrashLabelGroup", "EvemailMailReadMailinglistGroup", "EvemailMailTrashMailinglistGroup", "DeleteMailingList"] as const;

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
      return listName(header.toListID ?? 0) ?? "a mailing list";
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
      listed: composeList !== undefined,
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
        toListID: composeList?.listID ?? null,
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
        toList = null;
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
        senderName: senderName(header),
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
   * Reply (mailSvc.GetReplyWnd): to whoever wrote, or to all (the recipients less the pilot, the sender, and the
   * mailing list it went to, where the pilot has it joined: the compose window keeps no other, evemail.py 1816 to 1821); with
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
      toList = all ? header.toListID : null;
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
      toList = null;
      draftTitle = `FW: ${header.title}`;
      draftBody = "";
      replyTo = 0;
      forwardFrom = header.messageID;
      quote = await quoteOf(header);
      tab = "compose";
    });
  }

  /** A list's Send Mail to Mailing List (evemail.py SendMailToList; mailSvc.SendMsgDlg): a new message to the list alone. */
  function sendToList(listID: number): void {
    recipients = [];
    toList = listID;
    draftTitle = "";
    draftBody = "";
    replyTo = 0;
    forwardFrom = 0;
    quote = "";
    tab = "compose";
  }

  /** Whom a sent message went to, in the page's words. */
  function sentTo(count: number, list: string | null): string {
    const people = count === 1 ? "one person" : `${count} people`;
    if (list === null) return people;
    return count === 0 ? `the mailing list ${list}` : `the mailing list ${list} and ${people}`;
  }

  /** The management window's words, by their labels (evemailingListConfig.py 54 to 130, 238 to 260). */
  const MANAGE_WORDS = {
    open: "UI/Mail/OpenMailingListMgmt",
    caption: "UI/EVEMail/MailingLists/Caption",
    membersTab: "UI/EVEMail/MailingLists/MembersTab",
    show: "UI/EVEMail/MailingLists/ShowLabel",
    all: "UI/Common/All",
    normal: "UI/EVEMail/MailingLists/NormalMembers",
    muted: "UI/EVEMail/MailingLists/MutedMembers",
    operators: "UI/Chat/Operators",
    byName: "UI/EVEMail/MailingLists/SearchByName",
    searchString: "UI/PeopleAndPlaces/SearchString",
    search: "UI/Common/Buttons/Search",
    previous: "UI/Common/Previous",
    next: "UI/Common/Next",
    setMember: "UI/EVEMail/MailingLists/SetRoleMember",
    setMuted: "UI/EVEMail/MailingLists/SetRoleMuted",
    setOperator: "UI/EVEMail/MailingLists/SetRoleOperator",
    kick: "UI/EVEMail/MailingLists/Kick",
    applyTo: "UI/EVEMail/MailingLists/ApplyToSelected",
    apply: "UI/Generic/Apply",
    member: "UI/EVEMail/MailingLists/Member",
    mutedMember: "UI/EVEMail/MailingLists/MutedMember",
    operator: "UI/EVEMail/MailingLists/Operator",
    owner: "UI/EVEMail/MailingLists/Owner",
    name: "UI/Generic/NamePerson",
    role: "UI/EVEMail/MailingLists/Role",
    none: "UI/EVEMail/MailingLists/NoMembersFound",
  } as const;
  /** The client's dialogs to be sure of the pilot's own place changed. */
  const MANAGE_DIALOGS = ["MailingListMemberSelfConfirm", "MailingListMuteSelfConfirm"] as const;
  /** Show's choices, in the window's order (StartupMembersPanel, 81 to 91). */
  const MEMBER_FILTERS: readonly (readonly [MailingListMemberFilter, string, string])[] = [
    ["all", MANAGE_WORDS.all, "All"],
    ["members", MANAGE_WORDS.normal, "Normal members"],
    ["muted", MANAGE_WORDS.muted, "Muted members"],
    ["operators", MANAGE_WORDS.operators, "Operators"],
    ["byName", MANAGE_WORDS.byName, "Search by name"],
  ];
  /** Apply to selected's choices, in the window's order (110 to 119). */
  const MEMBER_ACTIONS: readonly (readonly [MailingListMemberAction, string, string])[] = [
    ["member", MANAGE_WORDS.setMember, "Set role: Member"],
    ["muted", MANAGE_WORDS.setMuted, "Set role: Muted member"],
    ["operator", MANAGE_WORDS.setOperator, "Set role: Operator"],
    ["kick", MANAGE_WORDS.kick, "Kick"],
  ];
  /** Each place's word (self.roles, 121 to 124). */
  const ROLE_WORDS: Readonly<Record<number, readonly [string, string]>> = {
    [MAILING_LIST_MEMBER_DEFAULT]: [MANAGE_WORDS.member, "Member"],
    [MAILING_LIST_MEMBER_MUTED]: [MANAGE_WORDS.mutedMember, "Muted member"],
    [MAILING_LIST_MEMBER_OPERATOR]: [MANAGE_WORDS.operator, "Operator"],
    [MAILING_LIST_MEMBER_OWNER]: [MANAGE_WORDS.owner, "Owner"],
  };

  /** The list whose management window is open, or null. */
  let managingList = $state<number | null>(null);
  /** The list's settings as the window last asked them: the Access tab's lists. */
  let listSettings = $state<MailingListSettings | null>(null);
  /** The members as the window last asked them, and the choice and search they were shown by then. */
  let listMembers = $state<readonly MailingListMember[]>([]);
  let shownFilter = $state<MailingListMemberFilter>("all");
  let shownSearch = $state("");
  /** Show's choice and the search as they stand, the page shown, Apply's choice, and the members chosen. */
  let memberFilter = $state<MailingListMemberFilter>("all");
  let memberSearch = $state("");
  let memberPage = $state(0);
  let memberAction = $state<MailingListMemberAction>("member");
  let chosenMembers = $state<ReadonlySet<number>>(new Set());
  const managedList = $derived(managingList === null ? undefined : ($mail.lists ?? []).find((list) => list.listID === managingList));
  const shownMembers = $derived(mailingListMembersShown(listMembers, shownFilter, shownSearch, personName));
  /** PageMembers (223 to 236): pages of fifty, none where no member is shown, as the window counts them. */
  const memberPages = $derived(Math.ceil(shownMembers.length / MAILING_LIST_MEMBERS_PER_PAGE));
  const pageOfMembers = $derived(shownMembers.slice(memberPage * MAILING_LIST_MEMBERS_PER_PAGE, (memberPage + 1) * MAILING_LIST_MEMBERS_PER_PAGE));

  /**
   * Open Mailing List Management (MaillistSetupWindow.ApplyAttributes, 54 to 77): the Access panel, built first,
   * asks the settings three times (its two choices, 378 and 389, and its lists, 437); then the Members tab, the one
   * selected, asks the members (Load, 522 to 524).
   */
  function openListManagement(listID: number): void {
    managingList = listID;
    listSettings = null;
    listMembers = [];
    memberFilter = "all";
    memberSearch = "";
    memberAction = "member";
    manageTab = "members";
    entityText = "";
    entityPick = null;
    accessNote = "";
    chosenAccess = new Set();
    // The Welcome Mail panel, built as the window opens: its box as last left for the list (463), its fields empty.
    welcomeLoaded = false;
    welcomeSubject = "";
    welcomeBody = "";
    welcomeNote = "";
    welcomeToAllChecked = flow.welcomeToAll(listID);
    void run(async () => {
      // The Access tab's two choices are built from the first two asks (378, 389) and are not built again.
      const first = await flow.readMailingListSettings(listID);
      accessChoice = first?.defaultAccess ?? MAILING_LIST_BLOCKED;
      const second = await flow.readMailingListSettings(listID);
      roleChoice = second?.defaultMemberAccess ?? MAILING_LIST_MEMBER_DEFAULT;
      listSettings = await flow.readMailingListSettings(listID);
      await updateMembers();
    });
  }

  /** UpdateMembersScroll (166 to 174): the members asked again and shown by the choice and search as they stand, from the first page. */
  async function updateMembers(): Promise<void> {
    const listID = managingList;
    if (listID === null) {
      return;
    }
    const members = await flow.readMailingListMembers(listID);
    if (managingList !== listID) {
      return;
    }
    listMembers = members;
    shownFilter = memberFilter;
    shownSearch = memberSearch;
    memberPage = 0;
    chosenMembers = new Set();
  }

  /** OnShowMembersComboChanged (138 to 146): a choice other than by name asks the members again; by name waits for its search. */
  function chooseMemberFilter(filter: MailingListMemberFilter): void {
    memberFilter = filter;
    if (filter !== "byName") {
      void run(updateMembers);
    }
  }

  /** ChangeMembersPage (148 to 164): another page, nothing chosen on it. */
  function turnMemberPage(change: number): void {
    memberPage += change;
    chosenMembers = new Set();
  }

  function chooseMember(characterID: number, chosen: boolean): void {
    const next = new Set(chosenMembers);
    if (chosen) {
      next.add(characterID);
    } else {
      next.delete(characterID);
    }
    chosenMembers = next;
  }

  /**
   * ApplyActionToMembers (266 to 293): the members chosen, in the order shown. The pilot made a member or muted is
   * asked to be sure of first, and the window put away after; a kick asks the settings again
   * (UpdateAccessScrollData, 435 to 451) before the members; anything else asks the members again.
   */
  function applyToMembers(): void {
    const listID = managingList;
    if (listID === null) {
      return;
    }
    const chosen = pageOfMembers.filter((member) => chosenMembers.has(member.characterID)).map((member) => member.characterID);
    const action = memberAction;
    const me = $station.online?.characterID ?? 0;
    const write = async (closing: boolean): Promise<void> => {
      if (!(await flow.setMailingListMembers(listID, chosen, action))) {
        return;
      }
      if (action === "kick") {
        await rereadAccess(listID);
      }
      if (closing) {
        managingList = null;
        return;
      }
      await updateMembers();
    };
    if ((action === "member" || action === "muted") && chosen.includes(me)) {
      confirming = { dialog: action === "member" ? "MailingListMemberSelfConfirm" : "MailingListMuteSelfConfirm", args: {}, act: () => write(true) };
      return;
    }
    void run(() => write(false));
  }

  /** The Access tab's words, by their labels (StartupAccessPanel, 370 to 425; searchOld.py SearchOwners; listwindow.py). */
  const ACCESS_WORDS = {
    tab: "UI/EVEMail/MailingLists/AccessTab",
    defaultAccess: "UI/EVEMail/MailingLists/DefaultAccessLabel",
    private: "UI/EVEMail/MailingLists/PrivateAccess",
    public: "UI/EVEMail/MailingLists/PublicAccess",
    apply: "UI/Common/Buttons/Apply",
    defaultRole: "UI/EVEMail/MailingLists/DefaultMemberRole",
    normal: "UI/EVEMail/MailingLists/Normal",
    mutedRole: "UI/EVEMail/MailingLists/MutedRole",
    entity: "UI/EVEMail/MailingLists/EntitySearchLabel",
    allow: "UI/EVEMail/MailingLists/Allow",
    block: "UI/PeopleAndPlaces/BlockContact",
    blocked: "UI/EVEMail/MailingLists/BlockedLabel",
    allowed: "UI/EVEMail/MailingLists/AllowedLabel",
    remove: "UI/EVEMail/MailingLists/RemoveSelected",
    type: "UI/Common/Type",
    character: "UI/Common/Character",
    characters: "UI/Common/Characters",
    corporation: "UI/Common/Corporation",
    corporations: "UI/Common/Corporations",
    alliance: "UI/Common/Alliance",
    alliances: "UI/Common/Alliances",
    tooLong: "UI/Common/SearchStringTooLong",
    noneFound: "UI/Search/NoGroupFoundWith",
    select: "UI/Search/GenericSelection",
    found: "UI/Search/ManyGroupsFoundWith",
    ok: "UI/Common/Buttons/OK",
    cancel: "UI/Common/Buttons/Cancel",
    mustSelect: "UI/Control/ListWindow/MustSelectError",
  } as const;
  /**
   * SearchOwners' groups for the window (ALLOWED_GROUP_IDS: character 1, corporation 2, alliance 32), each with its
   * word and its plural, in the order the client's dict of them gives them (asked of its own Python: 32, 1, 2).
   */
  const OWNER_GROUPS: readonly (readonly [number, string, string, string, string])[] = [
    [32, ACCESS_WORDS.alliance, "Alliance", ACCESS_WORDS.alliances, "Alliances"],
    [1, ACCESS_WORDS.character, "Character", ACCESS_WORDS.characters, "Characters"],
    [2, ACCESS_WORDS.corporation, "Corporation", ACCESS_WORDS.corporations, "Corporations"],
  ];

  /** An entry of the Access tab's lists: an owner, and whether it is let in or kept out. */
  interface AccessRow {
    readonly ownerID: number;
    readonly access: number;
  }

  /** The window's tab shown (the client remembers its last; the page opens on Members). */
  let manageTab = $state<"members" | "access" | "welcome">("members");
  /** The Access tab's two choices, as the window built them and as changed since. */
  let accessChoice = $state<number>(MAILING_LIST_BLOCKED);
  let roleChoice = $state<number>(MAILING_LIST_MEMBER_DEFAULT);
  /** What is typed to search for, a search's owners offered to pick from and the one picked, the rows chosen, and what was said. */
  let entityText = $state("");
  let entityPick = $state<{ readonly access: number; readonly searchTerm: string; readonly owners: readonly OwnerMatch[] } | null>(null);
  let pickedOwner = $state<number | null>(null);
  let pickNote = $state("");
  let chosenAccess = $state<ReadonlySet<number>>(new Set());
  let accessNote = $state("");
  /** UpdateAccessScrollData (435 to 451): the settings' access in the order the client's dict gives it, blocked and allowed apart. */
  const accessRows = $derived(
    listSettings === null ? [] : pyIntDictOrder([...listSettings.access.keys()]).map((ownerID) => ({ ownerID, access: listSettings?.access.get(ownerID) ?? MAILING_LIST_BLOCKED })),
  );
  const blockedRows = $derived(accessRows.filter((row) => row.access === MAILING_LIST_BLOCKED));
  const allowedRows = $derived(accessRows.filter((row) => row.access === MAILING_LIST_ALLOWED));

  /**
   * A tab chosen (Load, 522 to 530): Members asks the members again; Access asks nothing; Welcome Mail asks the
   * welcome mail until one is had.
   */
  function chooseManageTab(tab: "members" | "access" | "welcome"): void {
    manageTab = tab;
    const listID = managingList;
    if (tab === "members") {
      void run(updateMembers);
    } else if (tab === "welcome" && !welcomeLoaded && listID !== null) {
      void run(() => updateWelcome(listID));
    }
  }

  /** The Welcome Mail tab's words, by their labels (StartupWelcomePanel, 462 to 474). */
  const WELCOME_WORDS = {
    tab: "UI/EVEMail/MailingLists/WelcomeMailTab",
    toAll: "UI/EVEMail/MailingLists/SendWelcomeMailToAllCheckbox",
    subject: "UI/EVEMail/MailingLists/WelcomeMailSubject",
    save: "UI/Common/Buttons/Save",
  } as const;

  /** Whether a welcome mail was had (the window's welcomeText), its subject and its mail as shown, the box, and what was said. */
  let welcomeLoaded = $state(false);
  let welcomeSubject = $state("");
  let welcomeBody = $state("");
  let welcomeToAllChecked = $state(false);
  let welcomeNote = $state("");

  /** UpdateWelcome (482 to 492): none, the fields emptied; one, its subject and its mail shown, and not asked again. */
  async function updateWelcome(listID: number): Promise<void> {
    const welcome = await flow.readMailingListWelcome(listID);
    if (managingList !== listID) {
      return;
    }
    if (welcome === null) {
      welcomeSubject = "";
      welcomeBody = "";
      return;
    }
    welcomeLoaded = true;
    welcomeSubject = welcome.title;
    welcomeBody = mailBodyLines(welcome.body).map((line) => line.map((run) => run.text).join("")).join("\n");
  }

  /** OnCheckboxChange (476 to 480): the box kept for the list. */
  function tickWelcomeToAll(checked: boolean): void {
    welcomeToAllChecked = checked;
    if (managingList !== null) {
      flow.keepWelcomeToAll(managingList, checked);
    }
  }

  /**
   * SaveWelcomeMail (494 to 507): a subject and a mail both empty clear the welcome mail; a mail with no subject is
   * refused (NoSubject); else it is saved, and sent to every member as it is when the box is ticked. Nothing is asked
   * after.
   */
  function saveWelcome(): void {
    const listID = managingList;
    if (listID === null) {
      return;
    }
    welcomeNote = "";
    const subject = welcomeSubject;
    const body = mailMarkupOfTyped(welcomeBody);
    if (subject.length < 1 && body.length < 1) {
      void run(async () => {
        await flow.clearMailingListWelcome(listID);
      });
      return;
    }
    if (subject.length < 1) {
      welcomeNote = filledWord("dialog:NoSubject/body", "You cannot send a mail without a subject.", {});
      return;
    }
    const toAll = welcomeToAllChecked;
    void run(async () => {
      await flow.saveMailingListWelcome(listID, subject, body, toAll);
    });
  }

  /** The settings asked again (UpdateAccessScrollData), its lists drawn afresh with nothing chosen. */
  async function rereadAccess(listID: number): Promise<void> {
    listSettings = await flow.readMailingListSettings(listID);
    chosenAccess = new Set();
  }

  /** An owner by name, as the access lists name it. */
  function ownerLabel(ownerID: number): string {
    return resolvedName($names.resolved, "owner", ownerID, "someone");
  }

  /** The search's groups, by their words or their plurals, joined as SearchOwners joins them. */
  function ownerGroupNames(plural: boolean): string {
    return OWNER_GROUPS.map(([, label, own, labels, owns]) => (plural ? word(labels, owns) : word(label, own))).join("/");
  }

  /** ApplySettings (453 to 457): SetDefaultAccess with the two choices and no cost; nothing asked again. */
  function applyAccessDefaults(): void {
    const listID = managingList;
    if (listID === null) {
      return;
    }
    void run(async () => {
      await flow.setMailingListDefaults(listID, accessChoice, roleChoice);
    });
  }

  /**
   * AddToAllowed and AddToBlocked (313 to 326) by SearchOwners (searchOld.py 216 to 279), with hideNPC and
   * notifyOneMatch: what is typed, its % and ? taken out; nothing refused (LookupStringMinimum), a hundred or more
   * refused (SearchStringTooLong); else LookupPCOwners, the characters, corporations and alliances kept, none said so
   * (NoGroupFoundWith), and those found offered to pick from even when one is (ListWindow, ordered: by what each is
   * shown as).
   */
  function searchEntity(access: number): void {
    const listID = managingList;
    if (listID === null) {
      return;
    }
    accessNote = "";
    const text = entityText.replace(/%/g, "").replace(/\?/g, "");
    if (text.length < 1) {
      accessNote = filledWord("dialog:LookupStringMinimum/body", "Please type in at least {minimum} character", { minimum: "1" });
      return;
    }
    if (text.length >= 100) {
      accessNote = word(ACCESS_WORDS.tooLong, "Search String Too Long");
      return;
    }
    void run(async () => {
      const kept = new Set(OWNER_GROUPS.map(([groupID]) => groupID));
      const owners = (await flow.lookupPlayerOwners(text)).filter((owner) => kept.has(owner.groupID));
      if (owners.length === 0) {
        accessNote = filledWord(ACCESS_WORDS.noneFound, "No {groupName} can be found with \"{searchTerm}\" in the beginning of its name.", { groupName: ownerGroupNames(false), searchTerm: text });
        return;
      }
      const sorted = [...owners].sort((left, right) => {
        const x = pickLabel(left).toLowerCase();
        const y = pickLabel(right).toLowerCase();
        return x < y ? -1 : x === y ? 0 : 1;
      });
      entityPick = { access, searchTerm: text, owners: sorted };
      pickedOwner = null;
      pickNote = "";
    });
  }

  /** How the pick list shows an owner: its name and its group's word (searchOld.py 264). */
  function pickLabel(owner: OwnerMatch): string {
    const group = OWNER_GROUPS.find(([groupID]) => groupID === owner.groupID);
    return group === undefined ? owner.ownerName : `${owner.ownerName} ${word(group[1], group[2])}`;
  }

  /** The pick list's OK (listwindow.py Confirm): one must be picked (MustSelectError); then its access set, and the settings asked again. */
  function pickConfirmed(): void {
    const listID = managingList;
    const pick = entityPick;
    if (listID === null || pick === null) {
      return;
    }
    const ownerID = pickedOwner;
    if (ownerID === null) {
      pickNote = filledWord(ACCESS_WORDS.mustSelect, "Must select {num}.", { num: "1" });
      return;
    }
    entityPick = null;
    void run(async () => {
      if (await flow.setMailingListAccess(listID, ownerID, pick.access)) {
        await rereadAccess(listID);
      }
    });
  }

  function chooseAccess(ownerID: number, chosen: boolean): void {
    const next = new Set(chosenAccess);
    if (chosen) {
      next.add(ownerID);
    } else {
      next.delete(ownerID);
    }
    chosenAccess = next;
  }

  /**
   * ClearAccessForSelected (302 to 311): the blocked chosen and then the allowed, each cleared in turn, then the
   * settings asked again; none chosen refused (PICKERRORNOTIFY).
   */
  function removeChosenAccess(): void {
    const listID = managingList;
    if (listID === null) {
      return;
    }
    accessNote = "";
    const chosen = [...blockedRows, ...allowedRows].filter((row) => chosenAccess.has(row.ownerID)).map((row) => row.ownerID);
    if (chosen.length === 0) {
      accessNote = filledWord("dialog:PICKERRORNOTIFY/body", "Must select at least {num} ", { num: "1" }).trim();
      return;
    }
    void run(async () => {
      for (const ownerID of chosen) {
        if (!(await flow.clearMailingListAccess(listID, ownerID))) {
          return;
        }
      }
      await rereadAccess(listID);
    });
  }

  /** The mail list's words, by their labels (LoadMails 640 to 645; RefreshMsgScrollHeaders; MailEntry; GetAllLabels). */
  const LIST_WORDS = {
    status: "UI/Mail/Status",
    sender: "UI/Mail/Sender",
    recipient: "UI/Mail/Recipient",
    subject: "UI/Mail/Subject",
    received: "UI/Mail/Received",
    dateSent: "UI/Mail/DateSent",
    labels: "UI/Mail/Labels",
    unread: "UI/Mail/Unread",
    read: "UI/Mail/Read",
    replied: "UI/Mail/Replied",
    forwarded: "UI/Mail/Forwarded",
    multiple: "UI/Mail/Multiple",
    noMails: "UI/Mail/NoMailsFound",
    previous: "UI/Common/Previous",
    next: "UI/Common/Next",
    labelAlliance: "UI/Mail/LabelAlliance",
    labelCorp: "UI/Mail/LabelCorp",
    labelInbox: "UI/Mail/LabelInbox",
    labelSent: "UI/Mail/LabelSent",
  } as const;
  /** The window's four labels by their words, as the Labels column names them (GetAllLabels, mailSvc.py 681 to 710). */
  const fourLabelNames = $derived(
    new Map<number, string>([
      [MAIL_FOLDER_ALLIANCE, word(LIST_WORDS.labelAlliance, "[Alliance]")],
      [MAIL_FOLDER_CORPORATION, word(LIST_WORDS.labelCorp, "[Corp]")],
      [MAIL_FOLDER_INBOX, word(LIST_WORDS.labelInbox, "Inbox")],
      [MAIL_FOLDER_SENT, word(LIST_WORDS.labelSent, "Sent")],
    ]),
  );

  /** A mail's Status as the window writes it (MailEntry.LoadMailEntry: its icon's hint). */
  function stateWord(messageID: number): string {
    const state = mailRowState(statusByID.get(messageID));
    return state === "unread" ? word(LIST_WORDS.unread, "Unread") : state === "replied" ? word(LIST_WORDS.replied, "Replied") : state === "forwarded" ? word(LIST_WORDS.forwarded, "Forwarded") : word(LIST_WORDS.read, "Read");
  }

  /** A mail's name column (GetMsgEntry, 678 to 681): its sender, or in the Sent folder its recipient (GetRecipient). */
  function nameCell(header: MailHeaderRow): string {
    if (!inSent) {
      return senderName(header);
    }
    const recipient = mailRecipientOf(header);
    switch (recipient.kind) {
      case "multiple":
        return word(LIST_WORDS.multiple, "[Multiple]");
      case "character":
        return personName(recipient.id);
      case "corporation":
        return ownerName(recipient.id);
      case "list":
        return listName(recipient.listID) ?? "a mailing list";
      default:
        return "";
    }
  }

  /** A mail's Labels column (GetLabelText). */
  function labelsText(header: MailHeaderRow): string {
    return mailLabelText(statusByID.get(header.messageID)?.labelMask ?? 0, $mail.labels ?? [], fourLabelNames);
  }

  /** FmtDate(sentDate, 'ls'), as the list writes a mail's date (GetMsgEntry, 677). */
  function dateText(sentDate: bigint | null): string {
    if (sentDate === null) {
      return "";
    }
    const nameOf = (kind: Parameters<typeof resolvedName>[1], id: number) => resolvedName($names.resolved, kind, id, "");
    return plainText(formatTemplate(word(DATE_LABEL, "{[datetime]datetime}"), { datetime: String(sentDate) }, { nameOf }));
  }

  /** A folder shown, from its first page (the window's startPos 0). */
  function showFolder(id: number | null): void {
    folder = id;
    viewingList = null;
    mailPage = 0;
    nameSentLists();
  }

  /** A mailing list's mails shown, from their first page (LoadMailinglistMails, evemail.py 529 to 534). */
  function showList(listID: number): void {
    viewingList = listID;
    mailPage = 0;
  }

  /** BrowseMail: the page before or after. */
  function turnMailPage(change: number): void {
    mailPage = pageShown + change;
    nameSentLists();
  }

  /** The Sent folder's page drawn (GetMsgEntry, 678 to 679): a list that is a mail's one recipient named, asked where not known (GetDisplayName). */
  function nameSentLists(): void {
    if (!inSent) {
      return;
    }
    const unnamed = [...new Set(pageMessages.flatMap((header) => {
      const recipient = mailRecipientOf(header);
      return recipient.kind === "list" && listName(recipient.listID) === null ? [recipient.listID] : [];
    }))];
    if (unnamed.length > 0) {
      void run(async () => {
        for (const listID of unnamed) {
          await flow.nameMailingList(listID);
        }
      });
    }
  }

  onMount(() => {
    flow.requestWords([
      ...Object.values(MAIL_QUOTE_LABELS), DATE_LABEL, ...Object.values(FOLDER_WORDS), ...Object.values(WRITE_WORDS), ...Object.values(FOLDER_WRITE_WORDS),
      ...FOLDER_DIALOGS.flatMap((dialog) => [`dialog:${dialog}/title`, `dialog:${dialog}/body`]),
      ...Object.values(LABEL_WORDS),
      ...LABEL_DIALOGS.flatMap((dialog) => [`dialog:${dialog}/title`, `dialog:${dialog}/body`]),
      ...Object.values(MANAGE_WORDS),
      ...MANAGE_DIALOGS.flatMap((dialog) => [`dialog:${dialog}/title`, `dialog:${dialog}/body`]),
      ...Object.values(ACCESS_WORDS),
      "dialog:PICKERRORNOTIFY/title",
      "dialog:PICKERRORNOTIFY/body",
      ...Object.values(WELCOME_WORDS),
      ...Object.values(LIST_WORDS),
      "dialog:NoSubject/title",
      "dialog:NoSubject/body",
      "dialog:MailingListNoSuchList/title",
      "dialog:MailingListNoSuchList/body",
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
        Your message was sent to {sentTo($mail.lastOutcome.recipientCount, $mail.lastOutcome.toList ?? null)}.
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
    {#if managingList !== null}
      <!-- The list's management window (evemailingListConfig.py MaillistSetupWindow): its Members, Access and Welcome
           Mail tabs. -->
      <section class="bulk mail-list-management">
        <h3>{filledWord(MANAGE_WORDS.caption, "Mailing list management: {mailinglistName}", { mailinglistName: managedList?.displayName ?? "" })}</h3>
        <p class="controls">
          <button type="button" class:active={manageTab === "members"} disabled={busy} onclick={() => chooseManageTab("members")}>{word(MANAGE_WORDS.membersTab, "Members")}</button>
          <button type="button" class:active={manageTab === "access"} disabled={busy} onclick={() => chooseManageTab("access")}>{word(ACCESS_WORDS.tab, "Access")}</button>
          <button type="button" class:active={manageTab === "welcome"} disabled={busy} onclick={() => chooseManageTab("welcome")}>{word(WELCOME_WORDS.tab, "Welcome Mail")}</button>
          <button type="button" class="minor" onclick={() => (managingList = null)}>✕</button>
        </p>
        {#if manageTab === "members"}
        <p class="controls">
          <label>
            {word(MANAGE_WORDS.show, "Show")}
            <select value={memberFilter} disabled={busy} onchange={(event) => chooseMemberFilter(event.currentTarget.value as MailingListMemberFilter)}>
              {#each MEMBER_FILTERS as [filter, label, own] (filter)}
                <option value={filter}>{word(label, own)}</option>
              {/each}
            </select>
          </label>
          {#if memberFilter === "byName"}
            <label>
              {word(MANAGE_WORDS.searchString, "Search String")}
              <input type="search" bind:value={memberSearch} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void run(updateMembers); } }} />
            </label>
            <button type="button" disabled={busy} onclick={() => void run(updateMembers)}>{word(MANAGE_WORDS.search, "Search")}</button>
          {/if}
          <button type="button" class="minor" disabled={busy || memberPages <= 1 || memberPage === 0} onclick={() => turnMemberPage(-1)}>{word(MANAGE_WORDS.previous, "Previous")}</button>
          <span>{memberPage + 1} / {memberPages}</span>
          <button type="button" class="minor" disabled={busy || memberPages <= 1 || memberPage >= memberPages - 1} onclick={() => turnMemberPage(1)}>{word(MANAGE_WORDS.next, "Next")}</button>
        </p>
        {#if pageOfMembers.length === 0}
          <p class="empty">{word(MANAGE_WORDS.none, "No members found matching criteria")}</p>
        {:else}
          <div class="table-wrap overflow-x-auto">
            <table class="guests reflow">
              <thead>
                <tr>
                  <th></th>
                  <th>{word(MANAGE_WORDS.name, "Name")}</th>
                  <th>{word(MANAGE_WORDS.role, "Role")}</th>
                </tr>
              </thead>
              <tbody>
                {#each pageOfMembers as member (member.characterID)}
                  {@const role = ROLE_WORDS[member.access]}
                  <tr>
                    <td data-label=""><input type="checkbox" aria-label={personName(member.characterID)} checked={chosenMembers.has(member.characterID)} disabled={busy} onchange={(event) => chooseMember(member.characterID, event.currentTarget.checked)} /></td>
                    <td data-label={word(MANAGE_WORDS.name, "Name")}>{personName(member.characterID)}</td>
                    <td data-label={word(MANAGE_WORDS.role, "Role")}>{role === undefined ? "" : word(role[0], role[1])}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        <p class="controls">
          <label>
            {word(MANAGE_WORDS.applyTo, "Apply to selected")}
            <select bind:value={memberAction} disabled={busy}>
              {#each MEMBER_ACTIONS as [action, label, own] (action)}
                <option value={action}>{word(label, own)}</option>
              {/each}
            </select>
          </label>
          <button type="button" disabled={busy || chosenMembers.size === 0} onclick={applyToMembers}>{word(MANAGE_WORDS.apply, "Apply")}</button>
        </p>
        {:else if manageTab === "access"}
          <!-- The Access tab (StartupAccessPanel, 370 to 425): who may join and as what, with Apply; a character,
               corporation or alliance blocked or allowed by a search; the blocked and the allowed; Remove Selected. -->
          <p class="controls">
            <label>
              {word(ACCESS_WORDS.defaultAccess, "Mailing List Subscription Access")}
              <select bind:value={accessChoice} disabled={busy}>
                <option value={MAILING_LIST_BLOCKED}>{word(ACCESS_WORDS.private, "Only open to allowed (Private)")}</option>
                <option value={MAILING_LIST_ALLOWED}>{word(ACCESS_WORDS.public, "Open to everyone (Public)")}</option>
              </select>
            </label>
            <label>
              {word(ACCESS_WORDS.defaultRole, "Default member role")}
              <select bind:value={roleChoice} disabled={busy}>
                <option value={MAILING_LIST_MEMBER_DEFAULT}>{word(ACCESS_WORDS.normal, "Normal")}</option>
                <option value={MAILING_LIST_MEMBER_MUTED}>{word(ACCESS_WORDS.mutedRole, "Muted")}</option>
              </select>
            </label>
            <button type="button" disabled={busy} onclick={applyAccessDefaults}>{word(ACCESS_WORDS.apply, "Apply")}</button>
          </p>
          <p class="controls">
            <label>
              {word(ACCESS_WORDS.entity, "Character/Corp/Alliance")}
              <input type="text" bind:value={entityText} />
            </label>
            <button type="button" disabled={busy} onclick={() => searchEntity(MAILING_LIST_BLOCKED)}>{word(ACCESS_WORDS.block, "Block")}</button>
            <button type="button" disabled={busy} onclick={() => searchEntity(MAILING_LIST_ALLOWED)}>{word(ACCESS_WORDS.allow, "Allow")}</button>
          </p>
          {#if accessNote !== ""}
            <p class="note">{accessNote}</p>
          {/if}
          {#if entityPick !== null}
            <!-- The client's pick list (ListWindow.ShowList): its caption, its hint, the owners found, OK and Cancel. -->
            <div class="mail-confirm" role="dialog" aria-label={filledWord(ACCESS_WORDS.select, "Select {groupName}", { groupName: ownerGroupNames(false) })}>
              <strong>{filledWord(ACCESS_WORDS.select, "Select {groupName}", { groupName: ownerGroupNames(false) })}</strong>
              <p>{filledWord(ACCESS_WORDS.found, "{itemCount} {groupNames} were found with \"{searchTerm}\" in their name.", { itemCount: String(entityPick.owners.length), groupNames: ownerGroupNames(true), searchTerm: entityPick.searchTerm })}</p>
              <ul class="mail-label-list">
                {#each entityPick.owners as owner (owner.ownerID)}
                  <li>
                    <label>
                      <input type="radio" name="mail-owner-pick" checked={pickedOwner === owner.ownerID} onchange={() => (pickedOwner = owner.ownerID)} />
                      {pickLabel(owner)}
                    </label>
                  </li>
                {/each}
              </ul>
              {#if pickNote !== ""}
                <p class="error">{pickNote}</p>
              {/if}
              <p class="controls">
                <button type="button" disabled={busy} onclick={pickConfirmed}>{word(ACCESS_WORDS.ok, "OK")}</button>
                <button type="button" class="minor" onclick={() => (entityPick = null)}>{word(ACCESS_WORDS.cancel, "Cancel")}</button>
              </p>
            </div>
          {/if}
          {#snippet accessList(title: string, rows: readonly AccessRow[])}
            <h4>{title}</h4>
            <div class="table-wrap overflow-x-auto">
              <table class="guests reflow">
                <thead>
                  <tr>
                    <th></th>
                    <th>{word(MANAGE_WORDS.name, "Name")}</th>
                    <th>{word(ACCESS_WORDS.type, "Type")}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each rows as row (row.ownerID)}
                    <tr>
                      <td data-label=""><input type="checkbox" aria-label={ownerLabel(row.ownerID)} checked={chosenAccess.has(row.ownerID)} disabled={busy} onchange={(event) => chooseAccess(row.ownerID, event.currentTarget.checked)} /></td>
                      <td data-label={word(MANAGE_WORDS.name, "Name")}>{ownerLabel(row.ownerID)}</td>
                      <td data-label={word(ACCESS_WORDS.type, "Type")}>{resolvedName($names.resolved, "ownerGroup", row.ownerID, "")}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/snippet}
          {@render accessList(word(ACCESS_WORDS.blocked, "Blocked"), blockedRows)}
          {@render accessList(word(ACCESS_WORDS.allowed, "Allowed"), allowedRows)}
          <p class="controls">
            <button type="button" disabled={busy} onclick={removeChosenAccess}>{word(ACCESS_WORDS.remove, "Remove Selected")}</button>
          </p>
        {:else}
          <!-- The Welcome Mail tab (StartupWelcomePanel, 462 to 474): a subject, the mail, whether to send it to every
               member when it is saved, and Save. -->
          <p class="controls">
            <input type="text" class="grow" aria-label={word(WELCOME_WORDS.subject, "Subject")} placeholder={word(WELCOME_WORDS.subject, "Subject")} maxlength={MAIL_MAX_TITLE} bind:value={welcomeSubject} />
          </p>
          <p class="controls">
            <textarea class="grow" rows="8" maxlength={MAIL_MAX_TAGGED_BODY} bind:value={welcomeBody}></textarea>
          </p>
          <p class="controls">
            <label>
              <input type="checkbox" checked={welcomeToAllChecked} onchange={(event) => tickWelcomeToAll(event.currentTarget.checked)} />
              {word(WELCOME_WORDS.toAll, "Send welcome mail to all members when it is saved.")}
            </label>
          </p>
          {#if welcomeNote !== ""}
            <p class="note">{welcomeNote}</p>
          {/if}
          <p class="controls">
            <button type="button" disabled={busy} onclick={saveWelcome}>{word(WELCOME_WORDS.save, "Save")}</button>
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
          <button type="button" class:active={viewingList === null && folder === id} class:mail-bold={folderUnread(id) > 0} onclick={() => showFolder(id)}>
            {folderText(word(label, own), id)}
          </button>
        {/each}
        {#if ownLabels.length > 0}
          <span class="mail-folders-group">{word(FOLDER_WORDS.labels, "Labels")}</span>
          {#each ownLabels as label (label.labelID)}
            <button type="button" class:active={viewingList === null && folder === label.labelID} class:mail-bold={folderUnread(label.labelID) > 0} onclick={() => showFolder(label.labelID)}>
              {folderText(label.name, label.labelID)}
            </button>
          {/each}
        {/if}
        {#if joinedLists.length > 0}
          <span class="mail-folders-group">{word(FOLDER_WORDS.lists, "Mailing Lists")}</span>
          {#each joinedLists as list (list.listID)}
            {@const unread = listUnread.get(list.listID) ?? 0}
            <button type="button" class:active={viewingList === list.listID} class:mail-bold={unread > 0} onclick={() => showList(list.listID)}>
              {unread > 0 ? filledWord(FOLDER_WORDS.withCount, "{folderName} ({unreadCount})", { folderName: list.displayName, unreadCount: String(unread) }) : list.displayName}
            </button>
          {/each}
        {/if}
      </nav>
      <!-- The folder's own writes (evemail.py StaticMenu), each asked to be sure of in the client's words. -->
      <p class="controls mail-folder-actions">
        {#if viewingList !== null}
          <!-- A list's own menu (evemail.py MaillistMenu 536 to 555), in its order: writing to it where the pilot is
               not muted; its mails read and trashed, each asked to be sure of; and Leave, or for its owner Delete,
               asked to be sure of. For an operator or owner, its management window (OpenMaillistSetup, 511). -->
          {@const shownList = ($mail.lists ?? []).find((each) => each.listID === viewingList)}
          {#if shownList !== undefined}
            <!-- (A {@const} is read again each time it is used: the list's number is taken at the click, before the
                 list shown is let go, or a write is sent without it, as Leave(None) was, seen 2026-10-14.) -->
            {@const listID = shownList.listID}
            {@const listName = shownList.displayName}
            {#if !shownList.isMuted}
              <button type="button" class="minor" disabled={busy} onclick={() => sendToList(listID)}>
                {word(FOLDER_WORDS.sendToList, "Send Mail to Mailing List")}
              </button>
            {/if}
            {#if shownList.isOperator || shownList.isOwner}
              <button type="button" class="minor" disabled={busy} onclick={() => openListManagement(listID)}>
                {word(MANAGE_WORDS.open, "Open Mailing List Management")}
              </button>
            {/if}
            <button type="button" class="minor" disabled={busy} onclick={() => { const id = listID; confirming = { dialog: "EvemailMailReadMailinglistGroup", args: { listName }, act: () => flow.readListMail(id) }; }}>
              {filledWord(FOLDER_WRITE_WORDS.markAll, "Mark All as Read ({folderName})", { folderName: listName })}
            </button>
            <button type="button" class="minor" disabled={busy} onclick={() => { const id = listID; confirming = { dialog: "EvemailMailTrashMailinglistGroup", args: { listName }, act: () => flow.trashListMail(id) }; }}>
              {filledWord(FOLDER_WRITE_WORDS.trashAll, "Trash All ({folderName})", { folderName: listName })}
            </button>
            {#if shownList.isOwner}
              <button type="button" class="minor" disabled={busy} onclick={() => { const id = listID; confirming = { dialog: "DeleteMailingList", args: { mailinglistName: listName }, act: async () => { await flow.deleteMailingList(id); if (!(store.get().mail.lists ?? []).some((each) => each.listID === id)) viewingList = null; } }; }}>
                {word(FOLDER_WORDS.deleteList, "Delete Mailing List")}
              </button>
            {:else}
              <button type="button" class="minor" disabled={busy} onclick={() => { const id = listID; viewingList = null; void run(() => flow.leaveMailingList(id)); }}>
                {word(FOLDER_WORDS.leaveList, "Leave Mailing List")}
              </button>
            {/if}
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
      {#if shownMessages.length === 0}
        <p class="empty">{word(LIST_WORDS.noMails, "No Mails Found")}</p>
      {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <!-- The window's columns (LoadMails, 640 to 645): Status, Sender (Recipient in the Sent folder), Subject,
               Received (Date Sent in the Sent folder), Labels; an unread mail in bold (MailEntry.UpdateLabel). -->
          <thead>
            <tr>
              <th>{word(LIST_WORDS.status, "Status")}</th>
              <th>{inSent ? word(LIST_WORDS.recipient, "Recipient") : word(LIST_WORDS.sender, "Sender")}</th>
              <th>{word(LIST_WORDS.subject, "Subject")}</th>
              <th>{inSent ? word(LIST_WORDS.dateSent, "Date Sent") : word(LIST_WORDS.received, "Received")}</th>
              <th>{word(LIST_WORDS.labels, "Labels")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each pageMessages as header (header.messageID)}
              <tr class:unread={isUnread(header.messageID)} class:mail-bold={isUnread(header.messageID)}>
                <td data-label={word(LIST_WORDS.status, "Status")}>{stateWord(header.messageID)}</td>
                <td data-label={inSent ? word(LIST_WORDS.recipient, "Recipient") : word(LIST_WORDS.sender, "Sender")}>{nameCell(header)}</td>
                <td data-label={word(LIST_WORDS.subject, "Subject")}>{header.title}</td>
                <td data-label={inSent ? word(LIST_WORDS.dateSent, "Date Sent") : word(LIST_WORDS.received, "Received")}>{dateText(header.sentDate)}</td>
                <td data-label={word(LIST_WORDS.labels, "Labels")}>{labelsText(header)}</td>
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
      <!-- ShowHideBrowse (716 to 736): Previous where there is a page before, Next where there is one after, and the
           page of the pages where either is. -->
      {#if pageShown > 0 || (pageShown + 1) * MAILS_PER_PAGE < sortedMessages.length}
        <p class="controls">
          {#if pageShown > 0}
            <button type="button" class="minor" disabled={busy} onclick={() => turnMailPage(-1)}>{word(LIST_WORDS.previous, "Previous")}</button>
          {/if}
          {#if (pageShown + 1) * MAILS_PER_PAGE < sortedMessages.length}
            <button type="button" class="minor" disabled={busy} onclick={() => turnMailPage(1)}>{word(LIST_WORDS.next, "Next")}</button>
          {/if}
          <span>{pageShown + 1}/{mailPages}</span>
        </p>
      {/if}
      {/if}
    {/if}

    {#if $mail.open !== null}
      <section class="bulk">
        <h2>{openHeader ? openHeader.title || "(no subject)" : "Message"}</h2>
        {#if openHeader}
          <p class="note">
            From {senderName(openHeader)}, to {audienceText(openHeader)},
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

      {#if recipients.length > 0 || composeList !== undefined}
        <p class="note">
          Sending to:
          {#if composeList !== undefined}
            <!-- The list as the compose window writes it among its recipients (AddList, 1951 to 1959). -->
            <button type="button" class="minor" disabled={busy} onclick={() => (toList = null)}>
              {filledWord(FOLDER_WORDS.mailEntry, "{entryName} {entryType}", { entryName: composeList.displayName, entryType: word(FOLDER_WORDS.ml, "[ML]") })} ✕
            </button>
          {/if}
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

      {#if !draftCheck.ok && (recipients.length > 0 || composeList !== undefined || draftTitle !== "" || draftBody !== "")}
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
            toList = null;
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
