import test from "node:test";
import assert from "node:assert/strict";
import { dispatchSupportCollectionAction } from "./supportCollectionFlow.ts";
import { getMiningCompressionCompatibility } from "./api.ts";
import type { Ask } from "../bridge/ask.ts";
// The page's own asking, where a test makes no call of the server's by it.
const noCall: Ask = async () => { throw new Error("no call of the server's was to be made"); };
test("split/reminted/merged response is acknowledged through own claimed, scoped one-transfer authority", async () => {
  for (const moved of [[101], []]) {
    const calls: { path: string; body: unknown; token: string | null }[] = [];
    const receipt = await dispatchSupportCollectionAction({ kind: "transfer", containerID: 201, itemID: 101, typeID: 1230, quantity: 20, bay: "ore" }, "run",
      { shipID: 10, solarSystemID: 3001 }, { token: "own", fetch: async (path, init) => {
        calls.push({ path: String(path), body: JSON.parse(String(init?.body)), token: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ ok: true, applied: true, moved, reminted: moved.length ? [] : [101], declined: [], notFound: [], transferStatus: "SUCCESS" }));
      } }, noCall);
    assert.equal(receipt.acknowledged, true);
    assert.deepEqual(calls, [{ path: "/api/bridge/inventory/transfer", body: { itemIDs: [101], from: { kind: "container", itemID: 201 },
      to: { kind: "shipBay", bay: "ore" }, qty: 20, claimRunID: "run", expectedScope: { shipID: 10, solarSystemID: 3001 } }, token: "Bearer own" }]);
  }
});
test("compression is held to its own ship and system, preserves the raw tuple for proof, and never transfers remote ore", async () => {
  // The page's own call since 2026-10-14 (bridge/compressionWrites.ts), made after the flight is read, as the route
  // read it before the call.
  const compress = { kind: "compress", itemID: 301, typeID: 1230, quantity: 100, bay: "ore", facilityID: 10, outputTypeID: 62516 } as const;
  const scope = { shipID: 10, solarSystemID: 3001 };
  const flightOf = (shipID: number) => ({ token: "own", fetch: async (path: unknown) => {
    calls.push(String(path));
    return new Response(JSON.stringify({ ok: true, flight: { inSpace: true, shipID, solarSystemID: 3001 }, notifications: [] }));
  } });
  const calls: unknown[] = [];
  const act: Ask = async (service, method, args) => {
    calls.push([service, method, args]);
    return [301, 1230, 100, 301, 62516, 100];
  };
  const receipt = await dispatchSupportCollectionAction(compress, "run", scope, flightOf(10), act);
  assert.deepEqual(receipt, { acknowledged: true, compressionTuple: [301, 1230, 100, 301, 62516, 100] });
  assert.deepEqual(calls, ["/api/bridge/flight/status", ["inSpaceCompressionMgr", "CompressItemInSpace", [301, 10]]]);

  calls.length = 0;
  await assert.rejects(dispatchSupportCollectionAction(compress, "run", scope, flightOf(11), act), /authority changed/);
  assert.deepEqual(calls, ["/api/bridge/flight/status"], "a changed ship refuses before the call");
});
test("static compatibility is bounded read-only and malformed identity/rules fail unknown", async () => {
  let calls = 0;
  const options = { token: "own", fetch: async (_path: unknown, init?: RequestInit) => {
    calls++; assert.equal(init?.method ?? "GET", "GET");
    return new Response(JSON.stringify({ ok: true, compatibility: [{ typeID: 999, compressedTypeID: 62516, matchingTypeListIDs: [334], availability: "available" }] }));
  } };
  assert.equal(await getMiningCompressionCompatibility([1230], [334], options), null);
  assert.equal(await getMiningCompressionCompatibility([], [334], options), null); assert.equal(calls, 1);
});
