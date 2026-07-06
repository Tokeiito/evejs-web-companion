"use strict";

const path = require("path");
const config = require("./config");

let queueRuntime = null;
let gameStore = null;

function loadEveSkillQueueRuntime() {
  if (queueRuntime) {
    return queueRuntime;
  }

  process.env.EVEJS_GAMESTORE_DATA_DIR =
    process.env.EVEJS_GAMESTORE_DATA_DIR ||
    path.join(config.eveRoot, "_local", "gameStore", "data");

  queueRuntime = require(path.join(
    config.eveRoot,
    "server",
    "src",
    "services",
    "skills",
    "training",
    "skillQueueRuntime",
  ));
  gameStore = require(path.join(config.eveRoot, "server", "src", "gameStore"));
  return queueRuntime;
}

function normalizeQueueEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => ({
      typeID: Number(entry && (entry.typeID ?? entry.trainingTypeID)) || 0,
      toLevel: Number(entry && (entry.toLevel ?? entry.trainingToLevel)) || 0,
    }))
    .filter((entry) => entry.typeID > 0 && entry.toLevel > 0 && entry.toLevel <= 5);
}

function flushSkillTables() {
  if (gameStore && typeof gameStore.flushTablesSync === "function") {
    gameStore.flushTablesSync(["skillQueues", "skills", "characters"]);
  }
}

function getQueueSnapshot(characterID) {
  const snapshot = loadEveSkillQueueRuntime().getQueueSnapshot(Number(characterID) || 0);
  flushSkillTables();
  return snapshot;
}

function saveQueue(characterID, entries, options = {}) {
  const snapshot = loadEveSkillQueueRuntime().saveQueue(
    Number(characterID) || 0,
    normalizeQueueEntries(entries),
    {
      activate: options.activate !== false,
      emitNotifications: options.emitNotifications === true,
    },
  );

  flushSkillTables();

  return snapshot;
}

module.exports = {
  getQueueSnapshot,
  normalizeQueueEntries,
  saveQueue,
};
