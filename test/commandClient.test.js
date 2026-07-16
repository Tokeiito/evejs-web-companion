"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const commandClient = require("../public/commandClient");
const mutationScope = require("../public/mutationScope");

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function retainedCommand() {
  return commandClient.createRetainedCommand(
    "runtime-a:4",
    { entries: [{ typeID: 3300, toLevel: 4 }], activate: true },
    { randomUUID: () => "browser-command-id" },
  );
}

function validDashboardResponse(characterID = 7, stateVersion = "runtime-a:5") {
  return {
    ok: true,
    stateVersion,
    dashboard: {
      stateVersion,
      character: { characterID },
    },
  };
}

function validateCharacterDashboard(expectedCharacterID) {
  return (payload) => {
    assert.ok(payload.dashboard && typeof payload.dashboard === "object");
    assert.equal(Array.isArray(payload.dashboard), false);
    assert.equal(typeof payload.stateVersion, "string");
    assert.notEqual(payload.stateVersion.length, 0);
    assert.equal(payload.dashboard.stateVersion, payload.stateVersion);
    assert.equal(
      payload.dashboard.character && payload.dashboard.character.characterID,
      expectedCharacterID,
    );
  };
}

test("network, 503, and malformed-success retries reuse the exact serialized browser envelope", async () => {
  for (const firstOutcome of ["network", "503", "malformed-success"]) {
    const command = retainedCommand();
    const bodies = [];
    const fetchImpl = async (url, options) => {
      void url;
      bodies.push(options.body);
      if (bodies.length === 1 && firstOutcome === "network") {
        throw new TypeError("connection reset");
      }
      if (bodies.length === 1 && firstOutcome === "503") {
        return jsonResponse(503, {
          ok: false,
          error: "CHARACTER_COMMAND_UNAVAILABLE",
        });
      }
      if (bodies.length === 1 && firstOutcome === "malformed-success") {
        return jsonResponse(200, { dashboard: {} });
      }
      return jsonResponse(200, {
        ok: true,
        stateVersion: "runtime-a:5",
        dashboard: {},
      });
    };

    const result = await commandClient.sendRetainedCommand("/command", command, { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.deepEqual(JSON.parse(bodies[0]), {
      entries: [{ typeID: 3300, toLevel: 4 }],
      activate: true,
      commandID: "browser-command-id",
      expectedStateVersion: "runtime-a:4",
    });
  }
});

test("an uncertain command remains reusable without generating a new command ID", async () => {
  let generated = 0;
  const command = commandClient.createRetainedCommand(
    "runtime-a:4",
    { planetID: 99 },
    { randomUUID: () => {
      generated += 1;
      return "retained-pi-command";
    } },
  );
  const bodies = [];
  let calls = 0;
  const fetchImpl = async (url, options) => {
    void url;
    calls += 1;
    bodies.push(options.body);
    if (calls <= 2) {
      return jsonResponse(503, {
        ok: false,
        error: "CHARACTER_COMMAND_UNAVAILABLE",
      });
    }
    return jsonResponse(200, { ok: true, dashboard: {} });
  };

  await assert.rejects(
    commandClient.sendRetainedCommand("/pi", command, { fetchImpl }),
    (error) => error.uncertain === true && error.status === 503,
  );
  const result = await commandClient.sendRetainedCommand("/pi", command, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(generated, 1);
  assert.equal(bodies.length, 3);
  assert.equal(new Set(bodies).size, 1);
});

test("a concurrent double-submit is rejected before a second fetch", async () => {
  const command = retainedCommand();
  let fetchCalls = 0;
  let resolveFetch;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };

  const first = commandClient.sendRetainedCommand("/skills", command, { fetchImpl });
  await assert.rejects(
    commandClient.sendRetainedCommand("/skills", command, { fetchImpl }),
    (error) => error.code === "COMMAND_REQUEST_IN_FLIGHT",
  );
  assert.equal(fetchCalls, 1);

  resolveFetch(jsonResponse(200, { ok: true, dashboard: {} }));
  await first;
});

test("a definitive 409 is not retried", async () => {
  const command = retainedCommand();
  let fetchCalls = 0;
  await assert.rejects(
    commandClient.sendRetainedCommand("/skills", command, {
      async fetchImpl() {
        fetchCalls += 1;
        return jsonResponse(409, {
          ok: false,
          error: "CHARACTER_STATE_VERSION_MISMATCH",
          message: "State changed",
        });
      },
    }),
    (error) =>
      error.code === "CHARACTER_STATE_VERSION_MISMATCH" &&
      error.uncertain === false,
  );
  assert.equal(fetchCalls, 1);
});

test("a retained-ID conflict keeps the exact envelope until its settlement arrives", async () => {
  const request = retainedCommand();
  const serializedBody = request.serializedBody;
  let fetchCalls = 0;
  let conflict;
  try {
    await commandClient.sendRetainedCommand("/skills", request, {
      async fetchImpl(url, options) {
        void url;
        fetchCalls += 1;
        assert.equal(options.body, serializedBody);
        return jsonResponse(409, {
          ok: false,
          error: "CHARACTER_COMMAND_ID_REUSED",
          message: "Command ID is already retained.",
        });
      },
    });
  } catch (error) {
    conflict = error;
  }

  assert.equal(fetchCalls, 1);
  assert.equal(conflict.code, "CHARACTER_COMMAND_ID_REUSED");
  assert.equal(conflict.uncertain, true);
  assert.equal(request.serializedBody, serializedBody);
  const key = "skill-queue:7";
  const record = { request };
  const retained = new Map([[key, record]]);
  if (!commandClient.isUncertainCommandError(conflict)) {
    mutationScope.deleteMapEntryIfRecordMatches(retained, key, record);
  }
  assert.equal(retained.get(key), record);

  const settlement = Object.freeze({
    commandID: request.commandID,
    commandType: "offline.skill_queue.save",
    success: true,
    errorCode: null,
    admissionStatus: "admitted",
    stateVersion: "runtime-a:5",
  });
  assert.equal(
    mutationScope.reconcileRetainedCommandSettlement(retained, key, settlement),
    record,
  );
  const resolved = commandClient.resolveCommandErrorWithSettlement(
    conflict,
    record.authoritativeSettlement,
    request.commandID,
  );
  assert.equal(resolved.uncertain, false);
  assert.equal(resolved.code, "CHARACTER_COMMAND_SETTLED");
  assert.equal(retained.has(key), false);
  assert.equal(request.serializedBody, serializedBody);
});

test("two malformed 200 responses remain uncertain", async () => {
  const command = retainedCommand();
  let fetchCalls = 0;
  await assert.rejects(
    commandClient.sendRetainedCommand("/skills", command, {
      async fetchImpl() {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            throw new SyntaxError("truncated JSON");
          },
        };
      },
    }),
    (error) => error.code === "COMMAND_RESPONSE_INVALID" && error.uncertain === true,
  );
  assert.equal(fetchCalls, 2);
});

