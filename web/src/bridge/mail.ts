// R17 Slice A — decoding the retail MAIL surface (mailMgr).
//
// ⚠ THE INBOX IS A DELTA SYNC, NOT A LIST. SyncMail(firstID, lastID) answers
// only what falls OUTSIDE the window the caller already holds, split across
// three arms: {newMail, oldMail, mailStatus}. The page keeps the mailbox as the
// client's mail service keeps it (the kept mailbox, at the end of this file):
// a page newly loaded holds none, and its first sync is [null, 0].
//
// ⚠ `toCharacterIDs` IS A COMMA-JOINED STRING, NOT A LIST. buildMailHeaderRow
// joins the recipient ids with "," (or null for none), while SendMail wants a
// real list on the way in. The two directions are NOT symmetric. A decoder that
// assumes an array reads a two-recipient message as one character whose id is
// the string "140000003,140000004" — and then asks the name service for a name
// it will never have. `splitRecipientIDs` is the only place that string is
// interpreted.
//
// ⚠ THERE IS NO BODY DECODING HERE, DELIBERATELY. mailMgr.GetBody answers a
// zlib-DEFLATED buffer, and the BFF inflates it (src/server.js, mailBodyText)
// so the browser receives plain text. Shipping an inflate implementation to
// every page load to undo something the server did for a wire format the
// browser never speaks would be work for no one's benefit.
//
// ⚠ sentDate IS A FILETIME (100 ns ticks since 1601-01-01), not a Unix
// timestamp, and it exceeds 2^53 — so it is kept as a bigint the whole way and
// converted only at the moment it is rendered.

import type { MailHeaderRow, MailStatusRow } from "../store/types.ts";
import type { JsonValue } from "./wire.ts";
import { isListValue, readDictPairs, readKeyVal, readPlainJsonField, unwrapLong } from "./wire.ts";

/** The read bit inside a status row's statusMask. */
export const MAIL_STATUS_READ = 1;

function listItems(value: JsonValue | undefined): readonly JsonValue[] {
  return isListValue(value) ? (value.items as readonly JsonValue[]) : [];
}

