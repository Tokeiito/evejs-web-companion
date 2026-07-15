"use strict";

const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:26002/_evejs-web/v1";
const DEFAULT_TIMEOUT_MS = 1500;
const GATEWAY_SOURCE = "evejs-web-gateway";
const GATEWAY_API_VERSION = 1;

class EveGatewayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EveGatewayError";
    this.code = options.code || "EVE_GATEWAY_ERROR";
    this.statusCode = options.statusCode || 502;
  }
}

function getGatewayBaseUrl() {
  const configured = String(
    process.env.EVEJS_GATEWAY_URL || DEFAULT_GATEWAY_BASE_URL,
  ).trim();
  let url;
  try {
    url = new URL(configured);
  } catch (error) {
    throw new EveGatewayError(
      "EVEJS_GATEWAY_URL must be an absolute v1 gateway URL.",
      { code: "EVE_GATEWAY_CONFIGURATION", statusCode: 500 },
    );
  }

  const gatewayPath = url.pathname.replace(/\/+$/, "");
  const valid =
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    gatewayPath === "/_evejs-web/v1";
  if (!valid) {
    throw new EveGatewayError(
      "EVEJS_GATEWAY_URL must target the /_evejs-web/v1 gateway namespace.",
      { code: "EVE_GATEWAY_CONFIGURATION", statusCode: 500 },
    );
  }

  url.pathname = gatewayPath;
  return url.toString().replace(/\/$/, "");
}

function getGatewayToken() {
  return String(process.env.EVEJS_WEB_GATEWAY_TOKEN || "").trim();
}

function normalizeQueueEntries(entries) {
  if (!Array.isArray(entries)) {
    return entries;
  }
  return entries.map((entry) => ({
    typeID: entry && entry.typeID,
    toLevel: entry && entry.toLevel,
  }));
}

function assertGatewayEnvelope(data, statusCode) {
  if (!data || data.source !== GATEWAY_SOURCE) {
    throw new EveGatewayError("EveJS gateway endpoint is not available.", {
      code: "EVE_GATEWAY_NOT_AVAILABLE",
      statusCode: statusCode || 502,
    });
  }
  if (Number(data.apiVersion) !== GATEWAY_API_VERSION) {
    throw new EveGatewayError("EveJS gateway response version is not supported.", {
      code: "EVE_GATEWAY_UNSUPPORTED",
      statusCode: statusCode || 502,
    });
  }
}

function gatewayRequestError(error) {
  if (error instanceof EveGatewayError) {
    return error;
  }
  const code = error.name === "AbortError"
    ? "EVE_GATEWAY_TIMEOUT"
    : "EVE_GATEWAY_UNREACHABLE";
  return new EveGatewayError(
    code === "EVE_GATEWAY_TIMEOUT"
      ? "EveJS gateway timed out."
      : "EveJS gateway is unreachable.",
    { code },
  );
}

