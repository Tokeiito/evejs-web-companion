// What the account may redeem, on the page (redeemsvc.py).
//
// The retail client's redeem service fetches the tokens as the neocom is set up, at the server's
// OnRedeemingQueueUpdated (162 to 169), and after a claim (127). The page reads them at the same moments, and claims
// them as the redeem window does (redeemItemsContainer.py redeem, 343 to 356).

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 90000001;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

const crowset = (ids: readonly number[]) => ({
  type: "objectex2", name: "carbon.common.script.sys.crowset.CRowset",
  list: ids.map((tokenID) => ({ type: "packedrow", fields: { tokenID, massTokenID: null, typeID: 34, quantity: 10, label: { type: "wstring", value: "Daily Login Reward" } } })),
});

/** A pilot online with its live channel open; `state.tokens` is what the read answers now, "not carried" the gateway's. */
async function online(tokens: readonly number[] | "not carried" = [101, 102]) {
  const store = createClientStore();
  const state: { tokens: readonly number[] | "not carried" } = { tokens };
  const reads: unknown[] = [];
  const claims: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: body.characterID, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 1000044 }, droneRecoveryCheckID: "check-1" };
    } else if (path === "/api/bridge/call" && body.service === "userSvc" && body.method === "GetRedeemTokens") {
      reads.push(body);
      if (state.tokens === "not carried") {
        status = 403;
        answer = { ok: false, error: "CALL_NOT_ALLOWED", message: "userSvc.GetRedeemTokens is not on the web-call allowlist." };
      } else {
        answer = { ok: true, service: body.service, method: body.method, result: crowset(state.tokens), notifications: [] };
      }
    } else if (path === "/api/bridge/call" && body.service === "userSvc" && body.method === "ClaimRedeemTokens") {
      claims.push(body);
      const sent = (body.args as [number, null][][])[0]!.map((key) => key[0]);
      state.tokens = (state.tokens as readonly number[]).filter((id) => !sent.includes(id));
      answer = { ok: true, service: body.service, method: body.method, notifications: [],
        result: { type: "dict", entries: [["errors", { type: "list", items: [] }], ["itemsCreated", { type: "list", items: sent.map(() => ({ type: "dict", entries: [] })) }], ["stationID", 60003760]] } };
    } else if (path === "/api/bridge/call") {
      answer = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    }
    return { ok: status >= 200 && status < 300, status, async json() { return answer; } };
  }) as unknown as typeof fetch;
  const sources: PushSource[] = [];
  const eventSource = (): PushSource => {
    const source: PushSource = { onmessage: null, onopen: null, onerror: null, close() {} };
    sources.push(source);
    return source;
  };
  const flow = createAppFlow(store, { fetch: fetchImpl, eventSource });
  await flow.selectCharacter(PILOT);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const source = sources[0];
  assert.ok(source, "coming online opens the live channel");
  source.onopen?.();
  let sequence = 0;
  const push = async (method: string, args: readonly unknown[]) => {
    sequence += 1;
    source.onmessage?.({ data: JSON.stringify({
      source: "evejs-web-gateway", apiVersion: 1, type: "event", cursor: { epoch: "epoch-1", sequence },
      event: { kind: "notification", notification: { kind: "client", service: null, method, args, kwargs: null } },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  const held = () => store.redeem.get().tokens?.map((token) => token.tokenID) ?? null;
  return { store, flow, state, push, reads, claims, held };
}

test("a pilot that comes online has the account's tokens read, by the client's call, and again at the server's notice", async () => {
  const pilot = await online();
  assert.deepEqual(pilot.held(), [101, 102]);
  assert.equal(pilot.reads.length, 1);
  assert.deepEqual([(pilot.reads[0] as { args: unknown }).args, (pilot.reads[0] as { pilot?: unknown }).pilot], [[], true]);
  pilot.state.tokens = [101, 102, 103];
  await pilot.push("OnRedeemingQueueUpdated", [90000001, []]);
  assert.deepEqual([pilot.held(), pilot.reads.length], [[101, 102, 103], 2]);
  // Another notice reads nothing.
  await pilot.push("OnSubscriptionChangedServer", [1]);
  assert.equal(pilot.reads.length, 2);
  // Gone offline: nothing is held for nobody.
  pilot.store.apply({ type: "character/offline" } as never);
  assert.equal(pilot.held(), null);
});

test("a claim is the redeem window's call for the pilot, and what is left is read after it", async () => {
  const pilot = await online();
  const [first] = pilot.store.redeem.get().tokens!;
  const outcome = await pilot.flow.redeemTokens([first!], true);
  assert.equal(pilot.claims.length, 1);
  const claim = pilot.claims[0]!;
  assert.deepEqual([claim.args, claim.kwargs, claim.pilot, claim.confirm], [[[[101, null]], PILOT], { useHomeStation: true }, true, true]);
  assert.deepEqual(outcome, { errors: [], itemsCreated: 1, stationID: 60003760 });
  assert.deepEqual([pilot.held(), pilot.reads.length], [[102], 2]);
});

test("a pilot whose transport does not carry the read has no tokens, and no error", async () => {
  const pilot = await online("not carried");
  assert.deepEqual([pilot.held(), pilot.store.redeem.get().error, pilot.reads.length], [null, null, 1]);
});
