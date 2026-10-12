"use strict";

// Volatile evidence for one hosted ore-only whole-stack invocation. This is
// mutation custody, not a container ownership registry or crash journal.
const SOURCE_FLAGS = new Set([5, 134, 135, 181, 182]);
const positive = value => Number.isSafeInteger(value) && value > 0;
const ids = value => Array.isArray(value) && value.length <= 64 && value.every(positive) && new Set(value).size === value.length;
const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
const unresolved = value => value && ["issued-pending", "ambiguous"].includes(value.state);

function inventoryRows(result) {
  let value = result;
  if (value?.type === "objectex1" && value.header?.[0]?.value === "__builtin__.set") value = value.header[1]?.[0];
  if (value?.type !== "list" || !Array.isArray(value.items)) return null;
  const rows = value.items.map(item => item?.type === "packedrow" ? item.fields : item);
  if (rows.some(row => !row || !positive(row.itemID) || !positive(row.typeID) || !positive(row.ownerID) ||
      !positive(row.locationID) || !Number.isSafeInteger(row.flagID) || !positive(row.quantity ?? row.stacksize)) ||
      new Set(rows.map(row => row.itemID)).size !== rows.length) return null;
  return rows.map(row => ({ itemID: row.itemID, typeID: row.typeID, ownerID: row.ownerID,
    locationID: row.locationID, flagID: row.flagID, quantity: row.quantity ?? row.stacksize,
    categoryID: row.categoryID ?? null }));
}

// Why a scene is not the pilot's own to act in: the first thing wrong with it, in
// words for whoever reads the refusal. Null when nothing is.
function sceneFault(scene, pilotID) {
  const ship = scene?.ship;
  if (scene?.inSpace !== true) return "the pilot is not in space";
  if (!positive(scene.shipID)) return "the scene names no ship of the pilot's";
  if (!positive(scene.solarSystemID)) return "the scene names no solar system";
  if (ship?.itemID !== scene.shipID) return "the scene has no record of the pilot's own ship";
  if (ship.characterID !== pilotID) return "the scene's ship is not said to be flown by this pilot";
  if (!Number.isFinite(scene.sampledAtMs)) return "the scene does not say when it was read";
  if (!Array.isArray(scene.entities)) return "the scene has no list of what is in it";
  const containers = scene.entities.filter(row => row.kind === "container");
  if (containers.some(row => !positive(row.itemID) || !positive(row.ownerID))) return "a container in the scene has no id or no owner";
  if (new Set(containers.map(row => row.itemID)).size !== containers.length) return "a container is in the scene twice";
  return null;
}

function sceneContext(scene, pilotID) {
  if (sceneFault(scene, pilotID) !== null) return null;
  const containers = scene.entities.filter(row => row.kind === "container");
  return { shipID: scene.shipID, systemID: scene.solarSystemID, sceneSampledAtMs: scene.sampledAtMs,
    ownedContainerIDs: containers.filter(row => row.ownerID === pilotID).map(row => row.itemID) };
}

// What else is wrong before anything may be sent, the first of them, in words.
function prepareFault({ scope, invocation, context, rows, itemIDs, nowMs }) {
  if (!ids(itemIDs) || !itemIDs.length) return "the items asked for are not a list of item ids";
  if (!Array.isArray(rows)) return "the ship's holds could not be read";
  if (!invocation || typeof invocation.runID !== "string" || !invocation.runID || invocation.runID.length > 100 ||
      !positive(invocation.invocationID) || typeof invocation.stepPath !== "string" || invocation.stepPath.length > 200)
    return "the asking does not say which run, which of its askings and which step it is";
  const missing = ["botID", "runGeneration", "operationID", "targetKey"].filter(key => !scope[key])
    .concat(Number.isFinite(scope.targetClaimedAt) ? [] : ["targetClaimedAt"]);
  if (missing.length) return `the bot's scope has no ${missing.join(", ")}`;
  if (context.systemID !== scope.systemID) return "the pilot is in another solar system than its target's";
  if (context.shipID !== scope.shipID) return "the pilot is in another ship than the bot's";
  if (!Number.isFinite(nowMs)) return "the clock could not be read";
  return null;
}

// Why an item is not one a hosted jettison takes. Null when it is.
function itemFault(row, scope) {
  if (!row) return "is not in the ship's holds";
  if (row.ownerID !== scope.pilotID) return "is not the pilot's";
  if (row.locationID !== scope.shipID) return "is not in this ship";
  if (!SOURCE_FLAGS.has(row.flagID)) return "is not in a hold that ore is jettisoned from";
  if (row.categoryID !== 25) return "is not ore";
  if (!positive(row.quantity)) return "has no quantity";
  return null;
}

