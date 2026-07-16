"use strict";

(function exposeCharacterEventClient(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EveCharacterEventClient = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createEventClientApi() {
  const PROTOCOL = Object.freeze({
    source: "evejs-web-gateway",
    apiVersion: 1,
    streamVersion: 1,
    maxFrameCharacters: 2 * 1024 * 1024,
    maxCommandOutcomes: 256,
    snapshotKeys: Object.freeze([
      "source",
      "apiVersion",
      "streamVersion",
      "type",
      "characterID",
      "cursor",
      "control",
      "stateVersion",
      "commandOutcomes",
    ]),
    eventKeys: Object.freeze([
      "source",
      "apiVersion",
      "streamVersion",
      "type",
      "characterID",
      "cursor",
      "event",
    ]),
    controlKeys: Object.freeze([
      "online",
      "controlState",
      "transport",
      "leaseExpiresAt",
    ]),
    outcomeKeys: Object.freeze([
      "commandID",
      "commandType",
      "success",
      "errorCode",
      "admissionStatus",
      "stateVersion",
    ]),
  });

  const CONTROL_EVENT_KEYS = Object.freeze([
    "kind",
    "control",
    "stateVersion",
  ]);
  const SETTLEMENT_EVENT_KEYS = Object.freeze([
    "kind",
    ...PROTOCOL.outcomeKeys,
  ]);

  class CharacterEventProtocolError extends Error {
    constructor(message, code = "CHARACTER_EVENT_PROTOCOL_INVALID") {
      super(message);
      this.name = "CharacterEventProtocolError";
      this.code = code;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasExactKeys(value, expectedKeys) {
    if (!isPlainObject(value)) {
      return false;
    }
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]);
  }

  function positiveInteger(value) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
  }

  function generation(value) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
  }

  function isBoundedString(value, maximum = 256) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum;
  }

  function isOpaqueString(value, maximum = 512) {
    return isBoundedString(value, maximum) &&
      Boolean(value.trim()) &&
      !/[\u0000-\u001f\u007f]/.test(value);
  }

  function normalizeCursor(value) {
    if (!hasExactKeys(value, ["epoch", "sequence"])) {
      throw new CharacterEventProtocolError("The event cursor shape is invalid.");
    }
    if (
      !isBoundedString(value.epoch, 128) ||
      !/^[A-Za-z0-9_-]+$/.test(value.epoch) ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0
    ) {
      throw new CharacterEventProtocolError("The event cursor value is invalid.");
    }
    return Object.freeze({
      epoch: value.epoch,
      sequence: value.sequence,
    });
  }

  function normalizeControl(value) {
    if (!hasExactKeys(value, PROTOCOL.controlKeys)) {
      throw new CharacterEventProtocolError("The character control shape is invalid.");
    }
    const controlState = value.controlState;
    const transport = value.transport;
    const expiry = value.leaseExpiresAt;
    const valid =
      (controlState === "offline" && value.online === false && transport === null && expiry === null) ||
      (controlState === "retail_client" && value.online === true && transport === "tcp" && expiry === null) ||
      (
        controlState === "browser_pilot" &&
        value.online === true &&
        transport === "web" &&
        isOpaqueString(expiry, 128) &&
        !Number.isNaN(Date.parse(expiry)) &&
        new Date(expiry).toISOString() === expiry
      );
    if (!valid) {
      throw new CharacterEventProtocolError("The character control value is invalid.");
    }
    return Object.freeze({
      online: value.online,
      controlState,
      transport,
      leaseExpiresAt: expiry,
    });
  }

  function normalizeOutcome(value, expectedKeys = PROTOCOL.outcomeKeys) {
    if (!hasExactKeys(value, expectedKeys)) {
      throw new CharacterEventProtocolError("The command outcome shape is invalid.");
    }
    if (
      !isOpaqueString(value.commandID, 512) ||
      !isOpaqueString(value.commandType, 128) ||
      typeof value.success !== "boolean" ||
      !["admitted", "rejected"].includes(value.admissionStatus) ||
      !isOpaqueString(value.stateVersion, 512) ||
      !(
        value.errorCode === null ||
        (isBoundedString(value.errorCode, 128) && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value.errorCode))
      ) ||
      (value.success && (value.errorCode !== null || value.admissionStatus !== "admitted")) ||
      (!value.success && value.errorCode === null)
    ) {
      throw new CharacterEventProtocolError("The command outcome value is invalid.");
    }
    return Object.freeze({
      commandID: value.commandID,
      commandType: value.commandType,
      success: value.success,
      errorCode: value.errorCode,
      admissionStatus: value.admissionStatus,
      stateVersion: value.stateVersion,
    });
  }

  function normalizeEvent(value) {
    if (!isPlainObject(value)) {
      throw new CharacterEventProtocolError("The character event shape is invalid.");
    }
    if (value.kind === "control_changed") {
      if (!hasExactKeys(value, CONTROL_EVENT_KEYS) || !isOpaqueString(value.stateVersion, 512)) {
        throw new CharacterEventProtocolError("The control event shape is invalid.");
      }
      return Object.freeze({
        kind: value.kind,
        control: normalizeControl(value.control),
        stateVersion: value.stateVersion,
      });
    }
    if (value.kind === "command_settled") {
      const outcome = normalizeOutcome(value, SETTLEMENT_EVENT_KEYS);
      return Object.freeze({
        kind: value.kind,
        ...outcome,
      });
    }
    throw new CharacterEventProtocolError("The character event kind is invalid.");
  }

  function parseCharacterEventFrame(text, expectedCharacterID) {
    if (typeof text !== "string" || text.length === 0 || text.length > PROTOCOL.maxFrameCharacters) {
      throw new CharacterEventProtocolError("The character event frame size is invalid.");
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      void error;
      throw new CharacterEventProtocolError("The character event frame is not valid JSON.");
    }
    const expected = positiveInteger(expectedCharacterID);
    const commonValid =
      isPlainObject(value) &&
      value.source === PROTOCOL.source &&
      value.apiVersion === PROTOCOL.apiVersion &&
      value.streamVersion === PROTOCOL.streamVersion &&
      Number.isSafeInteger(value.characterID) &&
      value.characterID > 0 &&
      value.characterID === expected;
    if (!expected || !commonValid) {
      throw new CharacterEventProtocolError("The character event envelope is invalid.");
    }

    if (value.type === "snapshot") {
      if (
        !hasExactKeys(value, PROTOCOL.snapshotKeys) ||
        !isOpaqueString(value.stateVersion, 512) ||
        !Array.isArray(value.commandOutcomes) ||
        value.commandOutcomes.length > PROTOCOL.maxCommandOutcomes
      ) {
        throw new CharacterEventProtocolError("The character event snapshot is invalid.");
      }
      const commandOutcomes = value.commandOutcomes.map((outcome) => normalizeOutcome(outcome));
      return Object.freeze({
        source: PROTOCOL.source,
        apiVersion: PROTOCOL.apiVersion,
        streamVersion: PROTOCOL.streamVersion,
        type: "snapshot",
        characterID: expected,
        cursor: normalizeCursor(value.cursor),
        control: normalizeControl(value.control),
        stateVersion: value.stateVersion,
        commandOutcomes: Object.freeze(commandOutcomes),
      });
    }

    if (value.type === "event") {
      if (!hasExactKeys(value, PROTOCOL.eventKeys)) {
        throw new CharacterEventProtocolError("The character event envelope is invalid.");
      }
      return Object.freeze({
        source: PROTOCOL.source,
        apiVersion: PROTOCOL.apiVersion,
        streamVersion: PROTOCOL.streamVersion,
        type: "event",
        characterID: expected,
        cursor: normalizeCursor(value.cursor),
        event: normalizeEvent(value.event),
      });
    }

    throw new CharacterEventProtocolError("The character event frame type is invalid.");
  }

  function createCursorStore(storage = null, prefix = "evejs-web:event-cursor:") {
    const cursors = new Map();

    function key(accountID, characterID) {
      const account = positiveInteger(accountID);
      const character = positiveInteger(characterID);
      if (!account || !character) {
        throw new TypeError("A positive account and character are required for an event cursor.");
      }
      return `${account}:${character}`;
    }

    function storageKey(accountID, characterID) {
      return `${prefix}${key(accountID, characterID)}`;
    }

    function readStored(accountID, characterID) {
      if (!storage || typeof storage.getItem !== "function") {
        return null;
      }
      const itemKey = storageKey(accountID, characterID);
      let serialized;
      try {
        serialized = storage.getItem(itemKey);
      } catch (error) {
        void error;
        return null;
      }
      if (typeof serialized !== "string" || serialized.length === 0) {
        return null;
      }
      try {
        return normalizeCursor(JSON.parse(serialized));
      } catch (error) {
        void error;
        try {
          if (typeof storage.removeItem === "function") {
            storage.removeItem(itemKey);
          }
        } catch (removeError) {
          void removeError;
        }
        return null;
      }
    }

    return Object.freeze({
      get(accountID, characterID) {
        const cursorKey = key(accountID, characterID);
        let cursor = cursors.get(cursorKey);
        if (!cursor) {
          cursor = readStored(accountID, characterID);
          if (cursor) {
            cursors.set(cursorKey, cursor);
          }
        }
        return cursor ? { ...cursor } : null;
      },
      set(accountID, characterID, cursor) {
        const normalized = normalizeCursor(cursor);
        cursors.set(key(accountID, characterID), normalized);
        if (storage && typeof storage.setItem === "function") {
          try {
            storage.setItem(storageKey(accountID, characterID), JSON.stringify(normalized));
          } catch (error) {
            void error;
          }
        }
        return { ...normalized };
      },
    });
  }

  function normalizeSelection(value) {
    if (!isPlainObject(value)) {
      throw new TypeError("An authenticated character selection is required.");
    }
    const accountID = positiveInteger(value.accountID);
    const characterID = positiveInteger(value.characterID);
    if (!accountID || !characterID) {
      throw new TypeError("An authenticated account and character are required.");
    }
    return Object.freeze({
      accountID,
      characterID,
      authGeneration: generation(value.authGeneration),
      characterGeneration: generation(value.characterGeneration),
    });
  }

  function buildSocketUrl(locationValue, selection, cursor) {
    const href = locationValue && locationValue.href
      ? locationValue.href
      : String(locationValue || "");
    const url = new URL(`/api/characters/${selection.characterID}/events`, href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (cursor) {
      url.searchParams.set("epoch", cursor.epoch);
      url.searchParams.set("sequence", String(cursor.sequence));
    }
    return url.toString();
  }

  function createCharacterEventClient(options = {}) {
    const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    const locationValue = options.location || globalThis.location;
    const setTimer = options.setTimeout || globalThis.setTimeout.bind(globalThis);
    const clearTimer = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    let storage = options.storage;
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch (error) {
        void error;
        storage = null;
      }
    }
    const cursorStore = options.cursorStore || createCursorStore(storage);
    const baseReconnectDelayMs = Math.max(1, Number(options.baseReconnectDelayMs) || 250);
    const maxReconnectDelayMs = Math.max(
      baseReconnectDelayMs,
      Number(options.maxReconnectDelayMs) || 10_000,
    );
    const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => true;
    const onSnapshot = typeof options.onSnapshot === "function" ? options.onSnapshot : () => {};
    const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
    const onProtocolError = typeof options.onProtocolError === "function"
      ? options.onProtocolError
      : () => {};
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

    let activeSelection = null;
    let activeToken = 0;
    let connection = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let forceSnapshot = false;
    let disposed = false;

    function callback(callbackFn, ...args) {
      try {
        callbackFn(...args);
      } catch (error) {
        globalThis.console && globalThis.console.error(error);
      }
    }

    function applyFrameCallback(callbackFn, frame, selection) {
      try {
        callbackFn(frame, selection);
        return true;
      } catch (error) {
        void error;
        return false;
      }
    }

    function selectionIsCurrent(token) {
      if (
        disposed ||
        !activeSelection ||
        token !== activeToken
      ) {
        return false;
      }
      try {
        return isCurrent(activeSelection) === true;
      } catch (error) {
        void error;
        return false;
      }
    }

    function notifyStatus(status, extra = {}) {
      if (!activeSelection) {
        return;
      }
      callback(onStatus, Object.freeze({ status, ...extra }), activeSelection);
    }

    function clearReconnect() {
      if (reconnectTimer !== null) {
        clearTimer(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function detachConnection(target, closeCode, closeReason) {
      if (!target) {
        return;
      }
      target.socket.removeEventListener("open", target.handlers.open);
      target.socket.removeEventListener("message", target.handlers.message);
      target.socket.removeEventListener("error", target.handlers.error);
      target.socket.removeEventListener("close", target.handlers.close);
      if (connection === target) {
        connection = null;
      }
      if (closeCode !== null) {
        try {
          target.socket.close(closeCode, closeReason);
        } catch (error) {
          void error;
        }
      }
    }

    function scheduleReconnect(token) {
      if (!selectionIsCurrent(token) || reconnectTimer !== null || connection) {
        return;
      }
      const exponent = Math.min(reconnectAttempt, 30);
      const delay = Math.min(maxReconnectDelayMs, baseReconnectDelayMs * (2 ** exponent));
      reconnectAttempt += 1;
      notifyStatus("reconnecting", { delayMs: delay });
      reconnectTimer = setTimer(() => {
        reconnectTimer = null;
        if (selectionIsCurrent(token)) {
          openConnection(token);
        }
      }, delay);
    }

    function protocolFailure(target, error) {
      if (!selectionIsCurrent(target.token) || connection !== target) {
        return;
      }
      forceSnapshot = true;
      callback(onProtocolError, error, activeSelection);
      notifyStatus("protocol-error");
      detachConnection(target, 1002, "invalid character event");
      scheduleReconnect(target.token);
    }

    function acceptFrame(target, frame) {
      const selection = activeSelection;
      const previous = cursorStore.get(selection.accountID, selection.characterID);
      if (frame.type === "snapshot") {
        if (!applyFrameCallback(onSnapshot, frame, selection)) {
          protocolFailure(
            target,
            new CharacterEventProtocolError("The character event snapshot could not be applied."),
          );
          return;
        }
        cursorStore.set(selection.accountID, selection.characterID, frame.cursor);
        target.expectSnapshot = false;
        forceSnapshot = false;
        reconnectAttempt = 0;
        return;
      }

      if (target.expectSnapshot || !previous) {
        protocolFailure(
          target,
          new CharacterEventProtocolError("An authoritative event snapshot was required."),
        );
        return;
      }
      if (
        frame.cursor.epoch === previous.epoch &&
        frame.cursor.sequence === previous.sequence
      ) {
        return;
      }
      if (
        frame.cursor.epoch !== previous.epoch ||
        frame.cursor.sequence !== previous.sequence + 1
      ) {
        protocolFailure(
          target,
          new CharacterEventProtocolError("The character event sequence is not contiguous."),
        );
        return;
      }
      if (!applyFrameCallback(onEvent, frame, selection)) {
        protocolFailure(
          target,
          new CharacterEventProtocolError("The character event could not be applied."),
        );
        return;
      }
      cursorStore.set(selection.accountID, selection.characterID, frame.cursor);
      reconnectAttempt = 0;
    }

    function openConnection(token) {
      if (!selectionIsCurrent(token) || connection || reconnectTimer !== null) {
        return;
      }
      if (typeof WebSocketImpl !== "function") {
        notifyStatus("unavailable");
        scheduleReconnect(token);
        return;
      }
      const selection = activeSelection;
      const cursor = forceSnapshot
        ? null
        : cursorStore.get(selection.accountID, selection.characterID);
      let socket;
      try {
        socket = new WebSocketImpl(buildSocketUrl(locationValue, selection, cursor));
      } catch (error) {
        void error;
        scheduleReconnect(token);
        return;
      }

      const target = {
        token,
        socket,
        expectSnapshot: cursor === null,
        handlers: null,
      };
      target.handlers = {
        open() {
          if (selectionIsCurrent(token) && connection === target) {
            notifyStatus("connected");
          }
        },
        message(messageEvent) {
          if (!selectionIsCurrent(token) || connection !== target) {
            return;
          }
          let frame;
          try {
            frame = parseCharacterEventFrame(messageEvent.data, activeSelection.characterID);
          } catch (error) {
            protocolFailure(target, error);
            return;
          }
          acceptFrame(target, frame);
        },
        error() {
          if (!selectionIsCurrent(token) || connection !== target) {
            return;
          }
          notifyStatus("disconnected");
          detachConnection(target, 1000, "character event transport failed");
          scheduleReconnect(token);
        },
        close(closeEvent) {
          if (!selectionIsCurrent(token) || connection !== target) {
            return;
          }
          if (closeEvent && (closeEvent.code === 1002 || closeEvent.code === 1009)) {
            forceSnapshot = true;
          }
          notifyStatus("disconnected");
          detachConnection(target, null, "");
          scheduleReconnect(token);
        },
      };
      connection = target;
      socket.addEventListener("open", target.handlers.open);
      socket.addEventListener("message", target.handlers.message);
      socket.addEventListener("error", target.handlers.error);
      socket.addEventListener("close", target.handlers.close);
      notifyStatus("connecting");
    }

    function stop() {
      activeToken += 1;
      activeSelection = null;
      forceSnapshot = false;
      reconnectAttempt = 0;
      clearReconnect();
      if (connection) {
        detachConnection(connection, 1000, "character selection changed");
      }
    }

    return Object.freeze({
      select(selectionValue) {
        if (disposed) {
          throw new Error("The character event client has been disposed.");
        }
        const selection = normalizeSelection(selectionValue);
        stop();
        activeSelection = selection;
        activeToken += 1;
        const token = activeToken;
        openConnection(token);
        return Object.freeze({ ...selection });
      },
      stop,
      dispose() {
        if (!disposed) {
          stop();
          disposed = true;
        }
      },
      getCursor(accountID, characterID) {
        return cursorStore.get(accountID, characterID);
      },
    });
  }

  function createCoalescedTask(task, options = {}) {
    if (typeof task !== "function") {
      throw new TypeError("A coalesced task callback is required.");
    }
    const setTimer = options.setTimeout || globalThis.setTimeout.bind(globalThis);
    const clearTimer = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    let timer = null;
    let pending = false;
    let running = false;
    let disposed = false;
    let latestValue;

    function arm() {
      if (disposed || timer !== null || running || !pending) {
        return;
      }
      timer = setTimer(() => {
        timer = null;
        void run();
      }, delayMs);
    }

    async function run() {
      if (disposed || running || !pending) {
        return;
      }
      const value = latestValue;
      pending = false;
      running = true;
      try {
        await task(value);
      } catch (error) {
        onError(error);
      } finally {
        running = false;
        arm();
      }
    }

    return Object.freeze({
      schedule(value) {
        if (disposed) {
          return false;
        }
        latestValue = value;
        pending = true;
        arm();
        return true;
      },
      cancel() {
        pending = false;
        latestValue = undefined;
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
      },
      dispose() {
        if (!disposed) {
          pending = false;
          latestValue = undefined;
          if (timer !== null) {
            clearTimer(timer);
            timer = null;
          }
          disposed = true;
        }
      },
    });
  }

  return Object.freeze({
    CharacterEventProtocolError,
    PROTOCOL,
    createCharacterEventClient,
    createCoalescedTask,
    createCursorStore,
    parseCharacterEventFrame,
  });
});