test("endpoint validation rejects malformed 2xx dashboards, retains the same command, and reuses exact bytes", async (t) => {
  const invalidPayloads = [
    {
      name: "bare ok true",
      payload: { ok: true },
    },
    {
      name: "missing top-level version",
      payload: {
        ok: true,
        dashboard: {
          stateVersion: "runtime-a:5",
          character: { characterID: 7 },
        },
      },
    },
    {
      name: "missing dashboard version",
      payload: {
        ok: true,
        stateVersion: "runtime-a:5",
        dashboard: { character: { characterID: 7 } },
      },
    },
    {
      name: "mismatched versions",
      payload: {
        ok: true,
        stateVersion: "runtime-a:5",
        dashboard: {
          stateVersion: "runtime-a:6",
          character: { characterID: 7 },
        },
      },
    },
    {
      name: "wrong character",
      payload: validDashboardResponse(8),
    },
  ];

  for (const invalid of invalidPayloads) {
    await t.test(invalid.name, async () => {
      const command = retainedCommand();
      const retainedReference = command;
      const serializedBody = command.serializedBody;
      const bodies = [];
      let returnValid = false;
      const fetchImpl = async (url, options) => {
        void url;
        bodies.push(options.body);
        return jsonResponse(
          200,
          returnValid ? validDashboardResponse() : invalid.payload,
        );
      };

      await assert.rejects(
        commandClient.sendRetainedCommand("/skills", command, {
          fetchImpl,
          validateSuccess: validateCharacterDashboard(7),
        }),
        (error) =>
          error.code === "COMMAND_RESPONSE_INVALID" &&
          error.status === 200 &&
          error.uncertain === true,
      );

      assert.equal(command, retainedReference);
      assert.equal(command.serializedBody, serializedBody);
      assert.equal(Object.isFrozen(command), true);
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
      assert.equal(bodies[0], serializedBody);

      returnValid = true;
      const result = await commandClient.sendRetainedCommand("/skills", command, {
        fetchImpl,
        validateSuccess: validateCharacterDashboard(7),
      });
      assert.deepEqual(result, validDashboardResponse());
      assert.equal(bodies.length, 3);
      assert.equal(new Set(bodies).size, 1);
    });
  }
});

