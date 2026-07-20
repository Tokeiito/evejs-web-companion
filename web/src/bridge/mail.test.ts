// bridge/mail.ts against the shapes mailMgr really emits.
//
// The properties that matter here are the ones a wrong guess would get silently
// wrong rather than loudly:
//  - `toCharacterIDs` is a COMMA-JOINED STRING, and a decoder that assumes an
//    array turns two recipients into one character whose id is the whole
//    string;
//  - the sync's two header arms must be MERGED, because for a cold client the
//    split between "new" and "old" carries no information at all;
//  - a message addressed to NOBODY is a real shape the server permits, not a
//    defensive branch;
//  - an unmapped refusal must be passed through verbatim rather than reworded
//    into a cause the server never gave.

import test from "node:test";
import assert from "node:assert/strict";

import {
  audienceOf,
  checkDraft,
  decodeMailbox,
  mailRefusalMessage,
  readFlags,
  splitRecipientIDs,
  unreadCount,
} from "./mail.ts";
import type { JsonValue } from "./wire.ts";

const ME = 140000003;
const THEM = 140000004;
const THIRD = 140000005;

function long(value: string): JsonValue {
  return { type: "long", value } as unknown as JsonValue;
}

function list(items: readonly unknown[]): JsonValue {
  return { type: "list", items } as unknown as JsonValue;
}

function keyVal(fields: Record<string, unknown>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

function header(overrides: Record<string, unknown> = {}): JsonValue {
  return keyVal({
    messageID: 4021,
    senderID: THEM,
    // ⚠ A STRING, as buildMailHeaderRow emits it.
    toCharacterIDs: String(ME),
    toListID: null,
    toCorpOrAllianceID: null,
    title: "Docking rights",
    sentDate: long("133000000000000000"),
    ...overrides,
  });
}

function status(overrides: Record<string, unknown> = {}): JsonValue {
  return keyVal({ messageID: 4021, statusMask: 0, labelMask: 1, ...overrides });
}

function sync(parts: {
  newMail?: readonly JsonValue[];
  oldMail?: readonly JsonValue[];
  mailStatus?: readonly JsonValue[];
}): JsonValue {
  return keyVal({
    newMail: list(parts.newMail ?? []),
    oldMail: list(parts.oldMail ?? []),
    mailStatus: list(parts.mailStatus ?? []),
  });
}

// --- the comma-joined string ------------------------------------------------

test("⚠ toCharacterIDs is split on ',' — it is a STRING, not a list", () => {
  assert.deepEqual(splitRecipientIDs(`${ME},${THEM}`), [ME, THEM]);
  assert.deepEqual(splitRecipientIDs(String(ME)), [ME]);
  // Whitespace, duplicates and non-ids are all dropped rather than passed on to
  // the name service as refs it can never resolve.
  assert.deepEqual(splitRecipientIDs(` ${ME} , ${ME} , 0 , -3 , x `), [ME]);
});

test("no recipients at all decodes to an empty list, not a bogus id", () => {
  assert.deepEqual(splitRecipientIDs(null as unknown as JsonValue), []);
  assert.deepEqual(splitRecipientIDs(""), []);
});

test("a header carries its recipients as real ids once decoded", () => {
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ toCharacterIDs: `${ME},${THIRD}` })] }),
  );
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.toCharacterIDs, [ME, THIRD]);
  assert.equal(messages[0]?.senderID, THEM);
  assert.equal(messages[0]?.title, "Docking rights");
  // ⚠ A FILETIME, kept as a bigint: it exceeds 2^53.
  assert.equal(messages[0]?.sentDate, 133000000000000000n);
});

// --- merging the arms -------------------------------------------------------

test("⚠ the two header arms are MERGED — for a cold client the split says nothing", () => {
  const { messages } = decodeMailbox(
    sync({
      newMail: [header({ messageID: 20, title: "Newer" })],
      oldMail: [header({ messageID: 10, title: "Older" })],
    }),
  );
  assert.deepEqual(
    messages.map((row) => row.title),
    ["Newer", "Older"],
    "both arms are the mailbox, newest first",
  );
});

test("a message in both arms is kept once", () => {
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ messageID: 7 })], oldMail: [header({ messageID: 7 })] }),
  );
  assert.equal(messages.length, 1);
});

test("GetMailHeaders backfill rows join the mailbox without duplicating it", () => {
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ messageID: 7, title: "From the sync" })] }),
    list([
      header({ messageID: 7, title: "Duplicate" }),
      header({ messageID: 9, title: "Backfilled" }),
    ]),
  );
  assert.equal(messages.length, 2);
  assert.equal(
    messages.find((row) => row.messageID === 7)?.title,
    "From the sync",
    "the sync's own row wins over a duplicate backfill",
  );
  assert.ok(messages.some((row) => row.title === "Backfilled"));
});

