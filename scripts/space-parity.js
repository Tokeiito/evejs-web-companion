"use strict";

// The space snapshot of one grid, read on each pilot transport and set side by side.
//
//   node scripts/space-parity.js <gatewayBffUrl> <gamePortBffUrl> <account> <characterID> [reportPath.json]
//
// The two BFFs are the same code with the pilot transport set differently
// (EVEJS_PILOT_TRANSPORT or its overrides), as scripts/bff-parity.js uses them.
// One character cannot be on both transports at once, so the same pilot is
// taken through the same steps twice, on one and then the other:
//
//   log in, select (docked), undock, wait, read /api/bridge/space/snapshot and
//   /api/bridge/flight/status, stop, dock again, log out.
//
// On the gateway the snapshot is the server's own scene. On the game port it is
// the pilot's ballpark, kept and stepped by the BFF as the retail client keeps
// its own (src/gamePort/pilotSpace.js, spaceProjection.js). This prints where
// they agree and every way they differ, grouped.
//
// The pilot's own ship is in a different place on each pass, so it is compared
// by what it is, not where. Everything fixed in space is compared to the metre.
//
//   node scripts/space-parity.js --together <gatewayBffUrl> <account> <characterID> <gamePortBffUrl> <account> <characterID>
//
// Two pilots docked in the same station, one on each transport, in space at
// the same time: each should see the other, and the two views of the grid are
// read back to back. Here the ships are compared by where they are too: each
// ship as its own transport has it against how the other transport sees it.
//
// ⚠ It UNDOCKS A REAL CHARACTER, twice, on the server the BFFs are pointed at,
// and docks it again each time. If docking does not finish the character is
// left in space and the script says so.

const fs = require("node:fs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function client(base) {
  let token = null;
  return async function request(method, route, body) {
    const response = await fetch(base + route, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Not JSON: the status says enough.
    }
    if (route === "/api/login" && payload && payload.sessionToken) token = payload.sessionToken;
    return { status: response.status, payload };
  };
}

/** One pass: the pilot's snapshot and flight status a few seconds after undocking. */
async function fly(base, account, characterID, { waitMs = 5000, log = console.log } = {}) {
  const request = client(base);
  const must = async (method, route, body) => {
    const out = await request(method, route, body);
    if (out.status !== 200) throw new Error(`${method} ${route} answered ${out.status}: ${JSON.stringify(out.payload).slice(0, 200)}`);
    return out.payload;
  };
  await must("POST", "/api/login", { username: account });
  const result = { base, docked: null };
  try {
    const selected = await must("POST", "/api/bridge/select", { characterID });
    if (selected.droneRecoveryCheckID) await request("POST", "/api/bridge/drone-recovery/ready", { checkID: selected.droneRecoveryCheckID });
    const before = (await must("GET", "/api/bridge/flight/status")).flight;
    if (!before.docked || !before.stationID) throw new Error("The pilot is not docked in a station; dock it first.");
    result.stationID = before.stationID;
    log(`  ${base}: undocking from ${before.stationID}`);
    result.undock = (await must("POST", "/api/bridge/flight/undock", {})).flight;
    await sleep(waitMs);
    result.space = (await must("GET", "/api/bridge/space/snapshot")).space;
    result.flight = (await must("GET", "/api/bridge/flight/status")).flight;
    // A second read a little later: the ship should have moved, by its speed.
    await sleep(2000);
    result.later = (await must("GET", "/api/bridge/space/snapshot")).space;
    log(`  ${base}: ${result.space.entities.length} entities; docking`);
    for (let tries = 0; tries < 40 && result.docked !== true; tries += 1) {
      const dock = await request("POST", "/api/bridge/flight/dock", { stationID: before.stationID });
      if (dock.status === 200) result.docked = true;
      else if (dock.status === 409) await sleep(3000); // "DockingApproach": on its way; ask again
      else throw new Error(`dock answered ${dock.status}: ${JSON.stringify(dock.payload).slice(0, 200)}`);
    }
    if (result.docked !== true) result.docked = false;
  } finally {
    await request("POST", "/api/logout", {});
  }
  return result;
}

