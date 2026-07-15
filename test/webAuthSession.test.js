"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const originalDataDir = process.env.EVEJS_WEB_POC_DATA_DIR;
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-auth-"));
process.env.EVEJS_WEB_POC_DATA_DIR = temporaryDataDir;

const webAuth = require("../src/webAuth");

test.after(() => {
  if (originalDataDir === undefined) {
    delete process.env.EVEJS_WEB_POC_DATA_DIR;
  } else {
    process.env.EVEJS_WEB_POC_DATA_DIR = originalDataDir;
  }
  fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

test("signed web sessions contain independent cryptorandom session IDs", () => {
  const account = { username: "pilot", accountID: 42 };
  const firstToken = webAuth.createSessionToken(account);
  const secondToken = webAuth.createSessionToken(account);
  const first = webAuth.verifySessionToken(firstToken);
  const second = webAuth.verifySessionToken(secondToken);

  assert.equal(first.username, "pilot");
  assert.equal(first.accountID, 42);
  assert.match(first.sessionID, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second.sessionID, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.sessionID, second.sessionID);
});

test("the server rejects a session ID changed without a valid signature", () => {
  const token = webAuth.createSessionToken({ username: "pilot", accountID: 42 });
  const [encodedPayload, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  payload.sessionID = "attacker-controlled-session-id-000000000000";
  const changedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

  assert.equal(webAuth.verifySessionToken(`${changedPayload}.${signature}`), null);
});
