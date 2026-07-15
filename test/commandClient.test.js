"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const commandClient = require("../public/commandClient");

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
