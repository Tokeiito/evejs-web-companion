// The R17 Mail controller against a faked BFF: loadMail syncs the mailbox by
// the generic call (mailSvc.SyncMail) and asks for the NAME of everyone it will render;
// openMail asks GetBody and inflates the body itself; sendMail reports
// what the server actually did.
//
// The properties that matter here are the ones that keep the panel honest:
//  - EVERY person the panel will name is asked for, senders and recipients
//    alike, or the inbox renders "someone" where a name belongs;
//  - a SILENT decline (SendMail's bare null, which carries no reason) reaches
//    the store as exactly that, with no invented cause;
//  - a lost session unwinds to character select.

import test from "node:test";
import assert from "node:assert/strict";

import { deflateSync } from "node:zlib";

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

/** Whether a request is the mail manager's SyncMail, by the generic call. */
function isSync(path: string, body: Record<string, unknown>): boolean {
  return path === "/api/bridge/call" && body.service === "mailMgr" && body.method === "SyncMail";
}

/** Whether a request is the mail manager's GetBody, by the generic call. */
function isBodyRead(path: string, body: Record<string, unknown>): boolean {
  return path === "/api/bridge/call" && body.service === "mailMgr" && body.method === "GetBody";
}

/** GetBody's answer by the generic call: the text deflated, as a Node Buffer crosses the bridge. */
function bodyAnswer(text: string): { status: number; body: unknown } {
  return { status: 200, body: { ok: true, service: "mailMgr", method: "GetBody", result: { type: "Buffer", data: [...deflateSync(Buffer.from(text, "utf8"))] }, notifications: [] } };
}

/** SyncMail's answer by the generic call, of the parts given. */
function syncAnswer(parts: Parameters<typeof inboxPayload>[0] = {}): { status: number; body: unknown } {
  return { status: 200, body: { ok: true, service: "mailMgr", method: "SyncMail", result: inboxPayload(parts).sync, notifications: [] } };
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
    if (isBodyRead(path, body)) {
      return bodyAnswer("The convoy leaves at 19:00.");
    }
    // The send is the page's own call since 2026-10-14 (mailMgr.SendMail through the generic call), answered the
    // message's number.
    if (path === "/api/bridge/call" && body.service === "mailMgr" && body.method === "SendMail") {
      return {
        status: 200,
        body: {
          ok: true,
          service: "mailMgr",
          method: "SendMail",
          result: 5000,
          notifications: [],
        },
      };
    }
    if (isSync(path, body)) {
      return syncAnswer();
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

test("loadMail syncs the mailbox into the store", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();

  // mailSvc.SyncMail (147 to 157): a page holding nothing asks with None and 0.
  const sync = requests.find((entry) => isSync(entry.path, entry.body));
  assert.ok(sync, "the mailbox is the mail manager's SyncMail");
  assert.deepEqual(sync.body.args, [null, 0]);
  const mail = store.get().mail;
  assert.equal(mail.loaded, true);
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0]?.title, "Docking rights");
  assert.deepEqual(mail.messages[0]?.toCharacterIDs, [CHARACTER_ID]);
  assert.equal(mail.unreadCount, 1);
});

test("⚠ every person the panel will NAME is asked for — senders and recipients", async () => {
  const { flow, requests } = makeFlow(
    respondOk((path, _method, body) =>
      isSync(path, body)
        ? syncAnswer({ newMail: [header({ toCharacterIDs: `${CHARACTER_ID},${THIRD_ID}` })] })
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
    respondOk((path, _method, body) =>
      isSync(path, body)
        ? syncAnswer({ newMail: [header({ toCharacterIDs: null, toCorpOrAllianceID: CORP_ID })] })
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

test("an empty mailbox loads as an empty inbox, not an error", async () => {
  const { store, flow } = makeFlow(
    respondOk((path, _method, body) =>
      isSync(path, body) ? syncAnswer({ newMail: [], mailStatus: [], unreadCount: 0 }) : null,
    ),
  );
  await flow.loadMail();
  assert.equal(store.get().mail.loaded, true);
  assert.deepEqual(store.get().mail.messages, []);
  assert.equal(store.get().mail.unreadCount, 0);
});

// --- opening a message ------------------------------------------------------

test("openMail inflates the body GetBody answers", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, false);

  // mailSvc.GetBody (512): the message, and whether to mark it read.
  const bodyRequest = requests.find((entry) => isBodyRead(entry.path, entry.body));
  assert.ok(bodyRequest, "the body is its own read");
  assert.deepEqual(bodyRequest.body.args, [MESSAGE_ID, false], "opening without marking read must not send the flag");
  assert.equal(store.get().mail.open?.body, "The convoy leaves at 19:00.");
  assert.equal(store.get().mail.open?.unreadable, false);
});

test("marking read sends the flag with the body's read", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, true);

  const bodyRequest = requests.find((entry) => isBodyRead(entry.path, entry.body));
  assert.deepEqual(bodyRequest?.body.args, [MESSAGE_ID, true], "the flag must reach the server");
  assert.equal(store.get().mail.open?.markedRead, true);
});

test("a damaged body is reported unreadable rather than shown as garbage", async () => {
  const { store, flow } = makeFlow(
    respondOk((path, _method, body) =>
      isBodyRead(path, body)
        ? // Bytes that are not a zlib stream at all.
          { status: 200, body: { ok: true, service: "mailMgr", method: "GetBody", result: { type: "Buffer", data: [1, 2, 3, 4] }, notifications: [] } }
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
    respondOk((path, _method, body) =>
      isBodyRead(path, body)
        ? { status: 404, body: { ok: false, error: "MAIL_NOT_FOUND" } }
        : null,
    ),
  );
  await flow.loadMail();
  await flow.openMail(MESSAGE_ID, false);
  assert.match(store.get().mail.actionError ?? "", /not in your mailbox/);
});

// --- sending ----------------------------------------------------------------

test("sendMail is the page's own SendMail, the recipients a LIST", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  await flow.sendMail({ toCharacterIDs: [SENDER_ID], title: "Hi", body: "there" });

  // mailSvc.SendMail (959): the seven arguments, the recipients a list, no list and no corporation, and 0 for the
  // message answered and the one forwarded.
  const send = requests.find((entry) => entry.path === "/api/bridge/call" && entry.body.method === "SendMail");
  assert.ok(send);
  assert.deepEqual(send.body.args, [[SENDER_ID], null, null, "Hi", "there", 0, 0]);
  const outcome = store.get().mail.lastOutcome;
  assert.equal(outcome?.applied, true);
  assert.equal(outcome?.recipientCount, 1);
});

test("⚠ a SILENT decline reaches the store as one, with no invented cause", async () => {
  const { store, flow } = makeFlow(
    respondOk((path, _method, body) =>
      path === "/api/bridge/call" && body.method === "SendMail"
        ? // SendMail answered a bare None; the server gave no reason.
          { status: 200, body: { ok: true, service: "mailMgr", method: "SendMail", result: null, notifications: [] } }
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
  // No recipient: refused before the call, as the compose window refuses it (evemail.py ClickSend), and nothing asked.
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadMail();
  await flow.sendMail({ toCharacterIDs: [], title: "Hi", body: "there" });
  assert.match(store.get().mail.actionError ?? "", /Choose someone/);
  assert.equal(requests.some((entry) => entry.path === "/api/bridge/call" && entry.body.method === "SendMail"), false);
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
    respondOk((path, _method, body) =>
      isSync(path, body)
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
