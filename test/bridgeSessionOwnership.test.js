"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { spawn } = require("node:child_process");

const previousDataDir = process.env.EVEJS_WEB_POC_DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-session-ownership-"));
process.env.EVEJS_WEB_POC_DATA_DIR = dataDir;
const { createApp, startServer } = require("../src/server");
const { createBridgeSessionJournal } = require("../src/bridgeSessionJournal");
const journalModule = require.resolve("../src/bridgeSessionJournal");

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.EVEJS_WEB_POC_DATA_DIR;
  else process.env.EVEJS_WEB_POC_DATA_DIR = previousDataDir;
});

const held = (bridgeSessionID, accountID, characterID) => ({ bridgeSessionID, accountID, characterID });
function persistedHandles(filePath) {
  const rows = [];
  if (fs.existsSync(filePath)) rows.push(...JSON.parse(fs.readFileSync(filePath, "utf8")).sessions);
  const owners = `${filePath}.owners`;
  if (fs.existsSync(owners)) {
    for (const file of fs.readdirSync(owners).filter((name) => name.endsWith(".json"))) {
      rows.push(...JSON.parse(fs.readFileSync(path.join(owners, file), "utf8")).sessions);
    }
  }
  return rows.map((row) => row.bridgeSessionID).sort();
}

test("two listening BFFs on different ports keep each other's live sessions and journal records", { timeout: 15000 }, async (t) => {
  const released = [];
  const gateway = { async releaseBridgeSession(handle) { released.push(handle); return { released: true }; } };
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });
  async function listen(app) {
    const server = startServer({ app, port: 0, host: "127.0.0.1", silent: true, resumeServerBots: false });
    servers.push(server);
    await once(server, "listening");
    await new Promise((resolve) => setImmediate(resolve));
    return server;
  }
  // No journal override: both instances use config.dataDir's normal path,
  // which is independent of their ports.
  const first = createApp({ eveGatewayClient: gateway });
  const serverA = await listen(first);
  first.locals.bridgeSessions.set("tab-a", held("fake-live-a", 7, 90000001));
  const second = createApp({ eveGatewayClient: gateway });
  const serverB = await listen(second);
  assert.notEqual(serverA.address().port, serverB.address().port);
  assert.equal(serverA.listening, true);
  assert.equal(first.locals.bridgeSessions.has("tab-a"), true);
  assert.deepEqual(released, [], "starting another BFF must not release a live owner's pilot");

  second.locals.bridgeSessions.set("tab-b", held("fake-live-b", 8, 90000002));
  first.locals.bridgeSessions.set("tab-c", held("fake-live-c", 9, 90000003));
  assert.deepEqual(persistedHandles(path.join(dataDir, "bridge-sessions.json")),
    ["fake-live-a", "fake-live-b", "fake-live-c"]);
});

const workerSource = `
  const { createBridgeSessionJournal } = require(process.argv[1]);
  const journal = createBridgeSessionJournal({ filePath: process.argv[2] });
  const sessions = journal.createSessionMap();
  sessions.set("child-a", { bridgeSessionID: "fake-child-a", accountID: 17, characterID: 90000017 });
  process.send({ ready: true, pid: process.pid });
  process.on("message", message => {
    if (message === "exit") process.exit(0);
    if (message === "add") {
      sessions.set("child-b", { bridgeSessionID: "fake-child-b", accountID: 18, characterID: 90000018 });
      process.send({ added: true });
    }
  });
`;

function receive(child) {
  return new Promise((resolve, reject) => {
    const failed = (code) => reject(new Error(`journal worker exited before replying (${code})`));
    child.once("exit", failed);
    child.once("message", (message) => { child.removeListener("exit", failed); resolve(message); });
    child.once("error", reject);
  });
}

test("real child-process ownership is preserved while alive and reclaimed only after exit", { timeout: 15000 }, async (t) => {
  const filePath = path.join(dataDir, "child-owner.json");
  const worker = spawn(process.execPath, ["-e", workerSource, journalModule, filePath],
    { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  let workerError = "";
  worker.stderr.on("data", (chunk) => { workerError += String(chunk); });
  t.after(async () => {
    if (worker.exitCode === null) {
      const exited = once(worker, "exit");
      worker.send("exit");
      await exited;
    }
  });
  const ready = await receive(worker);
  assert.equal(ready.ready, true, workerError);
  assert.notEqual(ready.pid, process.pid);
  assert.doesNotThrow(() => process.kill(ready.pid, 0), "the owner is a real live process");

  const parent = createBridgeSessionJournal({ filePath });
  const sessions = parent.createSessionMap();
  sessions.set("parent-a", held("fake-parent-a", 27, 90000027));
  const added = receive(worker);
  worker.send("add");
  await added;
  sessions.set("parent-b", held("fake-parent-b", 28, 90000028));
  assert.deepEqual(persistedHandles(filePath), ["fake-child-a", "fake-child-b", "fake-parent-a", "fake-parent-b"]);

  const released = [];
  assert.deepEqual(await parent.releaseOrphans(async (handle) => { released.push(handle); return { released: true }; }),
    { released: 0, gone: 0, failed: 0 });
  assert.deepEqual(released, [], "a live child's credentials are not orphans");

  const exited = once(worker, "exit");
  worker.send("exit");
  await exited;
  const recovery = createBridgeSessionJournal({ filePath });
  const recoveryCalls = [];
  const outcome = await recovery.releaseOrphans(async (handle, fields) => { recoveryCalls.push([handle, fields.userid]); return { released: true }; });
  assert.deepEqual(outcome, { released: 2, gone: 0, failed: 0 });
  assert.deepEqual(recoveryCalls.sort(), [["fake-child-a", 17], ["fake-child-b", 18]]);
  assert.deepEqual(persistedHandles(filePath), ["fake-parent-a", "fake-parent-b"]);
  assert.equal(sessions.size, 2, "the live parent's sessions stay owned");
  assert.deepEqual(await createBridgeSessionJournal({ filePath }).releaseOrphans(async () => assert.fail("nothing dead remains")),
    { released: 0, gone: 0, failed: 0 });
});

