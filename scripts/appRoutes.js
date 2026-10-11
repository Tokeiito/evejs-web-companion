"use strict";

// Every route the BFF's app registers, read off the app itself and not off its source's text.
//
//   const { appRoutes } = require("./appRoutes");   appRoutes() → [{ method: "GET", path: "/api/health" }, ...]
//   node scripts/appRoutes.js                       the same, one to a line
//
// A route can be registered by a list of paths, by a helper, in a loop, or from another file, and the text
// `app.get("…")` of src/server.js has none of those: on 2026-10-11 it had 582 of the app's 614 routes under
// /api/, and POST /api/login was among the 32 it had not.
//
// The app is built in a process of its own, as a test builds one: with stores that answer nothing, a data folder
// of its own among the system's temporary files, and never listened on. The list is in the app's own order,
// which is the order a request is matched in.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** An app's table of routes off its stack: one for each path and each method a registration gave, in order. */
function tableOf(app) {
  const stack = (app && ((app.router && app.router.stack) || (app._router && app._router.stack))) || [];
  const table = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    // (A path that is no text, a pattern, is none a source of the page's can name.)
    for (const each of paths) {
      if (typeof each !== "string") continue;
      for (const method of Object.keys(layer.route.methods || {})) table.push({ method: method.toUpperCase(), path: each });
    }
  }
  return table;
}

/** The BFF's own app's routes. Builds the app in another process, which is gone when this returns. */
function appRoutes() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "app-routes-"));
  try {
    const out = path.join(folder, "routes.json");
    const data = path.join(folder, "data");
    const run = spawnSync(process.execPath, [__filename, "--write", out], {
      encoding: "utf8",
      env: { ...process.env, EVEJS_WEB_POC_DATA_DIR: data, EVEJS_ICON_CACHE_DIR: path.join(data, "icon-cache"), APP_ROUTES_DATA_DIR: data },
    });
    if (run.status !== 0 || !fs.existsSync(out)) {
      throw new Error(`The app's routes could not be listed: ${String(run.stderr || run.stdout || run.error || "").trim().slice(-600)}`);
    }
    return JSON.parse(fs.readFileSync(out, "utf8"));
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const write = process.argv.indexOf("--write");
  if (write < 0) {
    for (const route of appRoutes()) console.log(`${route.method} ${route.path}`);
  } else {
    // The other process: it builds the app, and so only with a data folder that was made for it.
    if (!process.env.APP_ROUTES_DATA_DIR || process.env.EVEJS_WEB_POC_DATA_DIR !== process.env.APP_ROUTES_DATA_DIR) {
      console.error("--write is appRoutes()'s own: it builds the app, and is given a data folder of its own to build it in.");
      process.exit(1);
    }
    fs.mkdirSync(process.env.APP_ROUTES_DATA_DIR, { recursive: true });
    const { createApp } = require("../src/server");
    const nothing = async () => null;
    const app = createApp({
      eveStore: { getAccount: nothing, listCharactersForAccount: async () => [], getCharacterForAccount: nothing },
      eveGatewayClient: new Proxy({}, { get: () => async () => { throw new Error("No gateway is asked for a list of routes."); } }),
      errorLogger() {},
    });
    fs.writeFileSync(process.argv[write + 1], JSON.stringify(tableOf(app)));
    // (The app keeps timers of its own: the process is ended, not left to end.)
    process.exit(0);
  }
}

module.exports = { appRoutes, tableOf };
