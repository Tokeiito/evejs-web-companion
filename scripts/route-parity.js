"use strict";

// One route flown on each pilot transport in turn, through the BFF's own routes.
//
//   node scripts/route-parity.js <gatewayBffUrl> <gamePortBffUrl> <account> <characterID> <gateID> [reportPath.json]
//
// The pilot starts docked. On each BFF in turn it is taken through the same
// trip, with the calls the browser's autopilot makes and nothing else:
//
//   undock                                   POST /api/bridge/flight/undock
//   warp to the gate, to 0                   POST /api/bridge/flight/warp {destinationID, minRange: 0}
//   wait to be out of warp                   GET  /api/bridge/flight/status, once a second
//   jump                                     POST /api/bridge/flight/jump {fromGateID}
//   look around in the next system           GET  /api/bridge/space/snapshot
//   fly up to the gate arrived at            POST /api/bridge/flight/approach {destinationID}
//   jump back through it                     POST /api/bridge/flight/jump {fromGateID}, asked until in range
//   warp to the station, to 0, and dock      POST /api/bridge/flight/warp, /dock
//
// On the gateway every answer is the server's own scene. On the game port the
// pilot's ballpark is kept by the BFF as the retail client keeps one: the warp
// is flown by that park, "out of warp" is the park dropping the ship out, and
// the jump replaces the park with one for the new system. This sets the two
// passes side by side: where each ended up, how long each leg took, and what
// each saw.
//
// ⚠ It FLIES A REAL CHARACTER through a gate and back, twice, on the server
// the BFFs are pointed at. If a leg does not finish the character is left
// where it was and the script says so.

const fs = require("node:fs");
const { hold } = require("./space-parity");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Ask a route until it answers 200, for as long as it answers 409 (not yet: too far, a timer, on its way). */
async function insist(pilot, method, route, body, { tries = 40, everyMs = 2000 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return { payload: await pilot.ask(method, route, body), refusals: attempt, last };
    } catch (error) {
      if (!/ answered 409: /.test(String(error.message))) throw error;
      last = String(error.message).replace(/^.* answered 409: /, "").slice(0, 160);
      await sleep(everyMs);
    }
  }
  throw new Error(`${method} ${route} was still refused after ${tries} tries: ${last}`);
}

/** Warp to something and wait to be out of warp again. Answers how the leg went. */
async function warpTo(pilot, destinationID, { timeoutMs = 240000 } = {}) {
  const startedAt = Date.now();
  await insist(pilot, "POST", "/api/bridge/flight/warp", { destinationID, minRange: 0 }, { tries: 10 });
  const leg = { destinationID, secondsToEnterWarp: null, secondsInWarp: null, modes: [] };
  let enteredAt = null;
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`The warp to ${destinationID} did not finish in ${timeoutMs / 1000} s (modes seen: ${leg.modes.join(" ")}).`);
    await sleep(1000);
    const { flight } = await pilot.ask("GET", "/api/bridge/flight/status");
    if (leg.modes.at(-1) !== flight.shipMode) leg.modes.push(flight.shipMode);
    const space = await pilot.snapshot();
    const speed = space.ship ? Math.hypot(space.ship.velocity.x, space.ship.velocity.y, space.ship.velocity.z) : 0;
    leg.topSpeed = Math.max(leg.topSpeed ?? 0, speed);
    // In warp proper: far faster than the ship can fly.
    if (enteredAt === null && space.ship && speed > (space.ship.maxVelocity ?? 0) * 3) {
      enteredAt = Date.now();
      leg.secondsToEnterWarp = Math.round((enteredAt - startedAt) / 1000);
    }
    if (enteredAt !== null && flight.shipMode !== "WARP") {
      leg.secondsInWarp = Math.round((Date.now() - enteredAt) / 1000);
      const target = space.entities.find((row) => row.itemID === destinationID);
      leg.metresFromTarget = target && space.ship ? Math.max(0, apart(space.ship.position, target.position) - target.radius - space.ship.radius) : null;
      leg.capacitorAfter = space.ship ? space.ship.capacitorRatio : null;
      return leg;
    }
  }
}

