"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const eveStore = require("../src/eveStore");
const mutationScope = require("../public/mutationScope");

function snapshot(stateVersion) {
  const result = {
    characters: {
      "7": {
        characterID: 7,
        accountID: 4,
        characterName: "Test Pilot",
      },
    },
    skills: {},
    skillQueues: {},
    planetRuntimeState: {},
  };
  if (stateVersion !== undefined) {
    result.stateVersion = stateVersion;
  }
  return result;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json" : null;
      },
    },
    async json() {
      return body;
    },
  };
}

function gatewayResponse(body = {}) {
  return {
    ok: true,
    source: "evejs-web-gateway",
    apiVersion: 1,
    ...body,
  };
}

test("mutating page DTOs expose the exact state version paired with their snapshot", async () => {
  const source = snapshot("opaque-runtime-epoch:42");

  const skills = await eveStore.getSkillDashboard(4, 7, { snapshot: source });
  const pi = await eveStore.getPlanetDashboard(4, 7, { snapshot: source });

  assert.equal(skills.stateVersion, "opaque-runtime-epoch:42");
  assert.equal(pi.stateVersion, "opaque-runtime-epoch:42");
  assert.equal(JSON.stringify(skills).includes("controllerID"), false);
  assert.equal(JSON.stringify(pi).includes("controllerID"), false);
});

test("mutating page DTOs reject a snapshot without a state version", async () => {
  for (const load of [eveStore.getSkillDashboard, eveStore.getPlanetDashboard]) {
    await assert.rejects(
      load(4, 7, { snapshot: snapshot(undefined) }),
      (error) => error.code === "EVE_GATEWAY_UNSUPPORTED" && error.statusCode === 502,
    );
  }
});

test("post-command DTOs reload a fresh snapshot and sanitize command-only metadata", async (t) => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.EVEJS_GATEWAY_URL;
  const originalToken = process.env.EVEJS_WEB_GATEWAY_TOKEN;
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web/v1";
  process.env.EVEJS_WEB_GATEWAY_TOKEN = "gateway-secret-token";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) {
      delete process.env.EVEJS_GATEWAY_URL;
    } else {
      process.env.EVEJS_GATEWAY_URL = originalUrl;
    }
    if (originalToken === undefined) {
      delete process.env.EVEJS_WEB_GATEWAY_TOKEN;
    } else {
      process.env.EVEJS_WEB_GATEWAY_TOKEN = originalToken;
    }
  });

  let snapshotReads = 0;
  let commandBody = null;
  global.fetch = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/snapshot")) {
      snapshotReads += 1;
      return jsonResponse(200, gatewayResponse({
        snapshot: snapshot("runtime-a:5"),
      }));
    }
    if (pathname.endsWith("/skill-queue")) {
      commandBody = JSON.parse(options.body);
      return jsonResponse(200, gatewayResponse({
        stateVersion: "runtime-a:5",
        snapshot: { queue: [] },
        controllerID: "must-not-reach-dto",
        credentials: { leaseSecret: "must-not-reach-dto" },
      }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const skills = await eveStore.saveSkillQueue(4, 7, [{ typeID: 3300, toLevel: 4 }], {
    activate: true,
    commandID: "queue-command",
    expectedStateVersion: "runtime-a:4",
    controllerID: "signed-session-id",
    snapshot: snapshot("display-version-that-must-not-be-reused"),
    queueSnapshot: { characterID: 7, queueEntries: [{ typeID: 9999, toLevel: 5 }] },
  });

  assert.equal(snapshotReads, 1, "ownership used the injected display snapshot; DTO performed one fresh read");
  assert.equal(skills.stateVersion, "runtime-a:5");
  assert.equal(skills.queueSaveSource, "evejs-web-gateway");
  assert.deepEqual(skills.queue.queue, []);
  assert.deepEqual(commandBody.command.payload, {
    entries: [{ typeID: 3300, toLevel: 4 }],
    activate: true,
  });
  const serializedSkills = JSON.stringify(skills);
  assert.equal(serializedSkills.includes("must-not-reach-dto"), false);
  assert.equal(serializedSkills.includes("signed-session-id"), false);
  assert.equal(serializedSkills.includes("gateway-secret-token"), false);
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      { ok: true, stateVersion: skills.stateVersion, dashboard: skills },
      "skill-queue",
      7,
      { expectedStateVersion: "runtime-a:4" },
    ),
    true,
  );

  snapshotReads = 0;
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/snapshot")) {
      snapshotReads += 1;
      return jsonResponse(200, gatewayResponse({ snapshot: snapshot("runtime-a:6") }));
    }
    if (pathname.endsWith("/pi/restart-extractors")) {
      return jsonResponse(200, gatewayResponse({
        stateVersion: "runtime-a:6",
        summary: {
          colonyCount: 2,
          restartedCount: 3,
          failedCount: 1,
          controllerID: "must-not-reach-dto",
          fingerprint: "must-not-reach-dto",
          credentials: { leaseSecret: "must-not-reach-dto" },
        },
      }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const pi = await eveStore.restartExtractors(4, 7, {
    planetID: 99,
    commandID: "pi-command",
    expectedStateVersion: "runtime-a:5",
    controllerID: "signed-session-id",
    snapshot: snapshot("display-version-that-must-not-be-reused"),
  });
  assert.equal(snapshotReads, 1);
  assert.equal(pi.stateVersion, "runtime-a:6");
  assert.deepEqual(pi.restartSummary, {
    colonyCount: 2,
    restartedCount: 3,
    failedCount: 1,
  });
  assert.equal(JSON.stringify(pi).includes("must-not-reach-dto"), false);
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      { ok: true, stateVersion: pi.stateVersion, dashboard: pi },
      "pi-restart",
      7,
      { expectedStateVersion: "runtime-a:5" },
    ),
    true,
  );
});
