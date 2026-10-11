// The page's asker of a type's volume (GET /api/types/volumes): what it asks, how it reads what the BFF's static
// data answered, and how it asks for more types than one request takes.
//
// A volume is what a thing measures. Null is "the tables have none", and is kept apart from a type that was not
// answered for at all: the flow asks again for the second, and never for the first.

import test from "node:test";
import assert from "node:assert/strict";

import { loadTypeVolumes } from "./api.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A BFF whose answer to each request for volumes is the test's to say. Says which types each request asked of. */
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

test("a type's volume is asked of the BFF's static data by a GET, with the types' numbers, and read as a number or as none", async () => {
  const { fetch, asked, paths } = recordingFetch(() => json({ ok: true, source: "static-data", capped: false, limit: 500, volumes: {
    588: 15800, 34: 0.01, 7001: null, 7002: 0, 7003: -5, 7004: "12", 7005: true,
    // Keys that are no type's number are nobody's volume.
    junk: 4, 0: 4, "-3": 4, "1.5": 4,
  } }));
  const { volumes } = await loadTypeVolumes([588, 34, 7001, 7002, 7003, 7004, 7005, 9999], { fetch, token: "t" });
  assert.deepEqual(paths, ["GET /api/types/volumes"]);
  assert.deepEqual(asked, [[588, 34, 7001, 7002, 7003, 7004, 7005, 9999]]);
  // A volume is a number above nought, or none. A type the answer has nothing for is not in what is read.
  assert.deepEqual(volumes, { 588: 15800, 34: 0.01, 7001: null, 7002: null, 7003: null, 7004: null, 7005: null });
  assert.equal(Object.hasOwn(volumes, 9999), false);
});

test("an answer with no volumes in it reads as nothing answered for", async () => {
  // (A list has places, and a place is no type's number: its second, 1, would be read as type 1's volume.)
  for (const body of [{ ok: true }, { ok: true, volumes: null }, { ok: true, volumes: [15800, 16500] }, { ok: true, volumes: "many" }]) {
    const { fetch } = recordingFetch(() => json(body));
    assert.deepEqual((await loadTypeVolumes([588], { fetch, token: "t" })).volumes, {}, JSON.stringify(body));
  }
});

test("more types than one request takes are asked for in several, each under the route's limit, and read together", async () => {
  const many = Array.from({ length: 801 }, (_, at) => 20000 + at);
  const { fetch, asked } = recordingFetch((typeIDs) => json({ ok: true, volumes: Object.fromEntries(typeIDs.map((typeID) => [typeID, typeID / 10])) }));
  const { volumes } = await loadTypeVolumes(many, { fetch, token: "t" });
  assert.deepEqual(asked.map((each) => each.length), [400, 400, 1]);
  assert.deepEqual(asked.flat(), many);
  assert.deepEqual([Object.keys(volumes).length, volumes[20000], volumes[20400], volumes[20800]], [801, 2000, 2040, 2080]);
  // No types, no request.
  const none = recordingFetch(() => json({ ok: true, volumes: {} }));
  assert.deepEqual([(await loadTypeVolumes([], { fetch: none.fetch, token: "t" })).volumes, none.asked], [{}, []]);
});

test("a request that failed fails the asking, with the BFF's own code", async () => {
  const { fetch } = recordingFetch(() => json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in." }, 401));
  await assert.rejects(loadTypeVolumes([588], { fetch, token: "t" }), (error: { code?: string }) => error.code === "AUTH_REQUIRED");
});
