import test from "node:test";
import assert from "node:assert/strict";

import { createCapabilityCache, type CapabilityScope } from "./scriptCapabilities.ts";

const scope = (shipID: number, fittingSignature: string): CapabilityScope => ({
  shipID,
  fittingSignature,
});

test("capability cache refreshes for an active-hull change and reuses an unchanged fit", async () => {
  const loads: CapabilityScope[] = [];
  const cache = createCapabilityCache(
    { value: [11], scope: scope(100, "old-fit") },
    async (requested) => {
      loads.push(requested);
      return { value: [requested.shipID ?? 0], scope: requested };
    },
  );

  assert.deepEqual(await cache.read(scope(100, "old-fit")), [11]);
  assert.deepEqual(loads, [], "the start-time capabilities are still current");
  assert.deepEqual(await cache.read(scope(200, "new-hull-fit")), [200]);
  assert.deepEqual(loads, [scope(200, "new-hull-fit")]);
  assert.deepEqual(await cache.read(scope(200, "new-hull-fit")), [200]);
  assert.equal(loads.length, 1, "an unchanged new hull is not re-read every tick");
});

test("refit invalidation refreshes capabilities even when the active hull id is unchanged", async () => {
  let generation = 1;
  const cache = createCapabilityCache(
    { value: [10], scope: scope(100, "fit-a") },
    async (requested) => ({ value: [10 + generation++], scope: requested }),
  );

  cache.invalidate();
  assert.deepEqual(await cache.read(scope(100, "fit-a")), [11]);
  assert.deepEqual(
    await cache.read(scope(100, "fit-b")),
    [12],
    "a fitting-slice change also refreshes without an explicit action marker",
  );
});
