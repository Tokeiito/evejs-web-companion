import test from "node:test";
import assert from "node:assert/strict";

import { SCRIPT_FORMAT, SCRIPT_VERSION, type BotScript } from "../bots/botScript.ts";
import { decodeScriptText, encodeScriptDoc } from "../bots/scriptCodec.ts";
import { findRouteItemChoices } from "./routeItemSearch.ts";

test("Route Hauler finds a static type that is absent from local inventory", async () => {
  const choices = await findRouteItemChoices(
    "Metal Scraps",
    [{ typeID: 34, name: "Tritanium" }],
    async () => [{ typeID: 15331, name: "Metal Scraps" }],
  );
  assert.deepEqual(choices, [{ typeID: 15331, name: "Metal Scraps" }]);
});

test("Route Hauler item multi-selection round-trips by typeID and empty remains All", () => {
  const doc: BotScript = {
    format: SCRIPT_FORMAT,
    version: SCRIPT_VERSION,
    name: "Remote cargo selection",
    notes: "",
    home: { entity: "station", id: 60000001, name: "A", systemName: null },
    interrupts: [],
    program: [{
      id: "route",
      kind: "macro",
      macro: "route-hauler",
      args: {
        transportBay: { kind: "place", place: "cargo" },
        stationA: { kind: "station", ref: { entity: "station", id: 60000001, name: "A", systemName: null } },
        stationB: { kind: "station", ref: { entity: "station", id: 60000002, name: "B", systemName: null } },
        pickupDivisionA: { kind: "corpDivision", division: 1 },
        deliveryDivisionB: { kind: "corpDivision", division: 2 },
        itemsAToB: {
          kind: "itemList",
          items: [
            { match: "type", typeID: 34, name: "Tritanium" },
            { match: "type", typeID: 15331, name: "Metal Scraps" },
          ],
        },
        returnCargo: { kind: "toggle", enabled: true },
        pickupDivisionB: { kind: "corpDivision", division: 2 },
        deliveryDivisionA: { kind: "corpDivision", division: 1 },
        // No itemsBToA means All items in that direction.
      },
    }],
  };

  const decoded = decodeScriptText(encodeScriptDoc(doc));
  assert.equal(decoded.ok, true, decoded.ok ? "" : decoded.refusal);
  assert.ok(decoded.ok);
  const step = decoded.doc.program[0];
  assert.equal(step?.kind, "macro");
  assert.deepEqual(step?.kind === "macro" ? step.args["itemsAToB"] : null, doc.program[0]?.kind === "macro" ? doc.program[0].args["itemsAToB"] : null);
  assert.equal(step?.kind === "macro" ? step.args["itemsBToA"] : null, undefined);
});