function toNumber(value: JsonValue | undefined): number {
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toText(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A FILETIME instant, kept as a bigint (it exceeds 2^53); null when absent. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long = unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * ⚠ THE COMMA-JOINED STRING, interpreted in exactly one place.
 *
 * A header's `toCharacterIDs` is "140000003,140000004" — or null when the
 * message went to a mailing list, a corporation, or (a shape the server does
 * not refuse) nobody at all. Anything that is not a positive integer is
 * dropped rather than passed on to the name service as a bad ref.
 */
export function splitRecipientIDs(value: JsonValue | undefined): readonly number[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  const out: number[] = [];
  for (const part of value.split(",")) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0 && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

function decodeHeaderRow(row: JsonValue): MailHeaderRow | null {
  const messageID = toNumber(readKeyVal(row, "messageID"));
  if (messageID <= 0) {
    return null;
  }
  const toListID = toNumber(readKeyVal(row, "toListID"));
  const toCorpOrAllianceID = toNumber(readKeyVal(row, "toCorpOrAllianceID"));
  return {
    messageID,
    senderID: toNumber(readKeyVal(row, "senderID")),
    toCharacterIDs: splitRecipientIDs(readKeyVal(row, "toCharacterIDs")),
    // Kept and LABELLED rather than hidden: a player whose inbox holds a
    // mailing-list or corporation message must still see it, even though this
    // slice cannot browse either of those surfaces.
    toListID: toListID > 0 ? toListID : null,
    toCorpOrAllianceID: toCorpOrAllianceID > 0 ? toCorpOrAllianceID : null,
    title: toText(readKeyVal(row, "title")),
    sentDate: toFiletime(readKeyVal(row, "sentDate")),
  };
}

function decodeStatusRow(row: JsonValue): MailStatusRow | null {
  const messageID = toNumber(readKeyVal(row, "messageID"));
  if (messageID <= 0) {
    return null;
  }
  const statusMask = toNumber(readKeyVal(row, "statusMask"));
  return {
    messageID,
    statusMask,
    labelMask: toNumber(readKeyVal(row, "labelMask")),
    read: (statusMask & MAIL_STATUS_READ) !== 0,
  };
}

export interface DecodedMailbox {
  /** Every header the sync carried, newest first. */
  readonly messages: readonly MailHeaderRow[];
  readonly statuses: readonly MailStatusRow[];
}

/**
 * Merge a cold SyncMail answer (plus any GetMailHeaders backfill) into one
 * mailbox.
 *
 * The two header arms are merged because for a COLD client the split carries no
 * information: `newMail` and `oldMail` describe which side of the caller's
 * window a message fell on, and a caller holding nothing has no window. A
 * message appearing in both arms, or in both the sync and the backfill, is kept
 * once.
 */
export function decodeMailbox(sync: JsonValue, backfill: JsonValue = null): DecodedMailbox {
  const byID = new Map<number, MailHeaderRow>();
  for (const arm of ["newMail", "oldMail"] as const) {
    for (const row of listItems(readKeyVal(sync, arm))) {
      const header = decodeHeaderRow(row);
      if (header && !byID.has(header.messageID)) {
        byID.set(header.messageID, header);
      }
    }
  }
  for (const row of listItems(backfill)) {
    const header = decodeHeaderRow(row);
    if (header && !byID.has(header.messageID)) {
      byID.set(header.messageID, header);
    }
  }

  const statuses: MailStatusRow[] = [];
  for (const row of listItems(readKeyVal(sync, "mailStatus"))) {
    const status = decodeStatusRow(row);
    if (status) {
      statuses.push(status);
    }
  }

  // Newest first. messageIDs are allocated in order, so they sort the mailbox
  // even for a message whose sentDate is missing.
  const messages = [...byID.values()].sort((left, right) => {
    if (left.sentDate !== null && right.sentDate !== null && left.sentDate !== right.sentDate) {
      return right.sentDate > left.sentDate ? 1 : -1;
    }
    return right.messageID - left.messageID;
  });

  return { messages, statuses };
}

/** Read bits by messageID, so a list row can show whether it has been opened. */
export function readFlags(statuses: readonly MailStatusRow[]): ReadonlyMap<number, boolean> {
  const out = new Map<number, boolean>();
  for (const status of statuses) {
    out.set(status.messageID, status.read);
  }
  return out;
}

/**
 * How many messages are unread. The BFF computes this too and the two must
 * agree; this exists so the count beside the tab is derived from the same rows
 * the list renders rather than from a number that could drift out of step with
 * them.
 */
export function unreadCount(statuses: readonly MailStatusRow[]): number {
  return statuses.reduce((total, status) => (status.read ? total : total + 1), 0);
}

/**
 * Who a message was addressed to, as a kind the panel can put a NAME against.
 * A message to a mailing list or a corporation is labelled as such rather than
 * dropped — this slice cannot browse either surface, but a player must still be
 * able to see that the message exists and where it came from.
 */
export type MailAudience =
  | { readonly kind: "characters"; readonly characterIDs: readonly number[] }
  | { readonly kind: "list" }
  | { readonly kind: "corporation"; readonly ownerID: number }
  | { readonly kind: "nobody" };

export function audienceOf(header: MailHeaderRow): MailAudience {
  if (header.toCharacterIDs.length > 0) {
    return { kind: "characters", characterIDs: header.toCharacterIDs };
  }
  if (header.toListID !== null) {
    return { kind: "list" };
  }
  if (header.toCorpOrAllianceID !== null) {
    return { kind: "corporation", ownerID: header.toCorpOrAllianceID };
  }
  // ⚠ A REAL SHAPE, not a defensive branch. The server does not refuse mail
  // addressed to nobody (its NO_RECIPIENTS guard cannot fire when a sender copy
  // is kept, which mailMgr always does), so a mailbox really can hold one.
  return { kind: "nobody" };
}

// --- Composing --------------------------------------------------------------

/**
 * The client's own ceilings (appConst.py 1782, 1784 and 1785: mailMaxRecipients, mailMaxSubjectSize,
 * mailMaxBodySize), so a too-long message is caught before it is sent, as the compose window catches it (evemail.py:
 * the fields' own lengths, 1794 and 1838; the 51st recipient refused, 1909 to 1910). Until 2026-10-14 they were the
 * BFF route's (20, 200 and 8000).
 */
export const MAIL_MAX_RECIPIENTS = 50;
export const MAIL_MAX_TITLE = 150;
export const MAIL_MAX_BODY = 8000;

export interface DraftCheck {
  readonly ok: boolean;
  /** Plain-language reason, when the check failed. */
  readonly message: string | null;
}

/**
 * Is this draft sendable? Checked here so the player is told what is wrong
 * before anything is sent — and, for the empty-recipient case, because the
 * SERVER WILL NOT CATCH IT: mailState's NO_RECIPIENTS guard cannot fire through
 * the gateway, so mail addressed to nobody is written into the sender's own
 * mailbox and looks sent. The BFF refuses it too; this is the message the
 * player actually reads.
 */
export function checkDraft(draft: {
  readonly recipientIDs: readonly number[];
  /** Whether a mailing list the pilot has joined is among the recipients (the compose window's toListID, ClickSend 2250 to 2253). */
  readonly listed?: boolean;
  readonly title: string;
  readonly body: string;
}): DraftCheck {
  if (draft.recipientIDs.length === 0 && draft.listed !== true) {
    return { ok: false, message: "Choose someone to send this to first." };
  }
  if (draft.recipientIDs.length > MAIL_MAX_RECIPIENTS) {
    return {
      ok: false,
      message: `You can send to at most ${MAIL_MAX_RECIPIENTS} people at once.`,
    };
  }
  if (draft.title.trim() === "") {
    return { ok: false, message: "Give your message a subject first." };
  }
  if (draft.title.length > MAIL_MAX_TITLE) {
    return { ok: false, message: "That subject is too long." };
  }
  if (draft.body.length > MAIL_MAX_BODY) {
    return { ok: false, message: "That message is too long to send." };
  }
  return { ok: true, message: null };
}

// --- R86 write acks ---------------------------------------------------------
//
// The Phase-3 mail + mailing-list WRITES. FAST-MODE educated-guess decoders:
// the BFF has already turned each server return into a small JSON ack, so these
// only read the shape the BFF emits — a `applied` flag plus, for the two
// creation writes, the new id. Every mailMgr status/trash/label write answers
// `null` server-side (the panel re-reads the mailbox to prove the mutation), so
// its ack carries only `applied`. CreateLabel / mailingListsMgr.Create answer a
// new id; mailingListsMgr.Join answers the joined list's info KeyVal.
//
// ⚠ These are EDUCATED GUESSES captured from the client + server code, not from
// real bytes — the reads-era live-capture grind is deliberately skipped for
// writes (QA/real-implementation comes later).

/** The uniform ack every confirm-gated mail write returns. */
export interface MailWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Decode the plain status/trash ack (MarkAsRead, MoveToTrash, DeleteMail, …). */
export function decodeMailWriteAck(response: JsonValue): MailWriteAck {
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
  };
}

/** A label-creation ack: `applied` plus the new labelID (null when declined). */
export interface MailLabelCreatedAck extends MailWriteAck {
  readonly labelID: number | null;
}

export function decodeMailLabelCreatedAck(response: JsonValue): MailLabelCreatedAck {
  const labelID = toNumber(readPlainJsonField(response, "labelID"));
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    labelID: labelID > 0 ? labelID : null,
  };
}

/** A mailing-list-creation ack: `applied` plus the new listID (null when declined). */
export interface MailingListCreatedAck extends MailWriteAck {
  readonly listID: number | null;
}

export function decodeMailingListCreatedAck(response: JsonValue): MailingListCreatedAck {
  const listID = toNumber(readPlainJsonField(response, "listID"));
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
    listID: listID > 0 ? listID : null,
  };
}

// --- Refusals ---------------------------------------------------------------

/**
 * Turn a server refusal into a sentence a player can act on. An UNMAPPED
 * refusal is passed through verbatim rather than reworded: inventing a friendly
 * cause for something the server did not explain is exactly the failure mode
 * this whole ladder avoids.
 */
const REFUSAL_SENTENCES: Readonly<Record<string, string>> = {
  MAIL_NO_RECIPIENT: "Choose someone to send this to first.",
  MAIL_NO_SUBJECT: "Give your message a subject first.",
  MAIL_TOO_LONG: "That message is longer than the mail system accepts.",
  MAIL_TOO_MANY_RECIPIENTS: "That is more people than you can write to at once.",
  MAIL_NOT_FOUND: "That message is not in your mailbox.",
  MailCannotSendToSelf: "You cannot send mail to yourself.",
  MailRecipientNotFound: "That character could not be found.",
  MailTooManyRecipients: "That is more people than you can write to at once.",
};

export function mailRefusalMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code && code in REFUSAL_SENTENCES) {
    return REFUSAL_SENTENCES[code] as string;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message && message in REFUSAL_SENTENCES) {
    return REFUSAL_SENTENCES[message] as string;
  }
  return message || "That message could not be sent.";
}

