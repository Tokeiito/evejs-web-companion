"use strict";

// Six of the page's routes that no test of the BFF's asked, by the game-port audit's own list of 2026-10-12:
//
//   GET  /api/botscripts/:scriptID            GET  /api/icons/status
//   POST /api/botscripts/:scriptID/delete     POST /api/icons/settings
//   GET  /api/pilot-training/ownership        POST /api/icons/cache
//
// None makes a call of the game's for a pilot. Five answer from the BFF's own keeping (the bot library, the
// icons' setting and its puller); the ownership asks the server's status of one character and adds what this BFF
// holds of it. What can go wrong between the page and the BFF is the wire itself, and neither side's own tests
// would see it: the page's tests answer themselves, and the BFF had none. So each is asked here BY THE PAGE'S
// OWN ASKER (web/src/app/api.ts, web/src/app/iconCache.ts) of the BFF's own route.
//
// ⚠ THE ICONS' PULLER IS NEVER STARTED HERE. The route spawns scripts/cache-icons.js, which reads the store and
// fetches from a CDN. `child_process.spawn` is stood in for BEFORE the server is loaded, so the route's own
// `spawn` is the stand-in whatever becomes of the route: a child that is told what to say, and nothing else.
// The data folder is a temporary one for the same reason: the setting is kept in a file there.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { EventEmitter, once } = require("events");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-own-keeping-"));
process.env.EVEJS_WEB_POC_DATA_DIR = DATA;

/** Every child the BFF started, and a fault to start one with, if any. */
const spawned = [];
let spawnFault = null;
childProcess.spawn = (command, args, options) => {
  if (spawnFault) throw spawnFault;
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  spawned.push({ command, args, cwd: options && options.cwd, child });
  return child;
};

const { createApp } = require("../src/server");
const { createBotScriptStore } = require("../src/botScriptStore");

const TOKEN = "raw-signed-login-token";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const REPO = path.resolve(__dirname, "..");
const ICONS = path.join(DATA, "icon-cache");
const SETTING = path.join(DATA, "icon-settings.json");
const realFetch = globalThis.fetch;
const activeServers = new Set();

const doc = (name) => ({ format: "evejs-bot-script", version: 1, name, program: [] });

/**
 * The BFF on a server with nothing kept yet, the page's own askers, and what the BFF and the server were asked.
 * `keep` leaves what an app before this one kept in the data folder.
 */
async function page({ statuses = {}, keep = false } = {}) {
  if (!keep) {
    fs.rmSync(ICONS, { recursive: true, force: true });
    fs.rmSync(SETTING, { force: true });
  }
  spawned.length = 0;
  spawnFault = null;
  const asked = [];
  const library = createBotScriptStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-own-keeping-bots-")) });
  const app = createApp({
    eveStore: {
      async getAccount(username) { return username === ACCOUNT.username ? { ...ACCOUNT } : null; },
      async listCharactersForAccount(accountID) {
        asked.push(["pilots of", accountID]);
        return [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }, { characterID: 8, accountID: 4, characterName: "Test Two" },
          { characterID: 9, accountID: 4, characterName: "Test Three" }];
      },
      async getCharacterForAccount() { return null; },
    },
    eveGatewayClient: {
      async getCharacterStatus(accountID, characterID) {
        asked.push(["status", accountID, characterID]);
        return statuses[characterID];
      },
    },
    webAuth: {
      createSessionToken() { return TOKEN; },
      verifySessionToken(token) { return token === TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: "signed-session" } : null; },
      countConfiguredUsers() { return 1; },
    },
    botScriptStore: library,
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = await import("../web/src/app/api.ts");
  const icons = await import("../web/src/app/iconCache.ts");
  const tab = await import("../web/src/app/sessionToken.ts");
  // The page's own request, as it makes one with a session's token: what it asked and what it was answered are
  // kept, and it is sent on.
  const paths = [];
  const answers = [];
  const options = {
    baseUrl,
    token: TOKEN,
    fetch: async (input, init) => {
      paths.push(`${(init && init.method) || "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "")}`);
      const response = await realFetch(input, init);
      answers.push(await response.clone().json().catch(() => null));
      return response;
    },
  };
  // The icons' askers use the tab's own fetch and the tab's own token: a path with no origin, as a browser
  // takes one, is sent to the BFF, and what was sent is kept.
  const sent = [];
  tab.setSessionTokenStorage(null);
  tab.setSessionToken(TOKEN);
  globalThis.fetch = (input, init = {}) => {
    sent.push({ path: `${init.method || "GET"} ${input}`, authorization: (init.headers || {}).authorization, body: init.body });
    return realFetch(`${baseUrl}${input}`, init);
  };
  return { app, api, icons, tab, options, asked, paths, answers, sent, library };
}

