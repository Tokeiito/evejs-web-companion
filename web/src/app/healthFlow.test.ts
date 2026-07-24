// The boot health ping (flow.checkHealth). Online only when the BFF answers ok
// AND its gateway status reports ready; everything else — not-ready gateway, a
// 500, an unreachable BFF — is offline. Never throws.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

function fetchFor(outcome: { status?: number; body?: unknown; throws?: boolean }): typeof fetch {
  return (async (input: unknown) => {
    if (outcome.throws) {
      throw new TypeError("Failed to fetch");
    }
    assert.equal(String(input).endsWith("/api/health"), true, "checkHealth hit the wrong path");
    const status = outcome.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
}

async function statusAfterHealth(outcome: Parameters<typeof fetchFor>[0]): Promise<string> {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: fetchFor(outcome) });
  assert.equal(store.get().health.status, "unknown", "starts unknown before the ping");
  await flow.checkHealth();
  return store.get().health.status;
}

test("online when the BFF is ok and the gateway is ready", async () => {
  assert.equal(await statusAfterHealth({ body: { ok: true, gateway: { ready: true } } }), "online");
});

test("offline when the gateway is not ready (EveJS runtime down)", async () => {
  assert.equal(
    await statusAfterHealth({ body: { ok: true, gateway: { available: true, ready: false } } }),
    "offline",
  );
});

test("offline when the BFF itself reports not-ok (500)", async () => {
  assert.equal(await statusAfterHealth({ status: 500, body: { ok: false } }), "offline");
});

test("offline when the BFF is unreachable (fetch throws) — no throw escapes", async () => {
  assert.equal(await statusAfterHealth({ throws: true }), "offline");
});

test("offline when the payload has no gateway block at all", async () => {
  assert.equal(await statusAfterHealth({ body: { ok: true } }), "offline");
});