// --- The mailbox kept, as the client's mail service keeps it ------------------
//
// The client's mail service (eve/client/script/ui/services/mail/mailSvc.py) syncs the mailbox once for the
// character, when the mail window first asks for it (TrySyncMail, 121 to 131; evemail.py 217), and from then on
// keeps it right from what the server tells it, asking nothing: a mail sent (OnMailSent, 1119 to 1153), deleted
// (1155 to 1172), read or relabelled elsewhere (1174 to 1182), trashed or restored (1189 to 1195). Only a mail
// brought back from deletion has it sync again (1184 to 1187). Its sync asks with the lowest and the highest
// message it holds (147 to 157), and works the answer into what it holds (158 to 233). The page holds the mailbox
// in its store in place of the client's file of headers: a page newly loaded holds none, as a client with no file.

/** The trashed bit of a status mask, and the labels of the system's own folders (appConst.py 1771 to 1780). */
export const MAIL_STATUS_TRASHED = 8;
const MAIL_LABEL_INBOX = 1;
const MAIL_LABEL_SENT = 2;
const MAIL_LABEL_CORPORATION = 4;
const MAIL_LABEL_ALLIANCE = 8;
/** mailSvc.py 30: what a status mask is cut down by when a bit is taken off it. */
const ALL_LABELS = 255;

/** Whether a message is trashed: as the sync said, or as a notice since made it (mailSvc.py 169, 314 to 321). */
export function isTrashed(status: MailStatusRow): boolean {
  return status.trashed ?? (status.statusMask & MAIL_STATUS_TRASHED) !== 0;
}

/** GetUnreadCounts (mailSvc.py 249 to 276): the messages neither read nor trashed. */
export function unreadMailCount(statuses: readonly MailStatusRow[]): number {
  return statuses.reduce((total, status) => (status.read || isTrashed(status) ? total : total + 1), 0);
}

/** How many bodies the client keeps in hand (mailSvc.py 27, BODIES_IN_CACHE): past it, the first kept goes. */
export const MAIL_BODIES_KEPT = 30;

/** A message's text, or that it would not be read. */
export interface MailBody {
  readonly text: string | null;
  readonly unreadable: boolean;
}

/**
 * GetBody's answer made into the message's text, as the client makes it (mailSvc.py 512 to 517): None is a message
 * with nothing in it; otherwise the bytes inflated (zlib.decompress) and read as UTF-8. The body crosses the bridge
 * as {type:"Buffer", data}, and the browser inflates it with its own zlib (DecompressionStream "deflate", which is
 * the zlib format). A body that will not inflate, or is not UTF-8, is said to be unreadable, and no byte of it shown.
 */
export async function inflateMailBody(answer: JsonValue | undefined): Promise<MailBody> {
  if (answer === null || answer === undefined) {
    return { text: "", unreadable: false };
  }
  // A body the bridge found to be text already is text.
  if (typeof answer === "string") {
    return { text: answer, unreadable: false };
  }
  const data = readPlainJsonField(answer, "data");
  if (readPlainJsonField(answer, "type") !== "Buffer" || !Array.isArray(data)) {
    return { text: null, unreadable: true };
  }
  try {
    const bytes = new Uint8Array(data.map((byte) => Number(byte)));
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await new Response(inflated).arrayBuffer());
    return { text, unreadable: false };
  } catch {
    return { text: null, unreadable: true };
  }
}

/** SyncMail's two arguments (mailSvc.py 147 to 156): the lowest and highest messages held, or None and 0 for none. */
export function syncMailArguments(held: readonly MailHeaderRow[]): [number | null, number] {
  if (held.length === 0) {
    return [null, 0];
  }
  const ids = held.map((header) => header.messageID);
  return [Math.min(...ids), Math.max(...ids)];
}

/** The newest first, by date and then by number (the order the panel lists them in). */
function newestFirst(messages: Iterable<MailHeaderRow>): MailHeaderRow[] {
  return [...messages].sort((left, right) => {
    if (left.sentDate !== null && right.sentDate !== null && left.sentDate !== right.sentDate) {
      return right.sentDate > left.sentDate ? 1 : -1;
    }
    return right.messageID - left.messageID;
  });
}

/**
 * SyncMail's answer worked into the mailbox held (mailSvc.py 157 to 233): the headers it carries (newMail, and
 * oldMail where there is one) taken in; every message it gives a status of kept with that status; a status of a
 * message whose header is not held is a header to fetch (GetMailHeaders); and a held message it gives no status of
 * is gone.
 */
export function mailboxAfterSync(held: DecodedMailbox, answer: JsonValue): { readonly mailbox: DecodedMailbox; readonly toFetch: readonly number[] } {
  const headers = new Map(held.messages.map((header) => [header.messageID, header] as const));
  for (const arm of ["newMail", "oldMail"] as const) {
    for (const row of listItems(readKeyVal(answer, arm))) {
      const header = decodeHeaderRow(row);
      if (header) headers.set(header.messageID, header);
    }
  }
  const statuses: MailStatusRow[] = [];
  const toFetch: number[] = [];
  for (const row of listItems(readKeyVal(answer, "mailStatus"))) {
    const status = decodeStatusRow(row);
    if (!status) continue;
    statuses.push(status);
    if (!headers.has(status.messageID)) toFetch.push(status.messageID);
  }
  const kept = new Set(statuses.map((status) => status.messageID));
  return {
    mailbox: { messages: newestFirst([...headers.values()].filter((header) => kept.has(header.messageID))), statuses },
    toFetch,
  };
}

/** GetMailHeaders' answer worked in (mailSvc.py 193 to 207): the headers of messages the sync gave a status of. */
export function mailboxWithHeaders(mailbox: DecodedMailbox, answer: JsonValue): DecodedMailbox {
  const headers = new Map(mailbox.messages.map((header) => [header.messageID, header] as const));
  const kept = new Set(mailbox.statuses.map((status) => status.messageID));
  for (const row of listItems(answer)) {
    const header = decodeHeaderRow(row);
    if (header && kept.has(header.messageID)) headers.set(header.messageID, header);
  }
  return { messages: newestFirst(headers.values()), statuses: mailbox.statuses };
}

/** The statuses of the messages named, each made anew; the rest as they were. */
function withStatuses(mailbox: DecodedMailbox, messageIDs: readonly number[], change: (status: MailStatusRow) => MailStatusRow): DecodedMailbox {
  const named = new Set(messageIDs);
  return { messages: mailbox.messages, statuses: mailbox.statuses.map((status) => (named.has(status.messageID) ? change(status) : status)) };
}

/** The replied and forwarded bits of a status mask (appConst.py 1772 to 1773). */
const MAIL_STATUS_REPLIED = 2;
const MAIL_STATUS_FORWARDED = 4;

/**
 * mailSvc.SendMail (979 to 990): once the mail is sent, the message it answered is marked replied, and the one it
 * forwarded marked forwarded, in what is kept (0 for none).
 */