test("a false endpoint validator result makes a 2xx response uncertain", async () => {
  const command = retainedCommand();
  const bodies = [];

  await assert.rejects(
    commandClient.sendRetainedCommand("/skills", command, {
      async fetchImpl(url, options) {
        void url;
        bodies.push(options.body);
        return jsonResponse(200, validDashboardResponse());
      },
      validateSuccess() {
        return false;
      },
    }),
    (error) => error.code === "COMMAND_RESPONSE_INVALID" && error.uncertain === true,
  );

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("a complete endpoint-validated dashboard succeeds without retry", async () => {
  const command = retainedCommand();
  let fetchCalls = 0;
  const payload = validDashboardResponse();

  const result = await commandClient.sendRetainedCommand("/skills", command, {
    async fetchImpl() {
      fetchCalls += 1;
      return jsonResponse(200, payload);
    },
    validateSuccess: validateCharacterDashboard(7),
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result, payload);
});

test("authoritative settlement resolves terminal-503 races without replacing an uncertain envelope", () => {
  const cases = ["before-http-error", "after-http-error"];
  for (const ordering of cases) {
    const request = retainedCommand();
    const serializedBody = request.serializedBody;
    const record = { request, inFlight: ordering === "before-http-error" };
    const key = "skill-queue:7";
    const retained = new Map([[key, record]]);
    const settlement = Object.freeze({
      commandID: request.commandID,
      commandType: "offline.skill_queue.save",
      success: false,
      errorCode: "CHARACTER_COMMAND_UNAVAILABLE",
      admissionStatus: "admitted",
      stateVersion: "runtime-a:5",
    });
    const uncertain = Object.assign(new Error("503"), {
      code: "CHARACTER_COMMAND_UNAVAILABLE",
      status: 503,
      uncertain: true,
    });

    if (ordering === "before-http-error") {
      assert.equal(
        mutationScope.reconcileRetainedCommandSettlement(retained, key, settlement),
        record,
      );
    } else {
      assert.equal(
        commandClient.resolveCommandErrorWithSettlement(
          uncertain,
          record.authoritativeSettlement,
          request.commandID,
        ),
        uncertain,
      );
      assert.equal(retained.get(key), record);
      assert.equal(
        mutationScope.reconcileRetainedCommandSettlement(retained, key, settlement),
        record,
      );
    }

    const definitive = commandClient.resolveCommandErrorWithSettlement(
      uncertain,
      record.authoritativeSettlement,
      request.commandID,
    );
    assert.equal(definitive.code, "CHARACTER_COMMAND_UNAVAILABLE");
    assert.equal(definitive.status, 503);
    assert.equal(definitive.uncertain, false);
    assert.equal(definitive.authoritativeSettlement, settlement);
    assert.equal(retained.has(key), false);
    assert.equal(request.serializedBody, serializedBody);
    assert.equal(Object.isFrozen(request), true);
  }
});

test("success settlements are definitive while unknown or mismatched outcomes remain uncertain", () => {
  const request = retainedCommand();
  const uncertain = Object.assign(new Error("network"), {
    code: "COMMAND_NETWORK_ERROR",
    status: 0,
    uncertain: true,
  });
  const success = {
    commandID: request.commandID,
    success: true,
    errorCode: null,
  };
  const resolved = commandClient.resolveCommandErrorWithSettlement(
    uncertain,
    success,
    request.commandID,
  );
  assert.equal(resolved.code, "CHARACTER_COMMAND_SETTLED");
  assert.equal(resolved.uncertain, false);
  assert.equal(resolved.authoritativeSettlement, success);
  assert.equal(
    commandClient.resolveCommandErrorWithSettlement(
      uncertain,
      { ...success, commandID: "another-command" },
      request.commandID,
    ),
    uncertain,
  );
  assert.equal(
    commandClient.resolveCommandErrorWithSettlement(uncertain, null, request.commandID),
    uncertain,
  );
});
