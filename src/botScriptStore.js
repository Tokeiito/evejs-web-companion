"use strict";

// D1 — the Bot Builder library store: per-account CRUD over a single
// web-repo-owned JSON file (data/bot-scripts.json), using the same atomic
// tmp+rename write as webAuth.js. This is WEB-APP data — it never touches eve.js's
// gamestore.sqlite or its stale data/*.json, keeping the thin-bridge boundary.
//
// ⚠ VALIDATION HERE IS ENVELOPE-LITE ON PURPOSE. The server is plain JS and
// cannot run the browser's TypeScript codec, so it only guards SIZE, OWNERSHIP,
// and the optimistic revision. The real gate is the browser decoding every doc
// on read (decode-on-read), and only the browser ever executes a script. Keying
// is per ACCOUNT (decision 4) so a player's alts share one library.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILENAME = "bot-scripts.json";
const MAX_SCRIPTS_PER_ACCOUNT = 50;
const MAX_DOC_BYTES = 49152; // 48 KB — the same ceiling the browser codec uses
const MAX_NAME_LEN = 60;

function createBotScriptStore(options) {
  const dataDir = options.dataDir;
  const now = options.now || (() => new Date().toISOString());
  const uuid = options.uuid || (() => crypto.randomUUID());
  const filePath = path.join(dataDir, STORE_FILENAME);

  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed.scripts === "object" && parsed.scripts !== null) {
        return parsed;
      }
      return { scripts: {} };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { scripts: {} };
      }
      throw error;
    }
  }

  function writeAll(data) {
    ensureDir();
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function docBytes(doc) {
    return Buffer.byteLength(JSON.stringify(doc), "utf8");
  }

  function nameOf(doc) {
    if (doc && typeof doc.name === "string" && doc.name.trim().length > 0) {
      return doc.name.trim().slice(0, MAX_NAME_LEN);
    }
    return "Untitled bot";
  }

  function meta(record) {
    return {
      scriptID: record.scriptID,
      name: record.name,
      rev: record.rev,
      updatedAt: record.updatedAt,
      bytes: record.bytes,
    };
  }

  function guardDoc(doc) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw fail("BOTSCRIPT_INVALID", "That is not a bot script.");
    }
    const bytes = docBytes(doc);
    if (bytes > MAX_DOC_BYTES) {
      throw fail("BOTSCRIPT_TOO_BIG", "This script is too big to save.");
    }
    return bytes;
  }

  return {
    /** Metadata for every script this account owns (no docs). */
    list(accountID) {
      const account = Number(accountID);
      const all = readAll();
      return Object.values(all.scripts)
        .filter((record) => record.accountID === account)
        .map(meta);
    },

    /** The full record, or null when it is missing or owned by another account. */
    get(accountID, scriptID) {
      const account = Number(accountID);
      const record = readAll().scripts[String(scriptID)];
      if (!record || record.accountID !== account) {
        return null;
      }
      return record;
    },

    /** Save a new script; returns { scriptID, rev }. Throws on quota or size. */
    create(accountID, doc) {
      const account = Number(accountID);
      const bytes = guardDoc(doc);
      const all = readAll();
      const owned = Object.values(all.scripts).filter((record) => record.accountID === account).length;
      if (owned >= MAX_SCRIPTS_PER_ACCOUNT) {
        throw fail("BOTSCRIPT_LIMIT_REACHED", "You have reached the limit of saved bots.");
      }
      const scriptID = uuid();
      const timestamp = now();
      all.scripts[scriptID] = {
        scriptID,
        accountID: account,
        rev: 1,
        name: nameOf(doc),
        bytes,
        createdAt: timestamp,
        updatedAt: timestamp,
        doc,
      };
      writeAll(all);
      return { scriptID, rev: 1 };
    },

    /** Update in place with optimistic concurrency; returns { rev }. */
    update(accountID, scriptID, doc, baseRev) {
      const account = Number(accountID);
      const bytes = guardDoc(doc);
      const all = readAll();
      const record = all.scripts[String(scriptID)];
      if (!record || record.accountID !== account) {
        throw fail("BOTSCRIPT_NOT_FOUND", "That bot could not be found.");
      }
      if (Number(baseRev) !== record.rev) {
        throw fail(
          "SCRIPT_REV_CONFLICT",
          "This script was changed in another tab. Reload it, or save yours as a copy.",
        );
      }
      record.rev += 1;
      record.name = nameOf(doc);
      record.bytes = bytes;
      record.updatedAt = now();
      record.doc = doc;
      writeAll(all);
      return { rev: record.rev };
    },

    /** Delete a script; true when it existed and this account owned it. */
    remove(accountID, scriptID) {
      const account = Number(accountID);
      const all = readAll();
      const record = all.scripts[String(scriptID)];
      if (!record || record.accountID !== account) {
        return false;
      }
      delete all.scripts[String(scriptID)];
      writeAll(all);
      return true;
    },
  };
}

module.exports = {
  createBotScriptStore,
  MAX_SCRIPTS_PER_ACCOUNT,
  MAX_DOC_BYTES,
  STORE_FILENAME,
};
