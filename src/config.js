"use strict";

const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const defaultEveRoot = path.resolve(repoRoot, "..", "eve.js");
const eveRoot = path.resolve(process.env.EVEJS_ROOT || defaultEveRoot);
const dataDir = path.resolve(process.env.EVEJS_WEB_POC_DATA_DIR || path.join(repoRoot, "data"));

module.exports = {
  repoRoot,
  dataDir,
  iconCacheDir: path.resolve(process.env.EVEJS_ICON_CACHE_DIR || path.join(dataDir, "icon-cache")),
  iconCacheUrlPath: "/icon-cache",
  eveRoot,
  gamestorePath: path.resolve(
    process.env.EVEJS_GAMESTORE_DB ||
      path.join(eveRoot, "_local", "gameStore", "gamestore.sqlite"),
  ),
  host: process.env.HOST || "127.0.0.1",
  port: Number.parseInt(process.env.PORT || "26500", 10) || 26500,
  sessionCookieName: "evejs_web_poc",
  sessionTtlMs: 12 * 60 * 60 * 1000,
};
