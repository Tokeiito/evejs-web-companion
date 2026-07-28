"use strict";

// Session changes are not timers. Retail's ten seconds is the default next-
// mutation cooldown; readiness is observed location + scene/ego/ship state.
// This module keeps those facts separate and is dependency-injected so route
// tests never sleep in real time.

const SESSION_CHANGE_COOLDOWN_MS = 10_000;
const TRANSITION_READY_TIMEOUT_MS = 45_000;
const TRANSITION_POLL_MS = 250;

const TRANSITION_KINDS = new Set(["undock", "dock", "stargate", "board", "clone", "other-session"]);
// A timeout is an UNCERTAIN outcome: the write may have landed after our last
// read. It deliberately remains blocking so a retry cannot repeat intent.
const TERMINAL_PHASES = new Set(["ready"]);

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function publicTransition(held) {
  const row = held && held.transition;
  return {
    epoch: Number(held && held.transitionEpoch) || 0,
    kind: row && TRANSITION_KINDS.has(row.kind) ? row.kind : "idle",
    phase: row && typeof row.phase === "string" ? row.phase : "ready",
    startedAtMs: row ? Number(row.startedAtMs) || null : null,
    cooldownUntilMs: Number(held && held.cooldownUntilMs) || null,
    fromSolarSystemID: row ? numberOrNull(row.fromSolarSystemID) : null,
    toSolarSystemID: row ? numberOrNull(row.toSolarSystemID) : null,
    stationID: row ? numberOrNull(row.stationID) : null,
    shipID: row ? numberOrNull(row.shipID) : null,
    sessionStable: !row || row.phase === "ready",
    locationReady: row ? row.locationReady === true : true,
    sceneReady: row ? row.sceneReady === true : true,
    egoReady: row ? row.egoReady === true : true,
    shipReady: row ? row.shipReady === true : true,
    boundContextReady: row ? row.boundContextReady === true : true,
    failure: row && typeof row.failure === "string" ? row.failure : null,
  };
}

function beginHeldTransition(held, kind, expected = {}, nowMs = Date.now()) {
  if (!held || !TRANSITION_KINDS.has(kind)) {
    return { ok: false, code: "INVALID_TRANSITION", message: "That session transition is not supported." };
  }
  const current = held.transition;
  if (current && !TERMINAL_PHASES.has(current.phase)) {
    return {
      ok: false,
      code: "SESSION_CHANGE_IN_PROGRESS",
      message: `The ${current.kind} transition is still finishing.`,
      transition: publicTransition(held),
    };
  }
  const priorCooldownUntilMs = Number(held.cooldownUntilMs) || 0;
  held.transitionEpoch = (Number(held.transitionEpoch) || 0) + 1;
  held.cooldownUntilMs = nowMs + SESSION_CHANGE_COOLDOWN_MS;
  held.transition = {
    epoch: held.transitionEpoch,
    kind,
    phase: "requested",
    startedAtMs: nowMs,
    fromSolarSystemID: numberOrNull(expected.fromSolarSystemID),
    toSolarSystemID: numberOrNull(expected.toSolarSystemID),
    stationID: numberOrNull(expected.stationID),
    shipID: numberOrNull(expected.shipID),
    fromShipID: numberOrNull(expected.fromShipID),
    locationReady: false,
    sceneReady: false,
    egoReady: false,
    shipReady: false,
    boundContextReady: false,
    failure: null,
    priorCooldownUntilMs,
  };
  // Every session/location/ship epoch invalidates bound OIDs. A later call
  // rebinds against the new station, park, hull, fleet, or scan context.
  if (held.boundHandles && typeof held.boundHandles.clear === "function") {
    held.boundHandles.clear();
  }
  return { ok: true, transition: publicTransition(held) };
}

function cancelHeldTransition(held) {
  if (!held || !held.transition) {
    return;
  }
  held.cooldownUntilMs = Number(held.transition.priorCooldownUntilMs) || 0;
  held.transition = null;
}

function markTransitionAccepted(held) {
  if (held && held.transition && !TERMINAL_PHASES.has(held.transition.phase)) {
    held.transition.phase = "accepted";
  }
}

function markTransitionFailed(held, message) {
  if (held && held.transition) {
    held.transition.phase = "failed";
    held.transition.failure = String(message || "The session transition did not finish.");
  }
}

function shipIdentity(space) {
  const ship = space && typeof space === "object" ? space.ship : null;
  return ship && typeof ship === "object"
    ? numberOrNull(ship.itemID ?? ship.shipID ?? ship.id)
    : null;
}

