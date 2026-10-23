// What the account may redeem, and what a claim made of it (redeemsvc.py; redeemItemsContainer.py).

import test from "node:test";
import assert from "node:assert/strict";

import { REDEEM_NOTICE, decodeRedeemOutcome, decodeRedeemTokens, tokenKey } from "./redeem.ts";
import { claimRedeemTokens } from "./redeemWrites.ts";
import { readRedeemTokens } from "./redeemReads.ts";
import type { JsonValue } from "./wire.ts";

// 2026-10-19 00:00 UTC as a FILETIME.
const FILETIME = (ms: number): JsonValue => ({ type: "long", value: String(BigInt(ms) * 10000n + 116444736000000000n) });
const DAY = Date.UTC(2026, 9, 19);

const fields = (row: Record<string, JsonValue>): JsonValue => ({ type: "packedrow", fields: row });
const crowset = (rows: readonly JsonValue[]): JsonValue => ({ type: "objectex2", name: "carbon.common.script.sys.crowset.CRowset", list: rows });

test("the tokens are a CRowset's packed rows, read by name", () => {
  const tokens = decodeRedeemTokens(crowset([
    fields({ tokenID: 101, massTokenID: null, typeID: 49810, quantity: 1, blueprintRuns: 0, label: { type: "wstring", value: "Daily Login Reward" }, description: { type: "wstring", value: "" }, dateTime: FILETIME(DAY), expireDateTime: null, availableDateTime: FILETIME(DAY), stationID: null, soulbound: 0 }),
    fields({ tokenID: 102, massTokenID: 202, typeID: 34, quantity: 5000, blueprintRuns: 0, label: "UI/Redeem/Something", description: "598041", dateTime: FILETIME(DAY), expireDateTime: FILETIME(DAY + 86400000), stationID: 60003760, soulbound: 1 }),
    // A row with no token or no type is none.
    fields({ tokenID: 0, typeID: 34 }),
    fields({ tokenID: 103, typeID: null }),
  ]));
  assert.deepEqual(tokens, [
    { tokenID: 101, massTokenID: null, typeID: 49810, quantity: 1, blueprintRuns: 0, label: "Daily Login Reward", description: "", addedAt: DAY, expiresAt: null, soulbound: false },
    // A message ID or a localization label is no words to the page.
    { tokenID: 102, massTokenID: 202, typeID: 34, quantity: 5000, blueprintRuns: 0, label: "", description: "", addedAt: DAY, expiresAt: DAY + 86400000, soulbound: true },
  ]);
  assert.deepEqual(tokens!.map(tokenKey), [[101, null], [102, 202]]);
});

test("a util.Rowset of the tokens reads the same, and an answer that is none is null, not an empty queue", () => {
  const rowset: JsonValue = { type: "object", name: "util.Rowset", args: { type: "dict", entries: [
    ["header", { type: "list", items: ["tokenID", "massTokenID", "typeID", "quantity"] }],
    ["lines", { type: "list", items: [[7, 7, 34, 2]] }],
  ] } };
  assert.deepEqual(decodeRedeemTokens(rowset)?.map((token) => [token.tokenID, token.massTokenID, token.quantity]), [[7, 7, 2]]);
  assert.deepEqual(decodeRedeemTokens(crowset([])), []);
  assert.equal(decodeRedeemTokens(null), null);
  assert.equal(REDEEM_NOTICE, "OnRedeemingQueueUpdated");
});

test("a claim's answer says what was refused, how many items were made and where", () => {
  const error = (msg: string): JsonValue => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["msg", msg], ["dict", { type: "dict", entries: [] }]] } });
  const answer: JsonValue = { type: "dict", entries: [
    ["errors", { type: "list", items: [[102, error("RedeemNoDestination")]] }],
    ["itemsCreated", { type: "list", items: [{ type: "dict", entries: [] }, { type: "dict", entries: [] }] }],
    ["stationID", 60003760],
  ] };
  assert.deepEqual(decodeRedeemOutcome(answer), { errors: [{ tokenID: 102, message: "RedeemNoDestination" }], itemsCreated: 2, stationID: 60003760 });
  assert.deepEqual(decodeRedeemOutcome(null), { errors: [], itemsCreated: 0, stationID: null });
});

test("the claim is the client's call: the tokens' keys, the character, and the home station by keyword", async () => {
  const made: unknown[] = [];
  const act = async (...call: unknown[]): Promise<JsonValue> => { made.push(call); return { type: "dict", entries: [["stationID", 60003760]] }; };
  const token = decodeRedeemTokens(crowset([fields({ tokenID: 101, massTokenID: null, typeID: 34 })]))![0]!;
  const outcome = await claimRedeemTokens(act, [token], 90000001, true);
  assert.deepEqual(made, [["userSvc", "ClaimRedeemTokens", [[[101, null]], 90000001], { useHomeStation: true }]]);
  assert.equal(outcome.stationID, 60003760);
  await assert.rejects(claimRedeemTokens(act, [], 90000001, false), /Select something/);
  assert.equal(made.length, 1);
});

test("through a transport that does not carry the read, there are no tokens to be had", async () => {
  const refused = Object.assign(new Error("not allowed"), { code: "CALL_NOT_ALLOWED" });
  assert.equal(await readRedeemTokens(async () => { throw refused; }), null);
  await assert.rejects(readRedeemTokens(async () => { throw new Error("down"); }), /down/);
});

test("training certificates are rejected before an ordinary claim, including mixed selections", async () => {
  const [certificate, ordinary] = decodeRedeemTokens(crowset([
    fields({ tokenID: 101, typeID: 63188, quantity: 1, soulbound: 1 }),
    fields({ tokenID: 102, typeID: 34, quantity: 10 }),
  ]))!;
  const calls: unknown[] = [];
  const act = async (...call: unknown[]): Promise<JsonValue> => {
    calls.push(call);
    return { type: "dict", entries: [["errors", { type: "list", items: [] }]] };
  };
  for (const selection of [[certificate!], [ordinary!, certificate!]]) {
    await assert.rejects(claimRedeemTokens(act, selection, 90000001, true), /EVE client/);
    assert.equal(calls.length, 0, "no part of an unsupported selection may be redeemed");
  }
  await claimRedeemTokens(act, [ordinary!], 90000001, true);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as unknown[])[2], [[[102, null]], 90000001]);
});