export function mailboxAfterSending(mailbox: DecodedMailbox, isReplyTo: number, isForwardedFrom: number): DecodedMailbox {
  let after = mailbox;
  if (isReplyTo > 0) after = withStatuses(after, [isReplyTo], (status) => ({ ...status, statusMask: status.statusMask | MAIL_STATUS_REPLIED }));
  if (isForwardedFrom > 0) after = withStatuses(after, [isForwardedFrom], (status) => ({ ...status, statusMask: status.statusMask | MAIL_STATUS_FORWARDED }));
  return after;
}

/** MarkMessagesAsRead (mailSvc.py 336 to 348): read, and the read bit in its mask. */
export function mailboxMarkedRead(mailbox: DecodedMailbox, messageIDs: readonly number[]): DecodedMailbox {
  return withStatuses(mailbox, messageIDs, (status) => ({ ...status, read: true, statusMask: status.statusMask | MAIL_STATUS_READ }));
}

/** MarkMessagesAsUnread (mailSvc.py 323 to 334): not read, the read bit taken off its mask. */
export function mailboxMarkedUnread(mailbox: DecodedMailbox, messageIDs: readonly number[]): DecodedMailbox {
  return withStatuses(mailbox, messageIDs, (status) => ({ ...status, read: false, statusMask: status.statusMask & (ALL_LABELS - MAIL_STATUS_READ) }));
}

/** MoveMessagesToTrash, and the server's OnMailTrashed (mailSvc.py 292 to 301, 1189 to 1191): trashed, its bit in its mask. */
export function mailboxTrashed(mailbox: DecodedMailbox, messageIDs: readonly number[]): DecodedMailbox {
  return withStatuses(mailbox, messageIDs, (status) => ({ ...status, trashed: true, statusMask: status.statusMask | MAIL_STATUS_TRASHED }));
}

/**
 * MoveMessagesFromTrash, and the server's OnMailRestored (mailSvc.py 303 to 321, 1193 to 1195): not trashed; its
 * mask cut down as the client cuts it, by the read bit (the trashed bit stays in it), its read flag left as it was.
 */
export function mailboxRestored(mailbox: DecodedMailbox, messageIDs: readonly number[]): DecodedMailbox {
  return withStatuses(mailbox, messageIDs, (status) => ({ ...status, trashed: false, statusMask: status.statusMask & (ALL_LABELS - MAIL_STATUS_READ) }));
}

/** DeleteMails, and the server's OnMailDeleted (mailSvc.py 478 to 491, 1155 to 1172): the messages gone. */
export function mailboxDeleted(mailbox: DecodedMailbox, messageIDs: readonly number[]): DecodedMailbox {
  const gone = new Set(messageIDs);
  return {
    messages: mailbox.messages.filter((header) => !gone.has(header.messageID)),
    statuses: mailbox.statuses.filter((status) => !gone.has(status.messageID)),
  };
}

/** The messages whose statuses the test picks. */
function messagesWhere(mailbox: DecodedMailbox, pick: (status: MailStatusRow) => boolean): number[] {
  return mailbox.statuses.filter(pick).map((status) => status.messageID);
}

/**
 * MarkAllAsRead and MarkAsReadByLabel (mailSvc.py 415 to 435): every message not trashed, or every one with the
 * label (null for all), read, and the read bit in its mask.
 */
export function mailboxAllRead(mailbox: DecodedMailbox, labelID: number | null): DecodedMailbox {
  return mailboxMarkedRead(mailbox, messagesWhere(mailbox, (status) => !isTrashed(status) && (labelID === null || (status.labelMask & labelID) === labelID)));
}

/** MoveAllToTrash and MoveToTrashByLabel (mailSvc.py 350 to 368): every message, or every one with the label, trashed. */
export function mailboxAllTrashed(mailbox: DecodedMailbox, labelID: number | null): DecodedMailbox {
  return mailboxTrashed(mailbox, messagesWhere(mailbox, (status) => labelID === null || (status.labelMask & labelID) === labelID));
}

/** The mails whose headers say they went to the list. */
function mailsToList(mailbox: DecodedMailbox, listID: number): ReadonlySet<number> {
  return new Set(mailbox.messages.filter((header) => header.toListID === listID).map((header) => header.messageID));
}

/** MarkAsReadByList (mailSvc.py 437 to 445): every mail to the list, not trashed, read, and the read bit in its mask. */
export function mailboxListRead(mailbox: DecodedMailbox, listID: number): DecodedMailbox {
  const toList = mailsToList(mailbox, listID);
  return mailboxMarkedRead(mailbox, messagesWhere(mailbox, (status) => !isTrashed(status) && toList.has(status.messageID)));
}

/** MoveToTrashByList (mailSvc.py 371 to 380): every mail to the list trashed. */
export function mailboxListTrashed(mailbox: DecodedMailbox, listID: number): DecodedMailbox {
  const toList = mailsToList(mailbox, listID);
  return mailboxTrashed(mailbox, messagesWhere(mailbox, (status) => toList.has(status.messageID)));
}

/** MoveAllFromTrash (mailSvc.py 448 to 456): every message not trashed, the trashed bit taken off its mask. */
export function mailboxAllRestored(mailbox: DecodedMailbox): DecodedMailbox {
  return withStatuses(mailbox, messagesWhere(mailbox, () => true), (status) => ({ ...status, trashed: false, statusMask: status.statusMask & (ALL_LABELS - MAIL_STATUS_TRASHED) }));
}

/** EmptyTrash (mailSvc.py 458 to 476): the trashed messages gone, and which they were. */
export function mailboxTrashEmptied(mailbox: DecodedMailbox): { readonly mailbox: DecodedMailbox; readonly gone: readonly number[] } {
  const gone = messagesWhere(mailbox, isTrashed);
  return { mailbox: mailboxDeleted(mailbox, gone), gone };
}

/** The most a label's name may be (appConst.py 1787, mailMaxLabelSize). */
export const MAIL_LABEL_MAX = 40;

/**
 * AssignLabels (mailSvc.py 756 to 772): the label added to those of the messages that lack it; which they were,
 * none where every one has it already (and the client then asks nothing).
 */
export function mailboxLabelAssigned(mailbox: DecodedMailbox, messageIDs: readonly number[], labelID: number): { readonly mailbox: DecodedMailbox; readonly changed: readonly number[] } {
  const named = new Set(messageIDs);
  const changed = messagesWhere(mailbox, (status) => named.has(status.messageID) && (status.labelMask & labelID) !== labelID);
  return { mailbox: withStatuses(mailbox, changed, (status) => ({ ...status, labelMask: status.labelMask | labelID })), changed };
}

