// What a picker says beside each thing on grid: how far its hull is, as the
// overview's row says it.

import test from "node:test";
import assert from "node:assert/strict";

import { rowOptions } from "./gridPicker.ts";
import { buildOverviewRows } from "../space/overview.ts";
import type { SpaceEntity, SpaceSnapshot } from "../store/types.ts";

function thing(itemID: number, name: string | null, x: number, radius: number): SpaceEntity {
  return { itemID, kind: "ship", typeID: 606, groupID: 25, categoryID: 6, name, ownerID: null, radius,
    position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, isSelf: false, isNpc: false, npcEntityType: null } as unknown as SpaceEntity;
}

test("a picker's hint is the distance between hulls, in the client's wording", () => {
  const snapshot = {
    inSpace: true, solarSystemID: 30000142, shipID: 9001, sampledAtMs: 1,
    ship: { itemID: 9001, radius: 30, position: { x: 0, y: 0, z: 0 } },
    entities: [thing(1, "A gate", 5_000, 100), thing(2, "A station", 100_200, 100_000), thing(3, "A moon", 12_130, 100), thing(4, "", 700, 10)],
  } as unknown as SpaceSnapshot;
  const { rows } = buildOverviewRows(snapshot, { x: 0, y: 0, z: 0 });
  const options = rowOptions(rows, (row) => row.name ?? "");
  // Nearest hull first; the one with no name is left out.
  assert.deepEqual(options, [
    { id: 2, label: "A station", hint: "170 m" },
    { id: 1, label: "A gate", hint: `${(4870).toLocaleString()} m` },
    { id: 3, label: "A moon", hint: "12 km" },
  ]);
});
