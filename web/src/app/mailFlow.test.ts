// The R17 Mail controller against a faked BFF: loadMail decodes the cold delta
// sync into the store and asks for the NAME of everyone it will render;
// openMail carries plain text (the BFF already inflated it); sendMail reports
// what the server actually did.
//
// The properties that matter here are the ones that keep the panel honest:
//  - the inbox is a DELTA SYNC, so the store's message list is REPLACED on
//    every load — a row surviving a reload would be a message the server no
//    longer says the player has;
//  - EVERY person the panel will name is asked for, senders and recipients
//    alike, or the inbox renders "someone" where a name belongs;
//  - a SILENT decline (SendMail's bare null, which carries no reason) reaches
//    the store as exactly that, with no invented cause;
//  - a message marked read reloads the inbox, so the unread count and the list
//    row cannot disagree;
//  - a lost session unwinds to character select.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const CHARACTER_ID = 140000003;
const SENDER_ID = 140000004;
const THIRD_ID = 140000005;
const CORP_ID = 98000000;
const MESSAGE_ID = 4021;

function long(value: string): unknown {
  return { type: "long", value };
}

function list(items: readonly unknown[]): unknown {
  return { type: "list", items };
}

function keyVal(fields: Record<string, unknown>): unknown {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

function header(overrides: Record<string, unknown> = {}): unknown {
  return keyVal({
    messageID: MESSAGE_ID,
    senderID: SENDER_ID,
    // ⚠ A COMMA-JOINED STRING, as the server emits it.
    toCharacterIDs: String(CHARACTER_ID),
    toListID: null,
    toCorpOrAllianceID: null,
    title: "Docking rights",
    sentDate: long("133000000000000000"),
    ...overrides,
  });
}

function status(overrides: Record<string, unknown> = {}): unknown {
  return keyVal({ messageID: MESSAGE_ID, statusMask: 0, labelMask: 1, ...overrides });
}

function inboxPayload(parts: {
  newMail?: readonly unknown[];
  oldMail?: readonly unknown[];
  mailStatus?: readonly unknown[];
  unreadCount?: number;
} = {}) {
  return {
    ok: true,
    characterID: CHARACTER_ID,
    sync: keyVal({
      newMail: list(parts.newMail ?? [header()]),
      oldMail: list(parts.oldMail ?? []),
      mailStatus: list(parts.mailStatus ?? [status()]),
    }),
    backfill: null,
    unreadCount: parts.unreadCount ?? 1,
  };
}

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => {
    status: number;
    body: unknown;
  },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    const outcome = responder(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

function respondOk(
  extra: (path: string, method: string, body: Record<string, unknown>) => unknown = () => null,
) {
  return (path: string, method: string, body: Record<string, unknown>) => {
    const custom = extra(path, method, body);
    if (custom !== null && custom !== undefined) {
      return custom as { status: number; body: unknown };
    }
    if (path.startsWith("/api/bridge/mail/body")) {
      return {
        status: 200,
        body: {
          ok: true,
          messageID: MESSAGE_ID,
          // ⚠ Plain TEXT. The BFF inflated the zlib buffer GetBody answers.
          body: "The convoy leaves at 19:00.",
          unreadable: false,
          markedRead: false,
          unreadCount: 1,
        },
      };
    }
    if (path.startsWith("/api/bridge/mail/send")) {
      return {
        status: 200,
        body: {
          ok: true,
          applied: true,
          declinedSilently: false,
          messageID: 5000,
          unreadCount: 1,
          recipientCount: 1,
        },
      };
    }
    if (path.startsWith("/api/bridge/mail")) {
      return { status: 200, body: inboxPayload() };
    }
    if (path.startsWith("/api/characters/find")) {
      return {
        status: 200,
        body: { ok: true, matches: [{ characterID: SENDER_ID, name: "Other Pilot" }] },
      };
    }
    if (path === "/api/names") {
      return { status: 200, body: { ok: true, names: {} } };
    }
    return { status: 200, body: { ok: true } };
  };
}

async function settleNames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeFlow(responder: ReturnType<typeof respondOk>) {
  const store = createClientStore();
  const { fetch: fakeFetch, requests } = makeFakeFetch(responder);
  const flow = createAppFlow(store, { fetch: fakeFetch });
  return { store, flow, requests };
}

// --- loading the inbox ------------------------------------------------------

test("loadMail decodes the cold sync into the store", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();

  assert.ok(
    requests.some((entry) => entry.path === "/api/bridge/mail" && entry.method === "GET"),
    "the inbox is one GET; the delta window is the BFF's business",
  );
  const mail = store.get().mail;
  assert.equal(mail.loaded, true);
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0]?.title, "Docking rights");
  assert.deepEqual(mail.messages[0]?.toCharacterIDs, [CHARACTER_ID]);
  assert.equal(mail.unreadCount, 1);
});