test.afterEach(async () => {
  globalThis.fetch = realFetch;
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    server.closeAllConnections();
    closing.push(new Promise((resolve) => { server.close(() => resolve()); }));
  }
  await Promise.all(closing);
});

test("one bot of the library: the page asks by the script's own id, and reads its id, revision, author, category and doc; an id the library has not is null", async () => {
  const { api, options, paths, library } = await page();
  const { categoryID } = library.createCategory("Mining");
  const loose = await api.createBotScript(doc("Loose"), options);
  const filed = await api.createBotScript(doc("Filed"), options, categoryID);
  paths.length = 0;

  assert.deepEqual(await api.getBotScript(loose.scriptID, options),
    { scriptID: loose.scriptID, rev: 1, authorAccountID: 4, authorName: "pilot", categoryID: null, doc: doc("Loose") });
  assert.deepEqual(await api.getBotScript(filed.scriptID, options),
    { scriptID: filed.scriptID, rev: 1, authorAccountID: 4, authorName: "pilot", categoryID, doc: doc("Filed") });
  // A revision the library has made is the one read.
  await api.updateBotScript(loose.scriptID, doc("Loose, again"), 1, options);
  assert.deepEqual(await api.getBotScript(loose.scriptID, options),
    { scriptID: loose.scriptID, rev: 2, authorAccountID: 4, authorName: "pilot", categoryID: null, doc: doc("Loose, again") });
  // What the library has not is null to the page, and no fault: the id goes in the path, made safe for one.
  assert.equal(await api.getBotScript("no such/one", options), null);
  assert.deepEqual(paths, [
    `GET /api/botscripts/${loose.scriptID}`, `GET /api/botscripts/${filed.scriptID}`,
    `POST /api/botscripts/${loose.scriptID}`, `GET /api/botscripts/${loose.scriptID}`,
    "GET /api/botscripts/no%20such%2Fone",
  ]);
});

test("one bot of the library: what the route answers besides what the page reads, and its refusal by name", async () => {
  const { api, options, answers, library } = await page();
  const made = await api.createBotScript(doc("Miner"), options);
  answers.length = 0;
  await api.getBotScript(made.scriptID, options);
  await api.getBotScript("nobody", options);
  assert.deepEqual(answers[0], { ok: true, scriptID: made.scriptID, authorAccountID: 4, authorName: "pilot", rev: 1, name: "Miner",
    updatedAt: library.get(made.scriptID).updatedAt, categoryID: null, doc: doc("Miner") });
  assert.deepEqual(answers[1], { ok: false, error: "BOTSCRIPT_NOT_FOUND", message: "That bot could not be found." });
});

test("a bot deleted: the page posts to the script's own path, and the library has it no more; an id the library has not is answered, and nothing is removed", async () => {
  const { api, options, paths, answers, library } = await page();
  const first = await api.createBotScript(doc("First"), options);
  const second = await api.createBotScript(doc("Second"), options);
  paths.length = 0;
  answers.length = 0;

  assert.equal(await api.deleteBotScript(first.scriptID, options), undefined);
  assert.deepEqual((await api.listBotScripts(options)).map((row) => row.scriptID), [second.scriptID]);
  assert.equal(await api.getBotScript(first.scriptID, options), null);
  assert.equal(library.get(first.scriptID), null);
  assert.deepEqual(library.get(second.scriptID).doc, doc("Second"));
  // Deleted again, or never there: the page is answered, and told nothing was removed.
  assert.equal(await api.deleteBotScript(first.scriptID, options), undefined);
  assert.equal(await api.deleteBotScript("no such/one", options), undefined);
  assert.deepEqual((await api.listBotScripts(options)).map((row) => row.scriptID), [second.scriptID]);

  assert.deepEqual(paths, [
    `POST /api/botscripts/${first.scriptID}/delete`, "GET /api/botscripts", `GET /api/botscripts/${first.scriptID}`,
    `POST /api/botscripts/${first.scriptID}/delete`, "POST /api/botscripts/no%20such%2Fone/delete", "GET /api/botscripts",
  ]);
  assert.deepEqual([answers[0], answers[3], answers[4]], [{ ok: true, removed: true }, { ok: true, removed: false }, { ok: true, removed: false }]);
});

