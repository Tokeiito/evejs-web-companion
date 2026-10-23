"use strict";

// A BFF restart must let go of the pilots the previous process held BEFORE the
// bot roster resumes. Until then the gateway still has every one of them online
// as `retail_client`, and a resumed bot is refused its own hull.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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

for (const fails of [false, true]) {
  test(`closing during startup cleanup prevents bot resume when cleanup ${fails ? "fails" : "succeeds"}`, async () => {
    let settle;
    let isCurrent;
    let resumes = 0;
    let shutdowns = 0;
    const app = Object.assign((req, res) => res.end(), {
      locals: {
        botScripts: { seedStarterBots() {} },
        releaseOrphanedBridgeSessions: (current) => {
          isCurrent = current;
          return new Promise((resolve, reject) => {
            settle = () => fails ? reject(new Error("cleanup unavailable")) : resolve({ released: 0, gone: 0, failed: 0 });
          });
        },
        botHost: { resume: async () => { resumes += 1; } },
        gamePortPilots: { shutdown: () => { shutdowns += 1; } },
      },
    });
    const server = startServer({ app, port: 0, host: "127.0.0.1", silent: true });
    await new Promise((resolve) => server.once("listening", resolve));
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (isCurrent) assert.equal(isCurrent(), false, "cleanup stops as soon as closing starts");
    await closed;
    settle();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(shutdowns, 1);
    assert.equal(resumes, 0, "late cleanup cannot restart pilots after shutdown");
  });
}

test("the app's release reaches the gateway with each held handle and its owner", async (t) => {
  const journalPath = path.join(temporaryDataDir, "restart-journal.json");
  execFileSync(process.execPath, ["-e", `
    const { createBridgeSessionJournal } = require(process.argv[1]);
    createBridgeSessionJournal({ filePath: process.argv[2] }).createSessionMap().set("old-tab",
      { bridgeSessionID: "bridge-left-behind", accountID: 7, characterID: 90000001 });
  `, require.resolve("../src/bridgeSessionJournal"), journalPath], { windowsHide: true });
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
  const remaining = fs.readdirSync(`${journalPath}.owners`).filter((file) => file.endsWith(".json"))
    .flatMap((file) => JSON.parse(fs.readFileSync(path.join(`${journalPath}.owners`, file), "utf8")).sessions);
  assert.deepEqual(remaining, []);
});
