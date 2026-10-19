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
  // R2: signing in to an EXISTING account (no accountCreated in the response)
  // must not claim the login minted it.
  assert.equal(store.session.get().accountCreated, false);
  assert.equal(store.character.get().characters.length, 1);
  assert.equal(store.character.get().characters[0]?.characterName, "Test Three");
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/api/login", "/api/bridge/call"],
  );
});

test("a login that auto-created the account carries the flag into the session slice (R2)", async () => {
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/login") {
      return {
        status: 200,
        body: {
          ok: true,
          account: { accountID: 9, username: "fresh-capsuleer" },
          accountCreated: true,
          characters: [],
        },
      };
    }
    if (path === "/api/bridge/call") {
      // A brand-new account's selection read answers zero characters.
      return {
        status: 200,
        body: {
          ok: true,
          service: "charUnboundMgr",
          method: "GetCharacterSelectionData",
          result: [
            { type: "list", items: [] },
            [null, null],
            { type: "list", items: [] },
            { type: "list", items: [] },
          ],
          notifications: [],
        },
      };
    }
    return { status: 500, body: { ok: false, error: "UNEXPECTED_REQUEST" } };
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("fresh-capsuleer", "");

  assert.equal(store.session.get().phase, "logged-in");
  assert.equal(store.session.get().accountCreated, true);
  assert.equal(store.character.get().characters.length, 0);
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

  const dockedReads = requests
    .filter((request) => request.path === "/api/bridge/call")
    .map((request) => `${request.body.service}.${request.body.method}`);
  // The two docked reads (the map's stations are not asked since 2026-10-14: the client asks them once in a session as
  // its station service sets up, station/base.py 185, and the game port's transport asks them so); and beside them
  // what the choosing reads of the pilot itself, each by the page's own call since 2026-10-10 where it was a route's:
  // its crimewatch states and its clone's grade; the account's redeem tokens, as the client's redeem service fetches
  // them as the neocom is set up (redeemsvc.py 37 to 46); and the account's daily login campaign, as the client's login
  // campaign service asks it as its neocom button is set up (loginCampaignService.py 111).
  assert.deepEqual(dockedReads.slice(1).sort(), [
    "crimewatch.GetClientStates",
    "loginCampaignManager.get_client_campaign_state",
    "station.GetGuests",
    "stationSvc.GetStationItemBits",
    "subscriptionMgr.GetCloneGrade",
    "userSvc.GetRedeemTokens",
  ]);
  assert.deepEqual(requests.map((request) => request.path).filter((path) => path === "/api/bridge/crimewatch" || path === "/api/bridge/clone-grade"), []);
  // The browser never handles the bridgeSessionID: no request body carries one.
  assert.ok(requests.every((request) => !("bridgeSessionID" in request.body)));
});

test("a structure selection keeps its real identity and reads accessible services without NPC station calls", async () => {
  const structureID = 1030000000002;
  const { fetch, requests } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/select") {
      return { status: 200, body: { ...SELECT_RESPONSE,
        character: { ...SELECT_RESPONSE.character, stationID: null, structureID }, station: null } };
    }
    if (path === `/api/dockable-structures/${structureID}/services`) {
      return { status: 200, body: { ok: true, structureID, serviceIDs: [1, 2, 3] } };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });
  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  const station = store.station.get();
  assert.equal(station.online?.structureID, structureID);
  assert.equal(station.online?.stationID, null);
  assert.deepEqual(station.structureServiceIDs, [1, 2, 3]);
  assert.equal(station.station, null);
  // None of an NPC station's three reads, each told by its service and its method.
  const calls = requests.filter((request) => request.path === "/api/bridge/call").map((request) => `${String(request.body.service)}.${String(request.body.method)}`);
  assert.deepEqual(calls.filter((pair) => ["stationSvc.GetStationItemBits", "station.GetGuests", "map.GetStationInfo"].includes(pair)), []);
  // The guests asked for are the structure's, of the structure guests service and by the structure
  // (structureGuests.py 25), and no other call names an NPC station's method.
  assert.deepEqual(requests.filter((request) => request.path === "/api/bridge/call" &&
    ["GetStationItemBits", "GetGuests", "GetStationInfo"].includes(String(request.body.method))).map((request) => [request.body.service, request.body.method, request.body.args]),
  [["structureGuests", "GetGuests", [structureID]]]);
});