/** Jump through a gate and wait to be in another system. Answers where, and what is there. */
async function jump(pilot, fromGateID) {
  const before = (await pilot.ask("GET", "/api/bridge/flight/status")).flight;
  const startedAt = Date.now();
  // A ship that has just come through a gate is put some kilometres from it, and a gate is used from within 2,500 m.
  // The autopilot flies up to it and asks again; so does this.
  await insist(pilot, "POST", "/api/bridge/flight/approach", { destinationID: fromGateID }, { tries: 5 });
  const { payload, refusals, last } = await insist(pilot, "POST", "/api/bridge/flight/jump", { fromGateID }, { tries: 120 });
  let flight = payload.flight;
  for (let waited = 0; flight.solarSystemID === before.solarSystemID && waited < 60000; waited += 1000) {
    await sleep(1000);
    flight = (await pilot.ask("GET", "/api/bridge/flight/status")).flight;
  }
  if (flight.solarSystemID === before.solarSystemID) throw new Error(`The jump through ${fromGateID} was answered, but the pilot is still in ${before.solarSystemID}.`);
  // A client is sent the new system in pieces: everything fixed in it first, and what is on the gate's own grid a couple
  // of ticks later. Look once the count has stopped changing, not at the first thing that arrives.
  let space = await pilot.snapshot();
  const secondsToSettle = { first: space.entities.length, settledAfter: null };
  for (let waited = 0, steady = 0; waited < 30000 && steady < 4; waited += 1000) {
    await sleep(1000);
    const next = await pilot.snapshot();
    steady = next.ship && next.entities.length === space.entities.length ? steady + 1 : 0;
    if (steady === 1) secondsToSettle.settledAfter = waited / 1000;
    space = next;
  }
  const gates = space.entities.filter((row) => row.kind === "stargate").map((row) => ({ itemID: row.itemID, name: row.name, metres: space.ship ? apart(row.position, space.ship.position) : null }))
    .sort((a, b) => a.metres - b.metres);
  const kinds = {};
  for (const row of space.entities) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
  return {
    fromGateID,
    refusalsBeforeAccepted: refusals,
    lastRefusal: last,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    fromSystem: before.solarSystemID,
    toSystem: flight.solarSystemID,
    inSpace: flight.inSpace,
    entitiesAtFirstLook: secondsToSettle.first,
    secondsUntilTheCountSettled: secondsToSettle.settledAfter,
    entities: space.entities.length,
    kinds,
    ship: space.ship ? { mode: space.ship.mode, capacitorRatio: space.ship.capacitorRatio, shieldCapacity: space.ship.shieldCapacity, activeModuleIDs: space.ship.activeModuleIDs } : null,
    nearestGate: gates[0] ?? null,
    space,
  };
}

/** The whole trip on one BFF. */
async function fly(base, account, characterID, gateID, log = console.log) {
  const pilot = await hold(base, account, characterID);
  const trip = { base, docked: null };
  try {
    if (!pilot.before.docked || !pilot.before.stationID) throw new Error("The pilot is not docked in a station; dock it first.");
    const stationID = pilot.before.stationID;
    Object.assign(trip, { stationID, homeSystem: pilot.before.solarSystemID });
    log(`  ${base}: undock`);
    await pilot.undock();
    await sleep(4000);
    log(`  ${base}: warp to the gate`);
    trip.warpOut = await warpTo(pilot, gateID);
    log(`  ${base}: jump`);
    trip.jumpOut = await jump(pilot, gateID);
    if (!trip.jumpOut.nearestGate) throw new Error("No stargate is in sight in the next system, so there is no way back.");
    log(`  ${base}: in ${trip.jumpOut.toSystem}; jump back through ${trip.jumpOut.nearestGate.name}`);
    trip.jumpBack = await jump(pilot, trip.jumpOut.nearestGate.itemID);
    log(`  ${base}: warp to the station`);
    trip.warpBack = await warpTo(pilot, stationID);
    log(`  ${base}: dock`);
    trip.docked = await pilot.dock(stationID);
  } finally {
    await pilot.logout();
  }
  return trip;
}

