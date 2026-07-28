import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const emptyDict = { type: "dict", entries: [] } as const;
const SYSTEM_A = 30000142;
const SYSTEM_B = 30000144;

function scanEnvelope(cell: unknown, solarSystemID = SYSTEM_A) {
  return { ok: true, solarSystemID, reads: { GetFullState: cell } };
}

function operationsEnvelope(solarSystemID = SYSTEM_A) {
  return {
    ok: true,
    scanner: {
      inSpace: true,
      solarSystemID,
      shipID: 9001,
      maxActiveProbes: 8,
      launcher: null,
      probes: [],
    },
  };
}

test("loadScanner keeps a successful empty current-system scan distinct from unavailable", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/bridge/bound-small-services") {
      return json(scanEnvelope({ result: [emptyDict, emptyDict, emptyDict, emptyDict] }));
    }
    if (url === "/api/bridge/formations") {
      return json({ ok: true, formations: null });
    }
    if (url === "/api/bridge/scanner/state") return json(operationsEnvelope());
    throw new Error(`unexpected fetch: ${url}`);
  };

  const store = createClientStore();
  await createAppFlow(store, { fetch }).loadScanner();

  assert.deepEqual(calls.sort(), [
    "/api/bridge/bound-small-services",
    "/api/bridge/formations",
    "/api/bridge/scanner/state",
  ]);
  const scanner = store.get().scanner;
  assert.equal(scanner.loaded, true);
  assert.equal(scanner.loading, false);
  assert.equal(scanner.solarSystemID, SYSTEM_A);
  assert.equal(scanner.scan.status, "ready");
  if (scanner.scan.status === "ready") {
    assert.deepEqual(scanner.scan.value.anomalies, []);
    assert.deepEqual(scanner.scan.value.signatures, []);
  }
  assert.equal(scanner.formations.status, "ready");
});

test("a failed GetFullState arm stays unavailable while formation data remains useful", async () => {
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/bridge/bound-small-services") {
      return json(scanEnvelope({ error: "CALL_REFUSED", message: "scanner offline" }));
    }
    if (url === "/api/bridge/formations") {
      return json({ ok: true, formations: [["Diamond", [[0, 1, 2]]]] });
    }
    if (url === "/api/bridge/scanner/state") return json(operationsEnvelope());
    throw new Error(`unexpected fetch: ${url}`);
  };

  const store = createClientStore();
  await createAppFlow(store, { fetch }).loadScanner();

  const scanner = store.get().scanner;
  assert.equal(scanner.scan.status, "unavailable");
  assert.equal(scanner.formations.status, "ready");
  if (scanner.formations.status === "ready") {
    assert.equal(scanner.formations.value.formations[0]?.name, "Diamond");
  }
});

test("probe reconnect confirms the write and always follows it with authoritative reads", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: String(init.method ?? "GET"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    if (url === "/api/bridge/scanner/reconnect") {
      return json({ ok: true, applied: true, result: null, notifications: [] });
    }
    if (url === "/api/bridge/bound-small-services") {
      return json(scanEnvelope({ result: [emptyDict, emptyDict, emptyDict, emptyDict] }));
    }
    if (url === "/api/bridge/formations") {
      return json({ ok: true, formations: null });
    }
    if (url === "/api/bridge/scanner/state") return json(operationsEnvelope());
    throw new Error(`unexpected fetch: ${url}`);
  };

  const store = createClientStore();
  await createAppFlow(store, { fetch }).reconnectScannerProbes();

  assert.deepEqual(calls[0], {
    url: "/api/bridge/scanner/reconnect",
    method: "POST",
    body: { confirm: true },
  });
  assert.deepEqual(
    calls.slice(1).map((call) => call.url).sort(),
    [
      "/api/bridge/bound-small-services",
      "/api/bridge/formations",
      "/api/bridge/scanner/state",
    ],
  );
  assert.equal(store.get().scanner.scan.status, "ready");
});

test("launch, analyze, and recover use no-input product routes and re-read afterward", async () => {
  const actions = [
    ["launchScannerProbes", "/api/bridge/scanner/launch"],
    ["analyzeScannerSignatures", "/api/bridge/scanner/analyze"],
    ["recoverScannerProbes", "/api/bridge/scanner/recover"],
  ] as const;
  for (const [method, expectedPath] of actions) {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: String(init.method ?? "GET"),
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      if (url === expectedPath) return json({ ok: true, applied: true });
      if (url === "/api/bridge/bound-small-services") {
        return json(scanEnvelope({ result: [emptyDict, emptyDict, emptyDict, emptyDict] }));
      }
      if (url === "/api/bridge/formations") return json({ ok: true, formations: null });
      if (url === "/api/bridge/scanner/state") return json(operationsEnvelope());
      throw new Error(`unexpected fetch: ${url}`);
    };
    const flow = createAppFlow(createClientStore(), { fetch });
    await flow[method]();
    assert.deepEqual(calls[0], {
      url: expectedPath,
      method: "POST",
      body: { confirm: true },
    });
    assert.equal(calls.length, 4, "one write plus all three scanner reads");
  }
});

test("loadScanFullState rejects a failed per-arm read instead of inventing no anomalies", async () => {
  const fetch: typeof globalThis.fetch = async () =>
    json(scanEnvelope({ error: "CALL_REFUSED", message: "scanner offline" }));
  const { loadScanFullState } = await import("./api.ts");
  await assert.rejects(
    () => loadScanFullState({ fetch }),
    /scanner state is unavailable/i,
  );
});

test("a system change clears the old scan and automatically reads the new system", async () => {
  let solarSystemID = SYSTEM_A;
  let scanReads = 0;
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/bridge/bound-small-services") {
      scanReads += 1;
      return json(scanEnvelope({ result: [emptyDict, emptyDict, emptyDict, emptyDict] }, solarSystemID));
    }
    if (url === "/api/bridge/formations") return json({ ok: true, formations: null });
    if (url === "/api/bridge/scanner/state") return json(operationsEnvelope(solarSystemID));
    if (url === "/api/bridge/flight/status") {
      return json({
        ok: true,
        flight: {
          inSpace: true,
          docked: false,
          solarSystemID,
          stationID: null,
          structureID: null,
          shipID: 9001,
          shipMode: "STOP",
          shipSpeedFraction: 0,
        },
        notifications: [],
      });
    }
    if (url === "/api/names") return json({ ok: true, names: {} });
    throw new Error(`unexpected fetch: ${url}`);
  };

  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });
  await flow.loadFlightStatus();
  await flow.loadScanner();
  assert.equal(store.get().scanner.solarSystemID, SYSTEM_A);

  solarSystemID = SYSTEM_B;
  await flow.loadFlightStatus();
  for (let attempt = 0; attempt < 20 && store.get().scanner.solarSystemID !== SYSTEM_B; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(store.get().scanner.solarSystemID, SYSTEM_B);
  assert.equal(store.get().scanner.scan.status, "ready");
  assert.equal(scanReads, 2, "the old system and the new system are each read once");
});
