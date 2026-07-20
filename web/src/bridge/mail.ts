// R17 Slice A — decoding the retail MAIL surface (mailMgr).
//
// ⚠ THE INBOX IS A DELTA SYNC, NOT A LIST. SyncMail(firstID, lastID) answers
// only what falls OUTSIDE the window the caller already holds, split across
// three arms: {newMail, oldMail, mailStatus}. The browser caches nothing across
// a page load, so the BFF always cold-starts it with [null, 0] and both header
// arms together are the whole mailbox. `decodeMailbox` merges them; nothing
// here cares which arm a header arrived in, because for a cold client the split
// carries no information.
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
import { isListValue, readKeyVal, unwrapLong } from "./wire.ts";

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

/** Retail's own ceilings, so a too-long message is caught before it is sent. */
export const MAIL_MAX_RECIPIENTS = 20;
export const MAIL_MAX_TITLE = 200;
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