/** RemoveLabels (mailSvc.py 774 to 790): the label taken off those of the messages that have it; which they were. */
export function mailboxLabelRemoved(mailbox: DecodedMailbox, messageIDs: readonly number[], labelID: number): { readonly mailbox: DecodedMailbox; readonly changed: readonly number[] } {
  const named = new Set(messageIDs);
  const changed = messagesWhere(mailbox, (status) => named.has(status.messageID) && (status.labelMask & labelID) > 0);
  return { mailbox: withStatuses(mailbox, changed, (status) => ({ ...status, labelMask: status.labelMask & ~labelID })), changed };
}

/** DeleteLabel (mailSvc.py 739 to 755): the label taken off every message that has it. */
export function mailboxLabelDropped(mailbox: DecodedMailbox, labelID: number): DecodedMailbox {
  return withStatuses(mailbox, messagesWhere(mailbox, (status) => (status.labelMask & labelID) > 0), (status) => ({ ...status, labelMask: status.labelMask & ~labelID }));
}

/** A mailing list the pilot has joined (mailingListsMgr.GetJoinedLists): its number, names, and the pilot's place in it. */
export interface MailingList {
  readonly listID: number;
  readonly name: string;
  readonly displayName: string;
  readonly isMuted: boolean;
  readonly isOperator: boolean;
  readonly isOwner: boolean;
}

/** One list's KeyVal (GetJoinedLists' values, Join's answer). */
export function mailingListOf(row: JsonValue | undefined, listID?: number): MailingList | null {
  const id = listID ?? toNumber(readKeyVal(row, "id"));
  if (!(id > 0)) {
    return null;
  }
  return {
    listID: id,
    name: toText(readKeyVal(row, "name")),
    displayName: toText(readKeyVal(row, "displayName")),
    isMuted: readKeyVal(row, "isMuted") === true,
    isOperator: readKeyVal(row, "isOperator") === true,
    isOwner: readKeyVal(row, "isOwner") === true,
  };
}

/** GetJoinedLists' answer, a dict of the lists joined by their numbers. */
export function mailingListsOf(answer: JsonValue): readonly MailingList[] {
  const lists: MailingList[] = [];
  for (const [key, row] of readDictPairs(answer)) {
    const list = mailingListOf(row as JsonValue, toNumber(key as JsonValue));
    if (list !== null) lists.push(list);
  }
  return lists;
}

/** The most a mailing list's name may be (appConst.py 1794, mailingListMaxNameSize). */
export const MAILING_LIST_NAME_MAX = 60;

/**
 * GetKeyAndNormalize (carbon/common/script/util/format.py 381 to 395): a list's name as its key, every space taken
 * out, after its last backslash, case folded; and as shown, each run of a space made one.
 */
export function mailingListKeyAndName(name: string): readonly [string, string] {
  let key = name;
  let shown = name;
  for (const character of name) {
    if (/\s/.test(character)) {
      key = key.split(character).join("");
      while (shown.includes(character + character)) {
        shown = shown.split(character + character).join(character);
      }
    }
  }
  return [(key.split("\\").at(-1) ?? key).toLowerCase(), shown];
}

/**
 * The mailing lists service's notices (mailingListsSvc.py 144 to 180), worked into the lists kept for the pilot
 * `characterID`: an operator, muted or cleared; one left by the pilot, or deleted, gone. Null for any other notice.
 */
export function mailingListsAfterNotice(lists: readonly MailingList[], method: string, args: readonly JsonValue[], characterID: number): readonly MailingList[] | null {
  const listID = toNumber(args[0]);
  const changed = (change: (list: MailingList) => MailingList) => lists.map((list) => (list.listID === listID ? change(list) : list));
  switch (method) {
    case "OnMailingListSetOperator":
      return changed((list) => ({ ...list, isOperator: true, isMuted: false }));
    case "OnMailingListSetMuted":
      return changed((list) => ({ ...list, isMuted: true, isOperator: false }));
    case "OnMailingListSetClear":
      return changed((list) => ({ ...list, isMuted: false, isOperator: false }));
    case "OnMailingListLeave":
      return toNumber(args[1]) === characterID ? lists.filter((list) => list.listID !== listID) : lists;
    case "OnMailingListDeleted":
      return lists.filter((list) => list.listID !== listID);
    default:
      return null;
  }
}

/** GetUnreadCounts' lists (mailSvc.py 249 to 276): the mails sent to each list, neither read nor trashed. */
export function unreadByList(mailbox: DecodedMailbox): ReadonlyMap<number, number> {
  const statusOf = new Map(mailbox.statuses.map((status) => [status.messageID, status] as const));
  const counts = new Map<number, number>();
  for (const header of mailbox.messages) {
    const status = statusOf.get(header.messageID);
    if (header.toListID === null || status === undefined || status.read || isTrashed(status)) continue;
    counts.set(header.toListID, (counts.get(header.toListID) ?? 0) + 1);
  }
  return counts;
}

/** GetMailsByLabelOrListID with a list (mailSvc.py 539 to 542): the mails sent to it, not trashed. */
export function mailsOfList(mailbox: DecodedMailbox, listID: number): readonly MailHeaderRow[] {
  const statusOf = new Map(mailbox.statuses.map((status) => [status.messageID, status] as const));
  return mailbox.messages.filter((header) => {
    const status = statusOf.get(header.messageID);
    return header.toListID === listID && !(status !== undefined && isTrashed(status));
  });
}

/** A member's place in a mailing list (appConst.py 1759 to 1762). */
export const MAILING_LIST_MEMBER_MUTED = 0;
export const MAILING_LIST_MEMBER_DEFAULT = 1;
export const MAILING_LIST_MEMBER_OPERATOR = 2;
export const MAILING_LIST_MEMBER_OWNER = 3;

/** A member of a mailing list and its place in it (mailingListsMgr.GetMembers). */
export interface MailingListMember {
  readonly characterID: number;
  readonly access: number;
}

/** GetMembers' answer, a dict of each member's number and place; one with no number left out. */
export function mailingListMembersOf(answer: JsonValue): readonly MailingListMember[] {
  const members: MailingListMember[] = [];
  for (const [key, value] of readDictPairs(answer)) {
    const characterID = toNumber(key);
    if (characterID > 0) members.push({ characterID, access: toNumber(value) });
  }
  return members;
}

/** A mailing list's settings (mailingListsMgr.GetSettings): who may join and as what, its cost, and whom it lets in or keeps out. */
export interface MailingListSettings {
  readonly defaultAccess: number;
  readonly defaultMemberAccess: number;
  readonly cost: number;
  readonly access: ReadonlyMap<number, number>;
}

