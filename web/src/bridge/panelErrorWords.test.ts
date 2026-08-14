import test from "node:test";
import assert from "node:assert/strict";
import { panelErrorWords } from "./refusals.ts";
import { BridgeCallError } from "./callMethod.ts";

test("a transport failure is worded plainly, then explained", () => {
  const error = new BridgeCallError(
    "BRIDGE_NETWORK_ERROR",
    "/api/bridge/journal could not reach the BFF: signal timed out",
    0,
    "All 4 request lanes were busy and the oldest had been waiting 41s.",
  );
  const words = panelErrorWords(error);
  assert.match(words, /connection to the server dropped/);
  assert.match(words, /oldest had been waiting 41s/, "the evidence must survive");
  assert.doesNotMatch(words, /api\/bridge/, "a player must not be shown an internal route");
  assert.doesNotMatch(words, /BRIDGE_NETWORK_ERROR/, "nor a wire code");
});

test("a game refusal keeps its plain words and gains no noise", () => {
  const error = new BridgeCallError("NOT_IN_SPACE", "whatever the wire said", 409);
  assert.equal(panelErrorWords(error), "Your ship is docked. Undock before doing that.");
});

test("something that is not one of ours still says SOMETHING", () => {
  assert.equal(panelErrorWords(new Error("decode blew up")), "decode blew up");
  assert.ok(panelErrorWords(null).length > 0, "an empty panel is worse than a clumsy sentence");
  assert.ok(panelErrorWords(new Error("   ")).length > 0);
});