test("⚠ every person the panel will NAME is asked for — senders and recipients", async () => {
  const { flow, requests } = makeFlow(
    respondOk((path) =>
      path === "/api/bridge/mail"
        ? {
            status: 200,
            body: inboxPayload({
              newMail: [header({ toCharacterIDs: `${CHARACTER_ID},${THIRD_ID}` })],
            }),
          }
        : null,
    ),
  );
  await flow.loadMail();
  await settleNames();

  const nameRequest = requests.find((entry) => entry.path === "/api/names");
  assert.ok(nameRequest, "the inbox must resolve names in one batched round-trip");
  const asked = (nameRequest.body.items as { kind: string; id: number }[]) ?? [];
  const keys = new Set(asked.map((ref) => `${ref.kind}:${ref.id}`));
  assert.ok(keys.has(`character:${SENDER_ID}`), "the sender must be named");
  assert.ok(keys.has(`character:${CHARACTER_ID}`), "each recipient must be named");
  assert.ok(keys.has(`character:${THIRD_ID}`), "...including the second one");
});

test("a corporation-wide message asks for the CORPORATION's name", async () => {
  const { flow, requests } = makeFlow(
    respondOk((path) =>
      path === "/api/bridge/mail"
        ? {
            status: 200,
            body: inboxPayload({
              newMail: [
                header({ toCharacterIDs: null, toCorpOrAllianceID: CORP_ID }),
              ],
            }),
          }
        : null,
    ),
  );
  await flow.loadMail();
  await settleNames();

  const nameRequest = requests.find((entry) => entry.path === "/api/names");
  const asked = (nameRequest?.body.items as { kind: string; id: number }[]) ?? [];
  assert.ok(
    asked.some((ref) => ref.kind === "corporation" && ref.id === CORP_ID),
    "so it reads 'everyone at <corp>' rather than a number",
  );
});

test("⚠ a reload REPLACES the mailbox — a cold sync is the whole truth", async () => {
  let second = false;
  const { store, flow } = makeFlow(
    respondOk((path) => {
      if (path !== "/api/bridge/mail") {
        return null;
      }
      if (!second) {
        second = true;
        return {
          status: 200,
          body: inboxPayload({ newMail: [header({ messageID: 1 }), header({ messageID: 2 })] }),
        };
      }
      // The server now says only one message exists.
      return { status: 200, body: inboxPayload({ newMail: [header({ messageID: 2 })] }) };
    }),
  );

  await flow.loadMail();
  assert.equal(store.get().mail.messages.length, 2);
  await flow.loadMail();
  assert.deepEqual(
    store.get().mail.messages.map((row) => row.messageID),
    [2],
    "a message the server dropped must not survive in the panel",
  );
});

test("an empty mailbox loads as an empty inbox, not an error", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path === "/api/bridge/mail"
        ? { status: 200, body: inboxPayload({ newMail: [], mailStatus: [], unreadCount: 0 }) }
        : null,
    ),
  );
  await flow.loadMail();
  assert.equal(store.get().mail.loaded, true);
  assert.deepEqual(store.get().mail.messages, []);
  assert.equal(store.get().mail.unreadCount, 0);
});

// --- opening a message ------------------------------------------------------

test("openMail stores the already-inflated TEXT", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, false);

  const bodyRequest = requests.find((entry) => entry.path.startsWith("/api/bridge/mail/body"));
  assert.ok(bodyRequest, "the body is its own read");
  assert.ok(
    bodyRequest.path.includes(`messageID=${MESSAGE_ID}`),
    "the message is named in the query",
  );
  assert.equal(
    bodyRequest.path.includes("markRead"),
    false,
    "opening without marking read must not send the flag",
  );
  assert.equal(store.get().mail.open?.body, "The convoy leaves at 19:00.");
  assert.equal(store.get().mail.open?.unreadable, false);
});

test("marking read RELOADS the inbox so the count and the list agree", async () => {
  const { store, flow, requests } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/mail/body")
        ? {
            status: 200,
            body: {
              ok: true,
              messageID: MESSAGE_ID,
              body: "text",
              unreadable: false,
              // The BFF's RE-READ says the flag really moved.
              markedRead: true,
              unreadCount: 0,
            },
          }
        : null,
    ),
  );
  await flow.loadMail();
  const before = requests.filter((entry) => entry.path === "/api/bridge/mail").length;
  await flow.openMail(MESSAGE_ID, true);

  const bodyRequest = requests.find((entry) => entry.path.includes("markRead=1"));
  assert.ok(bodyRequest, "markRead=1 must reach the BFF");
  assert.ok(
    requests.filter((entry) => entry.path === "/api/bridge/mail").length > before,
    "a successful mark-read reloads the inbox",
  );
  assert.equal(store.get().mail.open?.markedRead, true);
});

test("⚠ a body whose read-flag re-read failed makes NO claim about it", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/mail/body")
        ? {
            status: 200,
            body: {
              ok: true,
              messageID: MESSAGE_ID,
              body: "text",
              unreadable: false,
              // The BFF could not confirm, so it says nothing.
              markedRead: null,
              unreadCount: null,
            },
          }
        : null,
    ),
  );
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, true);
  assert.equal(
    store.get().mail.open?.markedRead,
    null,
    "no re-read means no claim — not an assumed true",
  );
});

