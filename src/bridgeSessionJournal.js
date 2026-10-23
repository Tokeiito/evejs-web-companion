"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

// Each BFF owns a separate recovery file. A second live BFF must neither
// overwrite those handles nor disconnect their pilots. Only a local process
// that is provably gone (ESRCH) may have its file reaped. Foreign hosts, reused
// PIDs, invalid metadata and the unattributed v1 journal stay untouched; the
// gateway's session TTL remains their backstop.
//
// A handle is a credential: files are private and never served. Persistence
// is best effort; a failed save retains the in-memory obligation for a later
// flush. A crash before that flush can still leave the gateway TTL responsible.
function createBridgeSessionJournal({
  filePath = null,
  logError = (error) => console.error(error),
  owner = { id: randomUUID(), pid: process.pid, hostname: os.hostname() },
  isOwnerDead = localProcessIsDead,
} = {}) {
  owner = normalizeOwner(owner);
  if (!owner) throw new TypeError("A bridge journal owner needs an id, process id and hostname.");
  const ownerDir = filePath ? `${filePath}.owners` : null;
  const hostname = owner.hostname.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
  const ownerFile = ownerDir ? path.join(ownerDir, `${hostname}-${owner.pid}-${owner.id}.json`) : null;
  const outstanding = new Map();

  /** Atomic replacement of one owner's file; other owners' files never participate. */
  function save(file, document) {
    if (!file) return true;
    let staging = null;
    try {
      if (document.sessions.length === 0) {
        fs.rmSync(file, { force: true });
        return true;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      staging = `${file}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(staging, JSON.stringify(document, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(staging, file);
      return true;
    } catch (error) {
      logError(error);
      return false;
    } finally {
      if (staging) {
        try { fs.rmSync(staging, { force: true }); } catch { /* the main recovery file is still authoritative */ }
      }
    }
  }

  const saveOwn = () => save(ownerFile, { version: 2, owner, sessions: [...outstanding.values()] });

  /** Keep this release obligation even if the session is detached from its live map. */
  function track(row) {
    const handle = normalizeRow(row);
    if (!handle) return false;
    outstanding.set(handle.bridgeSessionID, handle);
    return saveOwn();
  }

  /** Only a confirmed release (or SESSION_NOT_FOUND) permits forgetting a handle. */
  function confirmReleased(bridgeSessionID) {
    if (!outstanding.delete(bridgeSessionID)) return false;
    return saveOwn();
  }

  function createSessionMap() {
    return new (class PersistedBridgeSessions extends Map {
      set(key, value) { super.set(key, value); track(value); return this; }
      // Local detachment is not proof that the gateway let go. The transport's
      // explicit release acknowledgement settles the separate obligation.
    })();
  }

  function read(file) {
    try {
      const document = JSON.parse(fs.readFileSync(file, "utf8"));
      const fileOwner = normalizeOwner(document?.owner);
      if (document?.version !== 2 || !fileOwner || !Array.isArray(document.sessions)) {
        throw new Error("Unrecognized bridge session recovery file; preserving it.");
      }
      const sessions = document.sessions.map(normalizeRow);
      if (sessions.some((row) => row === null)) throw new Error("Invalid bridge session recovery row; preserving its file.");
      return { version: 2, owner: fileOwner, sessions };
    } catch (error) {
      if (error?.code !== "ENOENT") logError(error);
      return null;
    }
  }

  function dead(fileOwner) {
    // Even an injected liveness check must not authorize reaping the actual
    // current process, another host, or this journal's own owner.
    if (fileOwner.hostname !== os.hostname() || fileOwner.pid === process.pid || fileOwner.id === owner.id) return false;
    try { return isOwnerDead(fileOwner) === true; }
    catch (error) { logError(error); return false; }
  }

  function forgetConfirmed(file, expectedOwner, handle) {
    // Another reaper may already have removed a confirmed row. Re-read before
    // replacing its dead owner's file; never recreate a removed file or carry
    // a stale whole-directory snapshot into another owner's records.
    const current = read(file);
    if (!current || current.owner.id !== expectedOwner.id || current.owner.pid !== expectedOwner.pid ||
      current.owner.hostname !== expectedOwner.hostname) return;
    const sessions = current.sessions.filter((row) => row.bridgeSessionID !== handle.bridgeSessionID || row.accountID !== handle.accountID);
    if (sessions.length !== current.sessions.length) save(file, { ...current, sessions });
  }

  /** Release only sessions whose owner process is proven dead. Never retries a live owner's handles. */
  async function releaseOrphans(releaseBridgeSession, { shouldContinue = () => true } = {}) {
    const outcome = { released: 0, gone: 0, failed: 0 };
    if (!ownerDir) return outcome;
    let files;
    try { files = fs.readdirSync(ownerDir).filter((name) => name.endsWith(".json")); }
    catch (error) {
      if (error?.code !== "ENOENT") logError(error);
      return outcome;
    }
    for (const name of files) {
      if (!shouldContinue()) break;
      const file = path.join(ownerDir, name);
      const document = read(file);
      if (!document || !dead(document.owner)) continue;
      for (const handle of document.sessions) {
        if (!shouldContinue()) return outcome;
        try {
          const answer = await releaseBridgeSession(handle.bridgeSessionID, { userid: handle.accountID });
          if (answer?.released !== true) throw Object.assign(new Error("Orphan session release was not confirmed."), { code: "PILOT_RELEASE_UNVERIFIED" });
          outcome.released += 1;
        } catch (error) {
          if (error?.code !== "SESSION_NOT_FOUND") {
            outcome.failed += 1;
            logError(error);
            continue;
          }
          outcome.gone += 1;
        }
        // A close during an in-flight release stops the next dispatch, but its
        // already-confirmed result is still recorded safely.
        forgetConfirmed(file, document.owner, handle);
      }
    }
    return outcome;
  }

  return { track, confirmReleased, createSessionMap, releaseOrphans };
}

function normalizeOwner(owner) {
  if (!owner || typeof owner.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(owner.id) ||
    !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.hostname !== "string" || !owner.hostname) return null;
  return { id: owner.id, pid: owner.pid, hostname: owner.hostname };
}

function localProcessIsDead(owner) {
  if (owner.hostname !== os.hostname() || owner.pid === process.pid) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error?.code === "ESRCH"; }
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