function evaluateReadiness(kind, expected, flight, space) {
  const inSpace = flight && flight.inSpace === true;
  const docked = flight && flight.docked === true;
  const flightShipID = numberOrNull(flight && flight.shipID);
  const expectedShipID = numberOrNull(expected.shipID);
  const expectedStationID = numberOrNull(expected.stationID);
  const fromSystemID = numberOrNull(expected.fromSolarSystemID);
  const toSystemID = numberOrNull(expected.toSolarSystemID);
  const systemID = numberOrNull(flight && flight.solarSystemID);

  if (kind === "dock") {
    const locationReady =
      docked &&
      (!expectedStationID || numberOrNull(flight.stationID) === expectedStationID || numberOrNull(flight.structureID) === expectedStationID);
    return {
      ready: locationReady && (!expectedShipID || flightShipID === expectedShipID),
      locationReady,
      sceneReady: locationReady && !inSpace,
      egoReady: locationReady && !inSpace,
      shipReady: !expectedShipID || flightShipID === expectedShipID,
      boundContextReady: locationReady,
    };
  }

  if (kind === "board") {
    const fromShipID = numberOrNull(expected.fromShipID);
    // Some hull-changing handlers know the destination ship (Board and
    // BoardStoredShip); others only know that the active hull must change
    // (Eject, LeaveShip, StoreVessel, CreateNewbieShip). Both cases wait on
    // the authoritative flight ship and, in space, the matching scene ego.
    const shipReady = expectedShipID !== null
      ? flightShipID === expectedShipID
      : fromShipID !== null && flightShipID !== null && flightShipID !== fromShipID;
    const sceneReady = !inSpace || Boolean(space && space.inSpace === true);
    const egoReady = !inSpace || (flightShipID !== null && shipIdentity(space) === flightShipID);
    return {
      ready: (docked || inSpace) && shipReady && sceneReady && egoReady,
      locationReady: docked || inSpace,
      sceneReady,
      egoReady,
      shipReady,
      boundContextReady: shipReady && sceneReady && egoReady,
    };
  }

  if (kind === "clone") {
    const destinationLocationID = numberOrNull(expected.destinationLocationID);
    const stationID = numberOrNull(flight && flight.stationID);
    const structureID = numberOrNull(flight && flight.structureID);
    const dockLocationReady =
      docked &&
      destinationLocationID !== null &&
      (stationID === destinationLocationID || structureID === destinationLocationID);
    // A clone-vat destination is a ship rather than a dockable location. In
    // that case the authoritative postcondition is a live space scene whose
    // ego matches the flight snapshot's active capsule.
    const sceneReady = docked || Boolean(space && space.inSpace === true);
    const egoReady = docked || (flightShipID !== null && shipIdentity(space) === flightShipID);
    const shipReady = flightShipID !== null;
    const locationReady = dockLocationReady || (inSpace && sceneReady);
    return {
      ready: locationReady && sceneReady && egoReady && shipReady,
      locationReady,
      sceneReady,
      egoReady,
      shipReady,
      boundContextReady: locationReady && sceneReady && egoReady,
    };
  }

  const systemReady =
    kind === "stargate"
      ? systemID !== null && (toSystemID !== null ? systemID === toSystemID : fromSystemID !== null && systemID !== fromSystemID)
      : toSystemID === null || systemID === toSystemID;
  const locationReady = inSpace && systemReady;
  const sceneReady = Boolean(space && space.inSpace === true);
  const egoID = shipIdentity(space);
  const egoReady = expectedShipID === null ? egoID !== null : egoID === expectedShipID;
  const shipReady = expectedShipID === null ? flightShipID !== null : flightShipID === expectedShipID;
  return {
    ready: locationReady && sceneReady && egoReady && shipReady,
    locationReady,
    sceneReady,
    egoReady,
    shipReady,
    boundContextReady: locationReady && sceneReady,
  };
}

async function waitForTransitionReady({
  held,
  kind,
  expected = {},
  readFlight,
  readSpace,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  timeoutMs = TRANSITION_READY_TIMEOUT_MS,
  pollMs = TRANSITION_POLL_MS,
}) {
  const epoch = held && held.transition ? held.transition.epoch : null;
  const deadline = now() + timeoutMs;
  const notifications = [];
  let lastFlight = null;
  while (now() <= deadline) {
    if (!held.transition || held.transition.epoch !== epoch) {
      return { ok: false, code: "TRANSITION_SUPERSEDED", flight: lastFlight, notifications };
    }
    const flightOutcome = await readFlight();
    lastFlight = flightOutcome && flightOutcome.flight ? flightOutcome.flight : {};
    if (Array.isArray(flightOutcome && flightOutcome.notifications)) {
      notifications.push(...flightOutcome.notifications);
    }
    let space = null;
    if (kind === "undock" || kind === "stargate" || kind === "clone" || (kind === "board" && lastFlight.inSpace === true)) {
      const spaceOutcome = await readSpace();
      space = spaceOutcome && spaceOutcome.space ? spaceOutcome.space : null;
      if (Array.isArray(spaceOutcome && spaceOutcome.notifications)) {
        notifications.push(...spaceOutcome.notifications);
      }
    }
    const readiness = evaluateReadiness(kind, expected, lastFlight, space);
    Object.assign(held.transition, readiness, { phase: readiness.ready ? "ready" : "session-changing" });
    if (readiness.ready) {
      held.activeShipID = numberOrNull(lastFlight.shipID) || held.activeShipID || null;
      if (held.boundHandles && typeof held.boundHandles.clear === "function") {
        held.boundHandles.clear();
      }
      return { ok: true, flight: lastFlight, space, notifications, transition: publicTransition(held) };
    }
    await sleep(pollMs);
  }
  markTransitionFailed(held, "The session change did not become ready in time. No command was repeated.");
  return {
    ok: false,
    code: "TRANSITION_TIMEOUT",
    message: held.transition.failure,
    flight: lastFlight,
    notifications,
    transition: publicTransition(held),
  };
}

module.exports = {
  SESSION_CHANGE_COOLDOWN_MS,
  TRANSITION_POLL_MS,
  TRANSITION_READY_TIMEOUT_MS,
  beginHeldTransition,
  cancelHeldTransition,
  evaluateReadiness,
  markTransitionAccepted,
  markTransitionFailed,
  publicTransition,
  waitForTransitionReady,
};
