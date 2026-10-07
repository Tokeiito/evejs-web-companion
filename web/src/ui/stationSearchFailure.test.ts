import test from "node:test";
import assert from "node:assert/strict";
import { BridgeCallError } from "../bridge/callMethod.ts";
import { SEARCH_FAILED, SEARCH_NEEDS_PILOT, stationSearchFailure } from "./stationSearchFailure.ts";

test("a 401 from the station search asks for a pilot online, not a retry", () => {
  const refused = new BridgeCallError("AUTH_REQUIRED", "/api/map/find failed (HTTP 401).", 401);
  assert.equal(stationSearchFailure(refused), SEARCH_NEEDS_PILOT);
});

test("any other search failure keeps the retry wording", () => {
  assert.equal(stationSearchFailure(new BridgeCallError("BRIDGE_NETWORK_ERROR", "dropped", 0)), SEARCH_FAILED);
  assert.equal(stationSearchFailure(new BridgeCallError("BRIDGE_BAD_RESPONSE", "500", 500)), SEARCH_FAILED);
  assert.equal(stationSearchFailure(new Error("boom")), SEARCH_FAILED);
});
