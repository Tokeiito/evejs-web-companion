// The R2 page controller against a faked BFF: login runs the typed reference
// call into the store, select-character brings the station slice online and
// issues the three docked reads on the live session, release/session-loss
// drop back to offline.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow, isSessionLost } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { BridgeCallError } from "../bridge/callMethod.ts";

const CHARACTER_ROW = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["characterID", 140000003],
      ["characterName", "Test Three"],
      ["stationID", 60003760],
    ],
  },
};

const SELECTION_TUPLE = [
  { type: "list", items: [] },
  [null, null],
  { type: "list", items: [CHARACTER_ROW] },
  { type: "list", items: [] },
];

const SELECT_RESPONSE = {
  ok: true,
  character: {
    characterID: 140000003,
    characterName: "Test Three",
    stationID: 60003760,
    structureID: null,
    solarSystemID: 30000142,
    corporationID: 98000000,
  },
  station: {
    stationID: 60003760,
    stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    solarSystemName: "Jita",
    regionName: "The Forge",
    stationTypeID: 1529,
    stationTypeName: "Caldari Administrative Station",
    operationID: 26,
    security: 0.9,
  },
  notifications: [],
};

interface RecordedRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

type Responder = (path: string, body: Record<string, unknown>) => {
  status: number;
  body: unknown;
};

function makeFakeFetch(responder: Responder): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fakeFetch = (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, body });
    const outcome = responder(path, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

function bridgeCallResponder(path: string, body: Record<string, unknown>) {
  if (path === "/api/login") {
    return {
      status: 200,
      body: { ok: true, account: { accountID: 2, username: "test2" } },
    };
  }
  if (path === "/api/bridge/select") {
    return { status: 200, body: SELECT_RESPONSE };
  }
  if (path === "/api/bridge/release" || path === "/api/logout") {
    return { status: 200, body: { ok: true, released: true } };
  }
  if (path === "/api/bridge/call") {
    const method = String(body.method || "");
    if (method === "GetCharacterSelectionData") {
      return {
        status: 200,
        body: {
          ok: true,
          service: "charUnboundMgr",
          method,
          result: SELECTION_TUPLE,
          notifications: [],
        },
      };
    }
    if (method === "GetStationItemBits") {
      return {
        status: 200,
        body: {
          ok: true,
          service: "stationSvc",
          method,
          result: [1000035, 60003760, 26, 1529],
          notifications: [],
        },
      };
    }
    if (method === "GetGuests") {
      return {
        status: 200,
        body: {
          ok: true,
          service: "station",
          method,
          result: { type: "list", items: [[140000003, 98000000, null, null]] },
          notifications: [],
        },
      };
    }
    if (method === "GetStationInfo") {
      return {
        status: 200,
        body: {
          ok: true,
          service: "map",
          method,
          result: {
            type: "object",
            name: {
              value: "carbon.common.script.net.objectCaching.CachedMethodCallResult",
            },
            args: [],
          },
          notifications: [],
        },
      };
    }
  }
  return { status: 500, body: { ok: false, error: "UNEXPECTED_REQUEST" } };
}

test("login signs in and fills the character list from the typed reference call", async () => {
  const { fetch, requests } = makeFakeFetch(bridgeCallResponder);
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "whatever");

  assert.equal(store.session.get().phase, "logged-in");
  assert.equal(store.session.get().accountID, 2);
  assert.equal(store.character.get().characters.length, 1);
  assert.equal(store.character.get().characters[0]?.characterName, "Test Three");
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/api/login", "/api/bridge/call"],
  );
});

test("selectCharacter brings the character online and runs the three docked reads", async () => {
  const { fetch, requests } = makeFakeFetch(bridgeCallResponder);
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await flow.selectCharacter(140000003);

  const slice = store.station.get();
  assert.equal(slice.online?.characterID, 140000003);
  assert.equal(slice.station?.stationName, SELECT_RESPONSE.station.stationName);
  assert.deepEqual(slice.bits, {
    ownerID: 1000035,
    stationID: 60003760,
    operationID: 26,
    stationTypeID: 1529,
  });
  assert.equal(slice.guests.length, 1);
  assert.equal(slice.stationInfoCached, true);

  const dockedReads = requests
    .filter((request) => request.path === "/api/bridge/call")
    .map((request) => `${request.body.service}.${request.body.method}`);
  assert.deepEqual(dockedReads.slice(1).sort(), [
    "map.GetStationInfo",
    "station.GetGuests",
    "stationSvc.GetStationItemBits",
  ]);
  // The browser never handles the bridgeSessionID: no request body carries one.
  assert.ok(requests.every((request) => !("bridgeSessionID" in request.body)));
});

test("releaseSession puts the flow back to character select", async () => {
  const { fetch } = makeFakeFetch(bridgeCallResponder);
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  await flow.releaseSession();

  assert.equal(store.station.get().online, null);
  assert.equal(store.session.get().phase, "logged-in", "release keeps the login");
});

test("a lost live session surfaces SESSION_NOT_FOUND and flips the store offline", async () => {
  const { fetch } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/call" && body.method !== "GetCharacterSelectionData") {
      return {
        status: 404,
        body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
      };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await assert.rejects(flow.selectCharacter(140000003), (error: unknown) => {
    assert.equal(isSessionLost(error), true);
    assert.ok(error instanceof BridgeCallError);
    return true;
  });
  assert.equal(store.station.get().online, null, "session loss flips the slice offline");
});

test("select refusals propagate the handler's message and leave the flow at character select", async () => {
  const { fetch } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/select") {
      return {
        status: 409,
        body: { ok: false, error: "CALL_REFUSED", message: "Test Three is already online." },
      };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await assert.rejects(flow.selectCharacter(140000003), (error: unknown) => {
    assert.ok(error instanceof BridgeCallError);
    assert.equal(error.code, "CALL_REFUSED");
    assert.match(error.message, /already online/i);
    return true;
  });
  assert.equal(store.station.get().online, null);
});

test("logout clears the whole store", async () => {
  const { fetch } = makeFakeFetch(bridgeCallResponder);
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  await flow.logout();

  assert.equal(store.session.get().phase, "logged-out");
  assert.equal(store.character.get().characters.length, 0);
  assert.equal(store.station.get().online, null);
});
