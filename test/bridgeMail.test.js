"use strict";

// Goal R17 (Slice A): the BFF mail routes — inbox, one message's body, and
// sending.
//
// ⚠ THE ZLIB RULE IS THE WHOLE POINT OF THIS SUITE. mailMgr.GetBody answers
// zlib.deflateSync(body), which crosses the JSON bridge as
// {type:"Buffer", data:[...]}. If the BFF passed that through, the panel would
// render a wall of byte values. The tests below build a REAL deflated buffer
// (not a stand-in) and assert the route hands the browser plain text — and that
// no compressed byte survives into the response.
//
// The other properties this pins:
//
//   - THE COLD START. The inbox is a DELTA SYNC, not a list call:
//     SyncMail(firstID, lastID) answers only what falls outside the window the
//     caller already holds. The browser caches nothing across a page load, so
//     the route always sends [null, 0] — and a route that invented a window
//     would show a partial mailbox with no error at all.
//   - THE EMPTY-RECIPIENT GUARD. mailState's NO_RECIPIENTS check reads
//     `recipients.length === 0 && !saveSenderCopy`, and the handler hardcodes
//     saveSenderCopy: true — so the server CANNOT refuse mail addressed to
//     nobody; it writes it into the sender's own mailbox and it looks sent.
//     The route refuses it here, because nothing downstream will.
//   - A 200 IS NOT PROOF. Marking read and sending are both re-read, and the
//     response reports the flag the server actually holds.
//   - THE SILENT DECLINE. SendMail answers a bare null on failure with no
//     reason attached; the route says exactly that and invents no cause.
//
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const STATION_ID = 60003760;
const SOLAR_SYSTEM_ID = 30000142;
const CHARACTER_ID = 7;
const ACTIVE_SHIP_ID = 9001;
const OTHER_CHARACTER_ID = 140000009;
const MESSAGE_ID = 4021;

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

function fakeAuth() {
  return {
    createSessionToken() {
      return COOKIE_TOKEN;
    },
    verifySessionToken(token) {
      return token === COOKIE_TOKEN
        ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: SESSION_ID }
        : null;
    },
    countConfiguredUsers() {
      return 1;
    },
  };
}