test("who has a pilot: the page asks by characterID, and reads whose it is and whether it is online", async () => {
  const statuses = {
    7: { characterID: 7, online: false, controlState: "offline" },
    8: { characterID: 8, online: true, controlState: "retail_client" },
    9: { characterID: 9, online: false, controlState: "retail_client" },
  };
  const { app, api, options, asked, paths } = await page({ statuses });
  // Nobody has it, and the server has it offline; another session has it, by the server's word.
  assert.deepEqual(await api.factoryOwnership(7, options), { characterID: 7, owner: "OFF", online: false });
  assert.deepEqual(await api.factoryOwnership(8, options), { characterID: 8, owner: "OTHER_SESSION", online: true });
  // Not online and not let go of either: another session's still. Nobody has it only when the server says both.
  assert.deepEqual(await api.factoryOwnership(9, options), { characterID: 9, owner: "OTHER_SESSION", online: false });
  assert.deepEqual(paths, ["GET /api/pilot-training/ownership?characterID=7", "GET /api/pilot-training/ownership?characterID=8",
    "GET /api/pilot-training/ownership?characterID=9"]);
  assert.deepEqual(asked, [["pilots of", 4], ["status", 4, 7], ["pilots of", 4], ["status", 4, 8], ["pilots of", 4], ["status", 4, 9]]);
  statuses[9] = { characterID: 9, online: true, controlState: "offline" };
  assert.deepEqual(await api.factoryOwnership(9, options), { characterID: 9, owner: "OTHER_SESSION", online: true });

  // A tab of this BFF holds it: the browser's, whatever the server says of its being online.
  app.locals.bridgeSessions.set("another tab", { characterID: 8 });
  assert.deepEqual(await api.factoryOwnership(8, options), { characterID: 8, owner: "BROWSER", online: true });
  assert.deepEqual(await api.factoryOwnership(7, options), { characterID: 7, owner: "OFF", online: false });
  // A bot of this BFF runs it: the bot's, before the browser's.
  const claimedBy = app.locals.botHost.claimedBy;
  app.locals.botHost.claimedBy = (characterID) => (characterID === 8 ? "bot-1" : claimedBy(characterID));
  assert.deepEqual(await api.factoryOwnership(8, options), { characterID: 8, owner: "BOT", online: true });
  app.locals.bridgeSessions.delete("another tab");
  assert.deepEqual(await api.factoryOwnership(8, options), { characterID: 8, owner: "BOT", online: true });
});

test("who has a pilot: one that is not the account's is not found, and the server is not asked; a status that cannot be read is refused", async () => {
  const { api, options, asked } = await page({ statuses: {
    7: { characterID: 8, online: false, controlState: "offline" },
    8: { characterID: 8, controlState: "offline" },
  } });
  await assert.rejects(api.factoryOwnership(99, options), (error) => error.status === 404 && error.code === "CHARACTER_NOT_FOUND");
  assert.deepEqual(asked, [["pilots of", 4]]);
  // Another character's status, and one that does not say whether it is online.
  await assert.rejects(api.factoryOwnership(7, options), (error) => error.status === 409 && error.code === "CHARACTER_CONTROL_UNAVAILABLE");
  await assert.rejects(api.factoryOwnership(8, options), (error) => error.status === 409 && error.code === "CHARACTER_CONTROL_UNAVAILABLE");
});

test("the icons the BFF has: the page reads how many, the setting, and what a pull is doing, with the tab's own token", async () => {
  const { icons, tab, sent } = await page();
  fs.mkdirSync(path.join(ICONS, "types", "64", "icon"), { recursive: true });
  fs.mkdirSync(path.join(ICONS, "types", "64", "bp"), { recursive: true });
  fs.writeFileSync(path.join(ICONS, "types", "64", "icon", "587.png"), "an icon");
  fs.writeFileSync(path.join(ICONS, "types", "64", "bp", "691.png"), "a blueprint's");
  fs.writeFileSync(path.join(ICONS, "types", "64", "icon", "notes.txt"), "not one");

  assert.deepEqual(await icons.fetchIconStatus(), { cachedCount: 2, autoDownload: false, running: false, source: null, progress: "", lastResult: null });
  assert.deepEqual(sent, [{ path: "GET /api/icons/status", authorization: `Bearer ${TOKEN}`, body: undefined }]);
  // Signed out, the tab has no token to send, and the BFF answers nobody.
  tab.setSessionToken(null);
  await assert.rejects(icons.fetchIconStatus(), /HTTP 401/);
});

