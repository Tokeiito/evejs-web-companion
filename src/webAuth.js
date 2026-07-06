"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const USERS_PATH = path.join(config.dataDir, "web-users.json");
const SESSION_SECRET_PATH = path.join(config.dataDir, "session-secret.txt");

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJsonFile(filePath, value) {
  ensureDataDir();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function readUsersFile() {
  const data = readJsonFile(USERS_PATH, { users: {} });
  if (!data.users || typeof data.users !== "object") {
    data.users = {};
  }
  return data;
}

function getSessionSecret() {
  ensureDataDir();
  try {
    const existing = fs.readFileSync(SESSION_SECRET_PATH, "utf8").trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SESSION_SECRET_PATH, generated, "utf8");
  return generated;
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function upsertWebPassword(account, password) {
  if (!account || !account.username || !account.accountID) {
    throw new Error("A valid EveJS account is required.");
  }
  if (String(password || "").length < 6) {
    throw new Error("Web password must be at least 6 characters.");
  }

  const usersFile = readUsersFile();
  const username = normalizeUsername(account.username);
  const existing = usersFile.users[username] || {};
  const passwordHash = hashPassword(password);
  usersFile.users[username] = {
    username,
    eveAccountID: Number(account.accountID),
    password: {
      algorithm: "scrypt",
      salt: passwordHash.salt,
      hash: passwordHash.hash,
    },
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(USERS_PATH, usersFile);
  return usersFile.users[username];
}

function verifyWebPassword(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const usersFile = readUsersFile();
  const record = usersFile.users[normalizedUsername];
  if (!record || !record.password) {
    return { ok: false, reason: "WEB_PASSWORD_NOT_SET" };
  }
  if (record.password.algorithm !== "scrypt") {
    return { ok: false, reason: "UNSUPPORTED_PASSWORD_HASH" };
  }
  const candidate = hashPassword(password, record.password.salt);
  return timingSafeEqualHex(candidate.hash, record.password.hash)
    ? { ok: true, user: record }
    : { ok: false, reason: "INVALID_WEB_PASSWORD" };
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signPayload(encodedPayload) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function createSessionToken(account) {
  const now = Date.now();
  const payload = {
    username: normalizeUsername(account.username),
    accountID: Number(account.accountID),
    iat: now,
    exp: now + config.sessionTtlMs,
  };
  const encodedPayload = base64UrlJson(payload);
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, signature] = parts;
  const expectedSignature = signPayload(encodedPayload);
  if (!timingSafeEqualText(signature, expectedSignature)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || Number(payload.exp || 0) < Date.now()) {
    return null;
  }
  return payload;
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function countConfiguredUsers() {
  return Object.keys(readUsersFile().users).length;
}

module.exports = {
  countConfiguredUsers,
  createSessionToken,
  verifySessionToken,
  verifyWebPassword,
  upsertWebPassword,
  USERS_PATH,
};