test("a damaged body is reported unreadable rather than shown as garbage", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/mail/body")
        ? {
            status: 200,
            body: {
              ok: true,
              messageID: MESSAGE_ID,
              body: null,
              unreadable: true,
              markedRead: false,
              unreadCount: 1,
            },
          }
        : null,
    ),
  );
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, false);
  assert.equal(store.get().mail.open?.unreadable, true);
  assert.equal(store.get().mail.open?.body, null);
});

test("closeMail drops the open message without touching the server", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, false);
  const before = requests.length;
  flow.closeMail();
  assert.equal(store.get().mail.open, null);
  assert.equal(requests.length, before, "closing is local");
});

test("a body read that fails records a refusal instead of throwing", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/mail/body")
        ? { status: 404, body: { ok: false, error: "MAIL_NOT_FOUND" } }
        : null,
    ),
  );
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, false);
  assert.match(store.get().mail.actionError ?? "", /not in your mailbox/);
});

// --- sending ----------------------------------------------------------------

test("sendMail posts the recipients as a LIST and reloads afterwards", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  const before = requests.filter((entry) => entry.path === "/api/bridge/mail").length;
  await flow.sendMail({ toCharacterIDs: [SENDER_ID], title: "Hi", body: "there" });

  const send = requests.find((entry) => entry.path === "/api/bridge/mail/send");
  assert.ok(send);
  assert.equal(send.method, "POST");
  // ⚠ A LIST on the way in, even though headers read it back as a string.
  assert.deepEqual(send.body.toCharacterIDs, [SENDER_ID]);
  assert.equal(send.body.title, "Hi");
  assert.ok(
    requests.filter((entry) => entry.path === "/api/bridge/mail").length > before,
    "the panel shows the server's own picture before it says anything happened",
  );
  const outcome = store.get().mail.lastOutcome;
  assert.equal(outcome?.applied, true);
  assert.equal(outcome?.recipientCount, 1);
});

test("⚠ a SILENT decline reaches the store as one, with no invented cause", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path === "/api/bridge/mail/send"
        ? {
            status: 200,
            body: {
              ok: true,
              applied: false,
              declinedSilently: true,
              messageID: null,
              recipientCount: 0,
              // SendMail answered a bare null; the server gave no reason.
              message: "The server did not send that message, and did not say why.",
            },
          }
        : null,
    ),
  );
  await flow.loadMail();
  await flow.sendMail({ toCharacterIDs: [SENDER_ID], title: "Hi", body: "there" });

  const outcome = store.get().mail.lastOutcome;
  assert.equal(outcome?.applied, false);
  assert.equal(outcome?.declinedSilently, true);
  assert.match(outcome?.message ?? "", /did not say why/);
});

test("a refused send records the reason and does not throw", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path === "/api/bridge/mail/send"
        ? { status: 400, body: { ok: false, error: "MAIL_NO_RECIPIENT" } }
        : null,
    ),
  );
  await flow.loadMail();
  await flow.sendMail({ toCharacterIDs: [], title: "Hi", body: "there" });
  assert.match(store.get().mail.actionError ?? "", /Choose someone/);
});

test("findCharacters searches by NAME and carries the id invisibly", async () => {
  const { flow, requests } = makeFlow(respondOk());
  const matches = await flow.findCharacters("Other");
  assert.deepEqual(matches, [{ characterID: SENDER_ID, name: "Other Pilot" }]);
  assert.ok(
    requests.some((entry) => entry.path.startsWith("/api/characters/find?q=Other")),
    "the player types a name; the id never appears in the UI",
  );
});

test("a too-short search asks the server nothing", async () => {
  const { flow, requests } = makeFlow(respondOk());
  assert.deepEqual(await flow.findCharacters("a"), []);
  assert.equal(
    requests.some((entry) => entry.path.startsWith("/api/characters/find")),
    false,
  );
});

// --- session loss -----------------------------------------------------------

test("a lost session unwinds to character select", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path === "/api/bridge/mail"
        ? { status: 404, body: { ok: false, error: "SESSION_NOT_FOUND" } }
        : null,
    ),
  );
  await assert.rejects(() => flow.loadMail());
  assert.equal(store.get().station.online, null, "the session unwound to character select");
});

test("going offline CLEARS the mailbox — mail must not outlive the character", async () => {
  const { store, flow } = makeFlow(respondOk());
  await flow.loadMail();
  assert.equal(store.get().mail.messages.length, 1);

  store.apply({ type: "character/offline" });
  assert.deepEqual(
    store.get().mail.messages,
    [],
    "one character's mail must never be visible to the next",
  );
  assert.equal(store.get().mail.unreadCount, 0);
  assert.equal(store.get().mail.open, null);
});
