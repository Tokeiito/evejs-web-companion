"use strict";

(function exposeCommandClient(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EveCommandClient = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createCommandClientApi() {
  const activeRequests = new WeakSet();

  function commandRequestError(message, options = {}) {
    const error = new Error(message);
    error.code = options.code || "COMMAND_REQUEST_FAILED";
    error.status = Number(options.status) || 0;
    error.payload = options.payload || {};
    error.uncertain = options.uncertain === true;
    return error;
  }

  function generateCommandID(randomUUID) {
    const generator = randomUUID || (
      globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
        : null
    );
    if (!generator) {
      throw commandRequestError("Secure command identifiers are unavailable.", {
        code: "COMMAND_ID_UNAVAILABLE",
      });
    }
    const commandID = generator();
    if (typeof commandID !== "string" || commandID.length === 0) {
      throw commandRequestError("Secure command identifier generation failed.", {
        code: "COMMAND_ID_UNAVAILABLE",
      });
    }
    return commandID;
  }

  function createRetainedCommand(expectedStateVersion, payload, options = {}) {
    if (typeof expectedStateVersion !== "string" || expectedStateVersion.length === 0) {
      throw commandRequestError("Refresh this page before submitting a command.", {
        code: "CHARACTER_STATE_VERSION_REQUIRED",
      });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw commandRequestError("A typed command payload is required.", {
        code: "CHARACTER_COMMAND_INVALID",
      });
    }

    const commandID = generateCommandID(options.randomUUID);
    const body = {
      ...payload,
      commandID,
      expectedStateVersion,
    };
    return Object.freeze({
      commandID,
      expectedStateVersion,
      serializedBody: JSON.stringify(body),
    });
  }

  function responseError(response, payload) {
    return commandRequestError(
      payload.message || payload.error || `HTTP_${response.status}`,
      {
        code: payload.error || `HTTP_${response.status}`,
        status: response.status,
        payload,
        uncertain: response.status === 503,
      },
    );
  }

  function networkError(error) {
    const result = commandRequestError("The command request could not reach the server.", {
      code: "COMMAND_NETWORK_ERROR",
      uncertain: true,
    });
    result.cause = error;
    return result;
  }

  function isValidSuccessPayload(payload, validateSuccess) {
    if (!payload || payload.ok !== true) {
      return false;
    }
    if (typeof validateSuccess !== "function") {
      return true;
    }
    try {
      const result = validateSuccess(payload);
      return result === undefined || result === true;
    } catch (error) {
      void error;
      return false;
    }
  }

  async function sendRetainedCommand(url, command, options = {}) {
    if (!command || typeof command !== "object" || typeof command.serializedBody !== "string") {
      throw commandRequestError("A retained command request is required.", {
        code: "CHARACTER_COMMAND_INVALID",
      });
    }
    if (activeRequests.has(command)) {
      throw commandRequestError("This command request is already in progress.", {
        code: "COMMAND_REQUEST_IN_FLIGHT",
      });
    }

    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const validateSuccess = options.validateSuccess;
    if (typeof fetchImpl !== "function") {
      throw commandRequestError("The command transport is unavailable.", {
        code: "COMMAND_NETWORK_ERROR",
        uncertain: true,
      });
    }

    activeRequests.add(command);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: command.serializedBody,
          });
        } catch (error) {
          if (attempt === 0) {
            continue;
          }
          throw networkError(error);
        }

        let payload = null;
        try {
          payload = await response.json();
        } catch (error) {
          void error;
        }
        if (response.status === 503 && attempt === 0) {
          continue;
        }
        if (response.ok && !isValidSuccessPayload(payload, validateSuccess)) {
          if (attempt === 0) {
            continue;
          }
          throw commandRequestError("The command response was incomplete.", {
            code: "COMMAND_RESPONSE_INVALID",
            status: response.status,
            uncertain: true,
          });
        }
        if (!response.ok || payload.ok === false) {
          throw responseError(response, payload || {});
        }
        return payload;
      }
      throw commandRequestError("The command outcome is uncertain.", {
        code: "CHARACTER_COMMAND_UNAVAILABLE",
        status: 503,
        uncertain: true,
      });
    } finally {
      activeRequests.delete(command);
    }
  }

  function isUncertainCommandError(error) {
    return Boolean(error && error.uncertain === true);
  }

  return Object.freeze({
    createRetainedCommand,
    isUncertainCommandError,
    sendRetainedCommand,
  });
});