/** GetSettings' answer, a KeyVal; null where it answered none. */
export function mailingListSettingsOf(answer: JsonValue): MailingListSettings | null {
  if (answer === null || typeof answer !== "object") {
    return null;
  }
  const access = new Map<number, number>();
  for (const [key, value] of readDictPairs(readKeyVal(answer, "access"))) {
    const entityID = toNumber(key);
    if (entityID > 0) access.set(entityID, toNumber(value));
  }
  return {
    defaultAccess: toNumber(readKeyVal(answer, "defaultAccess")),
    defaultMemberAccess: toNumber(readKeyVal(answer, "defaultMemberAccess")),
    cost: toNumber(readKeyVal(answer, "cost")),
    access,
  };
}

/** The Members tab's choices of whom to show (evemailingListConfig.py 37 to 41). */
export type MailingListMemberFilter = "all" | "members" | "muted" | "operators" | "byName";

/** The Members tab's Apply to selected (42 to 45), and the manager's call for each (mailingListsSvc.py 100 to 135). */
export type MailingListMemberAction = "member" | "muted" | "operator" | "kick";
export const MAILING_LIST_MEMBER_WRITES: Readonly<Record<MailingListMemberAction, string>> = {
  member: "SetMembersClear",
  muted: "SetMembersMuted",
  operator: "SetMembersOperator",
  kick: "KickMembers",
};

/** How many members a page of the Members tab shows (NUMPERPAGE, 46). */
export const MAILING_LIST_MEMBERS_PER_PAGE = 50;

/**
 * FilterMembers and SortMembers (176 to 221): the members of the choice (the operators with the owner), or those
 * whose name begins with what was searched for, both trimmed and case folded; by name, case folded.
 */
export function mailingListMembersShown(
  members: readonly MailingListMember[],
  filter: MailingListMemberFilter,
  search: string,
  nameOf: (characterID: number) => string,
): readonly MailingListMember[] {
  const wanted = search.trim().toLowerCase();
  const shown = members.filter((member) => {
    switch (filter) {
      case "all":
        return true;
      case "members":
        return member.access === MAILING_LIST_MEMBER_DEFAULT;
      case "muted":
        return member.access === MAILING_LIST_MEMBER_MUTED;
      case "operators":
        return member.access === MAILING_LIST_MEMBER_OPERATOR || member.access === MAILING_LIST_MEMBER_OWNER;
      case "byName":
        return nameOf(member.characterID).trim().toLowerCase().startsWith(wanted);
    }
  });
  return shown.sort((left, right) => {
    const x = nameOf(left.characterID).toLowerCase();
    const y = nameOf(right.characterID).toLowerCase();
    return x < y ? -1 : x === y ? 0 : 1;
  });
}

/** Whom a mailing list keeps out or lets in, and its subscription access (appConst.py 1757 to 1758). */
export const MAILING_LIST_BLOCKED = 0;
export const MAILING_LIST_ALLOWED = 1;

/** An owner a search found (lookupSvc's owner searches): its number, name, type and group. */
export interface OwnerMatch {
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number;
  readonly groupID: number;
}

/** LookupPCOwners' answer, a list of KeyVals; a row with no number left out. */
export function ownerMatchesOf(answer: JsonValue): readonly OwnerMatch[] {
  return itemsOf(answer)
    .map((row) => ({
      ownerID: toNumber(readKeyVal(row, "ownerID")),
      ownerName: toText(readKeyVal(row, "ownerName")),
      typeID: toNumber(readKeyVal(row, "typeID")),
      groupID: toNumber(readKeyVal(row, "groupID")),
    }))
    .filter((owner) => owner.ownerID > 0);
}

/** The status bit of a mail the server made itself, as a list's welcome mail is (appConst.py 1776, mailStatusMaskAutomated). */
export const MAIL_STATUS_AUTOMATED = 32;

/** The most a welcome mail's body may be, as its editor holds it (appConst.py 1786, mailMaxTaggedBodySize). */
export const MAIL_MAX_TAGGED_BODY = 10000;

/** A mailing list's welcome mail (mailingListsMgr.GetWelcomeMail): its subject, and its body in the mail's markup. */
export interface WelcomeMail {
  readonly title: string;
  readonly body: string;
}

/** GetWelcomeMail's answer, a list of it or of nothing (UpdateWelcome, evemailingListConfig.py 482 to 492): the first, or null. */
export function welcomeMailOf(answer: JsonValue): WelcomeMail | null {
  const first = itemsOf(answer)[0];
  return first === undefined ? null : { title: toText(readKeyVal(first, "title")), body: toText(readKeyVal(first, "body")) };
}

/** How the mail window shows a mail (MailEntry.LoadMailEntry, evemail.py 1449 to 1468): not read; else replied, then forwarded; else read. */
export type MailRowState = "unread" | "replied" | "forwarded" | "read";

export function mailRowState(status: MailStatusRow | undefined): MailRowState {
  if (status === undefined || !status.read) {
    return "unread";
  }
  if ((status.statusMask & MAIL_STATUS_REPLIED) !== 0) {
    return "replied";
  }
  return (status.statusMask & MAIL_STATUS_FORWARDED) !== 0 ? "forwarded" : "read";
}

/**
 * A mail's one recipient as the Sent folder names it (mailSvc.GetRecipient, 638 to 672): more than one counted with
 * its list and its corporation; else its first pilot, its corporation or alliance, or its list.
 */
export type MailRecipient =
  | { readonly kind: "multiple" }
  | { readonly kind: "character"; readonly id: number }
  | { readonly kind: "corporation"; readonly id: number }
  | { readonly kind: "list"; readonly listID: number }
  | { readonly kind: "none" };

export function mailRecipientOf(header: MailHeaderRow): MailRecipient {
  const count = header.toCharacterIDs.length + (header.toCorpOrAllianceID !== null ? 1 : 0) + (header.toListID !== null ? 1 : 0);
  if (count > 1) {
    return { kind: "multiple" };
  }
  const firstPilot = header.toCharacterIDs[0];
  if (firstPilot !== undefined) {
    return { kind: "character", id: firstPilot };
  }
  if (header.toCorpOrAllianceID !== null) {
    return { kind: "corporation", id: header.toCorpOrAllianceID };
  }
  return header.toListID !== null ? { kind: "list", listID: header.toListID } : { kind: "none" };
}

/** How many mails a page of the mail window shows (evemail.py DEFAULTNUMMAILS, 64; the mail settings' MAILS_PER_PAGE). */
export const MAILS_PER_PAGE = 30;

/** What the mail list may be sorted by (evemail.py 205 to 213): its headers but Labels, in the list's order. */
export type MailSortKey = "status" | "sender" | "subject" | "received";
export const MAIL_SORT_KEYS: readonly MailSortKey[] = ["status", "sender", "subject", "received"];