const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A pilot held on one BFF, step by step. */
async function hold(base, account, characterID) {
  const request = client(base);
  const must = async (method, route, body) => {
    const out = await request(method, route, body);
    if (out.status !== 200) throw new Error(`${base} ${method} ${route} answered ${out.status}: ${JSON.stringify(out.payload).slice(0, 200)}`);
    return out.payload;
  };
  await must("POST", "/api/login", { username: account });
  const selected = await must("POST", "/api/bridge/select", { characterID });
  if (selected.droneRecoveryCheckID) await request("POST", "/api/bridge/drone-recovery/ready", { checkID: selected.droneRecoveryCheckID });
  const before = (await must("GET", "/api/bridge/flight/status")).flight;
  return {
    base,
    before,
    undock: () => must("POST", "/api/bridge/flight/undock", {}),
    snapshot: async () => (await must("GET", "/api/bridge/space/snapshot")).space,
    async dock(stationID) {
      for (let tries = 0; tries < 40; tries += 1) {
        const dock = await request("POST", "/api/bridge/flight/dock", { stationID });
        if (dock.status === 200) return true;
        if (dock.status !== 409) throw new Error(`dock answered ${dock.status}: ${JSON.stringify(dock.payload).slice(0, 200)}`);
        await sleep(3000); // "DockingApproach": on its way; ask again
      }
      return false;
    },
    logout: () => request("POST", "/api/logout", {}),
  };
}

/** Two pilots in space at once, one per transport: each one's view of the grid, read back to back. */
async function together(gatewaySide, gamePortSide, { waitMs = 6000, log = console.log } = {}) {
  const gateway = await hold(gatewaySide.base, gatewaySide.account, gatewaySide.characterID);
  let gamePort = null;
  const result = { docked: {} };
  try {
    gamePort = await hold(gamePortSide.base, gamePortSide.account, gamePortSide.characterID);
    for (const pilot of [gateway, gamePort]) {
      if (!pilot.before.docked || !pilot.before.stationID) throw new Error(`The pilot on ${pilot.base} is not docked in a station; dock it first.`);
    }
    if (gateway.before.stationID !== gamePort.before.stationID) throw new Error("The two pilots are not docked in the same station.");
    log(`  both undocking from ${gateway.before.stationID}`);
    await Promise.all([gateway.undock(), gamePort.undock()]);
    await sleep(waitMs);
    [result.gateway, result.gamePort] = await Promise.all([gateway.snapshot(), gamePort.snapshot()]);
    log(`  gateway sees ${result.gateway.entities.length} entities, game port ${result.gamePort.entities.length}; docking`);
    result.docked.gateway = await gateway.dock(gateway.before.stationID);
    result.docked.gamePort = await gamePort.dock(gamePort.before.stationID);
  } finally {
    await gateway.logout();
    if (gamePort) await gamePort.logout();
  }
  return result;
}

/** One ship as each of two snapshots has it: how far apart, in metres and in seconds of its own travel. */
function shipBothWays(itemID, gateway, gamePort) {
  const [theirs, ours] = [gateway.entities.find((row) => row.itemID === itemID), gamePort.entities.find((row) => row.itemID === itemID)];
  if (!theirs || !ours) return { itemID, seenByGateway: Boolean(theirs), seenByGamePort: Boolean(ours) };
  const speed = Math.hypot(theirs.velocity.x, theirs.velocity.y, theirs.velocity.z);
  const metres = apart(theirs.position, ours.position);
  const fields = [...new Set([...Object.keys(theirs), ...Object.keys(ours)])]
    .filter((field) => !["position", "velocity", "isSelf"].includes(field) && JSON.stringify(theirs[field]) !== JSON.stringify(ours[field]))
    .map((field) => `${field}: game port ${JSON.stringify(ours[field])} / gateway ${JSON.stringify(theirs[field])}`);
  return { itemID, name: theirs.name, seenByGateway: true, seenByGamePort: true, metresApart: metres, speed, secondsOfTravelApart: speed > 0 ? metres / speed : null, velocityApart: apart(theirs.velocity, ours.velocity), fields };
}

