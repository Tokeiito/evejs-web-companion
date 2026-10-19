"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The held bridge sessions, mirrored to disk so a BFF restart can let them go.
//
// ⚠ WHY THIS EXISTS: A RESTART USED TO ORPHAN EVERY PILOT IN THE GAME.
// The gateway keeps a selected character online for as long as its bridge
// session lives, and the only way to end one early is `session/release` with
// its handle. That handle lived only in this process's memory, so a restart
// lost it while the gateway kept the character online as `retail_client` until
// its idle TTL (30 minutes) reaped it. For that half hour a hosted Start
// refuses the pilot ("A web session is flying this character"), because the
// free-only select and the authoritative status probe both see it held, and
// nothing on this side can say which session to end.
//
// ⚠ RELEASED, NOT RESUMED. A held entry is far more than its handle: the push
// stream, Local chat, bound handles and transition state live with it and are
// not reconstructible from disk. So the journal stores only what `release`
// needs, and startup releases every handle the previous process held. That is
// exactly what the TTL would have done half an hour later, and what a retail
// client crash does: the gateway runs the same disconnect path either way.
//
// ⚠ THE HANDLE IS A CREDENTIAL. It must never reach browser JS (see
// docs/bridge-wire-contract.md, R2). The data dir is never served, and the file
// is written owner-only. Best-effort like the bot roster: a failed write is
// logged and never fails the select or release that caused it.
function createBridgeSessionJournal({ filePath = null, logError = (error) => console.error(error) } = {}) {
  // Handles a previous process held and this one has not yet released. Read
  // once, at construction, before any request can rewrite the file.
  const pending = new Map();
  if (filePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const row of Array.isArray(parsed?.sessions) ? parsed.sessions : []) {
        const handle = normalizeRow(row);
        if (handle) pending.set(handle.bridgeSessionID, handle);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") logError(error);
    }
  }
  let live = null;

  function save() {
    if (!filePath) return;
    const sessions = [...pending.values()];
    for (const held of live?.values() || []) {
      const handle = normalizeRow(held);
      if (handle && !pending.has(handle.bridgeSessionID)) sessions.push(handle);
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ version: 1, sessions }, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      logError(error);
    }
  }

  /**
   * The webSessionID -> held map, writing the journal on every set and delete.
   * Held entries are not watched for in-place edits: only the handle, account
   * and character are stored, and none of them changes after the select.
   */
  function createSessionMap() {
    live = new (class PersistedBridgeSessions extends Map {
      set(key, value) { super.set(key, value); save(); return this; }
      delete(key) { const had = super.delete(key); if (had) save(); return had; }
      clear() { super.clear(); save(); }
    })();
    return live;
  }

  /**
   * Release every handle the previous process held. SESSION_NOT_FOUND means the
   * TTL or a takeover got there first, which is just as released. Any other
   * failure keeps the row, so the next start tries again; the TTL remains the
   * backstop either way. Never throws.
   */
  async function releaseOrphans(releaseBridgeSession) {
    const outcome = { released: 0, gone: 0, failed: 0 };
    for (const handle of [...pending.values()]) {
      try {
        await releaseBridgeSession(handle.bridgeSessionID, { userid: handle.accountID });
        outcome.released += 1;
      } catch (error) {
        if (error?.code !== "SESSION_NOT_FOUND") {
          outcome.failed += 1;
          logError(error);
          continue;
        }
        outcome.gone += 1;
      }
      pending.delete(handle.bridgeSessionID);
      save();
    }
    return outcome;
  }

  return { createSessionMap, releaseOrphans };
}

function normalizeRow(row) {
  const bridgeSessionID = typeof row?.bridgeSessionID === "string" ? row.bridgeSessionID : "";
  const accountID = Number(row?.accountID);
  const characterID = Number(row?.characterID);
  if (!bridgeSessionID || !Number.isSafeInteger(accountID) || accountID <= 0) return null;
  return {
    bridgeSessionID,
    accountID,
    characterID: Number.isSafeInteger(characterID) && characterID > 0 ? characterID : null,
  };
}

module.exports = { createBridgeSessionJournal };