test("messages sort newest first, falling back to messageID when dates tie", () => {
  const { messages } = decodeMailbox(
    sync({
      newMail: [
        header({ messageID: 1, sentDate: long("133000000000000000") }),
        header({ messageID: 3, sentDate: long("133000000000000000") }),
        header({ messageID: 2, sentDate: long("134000000000000000") }),
      ],
    }),
  );
  assert.deepEqual(messages.map((row) => row.messageID), [2, 3, 1]);
});

test("an empty sync decodes to an empty mailbox, not a throw", () => {
  const { messages, statuses } = decodeMailbox(sync({}));
  assert.deepEqual(messages, []);
  assert.deepEqual(statuses, []);
});

test("a malformed sync decodes to an empty mailbox rather than throwing", () => {
  assert.deepEqual(decodeMailbox(null).messages, []);
  assert.deepEqual(decodeMailbox("nonsense" as unknown as JsonValue).messages, []);
});

// --- read flags -------------------------------------------------------------

test("the read bit is pulled out of statusMask, and unread messages are counted", () => {
  const { statuses } = decodeMailbox(
    sync({
      mailStatus: [
        status({ messageID: 1, statusMask: 0 }),
        status({ messageID: 2, statusMask: 1 }),
        // Other bits set, read bit clear: still unread.
        status({ messageID: 3, statusMask: 4 }),
      ],
    }),
  );
  assert.equal(statuses.find((row) => row.messageID === 2)?.read, true);
  assert.equal(statuses.find((row) => row.messageID === 3)?.read, false);
  assert.equal(unreadCount(statuses), 2);

  const flags = readFlags(statuses);
  assert.equal(flags.get(1), false);
  assert.equal(flags.get(2), true);
});

// --- audience ---------------------------------------------------------------

test("a message to characters names them", () => {
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ toCharacterIDs: `${ME},${THIRD}` })] }),
  );
  const audience = audienceOf(messages[0]!);
  assert.equal(audience.kind, "characters");
  assert.deepEqual(
    audience.kind === "characters" ? audience.characterIDs : [],
    [ME, THIRD],
  );
});

test("a mailing-list message is LABELLED, not dropped", () => {
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ toCharacterIDs: null, toListID: 500000001 })] }),
  );
  // Mailing lists are out of this slice, but a player must still see that the
  // message exists.
  assert.equal(audienceOf(messages[0]!).kind, "list");
});

test("a corporation-wide message keeps the owner so it can be NAMED", () => {
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ toCharacterIDs: null, toCorpOrAllianceID: 98000000 })] }),
  );
  const audience = audienceOf(messages[0]!);
  assert.equal(audience.kind, "corporation");
  assert.equal(audience.kind === "corporation" ? audience.ownerID : 0, 98000000);
});

test("⚠ a message addressed to NOBODY is a real shape the server permits", () => {
  // mailState's NO_RECIPIENTS guard cannot fire through the gateway (it reads
  // `length === 0 && !saveSenderCopy`, and mailMgr always keeps a sender copy),
  // so a mailbox really can hold one of these.
  const { messages } = decodeMailbox(
    sync({ newMail: [header({ toCharacterIDs: null, toListID: null, toCorpOrAllianceID: null })] }),
  );
  assert.equal(audienceOf(messages[0]!).kind, "nobody");
});

// --- the draft check --------------------------------------------------------

test("a draft with no recipient is refused — the SERVER will not refuse it", () => {
  const check = checkDraft({ recipientIDs: [], title: "Hi", body: "there" });
  assert.equal(check.ok, false);
  assert.match(check.message ?? "", /Choose someone/);
});

test("a draft with no subject is refused", () => {
  assert.equal(checkDraft({ recipientIDs: [ME], title: "   ", body: "x" }).ok, false);
});

test("a draft over the recipient ceiling is refused", () => {
  const many = Array.from({ length: 21 }, (_, index) => 1000 + index);
  assert.equal(checkDraft({ recipientIDs: many, title: "Hi", body: "x" }).ok, false);
});

test("a draft over the body ceiling is refused", () => {
  const check = checkDraft({ recipientIDs: [ME], title: "Hi", body: "x".repeat(8001) });
  assert.equal(check.ok, false);
});

test("an empty body is fine — a subject-only message is a real message", () => {
  assert.equal(checkDraft({ recipientIDs: [ME], title: "Hi", body: "" }).ok, true);
});

// --- refusals ---------------------------------------------------------------

test("a known refusal becomes a sentence a player can act on", () => {
  assert.match(
    mailRefusalMessage(Object.assign(new Error("x"), { code: "MAIL_NO_RECIPIENT" })),
    /Choose someone/,
  );
});

test("⚠ an UNMAPPED refusal is passed through verbatim, never reworded", () => {
  const error = Object.assign(new Error("MailSomethingNobodyAnticipated"), {
    code: "MailSomethingNobodyAnticipated",
  });
  assert.equal(
    mailRefusalMessage(error),
    "MailSomethingNobodyAnticipated",
    "inventing a friendly cause the server never gave is exactly the failure mode to avoid",
  );
});
