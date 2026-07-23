// The target-bracket model (targetBracket.ts): mapping locked/acquiring ids to
// snapshot entities, order, and the out-of-view flag.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTargets } from "./targetBracket.ts";
import type { SpaceEntity } from "../store/types.ts";

function entity(over: Partial<SpaceEntity> & { itemID: number }): SpaceEntity {
  return {
    kind: "ship",
    typeID: 587,
    groupID: null,
    categoryID: null,
    name: "Rifter",
    ownerID: null,
    radius: 30,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    isSelf: false,
    shieldRatio: 1,
    armorRatio: 1,
    hullRatio: 1,
    characterID: null,
    corporationID: null,
    allianceID: null,
    securityStatus: null,
    maxVelocity: null,
    mode: null,
    capacitorRatio: null,
    remainingQuantity: null,
    miningYieldTypeID: null,
    beltID: null,
    isNpc: false,
    npcEntityType: null,
    ...over,
  } as SpaceEntity;
}

test("locked targets come first, acquiring after, in order", () => {
  const ents = [entity({ itemID: 1 }), entity({ itemID: 2 }), entity({ itemID: 3 })];
  const vms = buildTargets([1, 2], [3], ents);
  assert.deepEqual(vms.map((v) => v.itemID), [1, 2, 3]);
  assert.deepEqual(vms.map((v) => v.acquiring), [false, false, true]);
});

test("a target's condition comes from its snapshot entity", () => {
  const ents = [entity({ itemID: 5, name: "Guristas Wight", shieldRatio: 0.4, armorRatio: 0.9, hullRatio: 1 })];
  const [vm] = buildTargets([5], [], ents);
  assert.equal(vm!.entityName, "Guristas Wight");
  assert.equal(vm!.shield, 0.4);
  assert.equal(vm!.armor, 0.9);
  assert.equal(vm!.inView, true);
});

test("a locked id the snapshot no longer carries is kept but flagged out-of-view", () => {
  const [vm] = buildTargets([9], [], [entity({ itemID: 1 })]);
  assert.equal(vm!.itemID, 9);
  assert.equal(vm!.inView, false);
  assert.equal(vm!.entityName, null);
  assert.equal(vm!.shield, null);
});

test("an id both acquiring and locked is not listed twice (locked wins)", () => {
  const vms = buildTargets([7], [7], [entity({ itemID: 7 })]);
  assert.equal(vms.length, 1);
  assert.equal(vms[0]!.acquiring, false);
});