/** Every way two snapshots of the same grid differ, grouped. */
function compare(gateway, gamePort) {
  const theirs = new Map(gateway.entities.map((row) => [row.itemID, row]));
  const ours = new Map(gamePort.entities.map((row) => [row.itemID, row]));
  const report = {
    entities: { gateway: gateway.entities.length, gamePort: gamePort.entities.length },
    onlyOnGateway: [...theirs.values()].filter((row) => !ours.has(row.itemID)).map((row) => `${row.kind} ${row.itemID} ${row.name ?? ""}`.trim()),
    onlyOnGamePort: [...ours.values()].filter((row) => !theirs.has(row.itemID)).map((row) => `${row.kind} ${row.itemID} ${row.name ?? ""}`.trim()),
    differences: [],
    identicalRows: 0,
    fixedThings: 0,
    largestFixedPositionDifference: 0,
  };
  const classes = new Map();
  const note = (field, kind, mine, yours) => {
    const key = `${field} on a ${kind}: game port ${JSON.stringify(mine)} / gateway ${JSON.stringify(yours)}`;
    classes.set(key, (classes.get(key) ?? 0) + 1);
  };
  for (const [itemID, row] of ours) {
    const other = theirs.get(itemID);
    if (!other) continue;
    let same = true;
    const moving = row.isSelf || apart(other.velocity, { x: 0, y: 0, z: 0 }) > 0 || apart(row.velocity, { x: 0, y: 0, z: 0 }) > 0;
    for (const field of new Set([...Object.keys(row), ...Object.keys(other)])) {
      if (field === "position" || field === "velocity") {
        if (moving) continue; // somewhere else on each pass
        const distance = apart(row[field], other[field]);
        if (field === "position") report.largestFixedPositionDifference = Math.max(report.largestFixedPositionDifference, distance);
        if (distance > 1e-3) {
          same = false;
          note(field, other.kind, "(differs)", `${distance} m apart`);
        }
        continue;
      }
      if (JSON.stringify(row[field]) !== JSON.stringify(other[field])) {
        same = false;
        // A float held to 32 bits by the client's ball is the same number.
        if (typeof row[field] === "number" && typeof other[field] === "number" && Math.fround(other[field]) === row[field]) note(field, other.kind, "(the gateway's value, held as a 32-bit float)", "(the value)");
        else note(field, other.kind, typeof row[field] === "string" && field === "name" ? "(a name)" : row[field], typeof other[field] === "string" && field === "name" ? "(a name)" : other[field]);
      }
    }
    if (!moving) report.fixedThings += 1;
    if (same) report.identicalRows += 1;
  }
  report.differences = [...classes].sort((a, b) => b[1] - a[1]).map(([what, count]) => ({ count, what }));
  const shipFields = new Set([...Object.keys(gateway.ship ?? {}), ...Object.keys(gamePort.ship ?? {})]);
  report.ship = [...shipFields].filter((field) => !["position", "velocity"].includes(field) && JSON.stringify((gateway.ship ?? {})[field]) !== JSON.stringify((gamePort.ship ?? {})[field]))
    .map((field) => ({ field, gamePort: (gamePort.ship ?? {})[field], gateway: (gateway.ship ?? {})[field] }));
  return report;
}

/** How far the pilot's ship moved between the two reads of one pass, against its speed. */
function movement(pass) {
  const [a, b] = [pass.space.ship, pass.later.ship];
  if (!a || !b) return null;
  return { metres: apart(a.position, b.position), seconds: (pass.later.sampledAtMs - pass.space.sampledAtMs) / 1000, speed: Math.hypot(a.velocity.x, a.velocity.y, a.velocity.z), mode: a.mode };
}

