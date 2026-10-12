// The name screen's two askings (chooseNameSection.py: _CheckNameValidThread and RandomizeName): a name checked as
// it is typed, and a random name for a race. Each is the account's own call, made with no pilot chosen: by the
// generic route, by the service's name, and saying nothing of a pilot. What the page sends, and how it reads what
// comes back.
//
// Until 2026-10-11 no test of the page's made either, and the game-port audit looked only at a call that said it
// was a pilot's: neither was looked at.

import test from "node:test";
import assert from "node:assert/strict";

import { rollRandomCharacterName, validateCharacterName } from "./api.ts";

/** An account's asking, with no pilot chosen: what it sent is kept, and the call's answer is the test's to say. */
function account(result: unknown) {
  const sent: [string, unknown][] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { service: string; method: string };
    sent.push([String(input), body]);
    return Response.json({ ok: true, service: body.service, method: body.method, result, notifications: [] });
  }) as typeof globalThis.fetch;
  return { sent, options: { token: "the-account's", fetch } };
}

test("a name is checked by the account's own call: the name alone, by the service's name, and nothing said of a pilot", async () => {
  const valid = account(1);
  assert.equal(await validateCharacterName("Abel Tasman", valid.options), 1);
  assert.deepEqual(valid.sent, [["/api/bridge/call", { service: "charUnboundMgr", method: "ValidateNameEx", args: ["Abel Tasman"], kwargs: null }]]);
  // A refusal's code is handed on as it came; and what is no code is no verdict.
  assert.equal(await validateCharacterName("x", account(-1).options), -1);
  assert.equal(await validateCharacterName("Abel", account(-102.9).options), -102);
  for (const none of [null, "yes", [1], { code: 1 }]) assert.equal(await validateCharacterName("Abel", account(none).options), null, JSON.stringify(none));
});

test("a random name is asked for a race: the race's number alone, by the service's name, and nothing said of a pilot", async () => {
  const named = account("Abel Tasman");
  assert.equal(await rollRandomCharacterName(1, named.options), "Abel Tasman");
  assert.deepEqual(named.sent, [["/api/bridge/call", { service: "charUnboundMgr", method: "GetValidRandomName", args: [1], kwargs: null }]]);
  const another = account("Idama Vuo");
  assert.equal(await rollRandomCharacterName(8, another.options), "Idama Vuo");
  assert.deepEqual((another.sent[0]![1] as { args: unknown }).args, [8]);
  // What is no name is none.
  for (const none of [null, 7, ["Abel"], { name: "Abel" }]) assert.equal(await rollRandomCharacterName(2, account(none).options), null, JSON.stringify(none));
});