test("a failed docked read does not blank the other", async () => {
  // The cold-start blocker: one read failing must not take down the
  // whole panel or throw invisibly after the view has switched. (The failing read was the map's stations until
  // 2026-10-14, when the page stopped asking them; it is the station's item now.)
  const { fetch } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/call" && body.method === "GetStationItemBits") {
      return {
        status: 502,
        body: { ok: false, error: "EVE_GATEWAY_TIMEOUT", message: "EveJS gateway timed out." },
      };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  // Must NOT reject: the failure is non-fatal and surfaced through the store.
  await flow.selectCharacter(140000003);

  const slice = store.station.get();
  assert.equal(slice.online?.characterID, 140000003, "character stays online");
  assert.equal(slice.guests.length, 1, "guest list still loaded");
  assert.equal(slice.bits, null, "the failed read left its slice untouched");
  assert.match(slice.readError ?? "", /GetStationItemBits/, "the failure is visible in the panel");
});

test("a clean refresh clears a stale docked-read error", async () => {
  let failInfo = true;
  const { fetch } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/call" && body.method === "GetStationItemBits" && failInfo) {
      return { status: 502, body: { ok: false, error: "EVE_GATEWAY_TIMEOUT", message: "timed out" } };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  assert.ok(store.station.get().readError, "first entry recorded the read error");

  failInfo = false;
  await flow.refreshStationPanel();
  assert.equal(store.station.get().readError, null, "a clean refresh clears the error");
  assert.equal(store.station.get().bits?.stationID, 60003760, "the recovered read applied");
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

test("a lost session on the inventory tab unwinds to character select", async () => {
  let killInventory = false;
  const { fetch } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/inventory" && killInventory) {
      return { status: 404, body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" } };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  assert.equal(store.station.get().online?.characterID, 140000003);

  killInventory = true;
  await assert.rejects(flow.loadInventory(), (error: unknown) => isSessionLost(error));
  assert.equal(
    store.station.get().online,
    null,
    "a dead session on the inventory tab must flip offline, not leave stale rows mounted",
  );
});

test("isSessionLost treats a gone session AND a taken-over character as lost", () => {
  // Both codes mean the held session can no longer act; a multibox re-select of
  // a character being flown elsewhere yields NO_LIVE_SESSION, so it must count.
  assert.equal(isSessionLost(new BridgeCallError("SESSION_NOT_FOUND", "gone", 404)), true);
  assert.equal(
    isSessionLost(new BridgeCallError("NO_LIVE_SESSION", "No character is online.", 409)),
    true,
    "a taken-over character (NO_LIVE_SESSION) is a lost session too",
  );
  assert.equal(isSessionLost(new BridgeCallError("CALL_REFUSED", "nope", 400)), false);
  assert.equal(isSessionLost(new Error("plain")), false);
});

test("a taken-over character (NO_LIVE_SESSION) flips the slice offline so the pilot is pruned", async () => {
  // The exact R107 zombie-cockpit bug: another client took the character, so
  // reads come back NO_LIVE_SESSION. The space read must unwind to offline, not
  // sit there erroring on every panel.
  let taken = false;
  const { fetch } = makeFakeFetch((path, body) => {
    if (path === "/api/bridge/space/snapshot" && taken) {
      return { status: 409, body: { ok: false, error: "NO_LIVE_SESSION", message: "No character is online." } };
    }
    return bridgeCallResponder(path, body);
  });
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });

  await flow.login("test2", "");
  await flow.selectCharacter(140000003);
  assert.equal(store.station.get().online?.characterID, 140000003);

  taken = true;
  // The read rethrows the lost-session error after flipping offline (it unwinds
  // the poll); the point is the slice went offline so App prunes the pilot.
  await assert.rejects(flow.loadSpaceSnapshot(), (error: unknown) => isSessionLost(error));
  assert.equal(
    store.station.get().online,
    null,
    "a taken-over character must flip offline, not linger as a broken cockpit",
  );
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
