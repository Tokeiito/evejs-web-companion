"use strict";

// ── Server-side bot host ─────────────────────────────────────────────────────
//
// Bots used to run ENTIRELY in the browser tab that started them: the tab
// closes (or a phone locks its screen) and the ship sits. This module runs the
// SAME bot stack — clientStore + appFlow + scriptRunner, imported unchanged
// from web/src via Node's TypeScript type-stripping — inside the BFF process,
// driving the BFF's own HTTP surface over loopback. The browser becomes a
// remote control: start/stop/inspect from any device, and disconnecting
// changes nothing.
//
// Architecturally a server bot is just ANOTHER SESSION (the R107 multibox
// work): its flow holds its own session token, its select lands in the same
// bridgeSessions map as a tab's, and every world call goes through the same
// audited routes. Nothing here talks to the gateway directly.
//
// AUTHENTICATION — no password crosses this module. The bot-start route runs
// under requireAuth, so the caller has already proven they hold the account;
// the host mints a fresh session token for the bot IN-PROCESS (webAuth) and
// seeds it into the flow via `initialSessionToken`. If /api/login ever grows a
// real password check, nothing here breaks.
//
// ONE HULL, ONE DRIVER. Starting a bot on a character any live web session is
// flying is refused (CHARACTER_IN_USE), and while a bot holds a character the
// /api/bridge/select guard refuses tabs (CHARACTER_IN_USE_BY_BOT) — the bot's
// own select passes because its fetch carries `x-evejs-bot-id`. The claim is
// registered synchronously BEFORE the first await so concurrent starts cannot
// both win.
//
// LIFECYCLE. A bot ends when its script finishes, hits an error, loses its
// session, or is stopped; ending always releases the character (logout), so
// the hull is immediately flyable from a tab. Finished records stay listable
// until the next bot starts on that character. Bots do NOT survive a BFF
// restart — the gateway's session TTL reaps their characters.

const crypto = require("crypto");
const path = require("path");
const { pathToFileURL } = require("url");

const BOT_HEADER = "x-evejs-bot-id";

// Terminal customBot-slice statuses: the runner has let go of the ship.
const ENDED_STATUSES = new Set(["stopped", "error", "idle"]);

// The browser stack, imported once per process and shared by every bot. Kept
// lazy so `require("./botHost")` stays cheap and the BFF boots even if the
// web sources are absent (the routes then fail per-start, not at boot).
let stackPromise = null;
function defaultLoadStack() {
  if (stackPromise === null) {
    const webSrc = path.resolve(__dirname, "..", "web", "src");
    const webUrl = (rel) => pathToFileURL(path.join(webSrc, rel)).href;
    stackPromise = (async () => {
      const [sessionToken, clientStore, flow, codec] = await Promise.all([
        import(webUrl("app/sessionToken.ts")),
        import(webUrl("store/clientStore.ts")),
        import(webUrl("app/flow.ts")),
        import(webUrl("bots/scriptCodec.ts")),
      ]);
      // The server has no sessionStorage; force the in-memory fallback. Bots
      // never use the global token anyway (perSessionToken), but the module
      // must not touch a browser API on import of anything else.
      sessionToken.setSessionTokenStorage(null);
      return {
        createClientStore: clientStore.createClientStore,
        createAppFlow: flow.createAppFlow,
        decodeScriptValue: codec.decodeScriptValue,
      };
    })();
    stackPromise.catch(() => {
      stackPromise = null; // a failed load may be retried on the next start
    });
  }
  return stackPromise;
}

// The flow opens a live-event channel after select; a headless bot does not
// need push (every bridge response still carries its notification drain), so
// it gets a channel that is never live.
function stubEventSource() {
  return { close() {}, addEventListener() {}, removeEventListener() {} };
}