/**
 * PrepareOrder and DoSort (mailSvc.py 570 to 606): each mail keyed by the header sorted by (the order of its state,
 * unread, replied, forwarded, read; its name, case folded; its subject, case folded; or its number, for Received),
 * then by its number, made negative where the order is not reversed, so that mails keyed alike keep the newest
 * first; sorted, and reversed where the order is (Received reversed: the newest first, the window's own order).
 */
export function mailsSorted(
  rows: readonly MailHeaderRow[],
  sortBy: MailSortKey,
  reversed: boolean,
  nameOf: (header: MailHeaderRow) => string,
  stateOf: (header: MailHeaderRow) => MailRowState,
): readonly MailHeaderRow[] {
  const STATE_ORDER: Readonly<Record<MailRowState, number>> = { unread: 1, replied: 2, forwarded: 3, read: 4 };
  const first = (header: MailHeaderRow): number | string => {
    switch (sortBy) {
      case "status":
        return STATE_ORDER[stateOf(header)];
      case "sender":
        return nameOf(header).toLowerCase();
      case "subject":
        return header.title.toLowerCase();
      default:
        return header.messageID;
    }
  };
  const keyed = rows.map((header) => ({ header, first: first(header), second: reversed ? header.messageID : -header.messageID }));
  keyed.sort((left, right) => {
    if (left.first !== right.first) {
      return left.first < right.first ? -1 : 1;
    }
    return left.second - right.second;
  });
  if (reversed) {
    keyed.reverse();
  }
  return keyed.map((each) => each.header);
}

/**
 * GetLabelText (evemail.py 697 to 714): the names of a mail's labels (GetLabelMaskAsList, mailSvc.py 236 to 247), the
 * window's four by their words over the pilot's own (GetAllLabels, 681 to 710), sorted, joined by ", ".
 */
export function mailLabelText(labelMask: number, ownLabels: readonly MailLabel[], fourNames: ReadonlyMap<number, string>): string {
  const names: string[] = [];
  for (let bit = 1; bit > 0 && bit <= labelMask; bit *= 2) {
    if ((labelMask & bit) === 0) {
      continue;
    }
    const name = fourNames.get(bit) ?? ownLabels.find((label) => label.labelID === bit)?.name;
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(", ");
}

/**
 * GetLabelText (evemail.py 697 to 714) with its colours: a mail's labels as mailLabelText names them, sorted by name
 * then colour, each with the colour the client writes it in (the label's, none taken as the first swatch's).
 */
export function mailLabelParts(labelMask: number, labels: readonly MailLabel[], fourNames: ReadonlyMap<number, string>): readonly { readonly name: string; readonly color: number }[] {
  const parts: { name: string; color: number }[] = [];
  for (let bit = 1; bit > 0 && bit <= labelMask; bit *= 2) {
    if ((labelMask & bit) === 0) {
      continue;
    }
    const own = labels.find((label) => label.labelID === bit);
    const name = fourNames.get(bit) ?? own?.name;
    if (name !== undefined) {
      parts.push({ name, color: own?.color ?? 0 });
    }
  }
  return parts.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : left.color - right.color));
}

/** A list off the wire, its items; anything else, none. */
function itemsOf(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : listItems(value);
}

/** The numbers of a list off the wire. */
function idsOf(value: JsonValue | undefined): readonly number[] {
  return itemsOf(value).map((item) => toNumber(item)).filter((id) => id > 0);
}

/**
 * A notice of the mail service's worked into the mailbox held, as the client works it in (mailSvc.py 1119 to
 * 1195), for the pilot `characterID`: the mailbox as it is after it; "sync" for the one notice after which the
 * client syncs again (OnMailUndeleted); or null for a notice that is not the mail service's.
 */
export function mailboxAfterNotice(mailbox: DecodedMailbox, method: string, args: readonly JsonValue[], characterID: number): DecodedMailbox | "sync" | null {
  switch (method) {
    case "OnMailSent": {
      // OnMailSent (1119 to 1153): a message not held is taken in, its labels and its read flag as the client
      // makes them: the inbox where the pilot is among its recipients; sent, and read where it went to no one but
      // others, where the pilot sent it; the corporation's or the alliance's where it went to one.
      const messageID = toNumber(args[0]);
      if (messageID <= 0 || mailbox.messages.some((header) => header.messageID === messageID)) return mailbox;
      const senderID = toNumber(args[1]);
      const toCharacterIDs = idsOf(args[3]);
      const toListID = toNumber(args[4]);
      const toCorpOrAllianceID = toNumber(args[5]);
      let statusMask = toNumber(args[7]);
      let labelMask = 0;
      let read = false;
      if (toCharacterIDs.includes(characterID)) labelMask = MAIL_LABEL_INBOX;
      if (senderID === characterID) {
        if (labelMask === 0 && toCorpOrAllianceID <= 0 && toListID <= 0) {
          read = true;
          statusMask |= MAIL_STATUS_READ;
        }
        labelMask |= MAIL_LABEL_SENT;
      }
      if (toCorpOrAllianceID > 0) {
        // idCheckers.IsCorporation (222 to 227): an NPC corporation's ID or a player corporation's (inventorycommon/
        // const.py 9 to 10, 79 to 80). The client looks an older one up among the owners it knows, which the page
        // has not; it is taken for an alliance's.
        const isCorporation = (toCorpOrAllianceID >= 98000000 && toCorpOrAllianceID < 99000000) || (toCorpOrAllianceID >= 1000000 && toCorpOrAllianceID < 2000000);
        labelMask |= isCorporation ? MAIL_LABEL_CORPORATION : MAIL_LABEL_ALLIANCE;
      }
      const header: MailHeaderRow = {
        messageID,
        senderID,
        toCharacterIDs,
        toListID: toListID > 0 ? toListID : null,
        toCorpOrAllianceID: toCorpOrAllianceID > 0 ? toCorpOrAllianceID : null,
        title: toText(args[6]),
        sentDate: toFiletime(args[2]),
      };
      return {
        messages: newestFirst([...mailbox.messages, header]),
        statuses: [...mailbox.statuses, { messageID, statusMask, labelMask, read, trashed: false }],
      };
    }
    case "OnMailDeleted":
      // OnMailDeleted (1155 to 1172): the messages named are gone.
      return mailboxDeleted(mailbox, idsOf(args[0]));
    case "OnMailUpdatedByExternal": {
      // OnMailUpdatedByExternal (1174 to 1182): read or unread where it says, and the labels replaced where it
      // gives a label (ReplaceLabels, 792 to 807).
      const messageIDs = idsOf(args[0]);
      let after = mailbox;
      if (args[1] === true) after = mailboxMarkedRead(after, messageIDs);
      if (args[1] === false) after = mailboxMarkedUnread(after, messageIDs);
      if (args[2] !== null && args[2] !== undefined) {
        const labelMask = toNumber(args[2]);
        after = withStatuses(after, messageIDs, (status) => ({ ...status, labelMask }));
      }
      return after;
    }
    case "OnMailTrashed":
      return mailboxTrashed(mailbox, idsOf(args[0]));
    case "OnMailRestored":
      return mailboxRestored(mailbox, idsOf(args[0]));
    case "OnMailUndeleted":
      // OnMailUndeleted (1184 to 1187): the client syncs again.
      return "sync";
    default:
      return null;
  }
}


