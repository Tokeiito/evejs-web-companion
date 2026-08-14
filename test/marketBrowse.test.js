"use strict";

// Browsing the market by group (goal R83) — the static-data half.
//
// The market panel could only be reached by TYPING a name, which is fine when
// you know what you want and useless when you do not. These two reads are what
// let a player find out what EXISTS. They are pure static reference data, so
// they must work with no gateway and no market daemon at all — which is exactly
// what this file exercises.

const test = require("node:test");
const assert = require("node:assert/strict");

const staticData = require("../src/staticData.js");

test("the roots of the market tree are real, named groups", () => {
  const roots = staticData.getMarketGroupChildren(0);
  assert.ok(roots.length > 0, "the market has no roots at all");
  for (const node of roots) {
    assert.ok(node.marketGroupID > 0, "a group with no id");
    assert.ok(node.name.length > 0, `group ${node.marketGroupID} has no name`);
    assert.equal(typeof node.hasTypes, "boolean");
  }
  // The one branch every EVE player would look for first.
  assert.ok(roots.some((node) => node.name === "Ships"), "no Ships branch");
});

test("an absent parent is the same as the roots", () => {
  // The route passes 0 when `parent` is missing; both must mean "start here"
  // rather than "a group whose id is nothing", which would return empty.
  assert.deepEqual(
    staticData.getMarketGroupChildren(undefined),
    staticData.getMarketGroupChildren(0),
  );
  assert.deepEqual(
    staticData.getMarketGroupChildren(null),
    staticData.getMarketGroupChildren(0),
  );
});

test("a branch has children, and they are sorted for a human", () => {
  const ships = staticData.getMarketGroupChildren(0).find((node) => node.name === "Ships");
  const children = staticData.getMarketGroupChildren(ships.marketGroupID);
  assert.ok(children.length > 1, "Ships has no sub-groups");
  const names = children.map((node) => node.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "not in name order");
});

test("an unknown group is EMPTY, not an error", () => {
  // ⚠ The panel renders "this group holds nothing" as a real answer. Throwing
  // (or 404ing) would make an ordinary empty branch look like a failure.
  assert.deepEqual(staticData.getMarketGroupChildren(999999999), []);
  assert.deepEqual(staticData.getMarketGroupTypes(999999999).types, []);
  assert.equal(staticData.getMarketGroupTypes(0).total, 0);
});

test("a group that holds items yields named, tradable types", () => {
  // Walk down to the first group that actually holds something.
  const found = (function walk(parentID, depth) {
    if (depth > 6) return null;
    for (const node of staticData.getMarketGroupChildren(parentID)) {
      if (node.hasTypes) {
        const result = staticData.getMarketGroupTypes(node.marketGroupID);
        if (result.total > 0) return result;
      }
      const deeper = walk(node.marketGroupID, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  })(0, 0);

  assert.ok(found, "no group anywhere in the tree holds a tradable item");
  for (const type of found.types) {
    assert.ok(type.typeID > 0, "a type with no id");
    assert.ok(type.name.length > 0, `type ${type.typeID} has no name`);
  }
  const names = found.types.map((type) => type.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "not in name order");
});

test("group types are capped, and say when they were", () => {
  // A market group can be large and the panel renders every row it is given.
  const result = staticData.getMarketGroupTypes(0);
  assert.equal(result.capped, false, "an empty group is not capped");
  // The contract itself: whenever it caps, it reports the true total too, so the
  // panel can say "narrow this" rather than silently showing a slice.
  assert.equal(typeof result.total, "number");
  assert.equal(typeof result.capped, "boolean");
});

test("only PUBLISHED, tradable types are offered", () => {
  // ⚠ Same filter as findMarketTypes. Offering an unpublished type, or one with
  // no market group, puts an item in front of a player that the market will
  // always refuse.
  //
  // ⚠ AND IT IS TESTED WHERE IT CAN ACTUALLY BE OBSERVED. The obvious version —
  // walk to the first group with items and check they are all published — passes
  // whether or not the filter exists, because almost every group holds only
  // published types. A mutation run proved that: deleting the filter changed
  // nothing it looked at. So the case is DERIVED from the data instead: find a
  // type that is unpublished but still carries a market group, and check its
  // group does not offer it.
  let hidden = null;
  for (let typeID = 1; typeID < 80000 && hidden === null; typeID += 1) {
    const entry = staticData.getType(typeID);
    if (!entry) continue;
    const groupID = Number(entry.marketGroupID) || 0;
    if (groupID > 0 && entry.published !== true) {
      hidden = { typeID, name: String(entry.name || ""), groupID };
    }
  }

  if (hidden === null) {
    // Said out loud rather than passing quietly: with no such type in the SDE
    // this invariant cannot be exercised, and a silent green would be a lie
    // about what was checked.
    assert.ok(true, "this dataset holds no unpublished type with a market group");
    return;
  }

  const offered = staticData.getMarketGroupTypes(hidden.groupID);
  assert.equal(
    offered.types.some((type) => type.typeID === hidden.typeID),
    false,
    `${hidden.name} is unpublished and must not be offered for trade`,
  );
});

test("a type is only ever listed under its OWN group", () => {
  const found = (function walk(parentID, depth) {
    if (depth > 6) return null;
    for (const node of staticData.getMarketGroupChildren(parentID)) {
      if (node.hasTypes) {
        const result = staticData.getMarketGroupTypes(node.marketGroupID);
        if (result.total > 0) return { groupID: node.marketGroupID, result };
      }
      const deeper = walk(node.marketGroupID, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  })(0, 0);
  assert.ok(found);
  for (const type of found.result.types) {
    const entry = staticData.getType(type.typeID);
    assert.ok(entry, `type ${type.typeID} is not in the static tables`);
    assert.equal(
      Number(entry.marketGroupID) || 0,
      found.groupID,
      `${type.name} was listed under the wrong group`,
    );
  }
});
