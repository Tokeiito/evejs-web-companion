"use strict";

// A BFF restart must let go of the pilots the previous process held BEFORE the
// bot roster resumes. Until then the gateway still has every one of them online
// as `retail_client`, and a resumed bot is refused its own hull.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const originalDataDir = process.env.EVEJS_WEB_POC_DATA_DIR;
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-bridge-restart-"));
process.env.EVEJS_WEB_POC_DATA_DIR = temporaryDataDir;

const { createApp, startServer } = require("../src/server");

test.after(() => {
  fs.rmSync(temporaryDataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.EVEJS_WEB_POC_DATA_DIR;
  else process.env.EVEJS_WEB_POC_DATA_DIR = originalDataDir;
});

test("startServer releases the previous sessions, then resumes bots", async (t) => {
  const order = [];
  let finishRelease;
  const app = Object.assign((req, res) => res.end(), {
    locals: {
      botScripts: { seedStarterBots() {} },
      releaseOrphanedBridgeSessions: () => new Promise((resolve) => {
        order.push("release-start");
        finishRelease = () => { order.push("release-end"); resolve({ released: 1, gone: 0, failed: 0 }); };
      }),
      botHost: { resume: async () => { order.push("resume"); } },
    },
  });
  const server = startServer({ app, port: 0, host: "127.0.0.1", silent: true });
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["release-start"], "the roster waits for the release");
  finishRelease();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["release-start", "release-end", "resume"]);
});

test("the app's release reaches the gateway with each held handle and its owner", async (t) => {
  const journalPath = path.join(temporaryDataDir, "restart-journal.json");
  t.after(() => fs.rmSync(journalPath, { force: true }));
  fs.writeFileSync(journalPath, JSON.stringify({ version: 1, sessions: [
    { bridgeSessionID: "bridge-left-behind", accountID: 7, characterID: 90000001 },
  ] }));
  const released = [];
  const app = createApp({
    bridgeSessionJournalPath: journalPath,
    eveGatewayClient: {
      async releaseBridgeSession(bridgeSessionID, fields) {
        released.push([bridgeSessionID, fields.userid]);
        return { ok: true, released: true, characterID: 90000001 };
      },
    },
  });
  assert.deepEqual(await app.locals.releaseOrphanedBridgeSessions(), { released: 1, gone: 0, failed: 0 });
  assert.deepEqual(released, [["bridge-left-behind", 7]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(journalPath, "utf8")).sessions, []);
});
