// Character creation through the page controller, against a faked BFF.
//
// Two things are worth a test here and the rest is the BFF's job.
//
// First: the roster the select screen shows afterwards comes from RE-READING
// charUnboundMgr.GetCharacterSelectionData, not from splicing a row in locally.
// That is what makes the new pilot's name, ship, corp and SP the server's own
// view of what it made — and what makes a create that produced nothing leave the
// list alone instead of adding a phantom the select would refuse.
//
// Second: the write is confirm-gated at the BFF, so the flow must actually send
// `confirm: true`. Without it the route answers CONFIRMATION_REQUIRED and no
// character is created — a failure that would otherwise only show up live.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { BridgeCallError } from "../bridge/callMethod.ts";

const NEW_CHARACTER_ID = 140000042;

function characterRow(characterID: number, characterName: string) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["characterID", characterID],
        ["characterName", characterName],
        ["stationID", 60015249],
      ],
    },
  };
}

function selectionTuple(rows: readonly unknown[]) {
  return [
    { type: "list", items: [] },
    [null, null],
    { type: "list", items: rows },
    { type: "list", items: [] },
  ];
}

interface RecordedRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/**
 * A BFF whose roster GROWS when a character is created — the behaviour the
 * re-read depends on. A fake that always answered the same list would pass
 * whether or not the flow re-read anything.
 */
function makeFakeBff(options: { createStatus?: number; createBody?: unknown } = {}) {
  const requests: RecordedRequest[] = [];
  const roster = [characterRow(140000005, "Farmer")];

  const fakeFetch = (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, body });

    const respond = (status: number, payload: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return payload;
      },
    });

    if (path === "/api/login") {
      return respond(200, { ok: true, account: { accountID: 2, username: "test2" } });
    }
    if (path === "/api/bridge/character/create-with-doll") {
      if (options.createStatus && options.createStatus !== 200) {
        return respond(options.createStatus, options.createBody);
      }
      roster.push(characterRow(NEW_CHARACTER_ID, "Zaphod Beeblebrox"));
      return respond(200, {
        ok: true,
        applied: true,
        result: NEW_CHARACTER_ID,
        characterID: NEW_CHARACTER_ID,
        bloodlineID: 11,
        ancestryID: 32,
        notifications: [],
      });
    }
    if (path === "/api/bridge/call") {
      const method = String(body.method || "");
      if (method === "GetCharacterSelectionData") {
        return respond(200, {
          ok: true,
          service: "charUnboundMgr",
          method,
          result: selectionTuple([...roster]),
          notifications: [],
        });
      }
      return respond(200, { ok: true, service: "charUnboundMgr", method, result: null, notifications: [] });
    }
    return respond(404, { ok: false, error: "UNEXPECTED_PATH", message: path });
  }) as unknown as typeof fetch;

  return { fetch: fakeFetch, requests };
}

function readCharacters(store: ReturnType<typeof createClientStore>) {
  let names: readonly string[] = [];
  const stop = store.character.subscribe((slice) => {
    names = slice.characters.map((row) => row.characterName);
  });
  stop();
  return names;
}

test("a created character appears in the roster, re-read from the server", async () => {
  const store = createClientStore();
  const bff = makeFakeBff();
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.login("test2", "");
  assert.deepEqual(readCharacters(store), ["Farmer"]);

  const created = await flow.createCharacter({
    name: "Zaphod Beeblebrox",
    raceID: 1,
    genderID: 1,
    bloodlineID: 11,
    ancestryID: 32,
  });

  assert.equal(created.characterID, NEW_CHARACTER_ID);
  // What the server rolled comes back, so the screen can say what it made.
  assert.equal(created.bloodlineID, 11);
  assert.equal(created.ancestryID, 32);
  assert.deepEqual(readCharacters(store), ["Farmer", "Zaphod Beeblebrox"]);

  // The roster came from a SECOND reference call after the write, not from the
  // login's one.
  const selectionReads = bff.requests.filter(
    (request) =>
      request.path === "/api/bridge/call" && request.body.method === "GetCharacterSelectionData",
  );
  assert.equal(selectionReads.length, 2);
  const order = bff.requests.map((request) => request.path);
  assert.ok(
    order.lastIndexOf("/api/bridge/call") > order.indexOf("/api/bridge/character/create-with-doll"),
    "the roster is re-read AFTER the create, not before",
  );
});

test("the create write carries confirm — the BFF refuses without it", async () => {
  const store = createClientStore();
  const bff = makeFakeBff();
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.login("test2", "");
  await flow.createCharacter({ name: "Zaphod Beeblebrox", raceID: 1, genderID: 0 });

  const write = bff.requests.find(
    (request) => request.path === "/api/bridge/character/create-with-doll",
  );
  assert.equal(write?.body.confirm, true);
  assert.equal(write?.body.name, "Zaphod Beeblebrox");
  assert.equal(write?.body.raceID, 1);
  // 0 (female) is a real choice and must survive as 0, not be dropped as falsy.
  assert.equal(write?.body.genderID, 0);
  // Omitted picks are OMITTED, not sent as 0 — the BFF reads absence as "roll
  // one", and a 0 would be a positive id it would have to reject.
  assert.equal("bloodlineID" in (write?.body ?? {}), false);
  assert.equal("ancestryID" in (write?.body ?? {}), false);
});

test("a refused create leaves the roster alone and surfaces the server's reason", async () => {
  const store = createClientStore();
  const bff = makeFakeBff({
    createStatus: 400,
    createBody: {
      ok: false,
      error: "BLOODLINE_INVALID",
      message: "That bloodline does not belong to that race.",
    },
  });
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.login("test2", "");
  await assert.rejects(
    () => flow.createCharacter({ name: "Zaphod Beeblebrox", raceID: 1, genderID: 1, bloodlineID: 5 }),
    (error: unknown) => {
      assert.ok(error instanceof BridgeCallError);
      assert.equal(error.code, "BLOODLINE_INVALID");
      assert.match(error.message, /does not belong to that race/);
      return true;
    },
  );

  assert.deepEqual(readCharacters(store), ["Farmer"]);
  // A failed write must not have triggered a roster re-read either.
  const selectionReads = bff.requests.filter(
    (request) =>
      request.path === "/api/bridge/call" && request.body.method === "GetCharacterSelectionData",
  );
  assert.equal(selectionReads.length, 1);
});