function createBotHost(options) {
  const auth = options.webAuth;
  const baseUrl = options.baseUrl;
  // Injected from server.js: is ANY held bridge session flying this character?
  const isCharacterHeld = options.isCharacterHeld || (() => false);
  const logError = options.errorLogger || (() => {});
  const loadStack = options.loadStack || defaultLoadStack;

  /** botID -> record, running and ended alike (ended pruned per character). */
  const records = new Map();
  /** characterID -> botID for RUNNING bots only — the claim the guards read. */
  const claims = new Map();

  function publicBot(record) {
    return {
      botID: record.botID,
      accountID: record.accountID,
      characterID: record.characterID,
      characterName: record.characterName,
      scriptID: record.scriptID,
      scriptName: record.scriptName,
      status: record.status,
      phase: record.phase,
      why: record.why,
      stepPath: record.stepPath,
      pauseReason: record.pauseReason,
      note: record.note,
      startError: record.startError,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    };
  }

  // Fold the store's customBot slice into the record — same words the in-tab
  // readout shows, so the phone and a tab never tell different stories.
  function applySnapshot(record, snapshot) {
    record.status = snapshot.status;
    record.phase = snapshot.phase;
    record.why = snapshot.why;
    record.stepPath = snapshot.stepPath;
    record.pauseReason = snapshot.pauseReason;
    record.note = snapshot.note;
    record.startError = snapshot.startError ?? null;
  }

  // End of a run, from EITHER side (script finished/errored, or stop()):
  // release the claim and the character. Idempotent — the store subscription
  // and an explicit stop can both land here.
  async function finalize(record) {
    if (record.finalized) {
      return;
    }
    record.finalized = true;
    record.endedAt = new Date().toISOString();
    if (record.unsubscribe) {
      try {
        record.unsubscribe();
      } catch {}
      record.unsubscribe = null;
    }
    if (claims.get(record.characterID) === record.botID) {
      claims.delete(record.characterID);
    }
    const flow = record.flow;
    record.flow = null;
    record.store = null;
    if (flow) {
      try {
        flow.stopCustomBot();
      } catch {}
      try {
        // Releases the bridge session — the character goes offline and the
        // hull is immediately available to a tab.
        await flow.logout();
      } catch (error) {
        logError(error);
      }
    }
  }

  async function start({ account, characterID, scriptID, scriptName, doc }) {
    let stack;
    try {
      stack = await loadStack();
    } catch (error) {
      logError(error);
      return { ok: false, code: "BOT_STACK_UNAVAILABLE", message: "The server could not load the bot engine." };
    }

    // A stored bot doc is untrusted bytes like any other; the codec is the door.
    const decoded = stack.decodeScriptValue(doc);
    if (!decoded.ok) {
      return { ok: false, code: "BOTSCRIPT_INVALID", message: decoded.refusal };
    }

    if (claims.has(characterID)) {
      return { ok: false, code: "BOT_ALREADY_RUNNING", message: "A server bot is already flying this character." };
    }
    if (isCharacterHeld(characterID)) {
      return {
        ok: false,
        code: "CHARACTER_IN_USE",
        message: "A web session is flying this character. Log it out (or wait for it to expire), then start the bot.",
      };
    }

    const botID = crypto.randomUUID();
    const record = {
      botID,
      accountID: Number(account.accountID),
      characterID,
      characterName: null,
      scriptID,
      scriptName,
      status: "starting",
      phase: null,
      why: null,
      stepPath: null,
      pauseReason: null,
      note: null,
      startError: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      finalized: false,
      flow: null,
      store: null,
      unsubscribe: null,
    };
    // Claim BEFORE the first await — two concurrent starts must not both win,
    // and the select guard must already know this bot when its select arrives.
    claims.set(characterID, botID);
    // One retained record per character: starting anew drops the old story.
    for (const [id, old] of records) {
      if (old.characterID === characterID && old.finalized) {
        records.delete(id);
      }
    }
    records.set(botID, record);

    try {
      const token = auth.createSessionToken(account);
      const store = stack.createClientStore();
      // Same fetch the server itself trusts, plus the bot's name on every
      // request so the select guard can tell the bot's own select from a tab's.
      const botFetch = (input, init) => {
        const headers = new Headers(init && init.headers);
        headers.set(BOT_HEADER, botID);
        return globalThis.fetch(input, { ...init, headers });
      };
      const flow = stack.createAppFlow(store, {
        baseUrl,
        fetch: botFetch,
        perSessionToken: true,
        initialSessionToken: token,
        eventSource: stubEventSource,
      });
      record.flow = flow;
      record.store = store;

      await flow.selectCharacter(characterID);
      const online = store.station.get().online;
      record.characterName = online ? online.characterName : null;

      // The readout is store-driven exactly like the in-tab panel: project the
      // customBot slice onto the record, and treat the runner letting go of
      // the ship as the end of the bot.
      let sawRunning = false;
      record.unsubscribe = store.subscribe((state) => {
        applySnapshot(record, state.customBot);
        if (state.customBot.status === "running" || state.customBot.status === "paused") {
          sawRunning = true;
        }
        if (sawRunning && ENDED_STATUSES.has(state.customBot.status)) {
          void finalize(record);
        }
      });

      await flow.startCustomBot(decoded.doc);
      applySnapshot(record, store.customBot.get());
      if (record.startError !== null) {
        await finalize(record);
        return { ok: false, code: "BOT_START_FAILED", message: record.startError };
      }
      return { ok: true, bot: publicBot(record) };
    } catch (error) {
      logError(error);
      record.status = "error";
      record.why = error && error.message ? String(error.message) : "The bot could not be started.";
      await finalize(record);
      return { ok: false, code: "BOT_START_FAILED", message: record.why };
    }
  }

  async function stop(botID, accountID) {
    const record = records.get(botID);
    if (!record || record.accountID !== Number(accountID)) {
      return { ok: false, code: "BOT_NOT_FOUND" };
    }
    if (!record.finalized) {
      if (record.flow) {
        try {
          record.flow.stopCustomBot();
        } catch {}
      }
      record.status = "stopped";
      await finalize(record);
    }
    return { ok: true, bot: publicBot(record) };
  }

  function list(accountID) {
    const rows = [];
    for (const record of records.values()) {
      if (record.accountID === Number(accountID)) {
        rows.push(publicBot(record));
      }
    }
    rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return rows;
  }

  /** The RUNNING bot claiming this character, or null — the select guard. */
  function claimedBy(characterID) {
    return claims.get(characterID) || null;
  }

  /** Stop every running bot (server shutdown — best effort). */
  async function stopAll() {
    const running = [...records.values()].filter((record) => !record.finalized);
    await Promise.all(running.map((record) => finalize(record)));
  }

  return { start, stop, list, claimedBy, stopAll, BOT_HEADER };
}

module.exports = { createBotHost, BOT_HEADER };
