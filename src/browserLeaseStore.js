"use strict";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_EXPIRED_MARKER_TTL_MS = 15 * 60_000;

function normalizeSessionID(sessionID) {
  const value = String(sessionID || "").trim();
  if (!value) {
    throw new TypeError("A web session ID is required.");
  }
  return value;
}

function normalizeCharacterID(characterID) {
  const value = Number(characterID);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("A positive character ID is required.");
  }
  return value;
}

function normalizeAccountID(accountID) {
  const value = Number(accountID);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("A positive account ID is required.");
  }
  return value;
}

function normalizeCredentials(credentials) {
  const leaseID = String(credentials && credentials.leaseID || "").trim();
  const leaseSecret = String(credentials && credentials.leaseSecret || "").trim();
  if (!leaseID || !leaseSecret) {
    throw new TypeError("Complete browser lease credentials are required.");
  }
  const leaseExpiresAt =
    typeof credentials.leaseExpiresAt === "string"
      ? credentials.leaseExpiresAt
      : null;
  const expiresAtMs = leaseExpiresAt === null
    ? null
    : Date.parse(leaseExpiresAt);
  if (leaseExpiresAt !== null && !Number.isFinite(expiresAtMs)) {
    throw new TypeError("Browser lease expiry must be a valid timestamp.");
  }
  return {
    leaseID,
    leaseSecret,
    leaseExpiresAt,
    expiresAtMs,
  };
}

function createBrowserLeaseStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setTimer = typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;
  const expiredMarkerTtlMs = Number.isSafeInteger(options.expiredMarkerTtlMs) &&
    options.expiredMarkerTtlMs > 0
    ? options.expiredMarkerTtlMs
    : DEFAULT_EXPIRED_MARKER_TTL_MS;
  const leasesBySession = new Map();
  const expiredMarkersBySession = new Map();

  function publicRecord(record) {
    return record
      ? {
        sessionID: record.sessionID,
        accountID: record.accountID,
        characterID: record.characterID,
        leaseID: record.leaseID,
        leaseSecret: record.leaseSecret,
        leaseExpiresAt: record.leaseExpiresAt,
      }
      : null;
  }

  function clearRecordTimer(record) {
    if (record && record.timerHandle !== null && record.timerHandle !== undefined) {
      clearTimer(record.timerHandle);
      record.timerHandle = null;
    }
  }

  function removeRecord(sessionID, characterID, expectedRecord = null) {
    const sessionLeases = leasesBySession.get(sessionID);
    const record = sessionLeases && sessionLeases.get(characterID);
    if (!record || (expectedRecord && record !== expectedRecord)) {
      return false;
    }
    clearRecordTimer(record);
    sessionLeases.delete(characterID);
    if (sessionLeases.size === 0) {
      leasesBySession.delete(sessionID);
    }
    return true;
  }

  function removeExpiredMarker(sessionID, characterID, expectedMarker = null) {
    const sessionMarkers = expiredMarkersBySession.get(sessionID);
    const marker = sessionMarkers && sessionMarkers.get(characterID);
    if (!marker || (expectedMarker && marker !== expectedMarker)) {
      return false;
    }
    clearRecordTimer(marker);
    sessionMarkers.delete(characterID);
    if (sessionMarkers.size === 0) {
      expiredMarkersBySession.delete(sessionID);
    }
    return true;
  }

  function isExpired(record) {
    return record.expiresAtMs !== null && record.expiresAtMs <= Number(now());
  }

  function scheduleMarkerPurge(sessionID, characterID, marker) {
    const delayMs = Math.max(
      0,
      Math.min(MAX_TIMER_DELAY_MS, marker.purgeAtMs - Number(now())),
    );
    marker.timerHandle = setTimer(() => {
      marker.timerHandle = null;
      if (Number(now()) >= marker.purgeAtMs) {
        removeExpiredMarker(sessionID, characterID, marker);
      } else {
        scheduleMarkerPurge(sessionID, characterID, marker);
      }
    }, delayMs);
    if (marker.timerHandle && typeof marker.timerHandle.unref === "function") {
      marker.timerHandle.unref();
    }
  }

  function rememberExpiredRecord(record) {
    removeExpiredMarker(record.sessionID, record.characterID);
    let sessionMarkers = expiredMarkersBySession.get(record.sessionID);
    if (!sessionMarkers) {
      sessionMarkers = new Map();
      expiredMarkersBySession.set(record.sessionID, sessionMarkers);
    }
    // This marker intentionally contains no lease ID or secret. It exists only
    // long enough for the signed web session to distinguish a just-expired
    // lease from credentials it never held.
    const marker = {
      sessionID: record.sessionID,
      accountID: record.accountID,
      characterID: record.characterID,
      expiredAtMs: record.expiresAtMs,
      purgeAtMs: Number(now()) + expiredMarkerTtlMs,
      timerHandle: null,
    };
    sessionMarkers.set(record.characterID, marker);
    scheduleMarkerPurge(record.sessionID, record.characterID, marker);
  }

  function expireRecord(sessionID, characterID, record) {
    if (!removeRecord(sessionID, characterID, record)) {
      return false;
    }
    rememberExpiredRecord(record);
    return true;
  }

  function pruneSession(sessionID) {
    const sessionLeases = leasesBySession.get(sessionID);
    if (sessionLeases) {
      for (const [characterID, record] of sessionLeases) {
        if (isExpired(record)) {
          expireRecord(sessionID, characterID, record);
        }
      }
    }
    const sessionMarkers = expiredMarkersBySession.get(sessionID);
    if (sessionMarkers) {
      for (const [characterID, marker] of sessionMarkers) {
        if (Number(now()) >= marker.purgeAtMs) {
          removeExpiredMarker(sessionID, characterID, marker);
        }
      }
    }
  }

  function scheduleExpiry(sessionID, characterID, record) {
    const delayMs = Math.max(
      0,
      Math.min(MAX_TIMER_DELAY_MS, record.expiresAtMs - Number(now())),
    );
    record.timerHandle = setTimer(() => {
      record.timerHandle = null;
      if (isExpired(record)) {
        expireRecord(sessionID, characterID, record);
      } else {
        scheduleExpiry(sessionID, characterID, record);
      }
    }, delayMs);
    if (record.timerHandle && typeof record.timerHandle.unref === "function") {
      record.timerHandle.unref();
    }
  }

  function put(sessionID, accountID, characterID, credentials) {
    const normalizedSessionID = normalizeSessionID(sessionID);
    const normalizedCharacterID = normalizeCharacterID(characterID);
    const normalizedCredentials = normalizeCredentials(credentials);
    const record = {
      sessionID: normalizedSessionID,
      accountID: normalizeAccountID(accountID),
      characterID: normalizedCharacterID,
      ...normalizedCredentials,
      timerHandle: null,
    };
    let sessionLeases = leasesBySession.get(normalizedSessionID);
    if (!sessionLeases) {
      sessionLeases = new Map();
      leasesBySession.set(normalizedSessionID, sessionLeases);
    }
    const previousRecord = sessionLeases.get(normalizedCharacterID);
    clearRecordTimer(previousRecord);
    removeExpiredMarker(normalizedSessionID, normalizedCharacterID);
    sessionLeases.set(normalizedCharacterID, record);
    if (record.expiresAtMs !== null) {
      scheduleExpiry(normalizedSessionID, normalizedCharacterID, record);
    }
    if (isExpired(record)) {
      expireRecord(normalizedSessionID, normalizedCharacterID, record);
    }
    return publicRecord(record);
  }

  function get(sessionID, characterID) {
    const normalizedSessionID = String(sessionID || "").trim();
    const normalizedCharacterID = Number(characterID);
    if (!normalizedSessionID || !Number.isSafeInteger(normalizedCharacterID)) {
      return null;
    }
    pruneSession(normalizedSessionID);
    const record = leasesBySession.get(normalizedSessionID)?.get(normalizedCharacterID);
    return publicRecord(record);
  }

  function remove(sessionID, characterID) {
    const normalizedSessionID = String(sessionID || "").trim();
    const normalizedCharacterID = Number(characterID);
    const removedRecord = removeRecord(normalizedSessionID, normalizedCharacterID);
    const removedMarker = removeExpiredMarker(normalizedSessionID, normalizedCharacterID);
    return removedRecord || removedMarker;
  }

  function getLeaseStatus(sessionID, characterID) {
    const normalizedSessionID = String(sessionID || "").trim();
    const normalizedCharacterID = Number(characterID);
    if (!normalizedSessionID || !Number.isSafeInteger(normalizedCharacterID)) {
      return "missing";
    }
    pruneSession(normalizedSessionID);
    if (leasesBySession.get(normalizedSessionID)?.has(normalizedCharacterID)) {
      return "active";
    }
    return expiredMarkersBySession.get(normalizedSessionID)?.has(normalizedCharacterID)
      ? "expired"
      : "missing";
  }

  function listForSession(sessionID) {
    const normalizedSessionID = String(sessionID || "").trim();
    pruneSession(normalizedSessionID);
    const sessionLeases = leasesBySession.get(normalizedSessionID);
    return sessionLeases
      ? [...sessionLeases.values()].map(publicRecord)
      : [];
  }

  function clearSession(sessionID) {
    const normalizedSessionID = String(sessionID || "").trim();
    const sessionLeases = leasesBySession.get(normalizedSessionID);
    const sessionMarkers = expiredMarkersBySession.get(normalizedSessionID);
    if (sessionLeases) {
      for (const record of sessionLeases.values()) {
        clearRecordTimer(record);
      }
      leasesBySession.delete(normalizedSessionID);
    }
    if (sessionMarkers) {
      for (const marker of sessionMarkers.values()) {
        clearRecordTimer(marker);
      }
      expiredMarkersBySession.delete(normalizedSessionID);
    }
    return Boolean(sessionLeases || sessionMarkers);
  }

  return Object.freeze({
    put,
    get,
    getLeaseStatus,
    remove,
    listForSession,
    clearSession,
  });
}

module.exports = {
  createBrowserLeaseStore,
};
