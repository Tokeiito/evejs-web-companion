// The page's asker of what its combat classifier wants to know of a type (GET /api/types/combat-utility): what
// it asks, how it reads what the BFF's static data answered, and how it asks for more types than one request
// takes.
//
// Until 2026-10-11 it asked GET /api/bridge/combat-utility-types, which makes no call of the server's, and handed
// on whatever came back. An answer with no types in it was handed on as nothing at all, and the loadout that
// asked fell over on it; more than 100 types were refused.

import test from "node:test";
import assert from "node:assert/strict";

import { combatUtilityTypes } from "./api.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A BFF whose answer to each request for types' facts is the test's to say. Says which types each request asked of. */
function recordingFetch(reply: (typeIDs: readonly number[]) => Response) {
  const asked: number[][] = [];
  const paths: string[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://bff");
    paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const typeIDs = (url.searchParams.get("typeIDs") ?? "").split(",").filter((part) => part !== "").map(Number);
    asked.push(typeIDs);
    return reply(typeIDs);
  }) as unknown as typeof fetch;
  return { fetch: fake, asked, paths };
}
const facts = (typeID: number) => ({ typeID, groupID: 65, categoryID: 7, effects: [11, 16], attributes: { 6: 1 }, capacity: 0, volume: 5 });

test("types' facts are asked of the BFF's static data by a GET outside the bridge's path, each type once, and read as facts or as not known", async () => {
  const { fetch, asked, paths } = recordingFetch(() => json({ ok: true, source: "static-data", capped: false, limit: 500, types: {
    527: facts(527), 12614: facts(12614), 34: null,
    // What is no facts, and keys that are no type's number, are nobody's.
    7001: 4, 7002: "facts", 7003: [facts(7003)], junk: facts(1), 0: facts(0), "-3": facts(3), "1.5": facts(2),
  } }));
  const types = await combatUtilityTypes([527, 12614, 527, 34, 7001, 7002, 7003, 9999, 12614], { fetch, token: "t" });
  assert.deepEqual(paths, ["GET /api/types/combat-utility"]);
  assert.deepEqual(asked, [[527, 12614, 34, 7001, 7002, 7003, 9999]]);
  // A type the tables do not know, and one not answered for, are not among what is read: the classifier goes by
  // what is there.
  assert.deepEqual(types, { 527: facts(527), 12614: facts(12614) });
});

test("an answer with no types in it is the facts unread, and not no facts known", async () => {
  for (const body of [{ ok: true }, { ok: true, types: null }, { ok: true, types: [facts(527)] }, { ok: true, types: "many" }]) {
    const { fetch } = recordingFetch(() => json(body));
    await assert.rejects(combatUtilityTypes([527], { fetch, token: "t" }), /^Error: The types' facts could not be read \(the BFF did not answer with them\)\.$/, JSON.stringify(body));
  }
  // Types asked of, and none known, is an answer.
  const { fetch } = recordingFetch(() => json({ ok: true, types: { 527: null } }));
  assert.deepEqual(await combatUtilityTypes([527], { fetch, token: "t" }), {});
});

test("more types than one request takes are asked for in several, each under the route's limit, and read together; no types, no request", async () => {
  const many = Array.from({ length: 801 }, (_, at) => 20000 + at);
  const { fetch, asked } = recordingFetch((typeIDs) => json({ ok: true, types: Object.fromEntries(typeIDs.map((typeID) => [typeID, facts(typeID)])) }));
  const types = await combatUtilityTypes(many, { fetch, token: "t" });
  assert.deepEqual(asked.map((each) => each.length), [400, 400, 1]);
  assert.deepEqual(asked.flat(), many);
  assert.deepEqual([Object.keys(types).length, types[20000]?.typeID, types[20400]?.typeID, types[20800]?.typeID], [801, 20000, 20400, 20800]);
  const none = recordingFetch(() => json({ ok: true, types: {} }));
  assert.deepEqual([await combatUtilityTypes([], { fetch: none.fetch, token: "t" }), none.asked], [{}, []]);
});

test("a request that failed fails the asking, with the BFF's own code", async () => {
  const { fetch } = recordingFetch(() => json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in." }, 401));
  await assert.rejects(combatUtilityTypes([527], { fetch, token: "t" }), (error: { code?: string }) => error.code === "AUTH_REQUIRED");
});