test("the icons' setting: the page posts autoDownload and reads it back; the BFF keeps it in its data folder, and has it still when it starts again", async () => {
  const { icons, sent } = await page();
  assert.equal(await icons.setIconAutoDownload(true), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(SETTING, "utf8")), { autoDownload: true });
  assert.equal((await icons.fetchIconStatus()).autoDownload, true);
  assert.deepEqual(sent[0], { path: "POST /api/icons/settings", authorization: `Bearer ${TOKEN}`, body: "{\"autoDownload\":true}" });

  // Another BFF on the same data folder: the setting is the one that was kept.
  const again = await page({ keep: true });
  assert.equal((await again.icons.fetchIconStatus()).autoDownload, true);
  assert.equal(await again.icons.setIconAutoDownload(false), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(SETTING, "utf8")), { autoDownload: false });
  assert.equal((await again.icons.fetchIconStatus()).autoDownload, false);
  assert.equal(again.sent[1].body, "{\"autoDownload\":false}");
});

test("an icon pull: the page posts the source, the BFF starts its puller for it and says what it is doing and what came of it; a second while one runs is refused", async () => {
  const { icons, sent } = await page();
  assert.equal(await icons.startIconPull("gamestore"), undefined);
  assert.deepEqual(sent[0], { path: "POST /api/icons/cache", authorization: `Bearer ${TOKEN}`, body: "{\"source\":\"gamestore\"}" });
  assert.equal(spawned.length, 1);
  assert.deepEqual([spawned[0].command, spawned[0].args, spawned[0].cwd],
    [process.execPath, ["scripts/cache-icons.js", "--source", "gamestore", "--delay-ms", "50"], REPO]);
  assert.deepEqual(await icons.fetchIconStatus(), { cachedCount: 0, autoDownload: false, running: true, source: "gamestore", progress: "Starting…", lastResult: null });

  // What the puller says last is what it is doing, on either of its two streams.
  spawned[0].child.stdout.emit("data", Buffer.from("120 of 400\n  \n 121 of 400 \n"));
  assert.equal((await icons.fetchIconStatus()).progress, "121 of 400");
  spawned[0].child.stderr.emit("data", Buffer.from("a type with no icon\n"));
  assert.equal((await icons.fetchIconStatus()).progress, "a type with no icon");
  spawned[0].child.stdout.emit("data", Buffer.from("\n \n"));
  assert.equal((await icons.fetchIconStatus()).progress, "a type with no icon");

  // One at a time: the page is told why, and no second puller is started.
  await assert.rejects(icons.startIconPull("all-types"), /An icon pull is already running\./);
  assert.equal(spawned.length, 1);

  spawned[0].child.emit("close", 0);
  assert.deepEqual(await icons.fetchIconStatus(), { cachedCount: 0, autoDownload: false, running: false, source: "gamestore", progress: "a type with no icon", lastResult: "Done." });

  // The other source, once the first is done; and what a puller that ends badly leaves said.
  await icons.startIconPull("all-types");
  assert.deepEqual(spawned[1].args, ["scripts/cache-icons.js", "--source", "all-types", "--delay-ms", "50"]);
  assert.deepEqual(await icons.fetchIconStatus(), { cachedCount: 0, autoDownload: false, running: true, source: "all-types", progress: "Starting…", lastResult: null });
  spawned[1].child.emit("close", 3);
  assert.deepEqual([(await icons.fetchIconStatus()).running, (await icons.fetchIconStatus()).lastResult], [false, "Exited with code 3."]);
  await icons.startIconPull("gamestore");
  spawned[2].child.emit("error", new Error("no such program"));
  assert.deepEqual([(await icons.fetchIconStatus()).running, (await icons.fetchIconStatus()).lastResult], [false, "Error: no such program"]);
});

test("an icon pull: a source that is neither of the two is refused, and a puller that cannot be started is said, and nothing is running after either", async () => {
  const { icons } = await page();
  await assert.rejects(icons.startIconPull("everything"), /source must be 'gamestore' or 'all-types'\./);
  assert.equal(spawned.length, 0);
  spawnFault = new Error("spawn node ENOENT");
  await assert.rejects(icons.startIconPull("gamestore"), /spawn node ENOENT/);
  assert.equal((await icons.fetchIconStatus()).running, false);
  // And it can be started after.
  spawnFault = null;
  await icons.startIconPull("gamestore");
  assert.equal(spawned.length, 1);
  assert.equal((await icons.fetchIconStatus()).running, true);
});