function fakeStore() {
  return {
    async getAccount(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID && Number(characterID) === CHARACTER_ID
        ? { characterID: CHARACTER_ID, accountID: 4, characterName: "Test Pilot" }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

function fakeStaticData() {
  return {
    getStation() {
      return null;
    },
    getTypeName(id) {
      return `Type ${id}`;
    },
    resolveNames() {
      return { names: {}, capped: false, limit: 500 };
    },
  };
}

// --- marshaled-value builders (the server's own encodings) ------------------

function long(value) {
  return { type: "long", value: String(value) };
}

function list(items) {
  return { type: "list", items };
}

function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

/**
 * A mail HEADER row, in mailMgrService.buildMailHeaderRow's own shape.
 *
 * ⚠ `toCharacterIDs` is a COMMA-JOINED STRING (or null), not a list — the
 * asymmetric counterpart of SendMail's args[0], which is a real list.
 */
function headerRow(overrides = {}) {
  const fields = {
    messageID: MESSAGE_ID,
    senderID: OTHER_CHARACTER_ID,
    toCharacterIDs: String(CHARACTER_ID),
    toListID: null,
    toCorpOrAllianceID: null,
    title: "Docking rights",
    sentDate: long("133000000000000000"),
    ...overrides,
  };
  return keyVal(Object.entries(fields));
}

function statusRow(overrides = {}) {
  const fields = { messageID: MESSAGE_ID, statusMask: 0, labelMask: 1, ...overrides };
  return keyVal(Object.entries(fields));
}

/** A SyncMail answer: the three arms, exactly as buildMailboxPayload emits them. */
function mailbox({ newMail = [], oldMail = [], mailStatus = [] } = {}) {
  return keyVal([
    ["newMail", list(newMail)],
    ["oldMail", list(oldMail)],
    ["mailStatus", list(mailStatus)],
  ]);
}

/**
 * ⚠ A REAL zlib-deflated body, serialized the way a Node Buffer crosses the
 * JSON bridge. Not a stand-in: the route must genuinely inflate this.
 */
function deflatedBody(text) {
  return { type: "Buffer", data: [...zlib.deflateSync(Buffer.from(text, "utf8"))] };
}

const BODY_TEXT = "The convoy leaves at 19:00. Bring the shield extenders.";

function fakeGateway(options = {}) {
  const calls = { topLevel: [] };
  const failures = new Set(options.failures || []);
  // Flipped by a GetBody with shouldMarkAsRead=1, so the re-read reports what
  // the server really holds rather than what the route asked for.
  let read = Boolean(options.startsRead);
  let sendResult = options.sendResult;

  return {
    calls,
    get read() {
      return read;
    },
    async selectCharacter() {
      return {
        bridgeSessionID: BRIDGE_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: {
          userid: 4,
          characterID: CHARACTER_ID,
          characterName: "Test Pilot",
          stationID: STATION_ID,
          structureID: null,
          solarSystemID: SOLAR_SYSTEM_ID,
          corporationID: 98000000,
          shipID: ACTIVE_SHIP_ID,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async readFlightStatus() {
      return {
        flight: {
          docked: true,
          inSpace: false,
          stationID: STATION_ID,
          solarSystemID: SOLAR_SYSTEM_ID,
          shipID: ACTIVE_SHIP_ID,
        },
        notifications: [],
      };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.topLevel.push({ service, method, args, kwargs, bridgeSessionID });
      if (failures.has(`${service}.${method}`)) {
        throw Object.assign(new Error(`${service}.${method} failed`), { code: "CALL_FAILED" });
      }
      if (service === "mailMgr" && method === "SyncMail") {
        return {
          service,
          method,
          result: options.syncResult !== undefined
            ? options.syncResult
            : mailbox({
                newMail: [headerRow()],
                mailStatus: [statusRow({ statusMask: read ? 1 : 0 })],
              }),
          notifications: [],
        };
      }
      if (service === "mailMgr" && method === "GetMailHeaders") {
        return {
          service,
          method,
          result: list((args[0] || []).map((id) => headerRow({ messageID: id, title: "Backfilled" }))),
          notifications: [],
        };
      }
      if (service === "mailMgr" && method === "GetBody") {
        if (Number(args[0]) !== MESSAGE_ID) {
          // GetBody's own answer for a message this character cannot see.
          return { service, method, result: null, notifications: [] };
        }
        if (Number(args[1]) === 1) {
          read = true;
        }
        return {
          service,
          method,
          result: options.bodyResult !== undefined ? options.bodyResult : deflatedBody(BODY_TEXT),
          notifications: [],
        };
      }
      if (service === "mailMgr" && method === "SendMail") {
        return {
          service,
          method,
          result: sendResult === undefined ? MESSAGE_ID : sendResult,
          notifications: [],
        };
      }
      return { service, method, result: null, notifications: [] };
    },
    async bindObject() {
      throw new Error("mail needs no bound objects");
    },
    async callBoundMethod() {
      throw new Error("mail needs no bound objects");
    },
  };
}

async function startTestServer(options = {}) {
  const app = createApp({
    eveStore: options.store || fakeStore(),
    eveGatewayClient: options.gateway,
    webAuth: fakeAuth(),
    staticData: options.staticData || fakeStaticData(),
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}` };
}

async function apiRequest(baseUrl, path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  headers.cookie = `evejs_web_poc=${COOKIE_TOKEN}`;
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await response.json() };
}

async function selectOnServer(baseUrl) {
  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: CHARACTER_ID },
  });
}

test.afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    );
  }
  await Promise.all(closing);
});

// --- the service name, and the cold start -----------------------------------

test("every mail call is on mailMgr — mailingListsMgr is NEVER named", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/mail");

  const services = new Set(gateway.calls.topLevel.map((call) => call.service));
  assert.ok(services.has("mailMgr"), "the mail service is mailMgr");
  assert.equal(
    services.has("mailingListsMgr"),
    false,
    "mailing lists are a separate service and out of slice",
  );
});

test("⚠ GET /api/bridge/mail COLD-STARTS the delta sync with [null, 0]", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail");

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  const sync = gateway.calls.topLevel.find(
    (call) => call.service === "mailMgr" && call.method === "SyncMail",
  );
  assert.ok(sync, "the inbox read must issue SyncMail");
  // ⚠ THE COLD-START PAIR. Any other window silently returns a PARTIAL
  // mailbox — the browser holds nothing across a page load, so it is always
  // cold and must always ask for everything.
  assert.deepEqual(
    sync.args,
    [null, 0],
    "the browser is always cold, so the window must be [null, 0]",
  );
  // No bound-object step anywhere: mail is entirely top-level.
  assert.equal(sync.bridgeSessionID, BRIDGE_SESSION_ID);
});

test("the inbox answers the raw sync arms and an unread count computed here", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/bridge/mail");

  assert.equal(payload.characterID, CHARACTER_ID);
  assert.ok(payload.sync, "the browser gets the RAW sync and decodes it properly");
  // One status row with the read bit clear.
  assert.equal(payload.unreadCount, 1);
});

test("a message that is already read does not count towards unread", async () => {
  const gateway = fakeGateway({ startsRead: true });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/bridge/mail");
  assert.equal(payload.unreadCount, 0);
});

test("an empty mailbox is an empty inbox, not an error", async () => {
  const gateway = fakeGateway({ syncResult: mailbox({}) });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.unreadCount, 0);
});

test("a status row with no header triggers a GetMailHeaders backfill, nested in args[0]", async () => {
  // A status row for a message the sync sent no header for.
  const gateway = fakeGateway({
    syncResult: mailbox({ mailStatus: [statusRow({ messageID: 9100 })] }),
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/bridge/mail");

  const backfill = gateway.calls.topLevel.find(
    (call) => call.service === "mailMgr" && call.method === "GetMailHeaders",
  );
  assert.ok(backfill, "a header-less status row must be backfilled");
  // ⚠ NESTED: args[0] is itself the list of ids. A flat list silently answers
  // nothing.
  assert.deepEqual(backfill.args, [[9100]]);
  assert.ok(payload.backfill, "the backfilled headers reach the browser");
});

test("a cold sync that needs no backfill issues exactly ONE call", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  gateway.calls.topLevel.length = 0;
  await apiRequest(baseUrl, "/api/bridge/mail");

  const mailCalls = gateway.calls.topLevel.filter((call) => call.service === "mailMgr");
  assert.equal(mailCalls.length, 1, "the common case stays a single round-trip");
  assert.equal(mailCalls[0].method, "SyncMail");
});

// --- the zlib body ----------------------------------------------------------

test("⚠ GET /api/bridge/mail/body INFLATES the zlib buffer and answers plain TEXT", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(
    baseUrl,
    `/api/bridge/mail/body?messageID=${MESSAGE_ID}`,
  );

  assert.equal(response.status, 200);
  // ⚠ THE RULE. The browser gets the message, not a wall of byte values.
  assert.equal(payload.body, BODY_TEXT);
  assert.equal(payload.unreadable, false);

  // And NOT ONE compressed byte survives into the response: no {type:"Buffer"}
  // anywhere in the payload.
  assert.equal(
    JSON.stringify(payload).includes('"Buffer"'),
    false,
    "no serialized Buffer may reach the browser — inflation happens here",
  );
});

test("a body that will not inflate is reported unreadable, not rendered as bytes", async () => {
  // Bytes that are not a zlib stream at all.
  const gateway = fakeGateway({ bodyResult: { type: "Buffer", data: [1, 2, 3, 4] } });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(
    baseUrl,
    `/api/bridge/mail/body?messageID=${MESSAGE_ID}`,
  );

  assert.equal(response.status, 200);
  assert.equal(payload.body, null);
  assert.equal(payload.unreadable, true, "a corrupt body says so rather than showing garbage");
});

test("GetBody's null (a message not in this mailbox) is a 404, not an empty message", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  // The fake answers null for any id but MESSAGE_ID — GetBody's own answer for
  // a message the character cannot see.
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail/body?messageID=999");

  assert.equal(response.status, 404);
  assert.equal(payload.error, "MAIL_NOT_FOUND");
});

test("a body request naming no message is refused before it reaches the bridge", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  gateway.calls.topLevel.length = 0;
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail/body?messageID=0");

  assert.equal(response.status, 400);
  assert.equal(payload.error, "MAIL_INVALID");
  assert.deepEqual(gateway.calls.topLevel, [], "a refused request never reaches the gateway");
});

// --- marking read: a 200 is not proof ---------------------------------------

test("markRead=1 passes shouldMarkAsRead and RE-READS to confirm the flag moved", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(
    baseUrl,
    `/api/bridge/mail/body?messageID=${MESSAGE_ID}&markRead=1`,
  );

  const body = gateway.calls.topLevel.find(
    (call) => call.service === "mailMgr" && call.method === "GetBody",
  );
  assert.deepEqual(body.args, [MESSAGE_ID, 1], "shouldMarkAsRead rides args[1] as 1");

  // ⚠ A 200 IS NOT PROOF. `markedRead` comes from a fresh SyncMail, not from
  // the call having succeeded.
  const syncs = gateway.calls.topLevel.filter(
    (call) => call.service === "mailMgr" && call.method === "SyncMail",
  );
  assert.ok(syncs.length >= 1, "the read flag is confirmed by re-reading the mailbox");
  assert.equal(payload.markedRead, true);
  assert.equal(payload.unreadCount, 0, "and the unread count is re-derived from that read");
});

test("markRead absent leaves the message unread — opening a preview is not reading it", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(
    baseUrl,
    `/api/bridge/mail/body?messageID=${MESSAGE_ID}`,
  );

  const body = gateway.calls.topLevel.find(
    (call) => call.service === "mailMgr" && call.method === "GetBody",
  );
  assert.deepEqual(body.args, [MESSAGE_ID, 0]);
  assert.equal(payload.markedRead, false, "confirmed by the re-read, not assumed");
  assert.equal(payload.unreadCount, 1);
});

test("a failed re-read still returns the body, and makes NO claim about the flag", async () => {
  // The body read succeeds; the confirming sync does not.
  let bodyDone = false;
  const gateway = fakeGateway();
  const inner = gateway.callMethod.bind(gateway);
  gateway.callMethod = async (service, method, ...rest) => {
    if (service === "mailMgr" && method === "SyncMail" && bodyDone) {
      throw Object.assign(new Error("sync failed"), { code: "CALL_FAILED" });
    }
    const result = await inner(service, method, ...rest);
    if (service === "mailMgr" && method === "GetBody") {
      bodyDone = true;
    }
    return result;
  };
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(
    baseUrl,
    `/api/bridge/mail/body?messageID=${MESSAGE_ID}&markRead=1`,
  );

  assert.equal(response.status, 200);
  assert.equal(payload.body, BODY_TEXT, "the message is in hand and worth showing");
  assert.equal(
    payload.markedRead,
    null,
    "with no successful re-read, the route makes no claim about the flag",
  );
});

// --- sending ----------------------------------------------------------------

test("⚠ POST /api/bridge/mail/send uses the EXACT seven-argument positional shape", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail/send", {
    method: "POST",
    body: {
      toCharacterIDs: [OTHER_CHARACTER_ID],
      title: "Docking rights",
      body: "Bring the ore to the Jita office.",
    },
  });

  assert.equal(response.status, 200);
  const send = gateway.calls.topLevel.find(
    (call) => call.service === "mailMgr" && call.method === "SendMail",
  );
  // ⚠ POSITIONAL, read by index in Handle_SendMail. args[0] is a LIST; the
  // header reads it back as a comma-joined STRING. toListID (1) and
  // toCorpOrAllianceID (2) are always null — both are out of slice.
  assert.deepEqual(send.args, [
    [OTHER_CHARACTER_ID], // 0 toCharacterIDs — a LIST
    null,                 // 1 toListID
    null,                 // 2 toCorpOrAllianceID
    "Docking rights",     // 3 title
    "Bring the ore to the Jita office.", // 4 body
    null,                 // 5 isReplyTo
    null,                 // 6 isForwardedFrom
  ]);
  assert.equal(payload.messageID, MESSAGE_ID);
});

test("a send is confirmed by RE-READING the sender's own mailbox", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/bridge/mail/send", {
    method: "POST",
    body: { toCharacterIDs: [OTHER_CHARACTER_ID], title: "Hi", body: "there" },
  });

  // ⚠ A 200 IS NOT PROOF. The handler keeps a sender copy, so the message must
  // be visible in the sender's own mailbox if it really landed.
  assert.ok(
    gateway.calls.topLevel.some(
      (call) => call.service === "mailMgr" && call.method === "SyncMail",
    ),
    "the send verdict comes from a re-read",
  );
  assert.equal(payload.applied, true);
  assert.equal(payload.declinedSilently, false);
});

test("⚠ an EMPTY recipient list is refused HERE — the server cannot refuse it", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  gateway.calls.topLevel.length = 0;
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail/send", {
    method: "POST",
    body: { toCharacterIDs: [], title: "Nobody", body: "text" },
  });

  // mailState's NO_RECIPIENTS guard reads `length === 0 && !saveSenderCopy`,
  // and the handler hardcodes saveSenderCopy: true — so through the gateway the
  // guard can NEVER fire, and mail to nobody is written into the sender's own
  // mailbox and looks sent. This route is the only thing standing in the way.
  assert.equal(response.status, 400);
  assert.equal(payload.error, "MAIL_NO_RECIPIENT");
  assert.deepEqual(
    gateway.calls.topLevel,
    [],
    "the refusal must happen before the bridge, or a message gets written",
  );
});

test("a send with no subject is refused before the bridge", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  gateway.calls.topLevel.length = 0;
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail/send", {
    method: "POST",
    body: { toCharacterIDs: [OTHER_CHARACTER_ID], title: "   ", body: "text" },
  });

  assert.equal(response.status, 400);
  assert.equal(payload.error, "MAIL_NO_SUBJECT");
  assert.deepEqual(gateway.calls.topLevel, []);
});

test("⚠ SendMail's bare null is reported as a decline WITHOUT an invented reason", async () => {
  const gateway = fakeGateway({ sendResult: null });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail/send", {
    method: "POST",
    body: { toCharacterIDs: [OTHER_CHARACTER_ID], title: "Hi", body: "there" },
  });

  assert.equal(response.status, 200);
  assert.equal(payload.applied, false);
  assert.equal(payload.declinedSilently, true);
  // The server attached no reason, so neither does this. Saying anything more
  // specific would be invention.
  assert.match(payload.message, /did not say why/);
});

test("duplicate recipients are collapsed rather than mailed twice", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/mail/send", {
    method: "POST",
    body: {
      toCharacterIDs: [OTHER_CHARACTER_ID, OTHER_CHARACTER_ID, 0, -5],
      title: "Hi",
      body: "there",
    },
  });

  const send = gateway.calls.topLevel.find(
    (call) => call.service === "mailMgr" && call.method === "SendMail",
  );
  assert.deepEqual(send.args[0], [OTHER_CHARACTER_ID], "deduplicated, and non-ids dropped");
});

// --- session loss -----------------------------------------------------------

test("every mail route needs a held session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer: nothing is held.
  for (const [path, options] of [
    ["/api/bridge/mail", {}],
    [`/api/bridge/mail/body?messageID=${MESSAGE_ID}`, {}],
    [
      "/api/bridge/mail/send",
      { method: "POST", body: { toCharacterIDs: [OTHER_CHARACTER_ID], title: "a", body: "b" } },
    ],
  ]) {
    const { response } = await apiRequest(baseUrl, path, options);
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
});