/** The entities of two snapshots of one system, by what each row says (not where anything that moves is). */
function sameSystem(gateway, gamePort) {
  const theirs = new Map(gateway.entities.map((row) => [row.itemID, row]));
  const ours = new Map(gamePort.entities.map((row) => [row.itemID, row]));
  const fixed = [...ours.values()].filter((row) => theirs.has(row.itemID) && !row.isSelf && apart(row.velocity, { x: 0, y: 0, z: 0 }) === 0);
  return {
    onlyOnGateway: [...theirs.values()].filter((row) => !ours.has(row.itemID)).map((row) => `${row.kind} ${row.itemID} ${row.name ?? ""}`.trim()),
    onlyOnGamePort: [...ours.values()].filter((row) => !theirs.has(row.itemID)).map((row) => `${row.kind} ${row.itemID} ${row.name ?? ""}`.trim()),
    fixedThings: fixed.length,
    largestFixedPositionDifference: Math.max(0, ...fixed.map((row) => apart(row.position, theirs.get(row.itemID).position))),
  };
}

async function main(argv = process.argv.slice(2)) {
  const [gatewayBase, gamePortBase, account, characterText, gateText, reportPath] = argv;
  const characterID = Number(characterText);
  const gateID = Number(gateText);
  if (!gatewayBase || !gamePortBase || !account || !Number.isSafeInteger(characterID) || !Number.isSafeInteger(gateID)) {
    throw new Error("Usage: node scripts/route-parity.js <gatewayBffUrl> <gamePortBffUrl> <account> <characterID> <gateID> [reportPath.json]");
  }
  console.log("gateway pass");
  const gateway = await fly(gatewayBase, account, characterID, gateID);
  if (!gateway.docked) throw new Error("⚠ The pilot did not dock again after the gateway pass. It is in space.");
  console.log("game-port pass");
  const gamePort = await fly(gamePortBase, account, characterID, gateID);

  const row = (label, read) => console.log(`${label.padEnd(44)} ${String(read(gateway)).padEnd(34)} ${read(gamePort)}`);
  console.log(`\n${"".padEnd(44)} ${"gateway".padEnd(34)} game port`);
  for (const [name, leg] of [["warp to the gate", "warpOut"], ["warp to the station", "warpBack"]]) {
    row(`${name}: modes seen`, (trip) => trip[leg].modes.join(" "));
    row(`${name}: seconds to enter warp`, (trip) => trip[leg].secondsToEnterWarp);
    row(`${name}: seconds in warp`, (trip) => trip[leg].secondsInWarp);
    row(`${name}: top speed seen, AU/s`, (trip) => (trip[leg].topSpeed / 149597870700).toFixed(2));
    row(`${name}: metres from it, out of warp`, (trip) => (trip[leg].metresFromTarget === null ? "-" : trip[leg].metresFromTarget.toFixed(0)));
    row(`${name}: capacitor afterwards`, (trip) => (trip[leg].capacitorAfter === null ? "-" : trip[leg].capacitorAfter.toFixed(3)));
  }
  for (const [name, leg] of [["jump out", "jumpOut"], ["jump back", "jumpBack"]]) {
    row(`${name}: from -> to`, (trip) => `${trip[leg].fromSystem} -> ${trip[leg].toSystem}`);
    row(`${name}: refusals first, seconds`, (trip) => `${trip[leg].refusalsBeforeAccepted}, ${trip[leg].seconds} s`);
    row(`${name}: entities at first look`, (trip) => trip[leg].entitiesAtFirstLook);
    row(`${name}: entities once settled (after s)`, (trip) => `${trip[leg].entities} (${trip[leg].secondsUntilTheCountSettled})`);
    row(`${name}: by kind`, (trip) => Object.entries(trip[leg].kinds).sort().map(([kind, count]) => `${count} ${kind}`).join(", "));
    row(`${name}: nearest gate`, (trip) => (trip[leg].nearestGate ? `${trip[leg].nearestGate.name} at ${Math.round(trip[leg].nearestGate.metres)} m` : "-"));
    row(`${name}: own ship`, (trip) => JSON.stringify(trip[leg].ship));
    const same = sameSystem(gateway[leg].space, gamePort[leg].space);
    console.log(`${name}: the two views of ${gateway[leg].toSystem}: only on the gateway ${JSON.stringify(same.onlyOnGateway)}, only on the game port ${JSON.stringify(same.onlyOnGamePort)}; ` +
      `${same.fixedThings} fixed things, largest difference in position ${same.largestFixedPositionDifference} m`);
  }
  row("docked again", (trip) => trip.docked);
  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify({ gateway, gamePort }, null, 1)}\n`);
    console.log(`written to ${reportPath}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { fly, jump, sameSystem, warpTo };