function prepare({ scope, invocation, scene, rows, itemIDs, nowMs }) {
  // Each refusal says which thing was wrong: a bot's log is all there is to go by
  // when a hosted jettison is never issued.
  const context = sceneContext(scene, scope.pilotID);
  const fault = sceneFault(scene, scope.pilotID) ?? prepareFault({ scope, invocation, context, rows, itemIDs, nowMs });
  if (fault !== null)
    throw Object.assign(new Error(`Jettison pre-dispatch authority is unreadable: ${fault}.`), { code: "JETTISON_NOT_ISSUED" });
  const selected = itemIDs.map(id => rows.find(row => row.itemID === id));
  const refused = selected.findIndex(row => itemFault(row, scope) !== null);
  if (refused >= 0)
    throw Object.assign(new Error(`Only exact owned whole ore stacks support hosted recovery: item ${itemIDs[refused]} ${itemFault(selected[refused], scope)}.`),
      { code: "JETTISON_NOT_ISSUED" });
  const before = rows.filter(row => selected.some(item => item.flagID === row.flagID));
  return copy({ state: "not-issued", scope: { ...scope, ...invocation }, preparedAtMs: nowMs,
    sceneSampledAtMs: context.sceneSampledAtMs, sourceBefore: before, items: selected,
    existingContainerIDs: context.ownedContainerIDs, issuedAtMs: null, observedAtMs: null,
    resultMovedIDs: null, resultLaunchedIDs: null, sourceAfter: null, containerID: null, reason: null });
}

function issued(custody, nowMs) {
  if (custody?.state !== "not-issued") throw new Error("Jettison invocation was already issued.");
  return { ...custody, state: "issued-pending", issuedAtMs: nowMs };
}

function resultIDs(result) {
  const tuple = Array.isArray(result) ? result : result?.type === "tuple" || result?.type === "list" ? result.items : null;
  const list = value => Array.isArray(value) ? value : value?.type === "list" ? value.items : null;
  const moved = list(tuple?.[0]), launched = list(tuple?.[1]);
  return tuple?.length === 2 && ids(moved) && ids(launched) ? { moved, launched } : null;
}

function reconcile(custody, { scope, scene, rows, containers, result, nowMs }) {
  if (!custody) return null;
  const answer = result === undefined ? null : resultIDs(result);
  const next = { ...custody, sourceAfter: copy(rows), observedAtMs: nowMs,
    ...(answer ? { resultMovedIDs: answer.moved, resultLaunchedIDs: answer.launched } : {}) };
  const ambiguous = reason => ({ ...next, state: "ambiguous", reason });
  if (!scope || Object.keys(custody.scope).filter(key => !["runID", "invocationID", "stepPath"].includes(key))
      .some(key => scope[key] !== custody.scope[key])) return ambiguous("JETTISON_SCOPE_CHANGED");
  const context = sceneContext(scene, custody.scope.pilotID);
  if (!context || context.shipID !== custody.scope.shipID || context.systemID !== custody.scope.systemID ||
      context.sceneSampledAtMs < custody.sceneSampledAtMs || !Array.isArray(rows) || !Array.isArray(containers))
    return ambiguous("JETTISON_OBSERVATION_UNKNOWN");
  // A completed proof remains exact custody even if an ordinary hauler later
  // empties/despawns the can. Never manufacture an emptied mark here.
  if (custody.state === "confirmed-created" || custody.state === "confirmed-no-ore-mutation") return { ...next, reason: null };
  if (custody.state === "not-issued" || custody.state === "refused-before-dispatch") return { ...next, reason: null };
  const old = new Set(custody.existingContainerIDs);
  const candidates = context.ownedContainerIDs.filter(id => !old.has(id));
  const before = custody.sourceBefore;
  const flags = new Set(custody.items.map(row => row.flagID));
  const after = rows.filter(row => flags.has(row.flagID));
  const same = (a, b) => a?.itemID === b?.itemID && a.typeID === b.typeID && a.quantity === b.quantity &&
    a.ownerID === b.ownerID && a.locationID === b.locationID && a.flagID === b.flagID;
  const selected = new Set(custody.items.map(row => row.itemID));
  const removed = custody.items.every(row => !after.some(item => item.itemID === row.itemID));
  const untouched = before.filter(row => !selected.has(row.itemID));
  const remainingExact = after.length === untouched.length && untouched.every(row => same(row, after.find(item => item.itemID === row.itemID)));
  if (removed && remainingExact && candidates.length === 1) {
    const can = containers.find(row => row.itemID === candidates[0]);
    if (!can || can.ownerID !== custody.scope.pilotID || !Array.isArray(can.items) || can.items.length !== custody.items.length)
      return ambiguous("JETTISON_CONTAINER_CONTENTS_UNKNOWN");
    const exact = custody.items.every(item => {
      const found = can.items.find(row => row.itemID === item.itemID);
      return found && found.ownerID === item.ownerID && found.typeID === item.typeID && found.quantity === item.quantity &&
        found.locationID === can.itemID && found.flagID === 0;
    });
    const moved = next.resultMovedIDs;
    if (exact && (moved === null || moved.length === selected.size && moved.every(id => selected.has(id))) &&
        (next.resultLaunchedIDs === null || next.resultLaunchedIDs.length === 0))
      return { ...next, state: "confirmed-created", containerID: can.itemID, reason: null };
    return ambiguous("JETTISON_CONTAINER_MANIFEST_MISMATCH");
  }
  const unchanged = after.length === before.length && before.every(row => same(row, after.find(item => item.itemID === row.itemID)));
  if (unchanged && candidates.length === 0 && next.resultMovedIDs?.length === 0 && next.resultLaunchedIDs?.length === 0)
    return { ...next, state: "confirmed-no-ore-mutation", reason: null };
  return ambiguous(candidates.length > 1 ? "JETTISON_MULTIPLE_CANDIDATES" : "JETTISON_OUTCOME_UNCONFIRMED");
}

module.exports = { SOURCE_FLAGS, copy, unresolved, inventoryRows, sceneContext, prepare, issued, resultIDs, reconcile };
