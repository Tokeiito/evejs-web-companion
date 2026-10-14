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
  readonly title: string;
  readonly body: string;
}): DraftCheck {
  if (draft.recipientIDs.length === 0) {
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
 * GetLabels' answer, a dict of the pilot's labels by their bits: the pilot's own, the system's four (which
 * GetAllLabels names in its own words, 681 to 710) left out.
 */
export function mailLabelsOf(answer: JsonValue): readonly MailLabel[] {
  const labels: MailLabel[] = [];
  for (const [, row] of readDictPairs(answer)) {
    const label = mailLabelOf(row as JsonValue);
    if (label !== null && !SYSTEM_LABELS.has(label.labelID)) labels.push(label);
  }
  return labels;
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