async function postSerializedJson(path, serializedPayload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = {
    "content-type": "application/json",
  };
  const token = getGatewayToken();
  if (token) {
    headers["x-evejs-web-token"] = token;
  }

  try {
    const response = await fetch(`${getGatewayBaseUrl()}${path}`, {
      method: "POST",
      headers,
      body: serializedPayload,
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "");
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    assertGatewayEnvelope(data, response.status);
    if (data.ok === false) {
      throw new EveGatewayError(data.message || "EveJS gateway request failed.", {
        code: data.error || "EVE_GATEWAY_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }
    if (!response.ok || data.ok !== true) {
      throw new EveGatewayError(data.message || "EveJS gateway request failed.", {
        code: data.error || "EVE_GATEWAY_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }

    return data;
  } catch (error) {
    throw gatewayRequestError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(path, payload) {
  return postSerializedJson(path, JSON.stringify(payload));
}

function isUncertainCommandError(error) {
  return error instanceof EveGatewayError && (
    error.statusCode === 503 ||
    error.code === "EVE_GATEWAY_TIMEOUT" ||
    error.code === "EVE_GATEWAY_UNREACHABLE"
  );
}

async function postCommandJson(path, payload) {
  const serializedPayload = JSON.stringify(payload);
  try {
    return await postSerializedJson(path, serializedPayload);
  } catch (error) {
    if (!isUncertainCommandError(error)) {
      throw error;
    }
    return postSerializedJson(path, serializedPayload);
  }
}

async function getJson(path, query = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = {};
  const token = getGatewayToken();
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
    const response = await fetch(`${getGatewayBaseUrl()}${path}${suffix}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "");
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    assertGatewayEnvelope(data, response.status);
    if (data.ok === false) {
      throw new EveGatewayError(data.message || "EveJS gateway request failed.", {
        code: data.error || "EVE_GATEWAY_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }
    if (!response.ok || data.ok !== true) {
      throw new EveGatewayError(data.message || "EveJS gateway request failed.", {
        code: data.error || "EVE_GATEWAY_REQUEST_FAILED",
        statusCode: response.status || 502,
      });
    }

    return data;
  } catch (error) {
    throw gatewayRequestError(error);
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

async function claimCharacterControl(accountID, characterID, controllerID) {
  return postJson("/character-control/claim", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    controllerID: String(controllerID || ""),
  });
}

async function renewCharacterControl(
  accountID,
  characterID,
  controllerID,
  credentials = {},
) {
  return postJson("/character-control/renew", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    controllerID: String(controllerID || ""),
    leaseID: String(credentials.leaseID || ""),
    leaseSecret: String(credentials.leaseSecret || ""),
  });
}

async function releaseCharacterControl(
  accountID,
  characterID,
  controllerID,
  credentials = {},
) {
  return postJson("/character-control/release", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    controllerID: String(controllerID || ""),
    leaseID: String(credentials.leaseID || ""),
    leaseSecret: String(credentials.leaseSecret || ""),
  });
}

async function getGatewayHealth() {
  const health = await getJson("/health");
  const hasStableShape =
    health.capabilities &&
    typeof health.capabilities === "object" &&
    health.runtime &&
    typeof health.runtime === "object" &&
    health.runtime.dependencies &&
    typeof health.runtime.dependencies === "object";
  if (!hasStableShape) {
    throw new EveGatewayError("EveJS gateway health response is not supported.", {
      code: "EVE_GATEWAY_UNSUPPORTED",
    });
  }
  return health;
}

function normalizeGatewayHealth(health) {
  const runtimeReady = health.runtime.ready === true;
  const dependencies = Object.fromEntries(
    Object.entries(health.runtime.dependencies)
      .map(([name, ready]) => [name, ready === true]),
  );
  return {
    available: true,
    ready: runtimeReady,
    capabilities: { ...health.capabilities },
    runtime: {
      ready: runtimeReady,
      dependencies,
    },
  };
}

async function getStatus() {
  const [status, health] = await Promise.all([
    getJson("/status"),
    getGatewayHealth(),
  ]);
  return {
    ...status,
    ...normalizeGatewayHealth(health),
  };
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
  return postCommandJson("/skill-queue", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    command: {
      commandID: String(options.commandID || ""),
      expectedStateVersion: String(options.expectedStateVersion || ""),
      controllerID: String(options.controllerID || ""),
      type: "offline.skill_queue.save",
      payload: {
        entries: normalizeQueueEntries(entries),
        activate: options.activate === true,
      },
    },
  });
}

async function restartExtractors(accountID, characterID, options = {}) {
  return postCommandJson("/pi/restart-extractors", {
    accountID: Number(accountID) || 0,
    characterID: Number(characterID) || 0,
    command: {
      commandID: String(options.commandID || ""),
      expectedStateVersion: String(options.expectedStateVersion || ""),
      controllerID: String(options.controllerID || ""),
      type: "offline.pi.extractors.restart",
      payload: {
        planetID: Number(options.planetID) || 0,
      },
    },
  });
}

module.exports = {
  EveGatewayError,
  claimCharacterControl,
  getAccount,
  getGatewayHealth,
  getSnapshot,
  getCharacterStatus,
  getStationAsks,
  getStatus,
  listAccounts,
  listCharacters,
  releaseCharacterControl,
  renewCharacterControl,
  saveSkillQueue,
  restartExtractors,
};
