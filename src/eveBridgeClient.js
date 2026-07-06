"use strict";

const config = require("./config");

const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:26002/_evejs-web";
const DEFAULT_TIMEOUT_MS = 1500;

class EveBridgeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EveBridgeError";
    this.code = options.code || "EVE_BRIDGE_ERROR";
    this.statusCode = options.statusCode || 502;
    this.fallbackAllowed = options.fallbackAllowed === true;
  }
}

function isBridgeDisabled() {
  const value = String(process.env.EVEJS_WEB_BRIDGE_DISABLED || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function getBridgeBaseUrl() {
  if (isBridgeDisabled()) {
    return null;
  }
  return String(process.env.EVEJS_BRIDGE_URL || DEFAULT_BRIDGE_BASE_URL).replace(/\/+$/, "");
}

function getBridgeToken() {
  return String(process.env.EVEJS_WEB_BRIDGE_TOKEN || "").trim();
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

async function postJson(path, payload) {
  const baseUrl = getBridgeBaseUrl();
  if (!baseUrl) {
    throw new EveBridgeError("EveJS bridge is disabled.", {
      code: "EVE_BRIDGE_DISABLED",
      fallbackAllowed: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = {
    "content-type": "application/json",
  };
  const token = getBridgeToken();
  if (token) {
    headers["x-evejs-web-token"] = token;
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "");
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (data && data.ok === false) {
      throw new EveBridgeError(data.message || "EveJS bridge request failed.", {
        code: data.error || "EVE_BRIDGE_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }

    if (!data || data.source !== "evejs-web-bridge") {
      throw new EveBridgeError("EveJS bridge endpoint is not available.", {
        code: "EVE_BRIDGE_NOT_AVAILABLE",
        statusCode: response.status || 502,
        fallbackAllowed: true,
      });
    }

    if (!response.ok || data.ok !== true) {
      throw new EveBridgeError(data.message || "EveJS bridge request failed.", {
        code: data.error || "EVE_BRIDGE_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }

    return data;
  } catch (error) {
    if (error instanceof EveBridgeError) {
      throw error;
    }
    const code = error.name === "AbortError"
      ? "EVE_BRIDGE_TIMEOUT"
      : "EVE_BRIDGE_UNREACHABLE";
    throw new EveBridgeError(
      code === "EVE_BRIDGE_TIMEOUT"
        ? "EveJS bridge timed out."
        : "EveJS bridge is unreachable.",
      {
      code,
      fallbackAllowed: true,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(path, query = {}) {
  const baseUrl = getBridgeBaseUrl();
  if (!baseUrl) {
    throw new EveBridgeError("EveJS bridge is disabled.", {
      code: "EVE_BRIDGE_DISABLED",
      fallbackAllowed: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = {};
  const token = getBridgeToken();
  if (token) {
    headers["x-evejs-web-token"] = token;
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";

  try {
    const response = await fetch(`${baseUrl}${path}${suffix}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "");
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (data && data.ok === false) {
      throw new EveBridgeError(data.message || "EveJS bridge request failed.", {
        code: data.error || "EVE_BRIDGE_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }
    if (!data || data.source !== "evejs-web-bridge") {
      throw new EveBridgeError("EveJS bridge endpoint is not available.", {
        code: "EVE_BRIDGE_NOT_AVAILABLE",
        statusCode: response.status || 502,
        fallbackAllowed: true,
      });
    }
    if (!response.ok || data.ok !== true) {
      throw new EveBridgeError(data.message || "EveJS bridge request failed.", {
        code: data.error || "EVE_BRIDGE_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }
    return data;
  } catch (error) {
    if (error instanceof EveBridgeError) {
      throw error;
    }
    const code = error.name === "AbortError"
      ? "EVE_BRIDGE_TIMEOUT"
      : "EVE_BRIDGE_UNREACHABLE";
    throw new EveBridgeError(
      code === "EVE_BRIDGE_TIMEOUT"
        ? "EveJS bridge timed out."
        : "EveJS bridge is unreachable.",
      {
        code,
        fallbackAllowed: true,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getCharacterStatus(accountID, characterID) {
  return getJson("/character-status", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
  });
}

async function getStatus() {
  return getJson("/status");
}

async function listAccounts() {
  const result = await getJson("/accounts");
  return Array.isArray(result.accounts) ? result.accounts : [];
}

async function getAccount(username) {
  const result = await getJson("/account", {
    username: String(username || "").trim(),
  });
  return result.account || null;
}

async function listCharacters(accountID) {
  const result = await getJson("/characters", {
    accountID: Number(accountID) || 0,
  });
  return Array.isArray(result.characters) ? result.characters : [];
}

async function getSnapshot(accountID, characterID) {
  const result = await getJson("/snapshot", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
  });
  return result.snapshot || null;
}

async function getStationAsks(stationID) {
  const result = await getJson("/market/station-asks", {
    stationID: Number(stationID) || 0,
  });
  return Array.isArray(result.rows) ? result.rows : [];
}

async function saveSkillQueue(accountID, characterID, entries, options = {}) {
  return postJson("/skill-queue", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    activate: options.activate !== false,
    entries: normalizeQueueEntries(entries),
    webHost: `${config.host}:${config.port}`,
  });
}

async function restartExtractors(accountID, characterID, options = {}) {
  return postJson("/pi/restart-extractors", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    planetID: Number(options.planetID) || 0,
    webHost: `${config.host}:${config.port}`,
  });
}

module.exports = {
  EveBridgeError,
  getAccount,
  getSnapshot,
  getCharacterStatus,
  getStationAsks,
  getStatus,
  listAccounts,
  listCharacters,
  saveSkillQueue,
  restartExtractors,
};