// --- The labels and the folders, as the client's mail window has them ---------
//
// The mail window draws its folders as it opens (evemail.py LoadLeftSide; GetStaticLabelsGroups): All Mails, the
// inbox, sent, the corporation's and the alliance's, and the trash; then the pilot's own labels (the mail service's
// GetLabels, 676 to 679, asked once and kept), by name. Each but sent and the trash words its unread count beside
// it (UpdateCounters; UI/Mail/FolderLabelWithCount). The window opens on the inbox (270). A folder lists the mails
// not trashed whose labels hold its own (GetMailsByLabelOrListID, 525 to 553; All Mails every one), and the trash
// those trashed (GetTrashedMails, 555 to 568).

/** A label of the pilot's own (mailSvc.GetLabels): its bit, its name, and its colour's number. */
export interface MailLabel {
  readonly labelID: number;
  readonly name: string;
  readonly color: number;
}

/** The system's own folders' bits (appConst.py 1777 to 1780), and the trash's place among them (evemail.py 61). */
export const MAIL_FOLDER_INBOX = 1;
export const MAIL_FOLDER_SENT = 2;
export const MAIL_FOLDER_CORPORATION = 4;
export const MAIL_FOLDER_ALLIANCE = 8;
export const MAIL_FOLDER_TRASH = -1;
const SYSTEM_LABELS = new Set([MAIL_FOLDER_INBOX, MAIL_FOLDER_SENT, MAIL_FOLDER_CORPORATION, MAIL_FOLDER_ALLIANCE]);

/** One label of GetLabels' answer, or OnLabelsCreatedByExternal's: a KeyVal of labelID, name and color. */
export function mailLabelOf(row: JsonValue | undefined): MailLabel | null {
  const labelID = toNumber(readKeyVal(row, "labelID"));
  if (labelID <= 0) {
    return null;
  }
  return { labelID, name: toText(readKeyVal(row, "name")), color: toNumber(readKeyVal(row, "color")) };
}

/**
 * GetLabels' answer, a dict of the pilot's labels by their bits: the pilot's own, and of the system's four (which
 * GetAllLabels names in its own words, 681 to 710) those the server keeps, once one is given a colour. The pilot's
 * own are those not the system's (isSystemMailLabel).
 */
export function mailLabelsOf(answer: JsonValue): readonly MailLabel[] {
  const labels: MailLabel[] = [];
  for (const [, row] of readDictPairs(answer)) {
    const label = mailLabelOf(row as JsonValue);
    if (label !== null) labels.push(label);
  }
  return labels;
}

/** Whether a label is one of the system's four: the inbox, sent, the corporation's and the alliance's. */
export function isSystemMailLabel(labelID: number): boolean {
  return SYSTEM_LABELS.has(labelID);
}

/**
 * A system label's colour as the client keeps it (GetAllLabels, 681 to 710: the server's where it has the label,
 * else None), and an own label's.
 */
export function mailLabelColor(labelID: number, labels: readonly MailLabel[]): number | null {
  return labels.find((label) => label.labelID === labelID)?.color ?? null;
}

/** GetUnreadCounts (mailSvc.py 249 to 276), by label: each label's mails neither read nor trashed; all under null. */
export function unreadByLabel(mailbox: DecodedMailbox): ReadonlyMap<number | null, number> {
  const counts = new Map<number | null, number>();
  let total = 0;
  for (const status of mailbox.statuses) {
    if (status.read || isTrashed(status)) continue;
    total += 1;
    for (let bit = 1, mask = status.labelMask; mask > 0; bit *= 2, mask = Math.floor(mask / 2)) {
      if (mask % 2 === 1) counts.set(bit, (counts.get(bit) ?? 0) + 1);
    }
  }
  counts.set(null, total);
  return counts;
}

/** The mails a folder lists, the newest first: by its label, or all (null), not trashed; or the trash's, trashed. */
export function mailsInFolder(mailbox: DecodedMailbox, folder: number | null): readonly MailHeaderRow[] {
  const statusOf = new Map(mailbox.statuses.map((status) => [status.messageID, status] as const));
  return mailbox.messages.filter((header) => {
    const status = statusOf.get(header.messageID);
    const trashed = status !== undefined && isTrashed(status);
    if (folder === MAIL_FOLDER_TRASH) return trashed;
    if (trashed) return false;
    return folder === null || ((status?.labelMask ?? 0) & folder) === folder;
  });
}

/** idCheckers.IsNPC: an owner above the system's own items (maxSystemItem, 9999) and below the players' (minPlayerOwner). */
export function isNpcOwner(ownerID: number): boolean {
  return ownerID > 9_999 && ownerID < 90_000_000;
}

/**
 * idCheckers.IsCorporation by its ranges (inventorycommon/const.py): an NPC corporation's (1000000 to 1999999) or a
 * player corporation's (98000000 to 98999999). The client also asks its owner cache of an id from before the
 * 64-bit items (100000000 and over); the page has no such cache, and takes none of those for a corporation.
 */
export function isCorporationOwner(ownerID: number): boolean {
  return (ownerID >= 1_000_000 && ownerID <= 1_999_999) || (ownerID >= 98_000_000 && ownerID <= 98_999_999);
}

/**
 * idCheckers.IsAlliance by its range: a player alliance's (minPlayerAlliance to maxPlayerAlliance, 99000000 to
 * 99999999). One from before the 64-bit items the client asks its owner cache of, which the page has not.
 */
export function isAllianceOwner(ownerID: number): boolean {
  return ownerID >= 99_000_000 && ownerID <= 99_999_999;
}

/** appConst.corpRoleChatManager, the Communications Officer's role: an alliance is written to by it. */
export const CORP_ROLE_CHAT_MANAGER = 36_028_797_018_963_968n;

/** Whether a session's roles (a 64-bit mask as its digits) hold the Communications Officer's; none known holds none. */
export function hasChatManagerRole(corpRole: string | null | undefined): boolean {
  return typeof corpRole === "string" && /^\d+$/.test(corpRole) && (BigInt(corpRole) & CORP_ROLE_CHAT_MANAGER) === CORP_ROLE_CHAT_MANAGER;
}