async function mainTogether(argv) {
  const [gatewayBase, gatewayAccount, gatewayCharacter, gamePortBase, gamePortAccount, gamePortCharacter] = argv;
  if (!gatewayBase || !gamePortBase || !Number.isSafeInteger(Number(gatewayCharacter)) || !Number.isSafeInteger(Number(gamePortCharacter))) {
    throw new Error("Usage: node scripts/space-parity.js --together <gatewayBffUrl> <account> <characterID> <gamePortBffUrl> <account> <characterID>");
  }
  console.log("two pilots, one per transport, in space at once");
  const seen = await together(
    { base: gatewayBase, account: gatewayAccount, characterID: Number(gatewayCharacter) },
    { base: gamePortBase, account: gamePortAccount, characterID: Number(gamePortCharacter) },
  );
  const report = compare(seen.gateway, seen.gamePort);
  console.log(`\nentities: gateway ${report.entities.gateway}, game port ${report.entities.gamePort}; ${report.identicalRows} rows identical in every field`);
  console.log(`only on the gateway: ${JSON.stringify(report.onlyOnGateway)}`);
  console.log(`only on the game port: ${JSON.stringify(report.onlyOnGamePort)}`);
  console.log(`fixed things: ${report.fixedThings}; largest difference in position ${report.largestFixedPositionDifference} m`);
  console.log("differences, by kind:");
  for (const { count, what } of report.differences) console.log(`  ${String(count).padStart(3)} x ${what}`);
  console.log(`the two reads were ${Math.abs(seen.gateway.sampledAtMs - seen.gamePort.sampledAtMs)} ms apart by their own clocks (the game port's is whole seconds)`);
  for (const [whose, itemID] of [["the gateway pilot's ship", seen.gateway.shipID], ["the game-port pilot's ship", seen.gamePort.shipID]]) {
    const both = shipBothWays(itemID, seen.gateway, seen.gamePort);
    if (!both.seenByGateway || !both.seenByGamePort) {
      console.log(`${whose} (${itemID}): seen by the gateway ${both.seenByGateway}, by the game port ${both.seenByGamePort}`);
      continue;
    }
    console.log(`${whose} (${both.name}): the two views have it ${both.metresApart.toFixed(1)} m apart at ${both.speed.toFixed(1)} m/s` +
      (both.secondsOfTravelApart === null ? "" : `, ${both.secondsOfTravelApart.toFixed(2)} s of its travel`) + `; velocities ${both.velocityApart.toExponential(2)} m/s apart`);
    for (const field of both.fields) console.log(`    ${field}`);
  }
  console.log(seen.docked.gateway && seen.docked.gamePort ? "Both pilots are docked again." : `⚠ Docked again: gateway ${seen.docked.gateway}, game port ${seen.docked.gamePort}. A pilot is in space.`);
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--together") return mainTogether(argv.slice(1));
  const [gatewayBase, gamePortBase, account, characterText, reportPath] = argv;
  const characterID = Number(characterText);
  if (!gatewayBase || !gamePortBase || !account || !Number.isSafeInteger(characterID)) {
    throw new Error("Usage: node scripts/space-parity.js <gatewayBffUrl> <gamePortBffUrl> <account> <characterID> [reportPath.json]");
  }
  console.log("gateway pass");
  const gateway = await fly(gatewayBase, account, characterID);
  if (!gateway.docked) throw new Error("⚠ The pilot did not dock again after the gateway pass. It is in space.");
  console.log("game-port pass");
  const gamePort = await fly(gamePortBase, account, characterID);
  const report = compare(gateway.space, gamePort.space);
  report.flight = { gateway: gateway.flight, gamePort: gamePort.flight };
  report.movement = { gateway: movement(gateway), gamePort: movement(gamePort) };
  report.docked = { gateway: gateway.docked, gamePort: gamePort.docked };

  console.log(`\nentities: gateway ${report.entities.gateway}, game port ${report.entities.gamePort}; ${report.identicalRows} rows identical in every field`);
  console.log(`only on the gateway: ${JSON.stringify(report.onlyOnGateway)}`);
  console.log(`only on the game port: ${JSON.stringify(report.onlyOnGamePort)}`);
  console.log(`fixed things: ${report.fixedThings}; largest difference in position ${report.largestFixedPositionDifference} m`);
  console.log("differences, by kind:");
  for (const { count, what } of report.differences) console.log(`  ${String(count).padStart(3)} x ${what}`);
  console.log("the pilot's own ship, field by field where they differ:");
  for (const { field, gamePort: mine, gateway: yours } of report.ship) console.log(`  ${field}: game port ${JSON.stringify(mine)} / gateway ${JSON.stringify(yours)}`);
  for (const name of ["gateway", "gamePort"]) {
    const flight = report.flight[name];
    const moved = report.movement[name];
    console.log(`${name}: flight status inSpace ${flight.inSpace}, mode ${flight.shipMode}, speed fraction ${flight.shipSpeedFraction}; ` +
      (moved ? `between two reads ${moved.seconds} s apart the ship moved ${moved.metres.toFixed(1)} m at ${moved.speed.toFixed(1)} m/s (${moved.mode})` : "no ship in the snapshot"));
  }
  console.log(gamePort.docked ? "The pilot is docked again." : "⚠ The pilot did NOT dock again after the game-port pass. It is in space.");
  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify({ report, gateway: gateway.space, gamePort: gamePort.space }, null, 1)}\n`);
    console.log(`written to ${reportPath}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { compare, fly, hold, movement, shipBothWays, together };
